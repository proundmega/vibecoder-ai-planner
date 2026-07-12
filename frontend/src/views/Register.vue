<template>
  <div class="register">
    <h1 class="register__title">Create Account</h1>
    <div v-if="rateLimitStore.rateLimitActive" class="rate-limit-banner">
      <svg class="rate-limit-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>Too many requests. Try again in {{ Math.floor(Number(rateLimitStore.countdownSeconds) / 60) }}m {{ Number(rateLimitStore.countdownSeconds) % 60 }}s.</span>
    </div>
    <form @submit.prevent="handleRegister" class="register__form" :class="{ 'register__form--disabled': rateLimitStore.rateLimitActive }">
      <VInput
        v-model="name"
        type="text"
        label="Name"
        placeholder="Name"
        required
      />
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
        placeholder="Password (min 6 chars)"
        required
        minlength="6"
      />
      <VButton
        type="submit"
        variant="primary"
        :loading="loading"
        full-width
      >
        {{ loading ? 'Creating...' : 'Register' }}
      </VButton>
      <p v-if="errorMessage" class="register__error">{{ errorMessage }}</p>
    </form>
    <p class="register__link">
      <router-link to="/login">Already have an account? Login</router-link>
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRateLimitStore } from '@/stores/rateLimit'
import { registerUser } from '@/api/auth'
import { get } from '@/api/client'
import VInput from '@/components/VInput.vue'
import VButton from '@/components/VButton.vue'

const name = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const authStore = useAuthStore()
const rateLimitStore = useRateLimitStore()
const router = useRouter()

onMounted(() => {
  rateLimitStore.restoreFromStorage();
});

const handleRegister = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const data = await registerUser(name.value, email.value, password.value)
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
    router.push('/dashboard')
  } catch (err: any) {
    if (err?.error?.code === 'RATE_LIMITED') {
      rateLimitStore.setRateLimit(err.error.retryAfter);
      return;
    }
    console.error('Registration failed:', err)
    errorMessage.value = err instanceof Error ? err.message : 'Registration failed. Please try again.'
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

.register__title {
  margin-bottom: 20px;
  color: var(--color-text);
}

.register__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.register__error {
  color: var(--color-danger);
  margin-top: 10px;
  font-size: var(--font-size-sm);
}

.register__link {
  margin-top: 15px;
}

.register__form--disabled {
  opacity: 0.6;
  pointer-events: none;
}

.rate-limit-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 0.5rem;
  color: #92400e;
  font-size: 0.875rem;
}

.rate-limit-icon {
  flex-shrink: 0;
}
</style>
