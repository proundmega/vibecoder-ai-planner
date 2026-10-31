# 00_ARCHITECT_CHECKLIST.md - Review Feedback Loop / Fixer Agent (fg-32)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-31 Automatic Review Harness, fg-30 Phase 1 harness supervisor
**Related code:** `ReviewProcessor`, `HarnessTicketProcessor`, `WorkspaceManager`, `PhaseService`, `CodeReview.vue`

## Why this ticket exists

Today the reviewer can say "request changes", but nothing routes those findings back to a Java agent. The review comments are free-text ticket messages that no agent reads, the ticket stays in `review`, and the build agent only polls `backlog`. There is no fixer worker, no reviewed-SHA/round tracking, and no same-branch update.

fg-31 defines the reviewer and mentions a fixer loop at a high level. This ticket owns the concrete feedback channel and the Java-side fix execution.

## Checklist

- [ ] Decide the fix state model (`review -> in_progress` + `review_state`, or a new `fixing` phase)
- [ ] Use the fg-31 `ticket_review_attempts` + `ticket_review_findings` schema; do not fork it
- [ ] Define the structured findings contract and version it
- [ ] Define the fix queue/claim API with atomic locking and lease TTL
- [ ] Decide manual-only vs manual + automatic dispatch (`FIX_LOOP_MODE=off|manual|auto`)
- [ ] Set max rounds (initial proposal: 2 fix rounds after round 0) and the no-progress rule
- [ ] Add `WorkspaceManager` support for checking out an existing PR branch
- [ ] Add `FixTicketProcessor` (or a fix mode on `HarnessTicketProcessor`)
- [ ] Add findings + previous verification to the fixer prompt
- [ ] Route successful fixes back to `review` on the same branch/PR
- [ ] Add human escalation when rounds are exhausted or progress stalls
- [ ] Add backend, agent and contract tests
- [ ] Dogfood reviewer -> fixer -> reviewer on a real PR before enabling auto mode
- [ ] Keep the loop off by default until proven
