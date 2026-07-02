# Sidekick — Production Readiness (v1.0.0)

Status of each surface and the cross-cutting concerns, with evidence. This is the
checklist that justifies calling Sidekick production-grade for its scope: a
**local-first, single-user** assistant running on the user's own machine.

## Cross-cutting

| Concern | Status | Evidence |
|---|---|---|
| Tests | ✅ 77/77 passing | `npm test` |
| Zero runtime dependencies | ✅ | no `dependencies` in package.json (no supply chain) |
| No TODO/FIXME/stub in source | ✅ | grep clean |
| Versioned | ✅ 1.0.0 | all three surfaces |
| Experimental SQLite handled | ✅ | startup guard fails fast with an actionable message (`store.js` `assertSqliteAvailable`); Node pinned `>=22.5.0` |

## Security

| Item | Status | Evidence |
|---|---|---|
| Loopback-only bind | ✅ | warns on non-loopback host |
| Timing-safe token auth | ✅ | `auth.js` `timingSafeEqual` |
| Encryption at rest (AES-256-GCM) | ✅ | field encryption; test asserts no plaintext on disk |
| **Key decoupled from API token** | ✅ | dedicated DEK in keychain; token rotation no longer bricks the DB (tested) |
| Encryption canary | ✅ | key/salt mismatch fails fast, not per-request 500s (tested) |
| **Strict CSP nonce on dashboard** | ✅ | `script-src 'nonce-…'`, no `unsafe-inline` scripts (tested) |
| **console-token XSS-hardened** | ✅ | requires loopback + same-origin + `x-sidekick-console` header (tested) |
| Fail-closed AI egress | ✅ | `auto` never selects cloud; cloud source-gated + redacted (tested) |
| Security headers | ✅ | CSP, X-Frame-Options, nosniff, Referrer-Policy |
| Per-client rate limiting | ✅ | 429 + Retry-After (tested) |

## Data integrity

| Item | Status | Evidence |
|---|---|---|
| Atomic event + derivation writes | ✅ | `store.transaction()`; rollback on failure (tested) |
| User decisions survive re-derivation | ✅ | upsert guard preserves confirmed/dismissed (tested) |
| Cascading delete | ✅ | source delete cascades to derived rows (tested) |
| Bounded list queries | ✅ | all list methods clamp limit ≤ 500 |

## Resilience / observability

| Item | Status | Evidence |
|---|---|---|
| Real `/health` readiness | ✅ | SELECT 1 + decrypt smoke test → 503 on failure (tested) |
| Graceful shutdown | ✅ | double-signal force-exit, WAL checkpoint |
| Background poller guarded | ✅ | never crashes ingest; overlap guard; unref timer (tested) |
| AI enrichment never blocks ingest | ✅ | fire-and-forget after response; swallowed catch (tested) |
| Structured leveled JSON logs | ✅ | per-request id + latency |
| Audit trail | ✅ | `audit_log` + `GET /audit` |

## Surfaces

### Memory Console (web dashboard)
- ✅ Dark glassmorphic UI; functional sidebar nav (was decorative); diagnostic empty states; factual "At a glance" briefing recap; inline confirm/dismiss on commitments with AI vs rule provenance badges.
- ✅ Accessibility: focus-visible rings, AA-contrast text, aria-live status, aria-labels on icon/recap buttons, aria-hidden decorative emoji, reduced-motion.
- ✅ Auto-loads its token (no paste), strict CSP.

### VS Code Editor Extension (1.0.0)
- ✅ SecretStorage token (migrates from settings); fetch timeouts/abort; `Promise.allSettled` so one failing endpoint can't blank the panel; CSP + nonce webview; theme-aware; diagnostic empty states; codicon status bar with focus warning bg; one-click "Set Token" on the missing-token error; VSIX packaging (.vscodeignore, publisher, license, icon).

### Chrome/Edge Browser Extension (1.0.0)
- ✅ MV3, CSP-clean (no inline); icons at 16/32/48/128; connection check on open; capture loading state; graceful handling of restricted (chrome://) pages; persistent ignore-list; error-surfacing on every action; focus-visible rings; capture-only (no duplicated capability grid).

## Known limitations (honest)
- AI extraction tiers are wired + tested via injected models; real-world precision against a live Claude/Ollama model is not yet benchmarked.
- Connectors implemented: GitHub (PAT, polled) + Microsoft 365 (Graph). GitLab/Jira/Slack still need auth.
- Recall is keyword search, not vector embeddings (honestly labeled as such).
- `node:sqlite` is behind `--experimental-sqlite`; bounded risk for a local single-user tool, guarded at startup.
