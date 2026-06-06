# RS-5: User Management UI — Reference Document

**Status**: planned
**Priority**: P2
**Effort**: Large
**Dependencies**: RS-4 (User Management API)

**References:**
- `01_ARCHITECT_REQUIREMENT.md` — Testing Guidelines, CI requirements, anti-patterns
- `02_ARCHITECT_DESIGN.md` — Role definitions, role hierarchy, Cypress setup
- `03_ARCHITECT_IMPLEMENTATION.md` — Implementation template structure

---

## Purpose

Create user management screens for project_admin and member roles. Admin sees all team users, member sees only users they created. Both use modal-based CRUD. This ticket builds the frontend UI layer for the User Management API (RS-4).

---

## Role Context (from 02_ARCHITECT_DESIGN.md)

| Role | Can Access `/users` | Can Create Users | Can Edit Users | Can Delete Users | Can Toggle Active |
|------|---------------------|------------------|----------------|------------------|-------------------|
| `super_admin` | No (sees `/super-admin/users`) | No (manual DB only) | No | No | Yes |
| `project_admin` | Yes | Yes (member, user) | All users | All users | Yes |
| `member` | Yes | Yes (user only) | Users they created | No | No |
| `user` | No | No | No | No | No |

---

## Files to Create/Modify

### New Files

#### `frontend/src/views/UserManagement.vue`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Manage Users                               [+ Create] │
├─────────────────────────────────────────────────────────┤
│  [Role filter ▼]  [Search name/email...        ]       │
├─────────────────────────────────────────────────────────┤
│  Name          │ Email           │ Role    │ Status    │
│  ├─────────────┼─────────────────┼─────────┼───────────┤
│  │ Alice       │ alice@...       │ Admin   │ Active    │
│  │ Bob         │ bob@...         │ Member  │ Active    │
│  │ Charlie     │ charlie@...     │ User    │ Deactivated│
│  └─────────────┴─────────────────┴─────────┴───────────┘
│                                    [Edit] [Delete] [Toggle]
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Header with "Manage Users" title
- Role filter dropdown (all roles, project_admin, member, user)
- Search input (name/email)
- "Create User" button (only visible for project_admin/member)
- User table with columns: Name, Email, Role, Created By, Status (Active/Deactivated), Actions
- Actions per row: Edit, Delete (project_admin only), Toggle Active (project_admin only)
- Loading skeletons during API calls
- Toast notifications for success/error
- Confirmation dialogs for delete and toggle-active

**Component structure:**
```vue
<template>
  <div>
    <h1>Manage Users</h1>
    <UserFilterBar @filter="applyFilters" />
    <CreateUserButton v-if="canCreate" @click="openCreateModal" />
    <UserTable :users="filteredUsers" @edit="openEditModal" @delete="confirmDelete" @toggle="confirmToggle" />
    <UserModal v-model="showModal" :mode="modalMode" :user="editingUser" @save="handleSave" />
  </div>
</template>
```

**API calls:**
```javascript
// Composables
function useUsers() {
  const users = ref([])
  const loading = ref(false)
  
  async function fetchUsers(filters = {}) {
    loading.value = true
    try {
      const params = new URLSearchParams(filters)
      const res = await fetch(`/api/users?${params}`)
      users.value = await res.json()
    } finally {
      loading.value = false
    }
  }
  
  return { users, loading, fetchUsers }
}

function useAuth() {
  const user = ref(JSON.parse(localStorage.getItem('vibecode_user') || '{}'))
  const canCreate = computed(() => ['project_admin', 'member'].includes(user.value.role))
  const canDelete = computed(() => user.value.role === 'project_admin')
  const canToggle = computed(() => user.value.role === 'project_admin')
  return { user, canCreate, canDelete, canToggle }
}
```

#### `frontend/src/views/SuperAdminUsers.vue`

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Super Admin — All Users                                │
├─────────────────────────────────────────────────────────┤
│  [Role filter ▼] [Status filter ▼] [Search...    ]     │
├─────────────────────────────────────────────────────────┤
│  Name          │ Email           │ Role    │ Status    │
│  ├─────────────┼─────────────────┼─────────┼───────────┤
│  │ Alice       │ alice@...       │ Admin   │ Active    │
│  │ Bob         │ bob@...         │ Member  │ Active    │
│  └─────────────┴─────────────────┴─────────┴───────────┘
│                                    [Toggle Active]
└─────────────────────────────────────────────────────────┘
```

**Features:**
- Separate view accessible only to super_admin role
- Full user list (no project scoping)
- Search/filter by role, status
- Activate/Deactivate buttons
- No create/delete (super_admins don't create users, they're created manually)

#### `frontend/src/components/UserModal.vue`

**Create mode fields:**
- Name (text input, required)
- Email (email input, required)
- Password (password input, required)
- Role (dropdown, options depend on creator role)
  - project_admin → ["member", "user"]
  - member → ["user"]

**Edit mode fields:**
- Name (text input, required)
- Note: Role is immutable, cannot be changed after assignment

**"Created By" field:**
- Mandatory for member/user roles
- Shows current user for self-registration
- Displayed as "Self-registered" for NULL user_created_by

**Component structure:**
```vue
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal-overlay" @click.self="close">
      <div class="modal">
        <h2>{{ isEdit ? 'Edit User' : 'Create User' }}</h2>
        <form @submit.prevent="handleSubmit">
          <input v-model="form.name" placeholder="Name" required />
          <input v-if="!isEdit" v-model="form.email" type="email" placeholder="Email" required />
          <input v-if="!isEdit" v-model="form.password" type="password" placeholder="Password" required />
          <select v-if="!isEdit && showRoleSelect" v-model="form.role">
            <option v-for="role in availableRoles" :key="role" :value="role">{{ formatRole(role) }}</option>
          </select>
          <div class="actions">
            <button type="submit">{{ isEdit ? 'Save' : 'Create' }}</button>
            <button type="button" @click="close">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
const props = defineProps({ modelValue: Boolean, mode: String, user: Object })
const emit = defineEmits(['update:modelValue', 'save'])

const isEdit = computed(() => props.mode === 'edit')
const currentUser = computed(() => JSON.parse(localStorage.getItem('vibecode_user') || '{}'))

const availableRoles = computed(() => {
  if (currentUser.value.role === 'project_admin') return ['member', 'user']
  if (currentUser.value.role === 'member') return ['user']
  return []
})

const showRoleSelect = computed(() => availableRoles.value.length > 0)

const form = ref({ name: '', email: '', password: '', role: 'user' })

function handleSubmit() {
  emit('save', { ...form.value, isEdit: isEdit.value, userId: props.user?.id })
}
</script>
```

### Modified Files

#### `frontend/src/router/index.ts`

**Add routes:**
```typescript
{
  path: '/users',
  name: 'UserManagement',
  component: () => import('../views/UserManagement.vue'),
  meta: { requiresAuth: true, allowedRoles: ['project_admin', 'member'] },
},
{
  path: '/super-admin/users',
  name: 'SuperAdminUsers',
  component: () => import('../views/SuperAdminUsers.vue'),
  meta: { requiresAuth: true, allowedRoles: ['super_admin'] },
},
```

**Update router guard:**
```typescript
router.beforeEach((to, _from, next) => {
  if (to.matched.some(record => record.meta.requiresAuth)) {
    if (!isAuthenticated()) {
      next({ name: 'Login', query: { redirect: to.fullPath } })
      return
    }
    
    const user = JSON.parse(localStorage.getItem('vibecode_user') || '{}')
    if (to.meta.allowedRoles && to.meta.allowedRoles.length > 0) {
      if (!to.meta.allowedRoles.includes(user.role)) {
        next({ name: 'Dashboard' })
        return
      }
    }
  }
  next()
})
```

#### `frontend/src/api/users.js`

**Add methods:**
```javascript
export async function listUsers(filters = {}) {
  const params = new URLSearchParams(filters)
  const response = await client.get(`/users?${params}`)
  return response.data
}

export async function createUser(data) {
  const response = await client.post('/users', data)
  return response.data
}

export async function updateUser(id, data) {
  const response = await client.put(`/users/${id}`, data)
  return response.data
}

export async function toggleUserActive(id) {
  const response = await client.patch(`/users/${id}/toggle-active`)
  return response.data
}

export async function deleteUser(id) {
  const response = await client.delete(`/users/${id}`)
  return response.data
}

export async function listAllUsers(filters = {}) {
  const params = new URLSearchParams(filters)
  const response = await client.get(`/users/super-admin?${params}`)
  return response.data
}
```

#### `frontend/src/stores/auth.js`

**Add helpers:**
```javascript
export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: ref(null),
    token: ref(null),
  }),
  getters: {
    role: (state) => state.user?.role || null,
    isActive: (state) => state.user?.isActive !== false,
    isProjectAdmin: (state) => state.user?.role === 'project_admin',
    isMember: (state) => state.user?.role === 'member',
    isUser: (state) => state.user?.role === 'user',
    isSuperAdmin: (state) => state.user?.role === 'super_admin',
    canAccess: (state) => (allowedRoles) => {
      if (!allowedRoles || allowedRoles.length === 0) return true
      return allowedRoles.includes(state.user?.role)
    },
    canCreateUser: (state) => ['project_admin', 'member'].includes(state.user?.role),
    canDeleteUser: (state) => state.user?.role === 'project_admin',
    canToggleUser: (state) => ['project_admin', 'super_admin'].includes(state.user?.role),
  },
})
```

#### `frontend/src/components/Navigation.vue`

**Update sidebar:**
```vue
<template>
  <nav>
    <router-link to="/dashboard">Dashboard</router-link>
    <router-link to="/projects">Projects</router-link>
    <router-link v-if="authStore.canAccess(['project_admin', 'member'])" to="/users">Manage Users</router-link>
    <router-link v-if="authStore.isSuperAdmin" to="/super-admin/users">Super Admin</router-link>
  </nav>
</template>
```

---

## Testing (from 01_ARCHITECT_REQUIREMENT.md)

### Component Tests

**`cypress/component/UserModal.cy.ts`:**
- [ ] Renders name, email, password, role fields for create mode
- [ ] Renders name field only for edit mode
- [ ] Role options: project_admin → ["member", "user"]
- [ ] Role options: member → ["user"]
- [ ] Role options: user → no role selection
- [ ] Submit creates user via API
- [ ] Submit edits user via API
- [ ] Cancel closes modal without saving

**`cypress/component/UserManagement.cy.ts`:**
- [ ] Renders user table with correct columns
- [ ] Shows "Create User" button for project_admin
- [ ] Shows "Create User" button for member
- [ ] Hides "Create User" button for user
- [ ] Shows delete/toggle buttons for project_admin
- [ ] Hides delete/toggle buttons for member/user
- [ ] Filters users by role dropdown
- [ ] Search filters by name/email
- [ ] Loading skeleton shown during API calls

### E2E Tests

**`cypress/e2e/04-roles.cy.ts`:**
- [ ] `project_admin` can access `/users` → 200, "Manage Users" visible
- [ ] `member` can access `/users` → 200, "Manage Users" visible
- [ ] `user` role cannot access `/users` → redirects to `/dashboard`
- [ ] `super_admin` can access `/super-admin/users` → 200
- [ ] Non-super-admin cannot access `/super-admin/users` → redirects
- [ ] `project_admin` can create `member` and `user` accounts
- [ ] `member` can create `user` accounts only
- [ ] `member` cannot create `member` accounts → 400 error
- [ ] `user` role cannot create any user accounts → Create button not visible
- [ ] `project_admin` can deactivate/reactivate users
- [ ] `project_admin` can update user names
- [ ] `user` role cannot update other users → 403

### Unit Tests (Backend, from 01_ARCHITECT_REQUIREMENT.md)
- [ ] `UserService.createUser()` with valid role hierarchy → returns user
- [ ] `UserService.createUser()` with invalid role → throws
- [ ] `UserService.listUsers()` scoped by creator
- [ ] `UserService.listAllUsers()` for super_admin → returns all users
- [ ] `UserService.updateUser()` name change → returns updated user
- [ ] `UserService.toggleUserActive()` → toggles is_active
- [ ] `UserService.deleteUser()` → succeeds for admin

---

## Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| **Role display** | Show human-readable roles ("Project Admin", "Member", "AI Agent") |
| **Immutable role** | Clearly communicate in UI — no role edit field in edit mode |
| **Created By** | Show "Self-registered" for NULL user_created_by |
| **Password** | Don't show password in list, only in create/edit modal |
| **Confirmation** | Delete and toggle-active need confirmation dialogs |
| **Loading states** | Show skeletons/spinners during API calls |
| **Error handling** | Show toast notifications for success/error |
| **authStore.user is a ref** | Must use `authStore.user.value` in script code (AGENTS.md bug #1) |

---

## CI Requirements (from 01_ARCHITECT_REQUIREMENT.md)

- [ ] `npm run lint` — no unused vars, no errors
- [ ] `npm run typecheck` — passes
- [ ] `npm run build` — passes
- [ ] Component tests pass: `npx cypress run --component`
- [ ] E2E tests pass: `npx cypress run --e2e`

---

*This reference follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Testing checklist, CI requirements, anti-patterns*
- *`02_ARCHITECT_DESIGN.md` → Role definitions, role hierarchy, permissions matrix*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
