import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeWorkContextEvent } from "../src/domain.js";
import { deriveFromEvent } from "../src/derive.js";
import { getCommitments, getPlan, getRecall, getResume, getTriage } from "../src/capabilities.js";
import { TimelineStore } from "../src/store.js";

test("captured events drive all five capabilities end to end", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-capabilities-"));
  const store = new TimelineStore(join(dir, "test.sqlite"));

  try {
    const events = [
      {
        ts: "2026-06-28T09:00:00Z",
        source: "editor",
        kind: "edited_file",
        ref: { file: "src/capture/retryPolicy.ts" },
        summary: "Learned retry capture must preserve idempotency key.",
        project: "payments",
        confidence: 0.98,
        origin: "work"
      },
      {
        ts: "2026-06-28T09:10:00Z",
        source: "slack",
        kind: "message",
        ref: { thread: "C123:1782547000" },
        summary: "Maya asked: can you review the checkout retry PR by Friday?",
        project: "payments",
        confidence: 0.92,
        origin: "work"
      },
      {
        ts: "2026-06-28T09:20:00Z",
        source: "jira",
        kind: "opened_ticket",
        ref: { ticket: "PAY-1842" },
        summary: "Opened production incident follow up; urgent duplicate capture analysis today.",
        project: "payments",
        confidence: 0.9,
        origin: "work"
      }
    ].map((input) => normalizeWorkContextEvent(input));

    for (const event of events) {
      store.appendEvent(event);
      deriveFromEvent(store, event);
    }

    const config = { resumeLimit: 8, gapMinutes: 30 };
    assert.equal(getResume(store, config).capability, "Resume");

    const triage = getTriage(store);
    assert.equal(triage.capability, "Triage");
    assert.ok(triage.ranked.length >= 2);

    const commitments = getCommitments(store);
    assert.equal(commitments.capability, "Commitments");
    assert.ok(commitments.commitments.length >= 1);
    assert.ok(commitments.commitments.some((item) => item.direction === "owed_by_me"));

    const recall = getRecall(store);
    assert.equal(recall.capability, "Recall");
    assert.ok(recall.lessons.length >= 1);
    assert.ok(recall.memory.length >= 1);

    const searchedRecall = getRecall(store, "retry capture");
    assert.equal(searchedRecall.query, "retry capture");
    assert.ok((searchedRecall.lessons[0]?.score || 0) >= (searchedRecall.lessons.at(-1)?.score || 0));

    const plan = getPlan(store);
    assert.equal(plan.capability, "Plan");
    assert.ok(plan.day_shape.length > 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("opened_file contributes working memory", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-opened-file-"));
  const store = new TimelineStore(join(dir, "test.sqlite"));

  try {
    const event = normalizeWorkContextEvent({
      ts: "2026-06-28T09:00:00Z",
      source: "editor",
      kind: "opened_file",
      ref: { file: "src/capture/retryPolicy.ts" },
      summary: "Opened src/capture/retryPolicy.ts",
      project: "payments",
      confidence: 0.9,
      origin: "work"
    });

    store.appendEvent(event);
    const derived = deriveFromEvent(store, event);
    assert.equal(derived.memory_records.length, 1);
    assert.equal(derived.memory_records[0].kind, "working");
    assert.equal(derived.memory_records[0].topic, "payments");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
