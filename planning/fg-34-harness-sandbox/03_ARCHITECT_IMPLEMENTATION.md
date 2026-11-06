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

## Plan

- [x] Choose the sandbox runtime (Docker sibling for isolation; host mode only as the explicit compatibility default)
- [x] Define CPU/memory/PID/disk/time limits per run
- [x] Deny host Docker socket, privileged mode and host mounts (only the workspace and a read-only `.git` are mounted)
- [ ] Define the network egress policy (slice 2; slice 1 is default-deny `--network none`)
- [x] Define secretless execution and a safe way to inject non-secret test config
- [ ] Harden prompt-injection handling for repo docs, issues and PR text (slice 3)
- [x] Add malicious-repo and escape-attempt tests (path/secret/read-only/no-socket coverage)
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
| `agent/src/main/java/com/vibecode/agent/harness/DockerSandboxRunner.java` | Added | Hardened sibling container lifecycle and command/file control channel |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxRunnerFactory.java` | Added | Explicit mode selection with no silent fallback |
| `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java` | Changed | Sandboxed `run(SandboxRunner, SandboxHandle, ...)` overload; shared tail buffer |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | Changed | Create a Docker sandbox before the model run; route install/verify through it; destroy in `finally` |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | Changed | Load `SandboxConfig` from the environment |
| `agent/Dockerfile` | Changed | Add `docker-cli` so the supervisor can reach a daemon/socket proxy |
| `agent/sandbox.Dockerfile` | Added | Minimal Node/git/build-tools sandbox image |
| `agent/docker-compose.yml` | Changed | Pass through sandbox environment variables |
| `agent/.env.example` | Changed | Document every sandbox variable |
| `AGENTS.md` | Changed | Document the sandbox environment |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxConfigTest.java` | Added | Config parsing, fail-closed guards, path mapping |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxPathsTest.java` | Added | Path traversal and symlink escape |
| `agent/src/test/java/com/vibecode/agent/harness/HostSandboxRunnerTest.java` | Added | Host runner exec/timeout/file/env behaviour |
| `agent/src/test/java/com/vibecode/agent/harness/DockerSandboxRunnerTest.java` | Added | Hardening args, lifecycle, fail-closed, secret/path rejection |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxRunnerFactoryTest.java` | Added | Mode selection and production guard |
| `agent/src/test/java/com/vibecode/agent/harness/DockerSandboxRunnerIntegrationTest.java` | Added | Opt-in real-Docker smoke test |
| `agent/src/test/java/com/vibecode/agent/harness/VerificationRunnerTest.java` | Changed | Sandboxed verification result mapping |

## Dependencies

- fg-30 Phase 1 (merged)

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Image/spec creation, create/exec/destroy lifecycle, container removed | `cd agent && mvn test`; `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` |
| FR2 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | `--cpus`/`--memory`/`--memory-swap`/`--pids-limit`/`--ulimit`, timeout kills the container, cgroup memory bound | `cd agent && mvn test`; integration command above |
| FR3 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | `--read-only`, `/tmp` tmpfs, workspace-only rw mount, no docker socket, no `--privileged` | `cd agent && mvn test`; integration command above |
| FR4 | Java unit | `SandboxConfigTest`, `DockerSandboxRunnerTest` | Default-deny `--network none`; any allowlist mode fails closed until slice 2 | `cd agent && mvn test` |
| FR5 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Secret keys and credential URLs rejected; container `env` has no provider/GitHub/DB secrets | `cd agent && mvn test`; integration command above |
| FR6 | Java unit | `SandboxConfigTest`, `DockerSandboxRunnerTest` | Root uid rejected; `--user`, `--cap-drop ALL`, `no-new-privileges` | `cd agent && mvn test` |
| FR7 | Java unit + integration | `SandboxPathsTest`, `HostSandboxRunnerTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Path/symlink escapes rejected; files copied only inside `/workspace`; host writes land in the workspace | `cd agent && mvn test`; integration command above |
| FR8 | Pending slice 3 | — | Prompt-injection classification, instruction precedence and output/exfiltration scanning | — |
| FR9 | Partial (sandbox image) / pending slice 3 | `agent/sandbox.Dockerfile` | Minimal image added; SBOM, scanner threshold and digest pinning still pending | — |
| FR10 | Java unit + runtime | `SandboxConfigTest`, `SandboxRunnerFactoryTest` | Host is the explicit default with a warning; `SANDBOX_REQUIRE=true` refuses host mode | `cd agent && mvn test` |
| FR11 | Java unit | `SandboxRunner`, `HostSandboxRunner`, `DockerSandboxRunnerTest` | Authenticated exec/file control path; no inbound ports; cwd and remote paths validated | `cd agent && mvn test` |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [x] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-06 | fg-34 slice 1 | `mvn test` (232 tests, 1 skipped) + `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` | All unit tests pass; the real-Docker smoke test passed locally (read-only rootfs, workspace write, no docker socket, no secrets, memory limit) and skips when `SANDBOX_IT_IMAGE` is unset. |
