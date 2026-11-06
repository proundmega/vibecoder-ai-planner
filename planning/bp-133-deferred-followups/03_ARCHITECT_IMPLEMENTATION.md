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
| `backend/src/api/*.js` | modify | Route JSDoc: `NumericId` for BIGSERIAL path/body ids (tickets, projects, users, agents, approvals, credentials, github, ...) |
| `backend/src/api/openapi-spec.js` | modify | Keep the legitimate `milestoneId` UUID; scan the updated route JSDoc |
| `backend/src/api/openapi-generated.json` | regenerate | Reflect the spec change |
| `backend/src/services/UserService.js` | modify | `deleted_at IS NULL` in `listUsers` and `listAllUsers` |
| `backend/src/services/TicketService.js` | modify | Accept the normalized actor in `update`/`pickUpTicket`/`releaseTicket`; project membership/owner/admin checks |
| `backend/src/controllers/ticketController.js` | modify | Pass `{ agentId, operatorId, role }` to pickup/release/update |
| `backend/src/__tests__/openapiTicketContract.test.js` | modify | Scan `specs.paths` for BIGSERIAL ids, not only component schemas |
| `backend/src/__tests__/` | add/modify | Regression tests for FR1-FR4 |
| `frontend/src/__tests__/api-contract.test.ts` | modify | Generated-type/spec alignment where applicable |

Exact file operations are intentionally deferred to the implementing slice; see
`02` for the design.

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Frontend build | `frontend/src/api/generated/**` | regenerate and commit; typecheck/build clean | `npm run generate:api && npm run typecheck` |
| FR2 | API contract | `backend/src/__tests__/openapiTicketContract.test.js` | route path/body BIGSERIAL ids are not documented as `uuid` | `npm test` |
| FR3 | Backend service | `backend/src/__tests__/userService.test.js` | deleted user excluded from `listUsers` and `listAllUsers` | `npm test` |
| FR4 | Backend route/service | `backend/src/__tests__/ticket_ownership_controller.test.js`, `ticketReleaseAuthorization.test.js` | non-member rejected; owner/member/admin allowed for update, pickup and release | `npm test` |

## Review record

No review rounds yet.
