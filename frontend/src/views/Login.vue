<template>
  <div class="login">
    <h1>Sign In</h1>
    <form @submit.prevent="handleLogin">
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit" :disabled="loading">{{ loading ? 'Signing in...' : 'Login' }}</button>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </form>
    <p class="link"><router-link to="/register">Don't have an account? Register</router-link></p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { loginUser } from '@/api/auth.js'
import { get } from '@/api/client.js'

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const handleLogin = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const data = await loginUser(email.value, password.value)
    authStore.setToken(data.token)
    authStore.setUser(data.user)
    if (data.user?.role) {
      try {
        const perms = await get(`/api/permissions/${data.user.role}`)
        authStore.setPermissions(perms)
      } catch (e) {
        console.error('Failed to fetch permissions:', e)
      }
    }
    const redirect = route.query.redirect || '/dashboard'
    router.push(redirect)
  } catch (err) {
    console.error('Login failed:', err)
    errorMessage.value = err.message || 'Login failed. Please check your credentials.'
  } finally {
    loading.value = false
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
.login button:hover:not(:disabled) {
  background: #2563eb;
}
.login button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}
.error {
  color: #ef4444;
  margin-top: 10px;
  font-size: 14px;
}
.link {
  margin-top: 15px;
}
</style>
