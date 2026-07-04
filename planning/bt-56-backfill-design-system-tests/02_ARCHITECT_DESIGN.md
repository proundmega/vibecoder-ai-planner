# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-56 (Design System)

---

## Problem Statement

bp-56 introduced 6 new base components (VButton, VModal, VCard, VBadge, VTable, VFormGroup) and CSS design tokens but added no tests. Without tests, component variants, states, and design token values cannot be verified, leading to visual regressions and inconsistent behavior.

---

## Current State

### Existing Frontend
- 6 base components in `frontend/src/components/` (verify exact paths)
- CSS design tokens in `frontend/src/assets/css/variables.css` or similar
- Existing component test patterns in `frontend/cypress/component/`
- Existing Vitest patterns in `frontend/src/__tests__/`

### Gap Analysis
- **No component tests** for any of the 6 base components
- **No tests** for design token CSS variable values
- **No tests** for visual regression (screenshot comparison is manual only)
- **No tests** for VButton variants, sizes, loading, disabled states
- **No tests** for VModal overlay, animation, focus trap, slots
- **No tests** for VCard padding, VBadge colors, VTable states
- **No tests** for VFormGroup label/error/help text
- **No tests** for primary color propagation
- **No bundle size regression test**

---

## Design

### Test Architecture

All component tests use **Cypress component testing** (matching existing patterns in `frontend/cypress/component/`).
CSS variable tests use **Vitest** with the DOM (jsdom).
Bundle size test uses **rollup-plugin-visualizer** or manual `npm run build` output analysis.

#### Component Test Pattern

```typescript
// frontend/cypress/component/VButton.spec.ts
describe('VButton', () => {
  it('renders primary variant', () => {
    cy.mount(VButton, { props: { variant: 'primary' } })
    cy.get('button').should('have.class', 'btn-primary')
  })

  it('renders secondary variant', () => {
    cy.mount(VButton, { props: { variant: 'secondary' } })
    cy.get('button').should('have.class', 'btn-secondary')
  })

  // ... more variants, sizes, loading, disabled
})
```

#### CSS Variable Test Pattern

```typescript
// frontend/src/__tests__/designTokens.test.ts
import { describe, it, expect } from 'vitest'

describe('Design tokens', () => {
  it('--color-primary has expected value', () => {
    expect(getCSSVariable('--color-primary')).toBe('#6366f1')
  })

  it('--color-danger has expected value', () => {
    expect(getCSSVariable('--color-danger')).toBe('#ef4444')
  })

  // ... more tokens
})

function getCSSVariable(name: string): string {
  const style = document.createElement('div')
  document.body.appendChild(style)
  const value = getComputedStyle(style).getPropertyValue(name).trim()
  document.body.removeChild(style)
  return value
}
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
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

## Component Test Details

### VButton (`frontend/cypress/component/VButton.spec.ts`)

```typescript
describe('VButton', () => {
  const variants = ['primary', 'secondary', 'danger', 'ghost', 'link']
  const sizes = ['sm', 'md', 'lg']

  variants.forEach(variant => {
    it(`renders ${variant} variant with correct class`, () => {
      cy.mount(VButton, { props: { variant } })
      cy.get('button').should('have.class', `btn-${variant}`)
    })
  })

  sizes.forEach(size => {
    it(`renders ${size} size with correct class`, () => {
      cy.mount(VButton, { props: { size } })
      cy.get('button').should('have.class', `btn-${size}`)
    })
  })

  it('shows loading spinner when loading=true', () => {
    cy.mount(VButton, { props: { loading: true } })
    cy.get('.btn-loading').should('exist')
    cy.get('button').should('be.disabled')
  })

  it('is disabled and non-clickable when disabled=true', () => {
    cy.mount(VButton, { props: { disabled: true } })
    cy.get('button').should('be.disabled')
    cy.get('button').should('not.have.class', 'btn-active')
  })

  it('renders slot content', () => {
    cy.mount(VButton, {
      slots: { default: 'Click me' }
    })
    cy.contains('Click me')
  })
})
```

### VModal (`frontend/cypress/component/VModal.spec.ts`)

```typescript
describe('VModal', () => {
  it('renders overlay with correct opacity', () => {
    cy.mount(VModal, { props: { modelValue: true } })
    cy.get('.modal-overlay').should('exist')
    cy.get('.modal-overlay').should('have.css', 'opacity')
  })

  it('applies animation class', () => {
    cy.mount(VModal, { props: { modelValue: true } })
    cy.get('.modal').should('have.class', 'modal-enter-active')
  })

  it('traps focus within modal', () => {
    cy.mount(VModal, { props: { modelValue: true } })
    cy.get('.modal input').focus()
    cy.get('body').tab() // Tab key
    cy.focused().should('.modal') // Focus stays within modal
  })

  it('renders default slot content', () => {
    cy.mount(VModal, {
      props: { modelValue: true },
      slots: { default: '<p>Modal content</p>' }
    })
    cy.contains('Modal content')
  })

  it('renders title slot', () => {
    cy.mount(VModal, {
      props: { modelValue: true },
      slots: { title: '<h2>Custom Title</h2>' }
    })
    cy.contains('Custom Title')
  })
})
```

### VCard (`frontend/cypress/component/VCard.spec.ts`)

```typescript
describe('VCard', () => {
  const paddings = ['sm', 'md', 'lg', 'none']

  paddings.forEach(padding => {
    it(`renders ${padding} padding variant`, () => {
      cy.mount(VCard, { props: { padding } })
      cy.get('.card').should('have.class', `card-padding-${padding}`)
    })
  })

  it('renders header slot', () => {
    cy.mount(VCard, {
      slots: { header: '<div>Header</div>' }
    })
    cy.contains('Header')
  })

  it('renders body slot', () => {
    cy.mount(VCard, {
      slots: { body: '<div>Body</div>' }
    })
    cy.contains('Body')
  })
})
```

### VBadge (`frontend/cypress/component/VBadge.spec.ts`)

```typescript
describe('VBadge', () => {
  const colors = ['primary', 'success', 'warning', 'danger', 'info']

  colors.forEach(color => {
    it(`renders ${color} color variant`, () => {
      cy.mount(VBadge, { props: { color } })
      cy.get('.badge').should('have.class', `badge-${color}`)
    })
  })

  it('renders text content', () => {
    cy.mount(VBadge, { props: { color: 'primary' }, slots: { default: 'New' } })
    cy.contains('New')
  })
})
```

### VTable (`frontend/cypress/component/VTable.spec.ts`)

```typescript
describe('VTable', () => {
  it('sorts column when header clicked', () => {
    const data = [{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }]
    cy.mount(VTable, {
      props: { columns: [{ key: 'name', label: 'Name', sortable: true }], data }
    })
    cy.get('th').first().click()
    cy.get('td').first().contains('Alice') // sorted
  })

  it('shows empty state when no data', () => {
    cy.mount(VTable, {
      props: { columns: [{ key: 'name', label: 'Name' }], data: [] }
    })
    cy.contains(/No data|empty/i)
  })

  it('shows loading state when loading=true', () => {
    cy.mount(VTable, {
      props: { columns: [{ key: 'name', label: 'Name' }], data: [], loading: true }
    })
    cy.get('.table-loading').should('exist')
  })
})
```

### VFormGroup (`frontend/cypress/component/VFormGroup.spec.ts`)

```typescript
describe('VFormGroup', () => {
  it('renders label text', () => {
    cy.mount(VFormGroup, { props: { label: 'Email' }, slots: { default: '<input>' } })
    cy.contains('Email')
  })

  it('renders error text with error styling', () => {
    cy.mount(VFormGroup, {
      props: { label: 'Email', error: 'Invalid email' },
      slots: { default: '<input>' }
    })
    cy.contains('Invalid email')
    cy.get('.form-error').should('exist')
  })

  it('renders help text below input', () => {
    cy.mount(VFormGroup, {
      props: { label: 'Email', help: 'We will never share your email' },
      slots: { default: '<input>' }
    })
    cy.contains('We will never share your email')
  })
})
```

---

## CSS Variable Test Details

### Design Tokens (`frontend/src/__tests__/designTokens.test.ts`)

```typescript
describe('Design tokens', () => {
  it('--color-primary is defined', () => {
    expect(getCSSVariable('--color-primary')).toMatch(/^#/)
  })

  it('--color-danger is defined', () => {
    expect(getCSSVariable('--color-danger')).toMatch(/^#/)
  })

  it('--color-success is defined', () => {
    expect(getCSSVariable('--color-success')).toMatch(/^#/)
  })

  it('--spacing-sm is defined', () => {
    expect(getCSSVariable('--spacing-sm')).toMatch(/^\d+px$/)
  })

  it('--border-radius-md is defined', () => {
    expect(getCSSVariable('--border-radius-md')).toMatch(/^\d+px$/)
  })

  it('--font-size-base is defined', () => {
    expect(getCSSVariable('--font-size-base')).toMatch(/^\d+px$/)
  })
})
```

### Color Propagation (`frontend/src/__tests__/colorPropagation.test.ts`)

```typescript
describe('Primary color propagation', () => {
  it('changing --color-primary updates VButton', () => {
    // Set CSS variable to new value
    // Query VButton computed style
    // Assert VButton uses new color
  })

  it('changing --color-primary updates VBadge', () => { ... })
  it('changing --color-primary updates VModal', () => { ... })
})
```

### Bundle Size (`frontend/src/__tests__/bundleSize.test.ts`)

```typescript
describe('Bundle size regression', () => {
  const MAX_BUNDLE_SIZE = 500000 // 500KB — adjust based on baseline

  it('frontend build output does not exceed baseline', () => {
    // Read dist/ output size
    // Assert total size < MAX_BUNDLE_SIZE
  })
})
```

---

## Dependencies

### Frontend Dependencies
- 6 base components — paths to verify in `frontend/src/components/`
- CSS design tokens — paths to verify in `frontend/src/assets/css/`
- Cypress component testing setup — `frontend/cypress/component/`
- Vitest setup — `frontend/src/__tests__/`

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Component | Cypress | `frontend/cypress/component/*.spec.ts` | Variant rendering, state behavior, slot rendering |
| CSS variables | Vitest | `frontend/src/__tests__/designTokens.test.ts` | Token values, propagation |
| Bundle size | Vitest | `frontend/src/__tests__/bundleSize.test.ts` | Size regression |

---

## Risks and Edge Cases

### Frontend Risks
- **[Cypress mount context]**: Components may depend on Pinia store or router. Mitigation: provide mock stores via `mount()` options.
- **[CSS variable timing]**: Variables may not be loaded when test runs. Mitigation: import CSS in test setup.
- **[Bundle size baseline]**: Baseline may change with dependencies. Mitigation: make threshold configurable.

### Edge Cases
- **[VModal focus trap]**: Focus trap may not work in jsdom. Mitigation: test in actual browser (Cypress).
- **[VTable sorting]**: Sorting may be async. Mitigation: use `cy.wait()` or `cy.intercept()`.

---

## Alternative Designs Considered

### Alternative 1: Vitest for all component tests
- **Pros**: Faster, no browser needed
- **Cons**: Cannot test CSS classes, focus trap, animations accurately
- **Decision**: Cypress for component tests (matches existing patterns)

### Alternative 2: Visual regression with screenshot comparison
- **Pros**: Catches visual regressions automatically
- **Cons**: Requires screenshot baseline maintenance, flaky on CI
- **Decision**: Screenshot comparison is manual only (per ticket scope)

---

*This design document guides implementation.*
