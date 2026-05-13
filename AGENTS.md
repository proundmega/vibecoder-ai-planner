# Vibecode AI Planner - Agent Guide

## Architecture Overview

### Monorepo Structure
```
/home/ubuntu/vibecode/vibecoder-ai-planner/
├── backend/          # Node.js + Express API server (port 3001)
│   ├── src/
│   │   ├── api/     # API routes & controllers
│   │   ├── models/  # Database models
│   │   ├── services/# Business logic layer
│   │   ├── middleware/ # Auth, permissions
│   │   ├── migrations/ # DB schema migrations
│   │   └── index.js # App entry point
├── frontend/         # Vue 3 SPA with Vite (port 3000)
│   └── src/
│       ├── views/   # Page components
│       ├── components/ # Reusable components
│       ├── api/     # API client functions
│       ├── stores/  # Pinia state management
│       └── router/  # Vue Router config
└── docker-compose.yml # Service definitions
```

### Technology Stack
- **Backend**: Node.js, Express, PostgreSQL 15, Jest
- **Frontend**: Vue 3, Vite, Pinia, Vue Router, TypeScript
- **Auth**: JWT (jsonwebtoken + bcryptjs)

### Ports
- Frontend: 3000
- Backend API: 3001
- PostgreSQL: 5432
- PgAdmin: 5050

## Running the Application

### Docker Compose

**Note:** API runs on port 3001. If already in use, use port 3010: `3010:3001`

```bash
# Set JWT_SECRET (required)
export JWT_SECRET="your-secret-key-here"

# Start all services
docker compose up --build

# Access services
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001  
# - PgAdmin: http://localhost:5050 (admin@vibecode.dev / admin)

# Stop
docker compose down
```

**Database setup:**
```bash
cd backend
npm run db:migrate   # Apply schema migrations if needed
```

### Manual Setup

**Backend:**
```bash
cd backend
npm install
npm run dev          # Express server on port 3001
```

**Frontend:** (separate terminal)
```bash
cd frontend
npm install
npm run dev          # Vite dev server on port 3000
```

## Development Workflow

### Commands
```bash
# Backend
npm run dev          # Start server (watch mode)
npm test             # Run Jest tests
npm run lint         # ESLint check

# Frontend
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint check
npm run typecheck    # Vue-TSC type checking
npm test             # Vitest tests
```

## Testing

### Backend Tests
```bash
cd backend
npm test          # Run all tests
```

**Note:** Jest uses mocks in `backend/src/__tests__/jest.setup.js`.

### Frontend Tests
```bash
cd frontend
npm test          # Run Vitest tests
npm run typecheck # Type checking
```

## CI Pipeline
Runs on push to main/develop:
- Backend: lint + build
- Frontend: lint + build

## API Endpoints

### Authentication
- `POST /api/auth/register` - Create user (returns user with token)
- `POST /api/auth/login` - Get JWT token
- `GET /api/auth/me` - Get current user

### Projects
- `GET /api/projects` - List user's projects
- `POST /api/projects` - Create project
- `GET /api/projects/:id` - Get project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project
- `GET /api/projects/:id/tickets` - List project's tickets
- `POST /api/projects/:id/tickets` - Create ticket in project

### Tickets
- `GET /api/tickets/:id` - Get ticket detail
- `POST /api/tickets/:id/status` - Change status (validated)
- `PUT /api/tickets/:id` - Update ticket
- `DELETE /api/tickets/:id` - Delete ticket

### Agents
- `POST /api/agents/create` - Create agent with API key
- `GET /api/agents` - List user's agents
- `DELETE /api/agents/:id` - Delete agent
- `GET /api/agents/:id/key` - Get agent key info
- `GET /api/agents/:id/history` - Get agent activity stats

**Agent Usage**: Set `x-api-key` header with generated agent key

## Known Issues & Solutions

### Port 3001 Already in Use
Solution: Set `PORT=3010` in docker-compose.yml or use existing port

### Missing JWT_SECRET
Error: `JWT_SECRET is not set`
Solution: Set `export JWT_SECRET="your-secret-key-here"` before running docker compose

### PostgreSQL Connection Failed
Error: Container exits immediately with connection errors
Solution: Ensure other services started before API. Check logs with `docker logs <container_id>`. The API may wait for database to be healthy before starting.

### Frontend 404 on API calls
Solution: Ensure backend is running on port 3001 (check with curl http://192.168.3.33:3001/api/health)

### Invalid Status Transition
Error: `Invalid status transition`
Solution: Use allowed transitions: backlog→in_progress, in_progress→review, review→done

### Container Exits Immediately
If `docker ps` shows container exited (status 0), check:
1. Database is healthy: `docker ps` should show postgres running
2. Logs show connection error: `docker logs <container_id>`
3. Run migrations: `cd backend && npm run db:migrate`

### Frontend Build Errors
Solution: Ensure `frontend/package-lock.json` exists and `frontend/node_modules/` is not in .gitignore

### Jest Test Failures
- Old tests may reference missing methods (UserService.register, etc.)
- Use mocks in `backend/src/__tests__/db.mocks.js`

## Frontend Architecture

### State Management
Uses Pinia with `frontend/src/stores/`:
- `auth.js` - User auth state, token management

### Routing
Vue Router at `frontend/src/router/index.ts`:
```
/ → Projects list
/projects/:id → Project detail
/projects/:id/tickets → Kanban board
/projects/:id/tickets/:id → Ticket detail
/projects/:id/ai → AI Assistant
```

### Path Aliases
Uses `@` alias pointing to `frontend/src` for imports.

```

## Backend Startup Notes

The backend uses a simplified logger (console) to avoid winston middleware issues in Docker builds. If winston is needed, ensure the correct API is used.
