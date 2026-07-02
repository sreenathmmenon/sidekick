# Sidekick Appendix: Cost and Latency

This appendix estimates the monthly LLM token envelope and interactive latency for one Sidekick user across increasing daily capture breadth. The main design controls are quiet-by-default surfacing, single-agent reasoning, and retrieval of a small relevant context set rather than dumping the whole timeline.

Assumptions:
- One active work user, 22 workdays per month.
- Token estimates include input and output tokens for LLM calls made by the **LLM Reasoning Core**.
- Cost model uses an illustrative blended model price of `$3.00 / 1M input tokens` and `$10.00 / 1M output tokens`.
- Average LLM call shape is `2,500 input tokens` and `500 output tokens` after retrieval and summarization.
- The complete local implementation in `sidekick/` does not require an LLM for deterministic capability outputs; the estimate below is for the designed architecture once model-backed reasoning is enabled.
- Prices are intentionally rough and should be replaced with the chosen model provider's current price sheet before production.

## Monthly Token Envelope

| Capture breadth | Integrations | Capabilities | Events/day | Events triggering LLM | LLM calls/day | Tokens/day | Estimated monthly cost |
|---|---|---|---:|---:|---:|---:|---:|
| Narrow | VS Code + GitHub | All five capabilities over limited sources | 120 | 10% | 12 | 36k | `$3.30` |
| Broad | + Slack/Teams + Jira | All five capabilities over cross-tool obligations | 300 | 15% | 45 | 135k | `$12.38` |
| Full | + Calendar/Meetings/Docs | All five capabilities over the working day | 450 | 18% | 81 | 243k | `$22.28` |

Calculation:

```text
tokens/day = LLM calls/day * (2,500 input + 500 output)
input cost/month = input tokens/day * 22 / 1,000,000 * $3.00
output cost/month = output tokens/day * 22 / 1,000,000 * $10.00
```

Full-breadth example:

```text
input: 81 * 2,500 * 22 = 4.455M tokens -> $13.37
output: 81 * 500 * 22 = 0.891M tokens -> $8.91
```

## Why the Cost Does Not Explode

| Control | Cost impact | Design consequence |
|---|---|---|
| Quiet by default | Fewer surfacing decisions become LLM calls. | Low-value events stay ambient or are ignored. |
| Single agent + tools | Avoids repeated multi-agent prompt fanout. | One guarded reasoning path shared by all capabilities. |
| Retrieval-not-dump | Keeps prompt context bounded. | Capabilities retrieve recent and relevant events only. |
| Source-specific classifiers | Cheap local rules handle obvious cases. | LLM is reserved for ambiguous ranking/extraction. |
| Confidence thresholds | Suppresses low-confidence outputs. | Fewer retries, fewer noisy proposals. |
| Async summarization | Batches non-urgent work. | Summaries are created off the interactive path. |

## Latency Budget

Target: interactive surfacing should feel immediate, with a target under 2 seconds from user request or eligible event to visible proposal.

| Path | User-visible? | Target | Budget breakdown | Notes |
|---|---:|---:|---|---|
| Capture `edited_file` | No | `<100 ms` | Surface emit 10 ms, localhost POST 40 ms, append 20 ms, ack 30 ms | Async; should not block editor typing. |
| Resume request | Yes | `<1.5 s` | SQLite query 50 ms, memory retrieval 100 ms, optional LLM 900 ms, policy 50 ms, UI render 100 ms | Local implementation returns deterministic timeline summary without LLM. |
| Commitment extraction | Mostly no | `<5 min async` | Connector poll, normalize, batch extract, store | Surfacing can be delayed unless due soon or high confidence. |
| Triage refresh | Yes when opened | `<2.0 s` | Read obligations 150 ms, retrieve context 150 ms, rank 1,200 ms, policy/UI 200 ms | Background refresh keeps panel warm. |
| Plan adjustment | Yes when proposed | `<2.0 s` | Calendar/task read 200 ms, retrieve day context 200 ms, reason 1,200 ms, UI 200 ms | Propose-don't-override; never silently reshuffles. |
| Recall resurfacing | Usually ambient | `<2.0 s` | Similarity search 150 ms, evidence check 300 ms, optional LLM 1,000 ms, UI 200 ms | Suppressed unless provenance is strong. |

## Interactive vs Async Work

| Work item | Mode | Reason |
|---|---|---|
| Append `WorkContextEvent` | Async/background | Capture must be cheap and reliable. |
| Dedup noisy editor/browser signals | Async/background | Prevents repeated LLM calls from bursty activity. |
| Build working memory snapshot | Async/background | Keeps Resume warm before interruption happens. |
| Extract candidate commitments | Async/background | Most commitments are not urgent at message-arrival time. |
| User asks "where was I?" | Interactive | Direct user request; must return quickly. |
| User opens Triage | Interactive with cached background state | Ranking must be fresh, but not recomputed from the full timeline. |
| Plan proposes a day change | Interactive proposal | User decides; Sidekick never overrides. |

## Latency Failure Behavior

| Failure | Behavior |
|---|---|
| Cloud LLM is slow | Return deterministic local summary with "reasoning still running" status. |
| Connector is stale | Surface with stale-data badge and provenance timestamp. |
| Vector index is unavailable | Fall back to recency-based SQLite retrieval. |
| Local Companion is disconnected | Surfaces buffer events and show reconnect state. |
| Confidence is low | Suppress proposal or show only in ambient panel. |

## Budget-Cut Interpretation

If budget is cut in half, keep the complete assistant shape but reduce source breadth and model usage:

- Keep **Surfaces**, **Local Companion**, **Context Capture Layer**, **Event & Data Model**, **State + Timeline Store**, **Memory Subsystem**, **LLM Reasoning Core** interface, all five capabilities, **Interaction / Attention Policy**, and the **Connector Framework**.
- Reduce connectors and cloud model calls before removing capabilities.
- Use deterministic local reasoning for low-risk extraction and ranking.

This preserves the broad assistant and cuts integration breadth, not the product thesis.
