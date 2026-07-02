# Sidekick Appendix: Data Model

This appendix expands the canonical Sidekick data model used by the **Context Capture Layer**, **State + Timeline Store**, **Memory Subsystem**, **Capability Layer**, and **Connector Framework**.

Assumptions:
- IDs are UUID strings generated locally by the **Local Companion**.
- Timestamps are ISO 8601 UTC strings at storage boundaries.
- All examples are redacted before storage or any cloud LLM call.
- `provenance_ref` and `ref` are intentionally lightweight pointers; the source system remains the system of record.

## WorkContextEvent

Canonical event emitted by Surfaces and the Connector Framework after normalization, privacy filtering, and deduplication.

| Field | Type | Required? | Description |
|---|---:|:---:|---|
| `id` | `uuid` | Yes | Locally generated event ID. |
| `ts` | `timestamp` | Yes | Time the observed work context happened. |
| `source` | `editor \| github \| jira \| slack \| teams \| mail \| calendar \| meeting \| docs \| browser` | Yes | Normalized source category. |
| `kind` | `edited_file \| reviewing_pr \| opened_ticket \| mentioned \| message \| read_doc \| meeting_action \| calendar_event \| ...` | Yes | Normalized event kind. |
| `ref` | `{ url?, repo?, pr?, ticket?, thread?, file? }` | Yes | Provenance pointer back to the source. |
| `summary` | `string` | Yes | Short, redacted summary suitable for retrieval and display. |
| `project` | `string \| null` | Yes | Inferred or explicit project name. |
| `confidence` | `number` | Yes | Extraction certainty from `0.0` to `1.0`. |
| `origin` | `work \| personal` | Yes | Boundary used for privacy and surfacing policy. |

### Example: PR review event

```json
{
  "id": "2b9b3de2-f0dc-4bb3-9b0c-5962628c85b3",
  "ts": "2026-06-28T04:45:18Z",
  "source": "github",
  "kind": "reviewing_pr",
  "ref": {
    "url": "https://github.com/acme/payments/pull/412",
    "repo": "acme/payments",
    "pr": "412"
  },
  "summary": "Reviewed retry behavior in checkout payment capture flow.",
  "project": "payments",
  "confidence": 0.94,
  "origin": "work"
}
```

### Example: edited file event

```json
{
  "id": "c18f7f15-0910-419b-a697-4cc614fa052d",
  "ts": "2026-06-28T05:02:41Z",
  "source": "editor",
  "kind": "edited_file",
  "ref": {
    "repo": "acme/payments",
    "file": "src/capture/retryPolicy.ts"
  },
  "summary": "Edited retry policy around idempotent capture failures.",
  "project": "payments",
  "confidence": 0.98,
  "origin": "work"
}
```

### Example: opened ticket event

```json
{
  "id": "fe9d3018-f352-413c-b2dc-2c5325f08fb0",
  "ts": "2026-06-28T06:20:09Z",
  "source": "jira",
  "kind": "opened_ticket",
  "ref": {
    "url": "https://acme.atlassian.net/browse/PAY-1842",
    "ticket": "PAY-1842"
  },
  "summary": "Opened incident follow-up for duplicate capture alert.",
  "project": "payments",
  "confidence": 0.91,
  "origin": "work"
}
```

## Commitment

Derived entity produced by **Commitments** from events such as chat messages, meeting actions, PR review requests, tickets, or mail.

| Field | Type | Required? | Description |
|---|---:|:---:|---|
| `id` | `uuid` | Yes | Locally generated commitment ID. |
| `source_event_id` | `uuid` | Yes | Source `WorkContextEvent` used to derive the commitment. |
| `direction` | `owed_by_me \| owed_to_me` | Yes | Whether the user owes the work or is waiting on someone else. |
| `what` | `string` | Yes | Short redacted statement of the obligation. |
| `who` | `string` | Yes | Person or group involved, redacted if needed. |
| `due` | `timestamp \| null` | No | Explicit or inferred due time. Null when unknown. |
| `status` | `open \| proposed \| accepted \| dismissed \| done \| stale` | Yes | Current lifecycle status. |
| `confidence` | `number` | Yes | Extraction certainty from `0.0` to `1.0`. |
| `provenance_ref` | `{ url?, repo?, pr?, ticket?, thread?, file? }` | Yes | Source pointer shown with every surfaced item. |

### Example: Slack-derived commitment owed by me

```json
{
  "id": "90f80964-cd48-4957-a247-5849e4836de7",
  "source_event_id": "9f215f88-8a43-4071-bef2-d0d6f2858145",
  "direction": "owed_by_me",
  "what": "Review the checkout retry PR before Friday standup.",
  "who": "Maya",
  "due": "2026-07-03T04:30:00Z",
  "status": "proposed",
  "confidence": 0.86,
  "provenance_ref": {
    "url": "https://slack.com/archives/C123/p1782547000",
    "thread": "C123:1782547000"
  }
}
```

### Example: Jira commitment owed to me

```json
{
  "id": "456b71c3-c8e9-4229-b036-f19c12e031b7",
  "source_event_id": "fe9d3018-f352-413c-b2dc-2c5325f08fb0",
  "direction": "owed_to_me",
  "what": "SRE to attach duplicate capture logs to the incident ticket.",
  "who": "SRE on-call",
  "due": "2026-06-29T12:00:00Z",
  "status": "open",
  "confidence": 0.79,
  "provenance_ref": {
    "url": "https://acme.atlassian.net/browse/PAY-1842",
    "ticket": "PAY-1842"
  }
}
```

### Example: meeting action item

```json
{
  "id": "8779f0fe-b9d8-4f11-860c-e88e8215089d",
  "source_event_id": "a6467563-c7cd-4acb-bfc7-85ce4c99e1d8",
  "direction": "owed_by_me",
  "what": "Send a one-page rollout risk summary for payment retries.",
  "who": "Platform leads",
  "due": "2026-07-01T10:00:00Z",
  "status": "accepted",
  "confidence": 0.9,
  "provenance_ref": {
    "url": "https://granola.ai/notes/redacted-payment-rollout",
    "thread": "meeting:payment-rollout-2026-06-28"
  }
}
```

## Lesson

Derived durable knowledge produced by **Recall** from docs read, debugging sessions, PR reviews, incidents, or explicit "save this lesson" actions.

| Field | Type | Required? | Description |
|---|---:|:---:|---|
| `id` | `uuid` | Yes | Locally generated lesson ID. |
| `topic` | `string` | Yes | Retrieval topic or short label. |
| `insight` | `string` | Yes | Durable lesson in redacted, reusable form. |
| `source_refs` | `Array<{ url?, repo?, pr?, ticket?, thread?, file? }>` | Yes | Provenance references supporting the lesson. |
| `source_event_ids` | `uuid[]` | Yes | Source events that produced the lesson. |
| `created_ts` | `timestamp` | Yes | When the lesson was created. |
| `last_surfaced_ts` | `timestamp \| null` | No | Last time Recall resurfaced it. |

### Example: debugging lesson

```json
{
  "id": "f94a8352-b513-43a3-ae6a-37a58588ab77",
  "topic": "payment capture retries",
  "insight": "Retrying capture without preserving the idempotency key can create duplicate downstream attempts.",
  "source_refs": [
    {
      "repo": "acme/payments",
      "file": "src/capture/retryPolicy.ts"
    },
    {
      "url": "https://acme.atlassian.net/browse/PAY-1842",
      "ticket": "PAY-1842"
    }
  ],
  "source_event_ids": [
    "c18f7f15-0910-419b-a697-4cc614fa052d"
  ],
  "created_ts": "2026-06-28T08:05:00Z",
  "last_surfaced_ts": null
}
```

### Example: doc-reading lesson

```json
{
  "id": "19cecd4f-bde6-4872-a2be-2e99570ec7b7",
  "topic": "browser extension MV3",
  "insight": "Manifest V3 background workers are not reliable always-on agents; persistent reasoning belongs in the Local Companion.",
  "source_refs": [
    {
      "url": "https://developer.chrome.com/docs/extensions/develop/concepts/service-workers"
    }
  ],
  "source_event_ids": [
    "19cecd4f-bde6-4872-a2be-2e99570ec7b7"
  ],
  "created_ts": "2026-06-28T09:12:20Z",
  "last_surfaced_ts": "2026-06-28T10:00:42Z"
}
```

### Example: review lesson

```json
{
  "id": "6da38d79-b885-42e9-a3ff-fc4459275a42",
  "topic": "rollout safety",
  "insight": "For payment-flow changes, require a rollback note and alert owner before approving the PR.",
  "source_refs": [
    {
      "url": "https://github.com/acme/payments/pull/412",
      "repo": "acme/payments",
      "pr": "412"
    }
  ],
  "source_event_ids": [
    "2b9b3de2-f0dc-4bb3-9b0c-5962628c85b3"
  ],
  "created_ts": "2026-06-28T11:24:33Z",
  "last_surfaced_ts": null
}
```

## MemoryRecord

Internal record managed by the **Memory Subsystem**. It separates working memory from semantic memory while preserving provenance and deletion controls.

| Field | Type | Required? | Description |
|---|---:|:---:|---|
| `id` | `uuid` | Yes | Locally generated memory record ID. |
| `kind` | `working \| semantic` | Yes | Working memory is current/day state; semantic memory is durable knowledge. |
| `topic` | `string` | Yes | Retrieval label. |
| `content` | `string` | Yes | Redacted memory content. |
| `source_event_ids` | `uuid[]` | Yes | Events that justify this memory. Empty only for explicit user preferences. |
| `source_refs` | `Array<{ url?, repo?, pr?, ticket?, thread?, file? }>` | Yes | Provenance shown to the user. |
| `embedding_ref` | `string \| null` | No | Pointer to vector index entry, not the vector itself. |
| `persistence_policy` | `clear_day_end \| keep_until_done \| keep_until_deleted \| ask_before_promote` | Yes | Retention rule. |
| `privacy_level` | `local_only \| cloud_allowed_redacted` | Yes | Boundary for LLM use. |
| `confidence` | `number` | Yes | Confidence from `0.0` to `1.0`. |
| `created_ts` | `timestamp` | Yes | Creation time. |
| `updated_ts` | `timestamp` | Yes | Last update time. |

### Example: working memory record

```json
{
  "id": "66c7f4ab-adfc-4d55-988e-7fed724e38a4",
  "kind": "working",
  "topic": "current focus",
  "content": "Mid-review of PR 412; check retry tests and rollback notes next.",
  "source_event_ids": [
    "2b9b3de2-f0dc-4bb3-9b0c-5962628c85b3",
    "c18f7f15-0910-419b-a697-4cc614fa052d"
  ],
  "source_refs": [
    {
      "url": "https://github.com/acme/payments/pull/412",
      "repo": "acme/payments",
      "pr": "412"
    }
  ],
  "embedding_ref": "vec:memory:66c7f4ab",
  "persistence_policy": "clear_day_end",
  "privacy_level": "cloud_allowed_redacted",
  "confidence": 0.88,
  "created_ts": "2026-06-28T05:12:00Z",
  "updated_ts": "2026-06-28T05:21:30Z"
}
```

### Example: semantic memory record

```json
{
  "id": "9fc1520d-2b6b-45f7-973c-90e7ff29242f",
  "kind": "semantic",
  "topic": "preferred focus window",
  "content": "Protect late-morning deep work when possible; batch non-urgent triage after lunch.",
  "source_event_ids": [],
  "source_refs": [],
  "embedding_ref": "vec:memory:9fc1520d",
  "persistence_policy": "keep_until_deleted",
  "privacy_level": "local_only",
  "confidence": 0.95,
  "created_ts": "2026-06-28T10:30:00Z",
  "updated_ts": "2026-06-28T10:30:00Z"
}
```

### Example: promoted lesson memory

```json
{
  "id": "ab835ce7-f7ff-4b39-98f6-2e568a8b84fd",
  "kind": "semantic",
  "topic": "payment capture retries",
  "content": "Preserve idempotency keys across capture retries to avoid duplicate downstream attempts.",
  "source_event_ids": [
    "fe9d3018-f352-413c-b2dc-2c5325f08fb0"
  ],
  "source_refs": [
    {
      "url": "https://acme.atlassian.net/browse/PAY-1842",
      "ticket": "PAY-1842"
    }
  ],
  "embedding_ref": "vec:memory:ab835ce7",
  "persistence_policy": "keep_until_deleted",
  "privacy_level": "cloud_allowed_redacted",
  "confidence": 0.9,
  "created_ts": "2026-06-28T08:10:00Z",
  "updated_ts": "2026-06-28T08:10:00Z"
}
```

## Connector Interface

The **Connector Framework** keeps source integrations pluggable. Each source implements one Connector and emits normalized `WorkContextEvent` instances. Capabilities never call source APIs directly.

```ts
type ConnectorSource =
  | "github"
  | "jira"
  | "slack"
  | "teams"
  | "mail"
  | "calendar"
  | "meeting"
  | "docs"
  | "browser";

type HealthStatus = "healthy" | "degraded" | "down" | "unauthenticated";

interface ConnectorAuthResult {
  source: ConnectorSource;
  accountLabel: string;
  scopes: string[];
  expiresAt?: string;
}

interface ConnectorHealth {
  source: ConnectorSource;
  status: HealthStatus;
  checkedAt: string;
  message?: string;
}

interface SubscribeOptions {
  webhookUrl?: string;
  since?: string;
}

interface PollOptions {
  since?: string;
  limit?: number;
}

interface RawSignal {
  source: ConnectorSource;
  observedAt: string;
  payload: unknown;
}

interface Connector {
  source: ConnectorSource;

  authenticate(): Promise<ConnectorAuthResult>;

  poll(options?: PollOptions): Promise<RawSignal[]>;

  subscribe?(options: SubscribeOptions): Promise<void>;

  toEvents(signals: RawSignal[]): Promise<WorkContextEvent[]>;

  healthCheck(): Promise<ConnectorHealth>;
}
```

### Example: GitHub Connector output

```json
{
  "source": "github",
  "healthCheck": {
    "status": "healthy",
    "checkedAt": "2026-06-28T05:00:00Z"
  },
  "emits": [
    "reviewing_pr",
    "mentioned"
  ]
}
```

### Example: Slack Connector output

```json
{
  "source": "slack",
  "healthCheck": {
    "status": "degraded",
    "checkedAt": "2026-06-28T05:00:00Z",
    "message": "Rate limited; using last successful cursor."
  },
  "emits": [
    "message",
    "mentioned"
  ]
}
```
