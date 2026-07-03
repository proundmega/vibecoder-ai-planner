# 03_ARCHITECT_IMPLEMENTATION.md — Shared CSS and Component Design System

**Status**: planned
**Priority**: P2
**Effort**: Large
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Create a shared CSS design system and reusable base components to eliminate the massive CSS duplication (~20+ files redefining identical `.btn-primary`, `.modal`, `.badge` styles) and provide a single source of truth for colors, spacing, and typography.

---

### b) Actions

#### Implementation Order

**Phase 1: Foundation (no visual change)**

1. **Create design tokens CSS** — `frontend/src/styles/design-tokens.css`
   - CSS custom properties for all colors, spacing, typography, border-radius, shadows
   - Extract values from existing component CSS (collect all unique values, standardize)
   - *Depends on*: nothing

2. **Create base CSS** — `frontend/src/styles/base.css`
   - Global reset (box-sizing, margin reset)
   - Body typography (font-family, font-size, line-height, color)
   - Utility classes (`.text-center`, `.flex`, `.gap-*`)
   - *Depends on*: nothing

3. **Register global CSS** — `frontend/src/main.ts`, `frontend/src/App.vue`
   - Import `design-tokens.css` and `base.css` in `main.ts`
   - Remove any duplicated global styles from `App.vue` `<style>`
   - *Depends on*: Step 1, Step 2

**Phase 2: Base Components (no visual change)**

4. **Create `VButton.vue`** — `frontend/src/components/VButton.vue`
   - `variant` prop: `'primary' | 'secondary' | 'danger' | 'ghost' | 'link'`
   - `size` prop: `'small' | 'medium' | 'large'`
   - `loading` prop: show spinner, disable click
   - `disabled` prop
   - `fullWidth` prop
   - Use `design-tokens.css` variables for all values
   - *Depends on*: nothing

5. **Create `VModal.vue`** — `frontend/src/components/VModal.vue`
   - `v-model` for visibility
   - `title` prop, `size` prop (`'medium' | 'large' | 'fullscreen'`)
   - Slots: `#header`, `#body` (default), `#footer`
   - Close on overlay click (configurable), close on Escape key
   - Focus trap implementation (tab cycling within modal)
   - Body scroll lock when open
   - *Depends on*: Step 4 (for footer buttons)

6. **Create `VCard.vue`** — `frontend/src/components/VCard.vue`
   - Slots: `#header`, `default` (body), `#footer`
   - `padding` prop: `'none' | 'small' | 'medium' | 'large'`
   - `hover` prop: add hover shadow effect
   - *Depends on*: nothing

7. **Create `VBadge.vue`** — `frontend/src/components/VBadge.vue`
   - `variant` prop: `'default' | 'success' | 'warning' | 'danger' | 'info'`
   - `size` prop: `'small' | 'medium'`
   - *Depends on*: nothing

8. **Create `VTable.vue`** — `frontend/src/components/VTable.vue`
   - `columns` prop: array of `{ key, label, sortable, width }`
   - `rows` prop: array of data objects
   - `loading` prop: show skeleton rows
   - `sortable` prop: emit `@sort` event with column key + direction
   - `emptyMessage` prop: shown when no rows
   - Slot: `#cell="{ column, row }"` for custom cell rendering
   - *Depends on*: Step 4 (for sort buttons)

9. **Create `VFormGroup.vue`** — `frontend/src/components/VFormGroup.vue`
   - `label` prop
   - `error` prop: shown as red text below input
   - `helpText` prop: subtle hint text
   - `required` prop: add asterisk to label
   - Slots: `default` (for input/select), `#label` (custom label)
   - *Depends on*: nothing

**Phase 3: Migration (incremental, view by view)**

Migrate views in order of complexity:

10. **Migrate `Login.vue` + `Register.vue`** — simplest views, minimal CSS
    - Replace `<button class="btn-primary">` → `<v-button variant="primary">`
    - Replace `<div class="form-group">` → `<v-form-group>`
    - Replace CSS variables with token references
    - Remove no-longer-needed scoped CSS
    - *Depends on*: Phase 2

11. **Migrate `Dashboard.vue`, `ProjectList.vue`, `AgentList.vue`** — medium views
    - Replace buttons, badges, cards with base components
    - *Depends on*: Phase 2

12. **Migrate `TicketBoard.vue`, `BillingDashboard.vue`, `UserManagement.vue`** — medium complexity
    - Replace buttons, tables, badges, modals with base components
    - *Depends on*: Phase 2

13. **Migrate `ProjectDetail.vue`** — most complex view (~1518 lines)
    - Replace repeated tab styles with design tokens
    - Replace all buttons, modals, badges with base components
    - Remove duplicated CSS (7+ feature areas each with their own styles)
    - *Depends on*: Phase 2

14. **Migrate `TicketDetail.vue`** — second most complex view (~1196 lines)
    - Replace buttons, modals, badges, form groups
    - *Depends on*: Phase 2

15. **Migrate remaining views** — `AIAssistant.vue`, `ApprovalsQueue.vue`, `AgentDetail.vue`, `ProjectMilestones.vue`, and all components
    - *Depends on*: Phase 2

**Phase 4: Cleanup**

16. **Remove dead CSS** — verify no unused CSS classes remain
    - Run a coverage check or visual review
    - *Depends on*: Phase 3

---

### c) Per-File Action Plan

#### `frontend/src/styles/design-tokens.css` (CREATE)
```css
:root {
  /* Colors */
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-primary-light: #dbeafe;
  --color-danger: #ef4444;
  --color-danger-hover: #dc2626;
  --color-danger-light: #fee2e2;
  --color-success: #10b981;
  --color-success-hover: #059669;
  --color-success-light: #d1fae5;
  --color-warning: #f59e0b;
  --color-warning-hover: #d97706;
  --color-warning-light: #fef3c7;
  --color-info: #3b82f6;
  --color-info-hover: #2563eb;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-bg: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-bg-tertiary: #f3f4f6;
  --color-border: #e5e7eb;
  --color-border-light: #f3f4f6;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;

  /* Typography */
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-size-xs: 11px;
  --font-size-sm: 12px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;
  --line-height: 1.5;

  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
}
```

#### `frontend/src/components/VButton.vue` (CREATE)
- Template: `<button :class="classes" :disabled="disabled || loading" @click="$emit('click', $event)">`
- Computed classes: `btn-${variant} btn-${size}`, `btn-loading`, `btn-full-width`
- Scoped CSS uses `var(--color-*)` for all values
- Loading state: show `<span class="spinner">` + hide text
- Emits: `click`

#### `frontend/src/components/VModal.vue` (CREATE)
- Template: `<Teleport to="body"><div v-if="modelValue" class="modal-overlay" @click.self="close"><div class="modal">...`
- `watch` on `modelValue`: add/remove body scroll lock
- `onMounted`/`onUnmounted`: keyboard listener for Escape
- Focus trap: `onMounted` save last focused element, restore on close

#### Migration pattern per view file:
```diff
- <button class="btn-primary" @click="save">Save</button>
+ <v-button variant="primary" @click="save">Save</v-button>
```

```diff
- <div class="modal-overlay" v-if="showModal">
-   <div class="modal">
-     <div class="modal-header"><h2>Title</h2></div>
-     <div class="modal-body">Content</div>
-     <div class="modal-actions">
-       <button class="btn-primary" @click="save">Save</button>
-       <button class="btn-cancel" @click="showModal=false">Cancel</button>
-     </div>
-   </div>
- </div>
+ <v-modal v-model="showModal" title="Title">
+   Content
+   <template #footer>
+     <v-button variant="primary" @click="save">Save</v-button>
+     <v-button variant="secondary" @click="showModal=false">Cancel</v-button>
+   </template>
+ </v-modal>
```

---

### d) Dependencies

- No new npm dependencies
- All base components are self-contained

---

### e) Risks/Edge Cases

- **[Visual regression]**: After migration, views must appear identical. The primary risk is inconsistent color values (some views may have used slightly different blues/greys). Fix: Standardize all values in design tokens, then verify each view.
- **[Accessibility regression]**: Focus trap in VModal requires careful implementation. Use `aria-*` attributes and keyboard navigation. Tab cycling must not escape the modal.
- **[Scoped CSS override]**: If a view needs to customize a base component, use CSS custom properties or component CSS parts (`::part()`). Avoid `!important`.

---

### f) Testing

#### Unit Tests
- [ ] `VButton`: render variants, sizes, loading state, disabled state, click event
- [ ] `VModal`: open/close, overlay click, escape key, focus trap, body scroll lock
- [ ] `VCard`: render slots, padding variants
- [ ] `VBadge`: render variants, sizes
- [ ] `VTable`: render columns, rows, loading skeleton, empty message, sort event
- [ ] `VFormGroup`: render label, error, help text, slot content

#### Component Tests (Cypress)
- [ ] `VModal`: visual appearance open/close
- [ ] `VButton`: hover states, active states

#### Visual Regression
- [ ] Manual spot-check: 5 key views (Login, Dashboard, ProjectDetail, TicketDetail, UserManagement) look identical before/after

---

### g) Migration Notes

No database migrations. No backend changes. This is purely a frontend refactoring.

---

### h) Files Changed

**Created:**
```
frontend/src/styles/design-tokens.css   → CREATE (design system tokens)
frontend/src/styles/base.css            → CREATE (global reset + utilities)
frontend/src/components/VButton.vue     → CREATE (button component)
frontend/src/components/VModal.vue      → CREATE (modal component)
frontend/src/components/VCard.vue       → CREATE (card component)
frontend/src/components/VBadge.vue      → CREATE (badge component)
frontend/src/components/VTable.vue      → CREATE (table component)
frontend/src/components/VFormGroup.vue  → CREATE (form group component)
```

**Modified:**
```
frontend/src/main.ts                    → MODIFY (import global CSS)
frontend/src/App.vue                    → MODIFY (remove duplicated global styles)
frontend/src/views/Login.vue            → MODIFY (use base components)
frontend/src/views/Register.vue         → MODIFY (use base components)
frontend/src/views/Dashboard.vue        → MODIFY (use base components)
frontend/src/views/ProjectDetail.vue    → MODIFY (use base components)
frontend/src/views/TicketDetail.vue     → MODIFY (use base components)
frontend/src/views/TicketBoard.vue      → MODIFY (use base components)
frontend/src/views/ProjectList.vue      → MODIFY (use base components)
frontend/src/views/BillingDashboard.vue → MODIFY (use base components)
frontend/src/views/AIAssistant.vue      → MODIFY (use base components)
frontend/src/views/ApprovalsQueue.vue   → MODIFY (use base components)
frontend/src/views/AgentDetail.vue      → MODIFY (use base components)
frontend/src/views/AgentList.vue        → MODIFY (use base components)
frontend/src/views/UserManagement.vue   → MODIFY (use base components)
frontend/src/views/ProjectMilestones.vue → MODIFY (use base components)
frontend/src/components/TicketEditModal.vue → MODIFY (use base components)
frontend/src/components/UserModal.vue   → MODIFY (use base components)
frontend/src/components/DiffViewer.vue  → MODIFY (use design tokens)
```

---

### i) Code Review Checklist

- [ ] Design tokens cover all colors, spacing, typography currently used
- [ ] Base components support all variants currently used (no regression)
- [ ] Each view migration preserves exact visual appearance
- [ ] No `!important` used (except for utility overrides where necessary)
- [ ] VModal has proper focus trap and Escape key handling
- [ ] VButton loading state prevents double-clicks
- [ ] No new dependencies added
- [ ] `npm test -- --run` passes
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes

---

### j) Post-Deploy Verification

1. [ ] `npm test -- --run` — passes
2. [ ] `npm run build` — builds successfully
3. [ ] `npm run lint` — no lint errors
4. [ ] `npm run typecheck` — no TS errors
5. [ ] Login page renders identically (buttons, form inputs)
6. [ ] Dashboard renders identically (cards, badges, buttons)
7. [ ] ProjectDetail renders identically (tabs, modals, buttons)
8. [ ] TicketDetail renders identically (badges, buttons, modals)
9. [ ] UserManagement renders identically (table, buttons, modals)
10. [ ] Change `--color-primary` in `design-tokens.css` → all primary buttons update
