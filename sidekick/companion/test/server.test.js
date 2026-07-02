import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "../src/server.js";
import { TimelineStore } from "../src/store.js";
import { FieldCipher } from "../src/crypto.js";
import { RateLimiter } from "../src/rateLimit.js";

const TOKEN = "test-token-abcdefghij";
let server;
let store;
let baseUrl;
let dbDir;
let dbPath;

const config = {
  token: TOKEN,
  maxBodyBytes: 1_000_000,
  resumeLimit: 8,
  gapMinutes: 30,
  encryptionEnabled: true,
  dbPath: ""
};

before(async () => {
  dbDir = mkdtempSync(join(tmpdir(), "sk-http-"));
  dbPath = join(dbDir, "test.sqlite");
  config.dbPath = dbPath;
  const cipher = new FieldCipher(FieldCipher.deriveKey(TOKEN, randomBytes(16)));
  store = new TimelineStore(dbPath, cipher);
  // generous rate limit so functional tests never trip it
  server = createServer({ config, store, rateLimiter: new RateLimiter({ windowMs: 10_000, maxRequests: 10_000 }) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
  store.close();
  rmSync(dbDir, { recursive: true, force: true });
});

function authed(path, options = {}) {
  return fetch(baseUrl + path, {
    ...options,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(options.headers || {}) }
  });
}

test("GET /health is public and reports encryption", async () => {
  const res = await fetch(baseUrl + "/health");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.encryption, "aes-256-gcm");
});

test("health probes the DB and returns 200 when healthy", async () => {
  const res = await fetch(baseUrl + "/health");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("security headers are present", async () => {
  const res = await fetch(baseUrl + "/health");
  assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
});

test("console-token requires the guard header AND same-origin; otherwise 403", async () => {
  // With the guard header (what the console sends) -> token.
  const ok = await fetch(baseUrl + "/console-token", { headers: { "x-sidekick-console": "1" } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).token, TOKEN);

  // Missing the guard header (a cross-origin no-CORS load can't set it) -> blocked.
  const noHeader = await fetch(baseUrl + "/console-token");
  assert.equal(noHeader.status, 403);

  // Cross-site even with header -> blocked.
  const crossSite = await fetch(baseUrl + "/console-token", { headers: { "x-sidekick-console": "1", "sec-fetch-site": "cross-site" } });
  assert.equal(crossSite.status, 403);
});

test("dashboard sets a strict nonce-based script CSP (no unsafe-inline scripts)", async () => {
  const res = await fetch(baseUrl + "/");
  const csp = res.headers.get("content-security-policy") || "";
  assert.match(csp, /script-src 'nonce-/);
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), "scripts must not allow unsafe-inline");
});

test("data endpoints reject a missing token", async () => {
  const res = await fetch(baseUrl + "/resume");
  assert.equal(res.status, 401);
});

test("data endpoints reject a wrong token", async () => {
  const res = await fetch(baseUrl + "/resume", { headers: { authorization: "Bearer nope" } });
  assert.equal(res.status, 401);
});

test("POST /events then GET round-trips with the real summary (decrypted)", async () => {
  const post = await authed("/events", {
    method: "POST",
    body: JSON.stringify({
      source: "slack",
      kind: "message",
      ref: { thread: "C1" },
      summary: "Maya asked: review the retry PR by Friday",
      project: "payments",
      confidence: 0.9,
      origin: "work"
    })
  });
  assert.equal(post.status, 201);

  const get = await authed("/events?limit=5");
  const body = await get.json();
  assert.equal(body.ok, true);
  assert.ok(body.events.some((e) => e.summary.includes("Maya asked")), "summary should decrypt on read");
});

test("the summary is NOT stored as plaintext on disk", () => {
  const raw = readFileSync(dbPath);
  assert.equal(raw.includes("Maya asked"), false, "plaintext must not appear in the DB file");
});

test("invalid JSON body returns 400", async () => {
  const res = await authed("/events", { method: "POST", body: "{not json" });
  assert.equal(res.status, 400);
});

test("unknown route returns 404 with endpoint listing", async () => {
  const res = await authed("/nope");
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.ok(Array.isArray(body.endpoints));
});

test("GitHub connector: token save, status, and sync-without-token are wired", async () => {
  // No token yet -> not connected, and sync is refused with guidance.
  const before = await (await authed("/connectors/github/status")).json();
  assert.equal(typeof before.connected, "boolean");

  const noToken = await authed("/connectors/github/sync", { method: "POST", body: JSON.stringify({}) });
  // Either 400 (no token anywhere) or 207 (a token was previously stored on this machine).
  assert.ok([400, 207, 200].includes(noToken.status));

  const shortToken = await authed("/connectors/github/token", { method: "POST", body: JSON.stringify({ token: "x" }) });
  assert.equal(shortToken.status, 400);
});

test("POST /commitments/status validates input and dismisses", async () => {
  // Seed a commitment-bearing event.
  await authed("/events", {
    method: "POST",
    body: JSON.stringify({
      source: "slack", kind: "message", ref: { thread: "C9" },
      summary: "Can you sign off on the release by Friday?", project: "payments", confidence: 0.9, origin: "work"
    })
  });
  const before = await (await authed("/commitments")).json();
  const target = before.commitments.find((c) => c.what.includes("sign off"));
  assert.ok(target, "expected a derived commitment");

  const bad = await authed("/commitments/status", { method: "POST", body: JSON.stringify({ id: target.id, status: "bogus" }) });
  assert.equal(bad.status, 400);

  const ok = await authed("/commitments/status", { method: "POST", body: JSON.stringify({ id: target.id, status: "dismissed" }) });
  assert.equal(ok.status, 200);

  const after = await (await authed("/commitments")).json();
  assert.equal(after.commitments.some((c) => c.id === target.id), false, "dismissed commitment must not surface");
});

test("rate limiter returns 429 once the cap is exceeded", async () => {
  const tightStore = store;
  const tightServer = createServer({
    config,
    store: tightStore,
    rateLimiter: new RateLimiter({ windowMs: 10_000, maxRequests: 2 })
  });
  await new Promise((resolve) => tightServer.listen(0, "127.0.0.1", resolve));
  const { port } = tightServer.address();
  // /health is intentionally exempt from rate limiting; hit an authed route instead.
  const url = `http://127.0.0.1:${port}/resume`;
  const statuses = [];
  for (let i = 0; i < 4; i++) {
    statuses.push((await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } })).status);
  }
  tightServer.close();
  assert.ok(statuses.includes(429), `expected a 429 in ${statuses}`);
});
