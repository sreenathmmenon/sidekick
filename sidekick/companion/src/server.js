import http from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { requireBearerToken } from "./auth.js";
import { normalizeWorkContextEvent, SOURCES } from "./domain.js";
import { deriveFromEvent } from "./derive.js";
import { readJsonBody, sendJson } from "./http.js";
import { getCommitments, getPlan, getRecall, getResume, getTriage } from "./capabilities.js";
import { completeFocusSession, currentFocusSession, listFocusSessions, startFocusSession } from "./focus.js";
import { syncMicrosoftGraph } from "./microsoftGraph.js";
import { syncGitHub } from "./github.js";
import { storeSecret, readSecret } from "./secrets.js";
import { TimelineStore } from "./store.js";
import { renderDashboard, sendHtml } from "./ui.js";
import { FieldCipher, NullCipher } from "./crypto.js";
import { logger, setLogLevel, shortId } from "./logger.js";
import { describeSecretBackend } from "./secrets.js";
import { RateLimiter } from "./rateLimit.js";
import { ConnectorPoller } from "./poller.js";
import { buildBriefing, buildMeetingPrep } from "./briefing.js";
import { ingestMeeting, getMeetingMinutes } from "./meeting.js";
import { todoFilePath, loadTodos, saveTodos, todoView, addTask, setChecked, rollover, syncInbox, moveTask, rescheduleTask, removeTask } from "./todos.js";
import { enrichEventAsync, selectExtractorTier } from "./extractor.js";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}

// Builds the field cipher from a DEDICATED data-encryption key (DEK), NOT the API
// token. This decouples two different lifecycles: the API token is an auth
// credential that can be rotated freely, while the DEK is bound to the database for
// its lifetime. (Previously the key was scrypt(apiToken, salt) — rotating the token
// silently bricked the DB. Fixed per production review.)
//
// The DEK is a random 32-byte key, persisted in the OS keychain (file fallback,
// 0600) next to a per-DB salt. A known-plaintext CANARY is stored on first init and
// verified at startup, so a lost/mismatched key/salt fails fast with a clear message
// instead of degrading into per-request 500s deep in list queries.
export function buildCipher(config, deps = {}) {
  if (!config.encryptionEnabled) return new NullCipher();
  const readSec = deps.readSecret || readSecret;
  const storeSec = deps.storeSecret || storeSecret;

  const saltPath = config.dbPath + ".salt";
  const canaryPath = config.dbPath + ".canary";
  let salt;
  if (existsSync(saltPath)) {
    salt = readFileSync(saltPath);
  } else {
    salt = randomBytes(16);
    writeFileSync(saltPath, salt, { mode: 0o600 });
  }

  // Load or create the dedicated data-encryption key (base64), keychain-first.
  let dekB64 = readSec("data-encryption-key");
  if (!dekB64) {
    dekB64 = randomBytes(32).toString("base64");
    storeSec("data-encryption-key", dekB64);
  }
  const cipher = new FieldCipher(FieldCipher.deriveKey(dekB64, salt));

  // Canary: prove the key+salt match this database before we serve any request.
  const CANARY = "sidekick-canary-v1";
  if (existsSync(canaryPath)) {
    try {
      const decrypted = cipher.decrypt(readFileSync(canaryPath, "utf8").trim());
      if (decrypted !== CANARY) throw new Error("mismatch");
    } catch {
      throw new Error(
        "Encryption key/salt does not match this database. " +
        "If you restored a backup, ensure the .salt file and keychain DEK came with the .sqlite. " +
        "To start fresh, remove the .sqlite, .salt, and .canary files."
      );
    }
  } else {
    writeFileSync(canaryPath, cipher.encrypt(CANARY), { mode: 0o600 });
  }
  return cipher;
}

export function startServer() {
  setLogLevel(process.env.SIDEKICK_LOG_LEVEL || "info");
  const config = loadConfig();
  const cipher = buildCipher(config);
  const store = new TimelineStore(config.dbPath, cipher);
  const rateLimiter = new RateLimiter(config.rateLimit);
  const server = createServer({ config, store, rateLimiter });
  const poller = new ConnectorPoller({ store, deriveFn: deriveFromEvent, intervalMs: config.pollIntervalMs });
  poller.start();
  let shuttingDown = false;

  server.on("error", (error) => {
    logger.error("companion failed to start", { error: error.message });
    poller.stop();
    store.close();
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info("companion listening", {
      url: `http://${config.host}:${config.port}`,
      dbPath: config.dbPath,
      encryption: config.encryptionEnabled ? "on (aes-256-gcm field encryption)" : "off",
      secretBackend: describeSecretBackend(),
      pollIntervalMs: config.pollIntervalMs
    });
  });

  const shutdown = (signal) => {
    if (shuttingDown) {
      logger.error("force exiting after repeated signal", { signal });
      store.close();
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("shutting down", { signal });
    poller.stop();
    const forceTimer = setTimeout(() => {
      logger.error("forced shutdown after timeout");
      store.close();
      process.exit(1);
    }, 1500);
    forceTimer.unref();
    server.close(() => {
      clearTimeout(forceTimer);
      store.close();
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return { server, store, config, poller };
}

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  // The dashboard is fully self-contained (inline styles/scripts) and same-origin only.
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

export function createServer({ config, store, rateLimiter = null }) {
  return http.createServer(async (req, res) => {
    const reqId = shortId();
    const startedAt = process.hrtime.bigint();
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);

    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }

    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      logger[level]("request", {
        reqId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        ms: Math.round(ms * 100) / 100
      });
    });

    try {
      if (req.method === "GET" && url.pathname === "/") {
        const nonce = randomBytes(16).toString("base64");
        sendHtml(res, renderDashboard(nonce), nonce);
        return;
      }

      // Same-origin localhost bootstrap: the Memory Console (served from this very
      // origin) can fetch its own token so the user never pastes 'dev-local-token'.
      // Hardened: loopback + same-origin Sec-Fetch-Site AND a custom header that a
      // cross-origin <img>/<script>/simple fetch cannot set (so even if injected
      // content ran, a no-CORS request can't read the token), plus the strict
      // script nonce above means injected inline scripts don't execute at all.
      if (req.method === "GET" && url.pathname === "/console-token") {
        const remote = req.socket.remoteAddress || "";
        const isLoopback = remote.includes("127.0.0.1") || remote === "::1" || remote.includes("::ffff:127.0.0.1");
        const site = req.headers["sec-fetch-site"];
        const sameOrigin = site === undefined || site === "same-origin" || site === "none";
        const hasGuardHeader = req.headers["x-sidekick-console"] === "1";
        if (!isLoopback || !sameOrigin || !hasGuardHeader) {
          sendJson(res, 403, { ok: false, error: "console token is local same-origin only" });
          return;
        }
        sendJson(res, 200, { ok: true, token: config.token });
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        const probe = store.healthCheck();
        sendJson(res, probe.ok ? 200 : 503, {
          ok: probe.ok,
          component: "Local Companion",
          storage: "SQLite",
          encryption: config.encryptionEnabled ? "aes-256-gcm" : "off",
          secretBackend: describeSecretBackend(),
          dbPath: config.dbPath,
          ...(probe.ok ? {} : { error: probe.detail })
        });
        return;
      }

      // Rate limit per remote address before auth so an unauthenticated flood is cheap to shed.
      if (rateLimiter) {
        const key = req.socket.remoteAddress || "local";
        const verdict = rateLimiter.check(key);
        if (!verdict.allowed) {
          res.setHeader("retry-after", String(verdict.retryAfterSeconds));
          sendJson(res, 429, { ok: false, error: "Too many requests" });
          return;
        }
      }

      if (!requireBearerToken(req, config.token)) {
        sendJson(res, 401, { ok: false, error: "Missing or invalid bearer token" });
        return;
      }

      if (req.method === "POST" && url.pathname === "/events") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        const event = normalizeWorkContextEvent(input);
        // Atomic: the event and all its derived rows commit together or not at all.
        const derived = store.transaction(() => {
          store.appendEvent(event);
          return deriveFromEvent(store, event);
        });
        // Optional AI enrichment runs AFTER we respond — never blocks ingest, never
        // crashes it. The deterministic result above already stands on its own.
        sendJson(res, 201, { ok: true, event, derived, extractor: selectExtractorTier(config) });
        Promise.resolve().then(() => enrichEventAsync(store, event, config)).catch(() => {});
        return;
      }

      if (req.method === "POST" && url.pathname === "/connectors/microsoft/sync") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        const result = await syncMicrosoftGraph(input, store, deriveFromEvent);
        sendJson(res, result.ok ? 200 : 207, result);
        return;
      }

      // GitHub connector: store a fine-grained PAT in the OS keychain (never the DB),
      // check status, and sync review-requests + assignments into the brain.
      if (req.method === "POST" && url.pathname === "/connectors/github/token") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        if (typeof input.token !== "string" || input.token.trim().length < 8) {
          sendJson(res, 400, { ok: false, error: "token required (fine-grained PAT)" });
          return;
        }
        const stored = storeSecret("github-pat", input.token.trim());
        sendJson(res, stored ? 200 : 500, {
          ok: stored,
          stored: stored ? describeSecretBackend() : "unavailable",
          error: stored ? undefined : "Could not store the token securely"
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/connectors/github/status") {
        sendJson(res, 200, { ok: true, connected: Boolean(readSecret("github-pat")) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/connectors/github/sync") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        const token = (typeof input.token === "string" && input.token.trim()) || readSecret("github-pat");
        if (!token) {
          sendJson(res, 400, { ok: false, error: "No GitHub token. Save a PAT first via POST /connectors/github/token." });
          return;
        }
        const result = await syncGitHub({ ...input, token }, store, deriveFromEvent);
        sendJson(res, result.ok ? 200 : 207, result);
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        const source = url.searchParams.get("source");
        if (source && !SOURCES.has(source)) {
          sendJson(res, 400, { ok: false, error: `Unsupported source: ${source}` });
          return;
        }

        const events = store.listEvents({
          source,
          limit: Number(url.searchParams.get("limit") || 50)
        });
        sendJson(res, 200, { ok: true, events });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/events") {
        const source = url.searchParams.get("source");
        if (!source || !SOURCES.has(source)) {
          sendJson(res, 400, { ok: false, error: "DELETE /events requires a valid source" });
          return;
        }

        const deleted = store.deleteEventsBySource(source);
        sendJson(res, 200, { ok: true, deleted });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/commitments") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(res, 400, { ok: false, error: "DELETE /commitments requires ?id=" });
          return;
        }
        sendJson(res, 200, { ok: true, deleted: store.deleteCommitmentById(id) });
        return;
      }

      // Record a user decision on a proposed commitment: dismiss a false positive
      // or confirm a real one. Survives re-derivation (status guard in the store).
      if (req.method === "POST" && url.pathname === "/commitments/status") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        const allowed = ["proposed", "confirmed", "dismissed"];
        if (!input.id || !allowed.includes(input.status)) {
          sendJson(res, 400, { ok: false, error: "POST /commitments/status requires { id, status: proposed|confirmed|dismissed }" });
          return;
        }
        sendJson(res, 200, { ok: true, changed: store.setCommitmentStatus(input.id, input.status) });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/lessons") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(res, 400, { ok: false, error: "DELETE /lessons requires ?id=" });
          return;
        }
        sendJson(res, 200, { ok: true, deleted: store.deleteLessonById(id) });
        return;
      }

      if (req.method === "DELETE" && url.pathname === "/memory") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(res, 400, { ok: false, error: "DELETE /memory requires ?id=" });
          return;
        }
        sendJson(res, 200, { ok: true, deleted: store.deleteMemoryById(id) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/resume") {
        sendJson(res, 200, getResume(store, config));
        return;
      }

      if (req.method === "GET" && url.pathname === "/triage") {
        sendJson(res, 200, getTriage(store));
        return;
      }

      if (req.method === "GET" && url.pathname === "/commitments") {
        sendJson(res, 200, getCommitments(store));
        return;
      }

      if (req.method === "GET" && url.pathname === "/recall") {
        sendJson(res, 200, getRecall(store, url.searchParams.get("q")));
        return;
      }

      if (req.method === "GET" && url.pathname === "/plan") {
        sendJson(res, 200, getPlan(store));
        return;
      }

      // Briefing: the one proactive digest (Resume + Triage + Commitments, composed).
      if (req.method === "GET" && url.pathname === "/briefing") {
        sendJson(res, 200, buildBriefing(store, config));
        return;
      }

      // GTD todos — a plain Markdown file you own (~/.sidekick/TODO.md). Sidekick
      // proposes (folds in captured commitments) but never rewrites your lines.
      if (req.method === "GET" && url.pathname === "/todos") {
        const path = todoFilePath();
        sendJson(res, 200, { ok: true, path, view: todoView(loadTodos(path)) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/todos/add") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        if (typeof input.text !== "string" || !input.text.trim()) {
          sendJson(res, 400, { ok: false, error: "POST /todos/add requires { text }" });
          return;
        }
        const path = todoFilePath();
        const doc = loadTodos(path);
        addTask(doc, input.text, input.section || "Today");
        saveTodos(path, doc);
        sendJson(res, 201, { ok: true, view: todoView(doc) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/todos/check") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        if (typeof input.text !== "string") {
          sendJson(res, 400, { ok: false, error: "POST /todos/check requires { text, checked }" });
          return;
        }
        const path = todoFilePath();
        const doc = loadTodos(path);
        setChecked(doc, input.text, input.checked !== false, input.section || "Today");
        saveTodos(path, doc);
        sendJson(res, 200, { ok: true, view: todoView(doc) });
        return;
      }

      // Rollover: unchecked Today items stay, checked move to Done. The plan-vs-reality
      // fix — unfinished work is never silently dropped, completed work clears out.
      if (req.method === "POST" && url.pathname === "/todos/rollover") {
        const path = todoFilePath();
        const doc = loadTodos(path);
        const result = rollover(doc);
        saveTodos(path, doc);
        sendJson(res, 200, { ok: true, rolled: result.rolled, archived: result.archived, view: todoView(doc) });
        return;
      }

      // Move a task between GTD lists (Inbox -> Today, Today -> Someday, …).
      if (req.method === "POST" && url.pathname === "/todos/move") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        if (!input.text || !input.from || !input.to) {
          sendJson(res, 400, { ok: false, error: "POST /todos/move requires { text, from, to }" });
          return;
        }
        const path = todoFilePath();
        const doc = loadTodos(path);
        moveTask(doc, input.text, input.from, input.to);
        saveTodos(path, doc);
        sendJson(res, 200, { ok: true, view: todoView(doc) });
        return;
      }

      // Reschedule a Today item: when = "tomorrow" (-> Next Actions) | "someday".
      if (req.method === "POST" && url.pathname === "/todos/reschedule") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        if (!input.text) {
          sendJson(res, 400, { ok: false, error: "POST /todos/reschedule requires { text, when }" });
          return;
        }
        const path = todoFilePath();
        const doc = loadTodos(path);
        rescheduleTask(doc, input.text, input.when || "tomorrow");
        saveTodos(path, doc);
        sendJson(res, 200, { ok: true, view: todoView(doc) });
        return;
      }

      // Remove a single task line.
      if (req.method === "POST" && url.pathname === "/todos/remove") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        if (!input.text) {
          sendJson(res, 400, { ok: false, error: "POST /todos/remove requires { text }" });
          return;
        }
        const path = todoFilePath();
        const doc = loadTodos(path);
        removeTask(doc, input.text, input.section || "Today");
        saveTodos(path, doc);
        sendJson(res, 200, { ok: true, view: todoView(doc) });
        return;
      }

      // GTD Capture: fold the latest captured commitments into the ## Inbox (append-only,
      // de-duplicated against the whole file). You then clarify them into your lists.
      if (req.method === "POST" && url.pathname === "/todos/sync") {
        const path = todoFilePath();
        const doc = loadTodos(path);
        const commitments = getCommitments(store).commitments;
        syncInbox(doc, commitments);
        saveTodos(path, doc);
        sendJson(res, 200, { ok: true, added_to_inbox: doc._inboxAdded || 0, view: todoView(doc) });
        return;
      }

      // Meeting lifecycle: prep (before), ingest (during/after), minutes (read-back).
      if (req.method === "GET" && url.pathname === "/meeting/prep") {
        const attendeesParam = url.searchParams.get("attendees");
        sendJson(res, 200, buildMeetingPrep(store, {
          topic: url.searchParams.get("topic"),
          attendees: attendeesParam ? attendeesParam.split(",").map((s) => s.trim()).filter(Boolean) : []
        }));
        return;
      }

      if (req.method === "POST" && url.pathname === "/meeting/ingest") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        sendJson(res, 201, ingestMeeting(store, deriveFromEvent, input));
        return;
      }

      if (req.method === "GET" && url.pathname === "/meeting/minutes") {
        const id = url.searchParams.get("id");
        if (!id) {
          sendJson(res, 400, { ok: false, error: "GET /meeting/minutes requires ?id=" });
          return;
        }
        sendJson(res, 200, getMeetingMinutes(store, id));
        return;
      }

      if (req.method === "GET" && url.pathname === "/audit") {
        sendJson(res, 200, {
          ok: true,
          audit: store.listAudit({ limit: Number(url.searchParams.get("limit") || 50) })
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/focus/start") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        sendJson(res, 201, startFocusSession(store, input));
        return;
      }

      if (req.method === "GET" && url.pathname === "/focus/current") {
        sendJson(res, 200, currentFocusSession(store));
        return;
      }

      if (req.method === "POST" && url.pathname === "/focus/complete") {
        const input = await readJsonBody(req, config.maxBodyBytes);
        sendJson(res, 200, completeFocusSession(store, input));
        return;
      }

      if (req.method === "GET" && url.pathname === "/focus/sessions") {
        sendJson(res, 200, listFocusSessions(store));
        return;
      }

      if (req.method === "GET" && url.pathname === "/memory") {
        const kind = url.searchParams.get("kind");
        sendJson(res, 200, {
          ok: true,
          memory: store.listMemory({ kind, limit: Number(url.searchParams.get("limit") || 100) })
        });
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: "Not found",
        endpoints: [
          "GET /health",
          "POST /events",
          "POST /connectors/microsoft/sync",
          "GET /events",
          "DELETE /events",
          "DELETE /commitments",
          "DELETE /lessons",
          "DELETE /memory",
          "GET /resume",
          "GET /triage",
          "GET /commitments",
          "GET /recall",
          "GET /plan",
          "GET /briefing",
          "GET /todos",
          "POST /todos/add",
          "POST /todos/check",
          "POST /todos/move",
          "POST /todos/reschedule",
          "POST /todos/remove",
          "POST /todos/rollover",
          "POST /todos/sync",
          "GET /meeting/prep",
          "POST /meeting/ingest",
          "GET /meeting/minutes",
          "GET /audit",
          "POST /focus/start",
          "GET /focus/current",
          "POST /focus/complete",
          "GET /focus/sessions",
          "GET /memory"
        ]
      });
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(res, statusCode, {
        ok: false,
        error: statusCode === 500 ? "Internal server error" : error.message
      });
      if (statusCode === 500) {
        logger.error("unhandled request error", { reqId, path: url.pathname, error: error.message, stack: error.stack });
      }
    }
  });
}
