# 01_ARCHITECT_REQUIREMENT.md — Shared CSS and Component Design System

**Status**: completed
**Date created**: {{YYYY-MM-DD}}
**Date completed**: 2026-07-07
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P2
**Effort**: Large

---

## Requirement

Create a shared CSS design system and reusable component library to eliminate massive CSS duplication across the frontend. Currently, every view and component redefines identical styles (`.btn-primary`, `.btn-danger`, `.btn-small`, `.modal-overlay`, `.modal`, `.modal-actions`, `.panel`, `.card`, `.badge`, etc.) with nearly identical values — changing the primary blue color would require editing ~20+ files.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists.

### Frontend UI Check
- [x] View components exist: `frontend/src/views/` — 15+ views, each with duplicated CSS
- [x] Components exist: `frontend/src/components/` — `TicketEditModal.vue`, `UserModal.vue`, `DiffViewer.vue`, etc.
- [x] App.vue exists: `frontend/src/App.vue` — minimal global styles
- [x] No CSS framework in use — all styles are hand-written scoped CSS per component
- [x] CSS patterns repeated: button styles (`.btn-primary`, `.btn-danger`, `.btn-small`, `.btn-cancel`), modal styles (`.modal-overlay`, `.modal`, `.modal-header`, `.modal-body`, `.modal-actions`), card styles, form styles, badge styles, tab styles, table styles
- [x] Design system components created: `VButton.vue`, `VModal.vue`, `VCard.vue`, `VBadge.vue`, `VInput.vue`, `VEmptyState.vue`, `VTable.vue`, `VFormGroup.vue`
- [x] Design tokens: `frontend/src/styles/design-tokens.css`
- [x] Base CSS: `frontend/src/styles/base.css`

### Key Insight
This is FRONTEND-ONLY. No backend changes. The approach should be:
1. Extract shared CSS variables to a design tokens file
2. Create reusable base components (VBaseButton, VBaseModal, VBaseCard, etc.)
3. Gradually replace inline scoped styles with base component usage

---

## Scope

### In Scope
- Create `frontend/src/styles/design-tokens.css` with CSS custom properties for colors, spacing, typography, border radius, shadows, and breakpoints
- Create `frontend/src/styles/base.css` with global reset, typography, and utility classes
- Create shared base components:
  - `VButton.vue` — primary, secondary, danger, ghost variants + sizes (small, medium, large) + loading state + disabled state
  - `VModal.vue` — overlay, header, body, footer slots; close button; animation; trap focus
  - `VCard.vue` — header, body, footer slots; padding variants; hover state
  - `VBadge.vue` — color variants (info, success, warning, danger); size variants
  - `VTable.vue` — sortable columns, loading skeleton, empty state, striped rows
  - `VFormGroup.vue` — label, input, error message, help text
- Migrate all views to use base components and design tokens
- Remove duplicated CSS from view and component files

### Out of Scope
- Adding a CSS framework (Tailwind, Bootstrap, etc.) — the existing hand-written styles are fine, they just need deduplication
- Rewriting all views — only updating CSS and component usage, not restructuring templates
- Backend changes
- Database changes
- Adding new visual features or animations not already present

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/styles/design-tokens.css` | CREATE | CSS custom properties for design system |
| `frontend/src/styles/base.css` | CREATE | Global reset, typography, utility classes |
| `frontend/src/components/VButton.vue` | CREATE | Reusable button component |
| `frontend/src/components/VModal.vue` | CREATE | Reusable modal component |
| `frontend/src/components/VCard.vue` | CREATE | Reusable card component |
| `frontend/src/components/VBadge.vue` | CREATE | Reusable badge component |
| `frontend/src/components/VTable.vue` | CREATE | Reusable table component |
| `frontend/src/components/VFormGroup.vue` | CREATE | Reusable form group component |
| `frontend/src/App.vue` | MODIFY | Import design tokens and base CSS |
| `frontend/src/views/*.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/components/*.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/main.ts` | MODIFY | Import global CSS |
| `database` | NONE | No DB changes |
| `config` | NONE | No env var changes |

---

## Known Unknowns

1. **[Color palette]**: What are the exact colors used across the app? Need to extract from existing CSS and standardize. Will collect all unique color values and create a cohesive palette.
2. **[Component variant coverage]**: Are all existing button/modal/card variants captured by the base components? Need to audit all views.
3. **[Scoped CSS compatibility]**: Removing scoped styles and replacing with shared classes may cause style conflicts. The base components use scoped styles internally, so this should be safe.

---

## Important Design Decisions

1. **CSS custom properties vs CSS-in-JS vs CSS modules**: Use CSS custom properties (variables) for design tokens. They're natively supported, don't require a build step, and can be overridden per-component or per-theme. No additional dependencies needed.
2. **Base component naming**: Use `V` prefix (Vue convention) for all design system components: `VButton`, `VModal`, `VCard`, `VBadge`, `VTable`, `VFormGroup`.
3. **CSS architecture**: `design-tokens.css` (variables only) → `base.css` (global styles) → component scoped styles. No CSS preprocessor needed — native CSS with custom properties is sufficient.
4. **Scope of migration**: Not all views need to be rewritten at once. The design system is created first, then views are migrated incrementally. High-traffic views (Login, Dashboard, ProjectDetail, TicketDetail) should be migrated first.

---

## Acceptance Criteria

1. [ ] `design-tokens.css` defines all colors, spacing, typography, and border-radius as CSS custom properties
2. [ ] Base components (`VButton`, `VModal`, `VCard`, `VBadge`, `VTable`, `VFormGroup`) exist and are documented
3. [ ] Each base component supports all variants currently used across the app
4. [ ] All 20+ files with duplicated CSS now import from design tokens or use base components
5. [ ] Primary color change in `design-tokens.css` propagates to all views (tested)
6. [ ] All existing tests pass
7. [ ] Visual appearance is unchanged (verified by manual comparison of screenshots or key views)
8. [ ] Bundle size does not increase significantly (base components should be tree-shaken if unused)

---

## Out of Scope

- Adding a CSS framework (Tailwind, Bootstrap)
- Rewriting view templates (only updating CSS usage)
- Backend changes
- Adding animations or features not currently present
- Dark mode or theming (future work)

---

## Performance Considerations

- CSS custom properties are resolved at runtime — no performance impact
- Base components are lightweight with minimal DOM overhead
- Tree-shaking via Vite will eliminate unused components from production build
- No new npm dependencies

---

## Security Considerations

- [x] No authentication or authorization changes
- [x] No new API endpoints
- [x] No sensitive data handling changes
