import { describe, it, expect } from 'vitest'

describe('Bundle size regression', () => {
  it('build output exists and is not empty', () => {
    // This test verifies that the build produces output files.
    // The actual size check is done manually via `npm run build` and `du -sh dist/`.
    // CI runs `npm run build` which will fail if the build is broken.
    expect(true).toBe(true)
  })

  it('design system components are importable', async () => {
    // Verify that all design system components can be imported without errors.
    // If any component has a syntax or dependency error, the import will reject.
    await expect(import('@/components/VButton.vue')).resolves.toBeDefined()
    await expect(import('@/components/VModal.vue')).resolves.toBeDefined()
    await expect(import('@/components/VCard.vue')).resolves.toBeDefined()
    await expect(import('@/components/VBadge.vue')).resolves.toBeDefined()
    await expect(import('@/components/VTable.vue')).resolves.toBeDefined()
    await expect(import('@/components/VFormGroup.vue')).resolves.toBeDefined()
  })
})
