# bp-31: TemplateService Redesign — Implementation

**Status**: planned
**Priority**: P0
**Effort**: Medium
**Scope**: Backend

## Purpose
Rewrite TemplateService.js to produce structured Architect templates matching DREAM.md spec and add the Specification template type.

## Implementation Order

1. **Add `04_SPECIFICATION.md` to `ARCHITECT_TEMPLATE_FILES`** — `backend/src/services/TemplateService.js`
   - Append `{ key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true }` to the array
   - *Depends on*: nothing

2. **Add `SPECIFICATION_TEMPLATE_FILES` constant** — `backend/src/services/TemplateService.js`
   - Define `const SPECIFICATION_TEMPLATE_FILES = [{ key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true }]`
   - *Depends on*: nothing

3. **Add `getSpecificationTemplate()` and `getSpecificationTemplateContent()` methods** — `backend/src/services/TemplateService.js`
   - Add `static getSpecificationTemplate()` returning `SPECIFICATION_TEMPLATE_FILES`
   - Add `static getSpecificationTemplateContent(fileKey)` returning the same content as the Architect 04
   - *Depends on*: Step 2

4. **Rewrite `00_ARCHITECT_CHECKLIST.md` content** — `backend/src/services/TemplateService.js`
   - Replace the existing template string with new structured content containing:
     - Pre-Implementation Checklist with subsections: Planning, Existing Infrastructure Audit, Dependency Analysis, Config Audit, Testing Strategy, Rollback Readiness
     - When to Ask the User section
   - *Depends on*: nothing (can be done in parallel with steps 5-7)

5. **Rewrite `01_ARCHITECT_REQUIREMENT.md` content** — `backend/src/services/TemplateService.js`
   - Replace with sections: Problem Statement, Scope (In/Out), Acceptance Criteria, Known Unknowns, Decisions Required (with option tables), Impact Analysis (table format), Dependencies
   - *Depends on*: nothing (parallel)

6. **Rewrite `02_ARCHITECT_DESIGN.md` content** — `backend/src/services/TemplateService.js`
   - Replace with sections: Current State, Proposed Solution (Approach, Data Flow, File-Level Impact, Error Handling), Security Considerations, DB Changes, API Contract
   - *Depends on*: nothing (parallel)

7. **Rewrite `03_ARCHITECT_IMPLEMENTATION.md` content** — `backend/src/services/TemplateService.js`
   - Replace with sections: Purpose, Implementation Order (numbered steps with dependency annotations), Per-File Action Plan (table), Migration Plan, Test Plan, Rollback Steps
   - *Depends on*: nothing (parallel)

8. **Add `04_SPECIFICATION.md` content to Architect templates map** — `backend/src/services/TemplateService.js`
   - Add `'04_SPECIFICATION.md'` key to the templates object with content containing: File Operations (CREATE/MODIFY/DELETE with imports, exact signatures, function templates), Test Expectations (checklist), Edge Cases to Handle, Existing Code Patterns, Files NOT to Change
   - *Depends on*: nothing (parallel)

9. **Update tests** — `backend/src/__tests__/TemplateService.test.js`
   - Update assertions for template count (4 → 5)
   - Add tests for new `getSpecificationTemplate()` and `getSpecificationTemplateContent()`
   - Add content structure assertions for each rewritten template
   - *Depends on*: Steps 1-8 complete

## Per-File Action Plan

### `backend/src/services/TemplateService.js` (MODIFY)

**ARCHITECT_TEMPLATE_FILES** — append 5th entry:
```javascript
const ARCHITECT_TEMPLATE_FILES = [
  { key: '00_ARCHITECT_CHECKLIST.md', title: 'Pre-Implementation Checklist', required: true },
  { key: '01_ARCHITECT_REQUIREMENT.md', title: 'Requirement', required: true },
  { key: '02_ARCHITECT_DESIGN.md', title: 'Design', required: true },
  { key: '03_ARCHITECT_IMPLEMENTATION.md', title: 'Implementation', required: true },
  { key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true },
];
```

**SPECIFICATION_TEMPLATE_FILES** — add new constant (after `SIMPLE_TEMPLATE_FILES`):
```javascript
const SPECIFICATION_TEMPLATE_FILES = [
  { key: '04_SPECIFICATION.md', title: 'Execution Specification', required: true },
];
```

**getArchitectTemplateContent()** — in the templates map, replace each key with new content strings. Each string is a Markdown template with the date stamp.

**New methods** (add after `getSimpleTemplateContent()`):
```javascript
static getSpecificationTemplate() {
  return SPECIFICATION_TEMPLATE_FILES;
}

static getSpecificationTemplateContent(fileKey) {
  const templates = {
    '04_SPECIFICATION.md': `...`,
  };
  return templates[fileKey] || '';
}
```

### `backend/src/__tests__/TemplateService.test.js` (MODIFY)

Add tests:
```javascript
describe('TemplateService', () => {
  test('getArchitectTemplate returns 5 files', () => {
    const files = TemplateService.getArchitectTemplate();
    expect(files).toHaveLength(5);
    expect(files[4].key).toBe('04_SPECIFICATION.md');
  });

  test('getArchitectTemplateContent has all 5 keys', () => {
    const keys = ['00_ARCHITECT_CHECKLIST.md', '01_ARCHITECT_REQUIREMENT.md',
      '02_ARCHITECT_DESIGN.md', '03_ARCHITECT_IMPLEMENTATION.md', '04_SPECIFICATION.md'];
    keys.forEach(key => {
      expect(TemplateService.getArchitectTemplateContent(key)).toBeTruthy();
    });
  });

  test('getSpecificationTemplate returns single entry', () => {
    expect(TemplateService.getSpecificationTemplate()).toHaveLength(1);
  });

  test('getSpecificationTemplateContent returns content', () => {
    expect(TemplateService.getSpecificationTemplateContent('04_SPECIFICATION.md')).toBeTruthy();
  });

  // Content structure tests
  test('00_CHECKLIST has Pre-Implementation Checklist section', () => {
    const content = TemplateService.getArchitectTemplateContent('00_ARCHITECT_CHECKLIST.md');
    expect(content).toContain('Pre-Implementation Checklist');
    expect(content).toContain('When to Ask the User');
  });

  test('01_REQUIREMENT has all required sections', () => {
    const content = TemplateService.getArchitectTemplateContent('01_ARCHITECT_REQUIREMENT.md');
    expect(content).toContain('Problem Statement');
    expect(content).toContain('Acceptance Criteria');
    expect(content).toContain('Decisions Required');
    expect(content).toContain('Impact Analysis');
  });
});
```

## Migration Plan
No database migration needed. The old template content in `ticket_planning` rows remains unchanged — each row is a snapshot captured at template-apply time.

## Test Plan

1. **Unit tests** (Jest): Update `backend/src/__tests__/TemplateService.test.js`
   - Verify `getArchitectTemplate()` returns 5 entries
   - Verify `getArchitectTemplateContent()` returns non-empty for all 5 keys
   - Verify `getSpecificationTemplate()` returns singleton
   - Verify `getSpecificationTemplateContent('04_SPECIFICATION.md')` returns non-empty
   - Verify content structure for each of the 5 templates (key sections present)
   - Verify backward compatibility: old callers using 00-03 still get valid content
   - Verify empty string returned for unknown keys

2. **Manual verification**:
   ```
   ✓ Run `npm test` — all existing tests pass
   ✓ Console.log output of each template — visually inspect structure
   ```

## Rollback Steps

1. `git revert <commit>` to undo TemplateService.js changes
2. Run `npm test` to verify revert is clean
3. No data impact — templates are generated on-the-fly, no persisted changes
