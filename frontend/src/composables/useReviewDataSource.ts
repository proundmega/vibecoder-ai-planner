import { ref } from 'vue'
import { getGithubDiff, getLocalDiff } from '../api/review'
import { computePatch, countLines } from '../utils/diff'

export interface DiffFile {
  filename: string
  status: string
  patch: string
  additions: number
  deletions: number
}

export function useReviewDataSource(ticketId: string) {
  const source = ref<'github' | 'local' | null>(null)
  const files = ref<DiffFile[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const github = await getGithubDiff(ticketId)
      if (github?.files?.length > 0) {
        source.value = 'github'
        files.value = github.files
        return
      }
    } catch { /* no github PR, try local */ }

    try {
      const local = await getLocalDiff(ticketId)
      if (local?.files?.length > 0) {
        source.value = 'local'
        files.value = local.files.map((f: any) => ({
          filename: f.file_path,
          status: f.action === 'create' ? 'added' : f.action === 'delete' ? 'deleted' : 'modified',
          patch: computePatch(f.old_content, f.new_content, f.file_path),
          additions: f.action === 'delete' ? 0 : countLines(f.new_content),
          deletions: f.action === 'create' ? 0 : countLines(f.old_content),
        }))
        return
      }
    } catch { /* no diff available */ }

    source.value = null
    files.value = []
  }

  return { source, files, loading, error, load }
}
