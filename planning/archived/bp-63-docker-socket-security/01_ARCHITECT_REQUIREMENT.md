# 01_ARCHITECT_REQUIREMENT.md — Docker Socket Mount Security Hardening

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Medium

---

## Requirement

Replace the direct Docker socket mount (`/var/run/docker.sock:/var/run/docker.sock`) in the API container with a restricted Docker API access pattern. The current setup gives the API container full root-level Docker access, equivalent to running `docker` as root on the host — a significant security vulnerability.

**Problem**: `docker-compose.yml` line 35 mounts the host's Docker socket directly into the API container:
```yaml
- /var/run/docker.sock:/var/run/docker.sock
```
This gives the Node.js process full control over ALL Docker containers on the host, including the ability to:
- Spawn privileged containers that escape to the host
- Access host filesystems mounted in other containers
- Stop/remove any container on the system
- Read Docker secrets and environment variables from other containers

This is a well-known container escape vector. A compromised API process (e.g., via XSS, dependency exploit, or injection) could gain full host access.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend Docker Access Check
- [x] Docker socket env var exists: `DOCKER_SOCKET=/var/run/docker.sock` in `docker-compose.yml:28`
- [x] Volume mount exists: `- /var/run/docker.sock:/var/run/docker.sock` in `docker-compose.yml:35`
- [x] `DeployService.js` uses Docker API directly — spawns containers for deployments
- [x] `ProvisioningService.js` uses Docker API — provisions compute nodes
- [x] No Docker API proxy or restricted access layer exists
- [x] No `docker-compose.override.yml` overrides the socket mount

### Docker Compose Check
- [x] `docker-compose.yml` — API service has `DOCKER_SOCKET` env var and volume mount
- [x] `docker-compose.override.yml` — does NOT override the socket mount
- [x] No `docker-proxy` or `gateone` or similar restricted Docker access tool is configured

### Key Insight
This is BACKEND-ONLY. The Docker socket is mounted in the API container. The fix involves:
1. Replacing the direct socket mount with a restricted Docker API proxy (e.g., `docker-proxy` or `tutum/docker-socket-proxy`)
2. Or, for development-only: keep the mount but restrict access via Docker socket ACLs

---

## Scope

### In Scope
- Replace direct Docker socket mount with a restricted Docker API proxy service
- Create a `docker-proxy` service in `docker-compose.yml` that exposes a filtered Docker API
- Configure the proxy to only allow operations needed by `DeployService` and `ProvisioningService`:
  - Container create/start/stop/kill/logs/inspect
  - Image pull
  - Network create/list
  - NO: volume management, host filesystem access, privileged mode, network creation with host networking
- Update `DeployService.js` and `ProvisioningService.js` to use the proxy URL instead of the raw socket
- Add `DOCKER_API_URL` env var to replace `DOCKER_SOCKET` path
- Update `.env.example` with the new env var
- For development: keep direct socket mount optional via `docker-compose.override.yml`

### Out of Scope
- Changing the Docker API calls in DeployService/ProvisioningService (only the connection target changes)
- Adding new Docker-related features
- Changing the agent node Docker setup (separate concern)
- Kubernetes or other orchestration changes

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `docker-compose.yml` | MODIFY | Add `docker-proxy` service; replace socket mount with API URL |
| `docker-compose.override.yml` | MODIFY | Keep direct socket mount for dev; set `DOCKER_API_URL` |
| `backend/src/services/DeployService.js` | MODIFY | Use `DOCKER_API_URL` env var instead of socket path |
| `backend/src/services/ProvisioningService.js` | MODIFY | Use `DOCKER_API_URL` env var instead of socket path |
| `backend/.env.example` | MODIFY | Add `DOCKER_API_URL=http://docker-proxy:2375` |
| `backend/package.json` | MODIFY | Add `docker-api` or use existing `dockerode` with URL instead of socket |

---

## Known Unknowns

1. **[Docker API library]**: Does the codebase already use `dockerode` or another Docker API client? — Need to check `DeployService.js` and `ProvisioningService.js` imports. If using raw HTTP calls to the socket, need to switch to a library that supports URL-based connections.
2. **[Proxy compatibility]**: Will `tutum/docker-socket-proxy` or `docker-proxy` work with the API calls made by DeployService/ProvisioningService? — Need to test after implementation.
3. **[Development workflow]**: How should local development work? — Option A: use `docker-proxy` locally too. Option B: keep direct socket mount in `docker-compose.override.yml` for dev, proxy for production.

---

## Important Design Decisions

1. **Docker socket proxy vs. Docker socket ACLs**: Use a Docker API proxy (`tutum/docker-socket-proxy` or `docker-proxy`) that filters allowed API endpoints. This is more secure than socket ACLs because it doesn't expose the raw API at all. The proxy runs as a separate container with a minimal attack surface.
2. **Dev vs. Prod**: For local development, keep the direct socket mount in `docker-compose.override.yml` (developers need full Docker access for debugging). For production (plain `docker-compose.yml`), use the proxy.
3. **Environment variable**: Replace `DOCKER_SOCKET` with `DOCKER_API_URL` — the API client connects to a URL instead of a Unix socket.

---

## Acceptance Criteria

1. [ ] The API container no longer has direct access to `/var/run/docker.sock`
2. [ ] A `docker-proxy` (or equivalent) service exists in `docker-compose.yml`
3. [ ] `DeployService.js` connects to the proxy URL via `DOCKER_API_URL` env var
4. [ ] `ProvisioningService.js` connects to the proxy URL via `DOCKER_API_URL` env var
5. [ ] The proxy only allows required Docker API endpoints (container create/start/stop/logs/inspect, image pull, network list)
6. [ ] `docker-compose.override.yml` provides direct socket mount for local development
7. [ ] All deploy and provision workflows still work after changes
8. [ ] `backend/.env.example` documents `DOCKER_API_URL`

---

## Out of Scope

- Changing the Docker API calls in DeployService/ProvisioningService (only the connection target changes)
- Adding new Docker-related features
- Changing the agent node Docker setup
- Kubernetes or other orchestration changes

---

## Security Considerations

- [x] Authentication required: N/A — this is infrastructure hardening
- [x] Authorization check: N/A — Docker API proxy enforces endpoint-level authorization
- [x] Input validation: N/A — existing validation in DeployService/ProvisioningService remains
- [ ] Sensitive data handling: Docker socket proxy should NOT expose container environment variables, secrets, or host mount points
- [ ] Container escape prevention: The proxy must block privileged container creation and host network mode

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `DeployService` connects to `DOCKER_API_URL` instead of socket
- [ ] Unit tests: `ProvisioningService` connects to `DOCKER_API_URL` instead of socket
- [ ] Integration tests: Deploy workflow works with proxy URL
- [ ] Integration tests: Provision workflow works with proxy URL

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `docker compose up` — API container starts and connects to proxy
