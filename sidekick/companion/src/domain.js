import { randomUUID } from "node:crypto";
import { redactRef, redactText } from "./redaction.js";

export const SOURCES = new Set([
  "editor",
  "github",
  "jira",
  "slack",
  "teams",
  "mail",
  "calendar",
  "meeting",
  "docs",
  "browser"
]);

export const ORIGINS = new Set(["work", "personal"]);

export const KNOWN_KINDS = new Set([
  "edited_file",
  "opened_file",
  "reviewing_pr",
  "opened_ticket",
  "mentioned",
  "message",
  "read_doc",
  "meeting_action",
  "calendar_event"
]);

export function normalizeWorkContextEvent(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Expected WorkContextEvent object");
  }

  const source = requiredString(input.source, "source");
  if (!SOURCES.has(source)) {
    throw new ValidationError(`Unsupported source: ${source}`);
  }

  const kind = requiredString(input.kind, "kind");
  if (!KNOWN_KINDS.has(kind) && !kind.includes("_")) {
    throw new ValidationError(`Unsupported kind: ${kind}`);
  }

  const origin = requiredString(input.origin, "origin");
  if (!ORIGINS.has(origin)) {
    throw new ValidationError(`Unsupported origin: ${origin}`);
  }

  const confidence = Number(input.confidence ?? 1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new ValidationError("confidence must be between 0 and 1");
  }

  const ts = typeof input.ts === "string" && input.ts ? input.ts : now.toISOString();
  if (!Number.isFinite(new Date(ts).getTime())) {
    throw new ValidationError("ts must be an ISO timestamp");
  }

  return {
    id: typeof input.id === "string" && input.id ? input.id : randomUUID(),
    ts,
    source,
    kind,
    ref: requiredRef(input.ref),
    summary: redactText(requiredString(input.summary, "summary")).slice(0, 500),
    project: typeof input.project === "string" && input.project ? redactText(input.project) : null,
    confidence,
    origin
  };
}

export function eventFromRow(row) {
  return {
    id: row.id,
    ts: row.ts,
    source: row.source,
    kind: row.kind,
    ref: JSON.parse(row.ref_json),
    summary: row.summary,
    project: row.project,
    confidence: row.confidence,
    origin: row.origin
  };
}

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
  }
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`Missing required string field: ${fieldName}`);
  }

  return value.trim();
}

function requiredRef(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Missing required ref object");
  }

  const ref = redactRef(value);
  if (Object.keys(ref).length === 0) {
    throw new ValidationError("ref must include at least one provenance field");
  }

  return ref;
}
