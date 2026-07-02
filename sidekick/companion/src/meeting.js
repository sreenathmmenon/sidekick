import { normalizeWorkContextEvent } from "./domain.js";

// Meeting lifecycle — the highest-waste surface for leads/EMs: time lost, context
// dropped, notes that rot, action items forgotten. Sidekick covers the whole arc,
// local-first and propose-don't-act (no always-on mic):
//
//   BEFORE  -> buildMeetingPrep (in briefing.js): past context for this meeting
//   DURING  -> ingestMeeting:    notes / pasted transcript / connector events come in
//   AFTER   -> summarizeMeeting:  decisions + a plain summary
//   FOLLOW  -> action items become TRACKED COMMITMENTS with provenance back to the meeting
//
// Input is multi-path on purpose — some meetings you jot notes, some you can download
// a transcript, some arrive via the M365/Teams connector. All three land as
// `meeting_action` / `meeting` events through the same canonical boundary.

const DECISION_PATTERNS = [
  /\b(?:we (?:decided|agreed|will go with|are going with)|decision:|agreed to|going with|let's go with)\b/i,
  /\b(?:approved|signed off|green ?light)\b/i
];

// An explicit action prefix ("Action:", "TODO -", "Next step:") — strip it, then
// detect the owner from whatever remains.
const ACTION_PREFIX = /\b(?:action(?:\s*item)?|todo|to-do|next step)s?\s*[:\-]\s*(.+)/i;
// An implicit action line ("Maya will…", "I'll…") with no prefix.
const ACTION_IMPLICIT = [
  /^\s*([A-Z][a-z]+)\s+(?:will|to|should|is going to)\s+(.+)/,
  /^\s*(?:i['’]?ll|i will|i'?m going to)\s+(.+)/i
];
// Owner detection, applied to an action's text regardless of how it was matched.
const OWNER_NAMED = /^\s*([A-Z][a-z]+)\s+(?:will|to|should|is going to)\b/;
const OWNER_FIRST_PERSON = /\b(?:i['’]?ll|i will|i'?m going to|my)\b/i;

// Splits raw meeting text (notes OR a transcript) into candidate lines.
export function meetingLines(text) {
  return String(text || "")
    .split(/\r?\n|(?<=[.!?])\s+(?=[A-Z])/)
    .map((l) => l.replace(/^\s*[-*•\d.)\]]+\s*/, "").trim())
    .filter((l) => l.length > 0);
}

export function extractDecisions(text) {
  return meetingLines(text).filter((line) => DECISION_PATTERNS.some((p) => p.test(line))).slice(0, 20);
}

// Returns { what, who } action items. `who` is "me" for first-person, else the
// named owner, else "me" (you can reassign later).
export function extractActionItems(text) {
  const items = [];
  for (const line of meetingLines(text)) {
    let what = null;

    const prefixed = line.match(ACTION_PREFIX);
    if (prefixed) {
      what = prefixed[1].trim(); // "Action: Maya will X" -> "Maya will X"
    } else {
      for (const pattern of ACTION_IMPLICIT) {
        if (pattern.test(line)) { what = line.trim(); break; }
      }
    }
    if (!what) continue;

    // Detect owner from the action text, whichever way it was matched.
    const named = what.match(OWNER_NAMED);
    const who = named ? named[1] : OWNER_FIRST_PERSON.test(what) ? "me" : "me";
    items.push({ what: trim(what), who });
  }
  return dedupe(items).slice(0, 30);
}

// Ingest one meeting. Stores a meeting marker event plus a `meeting_action` event
// per action item; each action carries a structural commitment hint so the derive
// pipeline tracks it (owed_by_me for "me", owed_to_me for someone else owing the user
// is NOT assumed here — meeting actions are things to be done, defaulting to the owner).
export function ingestMeeting(store, deriveFn, input, now = new Date()) {
  const title = requireString(input.title, "title");
  const text = `${input.notes || ""}\n${input.transcript || ""}`.trim();
  const meetingId = input.meetingId || slug(title) + ":" + now.getTime().toString(36);
  const attendees = Array.isArray(input.attendees) ? input.attendees : [];
  const ts = isoOr(input.ts, now);

  const decisions = extractDecisions(text);
  const actions = extractActionItems(text);
  const stored = [];

  // 1) A meeting marker event (provenance anchor; powers prep/minutes linkage).
  const markerSummary = `Meeting: ${title}${attendees.length ? ` with ${attendees.join(", ")}` : ""}` +
    (decisions.length ? ` — decided: ${decisions.slice(0, 2).join("; ")}` : "");
  stored.push(appendDerive(store, deriveFn, {
    ts, source: "meeting", kind: "calendar_event",
    ref: { url: `meeting:${meetingId}`, meeting: meetingId },
    summary: markerSummary, project: input.project || null, confidence: 0.95, origin: "work"
  }));

  // 2) One meeting_action event per action item -> becomes a tracked commitment.
  for (const action of actions) {
    const ownedByMe = action.who === "me";
    stored.push(appendDerive(store, deriveFn, {
      ts, source: "meeting", kind: "meeting_action",
      ref: {
        url: `meeting:${meetingId}`,
        meeting: meetingId,
        // Structural commitment hint: actions you own -> owed_by_me; others' -> tracked as owed_to_me.
        commitment: { direction: ownedByMe ? "owed_by_me" : "owed_to_me", who: action.who }
      },
      summary: `Action from "${title}": ${action.what}`,
      project: input.project || null, confidence: 0.9, origin: "work"
    }));
  }

  return {
    ok: true,
    capability: "MeetingMinutes",
    meetingId,
    title,
    attendees,
    decisions,
    action_items: actions,
    imported_events: stored.length,
    commitments: stored.flatMap((s) => s.derived.commitments),
    // Plain-English minutes (deterministic). LLM seam below for transcript-heavy meetings.
    minutes: buildMinutesText(title, attendees, decisions, actions),
    llmPrompt: buildMinutesPrompt(title, attendees, text)
  };
}

// Read-side: assemble minutes for a previously-ingested meeting from its stored events.
export function getMeetingMinutes(store, meetingId) {
  const events = store.listEvents({ source: "meeting", limit: 500 })
    .filter((e) => e.ref?.meeting === meetingId);
  const marker = events.find((e) => e.kind === "calendar_event");
  const actions = events.filter((e) => e.kind === "meeting_action").map((e) => e.summary);
  return {
    capability: "MeetingMinutes",
    meetingId,
    title: marker ? marker.summary.replace(/^Meeting:\s*/, "").split(" — ")[0] : meetingId,
    found: events.length > 0,
    action_items: actions,
    events
  };
}

function buildMinutesText(title, attendees, decisions, actions) {
  const lines = [`Minutes — ${title}${attendees.length ? ` (${attendees.join(", ")})` : ""}.`];
  if (decisions.length) lines.push(`Decisions: ${decisions.slice(0, 4).join("; ")}.`);
  if (actions.length) lines.push(`${actions.length} action item${actions.length > 1 ? "s" : ""} captured and now tracked as commitments.`);
  if (decisions.length === 0 && actions.length === 0) lines.push("No decisions or action items detected — add notes or a transcript.");
  return lines.join(" ");
}

function buildMinutesPrompt(title, attendees, text) {
  return [
    `Summarize this meeting "${title}"${attendees.length ? ` (attendees: ${attendees.join(", ")})` : ""} into:`,
    "1) a 2-sentence summary, 2) bullet decisions, 3) action items with owners.",
    "Use ONLY the text below.\n---\n" + String(text || "").slice(0, 6000)
  ].join("\n");
}

function appendDerive(store, deriveFn, raw) {
  const event = normalizeWorkContextEvent(raw);
  // Event + derived rows commit atomically.
  const derived = store.transaction(() => {
    store.appendEvent(event);
    return deriveFn(store, event);
  });
  return { event, derived };
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`Missing required field: ${field}`), { statusCode: 400 });
  }
  return value.trim();
}
function isoOr(value, now) {
  const d = value ? new Date(value) : now;
  return Number.isFinite(d.getTime()) ? d.toISOString() : now.toISOString();
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }
function trim(t, max = 160) { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length > max ? s.slice(0, max - 1) + "…" : s; }
function dedupe(items) {
  const seen = new Set();
  return items.filter((i) => { const k = i.what.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
