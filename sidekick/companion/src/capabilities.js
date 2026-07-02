import { buildResume } from "./resume.js";

export function getResume(store, config) {
  const events = store.recentEvents(Math.max(config.resumeLimit * 3, 30));
  return buildResume(events, {
    resumeLimit: config.resumeLimit,
    gapMinutes: config.gapMinutes
  });
}

export function getCommitments(store) {
  // Dismissed commitments are user-rejected false positives; never surface them.
  const commitments = store.listCommitments({ limit: 200 }).filter((item) => item.status !== "dismissed");
  return {
    capability: "Commitments",
    commitments,
    proposed: commitments.filter((item) => item.status === "proposed"),
    confirmed: commitments.filter((item) => item.status === "confirmed"),
    owed_by_me: commitments.filter((item) => item.direction === "owed_by_me"),
    owed_to_me: commitments.filter((item) => item.direction === "owed_to_me")
  };
}

export function getTriage(store) {
  const events = store.recentEvents(120);
  const commitments = store.listCommitments({ limit: 100 }).filter((item) => item.status !== "dismissed");
  const eventItems = events
    .filter((event) => ["mentioned", "message", "reviewing_pr", "opened_ticket", "meeting_action"].includes(event.kind))
    .map((event) => ({
      id: event.id,
      type: "event",
      source: event.source,
      summary: event.summary,
      score: scoreEvent(event),
      urgency: inferUrgency(event.summary, event.ts),
      importance: inferImportance(event),
      provenance_ref: event.ref
    }));

  const commitmentItems = commitments.map((commitment) => ({
    id: commitment.id,
    type: "commitment",
    source: "commitments",
    summary: commitment.what,
    score: scoreCommitment(commitment),
    urgency: inferUrgency(commitment.what, commitment.due),
    importance: commitment.direction === "owed_by_me" ? 0.9 : 0.7,
    provenance_ref: commitment.provenance_ref
  }));

  const ranked = [...eventItems, ...commitmentItems]
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return {
    capability: "Triage",
    mode: "propose",
    ranked,
    message: ranked.length === 0 ? "Nothing needs you right now." : "Ranked by urgency x importance with provenance."
  };
}

export function getRecall(store, query = null) {
  const lessons = rankLessons(store.listLessons({ topic: query, limit: 100 }), query);
  const semanticMemory = rankMemory(store.listMemory({ kind: "semantic", limit: 100 }), query);
  return {
    capability: "Recall",
    query,
    lessons,
    memory: semanticMemory,
    // Honest framing: this is keyword search over captured lessons/notes, not vector
    // semantic search. Renamed until real embeddings exist so it doesn't overpromise.
    retrieval: "keyword",
    message: lessons.length === 0 && semanticMemory.length === 0
      ? "No lessons or notes captured yet."
      : "Keyword search over your captured lessons and notes, with provenance."
  };
}

function rankLessons(lessons, query) {
  if (!query) {
    return lessons;
  }

  return lessons
    .map((lesson) => ({ ...lesson, score: recallScore(`${lesson.topic} ${lesson.insight}`, query, lesson.created_ts) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function rankMemory(memory, query) {
  if (!query) {
    return memory;
  }

  return memory
    .map((item) => ({ ...item, score: recallScore(`${item.topic} ${item.content}`, query, item.updated_ts) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

function recallScore(text, query, timestamp) {
  const haystack = String(text || "").toLowerCase();
  const terms = String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
    }
  }

  if (terms.length > 0) {
    score /= terms.length;
  }

  const ageHours = timestamp ? (Date.now() - Date.parse(timestamp)) / 36e5 : Infinity;
  const recencyBoost = Number.isFinite(ageHours) ? Math.max(0, 1 - Math.min(ageHours, 240) / 240) * 0.25 : 0;
  return round(score + recencyBoost);
}

export function getPlan(store) {
  const now = new Date();
  const commitments = store.listCommitments({ limit: 100 });
  const triage = getTriage(store).ranked.slice(0, 5);
  const dueToday = commitments.filter((commitment) => isToday(commitment.due, now));
  const overdue = commitments.filter((commitment) => commitment.due && Date.parse(commitment.due) < now.getTime());
  const blocks = [
    {
      label: "Deep work",
      start: "09:30",
      end: "11:30",
      focus: "Continue highest-value engineering work from Resume."
    },
    {
      label: "Triage",
      start: "13:00",
      end: "13:30",
      focus: triage.length === 0 ? "Batch check low-noise inboxes." : triage[0].summary
    },
    {
      label: "Commitments",
      start: "16:30",
      end: "17:00",
      focus: dueToday.length === 0 ? "Review open commitments." : `${dueToday.length} commitment(s) due today.`
    }
  ];

  return {
    capability: "Plan",
    mode: "propose",
    day_shape: blocks,
    focus_session: {
      suggested_minutes: 45,
      suggested_focus: triage[0]?.summary || "Continue highest-value engineering work from Resume.",
      attention_mode: "never",
      rationale: "Protect deep work; keep non-urgent surfacing ambient."
    },
    risks: [
      ...overdue.map((item) => `Overdue: ${item.what}`),
      ...(triage.length > 3 ? ["High triage load; protect deep-work block."] : [])
    ],
    commitments_due_today: dueToday,
    provenance: triage.map((item) => item.provenance_ref),
    message: "Proposed day-shape only; Sidekick does not override your calendar."
  };
}

function scoreEvent(event) {
  return round((inferUrgency(event.summary, event.ts) * inferImportance(event) + event.confidence) / 2);
}

function scoreCommitment(commitment) {
  const dueScore = inferUrgency(commitment.what, commitment.due);
  const directionScore = commitment.direction === "owed_by_me" ? 0.95 : 0.7;
  return round((dueScore * directionScore + commitment.confidence) / 2);
}

function inferUrgency(summary, tsOrDue) {
  let score = 0.35;
  if (/\b(?:urgent|asap|blocked|today|incident|prod|production)\b/i.test(summary)) {
    score += 0.35;
  }
  if (/\b(?:tomorrow|friday|monday|due)\b/i.test(summary)) {
    score += 0.2;
  }
  if (tsOrDue) {
    const ageHours = (Date.now() - Date.parse(tsOrDue)) / 36e5;
    if (Number.isFinite(ageHours) && ageHours > 24) {
      score += 0.15;
    }
  }
  return Math.min(score, 1);
}

function inferImportance(event) {
  let score = 0.4;
  if (["github", "jira", "meeting"].includes(event.source)) {
    score += 0.2;
  }
  if (["mentioned", "reviewing_pr", "opened_ticket", "meeting_action"].includes(event.kind)) {
    score += 0.25;
  }
  if (/\b(?:review|blocked|incident|decision|rollout)\b/i.test(event.summary)) {
    score += 0.15;
  }
  return Math.min(score, 1);
}

function isToday(ts, now) {
  if (!ts) {
    return false;
  }
  const date = new Date(ts);
  return date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate();
}

function round(value) {
  return Math.round(value * 100) / 100;
}
