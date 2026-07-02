export function sendHtml(res, html, nonce = "") {
  // Per-request nonce locks down script-src so injected inline scripts cannot run —
  // the real XSS vector (and the thing that could exfiltrate the token). Style stays
  // permissive because the dashboard uses inline style attributes (low-risk).
  if (nonce) {
    res.setHeader(
      "content-security-policy",
      `default-src 'self'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; ` +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    );
  }
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "pragma": "no-cache",
    "expires": "0"
  });
  res.end(html);
}

export function renderDashboard(nonce = "") {
  const n = nonce ? ` nonce="${nonce}"` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sidekick · Memory Console</title>
  <style${n}>
    :root {
      --bg: #07080f;
      --bg-2: #0b0d18;
      --panel: rgba(20, 23, 38, 0.62);
      --panel-solid: #14172a;
      --glass-line: rgba(255, 255, 255, 0.08);
      --glass-line-strong: rgba(255, 255, 255, 0.14);
      --text: #f1f3fb;
      --muted: #8b91b5;
      --faint: #7a80a8;
      --violet: #7c5cff;
      --violet-2: #a78bff;
      --cyan: #34e0ea;
      --pink: #ff5fa2;
      --lime: #6ee7b7;
      --amber: #fbbf24;
      --red: #ff6b6b;
      --accent-grad: linear-gradient(135deg, #7c5cff 0%, #34e0ea 100%);
      --accent-grad-soft: linear-gradient(135deg, rgba(124,92,255,0.18), rgba(52,224,234,0.12));
      --shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
      --glow: 0 0 0 1px rgba(124,92,255,0.35), 0 12px 40px rgba(124,92,255,0.25);
      font-family: "Inter", "SF Pro Display", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    * { box-sizing: border-box; }
    ::selection { background: rgba(124,92,255,0.4); color: #fff; }
    body {
      margin: 0;
      color: var(--text);
      font-size: 14px;
      line-height: 1.5;
      letter-spacing: -0.01em;
      background:
        radial-gradient(1100px 700px at 8% -10%, rgba(124,92,255,0.20), transparent 60%),
        radial-gradient(900px 600px at 100% 0%, rgba(52,224,234,0.12), transparent 55%),
        radial-gradient(800px 800px at 50% 120%, rgba(255,95,162,0.10), transparent 60%),
        var(--bg);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    @keyframes floatGrad { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
    @keyframes pop { 0% { opacity: 0; transform: translateY(8px) scale(0.98); } 100% { opacity: 1; transform: none; } }
    @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
    @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(124,92,255,0.35); } 50% { box-shadow: 0 0 0 6px rgba(124,92,255,0); } }
    @keyframes spin { to { transform: rotate(360deg); } }

    button, input, select, textarea { font: inherit; color: var(--text); }
    /* Keyboard focus ring — every interactive element, on-brand cyan. WCAG 2.4.7. */
    :where(button, a, summary, input, select, textarea, [data-jump], [data-nav]):focus-visible {
      outline: 2px solid var(--cyan);
      outline-offset: 2px;
      border-radius: 8px;
    }
    button {
      min-height: 38px;
      border: 1px solid var(--glass-line-strong);
      border-radius: 11px;
      background: rgba(255,255,255,0.04);
      color: var(--text);
      font-weight: 600;
      padding: 9px 14px;
      cursor: pointer;
      transition: transform .12s ease, background .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    button:hover { background: rgba(255,255,255,0.09); border-color: var(--glass-line-strong); transform: translateY(-1px); }
    button:active { transform: translateY(0) scale(0.98); }
    button.primary {
      background: var(--accent-grad);
      border: none;
      color: #fff;
      font-weight: 700;
      box-shadow: 0 8px 24px rgba(124,92,255,0.35);
    }
    button.primary:hover { box-shadow: 0 12px 32px rgba(124,92,255,0.5); filter: brightness(1.06); }
    input, select, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--glass-line);
      border-radius: 11px;
      background: rgba(8,10,20,0.6);
      color: var(--text);
      padding: 9px 12px;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease;
    }
    input::placeholder, textarea::placeholder { color: var(--faint); }
    input:focus, select:focus, textarea:focus {
      border-color: var(--violet);
      box-shadow: 0 0 0 4px rgba(124,92,255,0.18);
    }
    textarea { resize: vertical; min-height: 84px; }
    input[type="checkbox"] { width: auto; min-height: auto; accent-color: var(--violet); }
    select option { background: #14172a; }

    .app { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
    .sidebar {
      position: sticky; top: 0; height: 100vh;
      background: rgba(10,12,22,0.55);
      border-right: 1px solid var(--glass-line);
      backdrop-filter: blur(20px);
      display: grid; grid-template-rows: auto 1fr auto;
    }
    .brand { display: flex; gap: 12px; align-items: center; padding: 22px 18px; border-bottom: 1px solid var(--glass-line); }
    .mark {
      width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center;
      background: var(--accent-grad); color: #fff; font-weight: 800; font-size: 18px;
      box-shadow: var(--glow); animation: pulseGlow 3.5s ease-in-out infinite;
    }
    .brand-title { font-size: 17px; font-weight: 800; letter-spacing: -0.02em; }
    .brand-subtitle {
      color: transparent; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em;
      background: var(--accent-grad); -webkit-background-clip: text; background-clip: text;
    }
    .nav { padding: 16px 12px; display: grid; gap: 5px; align-content: start; }
    .nav button {
      display: flex; justify-content: space-between; align-items: center;
      border-color: transparent; background: transparent; color: var(--muted); text-align: left; font-weight: 600;
    }
    .nav button span {
      font-size: 11px; color: var(--faint); background: rgba(255,255,255,0.05);
      border-radius: 6px; padding: 1px 7px;
    }
    .nav button:hover { background: rgba(255,255,255,0.05); color: var(--text); transform: none; }
    .nav button.active {
      background: var(--accent-grad-soft); border: 1px solid rgba(124,92,255,0.35); color: var(--violet-2);
    }
    .nav button.active span { color: var(--violet-2); background: rgba(124,92,255,0.18); }
    .account { border-top: 1px solid var(--glass-line); padding: 16px 18px; display: flex; gap: 11px; align-items: center; }
    .avatar {
      width: 36px; height: 36px; border-radius: 999px; display: grid; place-items: center; font-weight: 800; color: #fff;
      background: conic-gradient(from 210deg, #7c5cff, #34e0ea, #ff5fa2, #7c5cff);
    }
    .account .muted { font-size: 12px; }

    .topbar {
      position: sticky; top: 0; z-index: 5;
      display: grid; grid-template-columns: minmax(240px, 1fr) auto auto; gap: 12px; align-items: center;
      min-height: 70px; padding: 14px 22px;
      background: rgba(8,10,18,0.7); border-bottom: 1px solid var(--glass-line); backdrop-filter: blur(22px);
    }
    .ask { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; max-width: 820px; position: relative; }
    .ask input { padding-left: 40px; min-height: 44px; }
    .ask::before {
      content: "✦"; position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
      color: var(--violet-2); font-size: 15px; pointer-events: none; z-index: 1;
    }
    .pill {
      display: inline-flex; align-items: center; gap: 8px; min-height: 38px;
      border: 1px solid var(--glass-line); border-radius: 999px; padding: 8px 13px;
      background: rgba(255,255,255,0.03); color: var(--muted); font-weight: 600; white-space: nowrap; font-size: 13px;
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--muted); box-shadow: 0 0 8px currentColor; }
    .pill.ok { color: var(--lime); border-color: rgba(110,231,183,0.3); background: rgba(110,231,183,0.08); }
    .pill.ok .dot { background: var(--lime); }
    .pill.bad { color: var(--red); border-color: rgba(255,107,107,0.3); background: rgba(255,107,107,0.08); }
    .pill.bad .dot { background: var(--red); }
    .pill.warn { color: var(--amber); border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.08); }
    .pill.warn .dot { background: var(--amber); }

    .main { min-width: 0; display: grid; grid-template-rows: auto 1fr; }
    .content { width: min(1240px, calc(100vw - 250px)); padding: 24px 22px 40px; display: grid; gap: 18px; align-content: start; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(290px, 0.55fr); gap: 18px; }

    .panel {
      background: var(--panel); border: 1px solid var(--glass-line); border-radius: 18px;
      box-shadow: var(--shadow); min-width: 0; overflow: hidden; backdrop-filter: blur(18px);
      animation: pop .4s ease both; position: relative;
    }
    .panel::after {
      content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
    }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--glass-line); }
    .panel-body { padding: 18px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 22px; line-height: 1.2; font-weight: 800; }
    h2 { font-size: 15px; font-weight: 750; display: flex; align-items: center; gap: 9px; }
    .muted { color: var(--muted); }

    .hero-focus { background: linear-gradient(160deg, rgba(124,92,255,0.14), rgba(20,23,42,0.5) 60%); }
    .focus-copy { display: grid; gap: 12px; }
    .focus-eyebrow { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.16em; color: var(--violet-2); }
    .focus-title { font-size: 24px; font-weight: 800; line-height: 1.25; letter-spacing: -0.02em; }
    .briefing-line {
      font-size: 15px; line-height: 1.55; color: var(--text); font-weight: 550;
      padding: 14px 16px; border-radius: 12px; margin-bottom: 4px;
      background: linear-gradient(135deg, rgba(124,92,255,0.14), rgba(52,224,234,0.06));
      border: 1px solid rgba(124,92,255,0.28);
    }
    .recap { display: grid; gap: 8px; }
    .recap-line {
      display: grid; grid-template-columns: 92px minmax(0,1fr); align-items: baseline; gap: 14px;
      text-align: left; background: rgba(255,255,255,0.02); border: 1px solid var(--glass-line);
      border-radius: 12px; padding: 12px 14px; min-height: 0; font-weight: 500; transition: background .15s ease, border-color .15s ease;
    }
    .recap-line:hover { background: rgba(124,92,255,0.08); border-color: rgba(124,92,255,0.3); transform: none; }
    .recap-key { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.12em; color: var(--violet-2); }
    .recap-val { font-size: 15px; font-weight: 650; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .recap-val.empty-val { color: var(--faint); font-weight: 500; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; }
    .meta span {
      color: var(--muted); font-size: 12px; font-weight: 600; padding: 5px 11px;
      border: 1px solid var(--glass-line); border-radius: 999px; background: rgba(255,255,255,0.03);
    }
    .timer { display: grid; gap: 14px; justify-items: center; text-align: center; }
    .ring {
      width: 110px; height: 110px; border-radius: 999px; display: grid; place-items: center;
      font-size: 26px; font-weight: 800; color: #fff; position: relative;
      background:
        radial-gradient(closest-side, var(--panel-solid) 79%, transparent 80% 100%),
        conic-gradient(var(--violet) var(--ring-pct, 25%), rgba(255,255,255,0.08) 0);
    }
    .ring.live { animation: pulseGlow 2s ease-in-out infinite; }
    .ring.live::before {
      content: ""; position: absolute; inset: -6px; border-radius: 999px;
      border: 2px solid transparent; border-top-color: var(--cyan); animation: spin 2.4s linear infinite;
    }
    .two-actions { display: flex; gap: 9px; flex-wrap: wrap; justify-content: center; }

    .onboarding {
      display: flex; gap: 14px; align-items: flex-start;
      background: linear-gradient(135deg, rgba(124,92,255,0.12), rgba(52,224,234,0.07));
      border: 1px solid rgba(124,92,255,0.3); border-radius: 16px; padding: 16px 18px;
    }
    .onboarding-icon { font-size: 22px; line-height: 1; }
    .onboarding-title { font-weight: 800; font-size: 15px; margin-bottom: 3px; }
    .onboarding-body { color: var(--muted); font-size: 13px; line-height: 1.5; }
    .onboarding-body b { color: var(--text); font-weight: 700; }
    .linklike { min-height: 0; padding: 0; border: 0; background: none; color: var(--violet-2); font-weight: 700; text-decoration: underline; cursor: pointer; }
    .linklike:hover { background: none; transform: none; filter: brightness(1.1); }
    .cap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .cap-grid .wide { grid-column: 1 / -1; }
    .cap-icon { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 14px; background: var(--accent-grad-soft); border: 1px solid rgba(124,92,255,0.25); }
    .rows { display: grid; }
    .row {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; padding: 13px 18px;
      border-top: 1px solid var(--glass-line); align-items: center; transition: background .15s ease;
    }
    .row:hover { background: rgba(255,255,255,0.03); }
    .row:first-child { border-top: 0; }
    .row-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row-meta { color: var(--muted); font-size: 12px; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .badge {
      border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; white-space: nowrap;
      background: rgba(124,92,255,0.15); color: var(--violet-2); border: 1px solid rgba(124,92,255,0.3);
    }
    .badge.high { background: rgba(255,107,107,0.14); color: var(--red); border-color: rgba(255,107,107,0.3); }
    .badge.medium { background: rgba(251,191,36,0.14); color: var(--amber); border-color: rgba(251,191,36,0.3); }
    .row-right { display: flex; align-items: center; gap: 8px; }
    .row-actions { display: flex; gap: 6px; }
    button.mini {
      min-height: 28px; padding: 4px 10px; border-radius: 8px; font-size: 11px; font-weight: 700;
      border: none; background: var(--accent-grad); color: #fff; box-shadow: 0 4px 12px rgba(124,92,255,0.3);
    }
    button.mini.ghost { background: rgba(255,255,255,0.05); border: 1px solid var(--glass-line-strong); color: var(--muted); box-shadow: none; }
    button.mini.ghost:hover { color: var(--red); border-color: rgba(255,107,107,0.4); }
    .ai-badge { background: linear-gradient(135deg, rgba(124,92,255,0.25), rgba(52,224,234,0.18)); color: var(--cyan); border: 1px solid rgba(52,224,234,0.4); }
    /* GTD task board — feels like a real task app, backed by plain Markdown. */
    .todo-tabs { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .todo-tab {
      min-height: 32px; padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 650;
      background: rgba(255,255,255,0.03); border: 1px solid var(--glass-line); color: var(--muted);
      display: inline-flex; align-items: center; gap: 7px;
    }
    .todo-tab:hover { background: rgba(255,255,255,0.07); transform: none; }
    .todo-tab.active { background: var(--accent-grad-soft); border-color: rgba(124,92,255,0.4); color: var(--violet-2); }
    .tab-count { font-size: 10.5px; font-weight: 800; min-width: 16px; text-align: center; padding: 0 5px; border-radius: 6px; background: rgba(255,255,255,0.06); color: var(--faint); }
    .todo-tab.active .tab-count { background: rgba(124,92,255,0.22); color: var(--violet-2); }

    .todo-list { display: grid; gap: 6px; }
    .todo-row {
      display: flex; align-items: center; gap: 11px; padding: 11px 12px; border-radius: 12px;
      background: rgba(255,255,255,0.02); border: 1px solid var(--glass-line);
      transition: background .15s ease, border-color .15s ease, opacity .25s ease, transform .25s ease;
      animation: pop .25s ease both;
    }
    .todo-row:hover { background: rgba(255,255,255,0.05); border-color: var(--glass-line-strong); }
    /* Custom round checkbox — the satisfying tap target. */
    .todo-check {
      width: 20px; height: 20px; flex: none; border-radius: 999px; border: 2px solid var(--glass-line-strong);
      display: grid; place-items: center; cursor: pointer; color: transparent; font-size: 12px; font-weight: 900;
      transition: all .15s ease; background: transparent;
    }
    .todo-check:hover { border-color: var(--violet); }
    .todo-row.todo-done .todo-check { background: var(--accent-grad); border-color: transparent; color: #fff; }
    .todo-text { flex: 1; font-weight: 550; line-height: 1.4; overflow-wrap: anywhere; }
    .todo-row.todo-done .todo-text { text-decoration: line-through; color: var(--faint); }
    .todo-meta { font-size: 11px; color: var(--faint); white-space: nowrap; }
    /* Hover quick-actions — appear on row hover/focus, like Things. */
    .todo-actions { display: flex; gap: 3px; opacity: 0; transition: opacity .12s ease; flex: none; }
    .todo-row:hover .todo-actions, .todo-row:focus-within .todo-actions { opacity: 1; }
    .todo-act {
      width: 28px; height: 28px; min-height: 0; padding: 0; border-radius: 8px; font-size: 13px;
      background: rgba(255,255,255,0.05); border: 1px solid var(--glass-line); color: var(--muted);
      display: grid; place-items: center;
    }
    .todo-act:hover { background: rgba(124,92,255,0.18); color: var(--violet-2); border-color: rgba(124,92,255,0.35); transform: none; }
    .todo-act.danger:hover { background: rgba(255,107,107,0.16); color: var(--red); border-color: rgba(255,107,107,0.35); }
    .todo-row.removing { opacity: 0; transform: translateX(12px); }
    .todo-empty-list { color: var(--faint); text-align: center; padding: 22px 12px; font-size: 13px; border: 1px dashed var(--glass-line-strong); border-radius: 12px; }
    /* tiny reschedule popover */
    .todo-pop { position: absolute; z-index: 20; background: var(--panel-solid); border: 1px solid var(--glass-line-strong); border-radius: 12px; padding: 6px; box-shadow: var(--shadow); display: grid; gap: 2px; }
    .todo-pop button { justify-content: flex-start; min-height: 34px; background: transparent; border: 0; color: var(--text); font-weight: 550; }
    .todo-pop button:hover { background: rgba(124,92,255,0.15); }
    .empty {
      margin: 0; color: var(--faint); background: rgba(255,255,255,0.02);
      border: 1px dashed var(--glass-line-strong); border-radius: 12px; padding: 16px; font-size: 13px; text-align: center;
    }
    details { background: var(--panel); border: 1px solid var(--glass-line); border-radius: 18px; box-shadow: var(--shadow); overflow: hidden; backdrop-filter: blur(18px); }
    summary { cursor: pointer; padding: 16px 18px; font-weight: 700; border-bottom: 1px solid transparent; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: "⚙ "; color: var(--violet-2); }
    details[open] summary { border-bottom-color: var(--glass-line); }
    .admin-body { padding: 18px; display: grid; gap: 16px; }
    .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 650; }
    .timeline { display: grid; gap: 4px; }
    .timeline-item { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 12px; align-items: start; padding: 8px 0; }
    .time { color: var(--faint); font-size: 12px; padding-top: 2px; font-variant-numeric: tabular-nums; }
    .event { border-left: 2px solid; border-image: var(--accent-grad) 1; padding-left: 13px; min-width: 0; }
    .event-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .event-ref { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    pre {
      margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word;
      background: rgba(2,3,8,0.7); color: var(--cyan); border: 1px solid var(--glass-line); border-radius: 12px;
      padding: 14px; font-size: 11.5px; line-height: 1.6; font-family: "SF Mono", ui-monospace, monospace;
    }
    .count-pill { font-size: 11px; font-weight: 750; min-width: 22px; text-align: center; }

    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-thumb { background: rgba(124,92,255,0.3); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(124,92,255,0.5); background-clip: padding-box; }

    @media (max-width: 1100px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { position: static; height: auto; }
      .content { width: 100%; }
      .hero, .cap-grid, .topbar { grid-template-columns: 1fr; }
    }
    @media (max-width: 680px) {
      .content, .topbar { padding: 14px; }
      .form-grid { grid-template-columns: 1fr; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div>
        <div class="brand">
          <div class="mark" aria-hidden="true">S</div>
          <div>
            <div class="brand-title">Sidekick</div>
            <div class="brand-subtitle">Memory Console</div>
          </div>
        </div>
        <nav class="nav" aria-label="Sections">
          <button class="active" data-nav="hero" aria-current="page">Today</button>
          <button data-nav="timeline">Timeline</button>
          <button data-nav="admin">Connectors</button>
          <button data-nav="admin">Privacy</button>
        </nav>
      </div>
      <div class="account">
        <div class="avatar">ME</div>
        <div>
          <div style="font-weight:700">Local user</div>
          <div class="muted">Local-first mode</div>
        </div>
      </div>
    </aside>

    <section class="main">
      <header class="topbar">
        <div class="ask">
          <input id="askInput" aria-label="Ask Sidekick" placeholder="Ask Sidekick... where was I, what needs me now, what did I promise?">
          <button id="askButton" class="primary">Ask</button>
        </div>
        <div id="companionStatus" class="pill" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span>Checking</span></div>
        <div id="focusStatus" class="pill" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span>No focus</span></div>
      </header>

      <main class="content">
        <section class="hero">
          <div class="panel hero-focus">
            <div class="panel-head">
              <div>
                <div class="focus-eyebrow">Your day so far</div>
                <h2 style="margin-top:4px">At a glance</h2>
              </div>
              <button id="refreshAll">↻ Refresh</button>
            </div>
            <div class="panel-body focus-copy">
              <div id="currentFocus" class="focus-title" style="display:none"></div>
              <div id="briefing" class="briefing-line">Connect to load your briefing.</div>
              <div id="recap" class="recap">
                <button class="recap-line" data-jump="resume" aria-label="Where you left off — jump to Resume"><span class="recap-key">Last</span><span id="recapLast" class="recap-val">—</span></button>
                <button class="recap-line" data-jump="triage" aria-label="What needs you now — jump to Triage"><span class="recap-key">Now</span><span id="recapNow" class="recap-val">—</span></button>
                <button class="recap-line" data-jump="commitment" aria-label="What you promised — jump to Commitments"><span class="recap-key">Promised</span><span id="recapPromised" class="recap-val">—</span></button>
              </div>
              <div class="meta">
                <span>◇ Propose, don't act</span>
                <span>◇ Provenance everywhere</span>
                <span>◇ Quiet by default</span>
              </div>
            </div>
          </div>
          <div class="panel">
            <div class="panel-body timer">
              <div id="focusRing" class="ring" style="--ring-pct:0%">--</div>
              <div>
                <h2 id="focusText" style="justify-content:center">Focus Session</h2>
                <p id="focusSubtext" class="muted">Protected deep work</p>
              </div>
              <div class="two-actions">
                <button id="startFocus" class="primary">Start 45m</button>
                <button id="completeFocus">End</button>
              </div>
            </div>
          </div>
        </section>

        <div id="onboarding" class="onboarding" style="display:none">
          <div class="onboarding-icon" aria-hidden="true">✦</div>
          <div>
            <div class="onboarding-title">No activity captured yet</div>
            <div class="onboarding-body">Sidekick fills these panels from your real work. Turn on capture: open a file in the <b>VS Code extension</b>, or capture a page with the <b>browser extension</b>. Just exploring? <button id="seedInline" class="linklike">Load a sample day</button>.</div>
          </div>
        </div>

        <section class="cap-grid">
          ${capabilityPanel("resume", "Resume", "Run", "🧭")}
          ${capabilityPanel("triage", "Triage", "Rank", "📥")}
          ${capabilityPanel("commitment", "Commitments", "Review", "✅")}
          ${capabilityPanel("recall", "Recall", "Surface", "🧠")}
          <div class="wide">${capabilityPanel("plan", "Plan", "Propose", "🗓️")}</div>
        </section>

        <section class="panel todo-board">
          <div class="panel-head">
            <h2><span class="cap-icon" aria-hidden="true">🗒️</span>Tasks <span id="todoCount" class="badge count-pill">0</span></h2>
            <div class="row-actions">
              <button id="todoSync" title="Capture commitments into your Inbox">↧ Capture</button>
              <button id="todoRollover" title="Carry unfinished Today items forward; archive done">↻ Roll over</button>
            </div>
          </div>
          <div class="panel-body">
            <div class="ask" style="max-width:none;margin-bottom:14px">
              <input id="todoInput" aria-label="Add a task" placeholder="Add a task…  (a meeting popped up, a new bug, anything)">
              <button id="todoAdd" class="primary">Add</button>
            </div>
            <div class="todo-tabs" role="tablist">
              <button class="todo-tab active" data-list="Today" role="tab">Today <span class="tab-count" data-count="Today">0</span></button>
              <button class="todo-tab" data-list="Inbox" role="tab">Inbox <span class="tab-count" data-count="Inbox">0</span></button>
              <button class="todo-tab" data-list="Next Actions" role="tab">Next <span class="tab-count" data-count="Next Actions">0</span></button>
              <button class="todo-tab" data-list="Someday" role="tab">Someday <span class="tab-count" data-count="Someday">0</span></button>
            </div>
            <div id="todoRows" class="todo-list"><p class="empty">Loading your tasks…</p></div>
            <p class="muted" id="todoPath" style="font-size:11.5px;margin-top:12px"></p>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2>Timeline / Provenance</h2>
            <button id="loadEvents">Refresh</button>
          </div>
          <div id="timeline" class="panel-body timeline"><p class="empty">No events loaded.</p></div>
        </section>

        <details>
          <summary>Admin: connection, capture, connectors, diagnostics</summary>
          <div class="admin-body">
            <div class="form-grid">
              <label>Companion URL
                <input id="baseUrl" value="http://127.0.0.1:4317">
              </label>
              <label>Token <span class="muted">(auto-loaded locally)</span>
                <input id="token" type="password" placeholder="loaded from companion">
              </label>
              <label>&nbsp;
                <button id="saveToken" class="primary">Save connection</button>
              </label>
            </div>

            <div class="panel" style="box-shadow:none;">
              <div class="panel-head"><h2>Manual Capture</h2><button id="capture" class="primary">Capture</button></div>
              <div class="panel-body">
                <div class="form-grid">
                  <label>Source
                    <select id="source">
                      <option>editor</option><option>github</option><option>jira</option><option>slack</option>
                      <option>teams</option><option>mail</option><option>calendar</option><option>meeting</option>
                      <option>docs</option><option>browser</option>
                    </select>
                  </label>
                  <label>Kind
                    <select id="kind">
                      <option>edited_file</option><option>reviewing_pr</option><option>opened_ticket</option>
                      <option>mentioned</option><option>message</option><option>read_doc</option>
                      <option>meeting_action</option><option>calendar_event</option>
                    </select>
                  </label>
                  <label>Project
                    <input id="project" value="payments">
                  </label>
                </div>
                <label style="margin-top:10px;">Summary
                  <textarea id="summary">Maya asked: can you review the checkout retry PR by Friday?</textarea>
                </label>
                <div class="two-actions" style="justify-content:flex-start; margin-top:10px;">
                  <button id="seed">Add Sample Day</button>
                  <button id="deleteSource">Delete Source History</button>
                </div>
              </div>
            </div>

            <div class="panel" style="box-shadow:none;">
              <div class="panel-head"><h2>Microsoft 365</h2><button id="syncMicrosoft" class="primary">Sync</button></div>
              <div class="panel-body">
                <label>Graph access token
                  <textarea id="graphAccessToken" placeholder="Paste token. It is not saved by this UI."></textarea>
                </label>
                <div class="form-grid" style="margin-top:10px;">
                  <label><span><input id="includeCalendar" type="checkbox" checked> Calendar</span></label>
                  <label><span><input id="includeMail" type="checkbox" checked> Mail</span></label>
                  <label><span><input id="includeTranscripts" type="checkbox" checked> Transcripts</span></label>
                  <label>Teams chat ID<input id="teamsChatId" placeholder="optional"></label>
                  <label>Teams meeting ID<input id="onlineMeetingId" placeholder="optional"></label>
                </div>
              </div>
            </div>

            <div class="panel" style="box-shadow:none;">
              <div class="panel-head">
                <h2>GitHub <span id="githubStatus" class="badge count-pill">off</span></h2>
                <button id="syncGithub" class="primary">Sync</button>
              </div>
              <div class="panel-body">
                <label>Fine-grained Personal Access Token (read-only)
                  <input id="githubToken" type="password" placeholder="github_pat_… — saved to OS keychain, not the database">
                </label>
                <div class="form-grid" style="margin-top:10px;">
                  <label>GitHub login <input id="githubLogin" placeholder="optional — auto-detected"></label>
                  <label><span><input id="ghReviewRequests" type="checkbox" checked> Review requests</span></label>
                  <label><span><input id="ghAssigned" type="checkbox" checked> Assigned to me</span></label>
                </div>
                <div class="two-actions" style="justify-content:flex-start; margin-top:10px;">
                  <button id="saveGithubToken">Save token to keychain</button>
                </div>
              </div>
            </div>

            <div class="panel" style="box-shadow:none;">
              <div class="panel-head"><h2>Meeting</h2><button id="ingestMeeting" class="primary">Capture minutes</button></div>
              <div class="panel-body">
                <div class="form-grid">
                  <label>Title<input id="meetingTitle" placeholder="Payments rollout sync"></label>
                  <label>Attendees<input id="meetingAttendees" placeholder="Maya, Priya"></label>
                  <label>Project<input id="meetingProject" placeholder="payments"></label>
                </div>
                <label style="margin-top:10px;">Notes or pasted transcript
                  <textarea id="meetingNotes" placeholder="Paste notes or a transcript. Lines like 'Action: Maya will…' or 'We decided…' become tracked commitments and decisions."></textarea>
                </label>
              </div>
            </div>

            <pre id="raw">{}</pre>
          </div>
        </details>
      </main>
    </section>
  </div>

  <script${n}>
    const els = {
      baseUrl: document.getElementById("baseUrl"),
      token: document.getElementById("token"),
      askInput: document.getElementById("askInput"),
      companionStatus: document.getElementById("companionStatus"),
      focusStatus: document.getElementById("focusStatus"),
      currentFocus: document.getElementById("currentFocus"),
      focusRing: document.getElementById("focusRing"),
      focusText: document.getElementById("focusText"),
      focusSubtext: document.getElementById("focusSubtext"),
      timeline: document.getElementById("timeline"),
      raw: document.getElementById("raw"),
      source: document.getElementById("source"),
      kind: document.getElementById("kind"),
      project: document.getElementById("project"),
      summary: document.getElementById("summary"),
      graphAccessToken: document.getElementById("graphAccessToken"),
      includeCalendar: document.getElementById("includeCalendar"),
      includeMail: document.getElementById("includeMail"),
      includeTranscripts: document.getElementById("includeTranscripts"),
      teamsChatId: document.getElementById("teamsChatId"),
      onlineMeetingId: document.getElementById("onlineMeetingId")
    };

    const surfaces = {
      resume: { path: "/resume", rows: document.getElementById("resumeRows"), count: document.getElementById("resumeCount") },
      triage: { path: "/triage", rows: document.getElementById("triageRows"), count: document.getElementById("triageCount") },
      commitment: { path: "/commitments", rows: document.getElementById("commitmentRows"), count: document.getElementById("commitmentCount") },
      recall: { path: "/recall", rows: document.getElementById("recallRows"), count: document.getElementById("recallCount") },
      plan: { path: "/plan", rows: document.getElementById("planRows"), count: document.getElementById("planCount") }
    };

    els.baseUrl.value = localStorage.getItem("sidekick.baseUrl") || els.baseUrl.value;
    els.token.value = localStorage.getItem("sidekick.token") || "";

    // Auto-bootstrap the token from the same-origin companion so the user never
    // pastes it. Falls back to manual entry if the endpoint is unavailable.
    async function autoLoadToken() {
      if (token()) return;
      try {
        const res = await fetch(baseUrl() + "/console-token", { headers: { "x-sidekick-console": "1" } });
        if (!res.ok) return;
        const data = await res.json();
        if (data.token) {
          els.token.value = data.token;
          localStorage.setItem("sidekick.token", data.token);
        }
      } catch { /* manual entry */ }
    }

    document.getElementById("saveToken").addEventListener("click", async () => {
      localStorage.setItem("sidekick.baseUrl", baseUrl());
      localStorage.setItem("sidekick.token", token());
      await boot();
    });
    document.getElementById("askButton").addEventListener("click", askSidekick);
    els.askInput.addEventListener("keydown", (event) => { if (event.key === "Enter") askSidekick(); });
    document.getElementById("refreshAll").addEventListener("click", boot);
    document.getElementById("loadEvents").addEventListener("click", loadEvents);
    document.getElementById("capture").addEventListener("click", captureEvent);
    document.getElementById("seed").addEventListener("click", seedDay);
    document.getElementById("seedInline").addEventListener("click", seedDay);
    document.getElementById("deleteSource").addEventListener("click", deleteSourceHistory);
    document.getElementById("startFocus").addEventListener("click", startFocus);
    document.getElementById("completeFocus").addEventListener("click", completeFocus);
    document.getElementById("syncMicrosoft").addEventListener("click", syncMicrosoft);
    document.getElementById("saveGithubToken").addEventListener("click", saveGithubToken);
    document.getElementById("syncGithub").addEventListener("click", syncGithub);
    document.getElementById("ingestMeeting").addEventListener("click", ingestMeeting);
    document.getElementById("todoAdd").addEventListener("click", addTodo);
    document.getElementById("todoInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addTodo(); });
    document.getElementById("todoSync").addEventListener("click", syncTodos);
    document.getElementById("todoRollover").addEventListener("click", rolloverTodos);
    for (const [key, surface] of Object.entries(surfaces)) {
      document.getElementById(key + "Action").addEventListener("click", () => runCapability(key, true));
    }

    let connected = false;
    let hasAnyEvents = true; // assume yes until we learn otherwise, so panels don't flash "turn on capture"

    async function boot() {
      await checkHealth();
      if (!token()) {
        connected = false;
        setPill(els.companionStatus, false, "Connect to load", "warn");
        renderEmptyState();
        return;
      }
      connected = true;
      // Learn whether ANY real activity exists before rendering, so empty panels can be
      // diagnostic ("no capture connected yet" vs "connected, nothing matched").
      await updateFirstRunState();
      await Promise.allSettled([
        runCapability("resume"),
        runCapability("triage"),
        runCapability("commitment"),
        runCapability("recall"),
        runCapability("plan"),
        loadEvents(),
        refreshFocus(),
        refreshGithubStatus(),
        loadBriefing(),
        loadTodos()
      ]);
    }

    async function loadBriefing() {
      try {
        const payload = await api("/briefing");
        document.getElementById("briefing").textContent = payload.headline || "Nothing pressing yet.";
      } catch (error) {
        document.getElementById("briefing").textContent = friendlyError(error.message, "briefing");
      }
    }

    // --- GTD task board: feels like a real task app, backed by plain Markdown ---
    let todoView = null;          // last loaded view
    let activeList = "Today";     // current tab
    const LIST_LABELS = { "Today": "Today", "Inbox": "Inbox", "Next Actions": "Next", "Someday": "Someday" };
    const MOVE_TARGETS = { // where the → move button sends items, per list
      "Inbox": [["Today", "→ Today"], ["Next Actions", "→ Next"], ["Someday", "→ Someday"]],
      "Today": [["Inbox", "→ Inbox"], ["Next Actions", "→ Next"], ["Someday", "→ Someday"]],
      "Next Actions": [["Today", "→ Today"], ["Someday", "→ Someday"]],
      "Someday": [["Today", "→ Today"], ["Next Actions", "→ Next"]]
    };

    function renderTodos(view, path) {
      if (view) todoView = view;
      if (path) document.getElementById("todoPath").textContent = "Plain Markdown at " + path + " — yours to edit, no lock-in.";
      const counts = { "Today": todoView?.open_today ?? 0, "Inbox": todoView?.inbox ?? 0, "Next Actions": todoView?.open_next ?? 0, "Someday": todoView?.someday ?? 0 };
      document.getElementById("todoCount").textContent = counts["Today"];
      for (const el of document.querySelectorAll(".tab-count")) el.textContent = counts[el.getAttribute("data-count")] ?? 0;
      for (const tab of document.querySelectorAll(".todo-tab")) tab.classList.toggle("active", tab.getAttribute("data-list") === activeList);

      const items = (todoView?.sections?.[activeList] || []);
      const rowsEl = document.getElementById("todoRows");
      if (!items.length) {
        rowsEl.innerHTML = '<div class="todo-empty-list">' + emptyCopy(activeList) + '</div>';
        return;
      }
      rowsEl.innerHTML = items.map((t) => todoRowHtml(t, activeList)).join("");
    }

    function emptyCopy(list) {
      if (list === "Inbox") return "Inbox zero ✨ — nothing to clarify. Hit Capture to pull in commitments.";
      if (list === "Today") return "Nothing on today. Add a task above, or pull one up from Inbox / Next.";
      if (list === "Someday") return "No someday/maybe items yet.";
      return "Nothing here yet.";
    }

    function todoRowHtml(t, list) {
      const done = t.checked ? " todo-done" : "";
      const captured = list === "Inbox" ? '<span class="todo-meta">captured</span>' : "";
      const e = escapeHtml(t.text);
      const reschedule = list === "Today"
        ? '<button class="todo-act" data-act="reschedule" data-text="' + e + '" title="Reschedule">⏰</button>' : "";
      return '<div class="todo-row' + done + '" data-text="' + e + '" data-list="' + escapeHtml(list) + '">' +
        '<button class="todo-check" data-act="check" data-text="' + e + '" aria-label="Toggle done">✓</button>' +
        '<span class="todo-text">' + e + '</span>' + captured +
        '<div class="todo-actions">' +
          '<button class="todo-act" data-act="move" data-text="' + e + '" title="Move to another list">→</button>' +
          reschedule +
          '<button class="todo-act danger" data-act="remove" data-text="' + e + '" title="Delete">✕</button>' +
        '</div></div>';
    }

    async function loadTodos() {
      try {
        const payload = await api("/todos");
        renderTodos(payload.view, payload.path);
      } catch (error) {
        document.getElementById("todoRows").innerHTML = '<p class="empty">' + escapeHtml(friendlyError(error.message, "todos")) + '</p>';
      }
    }

    async function addTodo() {
      const input = document.getElementById("todoInput");
      const text = input.value.trim();
      if (!text) return;
      try {
        // Quick-add always goes to the list you're viewing (Today by default).
        const payload = await api("/todos/add", { method: "POST", body: { text, section: activeList === "Inbox" ? "Today" : activeList } });
        input.value = "";
        if (activeList === "Inbox") activeList = "Today";
        renderTodos(payload.view);
      } catch (error) { renderRaw({ ok: false, error: error.message }); }
    }

    async function syncTodos() {
      try { const p = await api("/todos/sync", { method: "POST" }); activeList = "Inbox"; renderTodos(p.view); }
      catch (error) { renderRaw({ ok: false, error: error.message }); }
    }
    async function rolloverTodos() {
      try { const p = await api("/todos/rollover", { method: "POST" }); renderTodos(p.view); renderRaw({ ok: true, rolled: p.rolled, archived: p.archived }); }
      catch (error) { renderRaw({ ok: false, error: error.message }); }
    }

    async function todoAction(act, text, opts = {}) {
      try {
        let p;
        if (act === "check") {
          const row = todoView?.sections?.[activeList]?.find((t) => t.text === text);
          p = await api("/todos/check", { method: "POST", body: { text, checked: !(row?.checked), section: activeList } });
        } else if (act === "remove") {
          p = await api("/todos/remove", { method: "POST", body: { text, section: activeList } });
        } else if (act === "move") {
          p = await api("/todos/move", { method: "POST", body: { text, from: activeList, to: opts.to } });
        } else if (act === "reschedule") {
          p = await api("/todos/reschedule", { method: "POST", body: { text, when: opts.when } });
        }
        if (p) renderTodos(p.view);
      } catch (error) { renderRaw({ ok: false, error: error.message }); }
    }

    // Tab switching.
    document.querySelector(".todo-tabs")?.addEventListener("click", (e) => {
      const tab = e.target.closest(".todo-tab");
      if (!tab) return;
      activeList = tab.getAttribute("data-list");
      renderTodos();
    });

    // Delegated row actions (check / move / reschedule / remove) with small popovers.
    document.getElementById("todoRows")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      const text = btn.getAttribute("data-text");
      closePopovers();
      if (act === "check") {
        const row = btn.closest(".todo-row"); row.classList.toggle("todo-done");
        todoAction("check", text);
      } else if (act === "remove") {
        const row = btn.closest(".todo-row"); row.classList.add("removing");
        setTimeout(() => todoAction("remove", text), 200);
      } else if (act === "move") {
        showPopover(btn, MOVE_TARGETS[activeList].map(([to, label]) => [label, () => todoAction("move", text, { to })]));
      } else if (act === "reschedule") {
        showPopover(btn, [["⏭ Tomorrow (Next)", () => todoAction("reschedule", text, { when: "tomorrow" })], ["🗓 Someday", () => todoAction("reschedule", text, { when: "someday" })]]);
      }
    });

    function showPopover(anchor, options) {
      closePopovers();
      const pop = document.createElement("div");
      pop.className = "todo-pop";
      for (const [label, fn] of options) {
        const b = document.createElement("button");
        b.textContent = label;
        b.addEventListener("click", () => { closePopovers(); fn(); });
        pop.appendChild(b);
      }
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      pop.style.top = (window.scrollY + r.bottom + 4) + "px";
      pop.style.left = (window.scrollX + Math.min(r.left, window.innerWidth - 180)) + "px";
      setTimeout(() => document.addEventListener("click", closePopoversOnce, { once: true }), 0);
    }
    function closePopovers() { for (const p of document.querySelectorAll(".todo-pop")) p.remove(); }
    function closePopoversOnce(e) { if (!e.target.closest(".todo-pop")) closePopovers(); }

    async function updateFirstRunState() {
      try {
        const payload = await api("/events?limit=1");
        hasAnyEvents = (payload.events || []).length > 0;
      } catch {
        hasAnyEvents = true; // on error, don't show the onboarding card
      }
      document.getElementById("onboarding").style.display = hasAnyEvents ? "none" : "flex";
    }

    async function checkHealth() {
      try {
        const health = await fetch(baseUrl() + "/health").then((res) => res.json());
        setPill(els.companionStatus, true, health.component + " online");
      } catch {
        setPill(els.companionStatus, false, "Companion offline", "warn");
      }
    }

    async function askSidekick() {
      const rawText = els.askInput.value.trim();
      const text = rawText.toLowerCase();
      if (text.includes("promise") || text.includes("commit")) return runCapability("commitment", true);
      if (text.includes("learn") || text.includes("recall")) return runCapability("recall", true, extractRecallQuery(rawText));
      if (text.includes("plan") || text.includes("realistic")) return runCapability("plan", true);
      if (text.includes("need") || text.includes("triage")) return runCapability("triage", true);
      return runCapability("resume", true);
    }

    async function api(path, options = {}) {
      const response = await fetch(baseUrl() + path, {
        method: options.method || "GET",
        headers: { "content-type": "application/json", "authorization": "Bearer " + token() },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || response.statusText);
      return payload;
    }

    async function runCapability(key, inspect = false, query = null) {
      const surface = surfaces[key];
      try {
        const payload = await api(surface.path + (query ? "?q=" + encodeURIComponent(query) : ""));
        const rows = rowsFor(key, payload);
        surface.rows.innerHTML = rows.length
          ? renderRows(rows)
          : '<p class="empty">' + (hasAnyEvents
              ? "Connected — nothing here right now."
              : "No capture connected yet. Turn on the editor or browser extension to fill this.") + '</p>';
        surface.count.textContent = rows.length;
        updateRecap(key, payload);
        if (inspect) renderRaw(payload);
      } catch (error) {
        surface.rows.innerHTML = '<p class="empty">' + escapeHtml(friendlyError(error.message, key)) + '</p>';
        surface.count.textContent = "—";
        if (inspect) renderRaw({ ok: false, error: error.message });
      }
    }

    function rowsFor(key, payload) {
      if (key === "resume") {
        return [
          ...(payload.nextSteps || []).map((step) => ({ title: step, meta: "Suggested next step" })),
          ...(payload.resumeEvents || []).slice(0, 3).map((event) => ({ title: event.summary, meta: refText(event.ref) }))
        ];
      }
      if (key === "triage") {
        return (payload.ranked || []).slice(0, 5).map((item) => ({
          title: item.summary,
          meta: "Score " + item.score + " / " + refText(item.provenance_ref),
          badge: item.score >= 0.8 ? "High" : item.score >= 0.65 ? "Medium" : "Low"
        }));
      }
      if (key === "commitment") {
        return (payload.commitments || []).slice(0, 6).map((item) => {
          const engine = (item.extractor || "regex").startsWith("llm") ? "AI " + item.extractor.split(":")[1] : "rule";
          const why = item.match_reason ? " · why: " + item.match_reason : "";
          return {
            title: item.what,
            meta: (item.direction === "owed_to_me" ? "owed to me" : "owed by me") + " · " + item.status + " · " + engine + why,
            badge: item.status === "confirmed" ? "Confirmed" : item.due ? "Due" : "Proposed",
            ai: (item.extractor || "").startsWith("llm"),
            commitmentId: item.id
          };
        });
      }
      if (key === "recall") {
        return [
          ...(payload.lessons || []).map((item) => ({
            title: item.insight,
            meta: "Lesson / " + item.topic + (item.score != null ? " / score " + item.score : "")
          })),
          ...(payload.memory || []).map((item) => ({
            title: item.content,
            meta: "Note · " + item.topic + (item.score != null ? " · match " + item.score : "")
          }))
        ].slice(0, 5);
      }
      if (key === "plan") {
        return [
          ...(payload.day_shape || []).map((block) => ({ title: block.focus, meta: block.start + "-" + block.end + " / " + block.label })),
          ...(payload.focus_session ? [{ title: payload.focus_session.suggested_focus, meta: payload.focus_session.suggested_minutes + " min Focus Session", badge: "Focus" }] : []),
          ...(payload.risks || []).map((risk) => ({ title: risk, meta: "Risk", badge: "Watch" }))
        ];
      }
      return [];
    }

    async function captureEvent() {
      const payload = await api("/events", {
        method: "POST",
        body: {
          source: els.source.value,
          kind: els.kind.value,
          ref: { url: "memory-console", file: els.kind.value === "edited_file" ? "src/capture/retryPolicy.ts" : undefined },
          summary: els.summary.value,
          project: els.project.value || null,
          confidence: 0.92,
          origin: "work"
        }
      });
      renderRaw(payload);
      await boot();
    }

    async function seedDay() {
      const samples = [
        ["editor", "edited_file", "Learned retry capture must preserve idempotency key.", { file: "src/capture/retryPolicy.ts" }],
        ["slack", "message", "Maya asked: can you review the checkout retry PR by Friday?", { thread: "C123:1782547000" }],
        ["jira", "opened_ticket", "Opened production incident follow up; urgent duplicate capture analysis today.", { ticket: "PAY-1842" }],
        ["meeting", "meeting_action", "Action item: I will send the rollout risk summary tomorrow.", { url: "meeting:payment-rollout" }]
      ];
      for (const [source, kind, summary, ref] of samples) {
        await api("/events", { method: "POST", body: { source, kind, ref, summary, project: "payments", confidence: 0.9, origin: "work" } });
      }
      await boot();
    }

    async function startFocus() {
      const focus = els.currentFocus.textContent === "No current focus yet." ? "Protected deep work" : els.currentFocus.textContent;
      const payload = await api("/focus/start", { method: "POST", body: { focus, duration_minutes: 45, attention_mode: "never" } });
      renderRaw(payload);
      await refreshFocus();
    }

    async function completeFocus() {
      const payload = await api("/focus/complete", { method: "POST", body: { status: "completed" } });
      renderRaw(payload);
      await refreshFocus();
    }

    async function refreshFocus() {
      try {
        const payload = await api("/focus/current");
        if (payload.active && payload.session) {
          const remaining = payload.remaining_seconds || 0;
          const mins = Math.ceil(remaining / 60);
          const total = (payload.session.duration_minutes || 45) * 60;
          const pct = Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
          els.focusRing.textContent = mins;
          els.focusRing.style.setProperty("--ring-pct", pct + "%");
          els.focusRing.classList.add("live");
          els.focusText.textContent = payload.session.focus;
          els.focusSubtext.textContent = "Attention: " + payload.attention_policy;
          setPill(els.focusStatus, true, "Focus " + mins + "m", "warn");
        } else {
          els.focusRing.textContent = "--";
          els.focusRing.style.setProperty("--ring-pct", "0%");
          els.focusRing.classList.remove("live");
          els.focusText.textContent = "Focus Session";
          els.focusSubtext.textContent = "Protected deep work";
          setPill(els.focusStatus, false, "No focus");
        }
      } catch (error) {
        els.focusRing.textContent = "--";
        els.focusRing.style.setProperty("--ring-pct", "0%");
        els.focusRing.classList.remove("live");
        els.focusText.textContent = "Focus Session";
        els.focusSubtext.textContent = "Connect to the companion to see session state.";
        setPill(els.focusStatus, false, "Focus unavailable", "warn");
      }
    }

    async function syncMicrosoft() {
      try {
        const payload = await api("/connectors/microsoft/sync", {
          method: "POST",
          body: {
            graphAccessToken: els.graphAccessToken.value,
            includeCalendar: els.includeCalendar.checked,
            includeMail: els.includeMail.checked,
            includeTranscripts: els.includeTranscripts.checked,
            chatId: document.getElementById("teamsChatId").value.trim() || undefined,
            onlineMeetingId: document.getElementById("onlineMeetingId").value.trim() || undefined
          }
        });
        renderRaw({ ...payload, note: "Graph token is not stored or echoed." });
        await boot();
      } catch (error) {
        renderRaw({ ok: false, error: error.message });
      }
    }

    async function saveGithubToken() {
      const tokenValue = document.getElementById("githubToken").value.trim();
      if (!tokenValue) { renderRaw({ ok: false, error: "Enter a GitHub token first." }); return; }
      try {
        const payload = await api("/connectors/github/token", { method: "POST", body: { token: tokenValue } });
        document.getElementById("githubToken").value = "";
        renderRaw({ ...payload, note: "Token stored in the OS keychain. It is never written to the database." });
        await refreshGithubStatus();
      } catch (error) {
        renderRaw({ ok: false, error: error.message });
      }
    }

    async function syncGithub() {
      try {
        const tokenValue = document.getElementById("githubToken").value.trim();
        const payload = await api("/connectors/github/sync", {
          method: "POST",
          body: {
            token: tokenValue || undefined, // falls back to the keychain token server-side
            login: document.getElementById("githubLogin").value.trim() || undefined,
            includeReviewRequests: document.getElementById("ghReviewRequests").checked,
            includeAssigned: document.getElementById("ghAssigned").checked
          }
        });
        renderRaw(payload);
        await boot();
      } catch (error) {
        renderRaw({ ok: false, error: error.message });
      }
    }

    async function ingestMeeting() {
      const title = document.getElementById("meetingTitle").value.trim();
      if (!title) { renderRaw({ ok: false, error: "Give the meeting a title." }); return; }
      try {
        const attendees = document.getElementById("meetingAttendees").value.split(",").map((s) => s.trim()).filter(Boolean);
        const payload = await api("/meeting/ingest", {
          method: "POST",
          body: {
            title,
            attendees,
            project: document.getElementById("meetingProject").value.trim() || null,
            notes: document.getElementById("meetingNotes").value
          }
        });
        renderRaw({ minutes: payload.minutes, decisions: payload.decisions, action_items: payload.action_items, tracked_commitments: payload.commitments.length });
        document.getElementById("meetingNotes").value = "";
        await boot();
      } catch (error) {
        renderRaw({ ok: false, error: error.message });
      }
    }

    async function refreshGithubStatus() {
      try {
        const payload = await api("/connectors/github/status");
        const badge = document.getElementById("githubStatus");
        badge.textContent = payload.connected ? "auto-syncing" : "off";
        badge.title = payload.connected ? "Review requests + assignments sync automatically in the background." : "";
      } catch { /* leave as-is */ }
    }

    async function deleteSourceHistory() {
      const source = els.source.value;
      if (!source) return;
      try {
        const payload = await api("/events?source=" + encodeURIComponent(source), { method: "DELETE" });
        renderRaw({ ok: true, deleted: payload.deleted, source });
        await boot();
      } catch (error) {
        renderRaw({ ok: false, error: error.message });
      }
    }

    async function loadEvents() {
      try {
        const payload = await api("/events?limit=8");
        els.timeline.innerHTML = (payload.events || []).map((event) => (
          '<div class="timeline-item"><div class="time">' + escapeHtml(shortTime(event.ts)) + '</div><div class="event"><div class="event-title">' +
          escapeHtml(event.summary) + '</div><div class="event-ref">' + escapeHtml(event.source + " / " + event.kind + " / " + refText(event.ref)) + '</div></div></div>'
        )).join("") || '<p class="empty">No captured events.</p>';
      } catch (error) {
        els.timeline.innerHTML = '<p class="empty">' + escapeHtml(friendlyError(error.message, "timeline")) + '</p>';
      }
    }

    function renderRows(rows) {
      if (!rows.length) return '<p class="empty">Nothing to show yet.</p>';
      return rows.map((row) => {
        const badgeClass = row.badge === "High" ? " high" : row.badge === "Medium" ? " medium" : "";
        const aiTag = row.ai ? '<span class="badge ai-badge">✦ AI</span>' : "";
        const badge = (row.badge ? '<span class="badge' + badgeClass + '">' + escapeHtml(row.badge) + '</span>' : "") + aiTag;
        // Commitment rows get inline confirm/dismiss so a wrong proposal is one click away from gone.
        const actions = row.commitmentId
          ? '<div class="row-actions"><button class="mini" data-confirm="' + escapeHtml(row.commitmentId) + '">Confirm</button>' +
            '<button class="mini ghost" data-dismiss="' + escapeHtml(row.commitmentId) + '">Dismiss</button></div>'
          : "";
        return '<div class="row"><div><div class="row-title">' + escapeHtml(row.title) + '</div><div class="row-meta">' + escapeHtml(row.meta || "") +
          '</div></div><div class="row-right">' + badge + actions + '</div></div>';
      }).join("");
    }

    async function setCommitmentStatus(id, status) {
      try {
        await api("/commitments/status", { method: "POST", body: { id, status } });
        await runCapability("commitment");
        await runCapability("triage");
      } catch (error) {
        renderRaw({ ok: false, error: error.message });
      }
    }

    // Delegated handler for the inline commitment actions + recap jump-to-panel.
    document.addEventListener("click", (event) => {
      const confirmId = event.target?.getAttribute?.("data-confirm");
      const dismissId = event.target?.getAttribute?.("data-dismiss");
      if (confirmId) { setCommitmentStatus(confirmId, "confirmed"); return; }
      if (dismissId) { setCommitmentStatus(dismissId, "dismissed"); return; }
      const jump = event.target?.closest?.("[data-jump]")?.getAttribute("data-jump");
      if (jump) { jumpToPanel(jump); return; }
      // Sidebar nav: scroll to the matching section and mark it current.
      const navBtn = event.target?.closest?.("[data-nav]");
      if (navBtn) {
        const target = navBtn.getAttribute("data-nav");
        const el = target === "timeline" ? document.getElementById("timeline")?.closest(".panel")
          : target === "admin" ? document.querySelector("details")
          : document.querySelector(".hero");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          if (target === "admin") document.querySelector("details").open = true;
        }
        for (const b of document.querySelectorAll(".nav button")) {
          b.classList.toggle("active", b === navBtn);
          if (b === navBtn) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
        }
      }
    });

    // The factual recap: three true lines pulled verbatim from the capability outputs.
    // No invented prose — each line is real data with provenance one click away.
    const recapEls = {
      resume: document.getElementById("recapLast"),
      triage: document.getElementById("recapNow"),
      commitment: document.getElementById("recapPromised")
    };
    function setRecap(el, text) {
      if (!el) return;
      if (text) { el.textContent = text; el.classList.remove("empty-val"); }
      else { el.textContent = "Nothing yet"; el.classList.add("empty-val"); }
    }
    function updateRecap(key, payload) {
      if (key === "resume") {
        setRecap(recapEls.resume, payload.lastState?.summary || (payload.nextSteps || [])[0] || "");
      } else if (key === "triage") {
        const top = (payload.ranked || [])[0];
        setRecap(recapEls.triage, top ? top.summary : "");
      } else if (key === "commitment") {
        const owed = (payload.owed_by_me || []).find((c) => c.status !== "dismissed") || (payload.commitments || [])[0];
        setRecap(recapEls.commitment, owed ? owed.what : "");
      }
    }
    function jumpToPanel(key) {
      const el = surfaces[key]?.rows?.closest(".panel");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.animate(
        [{ boxShadow: "0 0 0 2px rgba(124,92,255,0.6)" }, { boxShadow: "0 0 0 0 rgba(124,92,255,0)" }],
        { duration: 900, easing: "ease-out" }
      );
    }

    function renderRaw(payload) { els.raw.textContent = JSON.stringify(payload, null, 2); }
    function renderEmptyState() {
      for (const surface of Object.values(surfaces)) {
        surface.rows.innerHTML = '<p class="empty">Connect the companion to load this surface.</p>';
        surface.count.textContent = "—";
      }
      els.timeline.innerHTML = '<p class="empty">Connect the companion to inspect the timeline.</p>';
      els.currentFocus.textContent = "Connect the companion to reconstruct current focus.";
      els.focusRing.textContent = "--";
      els.focusText.textContent = "Focus Session";
      els.focusSubtext.textContent = "Protected deep work";
    }
    function friendlyError(message, surface) {
      if (/failed to fetch|networkerror/i.test(String(message))) {
        return "Connect the companion to load this surface.";
      }
      if (/missing or invalid bearer token/i.test(String(message))) {
        return "Token required to load this surface.";
      }
      if (surface === "timeline") {
        return "Connect the companion to inspect the timeline.";
      }
      return message;
    }
    function setPill(el, ok, text, extra = "") {
      el.className = "pill " + (ok ? "ok" : "bad") + (extra ? " " + extra : "");
      el.querySelector("span:last-child").textContent = text;
    }
    function baseUrl() { return els.baseUrl.value.replace(/\\/$/, ""); }
    function token() { return els.token.value.trim(); }
    function refText(ref) { return ref?.file || ref?.url || ref?.ticket || ref?.pr || ref?.thread || "provenance"; }
    function extractRecallQuery(text) {
      const match = text.match(/(?:what did i learn about|learn(?:ed)?(?: about)?|recall(?: about)?)\s+(.+)$/i);
      return match?.[1]?.trim() || null;
    }
    function shortTime(ts) {
      const date = new Date(ts);
      return Number.isFinite(date.getTime()) ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
    }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    }

    autoLoadToken().then(boot);
    setInterval(refreshFocus, 1000);
  </script>
</body>
</html>`;
}

function capabilityPanel(id, title, action, icon) {
  return `<div class="panel">
    <div class="panel-head">
      <h2><span class="cap-icon" aria-hidden="true">${icon}</span>${title} <span id="${id}Count" class="badge count-pill">0</span></h2>
      <button id="${id}Action">${action}</button>
    </div>
    <div id="${id}Rows" class="rows"><p class="empty">Nothing loaded yet.</p></div>
  </div>`;
}
