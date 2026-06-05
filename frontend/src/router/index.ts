import { createRouter, createWebHistory } from 'vue-router';

function isAuthenticated() {
  try {
    const token = localStorage.getItem('vibecode_token')
    return !!token
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
    meta: { requiresAuth: true },
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('../views/ProjectList.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/users',
    name: 'UserManagement',
    component: () => import('../views/UserManagement.vue'),
    meta: { requiresAuth: true, allowedRoles: ['project_admin', 'member', 'super_admin'] },
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
        const user = JSON.parse(userStr)
        if (to.meta.allowedRoles && to.meta.allowedRoles.length > 0) {
          if (!to.meta.allowedRoles.includes(user.role)) {
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
