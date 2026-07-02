# Sidekick — Features & End-User Workflows

> **One private memory of your work, five capabilities, three surfaces — local-first and propose-don't-act.**
>
> Every feature here removes one specific, daily, *personally-felt* friction. They share a single local memory, so the whole is more than the parts — which a generic single-feature tool structurally can't match. That shared, local, inspectable memory is the differentiator.

This document is the authoritative catalog, verified against the source (25 HTTP endpoints, 10 capture sources, 9 event kinds, 3 surfaces). Each item answers **what it does** and **why it exists**.

---

## How it all fits

```
┌─ Memory Console (web)  ┐
├─ VS Code extension     ┤──HTTP──▶  Local Companion (Node, loopback only)
└─ Browser extension     ┘              │
                                        ├─ Capture → WorkContextEvent (canonical schema)
                                        ├─ Derive → Commitments / Lessons / Memory
                                        ├─ Encrypted SQLite timeline (AES-256-GCM)
                                        └─ Capabilities read over the shared memory
```

**Why this shape:** the surfaces are thin (capture + display only). The Companion owns capture, storage, derivation, and policy. That is what makes "one shared brain" real — every surface sees the same memory.

---

## 1. The five core capabilities

Each maps to a question a real engineer asks every day.

| Capability | The question | What it does | Why it exists |
|---|---|---|---|
| 🧭 **Resume** | "Where was I?" | Detects your most recent **interruption gap** in the timeline, reconstructs the context *before* it, proposes next steps ("Re-open retryPolicy.ts"). | After a meeting/Slack interruption you lose **15–20 min** rebuilding context. This hands it back in seconds. |
| 📥 **Triage** | "What needs me now?" | Ranks events + commitments by **urgency × importance**, with provenance on each item. | You are a human router across 6 tools. This tells you what actually needs *you* vs. what can wait. |
| ✅ **Commitments** | "What did I promise?" | Tracks **owed-by-me** and **owed-to-me** obligations with source provenance; confirm or dismiss each. | Promises scatter across Slack/PRs/meetings and get dropped. This is the one thing that never lets a promise fall. |
| 🧠 **Recall** | "What did I learn?" | Keyword search over captured **lessons + notes**, ranked by relevance + recency. | Hard-won lessons evaporate. Resurfaces them when relevant. *(Honestly labeled keyword, not vector — yet.)* |
| 🗓️ **Plan** | "What's realistic today?" | Proposes a **day-shape** (deep-work / triage / commitments blocks), flags overdue risks. | The plan-vs-reality gap. It **proposes**, never overrides your calendar. |

**Endpoints:** `GET /resume` · `GET /triage` · `GET /commitments` (+ `POST /commitments/status` for confirm/dismiss, `DELETE /commitments`) · `GET /recall?q=` · `GET /plan`

---

## 2. Workflows built on top of the capabilities

### 🎯 Focus Session
- **What:** A protected deep-work timer (5–180 min). During it, Sidekick stays **ambient** and surfaces only *urgent* triage items. On completion it generates a summary (events captured, urgent items, next step).
- **Why:** Deep work dies by a thousand pings. This makes "do not disturb" intelligent — quiet, but not blind to a real incident.
- **Endpoints:** `POST /focus/start` · `GET /focus/current` · `POST /focus/complete` · `GET /focus/sessions`

### ☀️ Briefing
- **What:** One proactive digest composing Resume + Triage + Commitments into plain sentences: *"Good morning. You left off in retryPolicy.ts. 2 things need you. You owe Maya a review (Friday). Priya owes you the staging fix (Monday)."*
- **Why:** A tool you must *remember to open* gets forgotten. This is the "assistant, not dashboard" moment — the single most important retention lever.
- **Endpoint:** `GET /briefing`

### 🗒️ GTD Todos — a plain Markdown file you own (`~/.sidekick/TODO.md`)
- **What:** A GTD-style day list stored as **plain Markdown** in your dotfolder — the same convention every local file-based tool uses (Obsidian, Logseq, Dendron, todo.txt; and AI tools like `~/.claude`, `~/.aider`). Canonical **GTD / Things vocabulary**: `## Inbox` / `## Today` / `## Next Actions` / `## Waiting For` / `## Someday` / `## Done`, with `- [ ]`/`- [x]` GitHub-flavored checkboxes (the most widely supported Markdown extension). Quick-add from the console or the editor (`Sidekick: Add to Today's List`).
- **The GTD framing makes Sidekick's role precise — it is your Capture step.** Auto-captured commitments land in the **`## Inbox`** (append-only, de-duplicated against the whole file); **you** clarify them into Today / Next Actions / Someday. That's textbook GTD (Capture → Clarify → Organize → Reflect → Engage), not an invented flow. The Briefing opens with your open-Today count *and* your inbox-to-clarify count.
- **Why it fixes the stated pain — plans go stale, tasks don't finish, new things interrupt:**
  - **Rollover** — unchecked Today items carry forward, completed ones move to Done. Nothing is silently dropped (accountability without guilt).
  - **2-second capture** — a mid-day interrupt gets written down before it's lost, without leaving your editor.
  - **No double-entry** — promises Sidekick already captured appear as *proposed*, in their own block, never merged into your list (avoids the "two-inbox" reconciliation trap).
- **Why a file, not the database:** local-first taken to its end. It's human-readable, editable in any editor, greppable, git-able, syncable with your own tooling. If Sidekick vanishes, your todos are still a Markdown file — **zero lock-in is a trust feature.** Propose-don't-act: Sidekick never rewrites your lines (lossless round-trip, tested).
- **It looks and feels like a real task app** — a Things-grade board (segmented Inbox / Today / Next / Someday tabs with live counts, round custom checkboxes, per-row hover quick-actions to **complete · move · reschedule · delete**, smooth animations) — even though the backend is just plain Markdown. The point: writing, adding, moving, marking done, and rescheduling to another day all feel effortless. Quick-add and a Today count also appear in the VS Code panel and the browser popup.
- **Endpoints:** `GET /todos` · `POST /todos/add` · `/todos/check` · `/todos/move` · `/todos/reschedule` · `/todos/remove` · `/todos/rollover` · `/todos/sync`

### 🤝 Meeting lifecycle (the full arc)
Meetings are the highest-waste surface for leads/EMs — time lost, context dropped, follow-ups forgotten. Sidekick covers the whole arc, locally, with no always-on mic.

| Phase | What | Why | Endpoint |
|---|---|---|---|
| **Before — Prep** | Surfaces past commitments/lessons/threads tied to attendees/topic. | Walk in already caught up, not cold. | `GET /meeting/prep?topic=&attendees=` |
| **During/After — Ingest** | Take **notes**, paste a **transcript**, or pull from **M365** → extracts **decisions** + **action items** (with owner detection). | Notes rot in a doc nobody reopens. | `POST /meeting/ingest` |
| **Follow-through** | Action items become **tracked commitments** with provenance back to the meeting. | The killer loop: promises from a meeting resurface in Triage / Briefing / the next Prep. | — |
| **Read-back — Minutes** | Reconstructs a meeting's decisions + actions. | An auditable record. | `GET /meeting/minutes?id=` |

---

## 3. Connectors — getting real data in

| Connector | What it pulls | Why | Endpoints |
|---|---|---|---|
| **GitHub** | **Review requests** → "owed by me"; **assigned issues/PRs** → things you own. Fine-grained PAT, read-only, keychain-stored, **background-polled every 5 min**. | The highest-value daily signal for an engineer, flowing in automatically. | `POST /connectors/github/token` · `GET /connectors/github/status` · `POST /connectors/github/sync` |
| **Microsoft 365** | Outlook calendar/mail, Teams chat/meetings/transcripts via Microsoft Graph. | Covers the meeting/comms half of the day. | `POST /connectors/microsoft/sync` |
| **Manual / API** | Any source via the canonical `WorkContextEvent`. | The open integration boundary — any future connector plugs in here. | `POST /events` |

**Why PAT, not OAuth:** a local single-user tool has no server; OAuth's callback/client-secret ceremony adds friction with zero security gain. A read-only PAT in the OS keychain is the right fit.

---

## 4. AI extraction layer (optional, fail-closed)

Three tiers, auto-selected. **AI is never required** — the deterministic floor always works.

| Tier | When it runs | Why this design |
|---|---|---|
| **Regex floor** | Always | Zero setup, offline, inspectable — serves the 100% of users who never enable AI. |
| **Local LLM (Ollama)** | If a local model is configured | Privacy mode: nothing leaves the machine. |
| **Cloud LLM (Claude)** | Explicit opt-in only | Best quality — but `auto` mode *never* selects it; cloud is source-gated and payload-redacted. |

**Why fail-closed:** an accidental cloud call isn't a bug for a regulated user — it's an incident. So `auto` can never reach cloud even with an API key in the environment. AI **enriches** (proposes more commitments), never blocks ingest, and every AI-derived item is tagged with its tier and a distinct ✦ AI badge. AI proposes; the human stays in control.

**Config:** `SIDEKICK_LLM_MODE` (`auto`|`off`|`regex`|`local`|`cloud`) · `SIDEKICK_LLM_LOCAL_URL` · `SIDEKICK_LLM_API_KEY` · `SIDEKICK_LLM_CLOUD_BLOCK` (default `meeting,teams,mail`).

---

## 5. The three surfaces

### 🖥️ Memory Console (web dashboard)
The home + admin. "At a glance" briefing recap (Last / Now / Promised, each clickable), five capability panels, focus timer, inline confirm/dismiss on commitments, timeline/provenance view, and a collapsed admin section (connection, manual capture, GitHub, M365, meeting ingest, delete source history).
**Why:** one place to inspect your whole memory and control privacy. Auto-loads its token; strict CSP.

### 📝 VS Code Editor Extension
Ambient capture where you live. Silently captures `edited_file` / `opened_file`; commands for all five capabilities + Focus Session; status-bar focus timer; theme-aware webview panel; token in SecretStorage.
**Commands:** Open Panel · Set Token · Where was I? · What needs me now? · What did I promise? · What did I learn? · What's realistic today? · Start/Complete Focus Session · Show Captured Events.
**Why:** the engineer's day happens in the editor — capture should be invisible there.

### 🌐 Browser Extension (Chrome/Edge)
A thin capture surface. Captures the current page/selection (infers `github` → PR, `jira` → ticket); read-only focus status; persistent ignore-list; graceful on restricted pages.
**Why:** PRs, tickets, and docs live in the browser — capture them without leaving the tab.

---

## 6. The foundation — why you can trust it

| Layer | What | Why |
|---|---|---|
| **Data model** | One canonical `WorkContextEvent`: 10 sources (editor, github, jira, slack, teams, mail, calendar, meeting, docs, browser), 9 kinds, work/personal origin, confidence, provenance ref. | A single contract → surfaces and connectors stay thin. |
| **Storage** | Encrypted SQLite, append-only + logical delete, **transactional writes**, cascading delete, audit log. | Data integrity — nothing partial, nothing orphaned. |
| **Security** | Loopback-only, timing-safe auth, **AES-256-GCM at rest with a key decoupled from the API token**, strict CSP nonce, OS-keychain secrets, rate limiting, fail-closed egress. | Your data never leaves; XSS can't steal the token; rotating the token can't brick the DB. |
| **Redaction** | Scrubs secrets/emails before storage; masks names before any cloud egress. | Defensible to Legal. |
| **Resilience** | Real `/health` probe (503 on DB/decrypt failure), guarded poller + AI, graceful shutdown, structured JSON logs + audit trail. | Production observability. |
| **Privacy controls** | `DELETE /events`, `/commitments`, `/lessons`, `/memory`; source-history cascade delete. | Inspectable & reversible — you own and can erase everything. |

---

## End-to-end user workflows (a day with Sidekick)

1. **Morning** — Open the console (or it nudges you): the **Briefing** says where you left off, what needs you, what you owe.
2. **Deep work** — Start a **Focus Session**; Sidekick goes ambient, surfacing only a real incident.
3. **Interruption** — A meeting pulls you away. After, **Resume** rebuilds your pre-interruption context in seconds.
4. **A teammate asks for a review in Slack / a PR is assigned** — it lands as a **proposed Commitment** (Slack manually or GitHub auto-polled); you confirm or dismiss.
5. **Before a meeting** — **Meeting Prep** briefs you on the relevant history.
6. **After the meeting** — paste notes/transcript into **Ingest**; decisions + action items are captured, and the actions become **tracked commitments** with provenance back to the meeting.
7. **Throughout** — **Triage** keeps the few things that need *you* at the top; **Recall** resurfaces a past lesson when you search; **Plan** proposes a realistic day-shape.
8. **Anytime** — inspect the full timeline + provenance, and delete any source's history (cascading to derived records). You own it all.

---

## Honest limitations (not hidden)

- **AI extraction quality** is wired and tested with mock models, but not yet benchmarked against a live Claude/Ollama model.
- **Connectors:** GitHub + Microsoft 365 are implemented; GitLab / Jira / Slack still need auth.
- **Recall** is keyword search, not vector embeddings (labeled as such in the product).
- **`node:sqlite`** is behind `--experimental-sqlite`; a bounded risk for a local single-user tool, guarded at startup.

---

*See also: `ARCHITECTURE.md` (system design), `PRODUCTION_READINESS.md` (evidenced checklist), `sidekick/README.md` (run instructions).*
