# 01 — Requirement (fg-59)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

The fg-58 review left three non-blocking storage residuals:

- host mode still defaults image pruning on even when Docker is not the
  sandbox mechanism;
- the budget measures only the ticket root, not the shared runtime cache;
- a runtime can be refreshed in the small window between ticket pickup and the
  ticket-level `.active` marker.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Image pruning defaults on only in Docker sandbox mode. An explicit `AGENT_IMAGE_PRUNE_ENABLED` value wins in every mode. | `SupervisorStorageTest` covers unset/explicit values for host and docker. |
| FR2 | The budget is measured over the runtime root, including `cache/`. On a breach the ticket is quarantined; when the runtime concurrency is 1, the cache is removed too. | `WorkspaceManagerStorageTest` measures cache bytes; the processor breach test removes the cache and still quarantines. |
| FR3 | A runtime-level `.active` marker is written immediately after ticket pickup and cleared on every exit, so the supervisor refresh/sweep sees the runtime as busy before the ticket marker exists. Shared runtimes (`AGENT_RUNTIME_CONCURRENCY > 1`) skip the single-root marker (D4). | Latch test blocks the profile fetch and asserts the marker exists, then clears; a concurrency-2 test asserts no marker path; supervisor test protects a fresh runtime marker. |
| FR4 | Docs/Compose describe the host-mode default and the cache accounting. | README/Compose diff. |

## Out of scope

Shared-cache eviction for `AGENT_RUNTIME_CONCURRENCY > 1` (D3), object storage,
cross-host migration.
