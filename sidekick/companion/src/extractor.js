import { logger } from "./logger.js";
import { redactForCloud } from "./redaction.js";

// Pluggable extraction — turns messy human text into structured commitments,
// decisions, and lessons. Three tiers, auto-selected by what's configured, so the
// user never has to choose and the local-first floor is never broken:
//
//   1. regex (always available)  — zero setup, offline, inspectable. The FLOOR.
//   2. local LLM (Ollama)        — privacy-mode: nothing leaves the machine.
//   3. cloud LLM (Claude)        — best quality when an API key is present.
//
// AI is an OPTIONAL ACCELERATOR, never a dependency: everything degrades gracefully
// down the tiers (cloud fails -> local -> regex) and never throws into the caller.
// Every AI-derived item still flows through the same proposed -> confirm/dismiss gate
// with provenance — AI proposes, the human stays in control.

const EXTRACTION_SCHEMA_HINT = `Return ONLY valid JSON of shape:
{"commitments":[{"what":string,"who":string,"direction":"owed_by_me"|"owed_to_me","due_hint":string|null}],
 "decisions":[string],
 "lessons":[{"topic":string,"insight":string}]}
- "who" is the counterparty ("me" if the user owns it).
- direction: owed_by_me = the user must do it; owed_to_me = someone else owes the user.
- Only include REAL obligations/decisions/lessons. Empty arrays if none. No prose.`;

// Picks the active tier from config. Pure, so it's easy to test.
//
// FAIL-CLOSED on egress: "auto" NEVER resolves to cloud — only local or regex —
// so a stray ANTHROPIC_API_KEY in the environment can never cause an outbound
// request. Cloud is reachable ONLY via an explicit mode: "cloud". This is a
// deliberate security property, not a default; the regulated persona's hard line.
export function selectExtractorTier(config) {
  const llm = config.llm || {};
  const mode = llm.mode || "auto";

  if (mode === "off" || mode === "regex") return "regex";
  if (mode === "cloud") return llm.apiKey ? "cloud" : "regex"; // explicit opt-in required
  if (mode === "local") return llm.localUrl ? "local" : "regex";

  // mode === "auto": prefer a local model if configured; otherwise regex.
  // Cloud is intentionally unreachable here even if an apiKey exists.
  if (llm.localUrl) return "local";
  return "regex";
}

// Runs LLM extraction for one piece of text. Returns null on any failure (caller
// keeps the deterministic result). Never throws.
//
// `source` lets the cloud tier refuse sensitive origins (1:1s, mail, chat) — the
// EM/Legal requirement. The cloud payload is ALSO redacted before it leaves the
// machine, so "no sensitive text egress" is enforced in the path, not just promised.
export async function llmExtract(text, config, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const tier = deps.tierOverride || selectExtractorTier(config);
  const source = deps.source || null;
  if (tier === "regex" || !text || !text.trim()) return null;

  try {
    if (tier === "cloud") {
      const blocked = config.llm?.cloudBlockedSources || [];
      if (source && blocked.includes(source)) {
        logger.info("cloud extraction skipped for sensitive source", { source });
        return null; // fall back to local/regex result; never sends 1:1/mail/chat to cloud
      }
      const safeText = redactForCloud(text); // redact NAMES/PII on the payload itself, not just secrets
      const raw = await callClaude(safeText, config, fetchImpl);
      return finalize(raw, "cloud");
    }
    const raw = await callOllama(text, config, fetchImpl); // local never leaves the machine
    return finalize(raw, "local");
  } catch (error) {
    logger.warn("llm extraction failed; falling back to deterministic", { tier, error: error.message });
    return null;
  }
}

function finalize(raw, tier) {
  const parsed = safeParse(raw);
  return parsed ? normalizeExtraction(parsed, tier) : null;
}

// Async enrichment hook: runs AFTER the synchronous regex derive, never blocking
// the request. If an AI tier is active it extracts from the event text and upserts
// any commitments the regex floor missed — tagged with tier + confidence + the
// source span — through the SAME proposed->confirm/dismiss gate. Fire-and-forget;
// any failure is swallowed (the deterministic result already stands).
export async function enrichEventAsync(store, event, config, deps = {}) {
  try {
    const tier = selectExtractorTier(config);
    if (tier === "regex") return { tier: "regex", added: 0 };

    const extraction = await llmExtract(event.summary, config, { ...deps, source: event.source });
    if (!extraction || !extraction.commitments?.length) return { tier, added: 0 };

    let added = 0;
    for (const c of extraction.commitments) {
      const id = `commitment_ai_${hash(event.id + ":" + c.what)}`;
      // Don't override a user decision or a structural connector item.
      const existing = store.listCommitments({ limit: 500 }).find((x) => x.id === id);
      if (existing && ["confirmed", "dismissed"].includes(existing.status)) continue;
      store.upsertCommitment({
        id,
        source_event_id: event.id,
        direction: c.direction,
        what: c.what,
        who: c.who,
        due: null,
        status: "proposed",
        confidence: tier === "cloud" ? 0.8 : 0.75,
        provenance_ref: event.ref,
        extractor: `llm:${tier}`,
        match_reason: c.due_hint ? `AI (${tier}), due hint: ${c.due_hint}` : `AI (${tier})`
      });
      added += 1;
    }
    if (added) logger.info("ai enrichment added commitments", { tier, added, eventId: event.id });
    return { tier, added };
  } catch (error) {
    logger.warn("ai enrichment failed", { error: error.message });
    return { tier: "regex", added: 0, error: error.message };
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

async function callClaude(text, config, fetchImpl) {
  const model = config.llm?.model || "claude-haiku-4-5-20251001";
  const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.llm.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: `You extract structured work obligations from text. ${EXTRACTION_SCHEMA_HINT}`,
      messages: [{ role: "user", content: text.slice(0, 8000) }]
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `${response.status} ${response.statusText}`);
  return payload.content?.[0]?.text || "";
}

async function callOllama(text, config, fetchImpl) {
  const base = (config.llm?.localUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = config.llm?.model || "llama3.1";
  const response = await fetchImpl(`${base}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      prompt: `${EXTRACTION_SCHEMA_HINT}\n\nExtract from this text:\n${text.slice(0, 8000)}`
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload.response || "";
}

function safeParse(raw) {
  if (!raw) return null;
  // Models sometimes wrap JSON in prose or fences; grab the first {...} block.
  const match = String(raw).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// Validates/clamps model output so a hallucinated shape can't corrupt the store.
function normalizeExtraction(parsed, tier) {
  const commitments = Array.isArray(parsed.commitments) ? parsed.commitments : [];
  const decisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const lessons = Array.isArray(parsed.lessons) ? parsed.lessons : [];
  return {
    tier,
    commitments: commitments
      .filter((c) => c && typeof c.what === "string" && c.what.trim())
      .slice(0, 30)
      .map((c) => ({
        what: String(c.what).slice(0, 300).trim(),
        who: typeof c.who === "string" && c.who.trim() ? c.who.slice(0, 80).trim() : "me",
        direction: c.direction === "owed_to_me" ? "owed_to_me" : "owed_by_me",
        due_hint: typeof c.due_hint === "string" ? c.due_hint.slice(0, 40) : null
      })),
    decisions: decisions.filter((d) => typeof d === "string" && d.trim()).slice(0, 20).map((d) => d.slice(0, 300).trim()),
    lessons: lessons
      .filter((l) => l && typeof l.insight === "string" && l.insight.trim())
      .slice(0, 20)
      .map((l) => ({ topic: String(l.topic || "general").slice(0, 80), insight: String(l.insight).slice(0, 300).trim() }))
  };
}
