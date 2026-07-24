# 02_ARCHITECT_DESIGN.md — Response Validation Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

The frontend API client supports optional response validation (`validate` option in `ApiOptions`), and the validator module has `validateSchema()` and `validateApiResponseStrict()`. But no frontend code uses them. API response shape changes go undetected until runtime.

---

## Design

### Approach: Opt-in Validation on Critical Endpoints

Add `validate` option to critical API calls in views. Wrap in try/catch to log errors without crashing.

#### Auth Store

The auth store reads from localStorage (tokens stored after login). Validation should be added where the token is initially set:

- `Login.vue` — after login, validate `/auth/me` response
- `Register.vue` — after registration, validate `/auth/me` response
- `App.vue` — on mount, validate permissions response

#### Critical API Calls to Add Validation

| File | Endpoint | Schema |
|------|----------|--------|
| `Login.vue` | POST `/auth/login` | `validateApiResponse` |
| `Register.vue` | POST `/auth/register` | `validateApiResponse` |
| `Login.vue` | GET `/auth/me` | `validateSchema('User')` |
| `App.vue` | GET `/api/v1/permissions/{role}` | `validateApiResponse` |

### Validation Error Handling

Validation errors throw `Error` with message like `"User validation failed: root.id: required field missing"`. Views catch these, log them to console, and show a user-friendly error message.

```typescript
try {
  const user = await get<User>('/auth/me', { validate: validateSchema('User') })
  authStore.setUser(user)
} catch (error) {
  if (error instanceof Error && error.message.includes('validation failed')) {
    console.error('Response validation failed:', error.message)
    errorMessage.value = 'Failed to load user data. Please try again.'
  }
}
```

### Validator Schemas

The existing schemas in `validator.ts` already match backend responses. No schema changes needed.

---

## Risks and Edge Cases

- **[Existing API calls break]**: If backend changes response shape, validation will throw. This is the desired behavior — we want to catch breaking changes early.
- **[Optional fields missing]**: Schemas use `required` arrays. Fields not in `required` are optional. Existing backend responses should match schemas.
- **[Extra fields in response]**: Schemas only check for required fields and expected types. Extra fields are allowed (forward compatible).

---

## Alternative Designs Considered

### Alternative 1: Global response interceptor
- **Pros**: One place, all requests validated
- **Cons**: Hard to disable for specific endpoints, higher overhead
- **Decision**: Opt-in on critical endpoints is safer for gradual rollout

### Alternative 2: Backend-only validation
- **Pros**: Single source of truth
- **Cons**: Frontend needs to know expected shapes for UX
- **Decision**: Frontend validation catches frontend issues (e.g., parsing errors), backend validation catches API contract issues

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations
- [ ] Test expectations are specific
- [ ] Pending scope items presented to user

---

*This design document guides implementation.*
