# 03_ARCHITECT_IMPLEMENTATION.md — CI & Docker Infrastructure Hardening

**Status**: implemented — PR #31
**Priority**: P2
**Effort**: Medium

---

### Implementation Order

1. **Backend Dockerfile** — Rewrite multi-stage, add `USER node`, fix npm commands
2. **Agent Dockerfile** — Change `agent-1.0.0.jar` → `agent-*.jar`
3. **Docker Compose** — Add `name: vibecode`, resource limits, fix healthcheck start_period
4. **Agent compose** — Add `condition: service_healthy` to api depends_on; document cross-file usage
5. **CI pipeline** — Move frontend tests to frontend job; update actions versions; add Docker build job; add agent job

### Per-File Changes

#### `backend/Dockerfile`
- Remove builder stage entirely (single stage with `npm ci --omit=dev`)
- Copy `package*.json` first for layer caching, then `npm ci`, then copy source
- Add `USER node`
- Result: single stage, non-root, properly cached

#### `agent/Dockerfile:15`
```diff
- COPY --from=build /app/target/agent-1.0.0.jar agent.jar
+ COPY --from=build /app/target/agent-*.jar agent.jar
```

#### `docker-compose.yml`
```yaml
name: vibecode

services:
  api:
    deploy:
      resources:
        limits:
          memory: 512M
    healthcheck:
      start_period: 30s

  postgres:
    deploy:
      resources:
        limits:
          memory: 1G

  agent:
    deploy:
      resources:
        limits:
          memory: 2G
```

#### `.github/workflows/ci.yml`
```yaml
jobs:
  backend:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci && npm run lint && npm test && node --check src/index.js

  frontend:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci && npm run lint && npm run typecheck && npm test -- --run && npm run build

  docker:
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t vibecode-api ./backend
      - run: docker build -t vibecode-frontend ./frontend

  agent:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - run: mvn test
      - run: mvn package -DskipTests
```

### Testing
- [ ] `docker build -t vibecode-api ./backend` succeeds with non-root user
- [ ] `docker build -t vibecode-agent ./agent` succeeds with glob JAR copy
- [ ] `docker compose up` creates network `vibecode_default`
- [ ] CI pipeline completes all jobs (backend, frontend, docker, agent)
- [ ] All existing tests pass
