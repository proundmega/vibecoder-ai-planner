# 02_ARCHITECT_DESIGN.md - Automatic Review Harness (fg-31)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Revised:** 2026-11-01 (addresses PR #103 design review)
**Depends on:** fg-30 Phase 1 harness supervisor (PR #102), fg-30 Phase 2 human loop, fg-32 (#104) for fix dispatch/rounds/findings consumption

## Design summary

The reviewer is a **read-only sibling of the build harness**. It checks out the PR head into an isolated, **writable but disposable** workspace, the supervisor runs verification, the model reads the ticket and planning docs and returns structured findings, and the Java supervisor publishes a **COMMENT-only** GitHub review. Because the trigger is status-based, the supervisor reconciles the phase before the review and re-checks it before approval. The model never edits code, commits, pushes, merges, or changes ticket state directly.

```
ticket status=review + pr_url
        |
        v
ReviewTicketProcessor (Java supervisor)
  - reconcile phase to 'review' (prerequisite)
  - check out PR head / branch into disposable workspace
  - start OpenCode session (edit=deny)
  - prompt: ticket + planning + diff + instructions
  - supervisor runs verification commands (source of truth)
  - parse + validate review JSON (ignore model verification)
        |
        +--> GitHub: create COMMENT review with commit_id
        +--> Planner: summary + findings messages
        +--> Attempts: ticket_review_attempts + ticket_review_findings
        +--> Phase: approve -> human_approval (only if phase=review)
                    request_changes/comment -> stay review
        |
        v
fg-32 consumes findings, dispatches fixer, owns rounds
```

## Components

| Component | Responsibility |
|---|---|
| `ReviewHarnessClient` | OpenCode server lifecycle, read-only tool config, prompt, events, cleanup |
| `ReviewTicketProcessor` | Supervises checkout, prompt, verification, parsing, publishing |
| `ReviewPromptBuilder` | Ticket, planning docs, repo rules, diff, checklist, output schema |
| `ReviewResultParser` | Strict JSON/schema validation and fail-closed behavior; drops model verification |
| `ReviewPhaseReconciler` | Ensures `phase=review` before the review and re-checks it before approval; fails closed to COMMENT + human escalation |
| `GitHubReviewService` | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` with `event=COMMENT` and `commit_id` |
| `ReviewAttemptStore` | `ticket_review_attempts` status, SHA, round, verdict, usage, timestamps |
| `ReviewFindingStore` | `ticket_review_findings` rows consumed by fg-32 |
| Legacy `ReviewProcessor` | Kept behind `REVIEW_HARNESS_MODE=legacy`; shadow mode or disabled during bake |

## Review harness permissions

- `edit`: deny (the model cannot modify code)
- `bash`: allowed only for configured verification commands/read-only inspection; deny `git push`, `git commit`, `git merge`, `git reset`, package installs that write outside the workspace, `docker`, `kubectl`, and pipe-to-shell
- `webfetch`, `websearch`, `task`, `question`, `external_directory`: deny
- `read`: allow except `.env*`, `**/secrets/**`, `.git/config`

### Workspace: writable, disposable, never published

A strictly read-only mount cannot run verification: fg-30's `resolveInstallCommands()` bootstraps npm installs (`npm ci` when a lockfile exists, otherwise `npm install --no-package-lock`), and autodetected verification may run `mvn test -q`; both write `node_modules/` and `target/`. The reviewer therefore uses a **writable throwaway workspace**:

- clone the PR head into a per-run directory (same tokenless, shallow clone as fg-30);
- allow installs/builds only inside that directory;
- after the run, discard the tree; the supervisor never commits, pushes, merges or opens a PR from it;
- run with the controls fg-30 actually provides: `HARNESS_STARTUP_TIMEOUT_MS`, `HARNESS_IDLE_TIMEOUT_MS`, `HARNESS_MAX_DURATION_MINUTES`, bounded `VerificationRunner` output capture, and process-group kill. CPU/memory limits currently come from `agent/docker-compose.yml`; there is no pids limit. Add real pids/memory limits in the sandbox follow-up and never pass host credentials.

Verification executes arbitrary PR code. A dedicated sandbox/egress-hardening ticket is required before enabling this on untrusted contributions; no `fg-34` ticket exists in this repository yet, so track it as a new follow-up and cross-reference the fg-30 hardening phase.

## Inputs

1. Ticket id, title, description, priority, acceptance criteria, current `status` and `phase`.
2. Planning documents attached to the ticket.
3. Repository instructions (`AGENTS.md`, `README.md`, `ai/CODING.md`).
4. PR metadata: base/head, head SHA, changed files, diff.
5. **Supervisor-captured** verification commands and results.
6. Previous review findings and round, when present.

## Output schema

The model returns only review content. Verification results are attached by the supervisor and are **never** accepted from the model.

```json
{
  "verdict": "approve | request_changes | comment",
  "summary": "Short review summary",
  "findings": [
    {
      "severity": "critical | warning | info",
      "file": "backend/src/services/TicketService.js",
      "line": 198,
      "message": "Why this is a problem",
      "suggestion": "Concrete fix or test to add"
    }
  ],
  "residual_risks": ["..."],
  "human_questions": ["..."]
}
```

The parser rejects unknown verdicts, missing required fields, and findings whose file is outside the diff unless severity is `info`.

**Approval rule:** `approve` requires zero `critical` findings **and** supervisor verification with `commands.length > 0` and every command passing. If the model emits a `verification` field it is ignored; if verification ran zero commands, the review cannot be `approve`.

## GitHub integration

- **Phase 1 is COMMENT-only.** Do not send `APPROVE` or `REQUEST_CHANGES`: the build agent authors the PR with the project token, and GitHub rejects self-review (422). The planner phase gate is the decision surface.
- Create a review with `event=COMMENT`, a body summary, and the reviewed `commit_id`.
- Before posting, re-fetch the PR head. If it moved from the reviewed SHA, abort or restart instead of attaching a review to the wrong commit.
- Inline comments only when the file is part of the diff and the line is commentable; otherwise put the finding in the summary.
- Do not merge, close, or force-push the PR.
- If the PR already has a completed review from this agent for the same SHA, skip; an older SHA may get a new review.
- A distinct reviewer identity (GitHub App installation token) is a Phase 2 prerequisite for `APPROVE`/`REQUEST_CHANGES`; no such ticket exists in this repository yet, so create one as a follow-up.

## Idempotency and retries

fg-31 defines and writes these tables; fg-32 (#104) consumes them and owns fix dispatch, rounds and findings consumption.

```sql
CREATE TABLE ticket_review_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  reviewed_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  round INT NOT NULL DEFAULT 0,
  verdict TEXT CHECK (verdict IN ('approve', 'request_changes', 'comment')),
  verification JSONB, -- supervisor-captured results; never model-supplied
  github_review_id BIGINT, -- nullable; set after a successful GitHub POST
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

- Insert a `started` attempt before doing work; mark `completed` only after verification, parsing and publishing succeed; mark `failed` with a reason otherwise. Persist `github_review_id` when the POST succeeds.
- A stale `started` attempt is reclaimable after a timeout. The retry **reuses the same attempt id** so the body marker still matches after a crash; if the id is unknown, it searches existing reviews for the `<!-- fg-31-review:` prefix plus the reviewed SHA before posting.
- Only a `completed` row blocks the same SHA; transient harness/verification failures can be retried.
- **Partial-publish recovery:** a successful GitHub post followed by a failed attempt-completion write must not post twice. Before posting (and after the head re-check), list existing PR reviews and look for this reviewer's review with `commit_id == reviewed_sha` and a deterministic body marker (for example `<!-- fg-31-review:<attempt_id> -->`). If found, adopt its review id into `github_review_id`, mark the attempt `completed`, and skip the POST.
- A retry that already has a persisted `github_review_id` never posts again; it only retries the DB completion.
- The head re-check and review dedupe happen immediately before `POST /repos/{owner}/{repo}/pulls/{number}/reviews`. This contract must be carried unchanged into `03`/`04`.
- No review starts when `pr_url` is missing.

### Handoff to fg-32

After posting a `request_changes` COMMENT review and completing the attempt, the reviewer calls fg-32's `POST /tickets/:id/review/request-changes` with the attempt id. fg-32 creates the fix request idempotently; it does not poll attempts. This one-line call is the only fg-31 → fg-32 integration point.

## Phase and status mapping

**Prerequisite:** the current build path does not sync phase. `HarnessTicketProcessor.markReview()` calls `updateTicketStatus(ticketId, "review")`, which updates only `status`; tickets start at `phase='draft'`. `PhaseService` allows only `review -> human_approval`, so approval fails unless the phase is reconciled.

`ReviewPhaseReconciler` runs before checkout/review, and the phase is re-checked immediately before any approval transition:

1. Read the ticket phase.
2. If `phase=review`, continue.
3. Otherwise call `POST /tickets/:id/phases/reconcile` (new endpoint): when `status=review` and `phase` is `draft|planning|plan_approved|assigned|in_progress`, set `phase=review` and write an audit event. The endpoint is idempotent.
4. If reconciliation is unavailable or rejected, post a COMMENT review, leave the ticket in `review`, and escalate to a human. Never claim approval.

| Verdict | Phase transition | Status |
|---|---|---|
| `approve` (supervisor verification passing, no critical findings) | `review -> human_approval` after reconciliation | `review` |
| `request_changes` | stay `review` (fg-32 may route to `in_progress`) | `review` / `in_progress` |
| `comment` | stay `review` | `review` |
| harness/verification failure, zero commands, phase not reconciled | stay `review`, post failure | `review` |

Never transition to `done`. The human approval action remains the only path to `done` (and merging remains manual).

### Legacy bypass must be closed

`PhaseService.PHASE_TO_STATUS` maps `human_approval` to `status=review`, and `Ticket.findByStatus()` filters on status only. The legacy `ReviewProcessor` therefore still sees tickets waiting for human approval and can set `status=done`.

Before the harness is enabled with phase-gated approval:

- add `phase` filtering to the ticket list API (`GET /tickets/project/:id?status=review&phase=review`);
- update `ApiService.listReviewTickets()` to request `phase=review`;
- run legacy in **shadow mode** (review comments only, no status writes) or disable it during the bake. Do not run legacy and harness with write access at the same time.

## Provider and budgets

- Prefer `opencode-go` built-in provider with `beam-free` for reviews; allow a paid Go model for complex diffs.
- Budget: 20 minutes, 500k tokens, $2, 50 tool calls per review (initial proposal; tune after dogfooding).
- Reuse the fg-30 provider/config writer, but forbid edit tools.
- If the provider is unavailable, do not fall back to an unreviewed approval; post a failure and leave the ticket in `review`.

## Observability

- Review lifecycle events: started, checkout, verification result, model verdict, GitHub review id, phase reconciliation, phase transition.
- Persist tokens, duration, model, and verdict per attempt.
- Post a compact summary to the ticket; full findings live in the PR review and attempt store.
- Redact tokens/keys in all logs and messages.

## Rollout

1. `REVIEW_HARNESS_MODE=legacy` (default) keeps current behavior.
2. Add the phase filter and put legacy in shadow mode (or disable it).
3. `REVIEW_HARNESS_MODE=opencode` enables the new processor for one project in COMMENT-only mode.
4. Compare legacy (shadow) and harness verdicts on the same PRs for a short bake period.
5. Enable phase-gated `human_approval` routing only after reconciliation and the legacy bypass are proven.
6. Add a distinct reviewer identity and `APPROVE`/`REQUEST_CHANGES` later (Phase 2).
7. Remove the legacy reviewer in a later cleanup ticket.

## Open questions

1. Should the reviewer run in the same agent process/container as the builder, or a dedicated review worker?
2. Do we add `POST /tickets/:id/phases/reconcile`, or land the fg-30 lifecycle sync (status change updates phase) first?
3. Should legacy be deleted rather than shadowed once the harness proves parity?
4. How do we present inline findings for files outside the diff (e.g., missing tests)?
5. Do we require a human question when the reviewer is uncertain, or default to `comment` and human approval?
6. Which ticket owns the verification sandbox/egress hardening (no `fg-34` exists yet)?
7. When a distinct reviewer identity lands, should `REQUEST_CHANGES` be enabled before `APPROVE`?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Human question loop for review uncertainty | Agent / UX | `fg-30` Phase 2 | No |
| 2 | new | Email notifications for review results (no existing email-notification ticket; bp-71 is account lockout) | UX | TBD | No |
| 3 | bp-106 | Ship review events to log aggregation | Observability | TBD (new follow-up) | No |
| 4 | bp-04 | Review cost/budget dashboard | Observability / Billing | TBD (new follow-up) | No |
| 5 | fg-13 | Contract updates for review endpoints | Testing | TBD (new follow-up) | No |
| 6 | bp-99-frontend-testing | E2E coverage for review UI | Testing | TBD (new follow-up) | No |

`From Ticket` records where the deferred improvement was found; `TBD` means no follow-up ticket exists yet, so this table does not imply one is already tracked.
