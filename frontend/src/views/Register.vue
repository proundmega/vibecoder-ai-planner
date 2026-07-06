<template>
  <div class="register">
    <h1 class="register__title">Create Account</h1>
    <form @submit.prevent="handleRegister" class="register__form">
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
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { registerUser } from '@/api/auth.js'
import { get } from '@/api/client.js'
import VInput from '@/components/VInput.vue'
import VButton from '@/components/VButton.vue'

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
    if (data.user?.role) {
      try {
        const perms = await get(`/api/v1/permissions/${data.user.role}`)
        authStore.setPermissions(perms)
        await authStore.syncPermissions((role) => get(`/api/v1/permissions/${role}`))
      } catch (e) {
        console.error('Failed to fetch permissions:', e)
      }
    }
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
</style>
