import { ref, computed } from 'vue'

export function useAuthStore() {
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

  const isAuthenticated = computed(() => !!token.value)

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated,
    setUser,
    setToken,
    setLoading,
    setLoadingError,
    logout,
  }
}
