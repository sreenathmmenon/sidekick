# Sidekick Local-First Project

This folder contains a local-first Sidekick implementation for a single user with three product interfaces:

```text
Memory Console UI
Editor Surface (VSIX-compatible)
Browser Extension Surface
        ↓
Authenticated localhost API
        ↓
Local Companion
        ↓
SQLite State + Timeline Store / Memory Subsystem
        ↓
Resume / Triage / Commitments / Recall / Plan / Focus Session
```

It is not a cloud SaaS and it does not auto-act. It preserves the Sidekick principles: local-first, propose-don't-act, provenance everywhere, inspectable and reversible.

Assumptions:
- The project runs all five Sidekick capabilities end to end over captured local events.
- External tools can feed the system through the authenticated `POST /events` boundary using the canonical `WorkContextEvent` model.
- Cloud LLM calls are optional and not required for this implementation; deterministic local reasoning keeps the project runnable without external services.
- OS keychain storage and database encryption are production hardening items, documented in the privacy appendix, but not required to run the local implementation.

## Run the Local Companion

Use an explicit local API token:

```bash
cd sidekick/companion
SIDEKICK_TOKEN=dev-local-token npm start
```

The companion binds to loopback only:

```text
http://127.0.0.1:4317
```

## Open the Memory Console UI

After starting the Local Companion, open:

```text
http://127.0.0.1:4317/
```

In the UI:

1. Enter token `dev-local-token`.
2. Click `Save and Check`.
3. Click `Add Sample Day`.
4. Use the buttons `Resume`, `Triage`, `Commitments`, `Recall`, and `Plan`.
5. Use `Focus Session` to start protected deep work.
6. In the admin section, `Delete Source History` removes a source and cascades derived records.

You can also use the `Capture Event` form to add your own `WorkContextEvent` from Slack, Jira, GitHub, editor, meeting, docs, mail, calendar, or browser.

## Connect Microsoft 365

The Memory Console UI includes a Microsoft 365 connector panel.

What it can sync:

- Outlook Calendar -> `source: "calendar"`, `kind: "calendar_event"`
- Outlook Mail -> `source: "mail"`, `kind: "message"`
- Teams Chat -> `source: "teams"`, `kind: "message"` or `mentioned`
- Teams Meeting metadata -> `source: "meeting"`, `kind: "calendar_event"`
- Teams Transcript metadata -> `source: "meeting"`, `kind: "meeting_action"`

Steps:

1. Get a Microsoft Graph access token with the permissions you need.
2. Open `http://127.0.0.1:4317/`.
3. Enter the Sidekick token `dev-local-token`.
4. Paste the Microsoft Graph token into `Graph access token`.
5. Select Outlook mail/calendar, and optionally enter a Teams chat ID or online meeting ID.
6. Click `Sync Microsoft 365`.

The Graph access token is not saved by the UI and is not echoed back in API output. The connector normalizes Microsoft 365 data into `WorkContextEvent`s and runs the same local derivation pipeline used by every other source.

Useful Microsoft Graph permissions:

| Data | Least-privilege permission to start |
|---|---|
| Outlook calendar | `Calendars.ReadBasic` or `Calendars.Read` |
| Outlook mail | `Mail.ReadBasic` or `Mail.Read` |
| Teams chat | `Chat.Read` |
| Teams online meeting | `OnlineMeetings.Read` |
| Teams transcripts | `OnlineMeetingTranscript.Read.All` |

Teams transcripts and application/background meeting access can require tenant admin consent and an application access policy.

## Connect GitHub (read-only)

The GitHub connector pulls the two highest-value signals into Commitments/Triage, with no OAuth server — a local-first tool authorizes you to yourself, so a fine-grained Personal Access Token is the right fit:

- **Review requests** — PRs where you're a requested reviewer → "owed by me".
- **Assigned issues/PRs** — things you own.

Steps:

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate.
2. Scope it **read-only** (Pull requests: Read, Issues: Read) on the repos/org you want, and set an expiry.
3. Open the Memory Console → Admin → **GitHub** panel → paste the token → **Save token to keychain**.
4. Click **Sync**. Review requests and assignments appear as proposed commitments with provenance; confirm or dismiss each.

The token is stored in the OS keychain (file fallback at `~/.sidekick/secret-github-pat`, mode `0600`) and **never written to the database**. The connector is read-only.

**Background polling:** once a token is stored, Sidekick auto-syncs review-requests and assignments every 5 minutes (configurable via `SIDEKICK_POLL_INTERVAL_MS`; set to `0` to disable and use sync-on-click only). Polling is fully guarded — a GitHub outage or expired token logs a warning and never crashes the companion.

| Endpoint | Purpose |
|---|---|
| `POST /connectors/github/token` | Store a fine-grained PAT in the keychain. |
| `GET /connectors/github/status` | Whether a token is stored. |
| `POST /connectors/github/sync` | Import review-requests + assignments. |

## User Interfaces

Sidekick supports multiple user interfaces because the UI is a **Surface**, not the brain. All interfaces talk to the same Local Companion and share the same local memory.

| Interface | Folder / URL | Use |
|---|---|---|
| Memory Console UI | `http://127.0.0.1:4317/` | Inspect memory, test connectors, control privacy, delete/export, demo the shared brain. |
| Editor Surface | `sidekick/vscode-extension/` | VSIX-compatible editor capture, Resume, Plan, Focus Session, and capability commands. |
| Browser Extension Surface | `sidekick/browser-extension/` | Capture current web pages, use capability shortcuts, and view Focus Session state. |
| HTTP API | `http://127.0.0.1:4317/*` | Integration boundary for future browser extension and source connectors. |

This matches the architecture: **Surfaces** are thin clients; the **Local Companion** owns capture, store, memory, capabilities, and policy.

## Focus Session

Focus Session is a workflow under **Plan** and **Interaction / Attention Policy**. It is not a sixth capability.

Available from:

- Memory Console UI: `http://127.0.0.1:4317/`
- Editor Surface command: `Sidekick: Start Focus Session`
- Browser Extension popup: `Start 25m Focus`

API:

| Endpoint | Purpose |
|---|---|
| `POST /focus/start` | Start protected focus with `focus`, `duration_minutes`, `attention_mode`. |
| `GET /focus/current` | Read active timer and attention state. |
| `POST /focus/complete` | Complete or cancel focus and generate summary. |
| `GET /focus/sessions` | Inspect recent sessions. |

During Focus Session, Sidekick keeps capture ambient and reports only urgent triage items in the session state.

## Run the Browser Extension Surface

1. Start the Local Companion.
2. Open Chrome or Edge extensions page.
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select `sidekick/browser-extension`.
6. Open the extension popup.
7. Set:

```text
Companion URL: http://127.0.0.1:4317
Token: dev-local-token
```

The popup can capture the current page as a `WorkContextEvent`, start/complete a Focus Session, and ask all five capabilities through the Local Companion.

## API

| Endpoint | Auth | Purpose |
|---|---:|---|
| `GET /health` | No | Process and database health. |
| `POST /events` | Yes | Append a normalized `WorkContextEvent`, then derive memory, commitments, and lessons. |
| `GET /events?limit=50` | Yes | Inspect captured events. |
| `DELETE /events?source=editor` | Yes | Logically delete events and cascade derived records for inspect/delete UX. |
| `DELETE /commitments?id=...` | Yes | Logically delete a commitment by ID. |
| `DELETE /lessons?id=...` | Yes | Logically delete a lesson by ID. |
| `DELETE /memory?id=...` | Yes | Logically delete a memory record by ID. |
| `GET /resume` | Yes | **Resume**: "where was I?" |
| `GET /triage` | Yes | **Triage**: "what needs me now?" |
| `GET /commitments` | Yes | **Commitments**: "what did I promise?" |
| `GET /recall?q=payments` | Yes | **Recall**: "what did I learn?" |
| `GET /plan` | Yes | **Plan**: "what's realistic today?" |
| `POST /focus/start` | Yes | Start a Focus Session under **Plan** and **Interaction / Attention Policy**. |
| `GET /focus/current` | Yes | Read active Focus Session state. |
| `POST /focus/complete` | Yes | Complete or cancel active Focus Session. |
| `GET /focus/sessions` | Yes | Inspect recent Focus Sessions. |
| `POST /connectors/microsoft/sync` | Yes | Import Outlook/Teams data through Microsoft Graph. |
| `GET /memory?kind=semantic` | Yes | Inspect working or semantic memory. |

Manual smoke test:

```bash
curl -s http://127.0.0.1:4317/health

curl -s -X POST http://127.0.0.1:4317/events \
  -H 'authorization: Bearer dev-local-token' \
  -H 'content-type: application/json' \
  -d '{
    "source": "slack",
    "kind": "message",
    "ref": { "thread": "C123:1782547000" },
    "summary": "Maya asked: can you review the checkout retry PR by Friday?",
    "project": "payments",
    "confidence": 0.92,
    "origin": "work"
  }'

curl -s -X POST http://127.0.0.1:4317/events \
  -H 'authorization: Bearer dev-local-token' \
  -H 'content-type: application/json' \
  -d '{
    "source": "editor",
    "kind": "edited_file",
    "ref": { "file": "src/capture/retryPolicy.ts" },
    "summary": "Learned retry capture must preserve idempotency key.",
    "project": "payments",
    "confidence": 0.98,
    "origin": "work"
  }'

curl -s http://127.0.0.1:4317/resume -H 'authorization: Bearer dev-local-token'
curl -s http://127.0.0.1:4317/triage -H 'authorization: Bearer dev-local-token'
curl -s http://127.0.0.1:4317/commitments -H 'authorization: Bearer dev-local-token'
curl -s http://127.0.0.1:4317/recall -H 'authorization: Bearer dev-local-token'
curl -s http://127.0.0.1:4317/plan -H 'authorization: Bearer dev-local-token'
```

## Run Tests

```bash
cd sidekick/companion
npm test
```

The tests use a temporary SQLite database and exercise auth, validation, redaction, storage, derivation, and all five capability outputs.

`GET /recall?q=...` now ranks lessons and semantic memory with a lightweight local relevance score instead of returning a flat list.
The Memory Console `Ask Sidekick` input passes query text through to Recall when you ask what you learned about something.

## Run the Editor Surface

1. Start the Local Companion with `SIDEKICK_TOKEN=dev-local-token`.
2. Open `sidekick/vscode-extension` in VS Code, Cursor, Windsurf, VSCodium, or another VSIX-compatible editor.
3. Set these workspace settings:

```json
{
  "sidekick.companionUrl": "http://127.0.0.1:4317",
  "sidekick.authToken": "dev-local-token"
}
```

4. Press `F5` to launch the Extension Development Host.
5. Edit a workspace file.
6. Run any command:

| Command | Capability |
|---|---|
| `Sidekick: Where was I?` | **Resume** |
| `Sidekick: What needs me now?` | **Triage** |
| `Sidekick: What did I promise?` | **Commitments** |
| `Sidekick: What did I learn?` | **Recall** |
| `Sidekick: What's realistic today?` | **Plan** |
| `Sidekick: Start Focus Session` | Focus Session |
| `Sidekick: Complete Focus Session` | Focus Session |
| `Sidekick: Show Captured Events` | Inspectability |

## Implemented Production Behaviors

- Authenticated localhost API with constant-time token comparison.
- Loopback-only companion binding (warns loudly if bound to a non-loopback host).
- **OS keychain token storage** — macOS Keychain / Linux libsecret, with a `0600`-file fallback. The data directory is locked to `0700`.
- **Encryption at rest** — sensitive text columns (event summaries, refs, derived content, provenance) are AES-256-GCM encrypted before they touch disk; the `.sqlite` file alone cannot be read without the keychain secret.
- **Security headers** on every response: Content-Security-Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Per-client rate limiting** (fixed-window) returning `429` with `Retry-After`.
- **Structured, leveled JSON logging** with per-request id and latency (`SIDEKICK_LOG_LEVEL`).
- **Strict config validation** — non-numeric/out-of-range ports and short tokens fail fast with a clear error.
- WAL checkpoint on graceful shutdown.
- SQLite schema with events, commitments, lessons, memory records, and audit log.
- Append-oriented event storage with logical delete; cascading delete from source-history removal into derived records.
- Redaction for summaries and provenance strings before storage.
- Strict validation of canonical `WorkContextEvent` fields.
- Immediate derivation into `Commitment`, `Lesson`, and `MemoryRecord`.
- Lightweight local ranking for `GET /recall?q=...`.
- Read-only audit trail at `GET /audit`.
- All five capabilities over the shared local brain, with provenance on surfaced items.
- Memory Console UI, Editor Surface, and Browser Extension Surface — all redesigned with a dark, glassmorphic interface.
- 37 automated tests covering auth, validation, redaction, storage, derivation, capabilities, **encryption round-trip, config validation, rate limiting, and HTTP-level routing/auth**.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SIDEKICK_TOKEN` | keychain/file | API bearer token (min 16 chars if set explicitly). |
| `SIDEKICK_PORT` | `4317` | Loopback port (1–65535). |
| `SIDEKICK_ENCRYPT` | `true` | Set `false` to store plaintext (debugging only). |
| `SIDEKICK_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` / `silent`. |
| `SIDEKICK_RATE_MAX` | `240` | Requests per window per client. |
| `SIDEKICK_RATE_WINDOW_MS` | `10000` | Rate-limit window. |
| `SIDEKICK_KEYCHAIN` | auto | Set `file` to force the file token backend. |

## Hardening Still Needed Before Real Daily Use

- **GitHub connector is live** (fine-grained PAT, read-only, keychain-stored). Remaining connectors — GitLab, Jira/Linear, Slack — still need auth.
- Optional cloud/local model interface for higher-quality extraction and ranking.
- True semantic embeddings for Recall (currently keyword + lightweight local ranking).
- A proactive nudge surface (status-bar / OS notification) on top of the background poll, so new commitments reach you without opening the console.
