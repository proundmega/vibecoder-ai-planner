# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bt-56 — Backfill Design System Tests

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend

**Dependencies**: bp-56 (Design System) must be completed first

---

### a) Purpose

Backfill all missing test coverage for bp-56's design system changes. bp-56 introduced 6 base components and CSS design tokens but added no tests. Without tests, component variants, states, and design token values cannot be verified.

---

### b) Actions

**CRITICAL**: This is a test-only ticket. Do NOT modify any production code.

#### Implementation Order

1. **VButton component test** — `frontend/cypress/component/VButton.spec.ts`
   - Test variants (primary, secondary, danger, ghost, link)
   - Test sizes (sm, md, lg)
   - Test loading and disabled states
   - *Depends on*: nothing

2. **VModal component test** — `frontend/cypress/component/VModal.spec.ts`
   - Test overlay, animation, focus trap, slots
   - *Depends on*: nothing

3. **VCard component test** — `frontend/cypress/component/VCard.spec.ts`
   - Test padding variants, header/body slots
   - *Depends on*: nothing

4. **VBadge component test** — `frontend/cypress/component/VBadge.spec.ts`
   - Test color variants, text content
   - *Depends on*: nothing

5. **VTable component test** — `frontend/cypress/component/VTable.spec.ts`
   - Test sorting, empty state, loading state
   - *Depends on*: nothing

6. **VFormGroup component test** — `frontend/cypress/component/VFormGroup.spec.ts`
   - Test label, error, help text rendering
   - *Depends on*: nothing

7. **Design tokens test** — `frontend/src/__tests__/designTokens.test.ts`
   - Test CSS variable values
   - *Depends on*: nothing

8. **Color propagation test** — `frontend/src/__tests__/colorPropagation.test.ts`
   - Test primary color change propagation
   - *Depends on*: nothing

9. **Bundle size test** — `frontend/src/__tests__/bundleSize.test.ts`
   - Test bundle size regression
   - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `frontend/cypress/component/VButton.spec.ts` (CREATE)

```typescript
import VButton from '@/components/VButton.vue'

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
  })

  it('renders slot content', () => {
    cy.mount(VButton, {
      slots: { default: 'Click me' }
    })
    cy.contains('Click me')
  })
})
```

#### `frontend/cypress/component/VModal.spec.ts` (CREATE)

```typescript
import VModal from '@/components/VModal.vue'

describe('VModal', () => {
  it('renders overlay with correct opacity', () => {
    cy.mount(VModal, { props: { modelValue: true } })
    cy.get('.modal-overlay').should('exist')
  })

  it('applies animation class', () => {
    cy.mount(VModal, { props: { modelValue: true } })
    cy.get('.modal').should('have.class', 'modal-enter-active')
  })

  it('traps focus within modal', () => {
    cy.mount(VModal, {
      props: { modelValue: true },
      slots: { default: '<input type="text" />' }
    })
    cy.get('.modal input').focus()
    cy.focused().should('.modal')
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

#### `frontend/cypress/component/VCard.spec.ts` (CREATE)

```typescript
import VCard from '@/components/VCard.vue'

describe('VCard', () => {
  const paddings = ['sm', 'md', 'lg', 'none']

  paddings.forEach(padding => {
    it(`renders ${padding} padding variant`, () => {
      cy.mount(VCard, { props: { padding } })
      cy.get('.card').should('have.class', `card-padding-${padding}`)
    })
  })

  it('renders header slot', () => {
    cy.mount(VCard, { slots: { header: '<div>Header</div>' } })
    cy.contains('Header')
  })

  it('renders body slot', () => {
    cy.mount(VCard, { slots: { body: '<div>Body</div>' } })
    cy.contains('Body')
  })
})
```

#### `frontend/cypress/component/VBadge.spec.ts` (CREATE)

```typescript
import VBadge from '@/components/VBadge.vue'

describe('VBadge', () => {
  const colors = ['primary', 'success', 'warning', 'danger', 'info']

  colors.forEach(color => {
    it(`renders ${color} color variant`, () => {
      cy.mount(VBadge, { props: { color } })
      cy.get('.badge').should('have.class', `badge-${color}`)
    })
  })

  it('renders text content', () => {
    cy.mount(VBadge, {
      props: { color: 'primary' },
      slots: { default: 'New' }
    })
    cy.contains('New')
  })
})
```

#### `frontend/cypress/component/VTable.spec.ts` (CREATE)

```typescript
import VTable from '@/components/VTable.vue'

describe('VTable', () => {
  it('sorts column when header clicked', () => {
    const data = [{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }]
    cy.mount(VTable, {
      props: {
        columns: [{ key: 'name', label: 'Name', sortable: true }],
        data
      }
    })
    cy.get('th').first().click()
    cy.get('td').first().contains('Alice')
  })

  it('shows empty state when no data', () => {
    cy.mount(VTable, {
      props: {
        columns: [{ key: 'name', label: 'Name' }],
        data: []
      }
    })
    cy.contains(/No data|empty/i)
  })

  it('shows loading state when loading=true', () => {
    cy.mount(VTable, {
      props: {
        columns: [{ key: 'name', label: 'Name' }],
        data: [],
        loading: true
      }
    })
    cy.get('.table-loading').should('exist')
  })
})
```

#### `frontend/cypress/component/VFormGroup.spec.ts` (CREATE)

```typescript
import VFormGroup from '@/components/VFormGroup.vue'

describe('VFormGroup', () => {
  it('renders label text', () => {
    cy.mount(VFormGroup, {
      props: { label: 'Email' },
      slots: { default: '<input />' }
    })
    cy.contains('Email')
  })

  it('renders error text with error styling', () => {
    cy.mount(VFormGroup, {
      props: { label: 'Email', error: 'Invalid email' },
      slots: { default: '<input />' }
    })
    cy.contains('Invalid email')
    cy.get('.form-error').should('exist')
  })

  it('renders help text below input', () => {
    cy.mount(VFormGroup, {
      props: { label: 'Email', help: 'We will never share your email' },
      slots: { default: '<input />' }
    })
    cy.contains('We will never share your email')
  })
})
```

#### `frontend/src/__tests__/designTokens.test.ts` (CREATE)

```typescript
import { describe, it, expect } from 'vitest'

function getCSSVariable(name: string): string {
  const style = document.createElement('div')
  document.body.appendChild(style)
  const value = getComputedStyle(style).getPropertyValue(name).trim()
  document.body.removeChild(style)
  return value
}

describe('Design tokens', () => {
  it('--color-primary is defined', () => {
    const value = getCSSVariable('--color-primary')
    expect(value).toMatch(/^#/)
  })

  it('--color-danger is defined', () => {
    const value = getCSSVariable('--color-danger')
    expect(value).toMatch(/^#/)
  })

  it('--color-success is defined', () => {
    const value = getCSSVariable('--color-success')
    expect(value).toMatch(/^#/)
  })

  it('--spacing-sm is defined', () => {
    const value = getCSSVariable('--spacing-sm')
    expect(value).toMatch(/^\d+px$/)
  })

  it('--border-radius-md is defined', () => {
    const value = getCSSVariable('--border-radius-md')
    expect(value).toMatch(/^\d+px$/)
  })

  it('--font-size-base is defined', () => {
    const value = getCSSVariable('--font-size-base')
    expect(value).toMatch(/^\d+px$/)
  })
})
```

#### `frontend/src/__tests__/colorPropagation.test.ts` (CREATE)

```typescript
import { describe, it, expect } from 'vitest'

describe('Primary color propagation', () => {
  it('changing --color-primary updates components that use it', () => {
    // Set CSS variable on :root
    document.documentElement.style.setProperty('--color-primary', '#ff0000')

    // Query computed style of an element using the variable
    const style = window.getComputedStyle(document.documentElement)
    expect(style.getPropertyValue('--color-primary').trim()).toBe('#ff0000')

    // Reset
    document.documentElement.style.setProperty('--color-primary', '')
  })

  it('VButton uses --color-primary for primary variant', () => {
    // Mount VButton, check computed background-color uses --color-primary
  })

  it('VBadge uses --color-primary for primary color', () => {
    // Mount VBadge with color="primary", check computed color
  })
})
```

#### `frontend/src/__tests__/bundleSize.test.ts` (CREATE)

```typescript
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Bundle size regression', () => {
  const MAX_BUNDLE_SIZE = 500000 // 500KB — adjust based on baseline

  it('frontend build output does not exceed baseline', () => {
    const distDir = path.join(__dirname, '..', 'dist')
    if (!fs.existsSync(distDir)) {
      // Skip if build hasn't been run
      return
    }

    let totalSize = 0
    function addDir(dir: string) {
      for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file)
        if (fs.statSync(fullPath).isDirectory()) {
          addDir(fullPath)
        } else {
          totalSize += fs.statSync(fullPath).size
        }
      }
    }

    addDir(distDir)
    expect(totalSize).toBeLessThan(MAX_BUNDLE_SIZE)
  })
})
```

---

### d) Dependencies

- 6 base components — paths to verify in `frontend/src/components/`
- CSS design tokens — paths to verify in `frontend/src/assets/css/`
- Cypress component testing setup — `frontend/cypress/component/`
- Vitest setup — `frontend/src/__tests__/`

---

### e) Risks/Edge Cases

- **[Cypress mount context]**: Components may depend on Pinia store. Mitigation: provide mock stores via `mount()` options.
- **[CSS variable timing]**: Variables may not be loaded when test runs. Mitigation: import CSS in test setup file.
- **[Bundle size baseline]**: Baseline may change with dependencies. Mitigation: make threshold configurable.

---

### f) Testing

#### Frontend Tests
- [ ] 6 Cypress component test files CREATED
- [ ] 3 Vitest test files CREATED
- [ ] All component tests use existing Cypress mount patterns
- [ ] CSS variable tests import CSS in setup

#### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run` — frontend tests pass
- [ ] `npm run cypress:component` — component tests pass

---

### g) Migration Notes (if applicable)

No migrations needed.

---

### h) Files Changed

**Frontend:**
```
frontend/cypress/component/VButton.spec.ts           → CREATE
frontend/cypress/component/VModal.spec.ts             → CREATE
frontend/cypress/component/VCard.spec.ts              → CREATE
frontend/cypress/component/VBadge.spec.ts             → CREATE
frontend/cypress/component/VTable.spec.ts             → CREATE
frontend/cypress/component/VFormGroup.spec.ts         → CREATE
frontend/src/__tests__/designTokens.test.ts           → CREATE
frontend/src/__tests__/colorPropagation.test.ts       → CREATE
frontend/src/__tests__/bundleSize.test.ts             → CREATE
```

---

### i) Code Review Checklist

- [ ] All test files follow existing naming conventions
- [ ] Cypress component tests use existing `cy.mount()` patterns
- [ ] CSS variable tests import CSS in setup
- [ ] Bundle size threshold is configurable
- [ ] No production code modified (test-only ticket)
- [ ] `npm test -- --run` passes with no regressions
- [ ] `npm run cypress:component` passes

---

### j) Post-Deploy Verification

1. [ ] `npm run lint` passes
2. [ ] `npm run typecheck` passes
3. [ ] `npm run build` passes
4. [ ] `npm test -- --run` passes
5. [ ] `npm run cypress:component` passes
6. [ ] All 9 new test files exist and run without errors
7. [ ] No regressions in existing test suites

---

*Fill in all sections before starting implementation. Update status as work progresses.*
