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
- `npm run dev` - Start server (port 3001)
- `npm test` - Run Jest tests
- `npm run lint` - ESLint

### Frontend
- `npm run dev` - Start dev server (port 3000)
- `npm run build` - Production build (vite)
- `npm run typecheck` - TypeScript check

### Build Order
```bash
npm run lint → npm test → npm run build
```

## Key Conventions

### Authentication
- POST `/api/auth/login` → JWT token (24h expiry)
- Token: `Bearer <token>` in `Authorization` header
- `verifyToken` middleware sets `req.user`
- Invalid/missing token → 401

### Ticket Status Workflow
Valid transitions: `backlog` → `in_progress` → `review` → `done`
- Invalid transitions throw errors
- Allowed statuses: `['backlog', 'in_progress', 'review', 'done']`

### Agent Endpoints
- Require `X-API-Key` header
- Valid keys: `test-*` prefix or `mock-agent-key`
- Rate limit: 10 requests/60s → 429

### Ownership Checks
- All mutations must verify user ownership
- Check `owner_id` and `assignee_id` before modifying

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

## Test Writing Guidelines

1. Mock all database calls (`pg.Pool.query`, `bcrypt`, `uuid`)
2. Test status transitions only for valid workflow
3. Test ownership validation in every mutation
4. Test both success and error paths for each method
5. Maintain consistent mocks across test files
6. Add tests for edge cases and boundary values

## Models

- **User**: `id, email, name, role, password_hash, current_plan`
- **Project**: `id, name, description, owner_id`
- **Ticket**: `id, project_id, title, description, status, priority, assignee_id, owner_id`

## Common Pitfalls

- ❌ Missing `X-API-Key` for agent endpoints
- ❌ Skipping `verifyToken` middleware
- ❌ Wrong status transition order
- ❌ Hardcoding secrets (use `.env`)
- ❌ Not checking user ownership before mutations
- ❌ Creating db connection without releasing client
- ❌ Running tests without proper mocks

## Code Quality

- Follow IPEE: Identify → Plan → Execute → Evaluate
- Plan 80% before coding, then test
- Add extensive unit tests for all changes
- Test first, refactor after

## Files Structure

- `backend/src/index.js` - API entry point
- `backend/src/middleware/auth.js` - Auth & rate limiting
- `backend/src/services/` - Business logic
- `backend/src/models/` - Database models
- `backend/src/__tests__/jest.setup.js` - Test mocks
- `frontend/src/` - Vue 3 application
