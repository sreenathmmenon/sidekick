import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// GTD-style todo management in a PLAIN MARKDOWN FILE you own — ~/.sidekick/TODO.md.
//
// Why a file, not the database: this is the local-first principle taken to its end.
// The file is human-readable, editable in any editor, greppable, git-able, and
// syncable with your own tooling. If Sidekick vanishes, your todos are still a
// Markdown file. Zero lock-in — that's a trust feature, not a shortcut. It follows
// the same dotfolder convention every local AI tool uses (~/.claude, ~/.aider, …).
//
// Format: GitHub-flavored task lists under canonical GTD section headers — the same
// vocabulary as Things / GTD, so anyone who's used those tools is immediately at home:
//   ## Inbox / ## Today / ## Next Actions / ## Waiting For / ## Someday / ## Done
//   with  - [ ] / - [x]  items.
//
// The GTD framing makes Sidekick's role precise: it is your CAPTURE step. Auto-caught
// commitments land in the ## Inbox; YOU clarify them into Today / Next Actions / Someday.
//
// Principles honored:
//   - PROPOSE, DON'T ACT: Sidekick only writes the ## Inbox (its Capture lane). It
//     NEVER rewrites or reorders your own clarified lines.
//   - LOSSLESS: parse → serialize round-trips your file unchanged (comments, blank
//     lines, unknown sections, free text all preserved).
//   - INSPECTABLE & REVERSIBLE: it's just a text file; edit or delete it anytime.

const GTD_SECTIONS = ["Inbox", "Today", "Next Actions", "Waiting For", "Someday", "Done"];
const INBOX_SECTION = "Inbox";

export function todoFilePath(env = process.env) {
  const dir = env.SIDEKICK_DATA_DIR || join(homedir(), ".sidekick");
  return env.SIDEKICK_TODO_FILE || join(dir, "TODO.md");
}

// First-run template — a real, usable GTD skeleton so the file is never empty/confusing.
function defaultTemplate() {
  return [
    "# Sidekick TODO",
    "",
    "_GTD-style, in plain Markdown you own. Check items with `- [x]`._",
    "_Sidekick captures commitments into ## Inbox — you clarify them into Today / Next Actions / Someday._",
    "_It rolls over unfinished Today items and never edits your clarified lines._",
    "",
    "## Inbox",
    "",
    "## Today",
    "",
    "## Next Actions",
    "",
    "## Waiting For",
    "",
    "## Someday",
    "",
    "## Done",
    ""
  ].join("\n");
}

export function ensureTodoFile(path) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, defaultTemplate(), { mode: 0o600 });
  }
  return path;
}

// ---- Parsing: lossless line model ----
// We keep the file as an ordered list of lines, each tagged so we can read structure
// (sections, tasks, checked-state) WITHOUT discarding anything on the way back out.
export function parseTodoMarkdown(text) {
  const rawLines = text.split("\n");
  const lines = rawLines.map((raw) => {
    const heading = raw.match(/^(#{1,6})\s+(.*)$/);
    if (heading) return { kind: "heading", level: heading[1].length, title: heading[2].trim(), raw };
    const task = raw.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (task) return { kind: "task", indent: task[1], checked: task[2].toLowerCase() === "x", text: task[3], raw };
    return { kind: "text", raw };
  });
  return { lines };
}

export function serializeTodoMarkdown(doc) {
  return doc.lines.map((l) => l.raw).join("\n");
}

// A structured, read-only view for the UI/API (does not mutate the doc).
export function todoView(doc) {
  const sections = {};
  let current = null;
  for (const line of doc.lines) {
    if (line.kind === "heading" && line.level === 2) {
      current = line.title;
      sections[current] = sections[current] || [];
    } else if (line.kind === "task" && current) {
      sections[current].push({ text: line.text, checked: line.checked });
    }
  }
  const count = (name) => (sections[name] || []).filter((t) => !t.checked).length;
  return {
    sections,
    inbox: count("Inbox"),
    open_today: count("Today"),
    open_next: count("Next Actions"),
    waiting: count("Waiting For"),
    someday: count("Someday"),
    top_today: (sections["Today"] || []).filter((t) => !t.checked).slice(0, 3).map((t) => t.text)
  };
}

// ---- Mutations (each preserves all other lines exactly) ----

// Quick-add: insert a new "- [ ] <text>" at the TOP of a section (default Today).
// This is the 2-second capture for mid-day interrupts so nothing is lost.
export function addTask(doc, text, section = "Today") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return doc;
  const idx = findSectionInsertIndex(doc, section);
  const newLine = { kind: "task", indent: "", checked: false, text: clean, raw: `- [ ] ${clean}` };
  if (idx === -1) {
    // Section doesn't exist — create it at the end.
    doc.lines.push({ kind: "heading", level: 2, title: section, raw: `## ${section}` }, newLine);
  } else {
    doc.lines.splice(idx, 0, newLine);
  }
  return doc;
}

// Toggle/set a task's checked state by exact text match within a section.
export function setChecked(doc, text, checked, section = "Today") {
  const { start, end } = sectionRange(doc, section);
  for (let i = start; i < end; i++) {
    const l = doc.lines[i];
    if (l.kind === "task" && l.text === text) {
      l.checked = checked;
      l.raw = `${l.indent}- [${checked ? "x" : " "}] ${l.text}`;
      return doc;
    }
  }
  return doc;
}

// Move a task from one GTD list to another (e.g. Inbox -> Today, Today -> Someday).
// Preserves its checked state and text; creates the destination section if needed.
export function moveTask(doc, text, fromSection, toSection) {
  const { start, end } = sectionRange(doc, fromSection);
  if (start === -1) return doc;
  for (let i = start; i < end; i++) {
    const l = doc.lines[i];
    if (l.kind === "task" && l.text === text) {
      doc.lines.splice(i, 1); // remove from source
      const idx = findSectionInsertIndex(doc, toSection);
      const moved = { kind: "task", indent: "", checked: l.checked, text: l.text, raw: `- [${l.checked ? "x" : " "}] ${l.text}` };
      if (idx === -1) doc.lines.push({ kind: "heading", level: 2, title: toSection, raw: `## ${toSection}` }, moved);
      else doc.lines.splice(idx, 0, moved);
      return doc;
    }
  }
  return doc;
}

// Reschedule a Today item: "tomorrow" defers it to ## Next Actions (do-next), "someday"
// to ## Someday. Things-style deferral without a heavy calendar. Returns the doc.
export function rescheduleTask(doc, text, when = "tomorrow") {
  const target = when === "someday" ? "Someday" : "Next Actions";
  return moveTask(doc, text, "Today", target);
}

// Remove a single task line by exact text within a section. Nothing else is touched.
export function removeTask(doc, text, section = "Today") {
  const { start, end } = sectionRange(doc, section);
  if (start === -1) return doc;
  for (let i = start; i < end; i++) {
    const l = doc.lines[i];
    if (l.kind === "task" && l.text === text) { doc.lines.splice(i, 1); return doc; }
  }
  return doc;
}

// Roll over: unchecked items in ## Today carry to the next day. Directly fixes
// "mostly it won't get completed" — unfinished work is never silently dropped, and
// there's no guilt pile: checked items move to Done, unchecked stay in Today.
// Returns { doc, rolled, archived }.
export function rollover(doc) {
  const { start, end } = sectionRange(doc, "Today");
  if (start === -1) return { doc, rolled: 0, archived: 0 };

  const keep = []; // unchecked -> stay in Today
  const done = []; // checked -> move to Done
  for (let i = start; i < end; i++) {
    const l = doc.lines[i];
    if (l.kind === "task") (l.checked ? done : keep).push(l);
    else if (l.raw.trim() !== "") keep.push(l); // preserve free text in Today
  }

  // Rebuild Today body with only the kept (unchecked) lines.
  doc.lines.splice(start, end - start, ...keep);

  // Append the checked ones to ## Done.
  if (done.length) {
    const doneIdx = findSectionInsertIndex(doc, "Done");
    if (doneIdx === -1) {
      doc.lines.push({ kind: "heading", level: 2, title: "Done", raw: "## Done" }, ...done);
    } else {
      doc.lines.splice(doneIdx, 0, ...done);
    }
  }
  return { doc, rolled: keep.filter((l) => l.kind === "task").length, archived: done.length };
}

// GTD Capture: APPEND auto-captured commitments to the ## Inbox — but only ones not
// already present ANYWHERE in the file (so a commitment you already clarified into
// Today is never re-added to the Inbox). This is non-destructive: items you put in
// the Inbox yourself, or already clarified, are left exactly as they are. Returns
// the doc; the count of newly-added items is on doc._inboxAdded.
export function syncInbox(doc, commitments) {
  const existing = new Set(
    doc.lines.filter((l) => l.kind === "task").map((l) => normalizeText(l.text))
  );

  const fresh = (commitments || [])
    .filter((c) => c && c.status !== "dismissed" && c.what)
    .map((c) => proposalLine(c))
    .filter((text) => !existing.has(normalizeText(text)));

  doc._inboxAdded = fresh.length;
  if (fresh.length === 0) return doc;

  const idx = findSectionInsertIndex(doc, INBOX_SECTION);
  const newLines = fresh.map((text) => ({ kind: "task", indent: "", checked: false, text, raw: `- [ ] ${text}` }));
  if (idx === -1) {
    doc.lines.push({ kind: "heading", level: 2, title: INBOX_SECTION, raw: `## ${INBOX_SECTION}` }, ...newLines);
  } else {
    doc.lines.splice(idx, 0, ...newLines);
  }
  return doc;
}

// Match a captured commitment against an existing line ignoring the small framing
// bits (@who / [due …] / "waiting:") so clarified items aren't re-captured.
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\(@[^)]+\)/g, "")
    .replace(/\[due[^\]]*\]/g, "")
    .replace(/^waiting:\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function proposalLine(c) {
  const who = c.who && c.who !== "me" ? ` (@${c.who})` : "";
  const due = c.due ? ` [due ${String(c.due).slice(0, 10)}]` : "";
  const dir = c.direction === "owed_to_me" ? "waiting: " : "";
  return `${dir}${c.what}${who}${due}`.replace(/\s+/g, " ").trim();
}

// ---- file IO helpers ----
export function loadTodos(path) {
  ensureTodoFile(path);
  return parseTodoMarkdown(readFileSync(path, "utf8"));
}
export function saveTodos(path, doc) {
  writeFileSync(path, serializeTodoMarkdown(doc), { mode: 0o600 });
}

// ---- section boundary helpers ----
function sectionRange(doc, name) {
  let start = -1;
  for (let i = 0; i < doc.lines.length; i++) {
    const l = doc.lines[i];
    if (l.kind === "heading" && l.level === 2 && l.title === name) { start = i + 1; continue; }
    if (start !== -1 && l.kind === "heading" && l.level <= 2) return { start, end: i };
  }
  return start === -1 ? { start: -1, end: -1 } : { start, end: doc.lines.length };
}

// Index just after a section heading (for inserting at the top of the section body).
function findSectionInsertIndex(doc, name) {
  for (let i = 0; i < doc.lines.length; i++) {
    const l = doc.lines[i];
    if (l.kind === "heading" && l.level === 2 && l.title === name) return i + 1;
  }
  return -1;
}

export { GTD_SECTIONS, INBOX_SECTION };
