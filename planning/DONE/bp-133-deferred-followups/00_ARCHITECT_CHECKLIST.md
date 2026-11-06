---
id: "bp-133"
title: "bp-124 Deferred Follow-ups"
status: done
priority: "P2"
effort: "Medium"
scope: "Both"
created: "2026-11-06"
updated: "2026-11-06"
pr: 124
branch: "feat/bp-133-fr4"
depends_on: ["bp-124"]
---

# 00 — bp-124 Deferred Follow-ups (bp-133)

> **Owns:** status, scope, deferred register, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`).

**Source:** `planning/DONE/bp-124-audit-open-defects/00_ARCHITECT_CHECKLIST.md` deferred register, items D12–D14 and D16 (D15 was fixed in bp-124).

## Why this ticket exists

bp-124 delivered the audit defect slices. Four follow-ups were deliberately
left out — either as non-goals of that slice or because the new tests exposed
them. They need an owner so they do not disappear when bp-124 merges.

## Scope

- **FR1 / D12** — regenerate the frontend generated client types.
- **FR2 / D13** — clean up the remaining BIGSERIAL `format: uuid` OpenAPI
  formats on route path/body parameters.
- **FR3 / D14** — filter soft-deleted users from the admin user list.
- **FR4 / D16** — enforce project membership for ticket writes.

Out of scope: the harness roadmap (`fg-33+`, bp-124 item D11) and any new
product behavior not listed above.

## User decisions (2026-11-06)

- Split the four follow-ups into this ticket; bp-124 stays focused on FR11 and
  its DONE hygiene.
- D12 was a non-goal in bp-124 `01`; D13 was recorded as deferred in bp-124's register. Both are in scope here.
- FR4 is an authorization change and needs its own review before scheduling.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`03` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| E1 | Soft-deleted users remain in the admin list | bp-124 D14 | Backend | FR3 | done (#123) |
| E2 | Ticket writes ignore project membership | bp-124 D16 | Backend / Auth | FR4 | done (#124) |
| E3 | Regenerate frontend generated client types | bp-124 D12 | Frontend | FR1 | done (#123) |
| E4 | Remaining OpenAPI BIGSERIAL id formats | bp-124 D13 | Docs / API | FR2 | done (#123) |
| E5 | Harness roadmap | bp-124 D11 | Agent | fg-33+ (separate track) | open |

## Status evidence

| Claim | Evidence |
|---|---|
| FR1-FR3 implemented | PR #123, merge commit `6329d5c` |
| FR1 review fix | PR #123 (`User` schema matches `User.toJSON()`; project assignee nullable) |
| FR4 implemented | PR #124, merge commit `67d7bca` (project-scope checks for update/delete/pickup/release) |
| Verification | `03` → Results; backend 125 suites / 1557 tests, frontend 60 / 562, integration + Cypress all pass |
| Review | Reviewer approved both PRs with no remaining comments |
| Items originated in bp-124 | bp-124 `00` deferred register D12–D16 |

## Completion gate

- [x] Implementation merged in #123/#124
- [x] Results recorded in `03`
- [x] Deferred register complete (only E5 harness remains, owned by fg-30)
