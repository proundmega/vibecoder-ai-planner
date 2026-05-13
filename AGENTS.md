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

### Development (npm, no Docker)

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

### Docker (Production Build)

**Note:** Docker builds for production (nginx + static files). Cannot do hot-reload.

```bash
# Set JWT_SECRET (required)
export JWT_SECRET="your-secret-key-here"

# Start all services
docker compose up --build

# Access services
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - PgAdmin: http://localhost:5050 (admin@vibecode.local / admin)

# Stop
docker compose down
```

**Docker overrides:** Development overrides (`docker-compose.override.yml`) are intentionally minimal for production containers that run nginx.

### Database Setup
```bash
cd backend
npm run db:migrate   # Apply schema migrations
```

## Development Workflow

### Commands
```bash
# Backend
npm run dev          # Start server (watch mode)
npm test             # Run Jest tests
npm run lint         # ESLint check
npm run build        # Production build

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
```
.
```

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

## Known Issues & Solutions

### Missing JWT_SECRET
Error: `JWT_SECRET is not set`
Solution: Set `export JWT_SECRET="your-secret-key"` before running docker compose

### Frontend 404 on API calls
Solution: Ensure backend is running on port 3001 (check with curl http://localhost:3001/api/health)

### Invalid Status Transition
Error: `Invalid status transition`
Solution: Use allowed transitions: backlog→in_progress, in_progress→review, review→done

### Frontend Build Errors
Solution: Ensure `frontend/package-lock.json` exists (run `npm install` in frontend)
