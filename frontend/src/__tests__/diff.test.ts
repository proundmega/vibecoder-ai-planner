import { describe, it, expect } from 'vitest'
import { countLines, computePatch } from '@/utils/diff'

describe('countLines', () => {
  it('returns 0 for null', () => {
    expect(countLines(null as never)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(countLines(undefined as never)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0)
  })

  it('returns correct count for multi-line strings', () => {
    expect(countLines('a\nb\nc')).toBe(3)
    expect(countLines('a\nb\nc\n')).toBe(4)
  })
})

describe('computePatch', () => {
  it('generates new-file patch when oldContent is null', () => {
    const patch = computePatch(null, 'hello\nworld', 'new.txt')
    expect(patch).toContain('--- /dev/null')
    expect(patch).toContain('+++ b/new.txt')
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    expect(patch).toContain('+hello')
    expect(patch).toContain('+world')
  })

  it('generates delete patch when newContent is null', () => {
    const patch = computePatch('hello\nworld', null, 'deleted.txt')
    expect(patch).toContain('--- a/deleted.txt')
    expect(patch).toContain('+++ /dev/null')
    expect(patch).toContain('@@ -1,2 +0,0 @@')
    expect(patch).toContain('-hello')
    expect(patch).toContain('-world')
  })

  it('generates unified diff for modified content', () => {
    const patch = computePatch('a\nb\nc', 'a\nX\nc', 'mod.txt')
    expect(patch).toContain('--- a/mod.txt')
    expect(patch).toContain('+++ b/mod.txt')
    expect(patch).toContain('-b')
    expect(patch).toContain('+X')
  })

  it('generates header even for identical content', () => {
    const patch = computePatch('same', 'same', 'same.txt')
    expect(patch).toContain('--- a/same.txt')
    expect(patch).toContain('+++ b/same.txt')
  })

  it('generates header for empty strings', () => {
    const patch = computePatch('', '', 'empty.txt')
    expect(patch).toContain('--- a/empty.txt')
    expect(patch).toContain('+++ b/empty.txt')
  })
})
