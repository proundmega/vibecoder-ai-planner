<template>
  <div class="login">
    <h1 class="login__title">Sign In</h1>
    <RateLimitBanner />
    <div v-if="lockoutActive" class="lockout-banner">
      <svg class="lockout-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span>Account locked. Try again in {{ Math.floor(countdownSeconds / 60) }}m {{ countdownSeconds % 60 }}s.</span>
    </div>
    <form @submit.prevent="handleLogin" class="login__form" :class="{ 'login__form--disabled': lockoutActive }">
      <VInput
        v-model="email"
        type="email"
        label="Email"
        placeholder="Email"
        required
        :disabled="lockoutActive"
      />
      <VInput
        v-model="password"
        type="password"
        label="Password"
        placeholder="Password"
        required
        :disabled="lockoutActive"
      />
      <VButton
        type="submit"
        variant="primary"
        :loading="loading"
        :disabled="lockoutActive"
        full-width
      >
        {{ loading ? 'Signing in...' : 'Login' }}
      </VButton>
      <p v-if="errorMessage && !lockoutActive" class="login__error">{{ errorMessage }}</p>
    </form>
    <p class="login__link">
      <router-link to="/register">Don't have an account? Register</router-link>
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRateLimitStore } from '@/stores/rateLimit'
import { loginUser } from '@/api/auth'
import { get } from '@/api/client'
import VInput from '@/components/VInput.vue'
import VButton from '@/components/VButton.vue'
import RateLimitBanner from '@/components/RateLimitBanner.vue'

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const lockoutActive = ref(false)
const lockedUntil = ref<string | null>(null)
const countdownSeconds = ref(0)
let countdownTimer: ReturnType<typeof setTimeout> | null = null
const authStore = useAuthStore()
const rateLimitStore = useRateLimitStore()
const router = useRouter()
const route = useRoute()

onMounted(() => {
  rateLimitStore.restoreFromStorage();
});

function startCountdown() {
  const update = () => {
    if (!lockedUntil.value) {
      lockoutActive.value = false
      countdownSeconds.value = 0
      return
    }
    const remaining = Math.ceil((new Date(lockedUntil.value).getTime() - Date.now()) / 1000)
    if (remaining <= 0) {
      lockoutActive.value = false
      countdownSeconds.value = 0
      return
    }
    countdownSeconds.value = remaining
    countdownTimer = setTimeout(update, 1000)
  }
  update()
}

function clearCountdown() {
  if (countdownTimer) {
    clearTimeout(countdownTimer)
    countdownTimer = null
  }
}

const handleLogin = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const data = await loginUser(email.value, password.value)
    if ('lockout' in data) {
      lockoutActive.value = true
      lockedUntil.value = data.lockout.lockedUntil
      startCountdown()
      return
    }
    authStore.setToken(data.token)
    authStore.setUser(data.user)
    if (data.user?.role) {
      try {
        const perms = await get<string[]>(`/api/v1/permissions/${data.user.role}`)
        authStore.setPermissions(perms)
        await authStore.syncPermissions((role) => get<string[]>(`/api/v1/permissions/${role}`))
      } catch (e) {
        console.error('Failed to fetch permissions:', e)
      }
    }
    clearCountdown()
    lockoutActive.value = false
    lockedUntil.value = null
    countdownSeconds.value = 0
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    router.push(redirect)
  } catch (err: any) {
    if (err?.error?.code === 'RATE_LIMITED') {
      rateLimitStore.setRateLimit(err.error.retryAfter);
      return;
    }
    console.error('Login failed:', err)
    errorMessage.value = err instanceof Error ? err.message : 'Login failed. Please check your credentials.'
  } finally {
    loading.value = false
  }
}

onUnmounted(() => {
  clearCountdown()
})
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

.login__form--disabled {
  opacity: 0.6;
  pointer-events: none;
}

.login__error {
  color: var(--color-danger);
  margin-top: 10px;
  font-size: var(--font-size-sm);
}

.login__link {
  margin-top: 15px;
}

.lockout-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 0.5rem;
  color: #991b1b;
  font-size: 0.875rem;
}

.lockout-icon {
  flex-shrink: 0;
}
</style>
