import { createRouter, createWebHistory } from 'vue-router';

function isAuthenticated() {
  try {
    const token = localStorage.getItem('vibecode_token')
    return !!token
  } catch {
    return false
  }
}

function hasPermission(role: string | undefined, requiredPerm: string): boolean {
  if (!role) return false
  if (role === 'super_admin') return true
  const permsStr = localStorage.getItem('vibecode_permissions')
  if (!permsStr) return false
  try {
    const perms: string[] = JSON.parse(permsStr)
    return perms.includes(requiredPerm)
  } catch {
    return false
  }
}

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/Register.vue'),
  },
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue'),
    meta: { requiresAuth: true, requiredPermission: 'DASHBOARD_READ' },
  },
  {
    path: '/approvals',
    name: 'ApprovalsQueue',
    component: () => import('../views/ApprovalsQueue.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/billing',
    name: 'BillingDashboard',
    component: () => import('../views/BillingDashboard.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('../views/ProjectList.vue'),
    meta: { requiresAuth: true, requiredPermission: 'PROJECT_READ' },
  },
  {
    path: '/super-admin/users',
    name: 'SuperAdminUsers',
    component: () => import('../views/SuperAdminUsers.vue'),
    meta: { requiresAuth: true, requiredPermission: 'USER_VIEW_ALL' },
  },
  {
    path: '/users',
    name: 'UserManagement',
    component: () => import('../views/UserManagement.vue'),
    meta: { requiresAuth: true, requiredPermission: 'USER_READ' },
  },
  {
    path: '/projects/:id',
    name: 'ProjectDetail',
    component: () => import('../views/ProjectDetail.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: 'tickets',
        name: 'ProjectTickets',
        component: () => import('../views/TicketBoard.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'tickets/:ticketId',
        name: 'TicketDetail',
        component: () => import('../views/TicketDetail.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'ai',
        name: 'AIAssistant',
        component: () => import('../views/AIAssistant.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'approvals',
        name: 'ProjectApprovals',
        component: () => import('../views/ProjectApprovals.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'github',
        name: 'ProjectGitHub',
        component: () => import('../views/GitHubConnections.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'templates',
        name: 'ProjectTemplates',
        component: () => import('../views/ProjectTemplates.vue'),
        meta: { requiresAuth: true },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/projects',
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to, _from, next) => {
  if (to.matched.some(record => record.meta.requiresAuth)) {
    if (!isAuthenticated()) {
      next({ name: 'Login', query: { redirect: to.fullPath } })
      return
    }
    
    const userStr = localStorage.getItem('vibecode_user')
    if (userStr) {
      try {
        const user: Record<string, unknown> = JSON.parse(userStr)
        const requiredPermission = to.meta.requiredPermission as string | undefined
        if (requiredPermission) {
          const userRole = user.role as string | undefined
          if (!hasPermission(userRole, requiredPermission)) {
            next({ name: 'Dashboard' })
            return
          }
        }
      } catch (e) {
        console.error('Failed to parse user from localStorage:', e)
      }
    }
  }
  if (to.path === '/login' || to.path === '/register') {
    if (isAuthenticated()) {
      next({ path: '/dashboard' })
      return
    }
  }
  next()
})

export default router
