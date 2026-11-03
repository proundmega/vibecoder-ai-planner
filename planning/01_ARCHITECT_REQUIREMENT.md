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
