import test from "node:test";
import assert from "node:assert/strict";
import {
  mapCalendarEvent,
  mapMailMessage,
  mapOnlineMeeting,
  mapTeamsChatMessage,
  mapTranscript
} from "../src/microsoftGraph.js";

test("maps Outlook calendar events to WorkContextEvent input", () => {
  const event = mapCalendarEvent({
    id: "event-1",
    subject: "Checkout retry design review",
    start: { dateTime: "2026-06-28T09:00:00Z" },
    webLink: "https://outlook.office.com/calendar/item/event-1",
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/redacted" }
  });

  assert.equal(event.source, "calendar");
  assert.equal(event.kind, "calendar_event");
  assert.equal(event.project, "payments");
  assert.match(event.summary, /Checkout retry/);
  assert.equal(event.ref.thread, "event-1");
});

test("maps Outlook mail messages to WorkContextEvent input", () => {
  const event = mapMailMessage({
    id: "mail-1",
    subject: "Can you review the checkout retry PR by Friday?",
    receivedDateTime: "2026-06-28T10:00:00Z",
    webLink: "https://outlook.office.com/mail/item/mail-1",
    from: { emailAddress: { name: "Maya" } },
    bodyPreview: "This is blocking the rollout.",
    importance: "high"
  });

  assert.equal(event.source, "mail");
  assert.equal(event.kind, "message");
  assert.equal(event.project, "payments");
  assert.ok(event.confidence > 0.9);
  assert.match(event.summary, /Maya/);
});

test("maps Teams chat messages to WorkContextEvent input", () => {
  const event = mapTeamsChatMessage(
    {
      id: "msg-1",
      createdDateTime: "2026-06-28T11:00:00Z",
      from: { user: { displayName: "Robin" } },
      body: { content: "<div>Can you check the production incident?</div>" },
      mentions: [{ id: 0 }]
    },
    "chat-1"
  );

  assert.equal(event.source, "teams");
  assert.equal(event.kind, "mentioned");
  assert.equal(event.project, "incident");
  assert.equal(event.ref.thread, "chat-1:msg-1");
});

test("maps Teams meeting and transcript metadata", () => {
  const meeting = mapOnlineMeeting({
    id: "meeting-1",
    subject: "Platform rollout",
    startDateTime: "2026-06-28T12:00:00Z",
    joinWebUrl: "https://teams.microsoft.com/l/meetup-join/redacted"
  });
  const transcript = mapTranscript(
    {
      id: "transcript-1",
      createdDateTime: "2026-06-28T13:00:00Z",
      transcriptContentUrl: "https://graph.microsoft.com/transcripts/transcript-1"
    },
    "meeting-1"
  );

  assert.equal(meeting.source, "meeting");
  assert.equal(meeting.kind, "calendar_event");
  assert.equal(transcript.source, "meeting");
  assert.equal(transcript.kind, "meeting_action");
});
