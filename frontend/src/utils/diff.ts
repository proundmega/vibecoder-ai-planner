import { diffLines } from 'diff'

export function countLines(text: string | null): number {
  if (!text) return 0
  return text.split('\n').length
}

function addPrefix(text: string, prefix: string): string {
  if (!text) return ''
  return text.split('\n').map((line: string) => `${prefix}${line}`).join('\n')
}

export function computePatch(oldContent: string | null, newContent: string | null, filename: string): string {
  if (!oldContent && newContent) {
    const lines = newContent.split('\n')
    return `--- /dev/null\n+++ b/${filename}\n@@ -0,0 +1,${lines.length} @@\n${addPrefix(newContent, '+')}`
  }
  if (oldContent && !newContent) {
    const lines = oldContent.split('\n')
    return `--- a/${filename}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${addPrefix(oldContent, '-')}`
  }
  const changes = diffLines(oldContent || '', newContent || '')
  let result = `--- a/${filename}\n+++ b/${filename}\n`
  let oldLine = 1
  let newLine = 1
  for (const change of changes) {
    const count = change.count || 1
    if (change.added) {
      result += `@@ -${oldLine - 1},${count + 1} +${newLine},${count} @@\n`
      result += addPrefix(change.value, '+')
      newLine += count
    } else if (change.removed) {
      result += `@@ -${oldLine},${count} +${newLine - 1},${count + 1} @@\n`
      result += addPrefix(change.value, '-')
      oldLine += count
    } else {
      oldLine += count
      newLine += count
    }
  }
  return result
}
