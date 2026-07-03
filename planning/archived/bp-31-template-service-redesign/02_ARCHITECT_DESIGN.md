# 02_ARCHITECT_DESIGN.md — bp-31 TemplateService Redesign

**Status**: planned
**Date created**: 2026-06-28

## Current State

TemplateService.js contains 3 built-in templates (Architect, Technical, Simple) with hardcoded markdown content strings. The Architect template has 4 files (00–03) with generic, minimally structured content that doesn't match the detailed specifications in DREAM.md.

## Proposed Solution

### Approach

Rewrite the template content strings in TemplateService.js to match the redesigned structures from DREAM.md. Add a 5th file (04_SPECIFICATION.md) to the Architect template. Create a new standalone Specification template with the same 04_SPECIFICATION.md content.

### Data Flow

```
User selects "Architect" template → TicketPlanningService.applyTemplate() → TemplateService.getArchitectTemplate() → returns 5 file definitions → TemplateService.getArchitectTemplateContent() → returns content for each file → INSERT into ticket_planning table
```

### File-Level Impact

| File | Action | What Changes |
|------|--------|-------------|
| `backend/src/services/TemplateService.js` | MODIFY | Add 04_SPECIFICATION.md to ARCHITECT_TEMPLATE_FILES, rewrite 4 architect content methods, add getSpecificationContent(), add SPECIFICATION_FILES, add getSpecificationTemplate() and getSpecificationTemplateContent() |
| `backend/src/__tests__/ticketPlanning.test.js` | MODIFY | Update test to expect 5 architect files instead of 4, update content assertions |

### Error Handling Strategy

- Template content methods return empty string for unknown file keys (existing behavior preserved)
- No runtime errors expected — all content is static strings

### Alternatives Considered

- **Alternative A**: Store templates in separate markdown files loaded from disk — rejected because it adds file I/O complexity and makes templates harder to version with the service
- **Alternative B**: Store templates in database — rejected because templates are static and don't need dynamic storage

## Security Considerations

- Template content is static markdown, no user input involved
- No authentication or authorization changes needed

## Database Changes

- None — no new tables or columns required

## API Contract

- No API changes — same endpoints, same response format
- Template content is returned via existing TicketPlanningService.applyTemplate() endpoint
