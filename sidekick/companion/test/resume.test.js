import test from "node:test";
import assert from "node:assert/strict";
import { buildResume } from "../src/resume.js";

const base = {
  source: "editor",
  kind: "edited_file",
  ref: { file: "src/a.ts" },
  project: "payments",
  confidence: 0.98,
  origin: "work"
};

test("buildResume returns latest context when no gap is detected", () => {
  const resume = buildResume(
    [
      { ...base, id: "2", ts: "2026-06-28T10:05:00Z", summary: "Edited b" },
      { ...base, id: "1", ts: "2026-06-28T10:00:00Z", summary: "Edited a" }
    ],
    { resumeLimit: 5, gapMinutes: 30 }
  );

  assert.equal(resume.capability, "Resume");
  assert.equal(resume.gap, null);
  assert.equal(resume.lastState.id, "2");
  assert.equal(resume.resumeEvents.length, 2);
  assert.ok(resume.provenance.length > 0);
});

test("buildResume finds most recent interruption gap", () => {
  const resume = buildResume(
    [
      { ...base, id: "4", ts: "2026-06-28T11:20:00Z", summary: "After meeting" },
      { ...base, id: "3", ts: "2026-06-28T11:15:00Z", summary: "Back from meeting" },
      { ...base, id: "2", ts: "2026-06-28T10:00:00Z", summary: "Check retry tests" },
      { ...base, id: "1", ts: "2026-06-28T09:50:00Z", summary: "Review PR 412" }
    ],
    { resumeLimit: 5, gapMinutes: 30 }
  );

  assert.deepEqual(resume.gap, {
    from: "2026-06-28T10:00:00Z",
    to: "2026-06-28T11:15:00Z",
    minutes: 75
  });
  assert.deepEqual(
    resume.resumeEvents.map((event) => event.id),
    ["1", "2"]
  );
  assert.match(resume.nextSteps[0], /Re-open/);
});
