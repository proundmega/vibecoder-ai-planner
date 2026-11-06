# 03 — Implementation (bp-133)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** status/deferred scope (`00`), design (`02`).

## Plan

- [ ] FR1 — regenerate the frontend generated client and fix callers
- [ ] FR2 — numeric-string OpenAPI id formats and a guard test
- [ ] FR3 — exclude soft-deleted users from `listUsers`
- [ ] FR4 — project-membership checks for ticket writes (separate review)

## Per-file changes (expected)

| File | Action | Change |
|---|---|---|
| `frontend/src/api/generated/**` | regenerate | Current camelCase/string-id contracts |
| `backend/src/api/openapi-spec.js` | modify | `NumericId` for route/body BIGSERIAL ids |
| `backend/src/api/openapi-generated.json` | regenerate | Reflect the spec change |
| `backend/src/services/UserService.js` | modify | `deleted_at IS NULL` in `listUsers` |
| `backend/src/services/TicketService.js` | modify | Project membership/owner/admin checks |
| `backend/src/__tests__/` | add/modify | Regression tests for FR1-FR4 |
| `frontend/src/__tests__/api-contract.test.ts` | modify | Generated-type/spec alignment where applicable |

Exact file operations are intentionally deferred to the implementing slice; see
`02` for the design.

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Frontend build | `frontend/src/api/generated/**` | regenerate and commit; typecheck/build clean | `npm run generate:api && npm run typecheck` |
| FR2 | API contract | `backend/src/__tests__/openapiTicketContract.test.js` | no BIGSERIAL id documented as `uuid` | `npm test` |
| FR3 | Backend service | `backend/src/__tests__/userService.test.js` | deleted user excluded from `listUsers` | `npm test` |
| FR4 | Backend route | `backend/src/__tests__/ticket_ownership_controller.test.js` | non-member rejected; owner/member/admin allowed | `npm test` |

## Review record

No review rounds yet.
