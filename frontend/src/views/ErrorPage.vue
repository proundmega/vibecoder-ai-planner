<script setup>
import { useRoute, useRouter } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
const router = useRouter()

const errorType = computed(() => {
  const code = route.query.error
  return code === '500' ? '500' : '404'
})

const title = computed(() => errorType.value === '500' ? 'Internal Server Error' : 'Page Not Found')
const message = computed(() => errorType.value === '500' ? 'Something went wrong. Please try again later.' : 'The page you are looking for does not exist.')
</script>

<template>
  <div class="error-page">
    <h1>{{ title }}</h1>
    <p>{{ message }}</p>
    <button @click="router.push('/dashboard')" class="btn-primary">Go to Dashboard</button>
  </div>
</template>

<style scoped>
.error-page {
  max-width: 600px;
  margin: 100px auto;
  text-align: center;
  padding: 20px;
}
.error-page h1 {
  font-size: 48px;
  color: #1f2937;
  margin-bottom: 16px;
}
.error-page p {
  color: #6b7280;
  margin-bottom: 24px;
}
</style>
