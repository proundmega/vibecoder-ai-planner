# 01_ARCHITECT_REQUIREMENT.md — bp-31 TemplateService Redesign

**Status**: planned
**Date created**: 2026-06-28
**Feature scope**: Backend

## Problem Statement

The current Architect template content in TemplateService.js is outdated and lacks the structured layout specified in DREAM.md. The templates have generic checklist items, vague section headers, and insufficient guidance for AI agents or human planners. All future tickets that generate planning docs will produce the old format unless we fix this first.

## Scope

- **In scope**:
  - Rewrite 4 existing Architect template content methods (00–03) with new structured layouts from DREAM.md
  - Add 5th file `04_SPECIFICATION.md` to the Architect template
  - Add a new standalone `SPECIFICATION` template (1 file: the execution spec)
  - Update template metadata in the static lookup
  - Update tests to reflect 5 architect files instead of 4

- **Out of scope**:
  - Technical template changes (unchanged for now)
  - Simple template changes (unchanged)
  - Frontend UI changes
  - Database schema changes
  - API endpoint changes
  - Template application logic changes (TicketPlanningService unchanged)

## Acceptance Criteria

- [x] `getArchitectTemplate()` returns 5 files (00–04)
- [x] `getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md')` contains redesigned checklist structure with Planning, Infrastructure Audit, Dependency Analysis, Configuration Audit, Testing Strategy, Rollback Readiness sections
- [x] `getArchitectTemplateContent('01_ARCHITECT_REQUIREMENT.md')` contains redesigned structure with Problem Statement, Scope, Acceptance Criteria, Known Unknowns, Decisions Required, Impact Analysis, Dependencies, Performance Considerations
- [x] `getArchitectTemplateContent('02_ARCHITECT_DESIGN.md')` contains redesigned structure with Current State, Proposed Solution, Data Flow, File-Level Impact, Error Handling, Alternatives, Security, Database Changes, API Contract
- [x] `getArchitectTemplateContent('03_ARCHITECT_IMPLEMENTATION.md')` contains redesigned structure with Purpose, Implementation Order, Per-File Action Plan, Migration Plan, Test Plan, Rollback Steps
- [x] `getArchitectTemplateContent('04_SPECIFICATION.md')` contains File Operations, Test Expectations, Edge Cases, Existing Code Patterns sections
- [x] `getSpecificationTemplate()` returns 1 file (04_SPECIFICATION.md)
- [x] `getSpecificationTemplateContent('04_SPECIFICATION.md')` returns the same content as Architect's 04_SPECIFICATION.md
- [x] All existing tests pass (updated to expect 5 architect files)
- [x] `getTechnicalTemplate()` still returns 3 files (unchanged)
- [x] `getSimpleTemplate()` still returns 1 file (unchanged)

## Known Unknowns

- None — all template content is fully specified in DREAM.md

## Decisions Required

1. **Question**: Should the Specification template use the exact same content as Architect's 04_SPECIFICATION.md, or be a simplified version?
   - Option A: Same content — ensures consistency, simpler maintenance
   - Option B: Simplified content — reduces cognitive load for small tasks
   - Recommendation: Option A (DREAM.md specifies "Contains the same structure as 04_SPECIFICATION.md")

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/TemplateService.js` | MODIFY | Rewrite 4 architect template contents, add 04_SPECIFICATION.md, add specification template |
| `backend/src/__tests__/ticketPlanning.test.js` | MODIFY | Update test expectations for 5 architect files |
| `backend/src/services/TicketPlanningService.js` | UNCHANGED | Template application logic unchanged |

## Dependencies

- **This ticket depends on**: None
- **Depends on this**: None

## Performance Considerations

- Template content is static strings, no performance impact
- No new database queries or API calls
