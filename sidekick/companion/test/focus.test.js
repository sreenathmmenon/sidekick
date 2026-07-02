import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startFocusSession, currentFocusSession, completeFocusSession, listFocusSessions } from "../src/focus.js";
import { TimelineStore } from "../src/store.js";

test("focus session starts, reports current state, and completes with summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "sidekick-focus-"));
  const store = new TimelineStore(join(dir, "test.sqlite"));

  try {
    const started = startFocusSession(store, {
      focus: "Review checkout retry PR",
      duration_minutes: 25,
      attention_mode: "never"
    });

    assert.equal(started.active, true);
    assert.equal(started.attention_policy, "never");
    assert.equal(started.session.focus, "Review checkout retry PR");

    const current = currentFocusSession(store);
    assert.equal(current.active, true);
    assert.ok(current.remaining_seconds > 0);

    const completed = completeFocusSession(store, { status: "completed" });
    assert.equal(completed.active, false);
    assert.equal(completed.session.status, "completed");
    assert.equal(completed.summary.focus, "Review checkout retry PR");

    const sessions = listFocusSessions(store);
    assert.equal(sessions.workflow, "Focus Session");
    assert.equal(sessions.sessions.length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
