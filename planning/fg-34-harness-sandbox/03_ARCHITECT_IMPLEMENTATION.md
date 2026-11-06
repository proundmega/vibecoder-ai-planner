# 03 — Implementation (fg-34)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Slice plan

| Slice | Scope | State |
|---|---|---|
| 1 | Sandbox runtime foundation: config, host/docker runners, limits, filesystem/user hardening, secretless env, default-deny network, sandboxed install/verification commands, tests | Merged (#126) |
| 2 | Egress allowlist proxy (FR4) and the OpenCode bash-tool bridge so model-driven repo commands also run in the sandbox (FR11 complete) | Merged (#127) |
| 3a | Prompt-injection defenses (FR8): untrusted-content labeling, instruction precedence, credential read denies, command exfiltration policy, credential-leak publish gate | In review (#128) |
| 3b | SBOM/image scan/digest pinning (FR9); artifact redaction (D11) remains deferred | In review (#TBD) |

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
- [x] Define the network egress policy (slice 2: internal Docker network + hardened allowlist proxy; default-deny `--network none`)
- [x] Define secretless execution and a safe way to inject non-secret test config (strict boolean/numeric parsing; credential keys and URLs rejected)
- [ ] Harden prompt-injection handling for repo docs, issues and PR text (slice 3)
- [x] Add malicious-repo and escape-attempt tests (guard-failure fail-closed with non-zero exit codes, symlink/FIFO copy, background persistence, download-cap pre-check, destroy-failure publish stop, secret, read-only, no-socket, disk quota, non-root, egress allow/deny and direct-egress-blocked integration coverage)
- [x] Bridge the OpenCode bash tool into the sandbox (slice 2: `sandbox_bash` global tool + loopback per-run-token bridge; built-in bash disabled)
- [x] Add image scanning, SBOM and signed base images (slice 3b: digest-pinned Dockerfiles, `agent/scripts/sandbox-image-security.sh`, CI pin gate, optional syft/trivy/grype/cosign)
- [x] Define the fallback for local Windows development (`SANDBOX_MODE=host`, loud warning, production guard)
- [x] Roll out behind a flag before making it the default (`SANDBOX_MODE`, `SANDBOX_REQUIRE`)

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/src/main/java/com/vibecode/agent/harness/SandboxMode.java` | Added | `host`/`docker` mode parser |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxConfig.java` | Added | Env-driven limits, image, user, secretless env, fail-closed validation and daemon-path mapping |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxSpec.java` | Added | Immutable per-run sandbox description (including egress network and proxy image) |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxBashBridge.java` | Added | Loopback, per-run-token exec bridge for the OpenCode shell tool |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxCommandPolicy.java` | Added | Supervisor-side deny-list for publishing / host-control commands |
| `agent/src/main/resources/sandbox/egress-proxy.js` | Added | Allowlist HTTP/CONNECT proxy: private/metadata/cloud-range blocking, first-ClientHello SNI validation with multi-SNI/extra-handshake rejection, CONNECT :80 rejection, denial-only rate-limited logging |
| `agent/src/main/java/com/vibecode/agent/harness/OpenCodeConfigWriter.java` | Changed | Disable the built-in bash tool and allow `sandbox_bash` when a sandbox bridge is active |
| `agent/src/main/java/com/vibecode/agent/harness/OpenCodeClient.java` | Changed | Write the global `sandbox_bash` tool and inject the per-run bridge URL/token |
| `agent/src/main/java/com/vibecode/agent/harness/PromptBuilder.java` | Changed | Tell the model to use `sandbox_bash` and `/workspace` in Docker mode |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxSecurity.java` | Added | Secret-key and credential-URL rejection for values entering a sandbox |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxSpec.java` | Added | Immutable per-run sandbox description |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxHandle.java` | Added | Running sandbox handle |
| `agent/src/main/java/com/vibecode/agent/harness/ExecRequest.java` | Added | Command/cwd/timeout/output-cap/env contract |
| `agent/src/main/java/com/vibecode/agent/harness/ExecResult.java` | Added | Exit/output/timeout result |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxRunner.java` | Added | Create/exec/file/stop/destroy contract (fails closed) |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxPaths.java` | Added | Workspace realpath, container path normalization and symlink/escape rejection |
| `agent/src/main/java/com/vibecode/agent/harness/BoundedTailBuffer.java` | Added | Shared bounded output buffer |
| `agent/src/main/java/com/vibecode/agent/harness/HostSandboxRunner.java` | Added | Explicit host compatibility runner (not a boundary) |
| `agent/src/main/java/com/vibecode/agent/harness/DockerSandboxRunner.java` | Added | Hardened sibling container lifecycle, lifetime disk watchdog, fail-closed copy guards, post-exec descendant sweep, pre-copy artifact cap, symlink-safe temp-file downloads, internal egress network + hardened allowlist proxy lifecycle |
| `agent/src/main/java/com/vibecode/agent/harness/SandboxRunnerFactory.java` | Added | Explicit mode selection with no silent fallback |
| `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java` | Changed | Sandboxed `run(SandboxRunner, SandboxHandle, ...)` overload; shared tail buffer |
| `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java` | Changed | Create a Docker sandbox before the model run; route install/verify through it; start the bash bridge; require a successful pre-publish destroy; guarded retry in `finally` |
| `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java` | Changed | Load `SandboxConfig` from the environment |
| `agent/Dockerfile` | Changed | Add `docker-cli` so the supervisor can reach a daemon/socket proxy |
| `agent/sandbox.Dockerfile` | Added | Minimal Node/git/build-tools sandbox image (base digest-pinned) |
| `agent/sandbox-proxy.Dockerfile` | Added | Minimal trusted Node image for the egress proxy, separate from `SANDBOX_IMAGE` (base digest-pinned) |
| `agent/scripts/sandbox-image-security.sh` | Added | Deterministic digest-pin gate plus SBOM (syft), vulnerability scan (trivy/grype) and optional cosign verification |
| `Jenkinsfile` | Changed | Agent stage builds the sandbox image and runs the pin gate; SBOM/scan runs when tools are present |
| `agent/docker-compose.yml` | Changed | Pass through sandbox environment variables |
| `agent/.env.example` | Changed | Document every sandbox variable |
| `AGENTS.md` | Changed | Document the sandbox environment |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxConfigTest.java` | Added | Config parsing, strict booleans/numerics, fail-closed guards, path mapping |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxPathsTest.java` | Added | Path traversal, symlinked file and symlinked-directory copy rejection |
| `agent/src/test/java/com/vibecode/agent/harness/HostSandboxRunnerTest.java` | Added | Host runner exec/timeout/file/env behaviour and symlink copy rejection |
| `agent/src/test/java/com/vibecode/agent/harness/DockerSandboxRunnerTest.java` | Added | Hardening args, mapped `.git` ro mount, lifecycle, fail-closed guards, guard failure, disk watchdog/measurement failure, artifact cap, symlink/FIFO rejection, egress network/proxy lifecycle |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxBashBridgeTest.java` | Added | Command/cwd mapping, token rejection, cwd escape, denied command, oversized body, timeout clamp |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxCommandPolicyTest.java` | Added | Allowed build commands and denied publishing/host-control commands |
| `agent/src/test/java/com/vibecode/agent/harness/EgressProxyScriptTest.java` | Added | Exact/wildcard allow, apex mismatch, private/metadata/IP/port denial without Docker |
| `agent/src/test/java/com/vibecode/agent/harness/BoundedTailBufferTest.java` | Added | Exact-full vs truncated tail behaviour |
| `agent/src/test/java/com/vibecode/agent/harness/SandboxRunnerFactoryTest.java` | Added | Mode selection and production guard |
| `agent/src/test/java/com/vibecode/agent/harness/DockerSandboxRunnerIntegrationTest.java` | Added | Opt-in real-Docker non-root, background/lifecycle containment, FIFO, pre-copy cap and disk-quota smoke tests |
| `agent/src/test/java/com/vibecode/agent/harness/VerificationRunnerTest.java` | Changed | Sandboxed verification result mapping |

## Dependencies

- fg-30 Phase 1 (merged)

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Image/spec creation, create/exec/destroy lifecycle, container removed | `cd agent && mvn test`; `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` |
| FR2 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | `--cpus`/`--memory`/`--memory-swap`/`--pids-limit`/`--ulimit`, exec-timeout cap, lifetime supervisor disk watchdog (measurement failure fails closed), background-writer containment, cgroup memory bound | `cd agent && mvn test`; integration command above |
| FR3 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | `--read-only`, `/tmp` tmpfs, workspace-only rw mount, `.git` ro from the mapped daemon path, no docker socket, no `--privileged` | `cd agent && mvn test`; integration command above |
| FR4 | Java unit + integration + Node script | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `EgressProxyScriptTest`, `DockerSandboxRunnerIntegrationTest` | Default-deny `--network none`; `allowlist` creates an internal network whose only peer is the hardened proxy; host wildcards allowed only as `*.domain`; localhost/metadata/IP literals and cloud/test ranges rejected; external DNS disabled; first CONNECT ClientHello SNI must match the allowlisted target; multiple SNI names/duplicate extensions/extra handshakes/ECH/missing SNI denied; CONNECT :80 rejected; allowed host/npm succeed and all denied paths are logged | `cd agent && mvn test`; `SANDBOX_IT_NETWORK=1 SANDBOX_IT_NETWORK_IMAGE=vibecode-agent-sandbox:latest mvn test -Dtest=DockerSandboxRunnerIntegrationTest#allowsOnlyTheConfiguredEgressHostsAndBlocksDirectAccess` |
| FR5 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Secret keys (including `OPENAI_KEY`) and credential URLs (scheme and scheme-less) rejected; container `env` has no provider/GitHub/DB secrets | `cd agent && mvn test`; integration command above |
| FR6 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Root uid rejected; `--user`, `--cap-drop ALL`, `no-new-privileges`; integration asserts `id -u == 1000` | `cd agent && mvn test`; integration command above |
| FR7 | Java unit + integration | `SandboxPathsTest`, `HostSandboxRunnerTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Lexical traversal and symlinked/FIFO copies rejected; Docker guards fail with non-zero exit codes (flood-proof) and require `OK`; downloads are size-checked before `docker cp` and use a temp file; host writes land in the workspace | `cd agent && mvn test`; integration command above |
| FR8 | Pending slice 3 | — | Prompt-injection classification, instruction precedence and output/exfiltration scanning | — |
| FR9 | Dockerfile/script unit | `SandboxImageSecurityScriptTest`; `VerificationRunnerTest` | All `FROM` images in `agent/Dockerfile`, `agent/sandbox.Dockerfile` and `agent/sandbox-proxy.Dockerfile` are `@sha256` pinned; the script rejects an unpinned fixture and allows `scratch`; SBOM (`syft`), scan (`trivy`/`grype`) and optional cosign verification are available; Node installs use `npm ci` when a lockfile exists and never create a lockfile | `cd agent && mvn test`; `bash agent/scripts/sandbox-image-security.sh --check-pins` |
| FR10 | Java unit + runtime | `SandboxConfigTest`, `SandboxRunnerFactoryTest` | Host is the compatibility default with a warning; strict booleans make `SANDBOX_REQUIRE=true` refuse host mode | `cd agent && mvn test` |
| FR11 | **Done** — exec/file + bridge | `SandboxBashBridgeTest`, `OpenCodeClientTest`, `OpenCodeConfigWriterTest`, `HarnessTicketProcessorTest`, `DockerSandboxRunnerIntegrationTest` | Loopback-only, per-run token, cwd/path mapping, command policy, timeout clamp, no inbound sandbox port; built-in `bash` and `shell` denied and `sandbox_bash` routed into the sandbox; real-Docker bridge exec smoke test; output streaming is D15 and idempotency is D17 | `cd agent && mvn test`; `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest#bridgeExecutesCommandsInsideTheSandbox` |
| NFR1 | Java unit + integration | `SandboxPathsTest`, `HostSandboxRunnerTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Escape/symlink rejection, read-only rootfs, workspace-only mount, no docker socket | `cd agent && mvn test`; integration command above |
| NFR2 | Java unit + integration | `DockerSandboxRunnerTest`, `EgressProxyScriptTest`, `DockerSandboxRunnerIntegrationTest` | `--network none` by default; allowlist mode has no default route and only the proxy peer; metadata/private addresses and direct egress denied | `cd agent && mvn test`; egress integration command above |
| NFR3 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Provider/GitHub/DB secrets absent from the sandbox env | `cd agent && mvn test`; integration command above |
| NFR4 | Java unit + integration | `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Timeout and quota kills destroy the process tree/container; a bounded repeated post-exec sweep kills daemonized children (background-writer regression); a fork during the final pass is D14 | `cd agent && mvn test`; integration command above |
| NFR5 | Pending slice 3 (D11) | — | Redaction before storage is not separate in slice 1; failure messages use the existing provider redaction | — |
| NFR6 | Java unit | `SandboxConfigTest`, `SandboxRunnerFactoryTest`, `HarnessTicketProcessorTest`, `DockerSandboxRunnerTest` | Strict config parsing; create failure is fatal; pre-publish destroy failure fails the ticket and never stages/pushes; `destroy` throws when `docker rm -f` cannot prove removal | `cd agent && mvn test` |
| NFR7 | Java unit + integration | `SandboxConfigTest`, `DockerSandboxRunnerTest`, `DockerSandboxRunnerIntegrationTest` | Non-root uid, `--cap-drop ALL`, `no-new-privileges`; integration asserts the uid | `cd agent && mvn test`; integration command above |

### Coverage notes

- CPU/PID enforcement is asserted through the `docker run` flags; the integration test asserts the memory cgroup bound. A behavioral CPU/PID stress test is deferred to slice 3.
- Supply chain (FR9): every base image in the supervisor, sandbox and proxy Dockerfiles is pinned by digest; `agent/scripts/sandbox-image-security.sh --check-pins` is the deterministic CI gate. `--sbom` uses syft (SPDX JSON under `agent/target/sbom/`), `--scan` uses trivy or grype with a HIGH/CRITICAL default, and `--all` optionally verifies a cosign signature when `COSIGN_PUBLIC_KEY` is set. SBOM/scan tools are optional locally; set `SANDBOX_SCAN_REQUIRED=1` in CI to fail instead of skipping. Node installs already use `npm ci` when a lockfile exists and `--no-package-lock` otherwise. Lifecycle scripts run inside the sandbox; a repo-profile opt-out is fg-39.
- The disk quota is enforced by a lifetime supervisor watchdog at `SANDBOX_DISK_CHECK_INTERVAL_SECONDS` granularity. Measurement failure (including per-file `visitFileFailed`) fails closed. Unlinked-but-open files are outside the supervisor walk and require a real FS quota (D12).
- The Docker file channel uses distinct non-zero exit codes for guard failures, so a same-UID stdout flood cannot mask them; successful guards also print `OK`/`OK <size>`. Downloads are sized inside the container before copying and use a temp file. The size and `docker cp` remain untrusted (D10).
- A pre-publish `destroy` failure fails the ticket and never stages or pushes; `DockerSandboxRunner.destroy` verifies removal and keeps tracking on failure. `close()` retries tracked containers and retains the shutdown hook while any remain; a hard-killed agent leaves cleanup to the D9 reaper.
- `SANDBOX_NETWORK=allowlist` creates a per-sandbox internal Docker network and a hardened proxy container (read-only rootfs, dropped capabilities, non-root, PID/memory/CPU limits, capped Docker logs). The proxy is attached to the upstream network only after it is healthy, and the sandbox joins only the internal network. It rejects IP literals, localhost, private/link-local/metadata addresses and cloud/test ranges (Azure WireServer, 192.0.0.0/24, 198.18/15, NAT64, 6to4, Teredo, documentation), unapproved ports and non-allowlisted hosts. For CONNECT tunnels it validates the first TLS ClientHello SNI and rejects multiple SNI names, duplicate SNI extensions, extra handshake messages, ECH and missing SNI. CONNECT :80 is rejected; plain HTTP uses per-request absolute-form validation. Only the first ClientHello is inspected, so TLS renegotiation and the encrypted inner HTTP Host remain a shared-CDN limitation (D16). An external `SANDBOX_EGRESS_PROXY` is rejected because it would reintroduce direct egress. External DNS is disabled in the sandbox (the proxy is addressed by IP and pinned in `/etc/hosts`), so DNS cannot be used as an untracked exfiltration channel; package managers still work through the proxy. Only denials are logged, rate-limited to 20/second, and Docker log size is capped for both the proxy and the sandbox. Denials are surfaced from `docker logs` when the sandbox is destroyed; live streaming of proxy logs is part of D15. The first-ClientHello probe timeout is configurable via `SANDBOX_EGRESS_PROBE_TIMEOUT_MS`. The proxy runs from the dedicated `SANDBOX_PROXY_IMAGE` (not a repo-specific sandbox image), and the supervisor explicitly clears the gated resolver test seam in the proxy environment.
- The OpenCode bash bridge binds to 127.0.0.1 with a per-run random token and is closed after the prompt. The sandbox has no route to the host loopback. In Docker mode the built-in `bash` and `shell` tools are denied and the global `sandbox_bash` tool forwards to the bridge; this is fail-closed if the custom tool fails to load. The bridge enforces the supervisor command policy and maps supervisor workspace paths to `/workspace`. Host mode keeps the built-in bash tool. There is no request ID/result cache yet (D17).
- Hostile install/test containment is covered by the real-Docker background-writer and postinstall-like lifecycle regressions. The descendant sweep is bounded (5 passes) but still best-effort (D14); a real npm lifecycle fixture and a built sandbox image are D13.
- `--init` is intentionally not used: PID 1 stays the container shell so the descendant sweep can preserve it. This is a deliberate trade-off for the sweep; zombie handling has not shown a problem in the probe, but the sweep's fork race is D14.
- The integration tests are opt-in (`SANDBOX_IT_IMAGE`, plus `SANDBOX_IT_NETWORK`/`SANDBOX_IT_NETWORK_IMAGE` for egress); CI and `PoolManager` wiring are D8/D13.
- NFR5 (redaction before storage) is D11; the FR11 streaming part is D15.

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix (NFR5 is a later slice)
- [x] Error paths and edge cases are covered, not only the happy path
- [x] Migration: N/A (agent-only; no DB migration)
- [x] API contract: N/A (no backend/frontend contract change)
- [x] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [x] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-06 | fg-34 slice 1 | `mvn test` (266 tests, 2 skipped) + `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` (2 tests) | All unit tests pass; the real-Docker smoke tests passed locally (non-root uid, read-only rootfs, workspace write, file copy, symlink/FIFO rejection, background/postinstall containment, pre-copy download cap, no docker socket, no secrets, memory limit, disk-quota kill) and skip when `SANDBOX_IT_IMAGE` is unset. |
| 2026-11-06 | fg-34 slice 2 | `mvn test` (309 tests, 4 skipped) + `SANDBOX_IT_NETWORK=1 SANDBOX_IT_NETWORK_IMAGE=vibecode-agent-sandbox:latest SANDBOX_IT_PROXY_IMAGE=vibecode-sandbox-proxy:latest mvn test -Dtest=DockerSandboxRunnerIntegrationTest#allowsOnlyTheConfiguredEgressHostsAndBlocksDirectAccess` + `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest` (4 tests, 1 skipped / 3 executed) + `SANDBOX_IT_IMAGE=redis:7-alpine mvn test -Dtest=DockerSandboxRunnerIntegrationTest#bridgeExecutesCommandsInsideTheSandbox` | All unit tests pass. The real-Docker egress test passed locally: the allowlisted host succeeded through the proxy; a non-allowlisted host, direct egress with proxy env cleared, and the metadata address were blocked; denials were logged. `EgressProxyScriptTest` covers the allowlist rules without Docker; `SandboxBashBridgeTest` covers the loopback token, cwd mapping and command policy. |
| 2026-11-06 | fg-34 slice 3b | `mvn test` (312 tests, 4 skipped) + `bash agent/scripts/sandbox-image-security.sh --check-pins` + `docker build -f agent/sandbox-proxy.Dockerfile -t vibecode-sandbox-proxy:test agent` + `mvn package -q -DskipTests` + `node planning/check-planning.js` | All tests pass. The pin gate accepts the repository Dockerfiles and rejects an unpinned fixture; the digest-pinned proxy image builds successfully. SBOM/scan/cosign paths are implemented but require syft/trivy/grype/cosign; CI runs the pin gate unconditionally and the scan when the tools are present (`SANDBOX_SCAN_REQUIRED=1` makes them mandatory). |
