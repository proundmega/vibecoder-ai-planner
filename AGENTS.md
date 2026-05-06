# Vibecode AI Planner - Agent Guide

## Project Status

**Current Date**: May 6, 2026

### Ticket Status Summary

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| TKT-001 | Initialize Project Structure | High | ✅ Done |
| TKT-002 | PostgreSQL Database Schema | High | ✅ Done |
| TKT-003 | User Authentication System | High | ✅ Done |
| TKT-004 | Create Projects API Endpoints | High | ✅ Done |
| TKT-005 | Create Tickets API Endpoints | High | ✅ Done |
| TKT-006 | Create Roles and Permissions API | Medium | 🔄 In Progress |
| TKT-007 | Create Pricing and Subscription API | Medium | ❌ Pending |
| TKT-008 | Set Up Vue.js Frontend | High | ✅ Done |
| TKT-009 | Implement Authentication UI | High | ✅ Done |
| TKT-010 | Implement Projects View | Medium | ⏸️ Blocked |
| TKT-011 | Implement Kanban Board Component | High | ❌ Pending |
| TKT-012 | Implement Ticket Detail View | Medium | ⏸️ Blocked |
| TKT-013 | Design AI Agent API | High | ❌ Pending |
| TKT-014 | Create AI Agent User Experience | Medium | ❌ Pending |
| TKT-015 | Dockerize Backend/Frontend | Medium | ✅ Done |
| TKT-016 | Set Up CI/CD Pipeline | Medium | ❌ Pending |
| TKT-017 | API Documentation | Low | ❌ Pending |
| TKT-018 | Write Integration Tests | Low | ⏸️ Blocked |

### Blocked Tickets
- TKT-010 (Projects View): Waiting for TKT-006 (Permissions)
- TKT-012 (Ticket Detail View): Waiting for TKT-006 (Permissions)
- TKT-018 (Integration Tests): Waiting for API completion

### Pending High Priority
- TKT-006: Roles and Permissions API
- TKT-011: Kanban Board Component

## Architecture

**Monorepo**: `/backend` (Node.js + Express) + `/frontend` (Vue 3 + Vite)

**Database**: PostgreSQL 15 via pool in `db.js`

**Ports**: Frontend 3000, Backend 3001, PGAdmin 5050

## Commands

### Backend
- `npm run dev` - Start server (port 3001) with watch
- `npm test` - Run Jest tests
- `npm test -t "pattern"` - Run specific tests
- `npm run lint` - ESLint

### Frontend
- `npm run dev` - Start dev server (port 3000)
- `npm run build` - Production build (Vite)
- `npm run typecheck` - TypeScript check
- `npm run lint` - ESLint

## Testing Guidelines

### Backend (Jest)
```bash
cd backend && npm test
cd backend && npm test -t "updateStatus"
cd backend && npm test -- --coverage
```

### Frontend (Vitest)
```bash
cd frontend && npm run build
cd frontend && npm run typecheck
```

### Test Writing Best Practices

1. **Mock database calls** - Use Jest mocks for `pg.Pool.query` to avoid DB connections
2. **Test status transitions** - Validate only allowed workflow: `backlog` → `in_progress` → `review` → `done`
3. **Test ownership validation** - Ensure all mutations check user ownership
4. **Test both success and error paths** - Every public method needs both test cases
5. **Maintain consistent mocks** - Keep mock responses consistent across test files
6. **Test edge cases** - Invalid inputs, permissions, boundary values

## Ticket Status Workflow

Valid transitions only: `backlog` → `in_progress` → `review` → `done`

Invalid transitions throw errors in:
- `TicketService.updateStatus()`
- `Ticket.updateStatus()`

## Testing Guidelines

1. **Mock database calls** - Use Jest mocks for `pg.Pool.query` to avoid DB connections
2. **Test status transitions** - Validate only allowed workflow: `backlog` → `in_progress` → `review` → `done`
3. **Test ownership validation** - Ensure all mutations check user ownership
4. **Test both success and error paths** - Every public method needs both test cases
5. **Maintain consistent mocks** - Keep mock responses consistent across test files
6. **Test edge cases** - Invalid inputs, permissions, boundary values

## Key Conventions

- Auth: POST /api/auth/login → JWT (24h expiry)
- Token: `Bearer <token>` in `Authorization` header
- verifyToken middleware sets `req.user`
- Invalid/missing token → 401

## Testing Guidelines

1. **Mock database calls** - Use Jest mocks for `pg.Pool.query` to avoid DB connections
2. **Test status transitions** - Validate only allowed workflow: `backlog` → `in_progress` → `review` → `done`
3. **Test ownership validation** - Ensure all mutations check user ownership
4. **Test both success and error paths** - Every public method needs both test cases
5. **Maintain consistent mocks** - Keep mock responses consistent across test files
6. **Test edge cases** - Invalid inputs, permissions, boundary values

## Common Pitfalls

- ❌ Missing `X-API-Key` for agent endpoints
- ❌ Skipping `verifyToken` middleware
- ❌ Wrong status transition order
- ❌ Hardcoding secrets (use `.env`)
- ❌ Not checking user ownership before mutations
- ❌ Creating db connection without releasing client
- ❌ Running tests without proper mocks

## Models

- **User**: `id, email, name, role, password_hash, current_plan`
- **Project**: `id, name, description, owner_id`
- **Ticket**: `id, project_id, title, description, status, priority, assignee_id, owner_id`

## Files Structure

- `backend/src/index.js` - API entry point
- `backend/src/middleware/auth.js` - Auth & rate limiting
- `backend/src/services/` - Business logic with unit tests
- `backend/src/__tests__/jest.setup.js` - Test mocks
- `frontend/src/` - Vue 3 application

## Code Quality

- Follow IPEE: Identify → Plan → Execute → Evaluate
- Plan 80% before coding, then test
- Add extensive unit tests for all changes
- Test first, refactor after

## Next Steps (High Priority)

1. **TKT-006**: Add permission checks middleware
2. **TKT-011**: Build Kanban board component
3. **TKT-013**: Implement AI Agent API with API key auth
4. **Add more unit tests** for TicketService, ProjectService, UserService
5. **Update tests** to pass with proper mocks
