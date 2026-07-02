import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCipher } from "../src/server.js";
import { TimelineStore } from "../src/store.js";
import { FieldCipher } from "../src/crypto.js";
import { normalizeWorkContextEvent } from "../src/domain.js";

function tmpDb(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, dbPath: join(dir, "t.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// In-memory secret store so tests never touch the real OS keychain.
function memSecrets() {
  const mem = {};
  return { readSecret: (k) => mem[k] || null, storeSecret: (k, v) => { mem[k] = v; return true; } };
}

test("encryption survives API token rotation (key is decoupled from token)", () => {
  const { dbPath, cleanup } = tmpDb("sk-rot-");
  const secrets = memSecrets();
  try {
    const c1 = buildCipher({ encryptionEnabled: true, dbPath, token: "token-AAA" }, secrets);
    const enc = c1.encrypt("Maya owes me the PR review");
    // Same DB, different API token — the dedicated DEK is unchanged, so it still decrypts.
    const c2 = buildCipher({ encryptionEnabled: true, dbPath, token: "token-BBB-rotated" }, secrets);
    assert.equal(c2.decrypt(enc), "Maya owes me the PR review");
  } finally {
    cleanup();
  }
});

test("canary fails fast on a key/salt mismatch instead of per-request 500s", () => {
  const { dbPath, cleanup } = tmpDb("sk-can-");
  try {
    buildCipher({ encryptionEnabled: true, dbPath, token: "t" }, memSecrets()); // writes canary
    assert.ok(existsSync(dbPath + ".canary"));
    // A different (empty) secret store => different DEK => canary must reject.
    assert.throws(
      () => buildCipher({ encryptionEnabled: true, dbPath, token: "t" }, memSecrets()),
      /does not match this database/
    );
  } finally {
    cleanup();
  }
});

test("transaction rolls back a partial write on failure", () => {
  const { dbPath, cleanup } = tmpDb("sk-tx-");
  const store = new TimelineStore(dbPath);
  try {
    const event = normalizeWorkContextEvent({ source: "slack", kind: "message", ref: { thread: "C1" }, summary: "hello", project: "p", confidence: 0.9, origin: "work" });
    assert.throws(() => {
      store.transaction(() => {
        store.appendEvent(event);
        throw new Error("boom mid-unit");
      });
    }, /boom/);
    // The event insert must have been rolled back — no orphaned row.
    assert.equal(store.listEvents({ limit: 10 }).length, 0);
  } finally {
    store.close();
    cleanup();
  }
});

test("transaction commits a successful unit", () => {
  const { dbPath, cleanup } = tmpDb("sk-tx2-");
  const store = new TimelineStore(dbPath);
  try {
    const event = normalizeWorkContextEvent({ source: "slack", kind: "message", ref: { thread: "C1" }, summary: "ok", project: "p", confidence: 0.9, origin: "work" });
    store.transaction(() => store.appendEvent(event));
    assert.equal(store.listEvents({ limit: 10 }).length, 1);
  } finally {
    store.close();
    cleanup();
  }
});

test("healthCheck reports ok on a working store and detects a closed db", () => {
  const { dbPath, cleanup } = tmpDb("sk-hc-");
  const store = new TimelineStore(dbPath);
  try {
    assert.equal(store.healthCheck().ok, true);
    store.close();
    const broken = store.healthCheck();
    assert.equal(broken.ok, false);
    assert.match(broken.detail, /database unreachable/);
  } finally {
    cleanup();
  }
});
