# Vibecode AI Planner - Agent Guide

## Architecture

**Monorepo**: `/backend` (Node.js + Express) + `/frontend` (Vue 3 + Vite)

**Database**: PostgreSQL 15 via pool in `db.js`

**Ports**: Frontend 3000, Backend 3001, PGAdmin 5050

## Setup

```bash
# Quick Start
docker-compose up -d

# Manual Setup
docker run --name vibecode-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15
cd backend && npm install && npm run dev
cd ../frontend && npm install && npm run dev
```

## Commands

### Backend
- `npm run dev` - Start server (port 3001) with watch
- `npm test` - Run Jest tests
- `npm test -t "pattern"` - Run specific tests (e.g., `npm test -t "updateStatus"`)
- `npm test -- --coverage` - Generate coverage report
- `npm run lint` - ESLint

### Frontend
- `npm run dev` - Start dev server (port 3000)
- `npm run build` - Production build (Vite)
- `npm run typecheck` - TypeScript check (vue-tsc)
- `npm run lint` - ESLint

### Build Order
```bash
npm run lint → npm test → npm run build
```

## Key Conventions

### Authentication
- POST `/api/auth/login` → JWT token (24h expiry)
- Token: `Bearer <token>` in `Authorization` header
- `verifyToken` middleware extracts user, sets `req.user`
- Invalid/missing token → 401

### Ticket Status Workflow
Valid transitions only: `backlog` → `in_progress` → `review` → `done`
- Invalid transitions throw errors in `TicketService.updateStatus()`
- Allowed statuses array: `['backlog', 'in_progress', 'review', 'done']`

### Agent Endpoints
- Require `X-API-Key` header
- Valid keys: `test-*` prefix or `mock-agent-key`
- Rate limit: 10 requests per 60s → 429

### Ownership Checks
- All mutations verify user ownership before modifying
- Check `owner_id` and `assignee_id` before modifications
- Not checking ownership is a security vulnerability

## Testing

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

### Test File Location
- Backend: `backend/src/**/__tests__/*.test.js` or `backend/src/services/*.test.js`
- Frontend: `frontend/**/*.{test,spec}.?(c|m)[jt]s?(x)`

### Mock Database
Tests mock `pg.Pool`, `bcrypt`, `uuid`, `jsonwebtoken` - no actual DB connections needed

### Test Writing Guidelines

1. **Mock database calls** - Use Jest mocks for `pg.Pool.query` to avoid DB connections
2. **Test edge cases** - Invalid inputs, permissions, boundary values
3. **Test ownership validation** - Ensure all mutations check user ownership
4. **Test status transitions** - Validate only allowed workflow transitions
5. **Test both happy path AND error cases** - Every public method needs both
6. **Maintain consistent mocks** - Keep mock responses consistent across test files
7. **Write tests before coding** - Follow TDD pattern
8. **Add extensive unit tests** - Test all functions/methods
9. **Test async operations** - Handle Promise rejections and resolutions
10. **Test error conditions** - Invalid input, permission denied, network errors

## Models

- **User**: `id, email, name, role, password_hash, current_plan`
- **Project**: `id, name, description, owner_id`
- **Ticket**: `id, project_id, title, description, status, priority, assignee_id, owner_id`

## Common Pitfalls

- ❌ Missing `X-API-Key` for agent endpoints
- ❌ Skipping `verifyToken` middleware on protected routes
- ❌ Wrong ticket status transition order
- ❌ Hardcoding secrets (use `.env`)
- ❌ Not checking user ownership before mutations
- ❌ Creating db connection without releasing client
- ❌ Running tests without proper mocks

## Code Quality

- Follow IPEE methodology: Identify → Plan → Execute → Evaluate
- Plan 80% before coding, implement after testing
- Add extensive unit tests for all changes
- Test first, then refactor

## Files to Read First

- `backend/src/index.js` - Entry point, middleware chain
- `backend/src/middleware/auth.js` - Auth and rate limiting
- `backend/src/services/TicketService.js` - Business logic, status workflow
- `backend/src/db.js` - DB pool setup
- `backend/src/__tests__/jest.setup.js` - Test setup and mocks
- `frontend/src/App.vue` - Main layout
- `frontend/src/api/` - API client
