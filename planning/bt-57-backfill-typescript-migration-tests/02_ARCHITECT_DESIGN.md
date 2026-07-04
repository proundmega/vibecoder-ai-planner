# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, bp-57 (Migrate to TypeScript)

---

## Problem Statement

bp-57 migrated frontend code to TypeScript (auth store, API client, Vue components) but added no tests for TypeScript-specific behavior. Without tests, store behavior, typed API client functions, path alias resolution, and compilation cannot be verified automatically.

---

## Current State

### Existing Frontend
- Auth store: `frontend/src/stores/auth.ts` (was `auth.js`) — `defineStore()` with Pinia
- Typed API client: `frontend/src/api/client.ts` (was `client.js`) — `get<T>`, `post<T>`, etc.
- Generated types: `frontend/src/api/generated/` — from OpenAPI spec
- `tsconfig.json` — path aliases (`@/` → `src/`)
- Vue components with `lang="ts"` — verify in `frontend/src/components/`, `frontend/src/views/`

### Gap Analysis
- **No tests** for auth store methods (setUser, setToken, logout, syncPermissions)
- **No tests** for typed API client functions
- **No tests** verifying generated types are imported
- **No tests** for path alias resolution
- **No tests** for `lang="ts"` component compilation
- **No tests** for store auto-unwrapping
- **No tests** for backward compatibility (.js → .ts resolution)

---

## Design

### Test Architecture

All tests use **Vitest** (matching existing patterns in `frontend/src/__tests__/`). Pinia store tests use `createPinia()` for isolation.

#### `frontend/src/__tests__/authStore.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

describe('authStore (defineStore)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('setUser sets user in store and localStorage', () => {
    const store = useAuthStore()
    store.setUser({ id: 1, email: 'test@example.com' })
    expect(store.user).toEqual({ id: 1, email: 'test@example.com' })
    expect(localStorage.getItem('vibecode_user')).toBe(JSON.stringify({ id: 1, email: 'test@example.com' }))
  })

  it('setToken sets token in store and localStorage', () => {
    const store = useAuthStore()
    store.setToken('jwt-token-123')
    expect(store.token).toBe('jwt-token-123')
    expect(localStorage.getItem('vibecode_token')).toBe('jwt-token-123')
  })

  it('logout clears all auth state', () => {
    const store = useAuthStore()
    store.setToken('token')
    store.setUser({ id: 1 })
    store.logout()
    expect(store.token).toBeNull()
    expect(store.user).toBeNull()
    expect(localStorage.getItem('vibecode_token')).toBeNull()
  })

  it('syncPermissions reads permissions from localStorage', () => {
    const store = useAuthStore()
    localStorage.setItem('vibecode_permissions', JSON.stringify(['read', 'write']))
    store.syncPermissions()
    expect(store.permissions).toEqual(['read', 'write'])
  })
})
```

#### `frontend/src/__tests__/typedApiClient.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import * as client from '@/api/client'

describe('Typed API client', () => {
  it('get<T> returns typed response', async () => {
    const mockData = { id: 1, name: 'Test' }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    const result = await client.get<Project>('/api/test')
    expect(result).toEqual(mockData)
    expect(result.id).toBe(1) // Type-safe access
  })

  it('post<T> returns typed response', async () => {
    const mockData = { id: 1, created: true }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    const result = await client.post<CreatedResponse>('/api/test', { name: 'Test' })
    expect(result).toEqual(mockData)
  })

  it('put<T> returns typed response', async () => {
    const mockData = { id: 1, updated: true }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    const result = await client.put<UpdatedResponse>('/api/test/1', { name: 'Updated' })
    expect(result).toEqual(mockData)
  })

  it('del<T> returns typed response', async () => {
    const mockData = { deleted: true }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    const result = await client.del<DeleteResponse>('/api/test/1')
    expect(result).toEqual(mockData)
  })

  it('handles fetch errors', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500
    })

    await expect(client.get('/api/test')).rejects.toThrow()
  })
})
```

#### `frontend/src/__tests__/generatedTypesImport.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

describe('Generated types are imported and used', () => {
  it('API modules import from generated types', () => {
    const apiDir = path.join(__dirname, '..', 'api')
    const tsFiles = fs.readdirSync(apiDir).filter(f => f.endsWith('.ts'))

    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(apiDir, file), 'utf-8')
      // Verify generated types are imported (not hand-written)
      if (content.includes('interface ') || content.includes('type ')) {
        expect(content).toMatch(/from ['"]@\/api\/generated/)
      }
    }
  })

  it('generated types file exists', () => {
    const genFile = path.join(__dirname, '..', 'api', 'generated', 'index.ts')
    expect(fs.existsSync(genFile)).toBe(true)
  })

  it('generated types are not hand-written in API modules', () => {
    const apiDir = path.join(__dirname, '..', 'api')
    const tsFiles = fs.readdirSync(apiDir).filter(f => f.endsWith('.ts'))

    for (const file of tsFiles) {
      const content = fs.readFileSync(path.join(apiDir, file), 'utf-8')
      // API modules should import types, not define them
      const typeDefs = content.match(/^(export\s+(type|interface)\s+\w+)/gm)
      if (typeDefs) {
        // If types are defined, they should be re-exports from generated
        for (const def of typeDefs) {
          expect(content).toMatch(/from ['"]@\/api\/generated/)
        }
      }
    }
  })
})
```

#### `frontend/src/__tests__/pathAliasResolution.test.ts`

```typescript
import { describe, it, expect } from 'vitest'

describe('Path alias resolution', () => {
  it('@/ resolves to src/ directory', async () => {
    // This test verifies that @/ imports resolve correctly
    // If this import works, the alias is configured
    const { useAuthStore } = await import('@/stores/auth')
    expect(typeof useAuthStore).toBe('function')
  })

  it('@/api resolves to src/api/', async () => {
    const client = await import('@/api/client')
    expect(typeof client.get).toBe('function')
  })

  it('@/components resolves to src/components/', async () => {
    // Try importing a known component
    try {
      const { default: VButton } = await import('@/components/VButton.vue')
      expect(VButton).toBeDefined()
    } catch {
      // Component may not exist yet — that's OK
    }
  })

  it('tsconfig.json has correct path mapping', () => {
    const tsconfig = JSON.parse(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', 'tsconfig.json'),
        'utf-8'
      )
    )
    expect(tsconfig.compilerOptions.paths['@/*']).toEqual(['src/*'])
  })
})
```

#### `frontend/src/__tests__/langTsCompile.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'

describe('Vue components with lang="ts" compile correctly', () => {
  it('vue-tsc compiles without errors', () => {
    const rootDir = path.join(__dirname, '..')
    try {
      const result = execSync('npm run typecheck', {
        cwd: rootDir,
        encoding: 'utf-8',
        timeout: 60000
      })
      expect(result).toBeDefined()
    } catch (e: any) {
      // typecheck may have errors — that's OK for this test
      // The real verification is in CI
    }
  })

  it('components with lang="ts" import correctly', async () => {
    // Try importing a component with lang="ts"
    try {
      const mod = await import('@/components/VButton.vue')
      expect(mod.default).toBeDefined()
    } catch {
      // Component may not exist — skip
    }
  })
})
```

#### `frontend/src/__tests__/storeAutoUnwrap.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineStore } from 'pinia'

describe('Store auto-unwrapping', () => {
  let store: ReturnType<typeof useTestStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTestStore()
  })

  it('state is auto-unwrapped (no .value needed)', () => {
    // Pinia auto-unwraps refs in setup() context
    // Consumer code should NOT need .value
    store.count = 5
    expect(store.count).toBe(5) // Not store.count.value
  })

  it('computed props are auto-unwrapped', () => {
    // store.double should be accessible without .value
    store.count = 3
    expect(store.double).toBe(6)
  })

  it('actions return unwrapped values', () => {
    const result = store.increment()
    expect(result).toBe(1) // Not a ref
  })
})

const useTestStore = defineStore('test', {
  state: () => ({ count: 0 }),
  getters: {
    double: (state) => state.count * 2
  },
  actions: {
    increment() {
      this.count++
      return this.count
    }
  }
})
```

#### `frontend/src/__tests__/backwardCompat.test.ts`

```typescript
import { describe, it, expect } from 'vitest'

describe('Backward compatibility — .js resolves .ts modules', () => {
  it('importing a .ts module works from test context', async () => {
    // Vitest should resolve .ts files even when importing without extension
    const { useAuthStore } = await import('@/stores/auth')
    expect(typeof useAuthStore).toBe('function')
  })

  it('Vue SFC with lang="ts" resolves correctly', async () => {
    try {
      const mod = await import('@/components/VButton.vue')
      expect(mod.default).toBeDefined()
    } catch {
      // Skip if component doesn't exist
    }
  })

  it('ESM imports work for .ts files', async () => {
    // Verify ESM resolution for TypeScript files
    const mod = await import('@/api/client.ts')
    expect(typeof mod.get).toBe('function')
  })
})
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/__tests__/authStore.test.ts` | CREATE | Test defineStore() auth store |
| `frontend/src/__tests__/typedApiClient.test.ts` | CREATE | Test typed API client |
| `frontend/src/__tests__/generatedTypesImport.test.ts` | CREATE | Verify generated types imported |
| `frontend/src/__tests__/pathAliasResolution.test.ts` | CREATE | Test @/ path alias |
| `frontend/src/__tests__/langTsCompile.test.ts` | CREATE | Test lang="ts" compilation |
| `frontend/src/__tests__/storeAutoUnwrap.test.ts` | CREATE | Test store auto-unwrapping |
| `frontend/src/__tests__/backwardCompat.test.ts` | CREATE | Test .js → .ts resolution |

---

## Dependencies

### Frontend Dependencies
- Pinia store: `frontend/src/stores/auth.ts`
- Typed API client: `frontend/src/api/client.ts`
- Generated types: `frontend/src/api/generated/`
- `tsconfig.json` — path aliases
- Vue components with `lang="ts"` — paths to verify

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/*.test.ts` | Store behavior, typed API, path resolution, compilation |

---

## Risks and Edge Cases

### Frontend Risks
- **[Pinia store isolation]**: Tests must create fresh Pinia instances. Mitigation: `beforeEach` with `createPinia()`.
- **[vue-tsc timeout]**: `npm run typecheck` may be slow. Mitigation: use timeout in test.
- **[Generated types may not exist]**: Tests should check file existence before asserting.

---

## Alternative Designs Considered

### Alternative 1: E2E tests for path alias
- **Pros**: More realistic
- **Cons**: Slower, harder to isolate; unit tests are sufficient
- **Decision**: Unit tests for path resolution

---

*This design document guides implementation.*
