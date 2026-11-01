# 02_ARCHITECT_DESIGN.md - Merge Lifecycle and Conflict Handling (fg-36)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31, fg-32

## Design summary

Add a `MergeCoordinator` that owns base-branch synchronization, CI gating, merge queueing and post-merge verification. Conflict resolution reuses the fixer harness with a conflict-specific prompt and a strict scope.

```
PR created
  -> mergeability check
       -> clean: review
       -> dirty: merge base -> verify -> review
       -> conflict: conflict worker -> verify -> review
  -> approval + checks
  -> merge queue (per repo)
       -> re-check head SHA + checks
       -> merge
       -> post-merge verification
            -> pass: done
            -> fail: rollback/incident
```

## Components

| Component | Responsibility |
|---|---|
| `BaseBranchResolver` | Read repo default branch / project override |
| `MergeabilityService` | Query GitHub mergeable state and checks |
| `BranchSyncService` | Rebase/merge base into ticket branch safely |
| `ConflictWorker` | Resolve conflicts with an OpenCode fixer prompt |
| `MergeQueue` | Serialize merges per repo with head-SHA recheck |
| `PostMergeVerifier` | Run smoke verification on the base branch |
| `RollbackService` | Revert or feature-flag the merge |

## Base branch resolution

1. active repo profile `base_branch` (fg-39) if present;
2. project setting `base_branch`;
3. repository default branch from GitHub;
4. fallback `main`, then `master`; log the resolution.
Use one shared `BaseBranchResolver` for PR creation, branch updates and post-merge checks; fg-39 stores the profile value but must call the same resolver. Do not hardcode `main`.

## Mergeability and update

- Before review/fix, call GitHub for `mergeable`, `mergeable_state`, `base.sha`, `head.sha`.
- `dirty`/`behind`: fetch base and update the ticket branch with a merge commit from `origin/<base>` (`git merge --no-ff`), preserving published history; resolve only trivial conflicts and re-run verification. Rebase is allowed only on an agent-owned branch with the head SHA pinned and an explicit lease; never force-push a human-owned or shared branch. fg-32's fast-forward-only publish remains the default.
- `blocked`: report missing checks/approvals; do not spend a review round.
- `unknown`: wait/retry with backoff; GitHub computes mergeability asynchronously.

## Conflict handling

- Detect conflicted files with `git diff --name-only --diff-filter=U`.
- If conflicts are limited to generated/lock files, regenerate them (`npm install`, `mvn`, etc.) rather than hand-editing.
- For source conflicts, build a prompt containing both sides, the base and the ticket intent; require the fixer to preserve both behaviors and add tests.
- If the conflict is semantic or the fixer cannot produce a clean verified result, escalate to a human.
- Never silently choose one side.

## CI gate and merge queue

- Required checks are configured per project (`checks_required`).
- Merge queue entry: ticket, PR, head SHA, base SHA, priority, enqueued_at.
- Before merge: re-fetch the PR, require the same head SHA and green checks; otherwise requeue.
- Merge method configurable; default squash for agent PRs if the project uses it.
- One merge at a time per repo; re-run post-merge verification before releasing the queue.

## Post-merge verification and rollback

- Run a configured smoke suite against the base branch (or a deploy preview).
- On failure: create an incident, revert the merge commit (or disable the feature flag), reopen/relabel the ticket, notify the owner.
- Record all steps in the merge audit.

## Data model

```sql
CREATE TABLE merge_queue (
  id UUID PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  pr_number INT NOT NULL,
  head_sha TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  merge_commit_sha TEXT, -- set after a successful merge; required for rollback
  priority INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL, -- queued, merging, merged, failed, reverted
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  merged_at TIMESTAMPTZ,
  error TEXT
);

-- One active merge per PR and per ticket; terminal rows are history.
CREATE UNIQUE INDEX uq_merge_queue_active_pr
  ON merge_queue (project_id, pr_number)
  WHERE status IN ('queued', 'merging');
CREATE UNIQUE INDEX uq_merge_queue_active_ticket
  ON merge_queue (ticket_id)
  WHERE status IN ('queued', 'merging');
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `REPO_BASE_BRANCH` | auto | Default project setting; an active repo profile overrides it |
| `MERGE_METHOD` | `squash` | squash/merge/rebase |
| `MERGE_REQUIRE_CHECKS` | `true` | Require green checks |
| `MERGE_QUEUE_ENABLED` | `false` | Enable queue |
| `POST_MERGE_VERIFY` | `false` | Run post-merge smoke |
| `AUTO_MERGE` | `false` | Explicit autonomy opt-in |

## Tests

- default-branch resolution and override;
- dirty PR update/rebase and re-verification;
- simple and semantic conflicts;
- CI failure blocks merge;
- queue race with moved head SHA;
- post-merge failure triggers rollback;
- audit completeness.

## Rollout

1. Base-branch detection + mergeability checks only.
2. Manual "update branch" action.
3. Conflict worker behind a flag.
4. Merge queue in one project.
5. Post-merge verification.
6. Auto-merge only after fg-30 Phase 3 policy and fg-37 metrics.

## Open questions

1. Rebase vs merge for updating the branch?
2. Who owns the merge queue: backend or GitHub's native queue?
3. Should conflict resolution consume a fix round?
4. How do we verify a merge without a deploy environment?
5. What is the rollback SLA?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-31 | Mergeability check in review | Review | `fg-31` follow-up | No |
| 2 | fg-32 | Conflict fix round | Agent | `fg-32` follow-up | No |
| 3 | fg-37 | Merge/rollback metrics | Evaluation | `fg-37-agent-evaluation-harness` | No |
| 4 | fg-41 | Merge queue audit | Observability | `fg-41-harness-observability` | No |
