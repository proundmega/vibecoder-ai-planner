<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()

onMounted(() => {
  router.push(`/projects/${route.params.id}/tickets`)
})
</script>

<template>
  <div class="project-detail">
    <p>Redirecting...</p>
  </div>
</template>

<style scoped>
.project-detail {
  padding: 20px;
  text-align: center;
  color: #6b7280;
}
</style>
