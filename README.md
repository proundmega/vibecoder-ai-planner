# Vibecode AI Planner

An AI-powered Kanban board SaaS for managing development tasks with integrated AI agents.

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Docker & Docker Compose (optional)

### Docker Setup (Recommended)

```bash
# Start all services
docker-compose up -d

# Access services
# - Frontend: http://localhost:3000
# - Backend API: http://localhost:3001
# - PostgreSQL: localhost:5432
# - PgAdmin: http://localhost:5050 (admin@vibecode.local / admin)
```

### Manual Setup

```bash
# Start PostgreSQL
docker run --name vibecode-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15

# Start backend
cd backend
npm install
npm run dev

# Start frontend (in another terminal)
cd ../frontend
npm install
npm run dev
```

## Project Structure

```
vibecoder-ai-planner/
├── backend/           # Node.js API server
│   └── src/
│       ├── api/       # API routes
│       ├── middleware/ # Auth, validation
│       ├── models/    # Data models
│       └── services/  # Business logic
├── frontend/          # Vue.js SPA
│   └── src/
│       ├── views/     # Pages
│       └── store/     # Pinia state
├── tickets.txt        # Development tasks
└── AGENTS.md          # Agent guidelines
```

## Development Commands

```bash
# Backend
npm run dev          # Start server
npm run test         # Run tests
npm run lint         # Lint code

# Frontend
npm run dev          # Start dev server
npm run build        # Build for production
npm run lint         # Lint code
```

## API Documentation

- `/api/health` - Health check
- `/api/version` - API version
- `/api/auth/register` - User registration
- `/api/auth/login` - User login
- `/api/projects` - Project CRUD
- `/api/tickets` - Ticket CRUD
- `/api/pricing/tiers` - Pricing tiers
- `/api/agents/*` - AI agent operations

See `architecture/system-design.md` for full API reference.

## AI Agent Integration

AI agents can claim and work on tickets by:

1. Getting authentication token
2. Adding `X-API-Key` header
3. Using agent-specific endpoints

Example:
```bash
curl -X POST "http://localhost:3001/api/agents/tickets/create" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "X-API-Key: YOUR_AGENT_KEY" \
  -d '{"project_id":"xxx","title":"Fix bug","description":"..."}'
```

## Architecture

Read `architecture/system-design.md` for:
- System architecture diagrams
- Database schema (PostgreSQL)
- Data flow examples
- Technology rationale

## Testing

```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test

# E2E tests
docker-compose up -d
cd frontend && npm run test:e2e
```

## Contributing

1. Read `AGENTS.md` for guidelines
2. Check `tickets.txt` for current tasks
3. Follow the [Project Structure](#project-structure)
4. Ensure all tests pass

## License

MIT
