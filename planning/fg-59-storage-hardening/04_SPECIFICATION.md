# 04 — Specification (fg-59)

> **Owns:** exact file operations and contracts.
> **Not here:** design (`02`), requirements (`01`), verification matrix
> (`03`), status (`00`).

## Test stubs first

Extend `SupervisorStorageTest`, `WorkspaceManagerStorageTest` and
`HarnessTicketProcessorStorageTest` before production changes.

## Contracts

- `Supervisor.imagePruneDefault(Map<String,String> env)` → explicit
  `AGENT_IMAGE_PRUNE_ENABLED` or `SANDBOX_MODE=docker`.
- `WorkspaceManager.runtimeBytes()` → bytes under the runtime root
  (`cloneRoot`, including `cache/`).
- `WorkspaceManager.cleanupCache()` → deletes only `<runtime>/cache` with the
  safe-delete guard.
- `HarnessTicketProcessor.runtimeActiveMarkerPath()` → `<runtime>/.active` only
  when `config.getRepoCloneDir()` is `/…/runtimes/<id>`; otherwise `null`.
- `writeRuntimeActiveMarker()` / `clearRuntimeActiveMarker()` are best-effort
  and never fail a run.

## Verification commands

```bash
cd agent && mvn test -Dtest=WorkspaceManagerStorageTest,SupervisorStorageTest,HarnessTicketProcessorStorageTest
bash agent/scripts/host-storage.test.sh
node planning/check-planning.js
git diff --check
```
