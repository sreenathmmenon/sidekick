import { normalizeWorkContextEvent } from "./domain.js";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";

export async function syncMicrosoftGraph(input, store, deriveFromEventFn) {
  const token = requireString(input.graphAccessToken, "graphAccessToken");
  const results = [];
  const errors = [];

  await collect("outlookCalendar", results, errors, async () => {
    if (input.includeCalendar === false) return [];
    const payload = await graphGet(
      token,
      "/me/events?$top=10&$select=id,subject,start,end,webLink,onlineMeeting,organizer,attendees,bodyPreview,importance"
    );
    return (payload.value || []).map(mapCalendarEvent);
  });

  await collect("outlookMail", results, errors, async () => {
    if (input.includeMail === false) return [];
    const payload = await graphGet(
      token,
      "/me/messages?$top=10&$orderby=receivedDateTime desc&$select=id,subject,receivedDateTime,webLink,from,bodyPreview,importance"
    );
    return (payload.value || []).map(mapMailMessage);
  });

  await collect("teamsChat", results, errors, async () => {
    if (!input.chatId) return [];
    const payload = await graphGet(
      token,
      `/chats/${encodeURIComponent(input.chatId)}/messages?$top=10&$orderby=lastModifiedDateTime desc`
    );
    return (payload.value || []).map((message) => mapTeamsChatMessage(message, input.chatId));
  });

  await collect("teamsMeeting", results, errors, async () => {
    if (!input.onlineMeetingId) return [];
    const meeting = await graphGet(token, `/me/onlineMeetings/${encodeURIComponent(input.onlineMeetingId)}`);
    const meetingEvents = [mapOnlineMeeting(meeting)];

    if (input.includeTranscripts !== false) {
      const transcriptPayload = await graphGet(
        token,
        `/me/onlineMeetings/${encodeURIComponent(input.onlineMeetingId)}/transcripts`
      );
      meetingEvents.push(...(transcriptPayload.value || []).map((transcript) => mapTranscript(transcript, input.onlineMeetingId)));
    }

    return meetingEvents;
  });

  const stored = [];
  for (const eventInput of results) {
    const event = normalizeWorkContextEvent(eventInput);
    store.appendEvent(event);
    const derived = deriveFromEventFn(store, event);
    stored.push({ event, derived });
  }

  return {
    ok: errors.length === 0,
    connector: "Microsoft 365",
    imported: stored.length,
    stored,
    errors
  };
}

export function mapCalendarEvent(event) {
  const subject = clean(event.subject || "Untitled calendar event");
  const when = event.start?.dateTime ? ` at ${event.start.dateTime}` : "";
  const joinUrl = event.onlineMeeting?.joinUrl;
  return {
    ts: event.start?.dateTime ? toIso(event.start.dateTime) : new Date().toISOString(),
    source: "calendar",
    kind: "calendar_event",
    ref: {
      url: event.webLink || joinUrl,
      thread: event.id
    },
    summary: `Calendar event: ${subject}${when}`,
    project: inferProject(subject),
    confidence: 0.9,
    origin: "work"
  };
}

export function mapMailMessage(message) {
  const subject = clean(message.subject || "Untitled mail");
  const sender = message.from?.emailAddress?.name || message.from?.emailAddress?.address || "unknown sender";
  const preview = clean(message.bodyPreview || "");
  return {
    ts: message.receivedDateTime ? toIso(message.receivedDateTime) : new Date().toISOString(),
    source: "mail",
    kind: "message",
    ref: {
      url: message.webLink,
      thread: message.id
    },
    summary: `Mail from ${sender}: ${subject}${preview ? ` - ${preview}` : ""}`,
    project: inferProject(`${subject} ${preview}`),
    confidence: message.importance === "high" ? 0.92 : 0.84,
    origin: "work"
  };
}

export function mapTeamsChatMessage(message, chatId) {
  const sender = message.from?.user?.displayName || message.from?.application?.displayName || "Teams";
  const text = clean(htmlToText(message.body?.content || message.summary || "Teams message"));
  return {
    ts: message.createdDateTime ? toIso(message.createdDateTime) : new Date().toISOString(),
    source: "teams",
    kind: message.mentions?.length ? "mentioned" : "message",
    ref: {
      url: message.webUrl,
      thread: `${chatId}:${message.id}`
    },
    summary: `Teams from ${sender}: ${text}`,
    project: inferProject(text),
    confidence: 0.86,
    origin: "work"
  };
}

export function mapOnlineMeeting(meeting) {
  const subject = clean(meeting.subject || "Teams meeting");
  return {
    ts: meeting.startDateTime ? toIso(meeting.startDateTime) : new Date().toISOString(),
    source: "meeting",
    kind: "calendar_event",
    ref: {
      url: meeting.joinWebUrl,
      thread: meeting.id
    },
    summary: `Teams meeting: ${subject}`,
    project: inferProject(subject),
    confidence: 0.88,
    origin: "work"
  };
}

export function mapTranscript(transcript, onlineMeetingId) {
  return {
    ts: transcript.createdDateTime ? toIso(transcript.createdDateTime) : new Date().toISOString(),
    source: "meeting",
    kind: "meeting_action",
    ref: {
      url: transcript.transcriptContentUrl || transcript.webUrl,
      thread: `${onlineMeetingId}:transcript:${transcript.id}`
    },
    summary: `Teams transcript available for meeting ${onlineMeetingId}`,
    project: null,
    confidence: 0.8,
    origin: "work"
  };
}

async function graphGet(token, path) {
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      Prefer: 'outlook.body-content-type="text"'
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload;
}

async function collect(name, results, errors, fn) {
  try {
    results.push(...(await fn()));
  } catch (error) {
    errors.push({ source: name, error: error.message });
  }
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`Missing required field: ${fieldName}`), { statusCode: 400 });
  }
  return value.trim();
}

function htmlToText(value) {
  return value.replace(/<[^>]*>/g, " ");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 360);
}

function toIso(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function inferProject(text) {
  const lower = text.toLowerCase();
  if (lower.includes("payment") || lower.includes("checkout")) return "payments";
  if (lower.includes("incident")) return "incident";
  if (lower.includes("platform")) return "platform";
  return null;
}
