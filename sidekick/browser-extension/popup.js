const els = {
  baseUrl: document.getElementById("baseUrl"),
  token: document.getElementById("token"),
  status: document.getElementById("status"),
  pageTitle: document.getElementById("pageTitle"),
  pageMeta: document.getElementById("pageMeta"),
  pageKind: document.getElementById("pageKind"),
  focus: document.getElementById("focus"),
  focusMode: document.getElementById("focusMode"),
  answer: document.getElementById("answer")
};

let tabSnapshot = null;
let pageContext = null;
let ignoredHosts = new Set();
const REQUEST_TIMEOUT_MS = 8000;

init();

// Wraps an async click handler so any rejection surfaces in the answer box and
// status pill instead of dying silently in the console.
function guard(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      showAnswer(`⚠ ${error.message || "Something went wrong."}`);
      setStatus("Error", "bad");
    }
  };
}

async function init() {
  const saved = await chrome.storage.local.get(["baseUrl", "token", "ignoredHosts"]);
  els.baseUrl.value = saved.baseUrl || els.baseUrl.value;
  els.token.value = saved.token || "";
  ignoredHosts = new Set(saved.ignoredHosts || []);

  tabSnapshot = await activeTab();
  pageContext = await activePageContext();
  renderPage(tabSnapshot, pageContext);

  document.getElementById("save").addEventListener("click", guard(saveSettings));
  document.getElementById("capture").addEventListener("click", guard(capturePage));
  document.getElementById("ignore").addEventListener("click", guard(ignorePage));
  document.getElementById("todoAdd").addEventListener("click", guard(addTodo));
  document.getElementById("todoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") guard(addTodo)(); });

  // Reflect real connection state on open so the user isn't guessing.
  await checkConnection();
  await refreshTodoCount();
  // The popup is a thin capture surface. Focus is shown read-only here; you START
  // and END focus from the Memory Console or editor, which is where you actually work.
  await refreshFocus();
}

// Pings the companion so the header pill shows Connected / Offline / No token on open.
async function checkConnection() {
  if (!token()) { setStatus("No token", "bad"); return; }
  try {
    const res = await fetch(baseUrl() + "/health");
    setStatus(res.ok ? "Connected" : "Offline", res.ok ? "ok" : "bad");
  } catch {
    setStatus("Offline", "bad");
  }
}

function hostOf(url) {
  try { return new URL(url).host; } catch { return null; }
}

// Quick-add a task to today's list (captured to ~/.sidekick/TODO.md), without leaving the tab.
async function addTodo() {
  const input = document.getElementById("todoInput");
  const text = input.value.trim();
  if (!text) return;
  const payload = await api("/todos/add", { method: "POST", body: { text } });
  input.value = "";
  document.getElementById("todoCount").textContent = payload.view?.open_today ?? 0;
  showAnswer(`Added to today: ${text}`);
}

async function refreshTodoCount() {
  if (!token()) return;
  try {
    const res = await fetch(baseUrl() + "/todos", { headers: { authorization: `Bearer ${token()}` } });
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById("todoCount").textContent = data.view?.open_today ?? 0;
  } catch { /* offline */ }
}

async function saveSettings() {
  await chrome.storage.local.set({ baseUrl: baseUrl(), token: token() });
  setStatus("Saved", "ok");
}

function renderPage(tab, context) {
  if (!tab) {
    els.pageTitle.textContent = "No active page.";
    els.pageMeta.textContent = "Open a GitHub, Jira, docs, Outlook, or Teams page.";
    return;
  }
  // Browser-internal pages can't be read or captured — say so instead of failing silently.
  if (/^(chrome|edge|about|chrome-extension|moz-extension):/.test(tab.url || "")) {
    els.pageTitle.textContent = "Browser page — can't capture here.";
    els.pageMeta.textContent = "Switch to a normal web page (a PR, ticket, or doc) to capture it.";
    els.pageKind.textContent = "n/a";
    document.getElementById("capture").disabled = true;
    return;
  }
  const kind = inferKind(context?.url || tab.url || "");
  const title = context?.h1 || context?.title || tab.title || tab.url || "Untitled page";
  const metaBits = [
    context?.description,
    context?.selection ? `Selected: ${context.selection}` : null,
    context?.excerpt ? `Excerpt: ${context.excerpt}` : null,
    inferProject(context?.url || tab.url || "", context?.title || tab.title || "") || null
  ].filter(Boolean);
  els.pageTitle.textContent = title;
  els.pageMeta.textContent = metaBits.length > 0 ? metaBits.join(" • ") : "No project inferred yet";
  els.pageKind.textContent = kind;
}

async function capturePage() {
  const tab = tabSnapshot || await activeTab();
  const context = pageContext || await activePageContext();
  if (!tab?.url) return showAnswer("No active page to capture.");

  const host = hostOf(context?.url || tab.url);
  if (host && ignoredHosts.has(host)) {
    showAnswer(`${host} is on your ignore list. Nothing was captured.`);
    setStatus("Ignored", "ok");
    return;
  }

  const event = {
    source: inferSource(context?.url || tab.url),
    kind: inferKind(context?.url || tab.url),
    ref: {
      url: context?.canonicalUrl || context?.url || tab.url,
      file: context?.selection || undefined
    },
    summary: `Read page: ${context?.h1 || context?.title || tab.title || tab.url}`,
    project: inferProject(context?.url || tab.url, `${context?.title || tab.title || ""} ${context?.h1 || ""} ${context?.selection || ""}`),
    confidence: context?.selection ? 0.9 : 0.82,
    origin: "work"
  };

  const btn = document.getElementById("capture");
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Capturing…";
  try {
    const payload = await api("/events", { method: "POST", body: event });
    showAnswer(`Captured as ${payload.event.source}/${payload.event.kind}. Provenance: ${formatRef(payload.event.ref)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function ignorePage() {
  const tab = tabSnapshot || await activeTab();
  const host = hostOf(pageContext?.url || tab?.url || "");
  if (!host) {
    showAnswer("Could not determine this page's host.");
    return;
  }
  ignoredHosts.add(host);
  await chrome.storage.local.set({ ignoredHosts: [...ignoredHosts] });
  showAnswer(`${host} added to your ignore list. Sidekick will not capture it until you remove it.`);
  setStatus("Ignored", "ok");
}

async function refreshFocus() {
  try {
    const payload = await api("/focus/current");
    if (payload.active && payload.session) {
      const minutes = Math.ceil((payload.remaining_seconds || 0) / 60);
      els.focus.textContent = `${minutes}m left: ${payload.session.focus}`;
      els.focusMode.textContent = payload.attention_policy;
      els.focusMode.className = "tag warn";
    } else {
      els.focus.textContent = "No active focus session.";
      els.focusMode.textContent = "Ambient";
      els.focusMode.className = "tag";
    }
  } catch (error) {
    els.focus.textContent = "Connect to Local Companion to see focus state.";
  }
}

async function api(path, options = {}) {
  if (!token()) {
    setStatus("No token", "bad");
    throw new Error("Set a companion token under Connection.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(baseUrl() + path, {
      method: options.method || "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token()}`
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(payload.error || response.statusText, "bad");
      throw new Error(payload.error || response.statusText);
    }
    setStatus("Connected", "ok");
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Timeout", "bad");
      throw new Error("Local Companion did not respond. Is it running?");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function activePageContext() {
  const tab = tabSnapshot || await activeTab();
  if (!tab?.id) return null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const canonical = document.querySelector('link[rel="canonical"]')?.href || null;
        const description = document.querySelector('meta[name="description"]')?.content || null;
        const h1 = document.querySelector("h1")?.textContent?.trim() || null;
        const selection = window.getSelection()?.toString().trim() || null;
        const excerpt = Array.from(document.querySelectorAll("p"))
          .map((node) => node.textContent.trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(" ")
          .slice(0, 220) || null;

        return {
          url: location.href,
          title: document.title,
          canonicalUrl: canonical,
          description,
          h1,
          selection,
          excerpt
        };
      }
    });
    return result?.result || null;
  } catch (error) {
    return null;
  }
}

function showAnswer(text) {
  els.answer.textContent = text || "No answer.";
}

function setStatus(text, state = "") {
  els.status.textContent = text;
  els.status.className = `pill ${state}`;
}

function baseUrl() { return els.baseUrl.value.replace(/\/$/, ""); }
function token() { return els.token.value.trim(); }
function formatRef(ref) { return ref?.url || ref?.file || ref?.ticket || ref?.thread || "source"; }
function inferKind(url) {
  if (/github\.com/.test(url)) return "reviewing_pr";
  if (/atlassian|jira|linear/.test(url)) return "opened_ticket";
  return "read_doc";
}
// Map the page to a real canonical source so a PR/ticket the user has open can
// feed Commitments/Triage — not just "browser". Generic pages stay "browser".
function inferSource(url) {
  if (/github\.com/.test(url)) return "github";
  if (/atlassian|jira|linear/.test(url)) return "jira";
  return "browser";
}
function inferProject(url, title) {
  const text = `${url} ${title}`.toLowerCase();
  if (text.includes("payment") || text.includes("checkout")) return "payments";
  if (text.includes("incident")) return "incident";
  if (text.includes("platform")) return "platform";
  return null;
}
