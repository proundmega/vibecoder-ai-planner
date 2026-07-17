import { ref } from 'vue'
import { getRepoStatus, connectRepo, disconnectRepo, listBranches, listPRs, createBranch, type RepoStatus, type Branch, type PullRequest } from '@/api/github'

export function useGitHub(projectId: string | number) {
  const repo = ref<RepoStatus | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const success = ref<string | null>(null)
  const showConnectForm = ref(false)
  const repoUrl = ref('')
  const repoBranch = ref('main')
  const repoAccessToken = ref('')
  const branches = ref<Branch[]>([])
  const prs = ref<PullRequest[]>([])
  const creatingBranch = ref(false)
  const branchTicketId = ref('')
  const loaded = ref(false)

  async function load() {
    loading.value = true
    error.value = null
    try {
      repo.value = await getRepoStatus(String(projectId))
      if (repo.value?.connected) {
        await loadBranches()
        await loadPRs()
      }
    } catch (_err) {
      error.value = 'Failed to load GitHub status'
    } finally {
      loading.value = false
    }
  }

  async function loadBranches() {
    try {
      branches.value = await listBranches(String(projectId))
    } catch (err) {
      console.error('Failed to load branches:', err)
    }
  }

  async function loadPRs() {
    try {
      prs.value = await listPRs(String(projectId))
    } catch (err) {
      console.error('Failed to load PRs:', err)
    }
  }

  async function connect() {
    if (!repoUrl.value.trim()) return
    loading.value = true
    error.value = null
    success.value = null
    try {
      await connectRepo(String(projectId), repoUrl.value.trim(), repoAccessToken.value.trim())
      success.value = 'Repository connected successfully'
      await load()
      showConnectForm.value = false
      repoUrl.value = ''
      repoBranch.value = 'main'
      repoAccessToken.value = ''
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to connect repository'
    } finally {
      loading.value = false
    }
  }

  async function disconnect() {
    loading.value = true
    error.value = null
    try {
      await disconnectRepo(String(projectId))
      repo.value = null
      branches.value = []
      prs.value = []
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to disconnect repository'
    } finally {
      loading.value = false
    }
  }

  async function createBranchAction(ticketId: string) {
    if (!ticketId.trim()) return
    creatingBranch.value = true
    error.value = null
    try {
      await createBranch(ticketId.trim(), `ticket-${ticketId.trim()}`, String(projectId))
      success.value = 'Branch created successfully'
      await loadBranches()
      branchTicketId.value = ''
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to create branch'
    } finally {
      creatingBranch.value = false
    }
  }

  return {
    repo, loading, error, success, showConnectForm, repoUrl, repoBranch, repoAccessToken,
    branches, prs, creatingBranch, branchTicketId, loaded,
    load, loadBranches, loadPRs, connect, disconnect, createBranch: createBranchAction,
  }
}
