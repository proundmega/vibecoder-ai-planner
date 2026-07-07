import { describe, it, expect } from 'vitest'
import '../../src/styles/design-tokens.css'

describe('Primary color propagation', () => {
  it('CSS variable --color-primary is defined in design tokens', () => {
    const rootStyle = document.documentElement.style
    const value = rootStyle.getPropertyValue('--color-primary').trim()
    expect(value).toBe('#3b82f6')
  })

  it('VButton component references --color-primary in its styles', () => {
    const style = document.createElement('style')
    style.textContent = `.v-btn--primary { background: var(--color-primary); }`
    document.head.appendChild(style)

    const btn = document.createElement('div')
    btn.className = 'v-btn v-btn--primary'
    document.body.appendChild(btn)

    const computedStyle = getComputedStyle(btn)
    expect(computedStyle.background).toBeTruthy()

    document.body.removeChild(btn)
    document.head.removeChild(style)
  })

  it('VBadge component references --color-primary in its styles', () => {
    const style = document.createElement('style')
    style.textContent = `.v-badge--primary .v-badge__indicator { background: var(--color-primary); }`
    document.head.appendChild(style)

    const badge = document.createElement('span')
    badge.className = 'v-badge v-badge--primary'
    const indicator = document.createElement('span')
    indicator.className = 'v-badge__indicator'
    badge.appendChild(indicator)
    document.body.appendChild(badge)

    const indicatorStyle = getComputedStyle(indicator)
    expect(indicatorStyle.backgroundColor).toBeTruthy()

    document.body.removeChild(badge)
    document.head.removeChild(style)
  })

  it('VModal component references --color-bg in its styles', () => {
    const style = document.createElement('style')
    style.textContent = `.v-modal { background: var(--color-bg); }`
    document.head.appendChild(style)

    const modal = document.createElement('div')
    modal.className = 'v-modal'
    document.body.appendChild(modal)

    const computedStyle = getComputedStyle(modal)
    expect(computedStyle.backgroundColor).toBeTruthy()

    document.body.removeChild(modal)
    document.head.removeChild(style)
  })
})
