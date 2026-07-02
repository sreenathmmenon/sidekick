# Sidekick — Submission (Tech Lead track)

**Project:** Sidekick — a local-first personal AI assistant for a developer's whole working day.
**Submitter:** Sreenath
**Track:** Tech Lead (architecture + working-system demo)

---

## TL;DR

A developer's day isn't broken by *one* problem — it's broken by **fragmentation**. Your work context is scattered across ~30 tools, and no tool holds a memory of *you*. Sidekick is the bet that the right fix isn't a sixth point-tool, but **one local-first brain** that captures your whole day once and removes the frictions *together*. It runs entirely on your machine, proposes (never acts), and shows its provenance for everything.

It is a **real, working system**: a Node companion (encrypted SQLite, 88 passing tests), three thin surfaces (web console, VS Code extension, Chrome extension), five capabilities, a meeting lifecycle, a GTD task layer in plain Markdown, GitHub + Microsoft 365 connectors, and an optional, fail-closed AI extraction layer.

---

## 1. The Problem — why fragmentation, not a single friction

> *We're not looking for polish. We're looking for understanding.*

**This problem is personally lived.** We're senior engineers / tech leads. Our day is shattered across an IDE, two browsers with ~30 tabs, Slack, Teams, Outlook, Jira, GitHub, Confluence, Grafana, PagerDuty — and the cost is measured, not imagined:

- The average digital worker **toggles between apps ~1,200×/day** — roughly **once every 24 seconds** (HBR). *(fact-checked, 3-vote verified in our research doc)*
- Context switching causes up to a **~40% drop in productivity** and is estimated to cost the global economy **~$450B/year**.
- Knowledge workers spend an average of **~3.6 hours/day just searching for information**.
- Microsoft's 2025 Work Trend Index: a ping every ~2 minutes, **~275 interruptions/day**.

**The honest origin story (and our biggest scoping risk).** We started narrow, but the more we mapped our *own* daily frictions — context loss after interruptions, dropped promises, scattered notes, meeting waste, plan-vs-reality drift — the more we saw they share **one root cause: fragmented work context with no shared memory.** So we built broad *on purpose*. We name this tradeoff openly in "What's Broken" — breadth is a bet, and we know it.

**Why existing tools fall short.** Calendar tools defend *time* but can't reassemble lost *context*. Note apps store knowledge but don't know what you're doing now. Task apps track todos but don't capture your promises automatically. Each owns one slice; **none shares a memory of you across the whole day.** That shared memory is the differentiator a single-feature tool structurally can't have.

**The insight in one line:** *Solve the frictions together, with one local memory — because they're the same problem wearing different masks.*

---

## 2. What we built (the whole product)

One private memory → five capabilities + workflows → three thin surfaces.

| Layer | What |
|---|---|
| **Capabilities** | 🧭 Resume ("where was I?") · 📥 Triage ("what needs me now?") · ✅ Commitments ("what did I promise?") · 🧠 Recall ("what did I learn?") · 🗓️ Plan ("what's realistic today?") |
| **Workflows** | Focus Session (smart deep-work timer) · Briefing (proactive morning digest) · Meeting lifecycle (prep → ingest notes/transcript → action items become tracked commitments) · GTD task board in plain `~/.sidekick/TODO.md` |
| **Connectors** | GitHub (review-requests + assignments, polled) · Microsoft 365 (Graph) · open `POST /events` boundary |
| **Surfaces** | Memory Console (web) · VS Code editor extension · Chrome/Edge extension |
| **Foundation** | Encrypted SQLite (AES-256-GCM, key decoupled from the API token) · loopback-only · provenance on everything · transactional writes · fail-closed AI extraction (regex floor → local LLM → cloud, never auto-egress) |

**Principles:** local-first · propose-don't-act · provenance everywhere · quiet by default · inspectable & reversible.

---

## 3. Mapped to the four evaluation criteria

| Criterion | Where we address it |
|---|---|
| **Problem Identification** | A personally-lived, research-anchored problem (§1). Not "an app idea" — a measured, fragmentation-shaped pain we feel daily. |
| **Technical Understanding** | A real working system: 24 source modules, 88 tests, encryption-at-rest with key decoupling, transactional writes, fail-closed AI egress, a single canonical event model. See `ARCHITECTURE.md` and the code walkthrough in the video. |
| **Scoping** | We chose breadth *deliberately* and can defend it — and we show scoping discipline elsewhere: a deterministic floor that needs no LLM, connectors gated read-only, AI that can never auto-act. We also state what we'd cut first (§"What's Broken"). |
| **Self-Awareness** | We're honest about the breadth risk, the unproven AI-extraction quality, the stubbed connectors, the keyword-only Recall, and the experimental SQLite dependency. We even removed popular productivity stats that failed fact-checking. |

---

## 4. The artifacts (submission order)

1. **This file** — start here.
2. **Problem & research** — [`senior_engineer_daily_friction.md`](./../senior_engineer_daily_friction.md) (fact-checked friction map) + [`DESIGN_DOC.md`](./../DESIGN_DOC.md).
3. **Architecture** — [`ARCHITECTURE.md`](./../ARCHITECTURE.md) (10 components, diagrams, trade-offs) + appendices (data model, privacy/security, cost/latency).
4. **Features & workflows** — [`FEATURES.md`](./FEATURES.md) (every feature with *what* + *why*).
5. **The working system** — [`README.md`](./README.md) to run it; [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) for the evidenced quality checklist.
6. **Demo** — [`DEMO.md`](./DEMO.md) + [`demo-shots/`](./demo-shots/) (live screenshots across all three surfaces).
7. **Video** — see [`VIDEO_SCRIPT.md`](./../VIDEO_SCRIPT.md) (8–12 min, Tech-Lead structure).

---

## 5. How to run the working system (90 seconds)

```bash
cd sidekick/companion
SIDEKICK_TOKEN=sidekick-local-demo-token npm start
# open http://127.0.0.1:4317/  (the console auto-loads its token)
# extensions: load sidekick/vscode-extension (F5) and sidekick/browser-extension (Load unpacked)
```

Requires Node ≥ 22.5.0 (uses the built-in SQLite via `--experimental-sqlite`, which `npm start` sets). Zero npm dependencies.

---

## 6. What's broken / what we'd improve (the honest part)

- **The breadth is a bet.** It's our biggest scoping risk. If we had to cut to one capability, we'd lead with **Commitments** (never drop a promise) — it's the highest-stakes and most defensible.
- **AI extraction is wired and tested with mock models, but not benchmarked against a live LLM** — so its real-world precision on messy text is unproven. The deterministic regex floor is honest but has known false-positive edges.
- **Connectors are partial** — GitHub + M365 work; GitLab/Jira/Slack still need auth.
- **Recall is keyword search, not embeddings** — labeled honestly as such in the product.
- **`node:sqlite` is experimental** — bounded risk for a local single-user tool; guarded at startup.
- **We over-built.** Honestly: we got obsessive about the problem space and kept folding in our own daily frictions. The discipline we're proudest of is the *foundation* (security, provenance, propose-don't-act), not the feature count.

---

*Tech Lead track submission.*
