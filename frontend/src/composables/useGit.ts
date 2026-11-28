import { computed, reactive, ref, watch } from 'vue'
import {
  connectRepo,
  createBranch as createBranchRequest,
  createReview as createReviewRequest,
  deleteBranch as deleteBranchRequest,
  disconnectRepo,
  getRepoStatus,
  listBranches,
  listProviders,
  listRepos,
  listReviews,
  type ConnectRepoInput,
  type GitCapabilities,
  type GitRepoStatus,
  type ReviewRequest,
} from '@/api/git'
import type { Branch } from '@/api/github'

/**
 * Provider-neutral project Git state: connections, provider capabilities,
 * branches and reviews. The legacy `useGitHub` shape is kept where it still
 * fits the project view.
 */
export function useGit(projectId: string | number) {
  const repo = ref<GitRepoStatus | null>(null)
  const repos = ref<GitRepoStatus[]>([])
  const providers = ref<GitCapabilities[]>([])
  const activeProvider = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const success = ref<string | null>(null)
  const showConnectForm = ref(false)
  const branches = ref<Branch[]>([])
  const reviews = ref<ReviewRequest[]>([])
  const actionLoading = ref<string | null>(null)

  const form = reactive({
    provider: 'github',
    repoUrl: '',
    baseUrl: '',
    authMode: 'app',
    token: '',
    sshKey: '',
    defaultBranch: '',
  })

  const registeredProviders = computed(() => providers.value.filter((provider) => provider.registered))
  const activeCapabilities = computed(
    () => providers.value.find((provider) => provider.id === activeProvider.value) ?? null,
  )
  const formCapabilities = computed(
    () => providers.value.find((provider) => provider.id === form.provider) ?? null,
  )
  const activeRepo = computed(
    () => repos.value.find((row) => row.provider === activeProvider.value) ?? repo.value,
  )

  function providerLabel(id: string): string {
    return providers.value.find((provider) => provider.id === id)?.label ?? id
  }

  function applyProviderDefaults(provider: string): void {
    const capabilities = providers.value.find((row) => row.id === provider)
    if (!capabilities) return
    form.authMode = capabilities.authModes[0] ?? 'pat'
    form.token = ''
    form.sshKey = ''
    if (!capabilities.requiresBaseUrl) form.baseUrl = ''
  }

  async function loadProviders(): Promise<void> {
    providers.value = await listProviders()
    const match = providers.value.find((provider) => provider.id === form.provider)
    if (!match && registeredProviders.value.length > 0) {
      form.provider = registeredProviders.value[0].id
    }
    applyProviderDefaults(form.provider)
  }

  async function loadBranches(): Promise<void> {
    branches.value = await listBranches(String(projectId), activeProvider.value || undefined)
  }

  async function loadReviews(): Promise<void> {
    reviews.value = await listReviews(
      String(projectId),
      activeProvider.value || undefined,
      activeRepo.value?.providerBaseUrl,
    )
  }

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [rows, newest] = await Promise.all([
        listRepos(String(projectId)),
        getRepoStatus(String(projectId)),
        loadProviders(),
      ])
      repos.value = rows
      repo.value = newest
      if (!activeProvider.value || !rows.some((row) => row.provider === activeProvider.value)) {
        activeProvider.value = rows[0]?.provider ?? ''
      }
      if (activeRepo.value?.connected) {
        await Promise.all([loadBranches(), loadReviews()])
      } else {
        branches.value = []
        reviews.value = []
      }
    } catch (_err) {
      error.value = 'Failed to load Git status'
    } finally {
      loading.value = false
    }
  }

  async function connect(): Promise<void> {
    if (!form.repoUrl.trim()) return
    loading.value = true
    error.value = null
    success.value = null
    try {
      const input: ConnectRepoInput = {
        provider: form.provider,
        repoUrl: form.repoUrl.trim(),
      }
      if (form.baseUrl.trim()) input.baseUrl = form.baseUrl.trim()
      if (form.defaultBranch.trim()) input.defaultBranch = form.defaultBranch.trim()
      // GitHub's auth mode is deployment-wide; let the backend choose instead
      // of sending a UI default that a PAT deployment would reject.
      if (form.authMode && form.provider !== 'github') input.authMode = form.authMode
      if (form.authMode === 'ssh') {
        if (form.sshKey.trim()) input.sshKey = form.sshKey.trim()
      } else if (form.authMode !== 'none' && form.token.trim()) {
        // GitHub App mode still needs a token for the one-time access check;
        // the agent later uses the App installation token instead.
        input.token = form.token.trim()
      }
      await connectRepo(String(projectId), input)
      success.value = 'Repository connected successfully'
      activeProvider.value = form.provider
      showConnectForm.value = false
      form.repoUrl = ''
      form.token = ''
      form.sshKey = ''
      form.defaultBranch = ''
      await load()
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to connect repository'
    } finally {
      loading.value = false
    }
  }

  async function disconnect(provider?: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await disconnectRepo(String(projectId), provider || activeProvider.value || undefined)
      await load()
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to disconnect repository'
    } finally {
      loading.value = false
    }
  }

  async function createBranch(ticketId: string): Promise<void> {
    if (!ticketId.trim()) return
    actionLoading.value = 'branch'
    error.value = null
    try {
      await createBranchRequest(ticketId.trim(), activeProvider.value || undefined)
      success.value = 'Branch created successfully'
      await loadBranches()
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to create branch'
    } finally {
      actionLoading.value = null
    }
  }

  async function deleteBranch(ticketId: string): Promise<void> {
    actionLoading.value = `delete-${ticketId}`
    error.value = null
    try {
      await deleteBranchRequest(ticketId, activeProvider.value || undefined)
      success.value = 'Branch deleted successfully'
      await loadBranches()
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to delete branch'
    } finally {
      actionLoading.value = null
    }
  }

  async function createReview(ticketId: string, description: string): Promise<void> {
    if (!ticketId.trim()) return
    actionLoading.value = 'review'
    error.value = null
    try {
      await createReviewRequest(
        ticketId.trim(),
        description.trim(),
        activeProvider.value || undefined,
        activeRepo.value?.providerBaseUrl,
      )
      success.value = 'Review request created successfully'
      await loadReviews()
    } catch (err: unknown) {
      const e = err as { message?: string }
      error.value = e.message || 'Failed to create review request'
    } finally {
      actionLoading.value = null
    }
  }

  watch(activeProvider, async (provider, previous) => {
    if (!provider || provider === previous) return
    await Promise.all([loadBranches(), loadReviews()])
  })

  return {
    repo, repos, providers, registeredProviders, activeProvider, activeRepo,
    activeCapabilities, formCapabilities, loading, error, success,
    showConnectForm, form, branches, reviews, actionLoading,
    providerLabel, applyProviderDefaults, load, connect, disconnect,
    createBranch, deleteBranch, createReview, loadBranches, loadReviews,
  }
}
