# 01_ARCHITECT_REQUIREMENT.md - Agent Storage Lifecycle and Idle Refresh (fg-44)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-43 Docker deployment, fg-33 durable execution
**Related code:** `PoolManager`, `WorkspaceManager`, `agent/Dockerfile`

## Problem

Agent containers are long-running and share one named volume:

- `PoolManager` binds `REPO_VOLUME:/repos` for every agent;
- `WorkspaceManager` clones each ticket into `/repos/<uuid>-<repo>`;
- `npm install`, `mvn`, OpenCode, git and test runs create large caches and temp files;
- Docker json-file logs grow without rotation;
- old images and stopped containers consume disk;
- an agent killed mid-ticket leaves a workspace behind;
- a container that idles for hours still holds its workspace, caches and logs.

On a 2 TB SSD this is manageable at first, but long-running swarms will eventually hit disk-full, inode exhaustion or slow I/O. Disk pressure also causes ticket failures that look like code failures.

## Goals

1. Bound the storage each agent can consume.
2. Clean workspaces deterministically on ticket completion, container stop and idle.
3. Refresh idle containers after a configurable period (proposed: 2 hours) to release accumulated state.
4. Detect disk/inode pressure early and stop spawning before the host is unusable.
5. Protect active tickets and leases from cleanup.
6. Rotate logs and prune images/containers safely.
7. Expose storage metrics and a manual recovery path.
8. Keep per-ticket changes isolated from other agents.

## Non-goals

- Distributed storage or NFS.
- Object-store migration for workspaces.
- Replacing Docker volumes with a CSI driver.
- Sandboxing (fg-34) or host sizing (fg-43).
- Long-term artifact archival.

## Functional requirements

- **FR1 - Workspace layout:** each agent gets `/repos/agents/<agentId>/` and each ticket a subdirectory; no agent writes into another agent's root.
- **FR2 - Ticket cleanup:** remove the ticket workspace after publish/release/failure, even if the JVM exits uncleanly.
- **FR3 - Idle refresh:** if an agent has no active ticket/lease for `AGENT_IDLE_REFRESH_MS` (default 2h), stop the container, remove its workspace/caches, and start a fresh container with the same DB agent identity (or a rotated key).
- **FR4 - Max lifetime:** recycle a container after `AGENT_MAX_LIFETIME_HOURS` even if busy, but only between tickets (never mid-ticket).
- **FR5 - Disk watermarks:** at 70% warn, 80% stop spawning new agents, 85% clean idle workspaces, 90% emergency recycle oldest idle agents and alert.
- **FR6 - Inode guard:** track inode usage and treat it like disk pressure.
- **FR7 - Logs:** Docker json-file rotation (`max-size=10m`, `max-file=3`); no unbounded container logs.
- **FR8 - Images:** periodic safe prune of dangling images; never prune in-use tags.
- **FR9 - Orphans:** a reaper removes `/repos` dirs not owned by an active pool entry or DB agent.
- **FR10 - Active safety:** never delete a workspace or stop a container with an unexpired ticket lease or active process.
- **FR11 - Metrics:** expose per-agent workspace bytes, host free bytes/inodes, log size, pool size and refresh counts.
- **FR12 - Recovery:** a documented command/script to stop the pool, free space, and restart safely.

## Storage budget

Use fg-43's per-agent disk budget:

| Profile | Workspace budget | Notes |
|---|---|---|
| build | 20 GB | repo + node_modules + test output |
| fixer | 15 GB | reuse caches where safe |
| review | 10 GB | read-only checkout |
| light | 5 GB | small repos/pollers |

If a workspace exceeds its budget, fail the ticket with a storage error instead of filling the host.

## Idle refresh policy

Proposed:

- `AGENT_IDLE_TIMEOUT_MS` (existing container idle timeout) remains short for pool scaling (5 min).
- `AGENT_IDLE_REFRESH_MS` = 2 hours is a **state refresh**, not a pool eviction: recycle the container/workspace even if the pool keeps the slot warm.
- Only refresh when `ticketId == null`, no lease, and no running child process.
- Preserve the DB agent record/API key if possible; otherwise create a new record and remove the old one after a grace period.
- Log a refresh event with reason, freed bytes and duration.

## Acceptance criteria

1. Ticket workspaces are removed after success, failure and release.
2. An idle agent (2h) is recycled and its workspace/cache removed.
3. An active ticket is never refreshed or cleaned.
4. Disk at 80% stops new agent creation with a clear error.
5. Disk at 90% recycles oldest idle agents and alerts.
6. Logs rotate; dangling images are pruned safely.
7. Orphan workspaces are reaped after TTL.
8. Storage metrics are visible in status/logs.
9. A full-disk simulation can be recovered with the documented procedure.
10. Tests cover cleanup, refresh, watermarks, orphans and active-ticket safety.

## Out of scope

- Automatic workspace migration to another host.
- Deduplicating repo clones across agents.
- Compressing old workspaces.
- Backup/restore of workspaces.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-43 | Host sizing and limits | Infrastructure | `fg-43-agent-docker-deployment` | No |
| 2 | fg-33 | Durable leases across restarts | Reliability | `fg-33-durable-harness-execution` | No |
| 3 | fg-34 | Sandboxed workspaces | Security | `fg-34-harness-sandbox` | No |
| 4 | fg-40 | Per-agent worktrees | Agent | `fg-40-multi-agent-orchestration` | No |
