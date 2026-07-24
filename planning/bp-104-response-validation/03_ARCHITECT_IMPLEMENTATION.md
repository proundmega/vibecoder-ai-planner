# 03_ARCHITECT_IMPLEMENTATION.md — Response Validation Implementation Plan

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `04_SPECIFICATION.md`

---

## Implementation Phases

### Phase 1: Add validation to Login.vue

**MODIFY**: `frontend/src/views/Login.vue`

Add import for validator:
```typescript
import { validateApiResponse, validateSchema } from '@/api/validator'
```

Update the login function to use validation on `/auth/me`:
```typescript
const me = await get<User>('/api/auth/me', { validate: validateSchema('User') })
```

### Phase 2: Add validation to Register.vue

**MODIFY**: `frontend/src/views/Register.vue`

Add import for validator:
```typescript
import { validateApiResponse, validateSchema } from '@/api/validator'
```

Update the registration function to use validation on `/auth/me`:
```typescript
const me = await get<User>('/api/auth/me', { validate: validateSchema('User') })
```

### Phase 3: Add validation to App.vue

**MODIFY**: `frontend/src/App.vue`

Add import for validator:
```typescript
import { validateApiResponse } from '@/api/validator'
```

Update the permission sync call:
```typescript
await authStore.syncPermissions((role) => get(`/api/v1/permissions/${role}`, { validate: validateApiResponse }))
```

### Phase 4: Tests

**MODIFY**: `frontend/src/__tests__/api-contract.test.ts`

Add tests:
- Validation catches missing required fields
- Validation passes for valid responses

### Phase 5: Verify & Build

1. Run `cd frontend && npm test -- --run` — verify tests pass
2. Run `cd frontend && npm run typecheck` — verify no type errors
3. Run `cd frontend && npm run build` — verify build succeeds

---

## Files Changed

```
frontend/src/views/Login.vue          → MODIFY (add validation to /auth/me call)
frontend/src/views/Register.vue       → MODIFY (add validation to /auth/me call)
frontend/src/App.vue                  → MODIFY (add validation to permissions call)
frontend/src/__tests__/api-contract.test.ts → MODIFY (add validation tests)
```

---

### i) Code Review Checklist

- [ ] Login.vue validates `/auth/me` response against User schema
- [ ] Register.vue validates `/auth/me` response against User schema
- [ ] App.vue validates permissions response
- [ ] Validation errors are caught and logged (don't crash UI)
- [ ] All existing tests still pass
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds

### j) Post-Deploy Verification

1. [ ] Frontend: `npm test -- --run` passes
2. [ ] Frontend: `npm run typecheck` passes
3. [ ] Frontend: `npm run build` succeeds
4. [ ] Login flow works with validation
5. [ ] Registration flow works with validation
6. [ ] Permission sync works with validation

---

*Fill in all sections before starting implementation.*
