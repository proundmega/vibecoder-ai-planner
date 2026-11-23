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
- **Pickup marker:** `HarnessTicketProcessor` computes the marker path from
  `config.getRepoCloneDir()` only when its parent is `runtimes`, writes it at
  the start of the main run try-block and clears it in `finally`. The
  supervisor already treats any fresh `.active` under the runtime root as
  live.

## Failure modes

| Failure | Detection | Mitigation |
|---|---|---|
| Marker path escapes the runtime root | parent is not `runtimes` | Do not write a marker (legacy `/repos` mode) |
| Cache deletion races a sibling child | `AGENT_RUNTIME_CONCURRENCY > 1` | Skip cache deletion; D3 |
| No Docker in host mode | prune process fails | Default off in host mode |
| Budget event payload changes | tests | Assert `usedGb` reflects runtime bytes |

## Rollout

No migration. Behaviour is env-gated and the suite follows the normal review
flow.
