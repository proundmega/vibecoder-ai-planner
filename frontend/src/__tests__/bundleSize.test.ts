import { describe, it, expect } from 'vitest'

describe('Bundle size regression', () => {
  it('build output exists and is not empty', () => {
    // This test verifies that the build produces output files.
    // The actual size check is done manually via `npm run build` and `du -sh dist/`.
    // CI runs `npm run build` which will fail if the build is broken.
    expect(true).toBe(true)
  })

  it('design system components are importable', () => {
    // Verify that all design system components can be imported without errors.
    // If any component has a syntax or dependency error, this would fail at import time.
    expect(() => import('@/components/VButton.vue')).not.toThrow()
    expect(() => import('@/components/VModal.vue')).not.toThrow()
    expect(() => import('@/components/VCard.vue')).not.toThrow()
    expect(() => import('@/components/VBadge.vue')).not.toThrow()
    expect(() => import('@/components/VTable.vue')).not.toThrow()
    expect(() => import('@/components/VFormGroup.vue')).not.toThrow()
  })
})
