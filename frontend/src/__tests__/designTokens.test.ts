import { describe, it, expect } from 'vitest'
import '../../src/styles/design-tokens.css'

describe('Design tokens', () => {
  describe('Color tokens', () => {
    it('--color-primary is defined with hex value', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-primary').trim()
      expect(value).toMatch(/^#3b82f6$/)
    })

    it('--color-primary-hover is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-primary-hover').trim()
      expect(value).toMatch(/^#2563eb$/)
    })

    it('--color-primary-light is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-primary-light').trim()
      expect(value).toMatch(/^#dbeafe$/)
    })

    it('--color-danger is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-danger').trim()
      expect(value).toMatch(/^#ef4444$/)
    })

    it('--color-danger-hover is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-danger-hover').trim()
      expect(value).toMatch(/^#dc2626$/)
    })

    it('--color-danger-light is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-danger-light').trim()
      expect(value).toMatch(/^#fee2e2$/)
    })

    it('--color-success is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-success').trim()
      expect(value).toMatch(/^#10b981$/)
    })

    it('--color-success-hover is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-success-hover').trim()
      expect(value).toMatch(/^#059669$/)
    })

    it('--color-warning is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-warning').trim()
      expect(value).toMatch(/^#f59e0b$/)
    })

    it('--color-info is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-info').trim()
      expect(value).toMatch(/^#3b82f6$/)
    })

    it('--color-text is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-text').trim()
      expect(value).toMatch(/^#111827$/)
    })

    it('--color-text-secondary is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-text-secondary').trim()
      expect(value).toMatch(/^#6b7280$/)
    })

    it('--color-text-muted is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-text-muted').trim()
      expect(value).toMatch(/^#9ca3af$/)
    })

    it('--color-bg is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-bg').trim()
      expect(value).toMatch(/^#ffffff$/)
    })

    it('--color-bg-secondary is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-bg-secondary').trim()
      expect(value).toMatch(/^#f9fafb$/)
    })

    it('--color-bg-tertiary is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-bg-tertiary').trim()
      expect(value).toMatch(/^#f3f4f6$/)
    })

    it('--color-border is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-border').trim()
      expect(value).toMatch(/^#e5e7eb$/)
    })

    it('--color-border-light is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-border-light').trim()
      expect(value).toMatch(/^#f3f4f6$/)
    })

    it('--color-nav-bg is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--color-nav-bg').trim()
      expect(value).toMatch(/^#1e293b$/)
    })
  })

  describe('Spacing tokens', () => {
    it('--spacing-xs is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--spacing-xs').trim()
      expect(value).toMatch(/^4px$/)
    })

    it('--spacing-sm is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--spacing-sm').trim()
      expect(value).toMatch(/^8px$/)
    })

    it('--spacing-md is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--spacing-md').trim()
      expect(value).toMatch(/^16px$/)
    })

    it('--spacing-lg is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--spacing-lg').trim()
      expect(value).toMatch(/^24px$/)
    })

    it('--spacing-xl is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--spacing-xl').trim()
      expect(value).toMatch(/^32px$/)
    })

    it('--spacing-2xl is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--spacing-2xl').trim()
      expect(value).toMatch(/^48px$/)
    })
  })

  describe('Typography tokens', () => {
    it('--font-size-xs is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--font-size-xs').trim()
      expect(value).toMatch(/^11px$/)
    })

    it('--font-size-sm is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--font-size-sm').trim()
      expect(value).toMatch(/^12px$/)
    })

    it('--font-size-base is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--font-size-base').trim()
      expect(value).toMatch(/^14px$/)
    })

    it('--font-size-lg is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--font-size-lg').trim()
      expect(value).toMatch(/^16px$/)
    })

    it('--font-size-xl is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--font-size-xl').trim()
      expect(value).toMatch(/^20px$/)
    })

    it('--font-size-2xl is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--font-size-2xl').trim()
      expect(value).toMatch(/^24px$/)
    })

    it('--line-height is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--line-height').trim()
      expect(value).toMatch(/^1\.5$/)
    })
  })

  describe('Border radius tokens', () => {
    it('--radius-sm is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--radius-sm').trim()
      expect(value).toMatch(/^4px$/)
    })

    it('--radius-md is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--radius-md').trim()
      expect(value).toMatch(/^6px$/)
    })

    it('--radius-lg is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--radius-lg').trim()
      expect(value).toMatch(/^8px$/)
    })

    it('--radius-full is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--radius-full').trim()
      expect(value).toMatch(/^9999px$/)
    })
  })

  describe('Shadow tokens', () => {
    it('--shadow-sm is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--shadow-sm').trim()
      expect(value).toMatch(/^0 1px 2px rgba/)
    })

    it('--shadow-md is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--shadow-md').trim()
      expect(value).toMatch(/^0 4px 6px rgba/)
    })

    it('--shadow-lg is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--shadow-lg').trim()
      expect(value).toMatch(/^0 10px 15px rgba/)
    })
  })

  describe('Transition tokens', () => {
    it('--transition-fast is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--transition-fast').trim()
      expect(value).toMatch(/^0\.15s$/)
    })

    it('--transition-base is defined', () => {
      const rootStyle = document.documentElement.style
      const value = rootStyle.getPropertyValue('--transition-base').trim()
      expect(value).toMatch(/^0\.2s$/)
    })
  })
})
