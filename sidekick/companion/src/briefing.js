import { getResume, getTriage, getCommitments, getRecall } from "./capabilities.js";
import { todoFilePath, loadTodos, todoView } from "./todos.js";

// Briefing + Meeting Prep — two Littlebird-inspired features, kept deliberately
// SIMPLE: they compose the capabilities Sidekick already computes rather than adding
// new capture or new data. Everything is deterministic (works offline, no API key);
// each returns a structured `digest` plus pre-phrased `lines`, and also an
// `llmPrompt` seam so an optional LLM can phrase it more naturally later.

// ---- Morning Briefing ("Routines", reduced to the one digest that matters) ----
// Resume + Triage + Commitments, composed into a few true sentences. This is the
// proactive "assistant, not dashboard" surface the usability council asked for.
export function buildBriefing(store, config, now = new Date()) {
  const resume = getResume(store, config);
  const triage = getTriage(store);
  const commitments = getCommitments(store);

  const lastSummary = resume.lastState?.summary || (resume.nextSteps || [])[0] || null;
  const needsNow = (triage.ranked || []).slice(0, 3);

  const live = (commitments.commitments || []).filter((c) => c.status !== "dismissed");
  const owedByMe = live.filter((c) => c.direction === "owed_by_me");
  const owedToMe = live.filter((c) => c.direction === "owed_to_me");
  const dueToday = live.filter((c) => isSameDay(c.due, now));

  // Your own hand-written day plan (the GTD TODO.md), folded into the briefing.
  let todos = null;
  try { todos = todoView(loadTodos(todoFilePath())); } catch { /* file optional */ }

  const lines = [];
  lines.push(greeting(now));
  if (todos && todos.open_today > 0) {
    lines.push(`${todos.open_today} on your list today${todos.top_today.length ? `, starting with: ${trim(todos.top_today[0])}` : ""}.`);
  }
  if (todos && todos.inbox > 0) {
    lines.push(`${todos.inbox} in your inbox to clarify.`);
  }
  if (lastSummary) lines.push(`You left off: ${trim(lastSummary)}.`);
  if (needsNow.length) {
    lines.push(`${needsNow.length} thing${needsNow.length > 1 ? "s" : ""} need${needsNow.length > 1 ? "" : "s"} you now — top: ${trim(needsNow[0].summary)}.`);
  }
  if (owedByMe.length) lines.push(`You owe ${owedByMe.length}: ${trim(owedByMe[0].what)}${owedByMe[0].who && owedByMe[0].who !== "me" ? ` (${owedByMe[0].who})` : ""}.`);
  if (owedToMe.length) lines.push(`${owedToMe.length} owed to you: ${trim(owedToMe[0].what)}.`);
  if (dueToday.length) lines.push(`${dueToday.length} due today.`);
  if (lines.length === 1) lines.push("Nothing pressing yet. Capture some work and I'll surface what matters.");

  return {
    capability: "Briefing",
    generated_at: now.toISOString(),
    digest: {
      last: lastSummary,
      todos_open_today: todos ? todos.open_today : 0,
      todos_inbox: todos ? todos.inbox : 0,
      top_todos: todos ? todos.top_today : [],
      needs_now: needsNow.map((i) => ({ summary: i.summary, score: i.score, provenance_ref: i.provenance_ref })),
      owed_by_me: owedByMe.slice(0, 5),
      owed_to_me: owedToMe.slice(0, 5),
      due_today: dueToday.slice(0, 5)
    },
    lines,
    headline: lines.join(" "),
    // Optional LLM seam: hand this to a model for a warmer phrasing; deterministic
    // `headline` is the default so nothing breaks without an API key.
    llmPrompt: buildBriefingPrompt({ lastSummary, needsNow, owedByMe, owedToMe, dueToday })
  };
}

// ---- Meeting Prep ----
// Given a topic and/or attendee names, pull the relevant past commitments, lessons,
// and notes — with provenance — so you walk into a meeting already caught up.
export function buildMeetingPrep(store, { topic = null, attendees = [] } = {}) {
  const queryParts = [topic, ...(Array.isArray(attendees) ? attendees : [])].filter(Boolean);
  const query = queryParts.join(" ").trim() || null;

  const recall = getRecall(store, query);
  const commitments = getCommitments(store);
  const live = (commitments.commitments || []).filter((c) => c.status !== "dismissed");

  // Match commitments to the meeting by attendee or topic keyword.
  const needles = queryParts.map((p) => String(p).toLowerCase()).filter(Boolean);
  const relevantCommitments = needles.length
    ? live.filter((c) => {
        const hay = `${c.what} ${c.who || ""}`.toLowerCase();
        return needles.some((n) => hay.includes(n));
      })
    : live.slice(0, 5);

  const lines = [];
  lines.push(topic ? `Prep for: ${trim(topic)}.` : "Meeting prep.");
  if (relevantCommitments.length) {
    lines.push(`Open with them: ${relevantCommitments.slice(0, 3).map((c) => trim(c.what)).join("; ")}.`);
  }
  if ((recall.lessons || []).length) {
    lines.push(`Relevant lessons: ${recall.lessons.slice(0, 2).map((l) => trim(l.insight)).join("; ")}.`);
  }
  if (lines.length === 1) lines.push("No related history captured yet for this meeting.");

  return {
    capability: "MeetingPrep",
    query,
    attendees,
    relevant_commitments: relevantCommitments.slice(0, 8),
    relevant_lessons: (recall.lessons || []).slice(0, 5),
    relevant_notes: (recall.memory || []).slice(0, 5),
    lines,
    headline: lines.join(" "),
    llmPrompt: buildMeetingPrepPrompt({ topic, attendees, relevantCommitments, recall })
  };
}

function greeting(now) {
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}. Here's your day.`;
}

function isSameDay(iso, now) {
  if (!iso) return false;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) &&
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate();
}

function trim(text, max = 120) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// --- LLM seam prompts (returned but never required) ---
function buildBriefingPrompt({ lastSummary, needsNow, owedByMe, owedToMe, dueToday }) {
  return [
    "Write a 2-3 sentence morning briefing for a software engineer in a warm, concise voice.",
    "Use ONLY these facts; do not invent anything:",
    `- Left off: ${lastSummary || "nothing captured"}`,
    `- Needs them now: ${needsNow.map((i) => i.summary).join("; ") || "nothing"}`,
    `- They owe: ${owedByMe.map((c) => c.what).join("; ") || "nothing"}`,
    `- Owed to them: ${owedToMe.map((c) => c.what).join("; ") || "nothing"}`,
    `- Due today: ${dueToday.length}`
  ].join("\n");
}

function buildMeetingPrepPrompt({ topic, attendees, relevantCommitments, recall }) {
  return [
    `Brief me before a meeting${topic ? ` about "${topic}"` : ""}${attendees?.length ? ` with ${attendees.join(", ")}` : ""}.`,
    "Use ONLY these facts; cite nothing that isn't here:",
    `- Open commitments: ${relevantCommitments.map((c) => c.what).join("; ") || "none"}`,
    `- Lessons: ${(recall.lessons || []).map((l) => l.insight).join("; ") || "none"}`
  ].join("\n");
}
