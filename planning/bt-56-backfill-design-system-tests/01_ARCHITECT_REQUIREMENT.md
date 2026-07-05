# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
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

1. [ ] VButton renders with correct class for each variant (primary, secondary, danger, ghost, link)
2. [ ] VButton renders with correct class for each size (sm, md, lg)
3. [ ] VButton shows loading spinner when `loading=true`
4. [ ] VButton is disabled and non-clickable when `disabled=true`
5. [ ] VModal renders overlay with correct opacity
6. [ ] VModal animation class is applied (fade in/out)
7. [ ] VModal focus trap keeps focus within modal
8. [ ] VModal renders default slot content
9. [ ] VCard renders with correct padding class for each variant
10. [ ] VBadge renders with correct color class for each variant
11. [ ] VTable sorts columns when header clicked
12. [ ] VTable shows empty state when no data
13. [ ] VTable shows loading state when loading=true
14. [ ] VFormGroup renders label text correctly
15. [ ] VFormGroup renders error text with error styling
16. [ ] VFormGroup renders help text below input
17. [ ] CSS design tokens have expected default values
18. [ ] Primary color change in CSS variable propagates to all components
19. [ ] Bundle size does not exceed baseline by more than 5%
20. [ ] `npm test -- --run` passes for frontend
21. [ ] `npm run typecheck` passes

---

## Testing Checklist

### Frontend Tests
- [ ] `frontend/cypress/component/VButton.spec.ts` — CREATED (8+ test cases)
- [ ] `frontend/cypress/component/VModal.spec.ts` — CREATED (5+ test cases)
- [ ] `frontend/cypress/component/VCard.spec.ts` — CREATED (3+ test cases)
- [ ] `frontend/cypress/component/VBadge.spec.ts` — CREATED (3+ test cases)
- [ ] `frontend/cypress/component/VTable.spec.ts` — CREATED (5+ test cases)
- [ ] `frontend/cypress/component/VFormGroup.spec.ts` — CREATED (5+ test cases)
- [ ] `frontend/src/__tests__/designTokens.test.ts` — CREATED (6+ test cases)
- [ ] `frontend/src/__tests__/colorPropagation.test.ts` — CREATED (3+ test cases)
- [ ] `frontend/src/__tests__/bundleSize.test.ts` — CREATED (1+ test cases)

### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run` — frontend tests pass
- [ ] `npm run cypress:component` — component tests pass

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test error states, edge cases
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-56 behavior
- ❌ **Skipping component tests** — design system components need thorough testing

---

*Fill in all sections before starting implementation.*
