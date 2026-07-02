import { createHash, randomUUID } from "node:crypto";

// A commitment needs a real promise/request structure, not just a stray time word.
// Each pattern below captures an actual obligation: I-will (owed by me), a request
// directed at me, or an explicit action item. Bare "today"/"please"/"tomorrow" no
// longer manufacture commitments on their own — they only sharpen the due date.
const OWED_BY_ME_PATTERNS = [
  /\b(?:i['’]?ll|i will|i can|let me|i'?m going to|i am going to|i should|i need to|i'?ll take|on it)\b/i,
  /\b(?:can you|could you|would you|need you to|please review|assigned to you|over to you|your action)\b/i
];
// "owed to me" must have a THIRD-PARTY subject doing the future action — never a bare
// "will send" (which "I will send" would match). The subject is explicit: they/she/he/<Name>.
const OWED_TO_ME_PATTERNS = [
  /\b(?:waiting on|blocked by|owes me|gets back to me)\b/i,
  /\b(?:they|she|he)['’]?(?:ll| will)\b/i,
  /\b(?:they|she|he) (?:will |'ll )?(?:get back|fix|send|follow up|update|reply)\b/i,
  /\b[A-Z][a-z]+ will\b/ // "Priya will send the numbers"
];
const ACTION_ITEM_PATTERNS = [
  /\b(?:action item|todo|to-do|follow[ -]?up|next step)\b/i
];
const NEGATION_PATTERNS = [
  // Phrases that look like requests but are not commitments.
  /\b(?:ignore my last|never mind|nevermind|no action needed|fyi only|just fyi|disregard)\b/i,
  // Rhetorical questions ("could you believe…", "can you imagine…") — not a request OF me.
  /\b(?:could you believe|can you imagine|can you believe|would you believe)\b/i,
  // Non-actionable "I will" phrasings: out-of-office, remembering, trying.
  /\bi['’]?ll (?:be (?:out|ooo|off|away|on (?:pto|leave|vacation))|remember|keep that in mind|try to)\b/i,
  /\bi will (?:be (?:out|off|away|on (?:pto|leave|vacation))|remember|keep that in mind)\b/i,
  // Vague/hypothetical, no real commitment.
  /\b(?:someday|maybe later|at some point|if we ever|might (?:want to|need to))\b/i
];

const ALL_COMMITMENT_PATTERNS = [...OWED_BY_ME_PATTERNS, ...OWED_TO_ME_PATTERNS, ...ACTION_ITEM_PATTERNS];

const LESSON_PATTERNS = [
  /\b(?:learned|lesson|root cause|fix was|turns out|remember|note to self)\b/i,
  /\b(?:debugged|investigated|postmortem|retro)\b/i
];

export function deriveFromEvent(store, event) {
  const derived = {
    commitments: [],
    lessons: [],
    memory_records: []
  };

  const memory = memoryFromEvent(event);
  if (memory) {
    derived.memory_records.push(store.upsertMemory(memory));
  }

  const commitment = commitmentFromEvent(event);
  if (commitment) {
    derived.commitments.push(store.upsertCommitment(commitment));
  }

  const lesson = lessonFromEvent(event);
  if (lesson) {
    derived.lessons.push(store.upsertLesson(lesson));
  }

  return derived;
}

function memoryFromEvent(event) {
  const isWorking = ["edited_file", "opened_file", "reviewing_pr", "opened_ticket", "message", "mentioned"].includes(event.kind);
  const isSemantic = ["read_doc", "meeting_action"].includes(event.kind) || LESSON_PATTERNS.some((pattern) => pattern.test(event.summary));
  if (!isWorking && !isSemantic) {
    return null;
  }

  const now = new Date().toISOString();
  const kind = isSemantic ? "semantic" : "working";
  return {
    id: stableId("memory", event.id, kind),
    kind,
    topic: event.project || event.kind,
    content: event.summary,
    source_event_ids: [event.id],
    source_refs: [event.ref],
    embedding_ref: null,
    persistence_policy: kind === "working" ? "clear_day_end" : "keep_until_deleted",
    privacy_level: "cloud_allowed_redacted",
    confidence: event.confidence,
    created_ts: event.ts,
    updated_ts: now
  };
}

const COMMITMENT_SOURCES = ["slack", "teams", "mail", "meeting", "jira", "github"];

// Some events ARE commitments by their structure, no text regex needed: a PR with
// you as the requested reviewer, or a ticket/PR assigned to you. The optional
// event.commitment hint (set by structured connectors like GitHub) declares this
// directly with an explicit direction, so we don't depend on brittle phrase matching.
function structuralCommitment(event) {
  const hint = event.ref?.commitment;
  if (!hint || !["owed_by_me", "owed_to_me"].includes(hint.direction)) return null;
  return {
    id: stableId("commitment", event.id),
    source_event_id: event.id,
    direction: hint.direction,
    what: event.summary,
    who: hint.who || "me",
    due: inferDue(event.ts, event.summary),
    status: "proposed",
    confidence: Math.min(event.confidence, 0.9),
    provenance_ref: event.ref,
    extractor: "structural",
    match_reason: "structured connector signal"
  };
}

function commitmentFromEvent(event) {
  const structural = structuralCommitment(event);
  if (structural) return structural;

  if (!COMMITMENT_SOURCES.includes(event.source)) {
    return null;
  }
  const summary = event.summary;
  if (NEGATION_PATTERNS.some((pattern) => pattern.test(summary))) {
    return null;
  }
  if (!ALL_COMMITMENT_PATTERNS.some((pattern) => pattern.test(summary))) {
    return null;
  }

  // Symmetric direction detection: check both directions explicitly, and only
  // fall back to a default when neither side has a clear signal.
  const owedByMe = OWED_BY_ME_PATTERNS.some((p) => p.test(summary));
  const owedToMe = OWED_TO_ME_PATTERNS.some((p) => p.test(summary));
  const direction = owedToMe && !owedByMe
    ? "owed_to_me"
    : owedByMe && !owedToMe
      ? "owed_by_me"
      : owedToMe // both matched -> trust the "someone else will" signal less strongly than an explicit ask
        ? "owed_to_me"
        : "owed_by_me";

  return {
    id: stableId("commitment", event.id),
    source_event_id: event.id,
    direction,
    what: event.summary,
    who: inferWho(event.summary),
    due: inferDue(event.ts, event.summary),
    status: "proposed",
    confidence: Math.min(event.confidence, 0.86),
    provenance_ref: event.ref,
    // Inspectability: which engine produced this and why it fired. The UI badges
    // regex vs AI items distinctly so a derived commitment is never a black box.
    extractor: "regex",
    match_reason: matchReason(summary)
  };
}

// Returns the phrase that triggered the match, so the user can see WHY it fired.
function matchReason(summary) {
  for (const p of ALL_COMMITMENT_PATTERNS) {
    const m = summary.match(p);
    if (m) return m[0];
  }
  return null;
}

function lessonFromEvent(event) {
  if (!["read_doc", "meeting_action", "message", "edited_file"].includes(event.kind)) {
    return null;
  }
  if (!LESSON_PATTERNS.some((pattern) => pattern.test(event.summary))) {
    return null;
  }

  return {
    id: stableId("lesson", event.id),
    topic: event.project || inferTopic(event.summary),
    insight: event.summary,
    source_refs: [event.ref],
    source_event_ids: [event.id],
    created_ts: event.ts,
    last_surfaced_ts: null
  };
}

function inferWho(summary) {
  const match = summary.match(/\bfrom ([A-Z][a-z]+)\b|\bfor ([A-Z][a-z]+)\b|\bwith ([A-Z][a-z]+)\b/);
  return match?.[1] || match?.[2] || match?.[3] || "me";
}

function inferDue(ts, summary) {
  const base = new Date(ts);
  if (!Number.isFinite(base.getTime())) {
    return null;
  }

  if (/\btoday\b/i.test(summary)) {
    base.setUTCHours(17, 0, 0, 0);
    return base.toISOString();
  }
  if (/\btomorrow\b/i.test(summary)) {
    base.setUTCDate(base.getUTCDate() + 1);
    base.setUTCHours(17, 0, 0, 0);
    return base.toISOString();
  }
  if (/\bfriday\b/i.test(summary)) {
    return nextWeekday(base, 5).toISOString();
  }
  if (/\bmonday\b/i.test(summary)) {
    return nextWeekday(base, 1).toISOString();
  }
  return null;
}

function nextWeekday(base, weekday) {
  const date = new Date(base);
  const delta = (weekday - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + delta);
  date.setUTCHours(17, 0, 0, 0);
  return date;
}

function inferTopic(summary) {
  return summary.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
}

function stableId(prefix, ...parts) {
  const hash = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 24);
  if (parts.some((part) => !part)) {
    return randomUUID();
  }
  return `${prefix}_${hash}`;
}
