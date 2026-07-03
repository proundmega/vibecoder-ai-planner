# 02_ARCHITECT_DESIGN.md — CI & Docker Infrastructure Hardening

**Status**: Working draft

---

## Current State

### Backend Dockerfile (wasted layers)
```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci                    # installs ALL deps (300+ MB)
COPY . .
RUN npm install --production  # wastes builder cache; may corrupt node_modules

FROM node:18-alpine AS runner
WORKDIR /app
COPY --from=builder /app/package*.json ./
RUN npm ci --only=production  # re-installs from scratch — builder was wasted!
COPY --from=builder /app/src ./src
# No USER directive — runs as root
```

### Target
```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:18-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package*.json ./
USER node
EXPOSE 3001
HEALTHCHECK CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["node", "src/index.js"]
```

### CI Pipeline Problems

Current:
```
backend job: lint → test → frontend test (wrong!) → contract tests → syntax check
frontend job: lint → typecheck → build (no tests!)
agent: nothing
docker: nothing
```

Target:
```
backend job: lint → test → syntax check
frontend job: lint → typecheck → test --run → build
docker job: build backend image → build frontend image
agent job: mvn test → mvn package
```

---

## File-Level Impact Matrix

| File | Action |
|------|--------|
| `.github/workflows/ci.yml` | MODIFY |
| `backend/Dockerfile` | MODIFY |
| `agent/Dockerfile` | MODIFY |
| `docker-compose.yml` | MODIFY |
| `agent/docker-compose.yml` | MODIFY |

---

## Dependencies

- No new dependencies
- CI needs Docker BuildKit for efficient image building
