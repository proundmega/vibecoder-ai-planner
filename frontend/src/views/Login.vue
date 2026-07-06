<template>
  <div class="login">
    <h1 class="login__title">Sign In</h1>
    <form @submit.prevent="handleLogin" class="login__form">
      <VInput
        v-model="email"
        type="email"
        label="Email"
        placeholder="Email"
        required
      />
      <VInput
        v-model="password"
        type="password"
        label="Password"
        placeholder="Password"
        required
      />
      <VButton
        type="submit"
        variant="primary"
        :loading="loading"
        full-width
      >
        {{ loading ? 'Signing in...' : 'Login' }}
      </VButton>
      <p v-if="errorMessage" class="login__error">{{ errorMessage }}</p>
    </form>
    <p class="login__link">
      <router-link to="/register">Don't have an account? Register</router-link>
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { loginUser } from '@/api/auth.js'
import { get } from '@/api/client.js'
import VInput from '@/components/VInput.vue'
import VButton from '@/components/VButton.vue'

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
        const perms = await get(`/api/v1/permissions/${data.user.role}`)
        authStore.setPermissions(perms)
        await authStore.syncPermissions((role) => get(`/api/v1/permissions/${role}`))
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

.login__title {
  margin-bottom: 20px;
  color: var(--color-text);
}

.login__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.login__error {
  color: var(--color-danger);
  margin-top: 10px;
  font-size: var(--font-size-sm);
}

.login__link {
  margin-top: 15px;
}
</style>
