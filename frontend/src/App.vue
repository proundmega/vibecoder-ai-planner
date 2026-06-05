<template>
  <div class="app">
    <nav v-if="showNav" class="navbar">
      <div class="navbar-inner">
        <router-link to="/projects" class="nav-brand">AI Planner</router-link>
        <div class="nav-links">
          <router-link to="/dashboard" class="nav-link">Dashboard</router-link>
          <router-link to="/projects" class="nav-link">Projects</router-link>
          <router-link v-if="showUsersLink" to="/users" class="nav-link">Users</router-link>
        </div>
        <div class="nav-right">
          <span class="nav-user">{{ authStore.user?.value?.name || 'User' }}</span>
          <button @click="handleLogout" class="nav-logout">Logout</button>
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

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

const showNav = computed(() => !['/login', '/register'].includes(route.path))

const showUsersLink = computed(() => {
  const user = authStore.user?.value
  if (!user) return false
  return ['project_admin', 'member', 'super_admin'].includes(user.role)
})

const handleLogout = () => {
  authStore.logout()
  router.push('/login')
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: #f5f5f5;
  color: #1a1a1a;
}

.app {
  min-height: 100vh;
}

.navbar {
  background: #1e293b;
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
  font-size: 18px;
  font-weight: 700;
  text-decoration: none;
}

.nav-links {
  display: flex;
  gap: 24px;
}

.nav-link {
  color: #94a3b8;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  padding: 6px 0;
  border-bottom: 2px solid transparent;
  transition: color 0.15s;
}

.nav-link:hover,
.nav-link.router-link-active {
  color: white;
  border-bottom-color: #3b82f6;
}

.nav-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nav-user {
  color: #cbd5e1;
  font-size: 14px;
}

.nav-logout {
  padding: 6px 14px;
  background: transparent;
  color: #94a3b8;
  border: 1px solid #475569;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.nav-logout:hover {
  background: #ef4444;
  border-color: #ef4444;
  color: white;
}
</style>
