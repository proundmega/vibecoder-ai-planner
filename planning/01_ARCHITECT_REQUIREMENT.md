# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: {{planned | in_progress | completed}}
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: {{Frontend | Backend | Both}}
**Priority**: {{P0 | P1 | P2 | P3 | P4}}
**Effort**: {{Small | Medium | Large}}

---

## Requirement

[What is being built? What problem does it solve? What value does it deliver?]

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [ ] API route exists: `{{backend/src/api/}}` — {{YES/NO}}
- [ ] Controller exists: `{{backend/src/controllers/}}` — {{YES/NO}}
- [ ] Service exists: `{{backend/src/services/}}` — {{YES/NO}}
- [ ] Model exists: `{{backend/src/models/}}` — {{YES/NO}}
- [ ] Validator exists: `{{backend/src/validators/}}` — {{YES/NO}}
- [ ] Route is mounted: `{{backend/src/api/routes.js or backend/src/api/v1/index.js}}` — {{YES/NO}}
- [ ] OpenAPI JSDoc annotations exist — {{YES/NO}}

### Frontend API Client Check
- [ ] API client exists: `{{frontend/src/api/}}` — {{YES/NO}}
- [ ] API client functions cover all needed endpoints — {{YES/NO}}
- [ ] API client follows existing patterns (`get`, `post`, `put`, `del`, `patch`) — {{verify}}

### Frontend UI Check
- [ ] View component exists: `{{frontend/src/views/}}` — {{YES/NO}}
- [ ] Component exists: `{{frontend/src/components/}}` — {{YES/NO}}
- [ ] Route exists: `{{frontend/src/router/index.ts}}` — {{YES/NO}}
- [ ] Existing tab/section where this can be added — {{e.g., ProjectDetail.vue tabs}}
- [ ] Existing modal/pattern to extend — {{e.g., TicketEditModal, UserModal}}

### Integration Check
- [ ] Frontend API client can call existing backend endpoints — {{YES/NO}}
- [ ] Response shapes match (snake_case vs camelCase) — {{verify}}
- [ ] Auth tokens are used correctly — {{verify}}
- [ ] Error handling matches existing patterns — {{verify}}

### Key Insight

[If the backend API already exists but the frontend UI doesn't, the task is FRONTEND-ONLY.
 If the frontend UI exists but the backend doesn't, the task is BACKEND-FIRST then FRONTEND.
 If both exist, the task might be extending existing code.
 If neither exists, plan both.]

**Example**: "The GitHub integration API (`/api/v1/github/*`) already exists in the backend.
 No frontend API client or UI exists. This is a FRONTEND-ONLY task: create API clients in `frontend/src/api/github.js`
 and add a GitHub tab to `frontend/src/views/ProjectDetail.vue` next to the existing tabs."

---

## Scope

### In Scope
- [What will be built/changed]
- [Which files will be created/modified]
- [Which existing patterns will be reused]

### Out of Scope
- [What is explicitly NOT included]
- [What is deferred to a future ticket]

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/...` | CREATE / MODIFY / NONE | What specifically changes |
| `frontend/src/...` | CREATE / MODIFY / NONE | What specifically changes |
| `database` | NEW MIGRATION / NONE | What columns/tables |
| `config` | NEW ENV VAR / NONE | Which vars |

---

## Known Unknowns

Things that could change the approach if the answer is different from assumed:

1. **[Unknown]**: What we don't know — how to resolve it before/during implementation
2. **[Unknown]**: What we don't know — how to resolve it before/during implementation

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation. List only items that genuinely need user input.

1. [Decision description] — {{options if multiple valid choices}}
2. [Decision description] — {{options if multiple valid choices}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend API] The API endpoint `METHOD /path` returns correct response shape
2. [ ] [Backend API] The API endpoint validates input and returns proper error codes
3. [ ] [Backend API] The API endpoint is authenticated and authorized correctly
4. [ ] [Backend API] Unit tests pass for the new controller/service
5. [ ] [Backend API] Integration tests pass for the new endpoint
6. [ ] [Frontend API] The API client function calls the correct backend endpoint
7. [ ] [Frontend API] The API client handles errors consistently with existing clients
8. [ ] [Frontend UI] The UI component renders correctly with mock data
9. [ ] [Frontend UI] The UI component handles loading, error, and empty states
10. [ ] [Frontend UI] The UI component is accessible and follows existing styles
11. [ ] [Frontend UI] The UI component integrates with existing navigation/routing
12. [ ] [Frontend UI] The UI component uses existing patterns (modals, tabs, cards)
13. [ ] [Both] OpenAPI spec is updated with JSDoc annotations
14. [ ] [Both] Generated TypeScript types are regenerated and match
15. [ ] [Both] All tests pass (unit, integration, frontend, lint, typecheck)
16. [ ] [Both] Specification in `04_SPECIFICATION.md` accurately reflects the implementation

---

## Out of Scope

- [What is explicitly NOT included in this ticket]
- [What is deferred to a future ticket]
- [What existing code will NOT be changed]

---

## Performance Considerations

- Expected load: [requests per second, concurrent users, data volume]
- N+1 queries to avoid: [list any that are risk areas]
- Caching strategy: [if any]
- Pagination needed: [YES/NO and strategy]

---

## Security Considerations

- [ ] Authentication required: {{YES/NO}} — what auth method
- [ ] Authorization check: {{YES/NO}} — which roles/permissions
- [ ] Input validation: {{YES/NO}} — what fields, what constraints
- [ ] Rate limiting: {{YES/NO}} — what limit
- [ ] Sensitive data handling: {{YES/NO}} — what data, how encrypted

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/unit.test.js` — {{describe what to test}}
- [ ] Middleware tests: `backend/src/middleware/*.test.js` — {{if auth/permissions affected}}
- [ ] API endpoint tests: `backend/src/__tests__/api-*.test.js` — {{describe endpoints}}
- [ ] Integration tests: `backend/src/__tests__/integration/*.test.js` — {{describe scenarios}}

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/` — {{describe what to test}}
- [ ] Component tests: `frontend/cypress/component/` — {{if new UI component}}
- [ ] E2E tests: `frontend/cypress/e2e/` — {{if user flow affected}}
- [ ] API contract tests: `frontend/src/__tests__/api-contract.test.ts` — {{if response shapes changed}}

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass (if applicable)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — check `frontend/src/api/`, `frontend/src/views/`, `frontend/src/components/` before creating
- ❌ **Duplicating existing patterns** — follow the style of `frontend/src/api/tickets.js`, `frontend/src/api/projects.js`, etc.
- ❌ **Ignoring the existing tab structure** — if `ProjectDetail.vue` has tabs, add new features as tabs, not new pages
- ❌ **Creating new API clients from scratch** — use the same `get`, `post`, `put`, `del`, `patch` imports from `./client`
- ❌ **Ignoring OpenAPI spec** — if backend routes change, update JSDoc and regenerate frontend types
- ❌ **Snake_case/camelCase mismatches** — backend uses snake_case, frontend API clients must convert to camelCase
- ❌ **Hardcoding API paths** — use the same pattern as existing API clients (e.g., `/api/v1/github/${projectId}/repo`)
- ❌ **Skipping error handling** — all API calls must use `.catch()` or try/catch
- ❌ **Testing only happy paths** — test error cases, empty states, loading states
- ❌ **Merging without tests** — every change must have tests
- ❌ **Skipping the Specification file** — if a small model will execute this ticket, fill out `04_SPECIFICATION.md` with exact file operations

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
