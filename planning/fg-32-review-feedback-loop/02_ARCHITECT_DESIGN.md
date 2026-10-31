# 02_ARCHITECT_DESIGN.md - Review Feedback Loop / Fixer Agent (fg-32)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-31 Automatic Review Harness, fg-30 Phase 1 harness supervisor

## Design summary

The loop has four roles and one shared record:

```
reviewer harness (fg-31)
  verdict=request_changes
        |
        v
review attempt + findings (Postgres)
        |
        v
fix queue / claim (agent API, atomic lease)
        |
        v
FixTicketProcessor (Java supervisor + OpenCode fixer)
  - checkout existing PR branch
  - prompt with findings + previous verification
  - verify, commit, push same branch
        |
        v
ticket back to review (new head SHA)
        |
        v
reviewer re-reviews -> approve (human_approval) | another round | escalate
```

The reviewer and fixer never merge. The human approval phase remains the final gate.

## State model

Use the existing phase/status model and add review metadata to `tickets` (or a dedicated `ticket_review_state` table):

| Field | Purpose |
|---|---|
| `review_state` | `none`, `awaiting_review`, `changes_requested`, `fixing`, `escalated` |
| `review_round` | 0 for the first review, incremented on each `request_changes` |
| `reviewed_sha` | SHA the last review looked at |
| `fix_branch` | branch/PR branch to reuse |
| `fix_claimed_by` / `fix_locked_at` | lease owner and expiry |

Proposed transition:

1. `review` + reviewer `request_changes`:
   - fg-31 has stored the attempt/findings;
   - fg-32 creates the fix request and transitions `review -> in_progress`, `review_state=changes_requested`, `review_round++`, `reviewed_sha=<sha>`.
2. Fixer claims:
   - `review_state=fixing`, `fix_claimed_by=<agent>`, `fix_locked_at=NOW() + lease`.
3. Fixer completes:
   - same branch pushed; status `review`, `review_state=awaiting_review`, `reviewed_sha=<new sha>`.
4. Reviewer:
   - `approve` -> `review -> human_approval`;
   - `request_changes` -> repeat until `FIX_MAX_ROUNDS`;
   - round limit/no-progress -> `review -> human_approval` with `review_state=escalated`.

`in_progress` is used for the fix state because `PhaseService` already allows `review -> in_progress`. The build agent only polls `backlog`, so fix work needs its own queue and must not be picked up by the normal backlog loop.

## Data model (shared with fg-31)

fg-31 (PR #103) defines and writes the attempt and finding tables; fg-32 consumes them. Do not redefine or fork them here.

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

-- Only completed reviews are idempotent; failed attempts may be retried.
CREATE UNIQUE INDEX uq_review_attempt_completed
  ON ticket_review_attempts (ticket_id, reviewed_sha)
  WHERE status = 'completed';

CREATE TABLE ticket_review_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES ticket_review_attempts(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL, -- stable id used to detect repeats
  severity TEXT NOT NULL,
  file TEXT,
  line INT,
  message TEXT NOT NULL,
  suggestion TEXT,
  resolved_at TIMESTAMPTZ, -- set by fg-32 when the finding is consumed/fixed
  UNIQUE (attempt_id, finding_key)
);
```

fg-32 may add its own fix-queue state (`review_state`, lease owner/expiry), but must not duplicate or fork the review attempt/finding schema.

## Backend API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/tickets/:id/review/request-changes` | reviewer agent | Store attempt/findings, transition to fix state |
| GET | `/tickets/:id/review/findings` | agent/human | Current-round findings |
| GET | `/agent/fix-queue?projectId=` | agent | Fixable tickets with branch/PR metadata |
| POST | `/tickets/:id/fix/claim` | agent | Atomic claim with lease |
| POST | `/tickets/:id/fix/complete` | agent | Mark push complete, return to review |
| POST | `/tickets/:id/fix/fail` | agent | Release claim, keep findings |
| POST | `/tickets/:id/fix/escalate` | reviewer/human | Force human approval |

All agent endpoints use `X-API-Key`, verify project ownership and enforce the lease owner.

## Java agent changes

### API client

Add to `ApiService`:

- `listFixQueue()`
- `getReviewFindings(ticketId)`
- `claimFix(ticketId)`
- `completeFix(ticketId, headSha, summary)`
- `failFix(ticketId, reason)`

### Worker

Add `FixTicketProcessor` (or a `mode=FIX` on `HarnessTicketProcessor`) implementing `TicketWorker`:

1. claim fix request;
2. fetch findings + ticket + planning docs;
3. checkout the existing branch (see below);
4. start OpenCode with a fix prompt;
5. run verification;
6. collect diff, run `PublishingGuard`, commit, push the same branch;
7. call `completeFix`; never create a PR (the existing PR updates automatically);
8. on failure call `failFix` and post the error.

Heartbeat steps: `claiming-fix`, `checking-out`, `fixing`, `verifying`, `publishing-fix`.

### Existing-branch checkout

`WorkspaceManager.cloneRepo()` currently creates a new branch with `git checkout -b`. Fix mode needs the existing branch:

- `git clone --branch <branch> --single-branch <repo> <dir>` or clone + `git fetch origin <branch>` + `git checkout <branch>`;
- verify `git rev-parse HEAD` matches `reviewed_sha` before prompting;
- never create a new branch and never force-push;
- scrub credentials after clone, as in fg-30.

### Fix prompt

`PromptBuilder.buildFix(...)` must include:

- ticket id/title/description and acceptance criteria;
- planning docs;
- current round and reviewed SHA;
- findings with stable ids, severity, file, line, message and suggestion;
- previous verification output;
- previous diff summary;
- constraints: fix only the findings, no unrelated refactors, add regression tests, run verification, no commit/push/merge;
- final response: map each finding id to the change made, tests run, residual risks.

## Reviewer changes

fg-31's reviewer already persists the attempt and findings. fg-32's `POST /review/request-changes` consumes that attempt to create the fix request and transition the ticket. The reviewer must:

- include `reviewed_sha` and `round`;
- emit stable `finding_key` values so repeats are detectable;
- never approve when verification failed;
- skip a SHA only when a `completed` attempt exists; failed attempts may retry.

## Rounds and escalation

- `FIX_MAX_ROUNDS` default 2 (initial; tune after dogfooding).
- Round 0 is the initial review; each accepted `request_changes` increments the round. `FIX_MAX_ROUNDS=2` therefore means 2 fix rounds after the initial review (3 reviews total).
- No-progress conditions:
  - fixer produces no new commit;
  - new head SHA equals the reviewed SHA;
  - the same critical `finding_key` set repeats;
  - verification fails identically twice.
- On no-progress or round exhaustion:
  - set `review_state=escalated`;
  - transition to `human_approval`;
  - post the outstanding findings and the reason for escalation;
  - do not auto-merge or auto-approve.

## Concurrency and idempotency

- Claim with `SELECT ... FOR UPDATE SKIP LOCKED` or a conditional update on `review_state=changes_requested` and an unexpired lease.
- The partial unique index on `completed` attempts prevents duplicate completed reviews while allowing retries after a failed attempt.
- GitHub-side dedupe (adopt an existing review by `commit_id` + body marker after a partial publish) is fg-31's contract. `github_review_id` and the marker are written by fg-31; fg-32 treats them as read-only and must not create a second fix request from a duplicate review.
- Unique `(attempt_id, finding_key)` prevents duplicate findings.
- If the fixer dies, the lease expires; the queue can reclaim the ticket with an audit event.
- The same worker must not review its own fix; reviewer and fixer identities are separate.

## UI

- TicketDetail review panel: round number, findings by severity, "Send to fixer" (manual mode), "Escalate to human".
- Show fix-in-progress state and last fix summary.
- CodeReview "Request changes" should create a structured fix request (or keep the phase transition and let the backend derive findings from the review record).
- Surface escalation clearly; never imply the PR was approved.

## Safety

- Reuse fg-30 `PublishingGuard` and supervisor-owned git.
- Deny force-push and branch switching in the fixer prompt/config.
- One branch per ticket; reject a fix if the ticket's `fix_branch` differs from the PR head branch.
- Redact keys/tokens in all messages and logs.
- Enforce per-ticket token/cost/time budgets; stop on exhaustion.
- Human approval remains the final gate.

## Rollout

1. `FIX_LOOP_MODE=off` (default): current behavior, no queue.
2. `FIX_LOOP_MODE=manual`: humans create fix requests; agents can claim them.
3. `FIX_LOOP_MODE=auto`: reviewer `request_changes` dispatches automatically.
4. Compare rounds/success rates on real PRs; only then consider enabling auto by default.
5. Keep the legacy review path until fg-31 and fg-32 are both proven.

## Open questions

1. Use `in_progress` + `review_state`, or add a dedicated `fixing` phase to `PhaseService`?
2. Should the fixer be a separate container/agent identity, or the same build agent with a fix mode?
3. Should the fixer amend/force-push, or always add a new commit? (Proposed: new commit, no force-push.)
4. How do we detect "same finding" across rounds reliably: `finding_key`, file+line+message hash, or reviewer-provided ids?
5. Who can manually escalate: reviewer, human, or both?
6. Should a human be able to edit/dismiss findings before dispatch?

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
