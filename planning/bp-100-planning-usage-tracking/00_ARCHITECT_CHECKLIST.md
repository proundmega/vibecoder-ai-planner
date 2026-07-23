# 00_ARCHITECT_CHECKLIST.md — Pre-Implementation Checklist

**Status**: draft
**Date started**: 2026-07-23
**Author**: AI Assistant
**Feature scope**: Backend | Java Agent | Frontend
**Related**: bp-04 (usage/billing foundations), PR #66 feedback

---

## Pre-Implementation Checklist

### Planning

- [ ] I have read `01_ARCHITECT_REQUIREMENT.md` — I understand the requirement
- [ ] I have read `02_ARCHITECT_DESIGN.md` — I understand the design
- [ ] I have read `03_ARCHITECT_IMPLEMENTATION.md` — I know the actions and dependencies
- [ ] I have identified all assumptions and confirmed they are reasonable
- [ ] I know what is IN scope and OUT of scope

### Existing Infrastructure Audit

- [ ] I have checked `bp-04-usage-billing` — usage tracking wired to agent AI calls, billing aggregation works
- [ ] I have checked `ticket_planning` table — versioned markdown files per ticket, no usage columns
- [ ] I have checked `TicketPlanningService` — CRUD for planning files, no AI usage tracking
- [ ] I have checked `TicketProcessor.java` — fetches planning docs, calls AI, reports usage with ticket_id only (not per-planning-stage)
- [ ] I have checked `UsageLogger.js` — logs usage to `usage_logs`, has ticket_id but no planning_stage or file_key
- [ ] I have checked `usage_logs` table — has `ticket_id`, `agent_id`, `provider_type`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `duration_ms`
- [ ] I have checked frontend planning UI — displays planning files, no usage/cost indicators
- [ ] I have checked `pricing.js` — MODEL_PRICING map with per-model rates

### Database & Migration

- [ ] Need migration to add usage columns to `ticket_planning` table
- [ ] Need migration to add `planning_usage_logs` table (or extend `usage_logs` with planning_stage + file_key)
- [ ] Rollback strategy for each migration
- [ ] Migration position in `apply.js` — must be after 037 (last current migration)

### Testing Strategy

- [ ] Backend: Test new usage columns persist correctly in `ticket_planning`
- [ ] Backend: Test `UsageLogger.logPlanningUsage()` inserts with planning_stage
- [ ] Backend: Test planning usage API returns per-stage breakdown
- [ ] Backend: Test Java agent usage reporting includes planning_stage
- [ ] Backend: Integration test — agent processes ticket → usage logged per planning stage
- [ ] Frontend: Test usage display in planning file viewer
- [ ] Frontend: Test usage breakdown component renders correctly
- [ ] Coverage: 60% minimum across all new files

### Configuration Audit

- [ ] No new env vars needed — reuses existing provider config
- [ ] Existing `MODEL_PRICING` in `pricing.js` — may need new model entries for planning-specific models

---

## Post-Implementation Checklist

- [ ] Backend: `npm test` passes
- [ ] Backend: `npm run lint` passes
- [ ] Backend: `npm run test:coverage` passes (60% threshold)
- [ ] Java agent: `mvn clean package` compiles
- [ ] Frontend: `npm run lint` passes
- [ ] Frontend: `npm run typecheck` passes
- [ ] Frontend: `npm test -- --run` passes
- [ ] `ticket_planning` has usage columns (tokens_in, tokens_out, cost_usd, duration_ms, provider_type, model, planning_stage)
- [ ] `planning_usage_logs` table populated when AI processes planning docs
- [ ] `GET /tickets/:id/planning/:fileKey/usage` returns per-stage usage history
- [ ] Frontend planning viewer shows usage indicators per file
- [ ] Usage breakdown viewable in frontend

---

## When to Ask the User

1. **Usage storage strategy** — Attach usage directly to `ticket_planning` rows (per-file, last-known) vs. separate `planning_usage_logs` table (full history)? The feedback mentions "attach usage to the planning object itself" which suggests per-row, but full history is more useful for billing.
2. **Which planning stages to track** — The feedback lists: requirement extraction, plan generation, refinement, validation. Should all four be tracked, or only the ones where AI actually makes calls?
3. **Frontend placement** — Where should usage data be displayed? Inline in the planning file viewer? A separate usage tab on the ticket detail page? Both?

---

*This checklist prevents agents from skipping planning and jumping straight to coding.*
