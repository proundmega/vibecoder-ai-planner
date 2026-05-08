import { createRouter, createWebHistory } from 'vue-router';
import { definePage } from '../composables/usePage';

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
    redirect: '/projects',
  },
  {
    path: '/projects',
    name: 'Projects',
    component: () => import('../views/ProjectList.vue'),
    children: [
      {
        path: ':id',
        name: 'ProjectDetail',
        component: () => import('../views/ProjectDetail.vue'),
        children: [
          {
            path: 'tickets',
            name: 'ProjectTickets',
            component: () => import('../views/TicketBoard.vue'),
          },
          {
            path: 'tickets/:ticketId',
            name: 'TicketDetail',
            component: () => import('../views/TicketDetail.vue'),
          },
          {
            path: 'ai',
            name: 'AIAssistant',
            component: () => import('../views/AIAssistant.vue'),
          },
        ],
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

export default router;
