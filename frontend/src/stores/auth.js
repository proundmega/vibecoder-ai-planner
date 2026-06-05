import { ref } from 'vue'

let instance = null

export function useAuthStore() {
  if (instance) {
    return instance
  }

  const user = ref(JSON.parse(localStorage.getItem('vibecode_user') || 'null'))
  const token = ref(localStorage.getItem('vibecode_token') || '')
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

  instance = {
    user,
    token,
    loading,
    error,
    isAuthenticated,
    hasRole,
    hasAnyRole,
    canAccess,
    setUser,
    setToken,
    setLoading,
    setLoadingError,
    logout,
  }

  return instance
}
