# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: Architect + Technical templates
**Target model**: 7B–34B local model (e.g., CodeLlama, Qwen, DeepSeek-Coder)
**Date**: YYYY-MM-DD

## File Operations

Each entry specifies exactly what the model should produce. The model MUST NOT create,
modify, or delete any file not listed here.

### CREATE: `frontend/src/components/Login.vue`

**Imports** (exact):
```
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
```

**State variables** (exact names and types):
```
email: ref('')                  → bound to email input via v-model
password: ref('')               → bound to password input via v-model
error: ref<string | null>(null) → displayed when login fails
loading: ref(false)             → disables submit button while true
```

**Functions** (exact signatures):
```
async function handleSubmit(): Promise<void>
  1. if (!email.value || !password.value) return (form validation)
  2. loading.value = true
  3. error.value = null
  4. try:
        await authStore.login(email.value, password.value)
        router.push('/dashboard')
      catch (err):
        error.value = err.message || 'Login failed'
      finally:
        loading.value = false
```

**Template structure** (exact hierarchy):
```
<form @submit.prevent="handleSubmit">
  <div>
    <label for="email">Email</label>
    <input id="email" v-model="email" type="email" required />
  </div>
  <div>
    <label for="password">Password</label>
    <input id="password" v-model="password" type="password" required />
  </div>
  <button type="submit" :disabled="loading">
    {{ loading ? 'Signing in...' : 'Sign In' }}
  </button>
  <p v-if="error" class="error">{{ error }}</p>
</form>
```

**Styling**: Use scoped CSS, no external classes. Form centered, inputs full-width, error text red.

### MODIFY: `frontend/src/stores/auth.js`

**Add method**: `async login(email: string, password: string): Promise<void>`
```
Logic:
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!response.ok) throw new Error((await response.json()).error)
  const data = await response.json()
  this.setToken(data.token)
  this.setUser(data.user)
  this.setPermissions(data.permissions || [])
```

**Position in file**: Add after `logout()` method, before `isAuthenticated()`.

### MODIFY: `frontend/src/api/client.js`

**No changes needed** for this ticket.

## Test Expectations

### Login.vue
```
✓ Renders email input, password input, submit button
✓ Shows error message when login fails (mock API returns 401)
✓ Calls authStore.login with correct email and password on submit
✓ Redirects to /dashboard on successful login
✓ Disables submit button while loading
✓ Does not submit if email or password is empty
```

### auth store login()
```
✓ Stores token in localStorage under 'vibecode_token'
✓ Stores user in localStorage under 'vibecode_user'
✓ Throws readable error on non-ok response
✓ Stores permissions if returned
```

## Edge Cases to Handle
1. **Network error**: fetch throws → catch block shows "Unable to connect. Please try again."
2. **Already logged in**: component checks `authStore.isAuthenticated()` on mount → redirect to /dashboard
3. **Token expiry after login**: Not handled in this ticket (separate concern)
4. **Double submit**: loading flag prevents multiple simultaneous submissions
5. **Browser autofill**: No special handling needed — browser handles it natively

## Existing Code Patterns to Follow
- Use `<script setup>` syntax (Composition API), not Options API
- Import from `@/stores/auth` not relative paths
- Error messages in English, stored as strings not translated (i18n not set up yet)
- No TypeScript in .vue files (project uses .ts for stores/API, .vue files are plain JS)
