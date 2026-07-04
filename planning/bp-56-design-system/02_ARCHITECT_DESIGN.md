# 02_ARCHITECT_DESIGN.md — Shared CSS and Component Design System

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Every Vue component and view independently defines identical CSS classes with near-identical values. There is no single source of truth for colors, spacing, or typography. Changing a design element (e.g., primary button blue `#3b82f6`) requires editing 20+ files. New components must guess the correct values by inspecting existing components.

---

## Current State

### Duplication Examples (representative)

| CSS Class | Defined In | Values |
|-----------|-----------|--------|
| `.btn-primary` | `Login.vue`, `Dashboard.vue`, `ProjectDetail.vue`, `TicketDetail.vue`, `UserManagement.vue`, `TicketBoard.vue`, `BillingDashboard.vue`, `AIAssistant.vue`, `ApprovalsQueue.vue`, `AgentDetail.vue`, `AgentList.vue`, `ProjectList.vue`, `ProjectMilestones.vue`, `TicketEditModal.vue`, `UserModal.vue` | `background: #3b82f6`, `color: white`, `border: none`, `padding: 8px 16px`, `border-radius: 6px`, etc. |
| `.btn-danger` | 10+ files | `background: #ef4444` |
| `.btn-small` | 8+ files | `padding: 4px 8px`, `font-size: 12px` |
| `.modal-overlay` | 6+ files | `position: fixed`, `inset: 0`, `background: rgba(0,0,0,0.5)` |
| `.modal` | 6+ files | `background: white`, `border-radius: 8px`, `padding: 24px`, `max-width: 500px` |
| `.badge` | 5+ files | `display: inline-block`, `padding: 2px 8px`, `border-radius: 12px`, `font-size: 12px` |
| `.panel` | 5+ files | `background: white`, `border-radius: 8px`, `padding: 16px`, `box-shadow` |
| Status colors | 10+ files | `#10b981` (success), `#f59e0b` (warning), `#ef4444` (danger), `#3b82f6` (info) |

### CSS Architecture Today

```
App.vue (global: body font, reset)
├── Login.vue (scoped: .btn-primary, .btn-cancel, .form-group, .form-input, etc.)
├── Register.vue (scoped: .btn-primary, .form-group, .form-input, etc.)
├── Dashboard.vue (scoped: .btn-primary, .card, .badge, .panel, etc.)
├── ProjectDetail.vue (scoped: .btn-primary, .btn-danger, .btn-small, .modal, .tab, etc.)
├── TicketDetail.vue (scoped: .btn-primary, .btn-danger, .btn-small, .modal, .badge, etc.)
├── ProjectList.vue (scoped: .btn-primary, .btn-small, .modal, .card, etc.)
└── ... (every view duplicates styles)
```

### Color Values (collected from existing CSS)

| Name | Current Value | Usage Count |
|------|--------------|-------------|
| Primary blue | `#3b82f6` or `#2563eb` | ~15 files |
| Danger red | `#ef4444` or `#dc2626` | ~12 files |
| Success green | `#10b981` or `#059669` | ~8 files |
| Warning amber | `#f59e0b` or `#d97706` | ~6 files |
| Gray text | `#374151`, `#4b5563`, `#6b7280` | ~20 files |
| Gray bg | `#f9fafb`, `#f3f4f6`, `#e5e7eb` | ~15 files |
| White | `#ffffff` | everywhere |
| Border | `#e5e7eb` or `#d1d5db` | ~10 files |

---

## Design

### Option A: CSS Custom Properties + Base Components (Recommended)

#### Architecture

```
frontend/src/styles/
  design-tokens.css    → CSS custom properties (--color-primary, --spacing-md, etc.)
  base.css             → Global reset, typography, .container, .text-center, etc.

frontend/src/components/
  VButton.vue          → <v-button variant="primary" size="small" :loading="true">
  VModal.vue           → <v-modal v-model="show"> <template #header>...</template> </v-modal>
  VCard.vue            → <v-card variant="elevated"> <template #header>...</template> </v-card>
  VBadge.vue           → <v-badge variant="success">Active</v-badge>
  VTable.vue           → <v-table :columns="..." :rows="..." :loading="..." @sort="...">
  VFormGroup.vue       → <v-form-group label="Email" :error="emailError"> <input ...> </v-form-group>
```

#### Design Tokens

```css
/* frontend/src/styles/design-tokens.css */
:root {
  /* Colors */
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-danger: #ef4444;
  --color-danger-hover: #dc2626;
  --color-success: #10b981;
  --color-success-hover: #059669;
  --color-warning: #f59e0b;
  --color-warning-hover: #d97706;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-bg: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-border: #e5e7eb;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;

  /* Typography */
  --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-size-sm: 12px;
  --font-size-base: 14px;
  --font-size-lg: 16px;
  --font-size-xl: 20px;
  --font-size-2xl: 24px;

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

#### VButton Component API

```vue
<v-button
  variant="primary | secondary | danger | ghost | link"
  size="small | medium | large"
  :loading="false"
  :disabled="false"
  :full-width="false"
  @click="handler"
>
  <template #icon>..</template>
  Click me
</v-button>
```

#### VModal Component API

```vue
<v-modal v-model="isOpen" :title="'Edit Ticket'" :size="'medium | large | fullscreen'" :close-on-overlay="true">
  <template #header>
    <h2>Custom header</h2>
  </template>
  <template #body>
    Modal content
  </template>
  <template #footer>
    <v-button variant="primary" @click="save">Save</v-button>
    <v-button variant="secondary" @click="isOpen = false">Cancel</v-button>
  </template>
</v-modal>
```

#### Migration Strategy

1. Create design tokens and base CSS (no visual change)
2. Create base components (no visual change — they replicate existing styles)
3. Migrate views one at a time, starting with `Login.vue` (simplest) and ending with `ProjectDetail.vue` and `TicketDetail.vue` (most complex)
4. Each migration: replace `<button class="btn-primary">` with `<v-button variant="primary">`, remove duplicate `scoped` CSS for those elements

### Option B: Tailwind CSS

- **Pros**: Utility-first, smaller CSS in production, great developer experience
- **Cons**: Requires build tooling config, changes all existing templates significantly, team needs to learn it
- **Decision**: Too invasive. The current CSS is clean, just duplicated. Deduplication via CSS variables + base components is simpler and doesn't require a framework migration.

### Option C: CSS Preprocessor (SCSS)

- **Pros**: Variables, mixins, nesting — eliminates duplication more elegantly
- **Cons**: Requires `sass` dependency, build config, and learning curve
- **Decision**: CSS custom properties are sufficient and don't need a build step. SCSS would add a dependency for marginal benefit over native CSS.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/styles/design-tokens.css` | CREATE | CSS custom properties for full design system |
| `frontend/src/styles/base.css` | CREATE | Global reset, typography, utility classes |
| `frontend/src/components/VButton.vue` | CREATE | Reusable button with variants, sizes, loading, disabled |
| `frontend/src/components/VModal.vue` | CREATE | Reusable modal with slots, animation, overlay, trap focus |
| `frontend/src/components/VCard.vue` | CREATE | Reusable card with slots, padding variants |
| `frontend/src/components/VBadge.vue` | CREATE | Reusable badge with color/size variants |
| `frontend/src/components/VTable.vue` | CREATE | Reusable table with sort, loading, empty state |
| `frontend/src/components/VFormGroup.vue` | CREATE | Reusable form group with label, error, help text |
| `frontend/src/App.vue` | MODIFY | Import design-tokens.css and base.css |
| `frontend/src/main.ts` | MODIFY | Import global CSS |
| `frontend/src/views/Login.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/Register.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/Dashboard.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/TicketDetail.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/TicketBoard.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/ProjectList.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/BillingDashboard.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/AIAssistant.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/ApprovalsQueue.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/AgentDetail.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/AgentList.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/UserManagement.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/views/ProjectMilestones.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/components/TicketEditModal.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/components/UserModal.vue` | MODIFY | Replace inline CSS with base components |
| `frontend/src/components/DiffViewer.vue` | MODIFY | Replace inline CSS with base components |

---

## Dependencies

- No new npm dependencies
- No build tool changes

---

## Config / Environment Changes

- No changes

---

## Security Considerations

- No security impact — CSS and component changes only
- Ensure `v-html` is not used in base components to avoid XSS

---

## Risks and Edge Cases

- **[Visual regression]**: The CSS variables may produce slightly different rendering than hardcoded values (e.g., two different blues used interchangeably). Compare screenshots before/after for key views.
- **[Scoped CSS conflicts]**: Base component styles are scoped and will not conflict with view styles. View CSS that remains will be scoped as before.
- **[VModal focus trap]**: Need to implement `focus-trap` behavior for accessibility. Can use native `inert` attribute or a lightweight implementation.

---

## Alternative Designs Considered

### Alternative 1: CSS-in-JS (styled-components, emotion)
- **Pros**: Scoped by default, dynamic styling
- **Cons**: Runtime overhead, adds dependencies, not Vue-idiomatic
- **Decision**: Vue has built-in scoped CSS — no need for CSS-in-JS.

### Alternative 2: Keep everything as-is
- **Pros**: No risk of visual changes
- **Cons**: Duplication continues; design changes remain expensive; new components replicate the problem
- **Decision**: The duplication is unsustainable. The design system is a necessary investment.
