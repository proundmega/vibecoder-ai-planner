---
id: "bp-124"
title: "Audit Open Defects"
status: done
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-06"
pr: 116
branch: "fix/bp-124-audit-open-defects"
depends_on: ["bp-123"]
---

# 00 — Audit Open Defects (bp-124)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Source:** `AUDIT_REPORT.md` sections "Open defects and risks (not changed)" O1-O8

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Implementation merged | PRs #116-#121 (merge commits `5f42d6c`, `773adfb`, `92dfbfe`, `1cbad9b`, `158cfee`, `e649327`) | ☑ |
| Verification results | `03` → Results | ☑ |
| Deferred scope owned | D12/D13/D14/D16 → bp-133; D11 → fg-30 roadmap | ☑ |

## Completion gate

- [x] Implementation merged in #116-#121
- [x] Results recorded in `03`
- [x] Deferred register points remaining work at bp-133 / fg-30

## Why this ticket exists

PR #100 fixed the audited defects that were in scope. The audit also found eight open defects that were intentionally not changed. They need owners and acceptance criteria so they do not disappear.

## User decisions (2026-11-03)

- **Session scope:** low-risk slice first — O1, O2, O5, O6, O8 with regression tests, plus O7/O10 documentation. O4 (migration) and O3/O9 (Cypress + CI) follow in later turns.
- **O2:** delete the dead `project_agents`/`audit_log` methods instead of creating the tables.
- **O4:** add an `agents(id)` FK for `assigned_agent_id` with a backfill (not merely a rename/comment).

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | O1 milestone persistence | audit | Backend | bp-124 slice (#116) | done (#116) |
| D2 | O2 dead SQL/tables | audit | Backend | bp-124 slice (methods deleted) | done (#116) |
| D3 | O3 E2E rewrite + CI | audit | Testing | bp-124 slice (API-seeded specs + Jenkins stage, #118) | done (#118) |
| D4 | O4 agent identity | audit | Agent / DB | bp-124 slice (FK + backfill, #117) | done (#117) |
| D5 | O5 validator camelCase | audit | Frontend | bp-124 slice (#116) | done (#116) |
| D6 | O6 PUT response type | audit | Backend / Frontend | bp-124 slice (#116) | done (#116) |
| D7 | O7 docs drift | audit | Docs | bp-124 slice (README fixed; suites moved to DONE) | done |
| D8 | O8 integration setup | audit | Testing | bp-124 slice (#116) | done (#116) |
| D9 | O1-O10 umbrella | bp-123 | Multiple | bp-124-audit-open-defects | done (#116-#121) |
| D10 | Full SQL grammar validation (O10) | bp-79 | Backend | bp-124 (documented structural-only) | done (#116) |
| D11 | Harness roadmap | fg-30 | Agent | fg-33+ | open |
| D12 | Regenerate frontend generated client types | bp-124 | Frontend | Moved to bp-133 FR1 | deferred (bp-133) |
| D13 | OpenAPI route path/body id formats | bp-124 | Docs / API | Moved to bp-133 FR2 | deferred (bp-133) |
| D14 | User list includes soft-deleted users | O3 | Backend | Moved to bp-133 FR3 | open (bp-133) |
| D15 | Assignee name stale after edit save | O3 | Frontend | `TicketDetail.handleEditSaved` now refetches the ticket when `assigneeId` changes | done (O3) |
| D16 | Ticket writes ignore project membership | O3 | Backend | Moved to bp-133 FR4 | open (bp-133) |

`bp-125`…`bp-132` were proposed as separate suites but were never created. Their
scope is executed as slices inside bp-124; do not look for those directories.
