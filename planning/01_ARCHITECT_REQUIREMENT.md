# 01 — Requirement ({{id}})

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

{{What is broken or missing? Who is affected? What is the observable symptom?
Include the failure sequence, not just the label.}}

## Goals

1. {{...}}

## Non-goals

- {{...}}

## Assumptions

| ID | Assumption | Impact if wrong | Validation / evidence | State |
|---|---|---|---|---|
| A1 | {{what must be true for this plan to work}} | {{what breaks if it is false}} | {{test, monitor, or accepted risk}} | open |

If there are no material assumptions, replace the table with:
*No material assumptions — {{one-line reason}}.*

An assumption that cannot be validated becomes an accepted risk in `00`'s
deferred register or a follow-up ticket; it is not silently dropped.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | {{what the system must do}} | {{observable pass/fail condition}} |
| FR2 | {{...}} | {{...}} |

Acceptance is a behaviour, not an implementation detail. `03` maps every ID to
at least one test; a requirement with no test row is not done.

Every constraint is a requirement. Integration constraints, cross-ticket
guards, migration rules and safety gates must be `FR*`/`NFR*` rows here — not
only prose in `02` or an acceptance criterion in the tail of this file. If it
can fail, it needs an ID and a matrix row.

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | {{security, performance, compatibility, operability}} | {{...}} |

## In scope

- {{...}}

## Change impact

| Area | Impact | Evidence / owner |
|---|---|---|
| API routes/contracts | {{none / routes}} | |
| Database/migrations | {{none / tables}} | |
| Frontend | {{none / views, API client}} | |
| Agent/harness | {{none / classes}} | |
| Permissions/auth | {{none / permission codes, scoping}} | |
| Background jobs/external calls | {{none / jobs, providers}} | |
| Downstream tickets | {{none / fg-XX}} | |
| Rollback | {{revert / migration rollback / feature flag}} | |

A small fix may state `n/a` with a reason. Use `fg-51` requirement IDs so
traceability can map each requirement to code, tests and verification.

## Out of scope

Summarise only. The authoritative list — with reasons and follow-ups — is
**`00` → Deferred register**.

- {{item}} — see `00` D1

## Open questions

| # | Question | Assumption if unanswered |
|---|---|---|
| 1 | {{...}} | {{...}} |

## Dependencies

- Depends on: {{ticket IDs or merged PRs}}
- Blocks: {{ticket IDs}}
