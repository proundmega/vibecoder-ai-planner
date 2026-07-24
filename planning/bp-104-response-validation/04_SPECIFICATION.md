# 04_SPECIFICATION.md — Response Validation Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2025-07-24

---

## Test-First Requirement

**Test stub files MUST be created before any production code.**

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation + components)
3. Fill in the test stubs with actual assertions

---

## File Operations

### MODIFY: `frontend/src/views/Login.vue`

**Add import** after existing imports:
```typescript
import { validateApiResponse, validateSchema } from '@/api/validator'
```

**Update the login function** — find the line that calls `/auth/me` and add validation:

Before:
```typescript
const me = await get<User>('/api/auth/me')
```

After:
```typescript
const me = await get<User>('/api/auth/me', { validate: validateSchema('User') })
```

**Wrap in try/catch** — if the current code doesn't have error handling for the `/auth/me` call, add it:

```typescript
try {
  const me = await get<User>('/api/auth/me', { validate: validateSchema('User') })
  authStore.setUser(me)
  // ... rest of success logic
} catch (error) {
  if (error instanceof Error && error.message.includes('validation failed')) {
    console.error('Response validation failed:', error.message)
    errorMessage.value = 'Failed to load user data. Please try again.'
  }
  throw error
}
```

### MODIFY: `frontend/src/views/Register.vue`

**Add import** after existing imports:
```typescript
import { validateApiResponse, validateSchema } from '@/api/validator'
```

**Update the registration function** — find the line that calls `/auth/me` and add validation (same pattern as Login.vue).

### MODIFY: `frontend/src/App.vue`

**Add import** after existing imports:
```typescript
import { validateApiResponse } from '@/api/validator'
```

**Update the permission sync call** in `onMounted`:

Before:
```typescript
await authStore.syncPermissions((role) => get(`/api/v1/permissions/${role}`))
```

After:
```typescript
await authStore.syncPermissions((role) => get(`/api/v1/permissions/${role}`, { validate: validateApiResponse }))
```

### MODIFY: `frontend/src/__tests__/api-contract.test.ts`

**Add test cases**:

```typescript
describe('Response Validation', () => {
  it('validateSchema("User") passes for valid User response', () => {
    const validator = validateSchema('User')
    const errors = validator(validUser)
    expect(errors.length).toBe(0)
  })

  it('validateSchema("User") catches missing required fields', () => {
    const validator = validateSchema('User')
    const errors = validator(invalidUser)
    expect(errors.length).toBeGreaterThan(0)
  })
})
```

---

## Test Expectations

### Frontend Unit Tests — Response Validation
```
✓ [happy] validateSchema('User') passes for valid User response
✓ [happy] validateSchema('User') catches missing required fields
✓ [happy] validateApiResponse passes for valid API response
✓ [happy] validateApiResponse catches missing success/data fields
✓ [edge] Validation errors are caught and don't crash UI
```

---

## Edge Cases to Handle

1. **[Existing API calls break]**: If backend changes response shape, validation will throw. This is desired — catch breaking changes early in development.
2. **[Optional fields missing]**: Schemas use `required` arrays. Fields not in `required` are optional. Existing backend responses should match schemas.
3. **[Extra fields in response]**: Schemas only check for required fields and expected types. Extra fields are allowed (forward compatible).

---

## Existing Code Patterns to Follow

- Frontend uses TypeScript + Vue 3 Composition API
- API calls use `get()`, `post()` from `@/api/client`
- Error handling: catch errors, set `errorMessage.value`, show UI message
- Validation functions: `validateSchema('User')`, `validateApiResponse`

---

## Pending Scope Items

**All deferred improvements from previous tickets' "Out of Scope" sections that are relevant to this ticket have been presented to the user in the 01/02/03 documents above.**

---

## Files NOT to Change

- `frontend/src/api/validator.ts` — schemas already match backend responses
- `frontend/src/api/client.ts` — validation plumbing already exists
- `backend/` — no backend changes needed

---

*This specification is the contract between planning and execution.*
