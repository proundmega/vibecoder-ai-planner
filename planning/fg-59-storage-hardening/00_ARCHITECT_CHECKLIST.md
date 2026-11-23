---
id: "fg-59"
title: "Storage Lifecycle Hardening"
status: in_progress
priority: "P2"
effort: "Small"
scope: "Agent"
created: "2026-11-23"
updated: "2026-11-23"
pr: null
branch: "feat/fg-59-storage-hardening"
depends_on: ["fg-44", "fg-58"]
---

# 00 — Storage Lifecycle Hardening (fg-59)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

Follow-up to fg-44/fg-58. Those suites delivered the storage lifecycle; this
ticket closes the remaining non-blocking review residuals.

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Implementation in progress | `feat/fg-59-storage-hardening` | ☑ |
| Verification results | `03` → Results | ☐ |

## Deferred register (canonical)

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Retention metrics/inventory beyond the sweep | fg-58 | Observability | later | open |
| D2 | Cross-host workspace migration | fg-40 | Infrastructure | fg-40 | open |
| D3 | Shared-runtime cache eviction when concurrency > 1 | self | Storage | after the pilot | open |

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Host-mode image prune | default off / default on | Off unless `AGENT_IMAGE_PRUNE_ENABLED=true`; Docker mode defaults on | Assumed |

## Completion gate

- [x] Every `FR*` in `01` is met
- [x] `03` matrix green and Results dated
- [ ] `status` is `done` after merge
