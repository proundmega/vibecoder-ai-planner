# 03 — Implementation (fg-34)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Slice plan

| Slice | Scope | State |
|---|---|---|
| 1 | Sandbox runtime foundation: config, host/docker runners, limits, filesystem/user hardening, secretless env, default-deny network, sandboxed install/verification commands, tests | In review (PR #126) |
| 2 | Egress allowlist proxy (FR4) and the OpenCode bash-tool bridge so model-driven repo commands also run in the sandbox (FR11 complete) | Pending |
| 3 | Prompt-injection defenses (FR8), SBOM/image scan/digest pinning (FR9), artifact redaction | Pending |

Slice 1 deliberately keeps `SANDBOX_MODE=host` as the default so the Phase 1
harness is unchanged until the Docker path is validated. Docker mode is
opt-in and fails closed; it never falls back to host execution.

## Deployment boundary (slice 1)

Docker mode currently requires an agent that runs on, or shares a workspace
path with, the Docker host. `PoolManager` still launches agents with only the
`HARNESS_*` environment and a named repo volume, and `agent/docker-compose.yml`
does not mount a daemon socket. Pool-launched agents therefore stay in host
mode until the deployment wiring lands. This is **D8** in the `00` deferred
register; it is not claimed as delivered here.

OpenCode still runs in the supervisor in slice 1. Only supervisor-driven
install/verification commands go through the sandbox; a prompt-injected
OpenCode `bash` call still executes on the supervisor until the slice-2
bridge. Operator docs state this explicitly.

## Plan

- [x] Choose the sandbox runtime (Docker sibling for isolation; host mode only as the explicit compatibility default)
- [x] Define CPU/memory/PID/disk/time limits per run (supervisor watchdog for the bind-mounted workspace, plus `fsize`, `--storage-opt` defense-in-depth)
- [x] Deny host Docker socket, privileged mode and host mounts (only the workspace is mounted rw; `.git` is checked on the supervisor path and mounted ro from the daemon path)
- [ ] Define the network egress policy (slice 2; slice 1 is default-deny `--network none`)
- [x] Define secretless execution and a safe way to inject non-secret test config (strict boolean/numeric parsing; credential keys and URLs rejected)
- [ ] Harden prompt-injection handling for repo docs, issues and PR text (slice 3)
- [x] Add malicious-repo and escape-attempt tests (path/symlink copy, secret, read-only, no-socket, disk quota and non-root integration coverage)
- [ ] Add image scanning, SBOM and signed base images (slice 3; a minimal sandbox Dockerfile is added now)
- [x] Define the fallback for local Windows development (`SANDBOX_MODE=host`, loud warning, production guard)
- [x] Roll out behind a flag before making it the default (`SANDBOX_MODE`, `SANDBOX_REQUIRE`)

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/src/main/java/com/vibecode/agent/harness/SandboxMode.java` | Added | `host`/`docker` mode parser |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxConfig.java` | Added | Env-driven limits, image, user, secretless env, fail-closed validation and daemon-path mapping |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxSecurity.java` | Added | Secret-key and credential-URL rejection for values entering a sandbox |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxSpec.java` | Added | Immutable per-run sandbox description |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxHandle.java` | Added | Running sandbox handle |
| `agent/src/main/java/com/vibecode/agent/harness/ExecRequest.java` | Added | Command/cwd/timeout/output-cap/env contract |
| `agent/src/main/java/com/vibecode/agent/harness/ExecResult.java` | Added | Exit/output/timeout result |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxRunner.java` | Added | Create/exec/file/stop/destroy contract (fails closed) |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxPaths.java` | Added | Workspace realpath, container path normalization and symlink/escape rejection |
| `agent/src/main/java/com/vibecode/agent/harness/BoundedTailBuffer.java` | Added | Shared bounded output buffer |
| `agent/src/main/java/com/vibecode/agent/harness/HostSandboxRunner.java` | Added | Explicit host compatibility runner (not a boundary) |
| `agent/src/main/java/com/vibecode/agent/harness/DockerSandboxRunner.java` | Added | Hardened sibling container lifecycle, disk watchdog, artifact cap, symlink-safe file channel |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxRunnerFactory.java` | Added | Explicit mode selection with no silent fallback |
| `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java` | Changed | Sandboxed `run(SandboxRunner, SandboxHandle, ...)` overload; shared tail buffer |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | Changed | Create a Docker sandbox before the model run; route install/verify through it; guarded destroy in `finally` |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | Changed | Load `SandboxConfig` from the environment |
| `agent/Dockerfile` | Changed | Add `docker-cli` so the supervisor can reach a daemon/socket proxy |
| `agent/sandbox.Dockerfile` | Added | Minimal Node/git/build-tools sandbox image |
| `agent/docker-compose.yml` | Changed | Pass through sandbox environment variables |
| `agent/.env.example` | Changed | Document every sandbox variable |
| `AGENTS.md` | Changed | Document the sandbox environment |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxConfigTest.java` | Added | Config parsing, strict booleans/numerics, fail-closed guards, path mapping |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxPathsTest.java` | Added | Path traversal, symlinked file and symlinked-directory copy rejection |
| `agent/src/test/java/com/vibecode/agent/harness/HostSandboxRunnerTest.java` | Added | Host runner exec/timeout/file/env behaviour and symlink copy rejection |
| `agent/src/test/java/com/vibecode/agent/harness/DockerSandboxRunnerTest.java` | Added | Hardening args, mapped `.git` ro mount, lifecycle, fail-closed, disk watchdog, artifact cap, symlink and secret rejection |
| `agent/src/test/java/com/vibecode/agent/harness/BoundedTailBufferTest.java` | Added | Exact-full vs truncated tail behaviour |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxRunnerFactoryTest.java` | Added | Mode selection and production guard |
| `agent/src/test/java/com/vibecode/agent/harness/DockerSandboxRunnerIntegrationTest.java` | Added | Opt-in real-Docker non-root and disk-quota smoke tests |
| `agent/src/test/java/com/vibecode/agent/harness/VerificationRunnerTest.java` | Changed | Sandboxed verification result mapping |

## Dependencies

- fg-30 Phase 1 (merged)

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Image/spec creation, create/exec/destroy lifecycle, container removed | `cd agent && mvn test`; `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` |
| FR2 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | `--cpus`/`--memory`/`--memory-swap`/`--pids-limit`/`--ulimit`, exec-timeout cap, supervisor disk watchdog kills over-quota runs, cgroup memory bound | `cd agent && mvn test`; integration command above |
| FR3 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | `--read-only`, `/tmp` tmpfs, workspace-only rw mount, `.git` ro from the mapped daemon path, no docker socket, no `--privileged` | `cd agent && mvn test`; integration command above |
| FR4 | Java unit | `SandboxConfigTest`, `DockerSandboxRunnerTest` | Default-deny `--network none`; any allowlist mode fails closed until slice 2 | `cd agent && mvn test` |
| FR5 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Secret keys (including `OPENAI_KEY`) and credential URLs (scheme and scheme-less) rejected; container `env` has no provider/GitHub/DB secrets | `cd agent && mvn test`; integration command above |
| FR6 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Root uid rejected; `--user`, `--cap-drop ALL`, `no-new-privileges`; integration asserts `id -u == 1000` | `cd agent && mvn test`; integration command above |
| FR7 | Java unit + integration | `SandboxPathsTest`, `HostSandboxRunnerTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Lexical traversal and symlinked file/directory copies rejected; Docker checks container symlinks before `cp`; host writes land in the workspace | `cd agent && mvn test`; integration command above |
| FR8 | Pending slice 3 | — | Prompt-injection classification, instruction precedence and output/exfiltration scanning | — |
| FR9 | Partial (sandbox image) / pending slice 3 | `agent/sandbox.Dockerfile` | Minimal image added; SBOM, scanner threshold and digest pinning still pending | — |
| FR10 | Java unit + runtime | `SandboxConfigTest`, `SandboxRunnerFactoryTest` | Host is the compatibility default with a warning; strict booleans make `SANDBOX_REQUIRE=true` refuse host mode | `cd agent && mvn test` |
| FR11 | **Partial** — exec/file only | `SandboxRunner`, `HostSandboxRunner`, `DockerSandboxRunnerTest` | Local exec/file control path, no inbound ports, cwd/remote path validation; per-run token, streaming and the OpenCode bash bridge are slice 2 | `cd agent && mvn test` |
| NFR1 | Java unit + integration | `SandboxPathsTest`, `HostSandboxRunnerTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Escape/symlink rejection, read-only rootfs, workspace-only mount, no docker socket | `cd agent && mvn test`; integration command above |
| NFR2 | Java unit | `DockerSandboxRunnerTest` | `--network none`, no host network, no internal reachability | `cd agent && mvn test` |
| NFR3 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Provider/GitHub/DB secrets absent from the sandbox env | `cd agent && mvn test`; integration command above |
| NFR4 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Timeout and quota kills destroy the process tree/container | `cd agent && mvn test`; integration command above |
| NFR5 | Pending slice 2/3 | — | Redaction before storage is not separate in slice 1; failure messages use the existing provider redaction | — |
| NFR6 | Java unit | `SandboxConfigTest`, `SandboxRunnerFactoryTest`, `HarnessTicketProcessorTest` | Strict config parsing; sandbox create failure is fatal and skips the harness | `cd agent && mvn test` |
| NFR7 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Non-root uid, `--cap-drop ALL`, `no-new-privileges`; integration asserts the uid | `cd agent && mvn test`; integration command above |

### Coverage notes

- CPU/PID enforcement is asserted through the `docker run` flags; the integration test asserts the memory cgroup bound. A behavioral CPU/PID stress test is deferred to slice 2.
- The disk quota is enforced by the supervisor watchdog at `SANDBOX_DISK_CHECK_INTERVAL_SECONDS` granularity (bounded overshoot). `fsize` bounds a single file and `--storage-opt` is defense-in-depth, not the bind-mount quota.
- Malicious `postinstall` containment is exercised by running install commands in the sandbox; a dedicated hostile-lifecycle fixture lands with slice 2's egress work.
- The integration test is opt-in (`SANDBOX_IT_IMAGE`); CI and `PoolManager` wiring are D8.
- The Docker file channel rejects symlinks/non-regular files before `docker cp`, but a same-container TOCTOU swap remains possible; a race-free copy is D10.
- NFR5 (redaction before storage) and the FR11 streaming/per-run-token parts are not delivered in slice 1; they are tracked in `00`.

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix (FR8/FR9/NFR5 are later slices)
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration: N/A (agent-only; no DB migration)
- [x] API contract: N/A (no backend/frontend contract change)
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [x] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-06 | fg-34 slice 1 | `mvn test` (250 tests, 2 skipped) + `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` (2 tests) | All unit tests pass; the real-Docker smoke tests passed locally (non-root uid, read-only rootfs, workspace write, file copy, symlink rejection, no docker socket, no secrets, memory limit, disk-quota kill) and skip when `SANDBOX_IT_IMAGE` is unset. |
