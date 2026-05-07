export const useAuthStore = () => {
  const user = JSON.parse(localStorage.getItem('vibecode_user') || 'null')
  const token = localStorage.getItem('vibecode_token') || ''

  const setUser = (data) => {
    localStorage.setItem('vibecode_user', JSON.stringify(data))
  }

  const setLoading = (loading) => {
    localStorage.setItem('vibecode_loading', loading.toString())
  }

  const setLoadingError = (error) => {
    localStorage.setItem('vibecode_error', error)
  }

  const logout = () => {
    localStorage.removeItem('vibecode_user')
    localStorage.removeItem('vibecode_token')
  }

  return {
    user,
    token,
    setUser,
    setLoading,
    setLoadingError,
    logout
  }
}
