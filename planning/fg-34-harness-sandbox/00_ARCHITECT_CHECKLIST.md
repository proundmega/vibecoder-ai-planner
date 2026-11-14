---
id: "fg-34"
title: "Harness Sandbox and Supply-Chain Security"
status: in_progress
priority: "P0"
effort: "Large"
scope: "Agent"
created: "2026-10-31"
updated: "2026-11-11"
pr: 132
branch: "master"
depends_on: ["fg-30"]
---

# 00 — Harness Sandbox and Supply-Chain Security (fg-34)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `OpenCodeClient`, `HarnessTicketProcessor`, `agent/Dockerfile`

## Why this ticket exists

Phase 1 runs OpenCode with `bash` access in a cloned repo on the agent container. Config deny-lists and prompt rules are not isolation: repo code, build scripts, tests and `npm install` lifecycle scripts can execute arbitrary code, reach the network, or read whatever the agent container can read.

## Scope decisions

- **Rollout:** `SANDBOX_MODE=host` remains the Phase 1 compatibility default. Docker mode is opt-in, and a Docker create/exec failure never falls back to host execution.
- **Slice 1** delivers the sandbox runtime foundation and routes supervisor-driven install/verification commands through it.
- **Slice 2** (merged in #127) adds the egress allowlist proxy (FR4) and bridges the OpenCode bash tool into the sandbox (FR11). The built-in `bash`/`shell` tool is disabled in Docker mode; the model uses `sandbox_bash`, which forwards over a per-run loopback token. The proxy validates the first CONNECT ClientHello SNI, rejects multiple SNI names/duplicate extensions/extra handshakes, rejects CONNECT :80, blocks external DNS, and logs denials only. TLS renegotiation and the encrypted inner HTTP Host inside TLS remain shared-CDN limitations (D16), and output streaming/idempotency are D15/D17.
- **Slice 3a** (merged in #128) adds prompt-injection defenses (FR8): untrusted-content labeling and instruction precedence, literal credential-path read denies, high-confidence credential/exfiltration command blocking on the bash bridge, and a pre-publish gate that scans guarded-tree changed blob contents and new paths (not diff text), compares content matches with the base blob so pre-existing fixtures are not treated as new leaks, compares complete PEM private-key blocks, and scans new gitlink paths. The read deny was not a secret boundary: OpenCode's read tool follows workspace symlinks and its grep tool can bypass path denies, tracked as **D18** and closed by slice 3d.
- **Slice 3b** (merged in #129) pins every base image by digest and adds `agent/scripts/sandbox-image-security.sh` plus a CI gate: the deterministic pin check always runs (case-insensitive `FROM`, UTF-8 BOM/CRLF tolerant, digest required on the image token, stage references skipped); SBOM (syft), vulnerability scan (trivy/grype) and optional cosign verification run when the tools are available, all three harness images are scanned in CI and SBOMs are archived.
- **Slice 3c** (merged in #130) redacts sandbox/verification output before it is stored (D11/NFR5): configured provider/GitHub/agent secrets plus high-confidence credential formats are replaced in branch names, ticket messages, durable-run errors and commit/PR titles and bodies; verification output and its exception messages are also pattern-redacted at capture so downstream consumers cannot persist a token. A credential-keyword lookahead runs before the possessive identifier so nested assignments inside non-credential values (`{"message": "password=..."}`, URL query credentials) are still examined while repeated keywords stay bounded; quoted values handle escaped quotes, unquoted values redact through end-of-line (stopping only at a quote or newline), and unmatched PEM/PGP/SSH2 blocks redact the remainder. The publish gate checks known secrets plus GitHub/OpenAI/AWS/Slack/Google/JWT tokens and PEM/PGP/SSH2 private-key blocks; Bearer/Basic, URL-userinfo and key/value forms are redaction-only. Encoded or split credentials remain out of scope. Legacy processors and external log shipping are D19.
- **Slice 3d** (merged in #132) closes D18: the built-in `read`/`grep`/`lsp` tools are disabled. `sandbox_read` and `sandbox_grep` forward to a loopback workspace bridge that resolves `toRealPath()`, rejects any target outside the workspace and the existing credential-path denies, and grep never follows symlinks. This prevents a workspace symlink (including one created via `sandbox_bash`) from exposing the supervisor's provider key or other host files.
- It does **not** claim full isolation yet: prompt-injection/supply-chain hardening are later slices. D14's freeze-and-verify descendant sweep is in review (#139); do not enable Docker mode for untrusted repositories until it merges, and do not treat the allowlist as a hard host boundary until D16 is closed. The pre-publish destroy gate also prevents publishing with a live sandbox.
- **Deployment:** Docker mode needs a daemon connection and a workspace path visible to the host. `PoolManager`/compose wiring is deferred to D8; slice 1 requires a manually run host agent (or equivalent path mapping).
- **Remaining slices** are tracked in `03_ARCHITECT_IMPLEMENTATION.md` and the deferred register below.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Run recovery with sandbox state | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D2 | Short-lived GitHub App tokens instead of PATs | fg-35 | Security | fg-35-github-app-credentials | resolved (#143) |
| D3 | Repo-specific images and caches | fg-39 | Infrastructure | fg-39-repo-environment-profiles | open |
| D4 | Data redaction before model calls | fg-42 | Privacy | fg-42-harness-privacy | open |
| D5 | Egress allowlist proxy (FR4) and the OpenCode bash-tool bridge into the sandbox (FR11 complete) | fg-34 | Security | fg-34 slice 2 | done (#127) |
| D6 | Prompt-injection classification, output scanning and instruction precedence (FR8) | fg-34 | Security | fg-34 slice 3a | done (#128) |
| D7 | SBOM, image scanning and digest-pinned base images (FR9) | fg-34 | Supply chain | fg-34 slice 3b | done (#129) |
| D8 | Docker sandbox deployment wiring: `PoolManager` env, socket proxy/DOCKER_HOST and a host-visible repo volume | fg-34 | Infrastructure | fg-34 slice 2 / fg-43 | open |
| D9 | Startup reaper for sandbox containers left by a killed agent (the slice-1 shutdown hook covers graceful exit only) | fg-34 | Reliability | fg-34 slice 2 | open |
| D10 | Race-free artifact copy: the Docker file channel rejects failures by exit code, but `docker cp` and the reported size remain untrusted; a same-container swap/spoof is possible | fg-34 | Security | fg-34 slice 2 | open |
| D11 | Redaction before storage (NFR5): sandbox/verification output is redacted for configured secrets and high-confidence credential formats before ticket messages, run errors and PR bodies are stored | fg-34 | Privacy | fg-34 slice 3c | done (#130) |
| D12 | True disk quota: the supervisor walk cannot see unlinked-but-open files; a quota-enabled volume/filesystem is the durable fix | fg-34 | Reliability | fg-34 slice 2 | open |
| D13 | CI builds the sandbox and proxy images and runs `DockerSandboxRunnerIntegrationTest` against them, including the egress allowlist check and a host-visible workspace mapping; locally the suite remains opt-in via `SANDBOX_IT_IMAGE` | fg-34 | Testing | fg-34 slice 2 | in review (#140) |
| D14 | Post-exec descendant sweep closes the fork race with a frozen quiescence check: after the bounded kill passes, the container is paused (cgroup freezer) so no process can fork; the init host PID is read from `docker inspect` and the frozen `docker top -eo pid,stat,comm` table is parsed (portable `ps -ef` fallback). PID 1 is a childless `exec sleep`, so it cannot respawn a child; execs are serialized per sandbox so one sweep cannot freeze another command; a blank, header-only, failed or truncated table is unverified. The sandbox is destroyed with verified removal/kill if any other live process remains or the freeze/table/destroy check fails, and the handle is marked **compromised**: the exec throws even after a successful cleanup, and `destroy()` refuses to report it clean (the compromised flag is terminal until `close()`) so the pre-publish gate blocks publishing (including when no verification commands ran). A paused container cannot write | fg-34 | Security | fg-34 slice 2 | done (#139) |
| D15 | Streaming exec output over the sandbox control channel (FR11): the bridge currently buffers each command's bounded output. A streaming API is needed for long installs and live progress | fg-34 | UX/Reliability | fg-34 slice 3 | open |
| D16 | TLS renegotiation and the encrypted HTTP Host inside a CONNECT tunnel are not visible without TLS termination. The proxy validates only the first ClientHello (multiple SNI names/extra handshakes are rejected); a later renegotiation ClientHello or a shared-CDN tenant that serves the same allowlisted SNI can still be reached. Dedicated hosts or proxy TLS termination would close this | fg-34 | Security | fg-34 slice 3 | open |
| D17 | Bridge request IDs/idempotency: the bridge has no request ID or result cache, so a lost HTTP response can lead to a re-executed command. A stable request ID and bounded idempotency cache are needed | fg-34 | Reliability | fg-34 slice 3 | open |
| D18 | OpenCode read/grep can expose supervisor-only files despite the FR8 read denies: the read tool normalizes then follows symlinks (a repo symlink or one created via `sandbox_bash` can point outside the workspace), and the grep tool/ripgrep bypasses read path rules. Slice 3d disables the built-in read/grep/lsp tools and adds `sandbox_read`/`sandbox_grep` over a loopback workspace bridge that resolves `toRealPath()`, rejects paths outside the workspace and credential paths, and never follows symlinks during grep | fg-34 | Security | fg-34 slice 3d | done (#132) |
| D19 | Agent-wide redaction beyond harness mode: legacy `TicketProcessor`/`ReviewProcessor` messages and PRs and externally shipped supervisor logs are not covered by the harness redactor | fg-34 | Privacy | fg-34 follow-up / fg-42 | open |
| D20 | The built-in `edit`/write tool is not wrapped like read/grep: its `external_directory` deny is lexical, so a workspace symlink can still point at a supervisor path for writes (and possibly error-message reads). Built-in edit/write/multiedit/patch are denied; `sandbox_write`/`sandbox_edit` (and read/grep) walk paths through `SecureDirectoryStream` with NOFOLLOW on every component **including the final open**, reject symlink/non-regular and credential/VCS/control targets, and bound the replacement before allocation | fg-34 | Security | fg-34 follow-up | done (#138) |
| D21 | Guarded bridge writes bypass the OpenCode formatter/LSP/watcher and have no per-file lock; add formatting/diagnostics/watcher events and a bounded per-file lock if edit quality or concurrent-edit clobbering becomes a problem | fg-34 | Quality | fg-34 follow-up | open |
| D22 | Host mode on providers without `SecureDirectoryStream` (native Windows, FUSE-backed workspaces, etc.) uses a non-atomic canonical-path fallback; sandbox mode fails fast at bridge startup. Provide a secure implementation or keep the host-only limitation explicit; host mode is not a security boundary | fg-34 | Security | fg-34 follow-up | open |
| D23 | FIFO final-component swap race: the regular-file check can still be followed by a racing FIFO open. Add a bounded/non-blocking open or document the residual DoS race | fg-34 | Reliability | fg-34 follow-up | open |
