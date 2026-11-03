---
id: "fg-36"
title: "Merge Lifecycle and Conflict Handling"
status: planned
priority: "P1"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-30", "fg-31", "fg-32"]
---

# 00 — Merge Lifecycle and Conflict Handling (fg-36)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `HarnessTicketProcessor`, `GitHubService.createPullRequest`, `WorkspaceManager`, `PhaseService`

## Why this ticket exists

The harness opens a PR and stops. It does not handle a moving base branch, merge conflicts, CI checks, merge queues, post-merge verification or rollback. PR #99 already demonstrated how quickly a branch becomes dirty when master moves.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Reviewer should check mergeability before review | fg-31 | Review | fg-31 follow-up | open |
| D2 | Fixer round for conflicts | fg-32 | Agent | fg-32 follow-up | open |
| D3 | Measure merge/rollback outcomes | fg-37 | Evaluation | fg-37-agent-evaluation-harness | open |
| D4 | Merge queue audit events | fg-41 | Observability | fg-41-harness-observability | open |
