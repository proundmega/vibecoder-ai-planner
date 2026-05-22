<template>
  <div class="register">
    <h1>Create Account</h1>
    <form @submit.prevent="handleRegister">
      <input v-model="name" type="text" placeholder="Name" required />
      <input v-model="email" type="email" placeholder="Email" required />
      <input v-model="password" type="password" placeholder="Password" required />
      <button type="submit" :disabled="authStore.loading">Register</button>
      <p v-if="authStore.error" class="error">{{ authStore.error }}</p>
    </form>
    <p class="link"><router-link to="/login">Already have an account? Login</router-link></p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { registerUser } from '@/api/auth'

const name = ref('')
const email = ref('')
const password = ref('')
const authStore = useAuthStore()
const router = useRouter()

const handleRegister = async () => {
  authStore.error = null
  authStore.setLoading(true)

  try {
    const data = await registerUser(name.value, email.value, password.value)
    authStore.setToken(data.token)
    authStore.setUser(data.user)
    router.push('/projects')
  } catch (err) {
    authStore.setLoadingError(err.message || 'Registration failed')
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
.register button:disabled {
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
