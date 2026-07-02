import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTodoMarkdown, serializeTodoMarkdown, todoView,
  addTask, setChecked, rollover, syncInbox, moveTask, rescheduleTask, removeTask
} from "../src/todos.js";

const SAMPLE = `# My TODO

> note: ship the retry fix

## Inbox

## Today
- [ ] Review Maya PR
- [x] Reply to Priya
free text under today

## Next Actions
- [ ] Refactor retryPolicy

## Custom Section
keep me exactly

## Done
`;

test("parse → serialize is lossless (no user content is mangled)", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  assert.equal(serializeTodoMarkdown(doc), SAMPLE);
});

test("addTask inserts at the top of Today without touching other lines", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  addTask(doc, "URGENT incident");
  const out = serializeTodoMarkdown(doc);
  assert.match(out, /## Today\n- \[ \] URGENT incident\n- \[ \] Review Maya PR/);
  assert.ok(out.includes("## Custom Section\nkeep me exactly"), "custom section preserved");
});

test("setChecked toggles only the matching task in the section", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  setChecked(doc, "Review Maya PR", true);
  assert.match(serializeTodoMarkdown(doc), /- \[x\] Review Maya PR/);
});

test("rollover keeps unchecked Today items and moves checked ones to Done", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  const r = rollover(doc);
  const out = serializeTodoMarkdown(doc);
  assert.equal(r.archived, 1);
  assert.match(out, /## Today\n- \[ \] Review Maya PR/, "unchecked stays in Today");
  assert.match(out, /## Done\n- \[x\] Reply to Priya/, "checked moved to Done");
  assert.ok(out.includes("free text under today"), "user free text preserved");
});

test("syncInbox captures into the Inbox, idempotent, never re-adds clarified items", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  const commits = [
    { what: "review the deploy PR", who: "Sam", direction: "owed_by_me", status: "proposed", due: "2026-07-03" },
    { what: "send the numbers", who: "me", direction: "owed_to_me", status: "proposed" },
    { what: "this is dismissed", who: "x", direction: "owed_by_me", status: "dismissed" }
  ];
  syncInbox(doc, commits);
  const firstAdded = doc._inboxAdded;
  syncInbox(doc, commits); // twice — must not duplicate
  const out = serializeTodoMarkdown(doc);

  assert.equal(firstAdded, 2, "two non-dismissed commitments captured");
  assert.equal(doc._inboxAdded, 0, "second sync adds nothing (idempotent)");
  assert.ok(out.includes("review the deploy PR (@Sam) [due 2026-07-03]"));
  assert.ok(out.includes("waiting: send the numbers"), "owed_to_me framed as waiting");
  assert.ok(!out.includes("this is dismissed"), "dismissed commitments are excluded");
  // Captured items land in Inbox, not in the user's Today section.
  const todayBlock = out.split("## Next Actions")[0].split("## Today")[1];
  assert.ok(!todayBlock.includes("review the deploy PR"), "captures never injected into Today");
});

test("syncInbox does not re-capture a commitment already clarified into Today", () => {
  // User already moved "review the deploy PR" into Today themselves.
  const doc = parseTodoMarkdown("## Inbox\n\n## Today\n- [ ] review the deploy PR\n\n## Done\n");
  syncInbox(doc, [{ what: "review the deploy PR", who: "me", direction: "owed_by_me", status: "proposed" }]);
  assert.equal(doc._inboxAdded, 0, "already-clarified item is not re-added to Inbox");
});

test("todoView reports GTD counts and top items", () => {
  const view = todoView(parseTodoMarkdown(SAMPLE));
  assert.equal(view.open_today, 1); // Maya PR open, Priya checked
  assert.equal(view.open_next, 1);  // ## Next Actions
  assert.equal(view.inbox, 0);
  assert.deepEqual(view.top_today, ["Review Maya PR"]);
});

test("moveTask moves an item between lists, preserving checked state", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  setChecked(doc, "Review Maya PR", false); // ensure unchecked
  moveTask(doc, "Review Maya PR", "Today", "Someday");
  const out = serializeTodoMarkdown(doc);
  assert.match(out, /## Someday\n- \[ \] Review Maya PR/);
  assert.ok(!out.split("## Next Actions")[0].includes("Review Maya PR"), "removed from Today");
});

test("rescheduleTask tomorrow -> Next Actions, someday -> Someday", () => {
  let doc = parseTodoMarkdown(SAMPLE);
  rescheduleTask(doc, "Review Maya PR", "tomorrow");
  assert.match(serializeTodoMarkdown(doc), /## Next Actions\n- \[ \] Review Maya PR/);

  doc = parseTodoMarkdown(SAMPLE);
  rescheduleTask(doc, "Review Maya PR", "someday");
  assert.match(serializeTodoMarkdown(doc), /## Someday\n- \[ \] Review Maya PR/);
});

test("removeTask deletes only the named item and nothing else", () => {
  const doc = parseTodoMarkdown(SAMPLE);
  removeTask(doc, "Review Maya PR", "Today");
  const out = serializeTodoMarkdown(doc);
  assert.ok(!out.includes("Review Maya PR"));
  assert.ok(out.includes("Refactor retryPolicy"), "other items untouched");
  assert.ok(out.includes("## Custom Section\nkeep me exactly"), "custom section preserved");
});

test("rollover on an empty/no-Today file is a safe no-op", () => {
  const doc = parseTodoMarkdown("# Empty\n\n## Next\n- [ ] something\n");
  const r = rollover(doc);
  assert.equal(r.rolled, 0);
  assert.equal(r.archived, 0);
});
