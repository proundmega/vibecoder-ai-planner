<template>
  <div class="app">
    <nav v-if="showNav" class="navbar">
      <div class="navbar-inner">
        <router-link to="/projects" class="nav-brand">AI Planner</router-link>
        <div class="nav-links">
          <router-link to="/dashboard" class="nav-link">Dashboard</router-link>
          <router-link to="/projects" class="nav-link">Projects</router-link>
          <router-link to="/approvals" class="nav-link">Approvals</router-link>
          <router-link v-if="showBillingLink" to="/billing" class="nav-link">Billing</router-link>
          <router-link v-if="showUsersLink" to="/users" class="nav-link">Users</router-link>
          <router-link v-if="showSuperAdminLink" to="/super-admin/users" class="nav-link">Super Admin</router-link>
        </div>
        <div class="nav-right">
          <span class="nav-user">{{ authStore.user?.value?.name || 'User' }}</span>
          <VButton variant="ghost" size="small" @click="handleLogout">Logout</VButton>
        </div>
      </div>
    </nav>
    <nav v-else class="navbar auth-nav">
      <div class="navbar-inner">
        <router-link to="/projects" class="nav-brand">AI Planner</router-link>
        <div class="nav-links">
          <router-link to="/login" class="nav-link">Sign In</router-link>
          <router-link to="/register" class="nav-link">Register</router-link>
        </div>
      </div>
    </nav>
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { get } from '@/api/client.js'
import VButton from '@/components/VButton.vue'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

onMounted(async () => {
  if (authStore.user.value?.role) {
    try {
      await authStore.syncPermissions((role) => get(`/api/v1/permissions/${role}`))
    } catch (e) {
      console.error('Failed to sync permissions on mount:', e)
    }
  }
})

const showNav = computed(() => !['/login', '/register'].includes(route.path))

const showUsersLink = computed(() => {
  if (!authStore.user.value) return false
  return authStore.canAccessUsers()
})

const showSuperAdminLink = computed(() => authStore.isSuperAdmin())
const showBillingLink = computed(() => authStore.isProjectAdmin())

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}
</script>

<style>
body {
  font-family: var(--font-family);
  background: var(--color-bg-secondary);
  color: var(--color-text);
}

.app {
  min-height: 100vh;
}

.navbar {
  background: var(--color-nav-bg);
  box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}

.navbar-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-brand {
  color: white;
  font-size: var(--font-size-lg);
  font-weight: 700;
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 24px;
}

.nav-link {
  color: var(--color-nav-text);
  text-decoration: none;
  font-size: var(--font-size-base);
  font-weight: 500;
  padding: 6px 0;
  border-bottom: 2px solid transparent;
  transition: color var(--transition-fast);
}

.nav-link:hover,
.nav-link.router-link-active {
  color: white;
  border-bottom-color: var(--color-primary);
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-user {
  color: var(--color-nav-active);
  font-size: var(--font-size-base);
}
</style>
