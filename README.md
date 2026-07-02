# Sidekick

**A local-first personal AI assistant for a developer's whole working day.**
*Hiring-challenge submission — Tech Lead track.*

> A developer's day isn't broken by one problem — it's broken by **fragmentation**. Your work context is scattered across ~30 tools, and no tool holds a memory of *you*. Sidekick is one local-first brain that captures your whole day once and removes the frictions *together* — running entirely on your machine, proposing (never acting), and showing provenance for everything.

---

## 👀 Start here

| If you want… | Read |
|---|---|
| **The submission** (problem → architecture → demo → honest gaps) | **[`sidekick/SUBMISSION.md`](./sidekick/SUBMISSION.md)** |
| The problem & research | [`senior_engineer_daily_friction.md`](./senior_engineer_daily_friction.md) · [`DESIGN_DOC.md`](./DESIGN_DOC.md) |
| The architecture | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Every feature + the *why* | [`sidekick/FEATURES.md`](./sidekick/FEATURES.md) |
| The video script | [`VIDEO_SCRIPT.md`](./VIDEO_SCRIPT.md) |
| A visual demo walkthrough | [`sidekick/DEMO.md`](./sidekick/DEMO.md) |
| Production-readiness evidence | [`sidekick/PRODUCTION_READINESS.md`](./sidekick/PRODUCTION_READINESS.md) |

---

## ▶️ Run the working system

Requires **Node ≥ 22.5.0** (uses the built-in SQLite; `npm start` sets `--experimental-sqlite`). **Zero npm dependencies.**

```bash
cd sidekick/companion
SIDEKICK_TOKEN=sidekick-local-demo-token npm start
# then open the Memory Console:
open http://127.0.0.1:4317/        # the console auto-loads its token
```

**Surfaces:**
- **Memory Console** — `http://127.0.0.1:4317/`
- **VS Code extension** — open `sidekick/vscode-extension` in VS Code, press `F5`.
- **Chrome/Edge extension** — `chrome://extensions` → Developer mode → Load unpacked → `sidekick/browser-extension`.

**Run the tests:**
```bash
cd sidekick/companion && npm test   # 88 tests
```

---

## What it is, in one diagram

```
┌─ Memory Console (web)  ┐
├─ VS Code extension     ┤──HTTP──▶  Local Companion (Node, loopback only)
└─ Browser extension     ┘              │
                                        ├─ Capture → WorkContextEvent (one canonical model)
                                        ├─ Derive → Commitments / Lessons / Memory
                                        ├─ Encrypted SQLite timeline (AES-256-GCM)
                                        └─ Capabilities read over the shared memory
```

**Five capabilities:** Resume · Triage · Commitments · Recall · Plan.
**Workflows:** Focus Session · Briefing · Meeting lifecycle · GTD tasks (plain `~/.sidekick/TODO.md`).
**Principles:** local-first · propose-don't-act · provenance everywhere · quiet by default · inspectable & reversible.

---

## Honest status

Real, working, **88 tests passing**. What's still rough — by design, stated openly: the breadth is a deliberate bet; AI extraction is wired but not benchmarked against a live model; connectors (GitHub, M365) are partial; Recall is keyword, not embeddings; SQLite is Node's experimental build. Full honesty in [`SUBMISSION.md` → What's broken](./sidekick/SUBMISSION.md).

*Internal process notes (`COUNCIL_REVIEW.md`, `SIDEKICK_PROGRESS.md`, `CODEX_BRIEF.md`, `PROJECT_STATUS_AND_HANDOFF.md`) are kept for transparency about how this was built, not as submission material.*
