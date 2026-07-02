import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mapReviewRequest, mapAssigned, syncGitHub } from "../src/github.js";
import { normalizeWorkContextEvent } from "../src/domain.js";
import { TimelineStore } from "../src/store.js";
import { deriveFromEvent } from "../src/derive.js";
import { getCommitments } from "../src/capabilities.js";

test("mapReviewRequest produces an owed-by-me commitment hint", () => {
  const event = mapReviewRequest({
    title: "Add idempotent retry policy",
    number: 482,
    html_url: "https://github.com/acme/payments/pull/482",
    user: { login: "maya" },
    updated_at: "2026-06-29T10:00:00Z"
  });
  assert.equal(event.source, "github");
  assert.equal(event.kind, "reviewing_pr");
  assert.equal(event.ref.commitment.direction, "owed_by_me");
  assert.equal(event.ref.commitment.who, "maya");
  assert.match(event.summary, /Review requested by maya/);
  // It must survive normalization (ref.commitment preserved through redaction).
  const normalized = normalizeWorkContextEvent(event);
  assert.equal(normalized.ref.commitment.direction, "owed_by_me");
});

test("mapAssigned distinguishes PRs from issues", () => {
  const pr = mapAssigned({ title: "Fix flaky test", number: 12, html_url: "https://github.com/acme/platform/pull/12", pull_request: {}, updated_at: "2026-06-29T10:00:00Z" });
  assert.equal(pr.kind, "reviewing_pr");
  assert.equal(pr.ref.pr, "acme/platform#12");

  const issue = mapAssigned({ title: "Investigate duplicate capture", number: 1842, html_url: "https://github.com/acme/payments/issues/1842", updated_at: "2026-06-29T10:00:00Z" });
  assert.equal(issue.kind, "opened_ticket");
  assert.equal(issue.ref.ticket, "acme/payments#1842");
});

test("structural GitHub events become commitments without text regex", () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-gh-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  try {
    const event = normalizeWorkContextEvent(mapReviewRequest({
      title: "Add retry policy", number: 1, html_url: "https://github.com/acme/payments/pull/1",
      user: { login: "priya" }, updated_at: "2026-06-29T10:00:00Z"
    }));
    store.appendEvent(event);
    const derived = deriveFromEvent(store, event);
    assert.equal(derived.commitments.length, 1);
    assert.equal(derived.commitments[0].direction, "owed_by_me");
    assert.ok(getCommitments(store).commitments.some((c) => c.what.includes("Review requested by priya")));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncGitHub maps search results via an injected fetch and stores them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-ghsync-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  try {
    const fakeFetch = async (url) => {
      const body = url.includes("review-requested")
        ? { items: [{ title: "Review me", number: 5, html_url: "https://github.com/acme/payments/pull/5", user: { login: "sam" }, updated_at: "2026-06-29T10:00:00Z" }] }
        : url.includes("assignee")
          ? { items: [{ title: "My issue", number: 9, html_url: "https://github.com/acme/payments/issues/9", updated_at: "2026-06-29T10:00:00Z" }] }
          : { login: "me" }; // /user
      return { ok: true, json: async () => body };
    };
    const result = await syncGitHub({ token: "ghp_fake", login: "me" }, store, deriveFromEvent, { fetch: fakeFetch });
    assert.equal(result.ok, true);
    assert.equal(result.imported, 2);
    const commitments = getCommitments(store).commitments;
    assert.ok(commitments.length >= 2, "review request + assignment should both derive commitments");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncGitHub surfaces API errors per source without throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sk-gherr-"));
  const store = new TimelineStore(join(dir, "t.sqlite"));
  try {
    const failingFetch = async () => ({ ok: false, json: async () => ({ message: "Bad credentials" }) });
    const result = await syncGitHub({ token: "ghp_bad", login: "me" }, store, deriveFromEvent, { fetch: failingFetch });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 1);
    assert.match(result.errors[0].error, /Bad credentials/);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
