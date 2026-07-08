import { ref } from 'vue'
import { getGithubDiff } from '../api/review'

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
      if (github && github.length > 0) {
        source.value = 'github'
        files.value = github.map((entry) => ({
          filename: entry.path || entry.old_path || 'unknown',
          status: entry.status || 'modified',
          patch: entry.patch || '',
          additions: entry.additions || 0,
          deletions: entry.deletions || 0,
        }))
        return
      }
    } catch { /* no github PR, try local */ }

    source.value = null
    files.value = []
  }

  return { source, files, loading, error, load }
}
