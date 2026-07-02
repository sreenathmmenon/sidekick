import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TimelineStore } from "../src/store.js";
import { normalizeWorkContextEvent } from "../src/domain.js";
import { deriveFromEvent } from "../src/derive.js";

test("TimelineStore appends, lists, and logically deletes events", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-store-"));
  const store = new TimelineStore(join(dir, "test.sqlite"));

  try {
    const event = normalizeWorkContextEvent({
      ts: "2026-06-28T10:00:00Z",
      source: "editor",
      kind: "edited_file",
      ref: { file: "src/a.ts" },
      summary: "Edited a",
      project: "payments",
      confidence: 0.9,
      origin: "work"
    });

    store.appendEvent(event);
    assert.equal(store.listEvents().length, 1);
    assert.equal(store.recentEvents(10)[0].id, event.id);

    const deleted = store.deleteEventsBySource("editor");
    assert.equal(deleted, 1);
    assert.equal(store.listEvents().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("TimelineStore cascades deletes to derived records", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-store-"));
  const store = new TimelineStore(join(dir, "test.sqlite"));

  try {
    const event = normalizeWorkContextEvent({
      ts: "2026-06-28T10:00:00Z",
      source: "slack",
      kind: "message",
      ref: { thread: "C123:1782547000" },
      summary: "Maya asked: can you review the checkout retry PR by Friday?",
      project: "payments",
      confidence: 0.92,
      origin: "work"
    });

    store.appendEvent(event);
    deriveFromEvent(store, event);
    assert.equal(store.listCommitments().length, 1);

    const deleted = store.deleteEventsBySource("slack");
    assert.equal(deleted, 1);
    assert.equal(store.listEvents().length, 0);
    assert.equal(store.listCommitments().length, 0);
    assert.equal(store.listLessons().length, 0);
    assert.equal(store.listMemory().length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
