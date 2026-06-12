import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../stores/auth'

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn(key => store[key] || null),
    setItem: vi.fn((key, value) => { store[key] = String(value) }),
    removeItem: vi.fn(key => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
  }
})()

Object.defineProperty(global, 'localStorage', { value: localStorageMock })

describe('auth store', () => {
  let store

  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    store = useAuthStore()
    store.logout()
  })

  it('initializes with null user and empty token', () => {
    expect(store.user.value).toBeNull()
    expect(store.token.value).toBe('')
    expect(store.permissions.value).toEqual([])
  })

  it('persists token to localStorage', () => {
    store.setToken('new-token')
    expect(localStorage.getItem('vibecode_token')).toBe('new-token')
    expect(store.token.value).toBe('new-token')
  })

  it('removes token from localStorage when set to empty', () => {
    store.setToken('temp-token')
    expect(localStorage.getItem('vibecode_token')).toBe('temp-token')

    store.setToken('')
    expect(localStorage.getItem('vibecode_token')).toBeNull()
    expect(store.token.value).toBe('')
  })

  it('persists user to localStorage', () => {
    store.setUser({ id: 1, name: 'Test', role: 'admin' })
    expect(localStorage.getItem('vibecode_user')).toBe(JSON.stringify({ id: 1, name: 'Test', role: 'admin' }))
    expect(store.user.value.id).toBe(1)
  })

  it('persists permissions to localStorage', () => {
    store.setPermissions(['TICKET_CREATE', 'TICKET_READ'])
    expect(localStorage.getItem('vibecode_permissions')).toBe(JSON.stringify(['TICKET_CREATE', 'TICKET_READ']))
    expect(store.permissions.value).toEqual(['TICKET_CREATE', 'TICKET_READ'])
  })

  it('normalizes permissions to array', () => {
    store.setPermissions('not-an-array')
    expect(store.permissions.value).toEqual([])
  })

  it('logout clears all state', () => {
    store.setToken('token')
    store.setUser({ id: 1 })
    store.setPermissions(['perm1'])

    store.logout()

    expect(store.token.value).toBe('')
    expect(store.user.value).toBeNull()
    expect(store.permissions.value).toEqual([])
    expect(localStorage.getItem('vibecode_token')).toBeNull()
    expect(localStorage.getItem('vibecode_user')).toBeNull()
  })

  it('isAuthenticated returns true when token exists', () => {
    expect(store.isAuthenticated()).toBe(false)
    store.setToken('token')
    expect(store.isAuthenticated()).toBe(true)
  })

  it('hasRole returns true for matching role', () => {
    store.setUser({ role: 'project_admin' })
    expect(store.hasRole('project_admin')).toBe(true)
    expect(store.hasRole('user')).toBe(false)
  })

  it('hasAnyRole returns true for any matching role', () => {
    store.setUser({ role: 'member' })
    expect(store.hasAnyRole(['user', 'member'])).toBe(true)
    expect(store.hasAnyRole(['project_admin', 'super_admin'])).toBe(false)
  })

  it('hasAnyRole returns false when no role', () => {
    expect(store.hasAnyRole(['user', 'admin'])).toBe(false)
  })

  it('canAccess returns true for allowed roles', () => {
    store.setUser({ role: 'project_admin' })
    expect(store.canAccess(['project_admin', 'super_admin'])).toBe(true)
    expect(store.canAccess(['user', 'member'])).toBe(false)
  })

  it('canAccess returns true when no allowedRoles provided', () => {
    expect(store.canAccess(null)).toBe(true)
    expect(store.canAccess([])).toBe(true)
  })

  it('hasPermission returns true for super_admin', () => {
    store.setUser({ role: 'super_admin' })
    expect(store.hasPermission('TICKET_CREATE')).toBe(true)
    expect(store.hasPermission('NONEXISTENT')).toBe(true)
  })

  it('hasPermission checks permissions array for non-super-admin', () => {
    store.setUser({ role: 'user' })
    store.setPermissions(['TICKET_CREATE', 'TICKET_READ'])

    expect(store.hasPermission('TICKET_CREATE')).toBe(true)
    expect(store.hasPermission('TICKET_DELETE')).toBe(false)
  })

  it('hasAnyPermission returns true for super_admin', () => {
    store.setUser({ role: 'super_admin' })
    expect(store.hasAnyPermission(['ANY', 'PERMS'])).toBe(true)
  })

  it('hasAnyPermission checks permissions array', () => {
    store.setUser({ role: 'user' })
    store.setPermissions(['TICKET_CREATE'])

    expect(store.hasAnyPermission(['TICKET_CREATE', 'TICKET_DELETE'])).toBe(true)
    expect(store.hasAnyPermission(['TICKET_DELETE', 'PROJECT_CREATE'])).toBe(false)
  })

  it('hasAnyPermission returns false for non-array input', () => {
    store.setUser({ role: 'user' })
    expect(store.hasAnyPermission('not-an-array')).toBe(false)
  })

  it('isProjectAdmin returns true for project_admin role', () => {
    store.setUser({ role: 'project_admin' })
    expect(store.isProjectAdmin()).toBe(true)
    expect(store.isMember()).toBe(false)
  })

  it('isMember returns true for member role', () => {
    store.setUser({ role: 'member' })
    expect(store.isMember()).toBe(true)
    expect(store.isProjectAdmin()).toBe(false)
  })

  it('isUser returns true for user role', () => {
    store.setUser({ role: 'user' })
    expect(store.isUser()).toBe(true)
  })

  it('isSuperAdmin returns true for super_admin role', () => {
    store.setUser({ role: 'super_admin' })
    expect(store.isSuperAdmin()).toBe(true)
  })

  describe('permission helpers', () => {
    beforeEach(() => {
      store.logout()
    })

    it('canCreateTicket returns true with TICKET_CREATE permission', () => {
      store.setUser({ role: 'user' })
      store.setPermissions(['TICKET_CREATE'])
      expect(store.canCreateTicket()).toBe(true)
    })

    it('canCreateTicket returns false without TICKET_CREATE permission', () => {
      store.setUser({ role: 'user' })
      store.setPermissions([])
      expect(store.canCreateTicket()).toBe(false)
    })

    it('canDeleteTicket returns true with TICKET_DELETE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['TICKET_DELETE'])
      expect(store.canDeleteTicket()).toBe(true)
    })

    it('canUpdateTicket returns true with TICKET_UPDATE permission', () => {
      store.setUser({ role: 'user' })
      store.setPermissions(['TICKET_UPDATE'])
      expect(store.canUpdateTicket()).toBe(true)
    })

    it('canAccessUsers returns true with USER_READ permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['USER_READ'])
      expect(store.canAccessUsers()).toBe(true)
    })

    it('canCreateUser returns true with USER_CREATE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['USER_CREATE'])
      expect(store.canCreateUser()).toBe(true)
    })

    it('canDeleteUser returns true with USER_DELETE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['USER_DELETE'])
      expect(store.canDeleteUser()).toBe(true)
    })

    it('canToggleUser returns true with USER_TOGGLE_ACTIVE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['USER_TOGGLE_ACTIVE'])
      expect(store.canToggleUser()).toBe(true)
    })

    it('canCreateProject returns true with PROJECT_CREATE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['PROJECT_CREATE'])
      expect(store.canCreateProject()).toBe(true)
    })

    it('canDeleteProject returns true with PROJECT_DELETE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['PROJECT_DELETE'])
      expect(store.canDeleteProject()).toBe(true)
    })

    it('canCreateAgent returns true with AGENT_CREATE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['AGENT_CREATE'])
      expect(store.canCreateAgent()).toBe(true)
    })

    it('canDeleteAgent returns true with AGENT_DELETE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['AGENT_DELETE'])
      expect(store.canDeleteAgent()).toBe(true)
    })

    it('canApprove returns true with APPROVAL_APPROVE permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['APPROVAL_APPROVE'])
      expect(store.canApprove()).toBe(true)
    })

    it('canReject returns true with APPROVAL_REJECT permission', () => {
      store.setUser({ role: 'project_admin' })
      store.setPermissions(['APPROVAL_REJECT'])
      expect(store.canReject()).toBe(true)
    })
  })

  describe('syncPermissions', () => {
    it('does nothing for super_admin', async () => {
      store.setUser({ role: 'super_admin' })
      await store.syncPermissions(vi.fn())
      // No fetch should be called for super_admin
    })

    it('skips sync when all expected permissions are already stored', async () => {
      store.setUser({ role: 'user' })
      store.setPermissions([
        'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
        'PROJECT_READ', 'AGENT_READ', 'PRICING_READ', 'DASHBOARD_READ',
      ])

      const fetchFn = vi.fn().mockResolvedValue([])
      await store.syncPermissions(fetchFn)

      expect(fetchFn).not.toHaveBeenCalled()
    })

    it('fetches fresh permissions when a permission is missing', async () => {
      store.setUser({ role: 'user' })
      store.setPermissions(['TICKET_CREATE', 'TICKET_READ'])

      const fetchFn = vi.fn().mockResolvedValue(['TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE'])
      await store.syncPermissions(fetchFn)

      expect(fetchFn).toHaveBeenCalledWith('user')
      expect(store.permissions.value).toEqual(['TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE'])
    })

    it('stops fetching on first missing permission', async () => {
      store.setUser({ role: 'user' })
      store.setPermissions(['TICKET_CREATE'])

      const fetchFn = vi.fn().mockResolvedValue(['TICKET_CREATE', 'TICKET_READ'])
      await store.syncPermissions(fetchFn)

      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('logs error when fetch fails but continues', async () => {
      store.setUser({ role: 'user' })
      store.setPermissions(['TICKET_CREATE'])

      const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await store.syncPermissions(fetchFn)

      expect(fetchFn).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith('Failed to sync permissions:', expect.any(Error))

      consoleSpy.mockRestore()
    })

    it('does nothing when user has no role', async () => {
      store.setUser({ name: 'Test' })
      const fetchFn = vi.fn()
      await store.syncPermissions(fetchFn)
      expect(fetchFn).not.toHaveBeenCalled()
    })
  })

  describe('setLoading', () => {
    it('sets loading state', () => {
      expect(store.loading.value).toBe(false)
      store.setLoading(true)
      expect(store.loading.value).toBe(true)
    })
  })

  describe('setLoadingError', () => {
    it('sets error and stops loading', () => {
      store.setLoadingError('Connection failed')
      expect(store.error.value).toBe('Connection failed')
      expect(store.loading.value).toBe(false)
    })
  })
})
