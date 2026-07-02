# Sidekick — Video Script (Tech Lead track)

**Target: 8–12 min.** Structure follows the Tech-Lead sections:
**The Problem (2m) · Live Demo (2–3m) · How You Built It (3–4m) · What's Broken (1–2m).**

> Tone: clear thinking over polish. Talk like you're convincing your own team. Don't read this — *know* it.
> On-screen cues are in **[brackets]**. Times are cumulative.

---

## ① THE PROBLEM — fragmentation, not a single friction  · [0:00–2:00]

**[Webcam / you talking. No slides yet.]**

"Hi, I'm Sreenath. I want to talk about a problem I live every single day as a senior engineer and tech lead — and then show you the system I built for it.

My day is shattered across about thirty tools: an IDE, two browsers with thirty tabs, Slack, Teams, Outlook, Jira, GitHub, Grafana, PagerDuty. And here's the thing I kept noticing — **it's not one problem. It's many small frictions that all share one root cause.**

**[Slide: the numbers.]**
The average digital worker toggles between apps about **1,200 times a day** — once every 24 seconds. Context switching costs up to **40% of productivity**. We spend roughly **3.6 hours a day just searching for information**. Microsoft's 2025 data: an interruption every two minutes.

And when I mapped my *own* frictions — losing context after every interruption, dropping promises I made in Slack, notes rotting in docs, meetings eating my day, my plan dead by 10am — I realized **they're the same problem wearing different masks.** My work context is fragmented across tools, and **no tool holds a memory of me.**

Calendar apps defend my time but can't rebuild lost context. Note apps store knowledge but don't know what I'm doing now. Task apps track todos but don't capture the promises I make automatically.

So I made a bet: the fix isn't a *sixth* tool. It's **one local-first brain** that captures my whole day once, and removes these frictions *together*. That's Sidekick."

**[Transition: screen-share the running console.]**

---

## ② LIVE DEMO — show it working, including an edge case  · [2:00–5:00]

**[Screen-share http://127.0.0.1:4317/, already seeded with a realistic day.]**

"This is the Memory Console. It's running entirely on my machine — loopback only, nothing in the cloud.

**[Point to the Briefing.]**
First thing in the morning, it *tells* me my day instead of me digging: 'You left off in retryPolicy.ts. Three things need you now. You owe Maya a review by Friday. Priya owes you the staging fix Monday.' That one paragraph is composed from three different capabilities sharing one memory.

**[Click through the capability panels.]**
- **Resume** — where I was before the last interruption, with the file to re-open.
- **Triage** — ranked by urgency × importance, each with provenance back to the real source.
- **Commitments** — the one I'd never give up. Promises I made and am owed, captured automatically from Slack and GitHub and meetings. Each says *why* it fired and lets me confirm or dismiss.

**[The edge case — do this deliberately.]**
Now, honesty. The extraction is deterministic regex at its floor, and it has failure modes. **[Capture a messy line, e.g. 'let's circle back after I sync with Priya.']** See — it doesn't catch that as a commitment, because it's phrased loosely. That's a real limitation. My design choice was: every derived item is *proposed*, never acted on, and I can confirm or dismiss — so a miss or a false positive never costs me. The system fails *safe*.

**[The Tasks board + Markdown reveal.]**
And here's the part I like most. My task list is a Things-style board — add, move, reschedule, mark done. But underneath, **[open ~/.sidekick/TODO.md in an editor]** it's just plain Markdown in my home folder. If Sidekick vanishes tomorrow, my todos are still a file I own. Zero lock-in.

**[Quick flash of the editor + browser extension.]**
Same brain, three surfaces — the editor extension captures what I'm working on, the browser extension captures a PR or doc. Thin clients; the companion is the brain."

---

## ③ HOW YOU BUILT IT — architecture + key choices  · [5:00–9:00]

**[Screen-share ARCHITECTURE.md diagram, then the code.]**

"Architecturally, the whole thing is one principle: **surfaces are thin, the companion owns everything.**

**[Diagram.]**
Every surface sends one canonical thing — a `WorkContextEvent` — to a local Node companion. The companion captures it into encrypted SQLite, *derives* commitments, lessons, and memory from it, and the five capabilities read over that shared timeline. That single event contract is *why* one shared brain is possible — surfaces and connectors stay dumb.

**[Code: derive.js, then the security modules.]**
Three key choices I want to defend:

**One — propose, don't act.** Nothing auto-schedules, auto-replies, or auto-commits. Everything is a *proposal* with provenance and a confirm/dismiss. For a tool that captures your whole day, that's the only trustworthy posture.

**Two — local-first, and I mean it.** The SQLite store is AES-256-GCM encrypted at rest. **[Show crypto.js / the test.]** And a subtle but important fix: the encryption key is *decoupled* from the API token, so rotating your token can't brick your database. The AI layer is *fail-closed* — **[show extractor.js selectExtractorTier]** — even with an API key in the environment, 'auto' mode never sends to the cloud. Cloud extraction requires an explicit opt-in and redacts the payload first. For a privacy tool, accidental egress is an incident, not a bug.

**Three — a deterministic floor, AI as an optional accelerator.** **[Show the regex derive + the LLM enrichment.]** The whole thing works offline with zero API key, using regex. The LLM is enrichment layered on top — it *proposes more*, never blocks, and if it fails it falls back silently. So the product is useful to the skeptic who'll never paste a key, and better for the power user who will.

**[Tests.]**
And it's real — 88 tests, covering auth, encryption round-trips, transactional writes, the no-cloud-egress guarantee, and every capability. **[Run `npm test`, show green.]**"

---

## ④ WHAT'S BROKEN — be honest  · [9:00–11:00]

**[Back to webcam. This section earns the Self-Awareness score — don't soften it.]**

"Now the honest part, because this is where I learned the most.

**The breadth is a bet, and it's my biggest risk.** I got obsessive about this problem space and kept folding in my own daily frictions until the product got broad. I believe the fragmentation thesis justifies it — but if you told me to cut to one thing, I'd ship **Commitments** alone: never drop a promise. That's the highest-stakes, most defensible slice.

**The AI extraction is wired and tested, but with mock models — I haven't benchmarked it against a live LLM.** So I genuinely don't know its real-world precision on messy text yet. The deterministic floor is honest but has false-positive edges I showed you.

**The connectors are partial** — GitHub and Microsoft 365 work; GitLab, Jira, and Slack still need real auth.

**Recall is keyword search, not embeddings** — and I labeled it that way in the product instead of overselling it.

**And it runs on Node's experimental SQLite** — fine for a local single-user tool, guarded at startup, but I'd want a stable backend before shipping to others.

What I'm proudest of isn't the feature count — it's the *foundation*: the security model, provenance on everything, and propose-don't-act. The discipline is in the floor, not the surface.

That's Sidekick. Thanks for watching."

**[End.]**

---

## Pre-record checklist
- [ ] Companion running + seeded (`SIDEKICK_TOKEN=… npm start`, then the demo seed).
- [ ] `~/.sidekick/TODO.md` open in a second editor pane for the Markdown reveal.
- [ ] `ARCHITECTURE.md` diagram + `extractor.js` / `crypto.js` / `derive.js` tabs ready.
- [ ] A messy commitment line ready to paste for the live edge case.
- [ ] `npm test` terminal ready to show green.
- [ ] End honestly on "What's Broken" — do **not** end on a feature flex.

## Live-discussion prep (the 20-min screen they do after)
- *"Budget cut in half — what gets cut?"* → "Everything but Commitments + the capture pipeline. The foundation stays; the breadth goes."
- *"Client adds a requirement mid-flight?"* → "The `POST /events` contract means a new source is a thin connector, not a rearchitecture — show how GitHub plugs in."
- *"Why local-first, not a SaaS?"* → trust + the differentiator a cloud competitor (Littlebird, $11M) structurally can't match.
- *"Why so broad?"* → the fragmentation thesis; and name the risk before they do.
