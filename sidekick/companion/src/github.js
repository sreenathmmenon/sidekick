import { normalizeWorkContextEvent } from "./domain.js";

// GitHub connector — local-first, read-only, fine-grained PAT (no OAuth server).
//
// Pulls the two highest-value signals for an engineer's day:
//   1. PRs where YOU are a requested reviewer   -> "owed by me" commitment
//   2. Issues/PRs ASSIGNED to you               -> "owned by me" commitment
//
// Each result is mapped to a canonical WorkContextEvent carrying a structural
// `ref.commitment` hint, so it becomes a Commitment without depending on text regex.
// Pure mapper functions are exported for unit testing without network access.

const API_ROOT = "https://api.github.com";

export async function syncGitHub(input, store, deriveFromEventFn, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const token = requireString(input.token, "token");
  const results = [];
  const errors = [];

  // Resolve the authenticated login so we can scope review-requests/assignments to "me".
  let login = input.login;
  if (!login) {
    await collect("viewer", [], errors, async () => {
      const me = await githubGet(fetchImpl, token, "/user");
      login = me.login;
      return [];
    });
  }

  await collect("reviewRequests", results, errors, async () => {
    if (input.includeReviewRequests === false || !login) return [];
    // Search PRs that request you as a reviewer and are still open.
    const data = await githubGet(
      fetchImpl, token,
      `/search/issues?q=${encodeURIComponent(`is:open is:pr review-requested:${login}`)}&per_page=20`
    );
    return (data.items || []).map(mapReviewRequest);
  });

  await collect("assigned", results, errors, async () => {
    if (input.includeAssigned === false || !login) return [];
    const data = await githubGet(
      fetchImpl, token,
      `/search/issues?q=${encodeURIComponent(`is:open assignee:${login}`)}&per_page=20`
    );
    return (data.items || []).map(mapAssigned);
  });

  const stored = [];
  for (const eventInput of results) {
    const event = normalizeWorkContextEvent(eventInput);
    // Each event + its derived rows commit atomically.
    const derived = store.transaction(() => {
      store.appendEvent(event);
      return deriveFromEventFn(store, event);
    });
    stored.push({ event, derived });
  }

  return {
    ok: errors.length === 0,
    connector: "GitHub",
    login: login || null,
    imported: stored.length,
    stored,
    errors
  };
}

// A PR awaiting YOUR review -> you owe the author a review.
export function mapReviewRequest(item) {
  const repo = repoFromUrl(item.html_url);
  const title = clean(item.title || "Untitled pull request");
  const author = item.user?.login || "someone";
  return {
    ts: item.updated_at ? toIso(item.updated_at) : new Date().toISOString(),
    source: "github",
    kind: "reviewing_pr",
    ref: {
      url: item.html_url,
      pr: repo ? `${repo}#${item.number}` : `#${item.number}`,
      commitment: { direction: "owed_by_me", who: author }
    },
    summary: `Review requested by ${author}: ${title}${repo ? ` (${repo}#${item.number})` : ""}`,
    project: inferProject(`${repo || ""} ${title}`),
    confidence: 0.9,
    origin: "work"
  };
}

// An issue/PR assigned to YOU -> something you own.
export function mapAssigned(item) {
  const repo = repoFromUrl(item.html_url);
  const isPr = Boolean(item.pull_request);
  const title = clean(item.title || "Untitled item");
  const ref = repo ? `${repo}#${item.number}` : `#${item.number}`;
  return {
    ts: item.updated_at ? toIso(item.updated_at) : new Date().toISOString(),
    source: "github",
    kind: isPr ? "reviewing_pr" : "opened_ticket",
    ref: {
      url: item.html_url,
      [isPr ? "pr" : "ticket"]: ref,
      commitment: { direction: "owed_by_me", who: "me" }
    },
    summary: `Assigned to you: ${title} (${ref})`,
    project: inferProject(`${repo || ""} ${title}`),
    confidence: 0.9,
    origin: "work"
  };
}

async function githubGet(fetchImpl, token, path) {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "sidekick-local-companion"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `${response.status} ${response.statusText}`);
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

function repoFromUrl(htmlUrl) {
  const match = String(htmlUrl || "").match(/github\.com\/([^/]+\/[^/]+)\//);
  return match ? match[1] : null;
}

function requireString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw Object.assign(new Error(`Missing required field: ${fieldName}`), { statusCode: 400 });
  }
  return value.trim();
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
