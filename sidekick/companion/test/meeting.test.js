import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TimelineStore } from "../src/store.js";
import { deriveFromEvent } from "../src/derive.js";
import { normalizeWorkContextEvent } from "../src/domain.js";
import { getCommitments } from "../src/capabilities.js";
import { buildBriefing, buildMeetingPrep } from "../src/briefing.js";
import { extractDecisions, extractActionItems, ingestMeeting, getMeetingMinutes } from "../src/meeting.js";

const CONFIG = { resumeLimit: 8, gapMinutes: 30 };

function freshStore() {
  const dir = mkdtempSync(join(tmpdir(), "sk-meet-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  return { store, cleanup: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}
function add(store, ev) {
  const event = normalizeWorkContextEvent(ev);
  store.appendEvent(event);
  return deriveFromEvent(store, event);
}

test("briefing composes resume + triage + commitments into plain lines", () => {
  const { store, cleanup } = freshStore();
  try {
    add(store, { source: "editor", kind: "edited_file", ref: { file: "retryPolicy.ts" }, summary: "Editing retryPolicy.ts", project: "payments", confidence: 0.98, origin: "work" });
    add(store, { source: "slack", kind: "message", ref: { thread: "C1" }, summary: "Can you review the checkout PR by Friday?", project: "payments", confidence: 0.9, origin: "work" });

    const briefing = buildBriefing(store, CONFIG);
    assert.equal(briefing.capability, "Briefing");
    assert.ok(briefing.headline.length > 0);
    assert.ok(briefing.lines.length >= 2, "should have a greeting plus at least one real line");
    assert.ok(briefing.digest.owed_by_me.length >= 1, "the PR review should appear as owed by me");
    assert.ok(typeof briefing.llmPrompt === "string", "exposes an optional LLM seam");
  } finally {
    cleanup();
  }
});

test("extractDecisions and extractActionItems parse meeting text", () => {
  const text = [
    "We decided to ship the retry fix this week.",
    "Action: Maya will update the runbook.",
    "I will send the rollout summary tomorrow.",
    "Random chatter that is not an action."
  ].join("\n");
  const decisions = extractDecisions(text);
  const actions = extractActionItems(text);
  assert.ok(decisions.some((d) => /ship the retry fix/i.test(d)));
  assert.ok(actions.some((a) => a.who === "Maya"));
  assert.ok(actions.some((a) => a.who === "me"));
});

test("ingestMeeting turns action items into tracked commitments with provenance", () => {
  const { store, cleanup } = freshStore();
  try {
    const result = ingestMeeting(store, deriveFromEvent, {
      title: "Payments rollout sync",
      attendees: ["Maya", "Priya"],
      notes: "We agreed to go with the staged rollout.\nAction: Maya will prep the dashboard.\nI will write the risk summary by Monday.",
      project: "payments"
    });

    assert.equal(result.ok, true);
    assert.ok(result.decisions.length >= 1);
    assert.ok(result.action_items.length >= 2);
    assert.ok(result.commitments.length >= 2, "action items should derive commitments");

    // The commitments are real, tracked, and carry meeting provenance.
    const tracked = getCommitments(store).commitments;
    const fromMeeting = tracked.filter((c) => c.provenance_ref?.meeting === result.meetingId);
    assert.ok(fromMeeting.length >= 2);
    assert.ok(fromMeeting.some((c) => c.who === "Maya"));
  } finally {
    cleanup();
  }
});

test("getMeetingMinutes reads back a previously ingested meeting", () => {
  const { store, cleanup } = freshStore();
  try {
    const { meetingId } = ingestMeeting(store, deriveFromEvent, {
      title: "Incident review",
      notes: "Decision: we will add idempotency keys.\nAction: Sam will add a regression test."
    });
    const minutes = getMeetingMinutes(store, meetingId);
    assert.equal(minutes.found, true);
    assert.ok(minutes.action_items.length >= 1);
  } finally {
    cleanup();
  }
});

test("meeting prep pulls relevant commitments by attendee/topic", () => {
  const { store, cleanup } = freshStore();
  try {
    add(store, { source: "slack", kind: "message", ref: { thread: "C1" }, summary: "Can you review the payments retry PR by Friday?", project: "payments", confidence: 0.9, origin: "work" });
    const prep = buildMeetingPrep(store, { topic: "payments", attendees: [] });
    assert.equal(prep.capability, "MeetingPrep");
    assert.ok(prep.relevant_commitments.length >= 1, "should surface the payments commitment");
    assert.ok(prep.headline.length > 0);
  } finally {
    cleanup();
  }
});
