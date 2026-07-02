import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimelineStore } from "../src/store.js";
import { deriveFromEvent } from "../src/derive.js";
import { normalizeWorkContextEvent } from "../src/domain.js";
import { getCommitments } from "../src/capabilities.js";

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "sk-derive-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function derive(store, summary, source = "slack", kind = "message") {
  const event = normalizeWorkContextEvent({ source, kind, ref: { thread: "x" }, summary, project: "payments", confidence: 0.9, origin: "work" });
  store.appendEvent(event);
  return { event, derived: deriveFromEvent(store, event) };
}

test("bare time/FYI words do not manufacture commitments", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(derive(store, "Reminder: all-hands is today").derived.commitments.length, 0);
    assert.equal(derive(store, "Please ignore my last message").derived.commitments.length, 0);
    assert.equal(derive(store, "Just FYI, the deploy went out tomorrow").derived.commitments.length, 0);
  } finally {
    cleanup();
  }
});

test("hardened floor rejects rhetorical/non-actionable phrasing (council false positives)", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(derive(store, "I will be out of office tomorrow").derived.commitments.length, 0);
    assert.equal(derive(store, "Could you believe that outage?").derived.commitments.length, 0);
    assert.equal(derive(store, "Thanks, I will remember that").derived.commitments.length, 0);
    assert.equal(derive(store, "We could review it someday maybe").derived.commitments.length, 0);
    // ...without hurting recall on real obligations:
    assert.equal(derive(store, "Can you review the PR by Friday?").derived.commitments.length, 1);
    assert.equal(derive(store, "I will send the summary tomorrow").derived.commitments.length, 1);
  } finally {
    cleanup();
  }
});

test("regex commitments are inspectable (extractor + match_reason)", () => {
  const { store, cleanup } = freshStore();
  try {
    const c = derive(store, "Can you review the PR by Friday?").derived.commitments[0];
    assert.equal(c.extractor, "regex");
    assert.ok(c.match_reason, "should record why it fired");
  } finally {
    cleanup();
  }
});

test("real requests and promises are detected", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(derive(store, "Can you review the checkout retry PR by Friday?").derived.commitments.length, 1);
    assert.equal(derive(store, "I will send the rollout risk summary tomorrow").derived.commitments.length, 1);
  } finally {
    cleanup();
  }
});

test("direction is detected symmetrically (the architect's failing case)", () => {
  const { store, cleanup } = freshStore();
  try {
    assert.equal(derive(store, "Can you review the PR by Friday?").derived.commitments[0].direction, "owed_by_me");
    assert.equal(derive(store, "I will send the summary tomorrow").derived.commitments[0].direction, "owed_by_me");
    // Previously MISSED entirely — now correctly "owed to me".
    assert.equal(derive(store, "Blocked by infra, they will fix it Monday").derived.commitments[0].direction, "owed_to_me");
    assert.equal(derive(store, "Priya will send the numbers").derived.commitments[0].direction, "owed_to_me");
  } finally {
    cleanup();
  }
});

test("editor/browser-as-github sources feed commitments; plain browser does not", () => {
  const { store, cleanup } = freshStore();
  try {
    // A PR captured from the browser arrives as source "github" -> can become a commitment.
    assert.equal(derive(store, "Can you take a look at this PR today?", "github", "reviewing_pr").derived.commitments.length, 1);
    // A generic read page stays source "browser" -> never a commitment.
    assert.equal(derive(store, "Can you read this blog by Friday?", "browser", "read_doc").derived.commitments.length, 0);
  } finally {
    cleanup();
  }
});

test("dismiss survives re-derivation and hides the commitment everywhere", () => {
  const { store, cleanup } = freshStore();
  try {
    const { event, derived } = derive(store, "Can you review the deploy by Monday?");
    const id = derived.commitments[0].id;

    store.setCommitmentStatus(id, "dismissed");
    // Re-derive the SAME event — must not resurrect it back to "proposed".
    deriveFromEvent(store, event);

    const row = store.listCommitments({ limit: 50 }).find((c) => c.id === id);
    assert.equal(row.status, "dismissed");
    assert.equal(getCommitments(store).commitments.some((c) => c.id === id), false);
  } finally {
    cleanup();
  }
});

test("confirm survives re-derivation", () => {
  const { store, cleanup } = freshStore();
  try {
    const { event, derived } = derive(store, "I will prepare the migration plan tomorrow", "mail", "message");
    const id = derived.commitments[0].id;
    store.setCommitmentStatus(id, "confirmed");
    deriveFromEvent(store, event);
    const row = store.listCommitments({ limit: 50 }).find((c) => c.id === id);
    assert.equal(row.status, "confirmed");
  } finally {
    cleanup();
  }
});
