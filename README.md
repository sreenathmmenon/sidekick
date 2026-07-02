# Sidekick

**A local-first personal AI assistant for a developer's whole working day.**

> A developer's day isn't broken by one problem — it's broken by **fragmentation**. Your work context is scattered across ~30 tools, and no tool holds a memory of *you*. Sidekick is one local-first brain that captures your whole day once and removes the frictions *together* — running entirely on your machine, proposing (never acting), and showing provenance for everything.

---

## 👀 Start here

| If you want… | Read |
|---|---|
| **The architecture** (system design + diagrams) | **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** · [`Sidekick_Architecture.pdf`](./Sidekick_Architecture.pdf) |
| Every feature + the *why* | [`sidekick/FEATURES.md`](./sidekick/FEATURES.md) |
| Data model · privacy/security · cost & latency | [`APPENDIX_data_model.md`](./APPENDIX_data_model.md) · [`APPENDIX_privacy_security.md`](./APPENDIX_privacy_security.md) · [`APPENDIX_cost_latency.md`](./APPENDIX_cost_latency.md) |
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

Real, working, **88 tests passing**. What's still rough — by design, stated openly: the breadth is a deliberate bet; AI extraction is wired but not benchmarked against a live model; connectors (GitHub, M365) are partial; Recall is keyword, not embeddings; SQLite is Node's experimental build. See [`sidekick/PRODUCTION_READINESS.md`](./sidekick/PRODUCTION_READINESS.md) for the full, evidenced status.
