import { randomUUID } from "node:crypto";
import { getTriage } from "./capabilities.js";

export function startFocusSession(store, input = {}) {
  const existing = currentFocusSession(store);
  if (existing.active) {
    throw Object.assign(new Error("A focus session is already active"), { statusCode: 409 });
  }

  const durationMinutes = clamp(Number(input.duration_minutes || input.durationMinutes || 45), 5, 180);
  const started = new Date();
  const ends = new Date(started.getTime() + durationMinutes * 60_000);
  const suggestedFocus = typeof input.focus === "string" && input.focus.trim()
    ? input.focus.trim()
    : suggestFocus(store);

  const session = {
    id: randomUUID(),
    focus: suggestedFocus,
    duration_minutes: durationMinutes,
    attention_mode: input.attention_mode || "never",
    started_ts: started.toISOString(),
    ends_ts: ends.toISOString(),
    completed_ts: null,
    status: "active",
    summary: {
      message: "Focus Session active. Sidekick stays ambient unless urgent work appears.",
      source: "Plan + Interaction / Attention Policy"
    }
  };

  store.insertFocusSession(session);
  return decorateSession(session, store);
}

export function currentFocusSession(store) {
  const active = store.activeFocusSession();
  if (!active) {
    return {
      active: false,
      attention_policy: "ambient",
      session: null
    };
  }

  if (Date.now() >= Date.parse(active.ends_ts)) {
    const completed = completeFocusSession(store, { status: "completed" });
    return {
      active: false,
      attention_policy: "ambient",
      session: completed.session
    };
  }

  return decorateSession(active, store);
}

export function completeFocusSession(store, input = {}) {
  const active = store.activeFocusSession();
  if (!active) {
    return {
      active: false,
      attention_policy: "ambient",
      session: null,
      message: "No active focus session."
    };
  }

  const status = input.status === "cancelled" ? "cancelled" : "completed";
  const summary = buildSessionSummary(store, active);
  const updated = store.updateFocusSessionStatus(active.id, status, summary);

  return {
    active: false,
    attention_policy: "ambient",
    session: updated,
    message: status === "cancelled" ? "Focus Session cancelled." : "Focus Session complete.",
    summary
  };
}

export function listFocusSessions(store) {
  return {
    capability: "Plan",
    workflow: "Focus Session",
    sessions: store.listFocusSessions({ limit: 20 })
  };
}

function decorateSession(session, store) {
  const remainingMs = Math.max(0, Date.parse(session.ends_ts) - Date.now());
  return {
    active: true,
    attention_policy: session.attention_mode,
    session,
    remaining_seconds: Math.ceil(remainingMs / 1000),
    triage_during_focus: filterUrgentDuringFocus(getTriage(store).ranked),
    message: "Focus Session active. Non-urgent surfacing stays ambient."
  };
}

function buildSessionSummary(store, session) {
  const started = Date.parse(session.started_ts);
  const events = store
    .recentEvents(200)
    .filter((event) => Date.parse(event.ts) >= started);
  const urgent = filterUrgentDuringFocus(getTriage(store).ranked);

  return {
    focus: session.focus,
    captured_events: events.length,
    sources: [...new Set(events.map((event) => event.source))],
    urgent_items: urgent,
    next_step: urgent.length > 0
      ? `Review urgent item: ${urgent[0].summary}`
      : `Continue or close out: ${session.focus}`
  };
}

function filterUrgentDuringFocus(items) {
  return items.filter((item) => item.urgency >= 0.7 || item.score >= 0.8).slice(0, 5);
}

function suggestFocus(store) {
  const resumeEvents = store.recentEvents(5);
  const last = resumeEvents[0];
  if (last) {
    return last.summary;
  }
  return "Protected deep work";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.round(value), min), max);
}
