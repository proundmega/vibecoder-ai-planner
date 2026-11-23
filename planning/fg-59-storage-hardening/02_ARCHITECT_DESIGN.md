# 02 — Design (fg-59)

> **Owns:** current-state audit, design, data flow, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file
> operations (`04`), status (`00`).

## Current state

`Supervisor` defaults `AGENT_IMAGE_PRUNE_ENABLED` to true for every mode.
`WorkspaceManager.workspaceBytes()` measures the ticket root only; the shared
`<runtime>/cache` is excluded. The ticket-level `.active` marker is written
after `workspaceFactory.apply`, leaving a narrow pickup→marker window.

## Design

- **Prune default:** `Supervisor.imagePruneDefault(env)` returns the explicit
  `AGENT_IMAGE_PRUNE_ENABLED` value when present, otherwise
  `SANDBOX_MODE=docker`. Compose forwards an empty value by default.
- **Cache budget:** add `WorkspaceManager.runtimeBytes()` over the runtime root
  and use it for the initial and periodic budget meters. On a breach,
  quarantine the ticket and, only when `AGENT_RUNTIME_CONCURRENCY <= 1`, delete
  `<runtime>/cache`. Shared-cache eviction stays D3.
- **Pickup marker:** `HarnessTicketProcessor` writes the marker immediately
  after `pickUpTicket` returns and clears it in an outer `finally`, so the
  profile fetch and durable-start calls are covered. The path is used only when
  the clone root is `/…/runtimes/<id>` and `AGENT_RUNTIME_CONCURRENCY == 1`;
  shared runtimes skip the single-root marker (D4). The supervisor already
  treats any fresh `.active` under the runtime root as live.
- **Legacy layout:** `runtimeBytes()`/`runtimeInodes()` fall back to the ticket
  root when the clone root is a legacy `/repos` root, so one workspace never
  counts every sibling on the host.

## Failure modes

| Failure | Detection | Mitigation |
|---|---|---|
| Marker path escapes the runtime root | parent is not `runtimes` | Do not write a marker (legacy `/repos` mode) |
| Cache deletion races a sibling child | `AGENT_RUNTIME_CONCURRENCY > 1` | Skip cache deletion; D3 |
| Marker overwritten by a sibling child | `AGENT_RUNTIME_CONCURRENCY > 1` | Skip the single-root marker; D4 |
| No Docker in host mode | prune process fails | Default off in host mode |
| Budget event payload changes | tests | Assert `usedGb` reflects runtime bytes |

## Rollout

No migration. Behaviour is env-gated and the suite follows the normal review
flow.
