# Sidekick Slide Outline

Assumptions:
- Target talk is 5-10 minutes.
- The presenter will screen-share the Mermaid architecture diagram from `diagrams/system_overview.mmd`.
- The local project in `sidekick/` is optional to demo, but useful as proof that the architecture is grounded.

## Slide 1 — Sidekick

- Personal AI assistant for a senior engineer's working day.
- Fixes the friction around coding, not code generation itself.
- One broad assistant, five capabilities, one shared local-first memory.
- Delivered through Surfaces backed by a Local Companion.

## Slide 2 — The Daily Friction

- **Resume:** context reconstruction after interruptions.
- **Triage:** human-router overload across Slack/Teams/Jira/PRs/email.
- **Commitments:** promises scattered across tools.
- **Recall:** durable lessons evaporate after debugging or reading.
- **Plan:** the day-shape is wrong by 11am.

## Slide 3 — Why One Assistant

- Point tools do not share the user's context.
- Sidekick uses one **State + Timeline Store** and one **Memory Subsystem**.
- Capabilities are thin consumers of the shared brain.
- The value is integration a generic single-feature product cannot have.

## Slide 4 — Architecture

- **Surfaces** are thin editor and browser extensions.
- **Local Companion** holds capture, store, memory, reasoning, capabilities, policy, and connectors.
- **Connector Framework** normalizes read-only sources into `WorkContextEvent`.
- **Interaction / Attention Policy** keeps Sidekick quiet by default.

## Slide 5 — Key Flows

- **Resume:** capture work context, detect interruption, reconstruct pre-gap state.
- **Commitments:** message arrives, normalize event, extract owed-by/owed-to item with provenance.
- **Triage:** read obligations across sources, rank urgency x importance, propose.
- Every surfaced item traces back to source refs.

## Slide 6 — Trade-Offs

- Thin extensions + Local Companion, not all-in-browser.
- Single agent + tools, not multi-agent swarm.
- Local-first by default, optional cloud LLM behind redaction.
- Propose-don't-act because trust beats autonomy.
- Retrieval-not-dump because context rot is the scaling enemy.

## Slide 7 — End-to-End Project

- `sidekick/companion`: authenticated localhost API, SQLite timeline, memory, derived entities.
- `sidekick/vscode-extension`: captures editor events and calls all five capability commands.
- Demonstrates capture -> store -> memory -> capabilities -> proposal UI.
- External tools feed the same `WorkContextEvent` ingestion boundary.

## Slide 8 — What's Broken

- Capture scope is a tightrope: too little is useless, too much is creepy.
- **Recall** is hardest; durable lesson detection should start manual.
- Surfacing quality will be wrong early and needs feedback loops.
- Adoption is the real test: keep the complete assistant quiet enough to trust.
- Budget cut answer: reduce source breadth and cloud calls, keep all five capabilities.
