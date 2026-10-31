# 01_ARCHITECT_REQUIREMENT.md - Merge Lifecycle and Conflict Handling (fg-36)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31 reviewer, fg-32 fixer loop
**Related code:** `HarnessTicketProcessor`, `GitHubService`, `WorkspaceManager`, `PhaseService`

## Problem

The harness treats PR creation as the end of the workflow. In reality, a PR has a lifecycle:

- the base branch moves while the agent works;
- the PR becomes dirty or gets conflicts;
- CI checks fail or are still running;
- another PR merges first;
- a human requests a rebase;
- a bad merge needs a revert.

Current gaps:

- `HarnessTicketProcessor` opens PRs against a hardcoded `main`;
- there is no default-branch detection or per-project base configuration;
- review/fix does not check `mergeable` before spending a round;
- there is no rebase/update-branch worker;
- there is no merge queue or CI gate;
- there is no post-merge verification or rollback plan;
- `PhaseService` has no merge state.

## Goals

1. Make base branch configurable and detect the repository default.
2. Keep PRs mergeable: detect conflicts and update/rebase safely.
3. Gate merging on required checks and human/autonomy approval.
4. Serialize merges with a merge queue to avoid races.
5. Verify the base branch after merge and support rollback.
6. Record a complete merge audit trail.
7. Never merge automatically until an explicit policy allows it.

## Non-goals

- Implementing auto-merge in Phase 1 of this ticket (policy comes from fg-30 Phase 3).
- Replacing GitHub branch protection.
- Supporting GitLab/Bitbucket.
- Resolving semantically complex conflicts without a human escape hatch.

## Functional requirements

- **FR1 - Base branch:** resolve the repo default branch; allow a project override; use it for PR creation and rebase.
- **FR2 - Mergeability check:** query GitHub mergeable state before review, before fix rounds and before merge.
- **FR3 - Update branch:** rebase or merge the base into the ticket branch, then re-run verification.
- **FR4 - Conflict handling:** classify conflicts; auto-resolve trivial ones; send complex ones to a fixer/integrator with the conflicting files and both sides.
- **FR5 - CI gate:** require configured checks (tests, lint, security) to pass before merge.
- **FR6 - Merge queue:** serialize merges per repo; re-check the head SHA immediately before merge.
- **FR7 - Merge method:** configurable squash/merge/rebase; preserve PR/review links.
- **FR8 - Post-merge verification:** run smoke checks on the base branch; open an incident/rollback if they fail.
- **FR9 - Rollback:** revert the merge commit or disable the feature behind a flag; notify the ticket owner.
- **FR10 - Audit:** record base SHA, head SHA, checks, approvals, merge commit and rollback in the ticket/PR.

## Safety requirements

- Never force-push a shared branch.
- Never merge without a valid approval and passing required checks.
- Re-run verification after every rebase/update.
- A conflict resolution must not silently drop either side.
- Rollback must be possible without rewriting public history.
- Merging remains disabled unless the policy explicitly enables it.

## Acceptance criteria

1. PRs target the detected default branch, with an optional project override.
2. A dirty PR is detected before review and can be updated and re-verified.
3. A simple conflict can be resolved and re-reviewed; a complex conflict escalates to a human.
4. Merge waits for required checks and the queue; the head SHA is re-checked.
5. Post-merge verification runs and a failure triggers rollback/alerting.
6. Every merge and rollback is auditable.
7. Tests cover dirty PRs, conflicts, CI failure, queue races and rollback.

## Out of scope

- Auto-merge policy design (fg-30 Phase 3).
- Release/deployment pipelines.
- Multi-repo atomic merges.
- Semantic conflict resolution by an LLM without human review.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-31 | Reviewer should check mergeability before review | Review | `fg-31` follow-up | No |
| 2 | fg-32 | Fixer round for conflicts | Agent | `fg-32` follow-up | No |
| 3 | fg-37 | Measure merge/rollback outcomes | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-41 | Merge queue audit events | Observability | `fg-41-harness-observability` | No |
