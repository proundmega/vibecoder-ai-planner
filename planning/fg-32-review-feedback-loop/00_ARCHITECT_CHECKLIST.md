---
id: "fg-32"
title: "Review Feedback Loop / Fixer Agent"
status: planned
priority: "P1"
effort: "Large"
scope: "Both"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-31", "fg-30", "fg-33"]
---

# 00 — Review Feedback Loop / Fixer Agent (fg-32)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Revised:** 2026-11-02 (addresses PR #104 design review)
**Revised:** 2026-11-03 (fg-33 fixer-run integration: FR13, run lifecycle, identity rule)

> Plan merged in #104. Implementation is pending; the original checklist is
> kept in `03` for execution. The follow-up added by this PR is D6 (the fg-33
> publish-evidence guard allow path, now specified as FR13).

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Plan merged | PR #104 | ☑ |
| Implementation merged | pending | ☐ |
| Verification results | n/a — planned | ☐ |

**Related code:** `ReviewProcessor`, `HarnessTicketProcessor`, `WorkspaceManager`, `PhaseService`, `CodeReview.vue`, `PhaseReview.vue`

## Why this ticket exists

Today the reviewer can say "request changes", but nothing routes those findings back to a Java agent. The review comments are free-text ticket messages that no agent reads, the ticket stays in `review`, and the build agent only polls `backlog`. There is no fixer worker, no reviewed-SHA/round tracking, no same-branch update and no escalation rule.

fg-31 plans the reviewer, its attempt/finding store and the GitHub COMMENT review. This ticket owns the concrete feedback channel, the fix queue/lease, the Java fixer execution and the human escalation path.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Fix/review cost dashboard | bp-04 | Observability / Billing | TBD (new follow-up) | open |
| D2 | Ship fix/review events to log aggregation | bp-106 | Observability | TBD (new follow-up) | open |
| D3 | E2E coverage for the fix loop UI | bp-99-frontend-testing | Testing | TBD (new follow-up) | open |
| D4 | Human question loop for ambiguous findings | fg-30 | Agent / UX | fg-30 Phase 2 | open |
| D5 | Reviewer harness with structured findings and GitHub reviews | fg-31 | Agent / Review | TBD (planned in fg-31 Phase 1) | open |
| D6 | fg-33's publish-evidence `startRun` guard blocks fixer runs on an existing PR; add an explicit fixer-only allow path validated against the claimed fix request, branch and `reviewed_sha` (FR13) | fg-33 | Reliability / Integration | fg-32 (this ticket) | open |
| D7 | Email notifications for fix requests and escalations (no existing email-notification ticket; bp-71 is account lockout) | new | UX | TBD | open |

## Resolved decisions

- Fix state uses `in_progress` + `review_state`; no new phase.
- fg-31 will write the completed attempt/findings; fg-32's endpoint consumes `attempt_id` and creates the fix request idempotently.
- Escalation is phase-aware: `review -> human_approval`, `in_progress -> review -> human_approval`, or a no-op in `human_approval`; `in_progress -> human_approval` is never attempted.
- Publishing is fast-forward only and pinned to `reviewed_sha`; the existing `pushCommit()` force-with-lease path is not used for shared PR branches.
- Worker mode is `AGENT_MODE=fix`; `FIX_LOOP_MODE` only controls dispatch.
- Fix requests live in `ticket_fix_requests`; review attempts/findings stay in the fg-31 schema.
- Per-project enablement is `projects.fix_loop_mode`, defaulting to off; the global `FIX_LOOP_MODE` is the default.
- fg-33's publish-evidence guard refuses a normal harness run when the ticket has a PR or a prior run recorded `pr_url`/`head_sha`. The fixer uses an explicit allowance (FR13): `purpose=fix`, claimed `fix_request_id`, `baseSha=reviewed_sha`, the same agent owner as the ticket assignee, and the normal build guard unchanged.
