# 02_ARCHITECT_DESIGN.md - Review Feedback Loop / Fixer Agent (fg-32)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Revised:** 2026-11-02 (addresses PR #104 design review)
**Depends on:** fg-31 Automatic Review Harness (merged, PR #103), fg-30 Phase 1 harness supervisor; fg-30 Phase 3 for token/cost budgets
**Related code:** `ReviewProcessor`, `HarnessTicketProcessor`, `WorkspaceManager`, `PhaseService`, `CodeReview.vue`, `PhaseReview.vue`

## Review resolutions (PR #104)

| # | Concern | Decision |
|---|---|---|
| 1 | Fix-request creation contract contradicts itself | fg-31 writes the completed attempt/findings, then calls `POST /tickets/:id/review/request-changes` with `attempt_id`. fg-32 consumes the attempt, creates the fix request and transitions. fg-32 never writes attempts. |
| 2 | Escalation is not phase-aware | Escalation reads the current phase: `review -> human_approval` when in `review`, `in_progress -> review -> human_approval` when in `in_progress`, and a no-op when already in `human_approval`. Other phases fail closed; `in_progress -> human_approval` is never attempted. |
| 3 | Force-with-lease can overwrite a human commit | Add a fast-forward-only publish path pinned to `reviewed_sha`; never reuse `WorkspaceManager.pushCommit()` for shared PR branches. |
| 4 | Fixer worker mode/wiring undefined | `AGENT_MODE` = `build`, `review` or `fix`; `FixTicketProcessor` is constructed for `AGENT_MODE=fix`. `FIX_LOOP_MODE` only controls dispatch. |
| 5 | Queue/lease schema incomplete | Add `ticket_fix_requests` with lease owner/expiry, attempts, error and active uniqueness; add `POST /tickets/:id/fix/renew`. |
| 6 | Duplicate fix requests not prevented | `UNIQUE(attempt_id)` for automated requests and a partial unique index for one active request per ticket; the POST is idempotent. |
| 7 | Manual mode has no human-auth path | The request-changes endpoint accepts reviewer `X-API-Key` or human JWT; `PhaseService.transition()` to `in_progress` also creates/ensures the request. Normalize `metadata.reason` and `metadata.feedback`. |
| 8 | Budget enforcement undefined | Phase 1 enforces wall-clock and diff caps (fg-30); token/cost hard stops depend on fg-30 Phase 3 and are not claimed until then. |
| 9 | State duplication has no source of truth | `ticket_review_attempts` is authoritative for review data; `ticket_fix_requests` for fix state; ticket fields are denormalized caches updated in one transaction. |
| 10 | Per-project enablement conflicts with a global flag | Add `projects.fix_loop_mode`; `FIX_LOOP_MODE` is the default, the project setting overrides it, and both default to `off`. |

## Design summary

The loop has four roles and two durable records:

```
reviewer harness (fg-31)
  verdict=request_changes
  writes completed attempt + findings
        |
        v
POST /tickets/:id/review/request-changes { attempt_id }   (idempotent)
        |
        v
ticket_fix_requests (queued) + ticket review state
        |
        v
FixTicketProcessor (AGENT_MODE=fix)
  - checkout existing PR branch pinned to reviewed_sha
  - prompt with findings + previous verification
  - verify, commit from reviewed_sha
  - fast-forward-only push (abort if remote moved)
        |
        v
in_progress -> review (phase + status), new head SHA
        |
        v
reviewer re-reviews -> approve (human_approval) | another round | escalate
```

The reviewer and fixer never merge. The human approval phase remains the final gate.

## Fix-request creation contract

There is one creation service with two entry points. fg-32 does **not** poll review attempts.

1. fg-31 posts its COMMENT review, then writes the `completed` attempt and findings.
2. For `verdict=request_changes`, fg-31 calls `POST /tickets/:id/review/request-changes` with `{ "attempt_id": "<uuid>" }`.
3. fg-32 validates that the attempt belongs to the ticket, is `completed`, and has `verdict=request_changes`.
4. fg-32 creates one `ticket_fix_requests` row (`source='reviewer'`, `attempt_id` unique) and transitions the ticket `review -> in_progress` (phase **and** status) in the same transaction.
5. If the request already exists for that `attempt_id`, return it with `200` instead of creating a second one. fg-31 may retry the call safely.

If the fg-31 → fg-32 call fails after the review is posted, fg-31 retries; the endpoint is idempotent. A duplicate GitHub review must never create a second fix request.

The fix request stores `branch` and `reviewed_sha`. Resolve both at creation and use the same resolvers in `PhaseService.transition()`.

`branch`:

1. `tickets.branch_name` (migration 008);
2. GitHub PR head ref (`GET /repos/{owner}/{repo}/pulls/{number}` -> `head.ref`), the same lookup used for `reviewed_sha`;
3. if neither is available, fail closed.

**Build-path prerequisite:** `branch_name` is currently written only by the backend branch-creation route (`GitHubService.js:112`). The agent build paths compute `branchName` but only call `updateTicketPrUrl` (`HarnessTicketProcessor.java:170-272`, `TicketProcessor.java:105-181`), so agent-created PRs would have a null branch. Extend the post-PR update (or `updateTicketPrUrl`) to store `branchName`, expose `branch_name` through `Ticket.fromRow` and the ticket API, and keep the GitHub `head.ref` fallback for older rows.

`reviewed_sha`:

1. automated request: the `ticket_review_attempts.reviewed_sha` for `attempt_id`;
2. manual request (no `attempt_id`): the latest `completed` attempt for the ticket;
3. fallback: the PR head SHA from the same GitHub lookup;
4. if unresolved, fail closed with a clear error and do not create the request.

Creation also fails closed if the resolved branch does not match the PR head branch.

**Transaction and re-entry:** when `PhaseService.transition()` is the entry point, it passes its transaction client to `FixRequestService.createOrEnsure()` and does not call back into `transition()`. The endpoint path performs the transition and the fix-request insert in one transaction. If the insert fails, the transition rolls back; if an escalation's second transition fails, the ticket rests in `review` (never `in_progress`) and the next escalation attempt can retry.

### Human/manual path

- The same endpoint accepts a human JWT with `TICKET_STATUS_CHANGE` (the permission already used by `POST /tickets/:id/status` and the project status routes) and `feedback`, without an `attempt_id`. `reviewed_sha` is resolved with the same resolver above (latest completed attempt, else PR head), so a manual request always has a valid base.
- To keep the current UI working without a bypass, `PhaseService.transition()` to `in_progress` from `review` also calls the same `FixRequestService.createOrEnsure()` with `source='human'`.
- Normalize `metadata.reason` (CodeReview.vue) and `metadata.feedback` (PhaseReview.vue) into a single `feedback` field. Both keys are accepted during the transition; `feedback` wins if both are present.

## State model and source of truth

| Record | Authoritative for |
|---|---|
| `ticket_review_attempts` (fg-31) | reviewed SHA, round, verdict, verification, GitHub review id |
| `ticket_fix_requests` (fg-32) | fix state, branch, lease, attempts, last error |
| `tickets.review_state` / `review_round` / `reviewed_sha` / `fix_branch` | denormalized queue/UI cache only |

Update order (single transaction where possible):

1. fg-31 completes the attempt + findings.
2. `FixRequestService.createOrEnsure()` inserts the fix request (idempotent by `attempt_id`).
3. The ticket cache fields are set from the request: `review_state=changes_requested`, `review_round=attempt.round` for reviewer requests (0 for manual), `reviewed_sha=request.reviewed_sha`, `fix_branch=request.branch`.
4. A reconcile job may recompute the cache from attempts + fix requests; if they disagree, the attempts/requests win.

Ticket fields:

| Field | Purpose |
|---|---|
| `review_state` | `none`, `awaiting_review`, `changes_requested`, `fixing`, `fix_failed`, `escalated` |
| `review_round` | 0 for the first review, copied from the attempt on each `request_changes` |
| `reviewed_sha` | SHA the last completed review looked at |
| `fix_branch` | branch/PR branch to reuse |
| `fix_claimed_by` / `fix_lease_expires_at` | lease owner and expiry (`fix_locked_at` was ambiguous) |

## Phase/status transitions

`PhaseService` allows `review -> in_progress`, `in_progress -> review|blocked|backlog`, and `review -> human_approval`. It does **not** allow `in_progress -> human_approval`.

1. **Create fix request:** `review -> in_progress` (phase + status), `review_state=changes_requested`.
2. **Claim/renew:** no phase change; on claim set `review_state=fixing` and update `ticket_fix_requests.state`, lease owner/expiry. While the request is `queued` for a retry, `review_state` stays `changes_requested`.
3. **Fixer completes:** `in_progress -> review` (phase + status, not just status), `review_state=awaiting_review`, `reviewed_sha=<new sha>`; fix request `completed`.
4. **Reviewer:** `approve` -> `review -> human_approval`; `request_changes` -> step 1 with the next round.
5. **Escalate (round limit, no progress, branch moved, repeated failure):**
   - read the current phase; never assume `in_progress`;
   - `phase=review`: `review -> human_approval`;
   - `phase=in_progress`: `in_progress -> review`, then `review -> human_approval`;
   - `phase=human_approval`: no-op (idempotent);
   - any other phase: fail closed, post an error and leave the ticket for a human; do not attempt an invalid transition;
   - set `review_state=escalated`, fix request `escalated`, and write each transition to the phase history.
6. **Failure routing (FR12):** `fix/fail` increments attempts, clears the lease, and resets the request to `queued` with `next_attempt_at` exponential backoff (for example `min(2^attempts × 60s, 1h)`) while `attempts < FIX_MAX_ATTEMPTS` (default **3**), setting `review_state=changes_requested` so the UI does not show `fixing` while queued. At the limit it sets `failed` and `review_state=fix_failed`, then escalates via step 5, which sets `review_state=escalated`. A ticket is never left in `in_progress` with no claimable queue entry or lease.

The build agent polls `status=backlog` only, so fix work needs its own queue and must not be picked up by the normal backlog loop.

## Data model

### Shared fg-31 tables

fg-31 (merged, PR #103) defines and writes these; fg-32 consumes them and must not fork them.

```sql
CREATE TABLE ticket_review_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  reviewed_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  round INT NOT NULL DEFAULT 0,
  verdict TEXT CHECK (verdict IN ('approve', 'request_changes', 'comment')),
  verification JSONB, -- supervisor-captured results; never model-supplied
  github_review_id BIGINT, -- nullable; set by fg-31 after a successful POST
  provider TEXT,
  model TEXT,
  tokens_in INT,
  tokens_out INT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX uq_review_attempt_completed
  ON ticket_review_attempts (ticket_id, reviewed_sha)
  WHERE status = 'completed';

CREATE TABLE ticket_review_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES ticket_review_attempts(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  file TEXT,
  line INT,
  message TEXT NOT NULL,
  suggestion TEXT,
  resolved_at TIMESTAMPTZ, -- set by fg-32 when the finding is consumed/fixed
  UNIQUE (attempt_id, finding_key)
);
```

### New fg-32 table

```sql
CREATE TABLE ticket_fix_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  attempt_id UUID REFERENCES ticket_review_attempts(id) ON DELETE CASCADE, -- null for manual
  source TEXT NOT NULL CHECK (source IN ('reviewer', 'human')),
  branch TEXT NOT NULL,
  reviewed_sha TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'claimed', 'fixing', 'completed', 'failed', 'escalated')),
  feedback TEXT, -- normalized from metadata.reason/metadata.feedback
  claimed_by TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ, -- retry backoff; null = immediately claimable
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id) -- automated idempotency; multiple nulls allowed for manual
);

-- At most one active fix request per ticket.
CREATE UNIQUE INDEX uq_fix_request_active
  ON ticket_fix_requests (ticket_id)
  WHERE state IN ('queued', 'claimed', 'fixing');
```

`queued`/`claimed`/`fixing` are active. `failed` is terminal and must be escalated immediately; it is not active. Retries reuse the same row by returning to `queued` with `next_attempt_at`, so `uq_fix_request_active` stays satisfied.

Add `projects.fix_loop_mode TEXT NOT NULL DEFAULT 'off' CHECK (fix_loop_mode IN ('off','manual','auto'))` (or an equivalent project-settings row) and ship the migration with a rollback.

## Backend API

Use the existing agent mount points (`/tickets`, `/agents`, `/agents-status`); do not introduce a new `/agent` prefix.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/tickets/:id/review/request-changes` | reviewer `X-API-Key` or human JWT | Create/ensure the fix request from `attempt_id` (or manual `feedback`); transition `review -> in_progress`; idempotent |
| GET | `/tickets/:id/review/findings` | agent/human | Current-round findings |
| GET | `/agents/fix-queue?projectId=` | agent | Due fixable requests with branch/PR metadata, findings and manual feedback |
| POST | `/tickets/:id/fix/claim` | agent | Atomic claim with lease |
| POST | `/tickets/:id/fix/renew` | agent | Extend the lease (heartbeat) |
| POST | `/tickets/:id/fix/complete` | agent | Mark push complete, transition to `review` |
| POST | `/tickets/:id/fix/fail` | agent | Release claim, record error, requeue with backoff or escalate at `FIX_MAX_ATTEMPTS` |
| POST | `/tickets/:id/fix/escalate` | reviewer/human | Phase-aware escalation (`review -> human_approval`; `in_progress -> review -> human_approval`; no-op in `human_approval`) |

All agent endpoints use `X-API-Key`, verify project ownership and enforce the lease owner.

Route ordering: mount the `review` sub-router before the generic `/tickets/:ticketId` handlers, following the attachment/deployment precedent in `api/v1/index.js`. `GET /agents/fix-queue` lives in the existing `/agents` router and does not add a new prefix.

## Java agent changes

### Worker mode and wiring

- Add `AGENT_MODE=build|review|fix`.
  - Default when unset: `review` if `REPO_OWNER` is blank, otherwise `build` (backward compatible with `AgentApp.processCycle()`).
  - `fix` requires `REPO_OWNER`, `REPO_NAME`, and a distinct `AGENT_API_KEY` identity.
- `AgentApp` constructs `FixTicketProcessor implements TicketWorker` for `AGENT_MODE=fix` and polls `GET /agents/fix-queue` instead of backlog or review tickets.
- `FIX_LOOP_MODE=off|manual|auto` controls **dispatch** (who may create requests), not the worker mode. A deployment that wants build + fix in one container runs `AGENT_MODE=build` and a second process/container with `AGENT_MODE=fix`; they must not share the same `AGENT_API_KEY` identity.
- The fix worker reuses the project's `REPO_OWNER`/`REPO_NAME` and provider config; it does not clone a different repository.

### Configuration propagation

Add these to `AgentConfig` and to the existing `backend/src/services/PoolManager.js` env allowlist (it already forwards `HARNESS_*`):

| Env | Default | Purpose |
|---|---|---|
| `AGENT_MODE` | derived | `build`, `review` or `fix`; unset = `review` when `REPO_OWNER` is blank, else `build` |
| `FIX_LOOP_MODE` | `off` | dispatch default; `projects.fix_loop_mode` overrides |
| `FIX_MAX_ROUNDS` | `2` | fix rounds after round 0 |
| `FIX_MAX_ATTEMPTS` | `3` | fixer attempts per request before escalation |
| `FIX_LEASE_TTL_SECONDS` | `1800` | claim lease; renewed via `fix/renew` |
| `FIX_MAX_DURATION_MINUTES` | `30` | wall-clock hard stop |

Mirror them in `agent/.env.example` and the README agent env table, and document that `FIX_LOOP_MODE` is dispatch-only while `AGENT_MODE=fix` selects the worker.

### API client

Add to `ApiService`:

- `listFixQueue()`
- `getReviewFindings(ticketId)`
- `claimFix(ticketId)`
- `renewFix(ticketId)`
- `completeFix(ticketId, headSha, summary)`
- `failFix(ticketId, reason)`

### Worker steps

1. claim fix request (idempotent; 409 if another live lease owns it);
2. fetch findings + ticket + planning docs;
3. checkout the existing branch pinned to `reviewed_sha` (see below);
4. start OpenCode with the fix prompt;
5. run verification;
6. collect diff, run `PublishingGuard`, commit from `reviewed_sha`;
7. fast-forward-only publish (see below);
8. call `completeFix`; never create a PR (the existing PR updates automatically);
9. on failure call `fix/fail` and post the error.

Heartbeat steps: `claiming-fix`, `checking-out`, `fixing`, `verifying`, `publishing-fix`; renew the lease before long steps.

### Existing-branch checkout

`WorkspaceManager.cloneRepo()` creates a new branch with `git checkout -b`. Fix mode needs the existing branch:

- `git clone --branch <branch> --single-branch <repo> <dir>` or clone + `git fetch origin <branch>` + `git checkout <branch>`;
- verify `git rev-parse HEAD` equals `reviewed_sha` before prompting;
- set the commit parent and diff base to `reviewed_sha`;
- never create a new branch;
- scrub credentials after clone, as in fg-30.

### Fast-forward-only publishing

The existing `WorkspaceManager.pushCommit()` reads the remote SHA and uses `--force-with-lease` against that fresh value (`WorkspaceManager.java:217-231`). A human push during a fix would therefore be overwritten. Fix mode must **not** reuse it.

Add `WorkspaceManager.publishFastForward(commitSha, branch, reviewedSha)`:

1. `git fetch origin <branch>` immediately before pushing.
2. Resolve the remote head. If it is not `reviewedSha`, abort with `remote_head_moved`; never force or overwrite.
3. Push without force: `git push --no-verify origin <commitSha>:refs/heads/<branch>`; a non-fast-forward rejection is a failure, not a retry-with-lease.
4. Re-read the remote head and require it to equal `<commitSha>`.
5. On `remote_head_moved`, fail the request with a clear reason and escalate for review; the human commit wins.

### Fix prompt

`PromptBuilder.buildFix(...)` must include:

- ticket id/title/description and acceptance criteria;
- planning docs;
- current round and reviewed SHA;
- findings with stable ids, severity, file, line, message and suggestion;
- manual `ticket_fix_requests.feedback` when present (with no findings, it is the instruction set; with findings, it is an additional human note);
- previous verification output;
- previous diff summary;
- constraints: fix only the findings, no unrelated refactors, add regression tests, run verification, no commit/push/merge;
- final response: map each finding id to the change made, tests run, residual risks.

## Reviewer changes

fg-31's reviewer persists the attempt and findings, then calls `POST /review/request-changes` with `attempt_id`. It must:

- include `reviewed_sha` and `round`;
- emit stable `finding_key` values so repeats are detectable;
- never approve when verification failed;
- skip a SHA only when a `completed` attempt exists; failed attempts may retry;
- retry the request-changes call idempotently if it fails after posting the review.

## Rounds and escalation

- `FIX_MAX_ROUNDS` default 2 (initial; tune after dogfooding).
- Round 0 is the initial review; each accepted `request_changes` increments the round. `FIX_MAX_ROUNDS=2` therefore means 2 fix rounds after the initial review (3 reviews total).
- No-progress conditions:
  - fixer produces no new commit;
  - new head SHA equals the reviewed SHA;
  - the same critical `finding_key` set repeats;
  - verification fails identically twice.
- On no-progress or round exhaustion, call `escalate(ticketId)`:
  - `phase=review` -> `review -> human_approval`;
  - `phase=in_progress` -> `in_progress -> review -> human_approval`;
  - `phase=human_approval` -> no-op;
  - any other phase -> fail closed and leave it for a human;
  - set `review_state=escalated`, fix request `escalated`;
  - post the outstanding findings and the reason for escalation;
  - do not auto-merge or auto-approve.

## Concurrency and idempotency

- Claim due rows only: `state='queued' AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())`, using `SELECT ... FOR UPDATE SKIP LOCKED` or a conditional update; then set `claimed` and the lease.
- `fix/fail` returns the row to `queued` with `next_attempt_at` backoff and `review_state=changes_requested` while `attempts < FIX_MAX_ATTEMPTS`; at the limit it sets `failed`/`fix_failed` and escalates (then `escalated`). The queue never selects `failed`.
- `UNIQUE(attempt_id)` makes the reviewer request idempotent; a repeat returns the existing row.
- The partial unique active index prevents a second queued/claimed/fixing request for the same ticket.
- `POST /tickets/:id/fix/renew` extends the lease; a stale lease is reclaimable with an audit event.
- The partial unique index on `completed` review attempts prevents duplicate completed reviews while allowing retries after a failed attempt.
- GitHub-side dedupe (adopt an existing review by `commit_id` + body marker after a partial publish) is fg-31's contract. `github_review_id` and the marker are written by fg-31; fg-32 treats them as read-only and must not create a second fix request from a duplicate review.
- Unique `(attempt_id, finding_key)` prevents duplicate findings.
- The same worker must not review its own fix; reviewer and fixer identities are separate.

## UI

- TicketDetail review panel: round number, findings by severity, "Send to fixer" (manual mode), "Escalate to human".
- `CodeReview.vue` (`metadata.reason`) and `PhaseReview.vue` (`metadata.feedback`) must call the fix-request path; the backend accepts both keys and stores `feedback`.
- Show fix-in-progress state and last fix summary.
- Surface escalation clearly; never imply the PR was approved.
- Add component/unit tests for the panel, manual request and escalation states.

## Safety

- Reuse fg-30 `PublishingGuard` and supervisor-owned git.
- **Fast-forward only:** no force-push, no force-with-lease, no history rewrite on a shared PR branch.
- Require the branch head to equal `reviewed_sha` immediately before publishing; abort if a human moved it.
- One branch per ticket; reject a fix if the request branch differs from the PR head branch.
- Redact keys/tokens in all messages and logs.
- Phase 1 hard stops: `FIX_MAX_DURATION_MINUTES` wall clock and fg-30 diff caps; stop before publishing if exceeded. Token/cost budgets are **not** enforced until fg-30 Phase 3 lands.
- Human approval remains the final gate.

## Rollout

1. `FIX_LOOP_MODE=off` (default) and `projects.fix_loop_mode=off`: current behavior, no queue.
2. `FIX_LOOP_MODE=manual` / project `manual`: humans create fix requests; agents can claim them.
3. `FIX_LOOP_MODE=auto` / project `auto`: reviewer `request_changes` creates requests automatically.
4. The project setting overrides the global default; both default to `off`.
5. Compare rounds/success rates on real PRs; only then consider enabling auto by default.
6. Keep the legacy review path **shadowed or disabled** per fg-31 (phase filter, no status writes). A write-capable legacy reviewer must not run while the fix loop re-enters `review`.

## Open questions

1. How do we detect "same finding" across rounds reliably: `finding_key`, file+line+message hash, or reviewer-provided ids?
2. Should a human be able to edit/dismiss findings before dispatch?
3. Who can manually escalate: reviewer, human, or both?
4. When fg-30 Phase 3 lands, which budget limits become hard stops for the fixer?

Resolved: the fix state is `in_progress` + `review_state` (no dedicated `fixing` phase), and build/fix loops run as separate identities/containers.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-31 | Reviewer harness with structured findings and GitHub reviews | Agent / Review | TBD (delivered by fg-31 Phase 1) | No |
| 2 | fg-30 | Human question loop for ambiguous findings | Agent / UX | `fg-30` Phase 2 | No |
| 3 | new | Email notifications for fix requests and escalations (no existing email-notification ticket; bp-71 is account lockout) | UX | TBD | No |
| 4 | bp-106 | Ship fix/review events to log aggregation | Observability | TBD (new follow-up) | No |
| 5 | bp-04 | Fix/review cost dashboard | Observability / Billing | TBD (new follow-up) | No |
| 6 | bp-99-frontend-testing | E2E coverage for the fix loop UI | Testing | TBD (new follow-up) | No |

`From Ticket` records where the deferred improvement was found; `TBD` means no follow-up ticket exists yet, so this table does not imply one is already tracked.
