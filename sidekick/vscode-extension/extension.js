const vscode = require("vscode");

const debounceTimers = new Map();
const REQUEST_TIMEOUT_MS = 8000;

// Module-level handle to VS Code SecretStorage so the bearer token never has to
// live in plaintext settings.json. Set in activate().
let secretStorage = null;

function activate(context) {
  secretStorage = context.secrets;
  const output = vscode.window.createOutputChannel("Sidekick");
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "sidekick.startFocusSession";
  statusBar.text = "$(sparkle) Sidekick";
  statusBar.tooltip = "Start Sidekick Focus Session";
  statusBar.show();
  context.subscriptions.push(output);
  context.subscriptions.push(statusBar);

  // One-time migration: if a token was previously kept in settings.json, move it
  // into SecretStorage and clear the plaintext copy.
  migrateTokenToSecretStorage(output);

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.setToken", async () => {
      const token = await vscode.window.showInputBox({
        title: "Sidekick Local Companion Token",
        prompt: "Paste your companion bearer token. Stored in the OS secret store, never in settings.",
        password: true,
        ignoreFocusOut: true
      });
      if (token === undefined) return;
      await secretStorage.store("sidekick.authToken", token.trim());
      vscode.window.showInformationMessage("Sidekick token saved to the OS secret store.");
      updateFocusStatusFromCompanion(statusBar);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!getConfig().captureEditedFiles) {
        return;
      }

      const document = event.document;
      if (document.uri.scheme !== "file" || document.isUntitled) {
        return;
      }

      const key = document.uri.toString();
      const existing = debounceTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        debounceTimers.delete(key);
        postEditedFileEvent(document, output);
      }, 1500);

      debounceTimers.set(key, timer);
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!getConfig().captureEditedFiles || !editor) {
        return;
      }

      const document = editor.document;
      if (document.uri.scheme !== "file" || document.isUntitled) {
        return;
      }

      const key = `active:${document.uri.toString()}`;
      const existing = debounceTimers.get(key);
      if (existing) {
        clearTimeout(existing);
      }

      const timer = setTimeout(() => {
        debounceTimers.delete(key);
        postOpenedFileEvent(document, output);
      }, 1000);

      debounceTimers.set(key, timer);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.openPanel", async () => {
      try {
        // allSettled so one slow/failing endpoint degrades gracefully instead of
        // blanking the whole panel; missing sections just render empty.
        const settled = await Promise.allSettled([
          companionFetch("/resume"),
          companionFetch("/triage"),
          companionFetch("/commitments"),
          companionFetch("/recall"),
          companionFetch("/plan"),
          companionFetch("/focus/current"),
          companionFetch("/todos")
        ]);
        const [resume, triage, commitments, recall, plan, focus, todos] =
          settled.map((s) => (s.status === "fulfilled" ? s.value : {}));
        const panel = vscode.window.createWebviewPanel(
          "sidekickPanel",
          "Sidekick",
          vscode.ViewColumn.Beside,
          { enableScripts: true, retainContextWhenHidden: true }
        );
        panel.webview.html = renderPanelHtml(panel.webview, { resume, triage, commitments, recall, plan, focus, todos });
        // Live refresh: the webview asks the extension to re-fetch and re-render.
        panel.webview.onDidReceiveMessage(async (message) => {
          if (message?.type !== "refresh") return;
          try {
            const settled = await Promise.allSettled([
              companionFetch("/resume"), companionFetch("/triage"), companionFetch("/commitments"),
              companionFetch("/recall"), companionFetch("/plan"), companionFetch("/focus/current"), companionFetch("/todos")
            ]);
            const [r, t, c, rc, p, f, td] = settled.map((s) => (s.status === "fulfilled" ? s.value : {}));
            panel.webview.html = renderPanelHtml(panel.webview, { resume: r, triage: t, commitments: c, recall: rc, plan: p, focus: f, todos: td });
          } catch (error) {
            showCompanionError(error);
          }
        });
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.whereWasI", async () => {
      try {
        const resume = await companionFetch("/resume");
        await showMarkdown("Sidekick Resume", renderResume(resume));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.whatNeedsMeNow", async () => {
      try {
        const triage = await companionFetch("/triage");
        await showMarkdown("Sidekick Triage", renderTriage(triage));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.whatDidIPromise", async () => {
      try {
        const commitments = await companionFetch("/commitments");
        await showMarkdown("Sidekick Commitments", renderCommitments(commitments));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.whatDidILearn", async () => {
      try {
        const recall = await companionFetch("/recall");
        await showMarkdown("Sidekick Recall", renderRecall(recall));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.whatsRealisticToday", async () => {
      try {
        const plan = await companionFetch("/plan");
        await showMarkdown("Sidekick Plan", renderPlan(plan));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.startFocusSession", async () => {
      try {
        const plan = await companionFetch("/plan");
        const defaultFocus = plan.focus_session?.suggested_focus || "Protected deep work";
        const focus = await vscode.window.showInputBox({
          title: "Start Focus Session",
          prompt: "What should Sidekick protect?",
          value: defaultFocus
        });
        if (!focus) return;

        const minutesText = await vscode.window.showInputBox({
          title: "Focus Session Length",
          prompt: "Minutes",
          value: String(plan.focus_session?.suggested_minutes || 45),
          validateInput(value) {
            const minutes = Number(value);
            return Number.isFinite(minutes) && minutes >= 5 && minutes <= 180
              ? undefined
              : "Use 5 to 180 minutes.";
          }
        });
        if (!minutesText) return;

        const payload = await companionFetch("/focus/start", {
          method: "POST",
          body: JSON.stringify({
            focus,
            duration_minutes: Number(minutesText),
            attention_mode: "never"
          })
        });
        updateFocusStatus(statusBar, payload);
        vscode.window.showInformationMessage(`Sidekick Focus Session started: ${focus}`);
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.completeFocusSession", async () => {
      try {
        const payload = await companionFetch("/focus/complete", {
          method: "POST",
          body: JSON.stringify({ status: "completed" })
        });
        updateFocusStatus(statusBar, payload);
        await showMarkdown("Sidekick Focus Session", renderFocusResult(payload));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.addTodo", async () => {
      try {
        const text = await vscode.window.showInputBox({
          title: "Add to today's list",
          prompt: "A new task / interrupt — captured to ~/.sidekick/TODO.md",
          ignoreFocusOut: true
        });
        if (!text || !text.trim()) return;
        await companionFetch("/todos/add", { method: "POST", body: JSON.stringify({ text: text.trim() }) });
        vscode.window.showInformationMessage(`Added to today: ${text.trim()}`);
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sidekick.showCapturedEvents", async () => {
      try {
        const payload = await companionFetch("/events?limit=50");
        await showMarkdown("Sidekick Captured Events", renderEvents(payload.events || []));
      } catch (error) {
        showCompanionError(error);
      }
    })
  );

  output.appendLine("Sidekick Editor Surface activated.");
  updateFocusStatusFromCompanion(statusBar);
  const focusTimer = setInterval(() => updateFocusStatusFromCompanion(statusBar), 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(focusTimer) });
}

function deactivate() {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

async function postEditedFileEvent(document, output) {
  try {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const relativePath = workspaceFolder
      ? vscode.workspace.asRelativePath(document.uri, false)
      : document.uri.fsPath;

    await companionFetch("/events", {
      method: "POST",
      body: JSON.stringify({
        ts: new Date().toISOString(),
        source: "editor",
        kind: "edited_file",
        ref: { file: relativePath },
        summary: `Edited ${relativePath}`,
        project: workspaceFolder ? workspaceFolder.name : null,
        confidence: 0.98,
        origin: "work"
      })
    });

    output.appendLine(`Captured edited_file: ${relativePath}`);
  } catch (error) {
    output.appendLine(`Capture failed: ${error.message}`);
  }
}

async function postOpenedFileEvent(document, output) {
  try {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const relativePath = workspaceFolder
      ? vscode.workspace.asRelativePath(document.uri, false)
      : document.uri.fsPath;

    await companionFetch("/events", {
      method: "POST",
      body: JSON.stringify({
        ts: new Date().toISOString(),
        source: "editor",
        kind: "opened_file",
        ref: { file: relativePath },
        summary: `Opened ${relativePath}`,
        project: workspaceFolder ? workspaceFolder.name : null,
        confidence: 0.9,
        origin: "work"
      })
    });

    output.appendLine(`Captured opened_file: ${relativePath}`);
  } catch (error) {
    output.appendLine(`Capture failed: ${error.message}`);
  }
}

async function companionFetch(path, options = {}) {
  const config = getConfig();
  const token = await getToken();
  if (!token) {
    throw new Error("No companion token set. Run 'Sidekick: Set Companion Token'.");
  }

  // Abort the request if the companion hangs, so commands never block forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${config.companionUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(options.headers || {})
      },
      body: options.body,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `${response.status} ${response.statusText}`);
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Companion did not respond within ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Reads the token from SecretStorage. Falls back to the legacy plaintext setting
// only if a secret hasn't been stored yet (so existing setups keep working).
async function getToken() {
  const secret = await secretStorage?.get("sidekick.authToken");
  if (secret) return secret;
  return vscode.workspace.getConfiguration("sidekick").get("authToken", "");
}

async function migrateTokenToSecretStorage(output) {
  try {
    const existingSecret = await secretStorage?.get("sidekick.authToken");
    if (existingSecret) return;
    const settingToken = vscode.workspace.getConfiguration("sidekick").get("authToken", "");
    if (settingToken) {
      await secretStorage.store("sidekick.authToken", settingToken);
      await vscode.workspace.getConfiguration("sidekick").update("authToken", "", vscode.ConfigurationTarget.Global);
      output.appendLine("Migrated companion token from settings.json into the OS secret store.");
    }
  } catch (error) {
    output.appendLine(`Token migration skipped: ${error.message}`);
  }
}

function getConfig() {
  const config = vscode.workspace.getConfiguration("sidekick");
  return {
    companionUrl: config.get("companionUrl", "http://127.0.0.1:4317").replace(/\/$/, ""),
    captureEditedFiles: config.get("captureEditedFiles", true)
  };
}

async function showMarkdown(title, content) {
  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content
  });
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside
  });
}

function renderResume(resume) {
  const lines = ["# Sidekick: Where was I?", "", resume.message || "", ""];

  if (resume.gap) {
    lines.push(`Detected gap: ${resume.gap.minutes} minutes`, "");
  }

  if (resume.lastState) {
    lines.push("## Last State", "", `- ${resume.lastState.summary}`, "");
  }

  if (Array.isArray(resume.nextSteps) && resume.nextSteps.length > 0) {
    lines.push("## Proposed Next Steps", "");
    for (const step of resume.nextSteps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }

  if (Array.isArray(resume.resumeEvents) && resume.resumeEvents.length > 0) {
    lines.push("## Provenance", "");
    for (const event of resume.resumeEvents) {
      const ref = event.ref?.file || event.ref?.url || event.ref?.ticket || event.ref?.pr || "";
      lines.push(`- ${event.ts} - ${event.summary}${ref ? ` (${ref})` : ""}`);
    }
  }

  return lines.join("\n");
}

function renderEvents(events) {
  const lines = ["# Sidekick: Captured Events", ""];
  if (events.length === 0) {
    lines.push("No captured events.");
    return lines.join("\n");
  }

  for (const event of events) {
    const ref = event.ref?.file || event.ref?.url || event.ref?.ticket || event.ref?.pr || "";
    lines.push(`- ${event.ts} - ${event.source}/${event.kind} - ${event.summary}${ref ? ` (${ref})` : ""}`);
  }
  return lines.join("\n");
}

function renderTriage(triage) {
  const lines = ["# Sidekick: What needs me now?", "", triage.message || "", ""];
  for (const item of triage.ranked || []) {
    lines.push(`- ${item.score} - ${item.summary}`);
    lines.push(`  - Source: ${item.source}`);
    lines.push(`  - Provenance: ${formatRef(item.provenance_ref)}`);
  }
  if (!triage.ranked || triage.ranked.length === 0) {
    lines.push("Nothing needs you right now.");
  }
  return lines.join("\n");
}

function renderCommitments(payload) {
  const lines = ["# Sidekick: What did I promise?", ""];
  for (const item of payload.commitments || []) {
    lines.push(`- [${item.status}] ${item.direction}: ${item.what}`);
    lines.push(`  - Who: ${item.who}`);
    if (item.due) lines.push(`  - Due: ${item.due}`);
    lines.push(`  - Provenance: ${formatRef(item.provenance_ref)}`);
  }
  if (!payload.commitments || payload.commitments.length === 0) {
    lines.push("No commitments captured yet.");
  }
  return lines.join("\n");
}

function renderRecall(payload) {
  const lines = ["# Sidekick: What did I learn?", "", payload.message || "", ""];
  if (payload.lessons?.length) {
    lines.push("## Lessons", "");
    for (const lesson of payload.lessons) {
      lines.push(`- ${lesson.topic}: ${lesson.insight}`);
      lines.push(`  - Provenance: ${(lesson.source_refs || []).map(formatRef).join(", ")}`);
    }
    lines.push("");
  }
  if (payload.memory?.length) {
    lines.push("## Semantic Memory", "");
    for (const memory of payload.memory) {
      lines.push(`- ${memory.topic}: ${memory.content}`);
    }
  }
  if (!payload.lessons?.length && !payload.memory?.length) {
    lines.push("No durable lessons captured yet.");
  }
  return lines.join("\n");
}

function renderPlan(plan) {
  const lines = ["# Sidekick: What's realistic today?", "", plan.message || "", ""];
  lines.push("## Proposed Day Shape", "");
  for (const block of plan.day_shape || []) {
    lines.push(`- ${block.start}-${block.end}: ${block.label} - ${block.focus}`);
  }
  if (plan.focus_session) {
    lines.push("", "## Focus Session", "");
    lines.push(`- Suggested: ${plan.focus_session.suggested_minutes} min - ${plan.focus_session.suggested_focus}`);
    lines.push(`- Attention: ${plan.focus_session.attention_mode}`);
  }
  if (plan.risks?.length) {
    lines.push("", "## Risks", "");
    for (const risk of plan.risks) {
      lines.push(`- ${risk}`);
    }
  }
  return lines.join("\n");
}

function renderPanelHtml(webview, { resume, triage, commitments, recall, plan, focus, todos }) {
  const nonce = makeNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`
  ].join("; ");
  const minutes = focus.active ? Math.ceil((focus.remaining_seconds || 0) / 60) : 0;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      /* Theme-aware: blends VS Code's own palette with Sidekick's violet/cyan accent. */
      --violet: #8b76ff;
      --cyan: #34e0ea;
      --accent: linear-gradient(135deg, #8b76ff, #34e0ea);
      --glass: color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
      --line: var(--vscode-panel-border, rgba(255,255,255,0.1));
      --muted: var(--vscode-descriptionForeground);
      font-family: var(--vscode-font-family);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; color: var(--vscode-foreground); font-size: 13px; line-height: 1.5;
      background:
        radial-gradient(700px 400px at 10% -10%, rgba(139,118,255,0.14), transparent 60%),
        radial-gradient(600px 400px at 100% 0%, rgba(52,224,234,0.08), transparent 55%),
        var(--vscode-editor-background);
    }
    header { padding: 18px 18px 14px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .brand { display: flex; align-items: center; gap: 11px; }
    .mark { width: 32px; height: 32px; border-radius: 10px; background: var(--accent); display: grid; place-items: center; color: #fff; font-weight: 800; box-shadow: 0 6px 18px rgba(139,118,255,0.4); }
    h1 { margin: 0; font-size: 16px; font-weight: 800; letter-spacing: -0.02em; }
    .sub { color: transparent; background: var(--accent); -webkit-background-clip: text; background-clip: text; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.14em; }
    h2 { margin: 0; font-size: 13px; font-weight: 700; }
    .muted { color: var(--muted); }
    .empty { color: var(--muted); font-size: 12px; padding: 10px 12px; border: 1px dashed var(--line); border-radius: 10px; text-align: center; }
    button {
      font: inherit; cursor: pointer; border-radius: 9px; padding: 7px 13px; font-weight: 700; color: #fff;
      border: none; background: var(--accent); box-shadow: 0 6px 16px rgba(139,118,255,0.35);
    }
    button:hover { filter: brightness(1.08); }
    button:focus-visible { outline: 2px solid var(--vscode-focusBorder, #34e0ea); outline-offset: 2px; }
    main { display: grid; gap: 12px; padding: 16px; }
    section { background: var(--glass); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; backdrop-filter: blur(10px); }
    .focus-card { background: linear-gradient(160deg, rgba(139,118,255,0.16), transparent 65%); }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .body { padding: 12px 14px; display: grid; gap: 9px; }
    .row { border-top: 1px solid var(--line); padding-top: 9px; }
    .row:first-child { border-top: 0; padding-top: 0; }
    .title { font-weight: 650; }
    .focus-title { font-size: 16px; font-weight: 800; letter-spacing: -0.01em; }
    .meta { color: var(--muted); font-size: 12px; margin-top: 3px; }
    .pill { border: 1px solid var(--line); border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 700; color: var(--muted); }
    .pill.ok { color: #6ee7b7; border-color: rgba(110,231,183,0.35); background: rgba(110,231,183,0.1); }
    .pill.focus { color: #fbbf24; border-color: rgba(251,191,36,0.35); background: rgba(251,191,36,0.1); }
    .count { background: rgba(139,118,255,0.16); color: var(--violet); border: 1px solid rgba(139,118,255,0.35); }
    .ico { width: 22px; height: 22px; border-radius: 7px; display: inline-grid; place-items: center; background: rgba(139,118,255,0.16); border: 1px solid rgba(139,118,255,0.3); margin-right: 7px; font-size: 12px; vertical-align: middle; }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="mark">S</div>
      <div><h1>Sidekick</h1><div class="sub">Editor Surface</div></div>
    </div>
    <button id="refresh">↻ Refresh</button>
  </header>
  <main>
    <section class="focus-card">
      <div class="head"><h2>Current Focus</h2><span class="pill ${focus.active ? "focus" : "ok"}">${escapeHtml(focus.active ? `Focus · ${minutes}m left` : "Ambient")}</span></div>
      <div class="body">
        <div class="focus-title">${escapeHtml(focus.session?.focus || resume.lastState?.summary || "No active focus session.")}</div>
        <div class="meta">${escapeHtml(focus.active ? `Protected deep work · attention ${focus.attention_policy || "never"}` : "Start a Focus Session from the command palette.")}</div>
      </div>
    </section>
    ${panelSection("Today's Tasks", "🗒️", (((todos && todos.view && todos.view.sections && todos.view.sections.Today) || []).map((t) => ({ title: t.text, meta: t.checked ? "done" : "open" }))), "No tasks for today. Add one with “Sidekick: Add to Today’s List”.")}
    ${panelSection("Resume", "🧭", (resume.nextSteps || []).map((item) => ({ title: item, meta: "Suggested next step" })).concat((resume.resumeEvents || []).slice(0, 3).map((event) => ({ title: event.summary, meta: formatRef(event.ref) }))), "Edit a file or two — Resume rebuilds from your recent work.")}
    ${panelSection("Triage", "📥", (triage.ranked || []).slice(0, 5).map((item) => ({ title: item.summary, meta: `Score ${item.score} / ${formatRef(item.provenance_ref)}` })), "Nothing needs you right now.")}
    ${panelSection("Commitments", "✅", (commitments.commitments || []).slice(0, 5).map((item) => ({ title: item.what, meta: `${item.direction} / ${item.status} / ${formatRef(item.provenance_ref)}` })), "No promises captured yet — connect Slack/GitHub or paste meeting notes.")}
    ${panelSection("Recall", "🧠", [...(recall.lessons || []).map((item) => ({ title: item.insight, meta: `Lesson / ${item.topic}` })), ...(recall.memory || []).map((item) => ({ title: item.content, meta: `Memory / ${item.topic}` }))].slice(0, 5), "No lessons yet — they surface as you capture work.")}
    ${panelSection("Plan", "🗓️", (plan.day_shape || []).map((block) => ({ title: block.focus, meta: `${block.start}-${block.end} / ${block.label}` })), "Plan appears once there's activity to shape a day around.")}
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
  </script>
</body>
</html>`;
}

function panelSection(title, icon, rows, emptyHint) {
  const body = rows.length
    ? rows.map((row) => `<div class="row"><div class="title">${escapeHtml(row.title)}</div><div class="meta">${escapeHtml(row.meta || "")}</div></div>`).join("")
    : `<div class="empty">${escapeHtml(emptyHint || "Nothing here right now.")}</div>`;
  return `<section><div class="head"><h2><span class="ico" aria-hidden="true">${icon}</span>${escapeHtml(title)}</h2><span class="pill count">${rows.length}</span></div><div class="body">${body}</div></section>`;
}

function makeNonce() {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function renderFocusResult(payload) {
  const lines = ["# Sidekick: Focus Session", ""];
  if (!payload.session) {
    lines.push(payload.message || "No focus session.");
    return lines.join("\n");
  }

  lines.push(`Status: ${payload.session.status}`);
  lines.push(`Focus: ${payload.session.focus}`, "");

  const summary = payload.summary || payload.session.summary || {};
  lines.push("## Summary", "");
  lines.push(`- Captured events: ${summary.captured_events || 0}`);
  lines.push(`- Next step: ${summary.next_step || "No next step generated."}`);
  if (summary.urgent_items?.length) {
    lines.push("", "## Urgent During Focus", "");
    for (const item of summary.urgent_items) {
      lines.push(`- ${item.summary}`);
    }
  }
  return lines.join("\n");
}

async function updateFocusStatusFromCompanion(statusBar) {
  try {
    updateFocusStatus(statusBar, await companionFetch("/focus/current"));
  } catch {
    statusBar.text = "$(sparkle) Sidekick";
    statusBar.backgroundColor = undefined;
    statusBar.tooltip = "Sidekick Local Companion not connected";
  }
}

function updateFocusStatus(statusBar, payload) {
  if (!payload.active || !payload.session) {
    statusBar.text = "$(sparkle) Sidekick";
    statusBar.backgroundColor = undefined;
    statusBar.tooltip = "Start Sidekick Focus Session";
    statusBar.command = "sidekick.startFocusSession";
    return;
  }

  const minutes = Math.ceil((payload.remaining_seconds || 0) / 60);
  statusBar.text = `$(zap) Focus ${minutes}m`;
  statusBar.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  statusBar.tooltip = `${payload.session.focus}\nAttention: ${payload.attention_policy}\nClick to end`;
  statusBar.command = "sidekick.completeFocusSession";
}

function formatRef(ref) {
  if (!ref) return "none";
  return ref.file || ref.url || ref.ticket || ref.pr || ref.thread || JSON.stringify(ref);
}

function showCompanionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  // If it's the missing-token case, offer a one-click fix instead of a dead-end toast.
  if (/no companion token/i.test(message)) {
    vscode.window.showWarningMessage("Sidekick: set your companion token to connect.", "Set Token")
      .then((choice) => { if (choice === "Set Token") vscode.commands.executeCommand("sidekick.setToken"); });
    return;
  }
  vscode.window.showWarningMessage(`Sidekick Local Companion unavailable: ${message}`);
}

module.exports = {
  activate,
  deactivate
};
