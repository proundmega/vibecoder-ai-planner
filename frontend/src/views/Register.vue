<template>
  <div class="register">
    <h1 class="register__title">Create Account</h1>
    <RateLimitBanner />
    <form @submit.prevent="handleRegister" class="register__form" :class="{ 'register__form--disabled': isRateLimited }">
      <VInput
        v-model="name"
        type="text"
        label="Name"
        placeholder="Name"
        required
        :disabled="isRateLimited"
      />
      <VInput
        v-model="email"
        type="email"
        label="Email"
        placeholder="Email"
        required
        :disabled="isRateLimited"
      />
      <VInput
        v-model="password"
        type="password"
        label="Password"
        placeholder="Password (min 6 chars)"
        required
        minlength="6"
        :disabled="isRateLimited"
      />
      <VButton
        type="submit"
        variant="primary"
        :loading="loading"
        :disabled="isRateLimited"
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
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useRateLimitStore } from '@/stores/rateLimit'
import { registerUser } from '@/api/auth'
import { get } from '@/api/client'
import { validateSchema } from '@/api/validator'
import VInput from '@/components/VInput.vue'
import VButton from '@/components/VButton.vue'
import RateLimitBanner from '@/components/RateLimitBanner.vue'

const name = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')
const authStore = useAuthStore()
const rateLimitStore = useRateLimitStore()
const router = useRouter()
const isRateLimited = computed(() => rateLimitStore.rateLimitActive.value)

onMounted(() => {
  rateLimitStore.restoreFromStorage();
});

const handleRegister = async () => {
  loading.value = true
  errorMessage.value = ''

  try {
    const data = await registerUser(name.value, email.value, password.value)
    try {
      const validateUser = validateSchema('User')
      validateUser(data.user)
    } catch (validationError) {
      console.error('User validation failed:', validationError)
      errorMessage.value = 'Failed to load user data. Please try again.'
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
</style>
