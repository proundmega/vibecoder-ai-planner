# bp-31: TemplateService Redesign

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend
**Priority**: P0
**Effort**: Medium

## Problem Statement

`TemplateService.js` produces flat template content with placeholder text that does not match the structured formats specified in DREAM.md. All future tickets that generate planning documents will produce the old underspecified format unless this is fixed first. There is no `04_SPECIFICATION.md` template file, nor a standalone `SPECIFICATION` template type. The existing 00–03 Architect templates lack structured sections like Impact Analysis, Decisions Required, Per-File Action Plan, and Rollback Steps.

## Scope

### In Scope

- Rewrite the 4 existing Architect template content methods (`00_ARCHITECT_CHECKLIST.md` through `03_ARCHITECT_IMPLEMENTATION.md`) with structured layouts matching DREAM.md
- Add a 5th file `04_SPECIFICATION.md` to the Architect template set
- Add a new standalone `SPECIFICATION` template type (1 file: `04_SPECIFICATION.md`)
- Update template metadata lookup in `ARCHITECT_TEMPLATE_FILES` constant
- All template content uses real structured headings and section patterns, not placeholder text

### Out of Scope

- No database migrations
- No frontend changes
- No API contract changes (the existing `getArchitectTemplateContent()` interface remains unchanged)
- No changes to technical or simple templates
- No changes to the `list`, `create`, `apply`, or `delete` methods

## Acceptance Criteria

- [ ] `TemplateService.getArchitectTemplate()` returns 5 entries (including `04_SPECIFICATION.md`)
- [ ] `TemplateService.getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md')` returns a checklist with "Pre-Implementation Checklist" section containing Planning, Existing Infrastructure Audit, Dependency Analysis, Config Audit, Testing Strategy, and Rollback Readiness subsections, plus a "When to Ask the User" section
- [ ] `TemplateService.getArchitectTemplateContent('01_ARCHITECT_REQUIREMENT.md')` returns a document with Problem Statement, Scope (In/Out), Acceptance Criteria, Known Unknowns, Decisions Required (with options), Impact Analysis table, and Dependencies sections
- [ ] `TemplateService.getArchitectTemplateContent('02_ARCHITECT_DESIGN.md')` returns a document with Current State, Proposed Solution (Approach, Data Flow, File-Level Impact, Error Handling), Security Considerations, DB Changes, and API Contract sections
- [ ] `TemplateService.getArchitectTemplateContent('03_ARCHITECT_IMPLEMENTATION.md')` returns a document with Purpose, Implementation Order (numbered steps with dependencies), Per-File Action Plan, Migration Plan, Test Plan, and Rollback Steps sections
- [ ] `TemplateService.getArchitectTemplateContent('04_SPECIFICATION.md')` returns a document with File Operations (CREATE/MODIFY/DELETE with imports, signatures, templates), Test Expectations, Edge Cases to Handle, Existing Code Patterns, and Files NOT to Change sections
- [ ] `TemplateService.getSpecificationTemplate()` returns `[{ key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true }]`
- [ ] `TemplateService.getSpecificationTemplateContent()` returns the same content as the Architect `04_SPECIFICATION.md`
- [ ] No existing tests break (existing method signatures are unchanged)

## Known Unknowns

- **Consumption side**: No tickets currently call `getArchitectTemplateContent('04_SPECIFICATION.md')` — this is added proactively. Template consumption code may need updates in future tickets.
- **Standalone SPECIFICATION template**: It is not loaded by any existing route. A future ticket will need to wire it into the template picker UI.
- **Template versioning**: The old 00–03 content will be overwritten. Any in-progress planning documents using the old format will display new structures when regenerated.

## Decisions Required

1. **How to expose the new SPECIFICATION template type?**
   - Option A: Add `getSpecificationTemplate()` and `getSpecificationTemplateContent()` static methods (parallel to existing Architect/Technical/Simple patterns)
   - Option B: Use a generic `getTemplate(templateType)` method with a type enum
   - **Recommendation**: Option A — follows the established pattern without breaking existing callers

2. **Should 04_SPECIFICATION.md be optional in the Architect template?**
   - Option A: Required (always generated as part of Architect template)
   - Option B: Optional (user can skip it during template selection)
   - **Recommendation**: Option A — the spec is integral to the architect workflow

3. **What about existing template content in the database (`ticket_planning` table)?**
   - Option A: Leave existing rows untouched (planned content from old templates stays as-is)
   - Option B: Migration to re-generate all existing rows with new format
   - **Recommendation**: Option A — existing planning documents are static snapshots, no migration needed

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/TemplateService.js` | MODIFY | Rewrite `ARCHITECT_TEMPLATE_FILES` (add 04 spec entry), rewrite 4 content methods, add `SPECIFICATION` template + content method |
| `backend/src/__tests__/TemplateService.test.js` | MODIFY | Update tests to expect 5 template files, new content structure, new methods |
| Frontend | NO CHANGE | No UI changes needed |
| DB | NO CHANGE | No migration |
| API | NO CHANGE | No new routes |

## Dependencies

- **Depends on**: Nothing — this is the first ticket in the batch
- **Depends on this**: bp-32 (PhaseFlow UI), bp-34 (Code Review), bp-35 (Code Review Local), bp-37 (Deploy) — all benefit from correct template structure

## Performance Considerations

- Template content is generated in-memory via static string templates — negligible CPU/memory cost
- No database queries are introduced
- The largest template (`04_SPECIFICATION.md`) is ~3KB — no payload concerns
