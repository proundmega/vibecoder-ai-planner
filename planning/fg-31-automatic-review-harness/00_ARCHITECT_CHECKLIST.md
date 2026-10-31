# 00_ARCHITECT_CHECKLIST.md - Automatic Review Harness (fg-31)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor), fg-30 Phase 2 (durable human loop)
**Related legacy path:** `agent/src/main/java/com/vibecode/agent/service/ReviewProcessor.java`

## Why this ticket exists

The project already has an automatic review path, but it is the legacy one-shot reviewer:

- it only sees the GitHub PR patch, not the repository, tests, or planning documents;
- it posts findings as planner ticket messages, not GitHub PR reviews;
- it approves by setting `status=done` directly, bypassing the `human_approval` phase;
- it has no reviewed-SHA marker, so a rejected ticket is re-reviewed every poll cycle;
- it cannot run verification commands.

This ticket records the missing reviewer harness. It is **not** part of fg-30 Phase 1.

## Checklist

- [ ] Merge fg-30 Phase 1 (PR #102) and validate one real ticket end-to-end
- [ ] Decide whether review output goes to GitHub PR reviews, ticket messages, or both
- [ ] Decide where reviewed SHA / attempt count is stored (ticket phase metadata vs new table)
- [ ] Decide review-round limit (initial proposal: 2 rounds)
- [ ] Define the structured review schema and verdict mapping
- [ ] Define read-only workspace permissions for the reviewer harness
- [ ] Define how a fixer consumes findings and produces a new commit on the same branch
- [ ] Decide rollout flag (`REVIEW_HARNESS_MODE=legacy|opencode`)
- [ ] Write `03_ARCHITECT_IMPLEMENTATION.md`
- [ ] Write `04_SPECIFICATION.md` for reviewer Phase 1
- [ ] Implement behind the rollout flag
- [ ] Add contract tests with a fake OpenCode server and a fake GitHub review API
- [ ] Dogfood on a real PR, comparing legacy and harness reviews
- [ ] Deprecate the legacy `ReviewProcessor` only after parity and a human-approval gate
