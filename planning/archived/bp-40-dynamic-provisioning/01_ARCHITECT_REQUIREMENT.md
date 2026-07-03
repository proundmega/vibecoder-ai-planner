# bp-40: Dynamic Provisioning (Phase 14 — Tier 3)

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend
**Priority**: P2
**Effort**: Large

## Problem Statement

The Pool Manager (bp-36) manages agent containers on the local Docker daemon. This limits agent capacity to one machine. The system cannot leverage spare compute across a homelab, spare laptops, or NAS boxes. When the local machine runs out of capacity, the pool manager should overflow to remote machines via SSH.

## Scope

- **In scope**: compute_nodes table for remote host registry, PoolManager extension for SSH-based container lifecycle, SSH key management via credential store, host selection strategy
- **Out of scope**: Auto-enrollment of compute nodes, cloud provider integration, container image registry, health checks for node connectivity

## Acceptance Criteria

- [ ] Migration 027 creates `compute_nodes` table (id, hostname, ssh_user, ssh_key_credential_id, labels, capacity, status, last_seen)
- [ ] `/api/v1/compute-nodes` CRUD endpoints for managing compute nodes
- [ ] PoolManager.request() — when local Docker is saturated, queries online compute_nodes → picks best host → SSH into it → docker run agent container
- [ ] PoolManager.release() — SSH into remote host → docker stop + docker rm agent container
- [ ] Host selection: prefer hosts with label matching repo, then least loaded, then random
- [ ] SSH keys decrypted from credential store at runtime via CredentialService.decrypt()
- [ ] Node marked offline after 3 consecutive SSH failures
- [ ] New npm dependency: `ssh2`

## Known Unknowns

- **SSH key permissions**: The temp key file must have 0600 permissions. ssh2 library handles this but need to clean up temp files.
- **Docker availability on remote**: Assumes Docker is installed and the user has permission to run containers. No auto-detection.
- **Network latency**: SSH to remote hosts adds latency per command. Pool operations may take 2–10s longer.

## Decisions Required

1. **SSH library choice?**
   - Option A: `ssh2` — pure JavaScript, full SSH protocol support, key-based auth
   - Option B: `node-ssh` — wrapper around ssh2 with simpler API
   - **Recommendation**: Option A — more control, fewer abstractions, better error handling

2. **Key management strategy?**
   - Option A: Write decrypted key to temp file, use ssh2 with `privateKey` option, delete after use
   - Option B: Store keys in SSH agent, use agent forwarding
   - **Recommendation**: Option A — no SSH agent dependency, stateless

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/migrations/027_compute_nodes.sql` | CREATE | compute_nodes table |
| `backend/src/services/ProvisioningService.js` | CREATE | SSH + Docker remote operations |
| `backend/src/services/PoolManager.js` | MODIFY | Add cross-machine logic in request/release |
| `backend/src/api/pool.js` | MODIFY | Extend with node info endpoints |
| `backend/src/api/compute-nodes.js` | CREATE | CRUD routes for compute nodes |
| `backend/src/api/v1/index.js` | MODIFY | Mount compute-nodes router |
| `backend/package.json` | MODIFY | Add ssh2 dependency |

## Dependencies

- **Depends on**: bp-36 (Pool Manager) — extends existing PoolManager
- **Depends on**: bp-29 (Credential Store) — stores SSH key credentials

## Performance Considerations

- SSH connections are established per operation (request/release). No persistent SSH connections (simplifies state management).
- Docker operations over SSH add ~1-3s latency each. Pool operations already have timeouts (bp-36 default 30s).
- Node capacity tracking is in the DB, not in-memory. Re-read on each request to handle concurrent changes.
