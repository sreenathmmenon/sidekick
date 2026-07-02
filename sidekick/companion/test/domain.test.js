import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWorkContextEvent } from "../src/domain.js";

test("normalizes and redacts WorkContextEvent", () => {
  const event = normalizeWorkContextEvent({
    source: "editor",
    kind: "edited_file",
    ref: {
      file: "src/payments.ts",
      url: "https://example.test/?token=secret-value"
    },
    summary: "Edited payment code for alex@example.com",
    project: "payments",
    confidence: 0.9,
    origin: "work"
  });

  assert.equal(event.source, "editor");
  assert.equal(event.kind, "edited_file");
  assert.equal(event.summary, "Edited payment code for [REDACTED]");
  assert.match(event.ref.url, /\[REDACTED\]/);
  assert.equal(event.confidence, 0.9);
  assert.ok(event.id);
  assert.ok(event.ts);
});

test("rejects unsupported source", () => {
  assert.throws(
    () =>
      normalizeWorkContextEvent({
        source: "unknown",
        kind: "edited_file",
        summary: "Edited file",
        confidence: 1,
        origin: "work"
      }),
    /Unsupported source/
  );
});

test("rejects out of range confidence", () => {
  assert.throws(
    () =>
      normalizeWorkContextEvent({
        source: "editor",
        kind: "edited_file",
        summary: "Edited file",
        confidence: 1.5,
        origin: "work"
      }),
    /confidence/
  );
});

test("rejects events without provenance", () => {
  assert.throws(
    () =>
      normalizeWorkContextEvent({
        source: "editor",
        kind: "edited_file",
        summary: "Edited file",
        confidence: 1,
        origin: "work"
      }),
    /ref/
  );
});
