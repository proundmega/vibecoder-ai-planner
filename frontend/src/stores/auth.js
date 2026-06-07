import { ref } from 'vue'

let instance = null

export function useAuthStore() {
  if (instance) {
    return instance
  }

  const user = ref(JSON.parse(localStorage.getItem('vibecode_user') || 'null'))
  const token = ref(localStorage.getItem('vibecode_token') || '')
  const permissions = ref(JSON.parse(localStorage.getItem('vibecode_permissions') || '[]'))
  const loading = ref(false)
  const error = ref(null)

  const setUser = (data) => {
    user.value = data
    localStorage.setItem('vibecode_user', JSON.stringify(data))
  }

  const setToken = (newToken) => {
    token.value = newToken
    if (newToken) {
      localStorage.setItem('vibecode_token', newToken)
    } else {
      localStorage.removeItem('vibecode_token')
    }
  }

  const setPermissions = (perms) => {
    permissions.value = Array.isArray(perms) ? perms : []
    localStorage.setItem('vibecode_permissions', JSON.stringify(permissions.value))
  }

  const setLoading = (value) => {
    loading.value = value
  }

  const setLoadingError = (errMsg) => {
    error.value = errMsg
    loading.value = false
  }

  const logout = () => {
    user.value = null
    token.value = ''
    permissions.value = []
    localStorage.removeItem('vibecode_user')
    localStorage.removeItem('vibecode_token')
  }

  const isAuthenticated = () => !!token.value

  const hasRole = (role) => {
    return user.value?.role === role
  }

  const hasAnyRole = (roles) => {
    if (!user.value?.role) return false
    return roles.includes(user.value.role)
  }

  const canAccess = (allowedRoles) => {
    if (!allowedRoles || allowedRoles.length === 0) return true
    return hasAnyRole(allowedRoles)
  }

  const hasPermission = (permCode) => {
    if (user.value?.role === 'super_admin') return true
    return permissions.value.includes(permCode)
  }

  const hasAnyPermission = (permCodes) => {
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
    canApprove,
    canReject,
    setUser,
    setToken,
    setPermissions,
    setLoading,
    setLoadingError,
    logout,
  }

  return instance
}
