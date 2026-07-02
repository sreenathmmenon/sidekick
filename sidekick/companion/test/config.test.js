import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError } from "../src/config.js";

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "sk-config-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("loadConfig rejects a non-numeric port", () => {
  withTempDir((dir) => {
    assert.throws(
      () => loadConfig({ SIDEKICK_DATA_DIR: dir, SIDEKICK_TOKEN: "a-sufficiently-long-token", SIDEKICK_PORT: "not-a-number" }),
      ConfigError
    );
  });
});

test("loadConfig rejects an out-of-range port", () => {
  withTempDir((dir) => {
    assert.throws(
      () => loadConfig({ SIDEKICK_DATA_DIR: dir, SIDEKICK_TOKEN: "a-sufficiently-long-token", SIDEKICK_PORT: "70000" }),
      ConfigError
    );
  });
});

test("loadConfig rejects a too-short token", () => {
  withTempDir((dir) => {
    assert.throws(() => loadConfig({ SIDEKICK_DATA_DIR: dir, SIDEKICK_TOKEN: "short" }), ConfigError);
  });
});

test("loadConfig accepts valid env and defaults encryption on", () => {
  withTempDir((dir) => {
    const config = loadConfig({ SIDEKICK_DATA_DIR: dir, SIDEKICK_TOKEN: "a-sufficiently-long-token", SIDEKICK_PORT: "5000" });
    assert.equal(config.port, 5000);
    assert.equal(config.encryptionEnabled, true);
    assert.equal(config.token, "a-sufficiently-long-token");
    assert.ok(config.rateLimit.maxRequests > 0);
  });
});
