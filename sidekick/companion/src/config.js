import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { loadOrCreateToken as keychainToken } from "./secrets.js";
import { logger } from "./logger.js";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
    this.statusCode = 500;
  }
}

// Parses an integer env var with validation. Throws ConfigError on a non-numeric
// or out-of-range value instead of silently producing NaN.
function intEnv(env, key, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new ConfigError(`${key} must be an integer, got "${raw}"`);
  }
  if (value < min || value > max) {
    throw new ConfigError(`${key} must be between ${min} and ${max}, got ${value}`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  const dataDir = resolve(env.SIDEKICK_DATA_DIR || join(homedir(), ".sidekick"));
  mkdirSync(dataDir, { recursive: true });
  // Lock down the data directory: it holds the timeline DB and token material.
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    // best-effort on platforms without POSIX modes
  }

  const dbPath = resolve(env.SIDEKICK_DB || join(dataDir, "sidekick.sqlite"));
  mkdirSync(dirname(dbPath), { recursive: true });

  const host = env.SIDEKICK_HOST || "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost") {
    logger.warn("companion bound to non-loopback host; token now travels the network in clear HTTP", { host });
  }

  return {
    host,
    port: intEnv(env, "SIDEKICK_PORT", 4317, { min: 1, max: 65535 }),
    dbPath,
    dataDir,
    token: resolveToken(env, dataDir),
    encryptionEnabled: env.SIDEKICK_ENCRYPT !== "false", // on by default; opt out for plaintext debugging
    resumeLimit: intEnv(env, "SIDEKICK_RESUME_LIMIT", 8, { min: 1, max: 200 }),
    gapMinutes: intEnv(env, "SIDEKICK_GAP_MINUTES", 30, { min: 1, max: 1440 }),
    maxBodyBytes: intEnv(env, "SIDEKICK_MAX_BODY_BYTES", 1_000_000, { min: 1024, max: 50_000_000 }),
    rateLimit: {
      windowMs: intEnv(env, "SIDEKICK_RATE_WINDOW_MS", 10_000, { min: 1000, max: 600_000 }),
      maxRequests: intEnv(env, "SIDEKICK_RATE_MAX", 240, { min: 10, max: 100_000 })
    },
    // Background connector polling. Default 5 min; set to 0 to disable (sync-on-click only).
    pollIntervalMs: intEnv(env, "SIDEKICK_POLL_INTERVAL_MS", 300_000, { min: 0, max: 86_400_000 }),
    // AI extraction (optional accelerator). FAIL-CLOSED on egress by design:
    //   - default mode "auto" resolves to local-or-regex ONLY; it NEVER selects cloud.
    //   - cloud requires an EXPLICIT mode "cloud" — a stray ANTHROPIC_API_KEY in the
    //     environment can never trigger an outbound request on its own.
    // This is the regulated/privacy persona's hard requirement: no accidental egress.
    llm: resolveLlmConfig(env)
  };
}

function resolveLlmConfig(env) {
  const rawMode = String(env.SIDEKICK_LLM_MODE || "auto").toLowerCase();
  const mode = ["auto", "off", "regex", "local", "cloud"].includes(rawMode) ? rawMode : "auto";
  return {
    mode,
    apiKey: env.SIDEKICK_LLM_API_KEY || env.ANTHROPIC_API_KEY || null,
    model: env.SIDEKICK_LLM_MODEL || null,
    localUrl: env.SIDEKICK_LLM_LOCAL_URL || null,
    // Sources whose text is too sensitive to ever send to a cloud LLM. Cloud
    // extraction is skipped for these even when mode is explicitly "cloud".
    cloudBlockedSources: (env.SIDEKICK_LLM_CLOUD_BLOCK || "meeting,teams,mail").split(",").map((s) => s.trim()).filter(Boolean)
  };
}

function resolveToken(env, dataDir) {
  if (env.SIDEKICK_TOKEN) {
    if (env.SIDEKICK_TOKEN.length < 16) {
      throw new ConfigError("SIDEKICK_TOKEN must be at least 16 characters");
    }
    return env.SIDEKICK_TOKEN;
  }
  // Prefer OS keychain; fall back to a 0600 file under the data dir.
  return keychainToken(dataDir, () => randomBytes(32).toString("base64url"), { logger, readFileSync, writeFileSync });
}
