<template>
  <div class="register">
    <h1>Create Account</h1>
    <form @submit.prevent="handleRegister">
      <input v-model="name" type="text" placeholder="Name" required />
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password (min 6 chars)" required minlength="6" />
      <button type="submit" :disabled="loading">{{ loading ? 'Creating...' : 'Register' }}</button>
      <p v-if="errorMessage" class="error">{{ errorMessage }}</p>
    </form>
    <p class="link"><router-link to="/login">Already have an account? Login</router-link></p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { registerUser } from '@/api/auth.js'

const name = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const authStore = useAuthStore()
const router = useRouter()

const handleRegister = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const data = await registerUser(name.value, email.value, password.value)
    authStore.setToken(data.token)
    authStore.setUser(data.user)
    router.push('/dashboard')
  } catch (err) {
    console.error('Registration failed:', err)
    errorMessage.value = err.message || 'Registration failed. Please try again.'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.register {
  max-width: 400px;
  margin: 100px auto;
  padding: 30px;
}
.register h1 {
  margin-bottom: 20px;
}
.register input {
  width: 100%;
  padding: 10px;
  margin-bottom: 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}
.register button {
  width: 100%;
  padding: 10px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.register button:hover:not(:disabled) {
  background: #2563eb;
}
.register button:disabled {
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
