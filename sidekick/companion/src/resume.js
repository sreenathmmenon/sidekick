export function buildResume(eventsDesc, options = {}) {
  const resumeLimit = options.resumeLimit ?? 8;
  const gapMinutes = options.gapMinutes ?? 30;
  const gapMs = gapMinutes * 60 * 1000;
  const eventsAsc = [...eventsDesc].reverse();

  if (eventsAsc.length === 0) {
    return {
      capability: "Resume",
      lastState: null,
      gap: null,
      resumeEvents: [],
      nextSteps: [],
      provenance: [],
      message: "No captured work context yet."
    };
  }

  const gapIndex = findMostRecentGap(eventsAsc, gapMs);
  const lastState = eventsAsc.at(-1);
  const resumeEvents =
    gapIndex === -1
      ? eventsAsc.slice(-resumeLimit)
      : eventsAsc.slice(Math.max(0, gapIndex - resumeLimit), gapIndex);

  return {
    capability: "Resume",
    lastState,
    gap: buildGap(eventsAsc, gapIndex),
    resumeEvents,
    nextSteps: deriveNextSteps(resumeEvents, lastState),
    provenance: resumeEvents.map((event) => ({
      event_id: event.id,
      ref: event.ref,
      summary: event.summary
    })),
    message:
      gapIndex === -1
        ? "No interruption gap detected; showing the latest captured context."
        : "Most recent interruption gap detected; showing context from before the gap."
  };
}

function findMostRecentGap(eventsAsc, gapMs) {
  let gapIndex = -1;
  for (let i = 1; i < eventsAsc.length; i += 1) {
    const previous = Date.parse(eventsAsc[i - 1].ts);
    const current = Date.parse(eventsAsc[i].ts);
    if (Number.isFinite(previous) && Number.isFinite(current) && current - previous >= gapMs) {
      gapIndex = i;
    }
  }
  return gapIndex;
}

function buildGap(eventsAsc, gapIndex) {
  if (gapIndex === -1) {
    return null;
  }

  const from = eventsAsc[gapIndex - 1].ts;
  const to = eventsAsc[gapIndex].ts;
  return {
    from,
    to,
    minutes: Math.round((Date.parse(to) - Date.parse(from)) / 60000)
  };
}

function deriveNextSteps(resumeEvents, lastState) {
  const steps = [];
  const lastBeforeGap = resumeEvents.at(-1);

  if (lastBeforeGap) {
    steps.push(`Re-open: ${describeRef(lastBeforeGap)}`);
    steps.push(`Continue from: ${lastBeforeGap.summary}`);
  }

  if (lastState && lastState.id !== lastBeforeGap?.id) {
    steps.push(`Current latest context: ${lastState.summary}`);
  }

  return steps.slice(0, 3);
}

function describeRef(event) {
  if (event.ref.file) {
    return event.ref.file;
  }
  if (event.ref.pr) {
    return `PR ${event.ref.pr}`;
  }
  if (event.ref.ticket) {
    return event.ref.ticket;
  }
  if (event.ref.url) {
    return event.ref.url;
  }
  return `${event.source}:${event.kind}`;
}
