<template>
  <div class="login">
    <h1>Sign In</h1>
    <form @submit.prevent="handleLogin">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit" :disabled="authStore.loading">Login</button>
      <p v-if="authStore.error" class="error">{{ authStore.error }}</p>
    </form>
    <p class="link"><router-link to="/register">Don't have an account? Register</router-link></p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { loginUser } from '@/api/auth'

const email = ref('')
const password = ref('')
const authStore = useAuthStore()
const router = useRouter()

const handleLogin = async () => {
  authStore.error = null
  authStore.setLoading(true)

  try {
    const data = await loginUser(email.value, password.value)
    authStore.setToken(data.token)
    authStore.setUser(data.user)
    router.push('/projects')
  } catch (err) {
    authStore.setLoadingError(err.message || 'Login failed')
  }
}
</script>

<style scoped>
.login {
  max-width: 400px;
  margin: 100px auto;
  padding: 30px;
}
.login h1 {
  margin-bottom: 20px;
}
.login input {
  width: 100%;
  padding: 10px;
  margin-bottom: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}
.login button {
  width: 100%;
  padding: 10px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.login button:disabled {
  background: #9ca3af;
}
.error {
  color: #ef4444;
  margin-top: 10px;
}
.link {
  margin-top: 15px;
}
</style>
