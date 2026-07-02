import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectorPoller } from "../src/poller.js";
import { TimelineStore } from "../src/store.js";
import { deriveFromEvent } from "../src/derive.js";
import { getCommitments } from "../src/capabilities.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "sk-poll-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("poller is a no-op when no token is stored", async () => {
  const { store, cleanup } = freshStore();
  try {
    const poller = new ConnectorPoller({
      store, deriveFn: deriveFromEvent, intervalMs: 1000, runImmediately: false,
      deps: { readSecret: () => null, syncGitHub: async () => { throw new Error("should not be called"); } }
    });
    const result = await poller.runOnce();
    assert.equal(result.skipped, "no github token");
  } finally {
    cleanup();
  }
});

test("a successful poll imports commitments via the injected sync", async () => {
  const { store, cleanup } = freshStore();
  try {
    const fakeFetch = async (url) => {
      const body = url.includes("review-requested")
        ? { items: [{ title: "Review me", number: 7, html_url: "https://github.com/acme/payments/pull/7", user: { login: "dana" }, updated_at: "2026-06-29T10:00:00Z" }] }
        : url.includes("assignee") ? { items: [] } : { login: "me" };
      return { ok: true, json: async () => body };
    };
    const poller = new ConnectorPoller({
      store, deriveFn: deriveFromEvent, intervalMs: 1000, runImmediately: false,
      deps: { readSecret: () => "ghp_token", fetch: fakeFetch }
    });
    const result = await poller.runOnce();
    assert.equal(result.imported, 1);
    assert.ok(getCommitments(store).commitments.some((c) => c.what.includes("Review requested by dana")));
  } finally {
    cleanup();
  }
});

test("a poll failure never throws — it is captured", async () => {
  const { store, cleanup } = freshStore();
  try {
    const poller = new ConnectorPoller({
      store, deriveFn: deriveFromEvent, intervalMs: 1000, runImmediately: false,
      deps: { readSecret: () => "ghp_token", syncGitHub: async () => { throw new Error("network down"); } }
    });
    const result = await poller.runOnce();
    assert.match(result.error, /network down/);
  } finally {
    cleanup();
  }
});

test("overlapping runs are skipped", async () => {
  const { store, cleanup } = freshStore();
  try {
    let inflight = 0;
    let maxConcurrent = 0;
    const slowSync = async () => {
      inflight += 1;
      maxConcurrent = Math.max(maxConcurrent, inflight);
      await new Promise((r) => setTimeout(r, 30));
      inflight -= 1;
      return { imported: 0, errors: [] };
    };
    const poller = new ConnectorPoller({
      store, deriveFn: deriveFromEvent, intervalMs: 1000, runImmediately: false,
      deps: { readSecret: () => "ghp_token", syncGitHub: slowSync }
    });
    const [a, b] = await Promise.all([poller.runOnce(), poller.runOnce()]);
    assert.equal(maxConcurrent, 1, "syncs must not overlap");
    assert.ok([a, b].some((r) => r.skipped === "already running"));
  } finally {
    cleanup();
  }
});

test("disabled poller (interval 0) does not schedule", () => {
  const { store, cleanup } = freshStore();
  try {
    const poller = new ConnectorPoller({ store, deriveFn: deriveFromEvent, intervalMs: 0 });
    poller.start();
    assert.equal(poller.timer, null);
    poller.stop();
  } finally {
    cleanup();
  }
});
