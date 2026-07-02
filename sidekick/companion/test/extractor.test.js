import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectExtractorTier, llmExtract, enrichEventAsync } from "../src/extractor.js";
import { redactForCloud } from "../src/redaction.js";
import { TimelineStore } from "../src/store.js";
import { normalizeWorkContextEvent } from "../src/domain.js";
import { getCommitments } from "../src/capabilities.js";

// ---- The security-critical property: auto NEVER selects cloud ----
test("auto mode never resolves to cloud, even with an API key present", () => {
  assert.equal(selectExtractorTier({ llm: { mode: "auto", apiKey: "sk-ant-xxx" } }), "regex");
  assert.equal(selectExtractorTier({ llm: { mode: "auto", apiKey: "sk-ant-xxx", localUrl: "http://127.0.0.1:11434" } }), "local");
  assert.equal(selectExtractorTier({ llm: { mode: "auto" } }), "regex");
});

test("cloud is only reachable via explicit mode:cloud + key", () => {
  assert.equal(selectExtractorTier({ llm: { mode: "cloud", apiKey: "sk-ant-xxx" } }), "cloud");
  assert.equal(selectExtractorTier({ llm: { mode: "cloud" } }), "regex"); // no key -> falls back, never silently cloud
  assert.equal(selectExtractorTier({ llm: { mode: "local", localUrl: "http://127.0.0.1:11434" } }), "local");
  assert.equal(selectExtractorTier({ llm: { mode: "off" } }), "regex");
});

// ---- Cloud egress is redacted + source-gated ----
test("redactForCloud masks personal names but keeps structure", () => {
  const out = redactForCloud("Maya asked Priya to review the payments PR by Friday");
  assert.ok(!out.includes("Maya"), "names should be masked");
  assert.ok(!out.includes("Priya"), "names should be masked");
  assert.ok(out.includes("[NAME]"));
  assert.ok(out.includes("Friday"), "allow-listed day kept for due inference");
});

test("cloud extraction refuses sensitive sources (no egress for 1:1/meeting)", async () => {
  let called = false;
  const fakeFetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  const config = { llm: { mode: "cloud", apiKey: "sk-ant-xxx", cloudBlockedSources: ["meeting", "mail", "teams"] } };
  const result = await llmExtract("Action: send the perf review", config, { fetch: fakeFetch, source: "meeting" });
  assert.equal(result, null, "blocked source returns no AI result");
  assert.equal(called, false, "NO network call is made for a blocked source");
});

test("llmExtract never throws and returns null on a failed call", async () => {
  const failing = async () => ({ ok: false, json: async () => ({ error: { message: "boom" } }) });
  const config = { llm: { mode: "cloud", apiKey: "sk-ant-xxx", cloudBlockedSources: [] } };
  const result = await llmExtract("Can you ship it?", config, { fetch: failing, source: "slack" });
  assert.equal(result, null);
});

// ---- Enrichment adds AI-tagged commitments through a fake local model ----
test("enrichEventAsync adds AI-tagged commitments via an injected local model", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-enrich-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  try {
    const fakeOllama = async () => ({
      ok: true,
      json: async () => ({ response: JSON.stringify({
        commitments: [{ what: "circle back with Priya on the rollout", who: "Priya", direction: "owed_by_me", due_hint: null }],
        decisions: [], lessons: []
      }) })
    });
    const config = { llm: { mode: "local", localUrl: "http://127.0.0.1:11434", cloudBlockedSources: [] } };
    const event = normalizeWorkContextEvent({ source: "slack", kind: "message", ref: { thread: "C1" }, summary: "let's circle back after I sync with Priya", project: "payments", confidence: 0.9, origin: "work" });
    store.appendEvent(event);

    const result = await enrichEventAsync(store, event, config, { fetch: fakeOllama });
    assert.equal(result.tier, "local");
    assert.equal(result.added, 1);

    const aiItem = getCommitments(store).commitments.find((c) => (c.extractor || "").startsWith("llm"));
    assert.ok(aiItem, "an AI-tagged commitment should exist");
    assert.equal(aiItem.extractor, "llm:local");
    assert.match(aiItem.what, /circle back/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("enrichEventAsync is a no-op when no AI tier is active", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-enrich2-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  try {
    const config = { llm: { mode: "auto" } }; // no localUrl -> regex
    const event = normalizeWorkContextEvent({ source: "slack", kind: "message", ref: { thread: "C1" }, summary: "hello", project: null, confidence: 0.9, origin: "work" });
    store.appendEvent(event);
    const result = await enrichEventAsync(store, event, config, { fetch: async () => { throw new Error("should not be called"); } });
    assert.equal(result.tier, "regex");
    assert.equal(result.added, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
