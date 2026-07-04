# 00_ARCHITECT_CHECKLIST.md — bp-31 TemplateService Redesign

**Status**: planned
**Date created**: 2026-06-28
**Feature scope**: Backend

## Pre-Implementation Checklist

### Planning
- [x] Acceptance criteria are specific and testable
- [x] Out-of-scope items explicitly documented
- [x] All design decisions have documented options
- [x] "Unknown unknowns" identified — none expected for this ticket

### Existing Infrastructure Audit
- [x] Backend API checked — TemplateService.js is the only file that needs changes
- [x] Frontend API client checked — no frontend changes required
- [x] Frontend UI checked — no frontend changes required
- [x] Router checked — no route changes required
- [x] Database schema checked — no DB changes required
- [x] Migration checked — no migration needed
- [x] Existing patterns identified — TemplateService uses static methods with template content strings

### Dependency Analysis
- [x] All new dependencies listed — none required
- [x] All existing dependencies that will be affected — TemplateService is used by TicketPlanningService
- [x] Breaking changes identified — template content structure changes, but API contract unchanged

### Configuration Audit
- [x] All new env vars documented — none required
- [x] All new config files documented — none required
- [x] Feature flags considered — not applicable

### Testing Strategy
- [x] Unit test files identified — backend/src/__tests__/ticketPlanning.test.js
- [x] Integration test scope defined — unit tests only, no DB changes
- [x] Manual test scenarios enumerated — apply template via API, verify content structure

### Rollback Readiness
- [x] Database migration is reversible — N/A (no migration)
- [x] API change is backward-compatible — yes, same endpoints, same response format
- [x] Deploy order is documented — just deploy code, no migration order needed

## When to Ask the User
- N/A — all template content is specified in DREAM.md
