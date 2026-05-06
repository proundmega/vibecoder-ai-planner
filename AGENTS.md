# Vibecode AI Planner - Agent Guide

## Architecture

**Monorepo**: `/backend` (Node.js + Express) + `/frontend` (Vue 3 + Vite)

**Database**: PostgreSQL 15 via pool in `db.js`

**Ports**: Frontend 3000, Backend 3001, PGAdmin 5050

## Setup

### Quick Start
```bash
docker-compose up -d
```

### Manual Setup (Order Matters)
1. Start PostgreSQL: `docker run --name vibecode-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15`
2. Backend: `cd backend && npm install`
3. Frontend: `cd ../frontend && npm install`

## Commands

### Backend
- `npm run dev` - Start server with watch (port 3001)
- `npm test` - Run Jest tests
- `npm run test -t "pattern"` - Run specific tests (e.g., `npm run test -t "updateStatus"`)
- `npm run lint` - ESLint
- `npm run db:migrate` - Apply migrations

### Frontend
- `npm run dev` - Start Vite dev server (port 3000)
- `npm run build` - Production build
- `npm run test` - Run Vitest tests
- `npm run typecheck` - TypeScript check (vue-tsc)

### Build Order
```bash
npm run lint → npm test → npm run build
```

## Key Conventions

### Authentication
- POST `/api/auth/login` → JWT token (24h expiry)
- Token format: `Bearer <token>` in `Authorization` header
- `verifyToken` middleware: extracts user from token, sets `req.user`
- Invalid token or missing header → 401

### Ticket Status Workflow
Valid transitions only: `backlog` → `in_progress` → `review` → `done`
- Invalid transitions throw errors in `TicketService.updateStatus` and `Ticket.updateStatus`
- Allowed statuses array: `['backlog', 'in_progress', 'review', 'done']`

### Agent Endpoints
- Require `X-API-Key` header
- Valid keys: `test-*` prefix or `mock-agent-key`
- Missing key → 401
- Rate limit: 10 requests per 60s via IP → 429

### Ownership Checks
- All mutations must verify user ownership before modifying
- Check project `owner_id` and ticket/project `assignee_id`
- Not checking ownership → security vulnerability

## Testing

### Backend (Jest)
```bash
cd backend && npm test
```
- Test files: `src/**/*.test.js` in `__tests__` folders or same directory
- Mocks: `src/__tests__/jest.setup.js` (Express, supertest, pg, bcrypt, uuid, jwt, winston)
- Setup: `src/__tests__/jest.setup.js`
- Coverage: `npm test -- --coverage`
- Single pattern: `npm test -t "updateStatus"`

Run specific service tests:
```bash
cd backend && npm run test -t "TicketService"
cd backend && npm run test src/services/TicketService.test.js
```

### Frontend (Vitest)
```bash
cd frontend && npm test
```
- TypeScript: `npm run typecheck`

## Test Writing Guidelines

1. **Mock database calls** - Use Jest mocks for pg.Pool.query to avoid DB connections
2. **Test edge cases** - Invalid inputs, permissions, edge status values
3. **Test ownership validation** - Ensure all mutations check user ownership
4. **Test status transitions** - Validate allowed transitions only
5. **Test happy path AND error cases** - Every public method should have both
6. **Maintain mocks** - Keep mock responses consistent across test files
7. **Write tests before coding** - Follow TDD pattern
8. **Add extensive unit tests** - Test all functions/methods
9. **Test async operations** - Handle Promise rejection and resolve cases
10. **Test error conditions** - Invalid input, permission denied, network errors

## Models

- **User**: `id, email, name, role, password_hash, current_plan`
- **Project**: `id, name, description, owner_id`
- **Ticket**: `id, project_id, title, description, status, priority, assignee_id, owner_id`

## Common Pitfalls

- ❌ Missing `X-API-Key` for agent endpoints
- ❌ Skipping `verifyToken` middleware on protected routes
- ❌ Wrong ticket status transition order
- ❌ Hardcoding secrets (use `.env`, see `.env.example`)
- ❌ Not checking user ownership before mutations
- ❌ Creating `db` connection without releasing client in async context
- ❌ Running tests without mocks - database is not required

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
- `backend/src/__tests__/db.mocks.js` - Database mocks
- `frontend/src/App.vue` - Main layout
- `frontend/src/api/` - API client
