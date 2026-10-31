# 02_ARCHITECT_DESIGN.md - Automatic Review Harness (fg-31)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 harness supervisor (PR #102), fg-30 Phase 2 human loop

## Design summary

The reviewer is a **read-only sibling of the build harness**. It checks out the PR head in an isolated workspace, runs verification, reads the ticket and planning docs, asks OpenCode for a structured review, then the Java supervisor publishes the review to GitHub and routes the ticket to `human_approval`. The model never edits code, commits, pushes, merges, or changes ticket state directly.

```
ticket enters review + pr_url
        |
        v
ReviewTicketProcessor (Java supervisor)
  - check out PR head / branch
  - start OpenCode session (read-only)
  - prompt: ticket + planning + diff + instructions
  - supervisor runs verification commands
  - parse + validate review JSON
        |
        +--> GitHub: create PR review (APPROVE / REQUEST_CHANGES / COMMENT)
        +--> Planner: summary + findings messages
        +--> Phase: approve -> human_approval
                    request_changes -> review (fixer loop)
        |
        v
review_attempts (reviewed_sha, round, verdict, timestamps)
```

## Components

| Component | Responsibility |
|---|---|
| `ReviewHarnessClient` | OpenCode server lifecycle, read-only config, prompt, events, cleanup |
| `ReviewTicketProcessor` | Supervises checkout, prompt, verification, parsing, publishing |
| `ReviewPromptBuilder` | Ticket, planning docs, repo rules, diff, checklist, output schema |
| `ReviewResultParser` | Strict JSON/schema validation and fail-closed behavior |
| `GitHubReviewService` | `POST /repos/{owner}/{repo}/pulls/{number}/reviews` with inline comments |
| `ReviewAttemptStore` | `reviewed_sha`, round, verdict, provider usage, timestamps |
| `ReviewPhaseRouter` | Maps verdict to phase transitions; never `done` |
| Legacy `ReviewProcessor` | Kept behind `REVIEW_HARNESS_MODE=legacy` |

## Review harness permissions

- `edit`: deny (read-only checkout; supervisor may make no edits either)
- `bash`: allowed only for configured verification commands/read-only inspection; deny `git push`, `git commit`, `git merge`, `git reset`, package installs that write outside the workspace, `docker`, `kubectl`, and pipe-to-shell
- `webfetch`, `websearch`, `task`, `question`, `external_directory`: deny
- `read`: allow except `.env*`, `**/secrets/**`, `.git/config`

Because the reviewer does not need to edit, the OpenCode session can run in a read-only mount or the supervisor can snapshot the tree and discard it.

## Inputs

1. Ticket id, title, description, priority, acceptance criteria.
2. Planning documents attached to the ticket.
3. Repository instructions (`AGENTS.md`, `README.md`, `ai/CODING.md`).
4. PR metadata: base/head, head SHA, changed files, diff.
5. Verification commands and results from the supervisor.
6. Previous review findings and fix round, when present.

## Output schema

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
  "verification": [
    { "command": "npm test", "passed": true }
  ],
  "residual_risks": ["..."],
  "human_questions": ["..."]
}
```

The parser rejects unknown verdicts, missing required fields, and findings whose file is outside the diff unless severity is `info`. `approve` requires zero `critical` findings and all verification commands passing.

## GitHub integration

- Use the existing project GitHub token (same ownership as build publishing).
- Create a review with `event=APPROVE|REQUEST_CHANGES|COMMENT` and a body summary.
- Inline comments only when the file is part of the diff and the line is commentable; otherwise put the finding in the summary.
- Do not merge, close, or force-push the PR.
- If the PR already has a review from this agent for the same SHA, skip; if a previous review exists for an older SHA, create a new review for the new SHA.

## Idempotency and rounds

- `review_attempts(ticket_id, sha, round, verdict, provider, model, tokens_in, tokens_out, duration_ms, created_at)`.
- Unique constraint on `(ticket_id, sha)`.
- Round limit: default `REVIEW_MAX_ROUNDS=2`; on exhaustion, post "human review required" and route to `human_approval` without an approve verdict.
- On `request_changes`, the build/fixer path receives the findings and may push one commit per round.
- No review is started when `pr_url` is missing or the head SHA is already approved.

## Phase and status mapping

| Verdict | Phase transition | Status |
|---|---|---|
| `approve` (verification passing, no critical findings) | `review -> human_approval` | `review` |
| `request_changes` | stay `review` (or `review -> in_progress` for the fixer) | `review` / `in_progress` |
| `comment` | stay `review` | `review` |
| harness/verification failure | stay `review`, post failure | `review` |

Never transition to `done`. The human approval action remains the only path to `done` (and merging remains manual).

## Provider and budgets

- Prefer `opencode-go` built-in provider with `beam-free` for reviews; allow a paid Go model for complex diffs.
- Budget: 20 minutes, 500k tokens, $2, 50 tool calls per review (initial proposal; tune after dogfooding).
- Reuse the fg-30 provider/config writer, but forbid edit tools.
- If the provider is unavailable, do not fall back to an unreviewed approval; post a failure and leave the ticket in `review`.

## Observability

- Review lifecycle events: started, checkout, verification result, model verdict, GitHub review id, phase transition.
- Persist tokens, duration, model, and verdict per attempt.
- Post a compact summary to the ticket; full findings live in the PR review and attempt store.
- Redact tokens/keys in all logs and messages.

## Rollout

1. `REVIEW_HARNESS_MODE=legacy` (default) keeps current behavior.
2. `REVIEW_HARNESS_MODE=opencode` enables the new processor for one project.
3. Compare legacy and harness verdicts on the same PRs for a short bake period.
4. Switch the default only after the human-approval gate and round limit are proven.
5. Remove the legacy reviewer in a later cleanup ticket.

## Open questions

1. Should the reviewer run in the same agent process/container as the builder, or a dedicated review worker?
2. Do we store attempts in Postgres (preferred) or ticket phase metadata?
3. Should `request_changes` return the ticket to `in_progress` automatically, or wait for a human to dispatch the fixer?
4. How do we present inline findings for files outside the diff (e.g., missing tests)?
5. Do we require a human question when the reviewer is uncertain, or default to `comment` and human approval?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Human question loop for review uncertainty | Agent / UX | `fg-30` Phase 2 | No |
| 2 | bp-71 | Email notifications for review results | UX | `bp-71-email-notifications` | No |
| 3 | bp-106 | Ship review events to log aggregation | Observability | `bp-106-harness-event-shipping` | No |
| 4 | bp-04 | Review cost/budget dashboard | Observability / Billing | `bp-04-harness-budgets` | No |
| 5 | fg-13 | Contract updates for review endpoints | Testing | `fg-13-contract-followup` | No |
| 6 | bp-99 | E2E coverage for review UI | Testing | `bp-99-e2e-harness-ui` | No |
