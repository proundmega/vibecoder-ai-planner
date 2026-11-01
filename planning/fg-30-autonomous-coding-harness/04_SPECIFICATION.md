# 04_SPECIFICATION.md — Model Execution Spec (Phase 1)

**Use this file for Phase 1 only.** Phases 2–4 require their own specification after Phase 1 is
validated.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: implementation agent with architecture context (not a 7B model)
**Date**: 2026-10-31

---

## Test-First Requirement

Create **empty test stubs** for every test class listed in "Test Expectations" before writing
production code. Stubs must contain imports, class declarations and `@Test` methods (bodies may be
empty). Fill them after the production classes exist.

---

## Phase 1 Scope

A backlog ticket is processed by an OpenCode server harness, verified, committed to a ticket branch,
pushed, and opened as a PR. No human questions yet (the `question` tool is denied; the prompt says to
make reasoned assumptions). Legacy behavior remains the default.

**Phase 1 is genuinely unattended:** every permission resolves to `allow` or `deny`, safe bash commands
are allowlisted, and any unexpected permission request is auto-rejected. There is no `ask` rule and no
permission bridge.

**Scope of code changes in Phase 1:**
- Agent: harness, secure workspace, provider proxy, redaction, Dockerfile.
- Backend: **minimal lifecycle synchronisation only** (`TicketLifecycleService`, `PhaseService`
  `backlog` phase, `TicketService` delegation) so `status` and `phase` cannot drift. No DB schema
  changes and no new tables.
- Frontend: none.
- Phase 0 (provider session header, version pin, spec fixture, smoke test) is a prerequisite sub-phase
  and is not part of this 04 file.

---

## Environment Variables (exact)

| Variable | Default | Meaning |
|---|---|---|
| `HARNESS_MODE` | `legacy` | `legacy` or `opencode` |
| `HARNESS_BIN` | `opencode` | OpenCode executable |
| `HARNESS_STARTUP_TIMEOUT_MS` | `30000` | Server health timeout |
| `HARNESS_IDLE_TIMEOUT_MS` | `300000` | Max time without events |
| `HARNESS_MAX_DURATION_MINUTES` | `45` | Hard wall-clock cap |
| `HARNESS_VERIFY_COMMANDS` | `` | Semicolon-separated commands; empty = autodetect |
| `HARNESS_PROTECTED_PATHS` | `.env*;.github/workflows/**;**/secrets/**;backend/src/migrations/**;backend/src/middleware/auth*;backend/src/services/UserService.js;backend/src/validators/auth*` | Semicolon-separated publish-blocking globs |
| `HARNESS_BASH_ALLOWLIST` | safe prefixes (see config writer) | Semicolon-separated command prefixes allowed in Phase 1 |
| `HARNESS_PERMISSION_MODE` | `unattended` | Phase 1 must be `unattended`; `ask` is rejected at startup |
| `HARNESS_MODEL` | `` | Optional model override |
| `OPENCODE_SERVER_PASSWORD` | generated per run | Set by the client, not by users |
| `HARNESS_PROXY_TOKEN` | generated per run | Internal; authenticates the harness to `ProviderProxy` |

`AgentConfig.toString()` must never include provider keys or the server password.

---

## File Operations

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/HarnessEvent.java`

```java
public record HarnessEvent(String type, com.fasterxml.jackson.databind.JsonNode payload, long timestampMs) {
    public boolean isToolEvent();
    public boolean isIdle();
    public boolean isError();
}
```

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/HarnessConfig.java`

```java
public record HarnessConfig(
    String mode,
    String binary,
    java.time.Duration startupTimeout,
    java.time.Duration idleTimeout,
    java.time.Duration maxDuration,
    java.util.List<String> verificationCommands,
    java.util.List<String> protectedPaths,
    java.util.List<String> bashAllowlist,
    String permissionMode,
    String modelOverride
) {
    public static HarnessConfig fromEnvironment();
    public boolean isEnabled();
    public void validate();
}
```

- `isEnabled()` → `"opencode".equalsIgnoreCase(mode)`.
- `validate()` throws `IllegalStateException` for blank binary, non-positive durations, or a
  `permissionMode` other than `unattended` in Phase 1.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/HarnessClient.java`

```java
public interface HarnessClient extends AutoCloseable {
    void start(java.nio.file.Path workspace) throws java.io.IOException;
    String createSession(String title) throws java.io.IOException;
    void subscribe(String sessionId, java.util.function.Consumer<HarnessEvent> listener) throws java.io.IOException;
    void sendPromptAsync(String sessionId, String prompt) throws java.io.IOException;
    void replyPermission(String sessionId, String permissionId, String reply) throws java.io.IOException;
    DiffSummary getDiff(String sessionId) throws java.io.IOException;
    boolean isHealthy();
    @Override void close();
}
```

`subscribe` must complete before `sendPromptAsync` is called. The blocking `/message` endpoint is not
used. `replyPermission` is used by the Phase 1 auto-reject safety path and by the Phase 2 bridge.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/ProviderSettings.java`

```java
public record ProviderSettings(
    String type, String apiKey, String baseUrl, String model, int maxTokens
) {}
```

`AgentApp` resolves this once from the backend/env. The legacy path uses it directly; the harness path
passes it to `ProviderProxy` only. The OpenCode config receives a per-run dummy key, never `apiKey`.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/OpenCodeConfigWriter.java`

```java
public final class OpenCodeConfigWriter {
    public static java.nio.file.Path write(
        java.nio.file.Path tempDir,
        ProviderSettings provider,
        HarnessConfig config,
        java.nio.file.Path workspace
    ) throws java.io.IOException;
}
```

Rules:

- Write `opencode.json` in `tempDir` (outside `workspace`), POSIX mode `600` when supported.
- Provider mapping (all through `ProviderProxy` at `http://127.0.0.1:<port>/v1`):
  - use a custom `vibecode` provider (`@ai-sdk/openai-compatible`) with the dummy per-run proxy key and
    model `vibecode/<model>`; the proxy forwards to the real upstream and injects `Authorization` and,
    for Go/Console, `x-opencode-session`.
  - if the pinned build supports overriding the built-in `opencode` provider `baseURL`, use it for
    Go/Console keys instead; either way the real key stays in the proxy.
  - `claude`/`openai`/`generic` map to the same proxy with their upstream path.
- Permissions (Phase 1 — **no `ask` anywhere**):
  - `read`: `"*": "allow"`, then deny `**/.env`, `**/.env.*`, `**/secrets/**`, `**/*.pem`,
    `**/*.key`, `**/id_rsa*`, `**/.git/config`.
  - `edit`: `"*": "allow"`, then deny the same paths plus `**/.github/workflows/**`,
    `backend/src/migrations/**`, `backend/src/middleware/auth*`,
    `backend/src/services/UserService.js`, `backend/src/validators/auth*`.
  - `glob`: `allow`. `grep`: `allow` (secret files are physically removed before start).
  - `bash`: `"*": "deny"`, then allow only: `git status*`, `git diff*`, `git log*`, `git show*`,
    `ls*`, `pwd*`, `rg*`, `find*`, `npm test*`, `npm run lint*`, `npm run typecheck*`,
    `npm run build*`, `npx vitest run*`, `npx jest*`, `mvn test*`, `./mvnw test*`, `pytest*`,
    `python -m pytest*`, `make test*`, `go test*`, `cargo test*`. Explicitly deny `rm *`, `sudo*`,
    `docker*`, `kubectl*`, `git push*`, `git commit*`, `git merge*`, `git reset --hard*`,
    `cat *.env*`, `curl*`, `wget*`.
  - `webfetch`, `websearch`, `task`, `question`, `external_directory`, `doom_loop`: `deny`.
- `validateUnattended()` parses the rendered JSON and throws if any value is `ask`.
- Add `"$schema": "https://opencode.ai/config.json"`, `"autoupdate": false`, `"share": "disabled"`.
- Never log the API key; redact on error.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/WorkspaceSanitizer.java`

```java
public final class WorkspaceSanitizer {
    public java.util.List<String> sanitize(java.nio.file.Path workspace) throws java.io.IOException;
    public void assertClean(java.nio.file.Path workspace) throws java.io.IOException;
}
```

Rules:

- Delete `.env`, `.env.*` except `.env.example`, `**/secrets/**`, `**/*.pem`, `**/*.key`,
  `**/id_rsa*`, and any file the token scanner identifies as containing the PAT/provider key.
- Remove the `origin` remote or reset it to the unauthenticated URL; ensure `.git/config` has no
  `http.extraheader` or token.
- `assertClean` re-scans and throws with paths (never contents) if a secret remains.
- Keep a list of removed paths for the summary (paths only, no contents).

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/ProviderProxy.java`

```java
public final class ProviderProxy implements AutoCloseable {
    public ProviderProxy(ProviderSettings settings, java.util.function.Supplier<String> sessionIdSupplier);
    public void start() throws java.io.IOException;
    public String baseUrl();           // http://127.0.0.1:<port>/v1
    public String dummyApiKey();       // per-run token, not the real key
    @Override public void close();
}
```

Rules:

- Bind `127.0.0.1:0`; reject requests whose peer is not loopback.
- Require `X-Vibecode-Proxy-Token: <dummyApiKey>` on every request; otherwise 401.
- Strip any client-supplied `Authorization`/`x-opencode-session`, then inject the real provider
  `Authorization` and (for Go/Console) `x-opencode-session`.
- Never log headers or the real key; redact errors.
- Forward method, path, query, body and streaming response; support SSE/chunked responses.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/SecretRedactor.java`

```java
public final class SecretRedactor {
    public SecretRedactor(java.util.Collection<String> knownSecrets);
    public String redact(String text);
}
```

- Replace known secret values with `[REDACTED]` (longest first).
- Replace token-shaped patterns: `ghp_[A-Za-z0-9]{20,}`, `github_pat_[A-Za-z0-9_]{20,}`,
  `oc_sk_[A-Za-z0-9_-]{8,}`, `sk-[A-Za-z0-9_-]{16,}`, `Bearer\s+[A-Za-z0-9._-]+`.
- Apply before posting messages, persisting events, logging and throwing.
- Test with fake output containing every pattern.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/PlanningDocFetcher.java`

```java
public final class PlanningDocFetcher {
    public PlanningDocFetcher(ApiService apiService, AgentConfig config);
    public java.util.List<String> fetch(Long ticketId);
}
```

Move the existing `TicketProcessor.fetchPlanningDocs` logic here; `TicketProcessor` delegates to it
(no behavior change).

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/PromptBuilder.java`

```java
public final class PromptBuilder {
    public String build(
        com.vibecode.agent.model.Ticket ticket,
        java.util.List<String> planningDocs,
        java.util.List<String> verificationCommands
    );
}
```

Must include:

1. Role: autonomous coding agent working in an isolated workspace.
2. Ticket id/title/description.
3. Planning docs (truncate each doc to 40,000 chars; note truncation).
4. Repository conventions: read `AGENTS.md`, `README.md`, `ai/CODING.md` if present; follow stack commands.
5. Working rules:
   - inspect/search before editing,
   - use `edit`/`apply_patch` for existing files (never rewrite blind),
   - smallest coherent change, no unrelated refactors,
   - test-first when the repo requires it,
   - run verification commands and fix failures,
   - do not commit, push, merge, or read `.env*`,
   - make a reasonable assumption instead of asking (Phase 1 question tool is disabled),
   - never access paths outside the workspace.
6. Definition of done: verification commands pass; no secrets; summary of files/tests/risks.
7. Final response format: plain text summary (no JSON file operations).

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/DiffSummary.java`

```java
public record DiffSummary(
    java.util.List<ChangedFile> files,
    int additions,
    int deletions
) {
    public record ChangedFile(String path, String status) {}
    public boolean isEmpty();
    public int changedFileCount();
}
```

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/VerificationResult.java`

```java
public record VerificationResult(String command, int exitCode, String output, boolean timedOut) {
    public boolean passed();
}
```

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/VerificationRunner.java`

```java
public final class VerificationRunner {
    public VerificationRunner(HarnessConfig config);
    public java.util.List<String> resolveCommands(java.nio.file.Path workspace);
    public java.util.List<VerificationResult> run(
        java.nio.file.Path workspace,
        java.util.List<String> commands,
        java.time.Duration timeout
    );
}
```

- `resolveCommands`: if configured list non-empty, return it. Otherwise detect:
  - `package.json` + `scripts.test` → `npm test -- --run` (or `npm test` when no `--run` script),
  - `scripts.lint`, `scripts.typecheck` if present,
  - `pom.xml` → `mvn test -q`,
  - `Makefile` with a `test` target → `make test`.
- Execute with `ProcessBuilder`, working directory = workspace, merged stdout/stderr, capture last
  8,192 chars, kill on timeout.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/PublishingGuard.java`

```java
public final class PublishingGuard {
    public PublishingGuard(java.util.List<String> protectedGlobs);
    public void assertPublishable(DiffSummary diff);
}
```

Throws `IllegalStateException` when:

- diff is empty,
- any changed path matches a protected glob (case-insensitive, `**` supported),
- more than 50 files or 2,000 changed lines (Phase 1 hard safety cap).

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/OpenCodeClient.java`

```java
public final class OpenCodeClient implements HarnessClient {
    public OpenCodeClient(HarnessConfig config, ProviderSettings provider, java.nio.file.Path tempDir);
    // interface methods
    public void awaitIdle(java.time.Duration timeout) throws java.io.IOException;
    public int getPort();
}
```

Behavior:

- Pick a free loopback port (`ServerSocket(0)`).
- Create temp `HOME` under `tempDir`.
- Generate `OPENCODE_SERVER_PASSWORD` (32 hex chars) and pass it plus `OPENCODE_CONFIG` to the process.
- Start `binary serve --hostname 127.0.0.1 --port <port>` with the workspace as working directory.
- Health: `GET /global/health` until `{"healthy":true}` or startup timeout; kill on failure.
- HTTP uses OkHttp with basic auth (`opencode:<password>`); never log headers.
- **Paths are derived from the pinned OpenAPI fixture**, not hardcoded from this document. For the
  pinned 1.19.5 baseline they are:
  - `createSession`: `POST /api/session` `{ "title": "ticket-<id>" }` → `id`.
  - `subscribe`: `GET /api/event` SSE via `okhttp-sse`; filter events for the session id.
  - `sendPromptAsync`: `POST /api/session/<id>/prompt` with the prompt body.
  - `replyPermission`: `POST /api/session/<id>/permission/<requestId>/reply` with `{ reply }`.
  - `getDiff`: `GET /api/session/<id>/diff`; fall back to `git status --porcelain` +
    `git diff --numstat` executed by `WorkspaceManager`.
  - Never use the deprecated `POST /session/:id/permissions/:permissionID`, and never use the blocking
    `/api/session/<id>/message` endpoint.
- During subscription startup, buffer events until the listener is registered, then dispatch. The
  client exposes `awaitSubscribed()` so the processor can send the prompt only after SSE is live.
- `awaitIdle`: block until an idle event, error event, or timeout.
- `close`: delete session (best effort), destroy process (wait 5s, then force), delete temp dir.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/HarnessTicketProcessor.java`

```java
public final class HarnessTicketProcessor {
    public HarnessTicketProcessor(
        AgentConfig config,
        ApiService apiService,
        ProviderSettings provider,
        GitHubService gitHubService,
        String githubToken
    );
    public void processTicket(Ticket ticket);
    public String getCurrentTicketId();
    public String getCurrentStep();
}
```

Flow:

1. `pickUpTicket` via `TicketLifecycleService`; bail if null.
2. Post "Started working" (redacted).
3. Fetch planning docs via `PlanningDocFetcher`.
4. Clone repo + branch via `WorkspaceManager` (tokenless).
5. `step="sanitizing"`; `WorkspaceSanitizer.sanitize` + `assertClean`; run the bounded supervisor
   dependency bootstrap (`npm ci` with a lockfile, `pip install -r`, or `mvn dependency:go-offline`).
6. `step="starting-harness"`; start `ProviderProxy`, then `OpenCodeClient`; create session.
7. `step="implementing"`; **subscribe first**, wait for `awaitSubscribed`, then `sendPromptAsync`;
   await idle with `maxDuration`. Auto-reject any unexpected permission event.
8. `step="verifying"`; resolve + run verification commands; post a redacted pass/fail summary.
9. If verification fails: post redacted last 8KB output; **release to `backlog`** in Phase 1 (no human
   loop yet); stop (no commit/push). Phase 2 changes this to `blocked` + notification.
10. `step="publishing"`; collect diff; `PublishingGuard`; commit/push with one-shot auth; create PR;
    update `pr_url`.
11. Post redacted summary (files, commands, PR); transition to `review` (phase+status atomically).
12. Always: close client/proxy, cleanup workspace, reset step.

Failure handling: post a redacted error message, release the ticket to `backlog`, never push. Catch all
`Throwable` except `ThreadDeath`; preserve interruption. Phase 2 replaces release with `blocked` +
notification when a human loop exists.

### MODIFY: `agent/src/main/java/com/vibecode/agent/config/AgentConfig.java`

Add fields/getters for all harness env vars. `toString()` excludes secrets. Defaults must match the
table. Existing required vars unchanged.

### MODIFY: `agent/src/main/java/com/vibecode/agent/AgentApp.java`

- Resolve `ProviderSettings` once (refactor `createAiProvider` to use it).
- Read `HarnessConfig.fromEnvironment()`.
- If `config.isEnabled()`, construct `HarnessTicketProcessor`; else legacy `TicketProcessor`.
- Heartbeat `currentStep` remains sourced from the selected processor.
- Review mode unchanged.

### MODIFY: `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java`

Add:

```java
public java.nio.file.Path getRepoDir();
public DiffSummary collectDiff();
public void commitAndPush(String message, String branch); // exists; secure it
```

- **Tokenless clone:** use `git -c http.extraHeader="Authorization: Basic <base64>"`; never put the
  token in the URL; never `git remote set-url origin <authenticatedUrl>`. Remove/reset `origin` before
  the harness starts.
- **Tokenless push:** `commitAndPush` uses the same one-shot header; the token is not persisted.
- `collectDiff` runs `git status --porcelain` and `git diff --numstat` in the repo dir and returns
  `DiffSummary`; include untracked files as `status="added"`.

### MODIFY: `backend/src/services/TicketLifecycleService.js`, `PhaseService.js`, `TicketService.js`

Phase 1 minimal lifecycle sync (no schema changes):

- Add `backlog` to `PhaseService.ALLOWED_TRANSITIONS` and `PHASE_TO_STATUS`.
- `TicketLifecycleService.pickUp/release/markReview/block/resume` performs assignment + phase + status +
  `ticket_phases` in one transaction.
- `TicketService.pickUpTicket/releaseTicket` delegate; the harness never uses status-only updates.
- Tests assert `status` and `phase` remain consistent on every path.

### MODIFY: `agent/pom.xml`

Add:

```xml
<dependency>
  <groupId>com.squareup.okhttp3</groupId>
  <artifactId>okhttp-sse</artifactId>
  <version>${okhttp.version}</version>
</dependency>
<dependency>
  <groupId>com.squareup.okhttp3</groupId>
  <artifactId>mockwebserver</artifactId>
  <version>${okhttp.version}</version>
  <scope>test</scope>
</dependency>
```

### MODIFY: `agent/Dockerfile`

- Base on **glibc** (`eclipse-temurin:17-jre-jammy`). OpenCode ships a glibc binary; do not assume
  musl/Alpine compatibility.
- Copy Node 24 from `node:24-bookworm-slim` into the runtime stage (binary + `/usr/local/lib`).
- `apt-get install -y --no-install-recommends git ripgrep bash curl jq python3 make ca-certificates`.
- `ARG HARNESS_VERSION`; `npm install -g opencode-ai@${HARNESS_VERSION}` as root, then ensure the
  non-root `agent` user can read. Assert `opencode --version` equals `HARNESS_VERSION` and
  `ldd $(which opencode)` resolves at build time.
- Create writable `/repos` and `/tmp/opencode` owned by `agent`.
- Keep the existing non-root user and entrypoint.
- If the pinned artifact is musl-only, switch the base to Alpine and document it; never mix a musl
  binary with a glibc base.

### MODIFY: documentation

- `AGENTS.md`: add harness env vars and architecture note.
- `README.md`: agent section.
- `backend/.env.example`: no changes required for Phase 1 (agent env only), unless documenting in agent
  `.env.example` (create one if absent).

---

## Test Expectations

### `FakeOpenCodeServer` (test helper)

- HTTP server with:
  - `GET /global/health` → `{"healthy":true,"version":"test"}`,
  - `POST /api/session` → `{"id":"ses_test"}`,
  - `POST /api/session/ses_test/prompt` → `{"info":{"id":"msg_1"}}`,
  - `GET /api/event` → SSE with scripted events (`tool`, `idle`) then keep-alive,
  - `GET /api/session/ses_test/diff` → JSON diff,
  - `POST /api/session/ses_test/permission/perm_1/reply` → `true`,
  - `DELETE /api/session/ses_test` → `true`.
- Records received prompt body and the order of subscribe vs prompt calls.
- A `fastEvents` mode emits tool/idle immediately after the prompt to prove no events are missed.

### `PromptBuilderTest`

```
✓ [happy] includes ticket id, title, description
✓ [happy] includes every planning doc and truncation marker for oversized docs
✓ [happy] includes verification commands and definition of done
✓ [edge] no planning docs still produces a valid prompt
✓ [security] prompt contains no provider key or GitHub token
```

### `VerificationRunnerTest`

```
✓ [happy] runs a passing command and reports exit 0
✓ [error] reports non-zero exit and captures output
✓ [edge] kills a command that exceeds the timeout and marks timedOut
✓ [edge] truncates output to 8192 chars
✓ [detect] resolves Vitest with `npm test -- --run`
✓ [detect] resolves Jest with `npm test` and never appends `--run`
✓ [detect] resolves lint/typecheck only when scripts exist
✓ [detect] resolves mvn test from pom.xml and make test from Makefile
✓ [error] no detectable commands and no explicit config fails clearly
```

### `PublishingGuardTest`

```
✓ [happy] allows a normal diff
✓ [error] rejects an empty diff
✓ [error] rejects .env, .github/workflows/**, **/secrets/**, auth and migrations
✓ [error] rejects > 50 files or > 2000 lines
```

### `OpenCodeClientTest`

```
✓ [happy] starts the server, creates a session, subscribes, then sends an async prompt
✓ [timing] fastEvents: tool/idle emitted immediately after prompt are not missed
✓ [happy] parses scripted SSE tool/idle events
✓ [happy] replies reject to an unexpected permission request
✓ [happy] uses the pinned permission/form paths from the OpenAPI fixture
✓ [error] health timeout kills the process and throws
✓ [error] HTTP 500 from create-session surfaces a redacted error
✓ [cleanup] close deletes the session, stops the process, stops the proxy and removes temp files
```

### `PermissionPolicyTest`

```
✓ [config] generated Phase 1 config contains no "ask" value
✓ [config] validateUnattended rejects an injected ask
✓ [bash] safe test/lint/typecheck/git-read commands are allowed
✓ [bash] rm/sudo/docker/git push/git commit/curl/wget are denied
✓ [paths] .env/secrets/auth/migrations are denied for read and edit
✓ [safety] unexpected permission request is auto-rejected, not parked
```

### `WorkspaceSanitizerTest`

```
✓ [happy] removes .env and .env.local, keeps .env.example
✓ [happy] removes secrets/*.pem/*.key/id_rsa
✓ [happy] strips token-bearing .git/config and origin
✓ [error] assertClean throws (paths only) if a secret remains
```

### `ProviderProxyTest`

```
✓ [happy] forwards an OpenAI-compatible request and injects real auth
✓ [happy] injects x-opencode-session for Go/Console
✓ [security] rejects non-loopback peers and missing proxy token
✓ [security] never logs or returns the real key
```

### `SecretRedactorTest`

```
✓ [security] redacts ghp_/github_pat_/oc_sk_/sk-/Bearer shapes
✓ [security] redacts known secret values, longest first
✓ [security] redacted text is idempotent
```

### `HarnessTicketProcessorTest`

```
✓ [happy] picks up, prompts, verifies, commits, pushes, opens PR, sets review
✓ [happy] subscribes before prompting (fake server asserts call order)
✓ [error] verification failure posts redacted output, blocks ticket, never pushes
✓ [error] protected path blocks publishing and releases ticket
✓ [error] harness startup failure releases ticket and cleans up
✓ [security] no PAT, provider key or token shape appears in posted messages/errors
✓ [lifecycle] status and phase match after pickup, block, release and review
```

### `AgentConfigTest` additions

```
✓ [default] HARNESS_MODE defaults to legacy
✓ [parse] durations/semicolons parse correctly and invalid values fall back to defaults
✓ [security] toString never includes API keys, proxy token or server password
```

### Backend `TicketLifecycleSyncTest`

```
✓ [pickup] sets status=in_progress and phase=in_progress atomically with assignment
✓ [release] sets status=backlog and phase=backlog and clears assignment/lock
✓ [review] sets status=review and phase=review
✓ [block] sets phase=blocked and keeps status=in_progress (no drift)
✓ [error] a failed transition rolls back assignment and phase history
```

---

## Edge Cases to Handle

1. **Port collision** — retry with a new ephemeral port up to 3 times.
2. **Server exits early** — detect process death, capture last 8KB of logs, throw with a redacted message.
3. **No events** — idle timeout triggers abort; release ticket; no push.
4. **Empty diff** — no commit/PR; post "no changes" and release.
5. **Protected path changed** — block publishing; post the paths; release; auth/migrations included.
6. **Verification flake** — Phase 1: fail once, report; no automatic retry (Phase 3 adds retry policy).
7. **Agent process interrupted** — destroy server/proxy, cleanup workspace, release ticket in `finally`.
8. **Planning docs missing** — proceed with ticket only; note it in the prompt.
9. **Provider missing/invalid** — fail before starting the server with a clear error.
10. **Windows dev** — no OpenCode binary: tests use the fake server; `HARNESS_MODE=legacy` remains usable.
11. **Unexpected permission request** — auto-reject, log a redacted warning, continue; never stall.
12. **Secret-shaped output** — `SecretRedactor` redacts before posting; never post raw output.
13. **Token in git remote** — `WorkspaceSanitizer` removes it and `PublishingGuard` blocks if it appears.
14. **No safe verification command** — fail clearly; do not publish unverified code.

---

## Existing Code Patterns to Follow

- Java 17, OkHttp 4.12, Jackson `ObjectMapper`, SLF4J logging.
- `java.nio.file` APIs, no shelling out for file edits.
- All error messages must redact `Authorization`, API keys and tokens.
- Existing `ApiService` for backend calls; do not duplicate HTTP clients for backend calls.
- Existing `WorkspaceManager`/`GitHubService` for git/PR operations.
- Test classes under `agent/src/test/java/com/vibecode/agent/harness/`.
- No real network calls in tests.

---

## Files NOT to Change (Phase 1)

- `backend/src/**` — **except** the Phase 1 lifecycle sync files listed above
  (`TicketLifecycleService.js`, `PhaseService.js`, `TicketService.js`). No other backend API/DB changes.
- `backend/src/migrations/**` — Phase 2 (no schema changes in Phase 1).
- `frontend/src/**` — no UI changes in Phase 1.
- `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` — legacy behavior preserved
  (only extract `fetchPlanningDocs` if desired, with identical behavior).
- `agent/src/main/java/com/vibecode/agent/service/ReviewProcessor.java` — unchanged.
- `docker-compose.yml` — no new services in Phase 1; the existing agent image is reused.

---

## Pending Scope Items

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | bp-120 | Agent connectivity fixes (provider envelope, heartbeat listing) | Agent | `bp-120-agent-connectivity-fixes` | Yes (PR #101) |
| 2 | bp-121 | Non-localhost agent CORS/IP support | Agent / Security | `bp-121-agent-connectivity-ip` | Yes (PR #101) |
| 3 | bp-71 | Email notifications (reuse for agent questions) | UX / Security | `bp-71-email-notifications` | Yes (PR #101) |
| 4 | bp-74 | Session/API key rotation | Security | `bp-74-session-credentials` | Yes (PR #101) |
| 5 | bp-14 | S3 planning storage | Infrastructure | `bp-14-s3-planning-storage` | Yes (PR #101) |
| 6 | bp-53 | Distributed session state | Infrastructure | `bp-53-harness-session-state` | Yes (PR #101) |
| 7 | bp-106 | Harness event shipping to log aggregation | Observability | `bp-106-harness-event-shipping` | Yes (PR #101) |
| 8 | bp-04 | Harness cost/budget dashboard | Observability / Billing | `bp-04-harness-budgets` | Yes (PR #101) |
| 9 | fg-13 | API contract updates for new endpoints | Testing | `fg-13-contract-followup` | Yes (PR #101) |
| 10 | bp-99 | E2E coverage for harness UI | Testing | `bp-99-e2e-harness-ui` | Yes (PR #101) |

---

*This specification is the contract for Phase 1. If the pinned OpenCode API differs, stop and update
the contract tests and this document before continuing.*
