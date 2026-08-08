import { ref, Ref } from 'vue'

export interface User {
  id: string
  name: string
  email: string
  role: string
}

let instance: {
  user: Ref<User | null>
  token: Ref<string>
  permissions: Ref<string[]>
  loading: Ref<boolean>
  error: Ref<string | null>
  isAuthenticated: () => boolean
  hasRole: (role: string) => boolean
  hasAnyRole: (roles: string[]) => boolean
  canAccess: (allowedRoles: string[]) => boolean
  hasPermission: (permCode: string) => boolean
  hasAnyPermission: (permCodes: string[]) => boolean
  isProjectAdmin: () => boolean
  isMember: () => boolean
  isUser: () => boolean
  isSuperAdmin: () => boolean
  canCreateUser: () => boolean
  canDeleteUser: () => boolean
  canToggleUser: () => boolean
  canAccessUsers: () => boolean
  canCreateTicket: () => boolean
  canUpdateTicket: () => boolean
  canDeleteTicket: () => boolean
  canChangeTicketStatus: () => boolean
  canCommentTicket: () => boolean
  canCreateProject: () => boolean
  canDeleteProject: () => boolean
  canCreateAgent: () => boolean
  canDeleteAgent: () => boolean
  canRevokeAgent: () => boolean
  canApprove: () => boolean
  canReject: () => boolean
  setUser: (data: User | null) => void
  setToken: (newToken: string) => void
  setPermissions: (perms: string[]) => void
  syncPermissions: (fetchFn: (role: string) => Promise<string[]>) => Promise<void>
  setLoading: (value: boolean) => void
  setLoadingError: (errMsg: string) => void
  logout: () => void
} | null = null

export function useAuthStore() {
  if (instance) {
    return instance
  }

  const user = ref<User | null>(JSON.parse(localStorage.getItem('vibecode_user') || 'null'))
  const token = ref<string>(localStorage.getItem('vibecode_token') || '')
  const permissions = ref<string[]>(JSON.parse(localStorage.getItem('vibecode_permissions') || '[]'))
  const loading = ref(false)
  const error = ref<string | null>(null)

  const setUser = (data: User | null) => {
    user.value = data
    localStorage.setItem('vibecode_user', JSON.stringify(data))
  }

  const setToken = (newToken: string) => {
    token.value = newToken
    if (newToken) {
      localStorage.setItem('vibecode_token', newToken)
    } else {
      localStorage.removeItem('vibecode_token')
    }
  }

  const setPermissions = (perms: string[]) => {
    permissions.value = Array.isArray(perms) ? perms : []
    localStorage.setItem('vibecode_permissions', JSON.stringify(permissions.value))
  }

  const syncPermissions = async (fetchFn: (role: string) => Promise<string[]>) => {
    if (!user.value?.role) return
    const expectedPerms = new Set<string>([
      'TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE', 'TICKET_STATUS_CHANGE', 'TICKET_COMMENT',
      'PROJECT_READ', 'AGENT_READ', 'PRICING_READ', 'DASHBOARD_READ',
    ])
    if (['project_admin', 'member'].includes(user.value.role)) {
      expectedPerms.add('TICKET_DELETE')
    }
    if (['project_admin', 'member'].includes(user.value.role)) {
      expectedPerms.add('USER_CREATE')
      expectedPerms.add('USER_READ')
    }
    if (user.value.role === 'project_admin') {
      expectedPerms.add('PROJECT_CREATE')
      expectedPerms.add('PROJECT_UPDATE')
      expectedPerms.add('PROJECT_DELETE')
      expectedPerms.add('PROJECT_MANAGE_MEMBERS')
      expectedPerms.add('USER_DELETE')
      expectedPerms.add('USER_TOGGLE_ACTIVE')
      expectedPerms.add('AGENT_CREATE')
      expectedPerms.add('AGENT_DELETE')
      expectedPerms.add('APPROVAL_APPROVE')
      expectedPerms.add('APPROVAL_REJECT')
    }
    if (user.value.role === 'super_admin') {
      return
    }
    const stored = new Set(permissions.value)
    const needsSync = Array.from(expectedPerms).some(p => !stored.has(p))
    if (needsSync) {
      try {
        const freshPerms = await fetchFn(user.value.role)
        setPermissions(freshPerms)
      } catch (e) {
        console.error('Failed to sync permissions:', e)
      }
    }
  }

  const setLoading = (value: boolean) => {
    loading.value = value
  }

  const setLoadingError = (errMsg: string) => {
    error.value = errMsg
    loading.value = false
  }

  const logout = () => {
    user.value = null
    token.value = ''
    permissions.value = []
    localStorage.removeItem('vibecode_user')
    localStorage.removeItem('vibecode_token')
    localStorage.removeItem('vibecode_permissions')
  }

  const isAuthenticated = () => !!token.value

  const hasRole = (role: string) => {
    return user.value?.role === role
  }

  const hasAnyRole = (roles: string[]) => {
    if (!user.value?.role) return false
    return roles.includes(user.value.role)
  }

  const canAccess = (allowedRoles: string[]) => {
    if (!allowedRoles || allowedRoles.length === 0) return true
    return hasAnyRole(allowedRoles)
  }

  const hasPermission = (permCode: string) => {
    if (user.value?.role === 'super_admin') return true
    return permissions.value.includes(permCode)
  }

  const hasAnyPermission = (permCodes: string[]) => {
    if (user.value?.role === 'super_admin') return true
    if (!Array.isArray(permCodes)) return false
    return permCodes.some(p => permissions.value.includes(p))
  }

  const isProjectAdmin = () => hasRole('project_admin')
  const isMember = () => hasRole('member')
  const isUser = () => hasRole('user')
  const isSuperAdmin = () => hasRole('super_admin')

  const canCreateUser = () => hasAnyPermission(['USER_CREATE'])
  const canDeleteUser = () => hasAnyPermission(['USER_DELETE'])
  const canToggleUser = () => hasAnyPermission(['USER_TOGGLE_ACTIVE'])
  const canAccessUsers = () => hasAnyPermission(['USER_READ', 'USER_VIEW_ALL'])
  const canCreateTicket = () => hasAnyPermission(['TICKET_CREATE'])
  const canUpdateTicket = () => hasAnyPermission(['TICKET_UPDATE'])
  const canDeleteTicket = () => hasAnyPermission(['TICKET_DELETE'])
  const canChangeTicketStatus = () => hasAnyPermission(['TICKET_STATUS_CHANGE'])
  const canCommentTicket = () => hasAnyPermission(['TICKET_COMMENT'])
  const canCreateProject = () => hasAnyPermission(['PROJECT_CREATE'])
  const canDeleteProject = () => hasAnyPermission(['PROJECT_DELETE'])
  const canCreateAgent = () => hasAnyPermission(['AGENT_CREATE'])
  const canDeleteAgent = () => hasAnyPermission(['AGENT_DELETE'])
  const canRevokeAgent = () => hasAnyPermission(['AGENT_REVOKE'])
  const canApprove = () => hasAnyPermission(['APPROVAL_APPROVE'])
  const canReject = () => hasAnyPermission(['APPROVAL_REJECT'])

  instance = {
    user,
    token,
    permissions,
    loading,
    error,
    isAuthenticated,
    hasRole,
    hasAnyRole,
    canAccess,
    hasPermission,
    hasAnyPermission,
    isProjectAdmin,
    isMember,
    isUser,
    isSuperAdmin,
    canCreateUser,
    canDeleteUser,
    canToggleUser,
    canAccessUsers,
    canCreateTicket,
    canUpdateTicket,
    canDeleteTicket,
    canChangeTicketStatus,
    canCommentTicket,
    canCreateProject,
    canDeleteProject,
    canCreateAgent,
    canDeleteAgent,
    canRevokeAgent,
    canApprove,
    canReject,
    setUser,
    setToken,
    setPermissions,
    syncPermissions,
    setLoading,
    setLoadingError,
    logout,
  }

  return instance
}
