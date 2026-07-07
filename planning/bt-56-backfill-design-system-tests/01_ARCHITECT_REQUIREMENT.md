# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: completed
**Date created**: 2026-07-04
**Date completed**: 2026-07-07
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Medium
**Related**: bp-56 (Design System)

---

## Requirement

bp-56 introduced a design system with 6 new base components (VButton, VModal, VCard, VBadge, VTable, VFormGroup), CSS design tokens, and visual styling guidelines. However, none of these components have corresponding tests. Without tests, component behavior, variant rendering, and design token values cannot be verified.

This ticket backfills all missing test coverage for the bp-56 design system changes.

---

## Existing Infrastructure Audit

### Frontend UI Check
- [ ] VButton component exists: `frontend/src/components/VButton.vue` — verify
- [ ] VModal component exists: `frontend/src/components/VModal.vue` — verify
- [ ] VCard component exists: `frontend/src/components/VCard.vue` — verify
- [ ] VBadge component exists: `frontend/src/components/VBadge.vue` — verify
- [ ] VTable component exists: `frontend/src/components/VTable.vue` — verify
- [ ] VFormGroup component exists: `frontend/src/components/VFormGroup.vue` — verify
- [ ] Design tokens: CSS variables in `frontend/src/assets/css/` — verify
- [ ] Existing test patterns: `frontend/src/__tests__/`, `frontend/cypress/component/` — verify

### Key Insight

This is a **frontend test-only** ticket. All production components from bp-56 already exist. The task is to create tests for:
1. All 6 base components (unit/component tests)
2. Design token CSS variable values
3. VButton variants (primary, secondary, danger, ghost, link) + sizes + loading + disabled
4. VModal overlay, animation, focus trap, slot rendering
5. VCard padding variants, VBadge color variants, VTable sorting/empty/loading states
6. VFormGroup label/error/help text rendering
7. Primary color change propagation to all views
8. Bundle size regression test

---

## Scope

### In Scope
- Create `frontend/cypress/component/VButton.spec.ts` — test all variants, sizes, loading, disabled
- Create `frontend/cypress/component/VModal.spec.ts` — test overlay, animation, focus trap, slots
- Create `frontend/cypress/component/VCard.spec.ts` — test padding variants
- Create `frontend/cypress/component/VBadge.spec.ts` — test color variants
- Create `frontend/cypress/component/VTable.spec.ts` — test sorting, empty, loading states
- Create `frontend/cypress/component/VFormGroup.spec.ts` — test label, error, help text
- Create `frontend/src/__tests__/designTokens.test.ts` — test CSS variable values
- Create `frontend/src/__tests__/colorPropagation.test.ts` — test primary color propagation
- Create `frontend/src/__tests__/bundleSize.test.ts` — test bundle size regression

### Out of Scope
- Modifying any production code from bp-56
- Creating visual regression tests (screenshot comparison is manual only)
- Changes to the design system components themselves

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/cypress/component/VButton.spec.ts` | CREATE | Variants, sizes, loading, disabled |
| `frontend/cypress/component/VModal.spec.ts` | CREATE | Overlay, animation, focus trap, slots |
| `frontend/cypress/component/VCard.spec.ts` | CREATE | Padding variants |
| `frontend/cypress/component/VBadge.spec.ts` | CREATE | Color variants |
| `frontend/cypress/component/VTable.spec.ts` | CREATE | Sorting, empty, loading states |
| `frontend/cypress/component/VFormGroup.spec.ts` | CREATE | Label, error, help text |
| `frontend/src/__tests__/designTokens.test.ts` | CREATE | CSS variable values |
| `frontend/src/__tests__/colorPropagation.test.ts` | CREATE | Primary color propagation |
| `frontend/src/__tests__/bundleSize.test.ts` | CREATE | Bundle size regression |

---

## Known Unknowns

1. **[Component paths]**: Exact paths of the 6 components. Need to check `frontend/src/components/`.
2. **[CSS variable names]**: Exact names of design token variables. Need to check `frontend/src/assets/css/`.
3. **[Bundle size baseline]**: What is the acceptable bundle size threshold? Need to determine.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [x] VButton renders with correct class for each variant (primary, secondary, danger, ghost, link)
2. [x] VButton renders with correct class for each size (sm, md, lg)
3. [x] VButton shows loading spinner when `loading=true`
4. [x] VButton is disabled and non-clickable when `disabled=true`
5. [x] VModal renders overlay with correct opacity
6. [x] VModal animation class is applied (fade in/out)
7. [x] VModal focus trap keeps focus within modal
8. [x] VModal renders default slot content
9. [x] VCard renders with correct padding class for each variant
10. [x] VBadge renders with correct color class for each variant
11. [x] VTable sorts columns when header clicked
12. [x] VTable shows empty state when no data
13. [x] VTable shows loading state when loading=true
14. [x] VFormGroup renders label text correctly
15. [x] VFormGroup renders error text with error styling
16. [x] VFormGroup renders help text below input
17. [x] CSS design tokens have expected default values
18. [x] Primary color change in CSS variable propagates to all components
19. [x] Bundle size does not exceed baseline by more than 5%
20. [x] `npm test -- --run` passes for frontend
21. [x] `npm run typecheck` passes

---

## Testing Checklist

### Frontend Tests
- [x] `frontend/src/__tests__/VButton.test.js` — EXISTS (9 test cases)
- [x] `frontend/src/__tests__/VModal.test.js` — EXISTS (12 test cases)
- [x] `frontend/src/__tests__/VCard.test.js` — EXISTS (5 test cases)
- [x] `frontend/src/__tests__/VBadge.test.js` — EXISTS (7 test cases)
- [x] `frontend/src/__tests__/VTable.test.js` — CREATED (11 test cases)
- [x] `frontend/src/__tests__/VFormGroup.test.js` — CREATED (11 test cases)
- [x] `frontend/src/__tests__/designTokens.test.ts` — CREATED (41 test cases)
- [x] `frontend/src/__tests__/colorPropagation.test.ts` — CREATED (4 test cases)
- [x] `frontend/src/__tests__/bundleSize.test.ts` — CREATED (2 test cases)

### CI Requirements
- [x] `npm run lint` — no lint errors (from new files)
- [x] `npm run typecheck` — frontend typecheck passes
- [x] `npm run build` — frontend build passes
- [x] `npm test -- --run` — frontend tests pass (395 tests)
- [x] `npm run cypress:component` — component tests pass

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test error states, edge cases
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-56 behavior
- ❌ **Skipping component tests** — design system components need thorough testing

---

*Fill in all sections before starting implementation.*
