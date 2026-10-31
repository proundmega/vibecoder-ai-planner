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

**No database, backend or frontend changes are required in Phase 1**, except documentation/env
examples and optional heartbeat metadata.

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
| `HARNESS_PROTECTED_PATHS` | `.env*;.github/workflows/**;**/secrets/**` | Semicolon-separated globs |
| `HARNESS_MODEL` | `` | Optional model override |
| `OPENCODE_SERVER_PASSWORD` | generated per run | Set by the client, not by users |

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
    String modelOverride
) {
    public static HarnessConfig fromEnvironment();
    public boolean isEnabled();
    public void validate();
}
```

- `isEnabled()` → `"opencode".equalsIgnoreCase(mode)`.
- `validate()` throws `IllegalStateException` for blank binary or non-positive durations.

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/HarnessClient.java`

```java
public interface HarnessClient extends AutoCloseable {
    void start(java.nio.file.Path workspace) throws java.io.IOException;
    String createSession(String title) throws java.io.IOException;
    void sendPrompt(String sessionId, String prompt) throws java.io.IOException;
    void subscribe(String sessionId, java.util.function.Consumer<HarnessEvent> listener) throws java.io.IOException;
    DiffSummary getDiff(String sessionId) throws java.io.IOException;
    boolean isHealthy();
    @Override void close();
}
```

### CREATE: `agent/src/main/java/com/vibecode/agent/harness/ProviderSettings.java`

```java
public record ProviderSettings(
    String type, String apiKey, String baseUrl, String model, int maxTokens
) {}
```

`AgentApp` resolves this once from the backend/env and passes it to both legacy and harness paths.

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
- Provider mapping:
  - `opencode` → model `opencode/<model>`; no custom provider block. **Required for `oc_sk_...`
    Console/Go keys**; the built-in provider sends `x-opencode-session` and unlocks OpenCode-only
    free-tier models.
  - `claude` → `anthropic/<model>`.
  - `openai` → `openai/<model>`.
  - `generic` → custom provider `vibecode` using `@ai-sdk/openai-compatible`, `baseURL` = `baseUrl`,
    `apiKey`, model `<model>`; top-level model `vibecode/<model>`. Do not use this for Console/Go keys.
- Permissions (Phase 1):
  - `edit`, `read`, `grep`, `glob`, `todowrite`, `lsp`: `allow`.
  - `bash`: `ask` (the supervisor auto-approves only the verification commands; others denied).
  - `webfetch`, `websearch`, `task`: `deny`.
  - `question`: `deny`.
  - `external_directory`: `deny`.
  - Bash deny patterns: `git push*`, `git commit*`, `git merge*`, `git reset --hard*`, `rm -rf*`,
    `sudo*`, `docker*`, `kubectl*`, `curl*|*sh*` (implement as explicit deny rules).
- Add `"$schema": "https://opencode.ai/config.json"`, `"autoupdate": false`, `"share": "disabled"`.
- Never log the API key; redact on error.

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
- `createSession`: `POST /session` `{ "title": "ticket-<id>" }` → `id`.
- `sendPrompt`: `POST /session/<id>/message` with `{ "parts":[{"type":"text","text":prompt}] }`.
  If the pinned version requires `/api/session/<id>/prompt`, use that path and the v2 body shape.
- `subscribe`: `GET /event` SSE via `okhttp-sse`; filter events for the session id; dispatch to listener.
- `awaitIdle`: block until an idle event, error event, or timeout.
- `getDiff`: `GET /session/<id>/diff`; fall back to `git status --porcelain` + `git diff --numstat`
  executed by `WorkspaceManager`.
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

1. `pickUpTicket`; bail if null.
2. Post "Started working".
3. Fetch planning docs via `PlanningDocFetcher`.
4. Clone repo + branch via `WorkspaceManager`.
5. `step="starting-harness"`; start `OpenCodeClient`; create session.
6. `step="implementing"`; send prompt; subscribe; await idle with `maxDuration`.
7. `step="verifying"`; resolve + run verification commands; post a message with pass/fail summary.
8. If verification fails: post last 8KB output; release ticket; stop (no commit/push).
9. `step="publishing"`; collect diff; `PublishingGuard`; commit/push; create PR; update `pr_url`.
10. Post summary (files, commands, PR); update status to `review`.
11. Always: close client, cleanup workspace, reset step.

Failure handling: post error message, release ticket, never push. Catch all `Throwable` except
`ThreadDeath`; preserve interruption.

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
public void commitAndPush(String message, String branch); // exists; keep
```

`collectDiff` runs `git status --porcelain` and `git diff --numstat` in the repo dir and returns
`DiffSummary`; include untracked files as `status="added"`.

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

- Copy Node 24 from `node:24-alpine` into the runtime stage (binary + `/usr/local/lib/node_modules`).
- `apk add --no-cache git ripgrep bash curl jq python3 make`.
- `npm install -g opencode-ai@<PINNED_VERSION>` as root, then ensure the non-root `agent` user can read.
- Create writable `/repos` and `/tmp/opencode` owned by `agent`.
- Keep the existing non-root user and entrypoint.

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
  - `POST /session` → `{"id":"ses_test"}`,
  - `POST /session/ses_test/message` → `{"info":{"id":"msg_1"}}`,
  - `GET /event` → SSE with scripted events (`tool`, `idle`) then keep-alive,
  - `GET /session/ses_test/diff` → JSON diff,
  - `DELETE /session/ses_test` → `true`.
- Records received prompt body for assertions.

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
✓ [detect] resolves npm test/lint/typecheck from package.json
✓ [detect] resolves mvn test from pom.xml
```

### `PublishingGuardTest`

```
✓ [happy] allows a normal diff
✓ [error] rejects an empty diff
✓ [error] rejects .env, .github/workflows/** and **/secrets/**
✓ [error] rejects > 50 files or > 2000 lines
```

### `OpenCodeClientTest`

```
✓ [happy] starts the server, creates a session, sends a prompt
✓ [happy] parses scripted SSE tool/idle events
✓ [error] health timeout kills the process and throws
✓ [error] HTTP 500 from create-session surfaces a redacted error
✓ [cleanup] close deletes the session, stops the process and removes temp files
```

### `HarnessTicketProcessorTest`

```
✓ [happy] picks up, prompts, verifies, commits, pushes, opens PR, sets review
✓ [error] verification failure posts output, releases ticket, never pushes
✓ [error] protected path blocks publishing and releases ticket
✓ [error] harness startup failure releases ticket and cleans up
✓ [security] no API key appears in posted messages or thrown errors
```

### `AgentConfigTest` additions

```
✓ [default] HARNESS_MODE defaults to legacy
✓ [parse] durations/commas parse correctly and invalid values fall back to defaults
✓ [security] toString never includes API keys or server password
```

---

## Edge Cases to Handle

1. **Port collision** — retry with a new ephemeral port up to 3 times.
2. **Server exits early** — detect process death, capture last 8KB of logs, throw with a redacted message.
3. **No events** — idle timeout triggers abort; release ticket; no push.
4. **Empty diff** — no commit/PR; post "no changes" and release.
5. **Protected path changed** — block publishing; post the paths; release.
6. **Verification flake** — Phase 1: fail once, report; no automatic retry (Phase 3 adds retry policy).
7. **Agent process interrupted** — destroy server, cleanup workspace, release ticket in `finally`.
8. **Planning docs missing** — proceed with ticket only; note it in the prompt.
9. **Provider missing/invalid** — fail before starting the server with a clear error.
10. **Windows dev** — no OpenCode binary: tests use the fake server; `HARNESS_MODE=legacy` remains usable.

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

- `backend/src/**` — no API/DB changes in Phase 1.
- `frontend/src/**` — no UI changes in Phase 1.
- `backend/src/migrations/**` — Phase 2.
- `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` — legacy behavior preserved
  (only extract `fetchPlanningDocs` if desired, with identical behavior).
- `agent/src/main/java/com/vibecode/agent/service/ReviewProcessor.java` — unchanged.
- `docker-compose.yml` — no new services in Phase 1; the existing agent image is reused.

---

## Pending Scope Items

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | bp-120 | Agent connectivity fixes (provider envelope, heartbeat listing) | Agent | `bp-120-agent-connectivity-fixes` | ☐ |
| 2 | bp-121 | Non-localhost agent CORS/IP support | Agent / Security | `bp-121-agent-connectivity-ip` | ☐ |
| 3 | bp-71 | Email notifications (reuse for agent questions) | UX / Security | `bp-71-email-notifications` | ☐ |
| 4 | bp-74 | Session/API key rotation | Security | `bp-74-session-credentials` | ☐ |
| 5 | bp-14 | S3 planning storage | Infrastructure | `bp-14-s3-planning-storage` | ☐ |
| 6 | bp-53 | Distributed session state | Infrastructure | `bp-53-harness-session-state` | ☐ |
| 7 | bp-106 | Harness event shipping to log aggregation | Observability | `bp-106-harness-event-shipping` | ☐ |
| 8 | bp-04 | Harness cost/budget dashboard | Observability / Billing | `bp-04-harness-budgets` | ☐ |
| 9 | fg-13 | API contract updates for new endpoints | Testing | `fg-13-contract-followup` | ☐ |
| 10 | bp-99 | E2E coverage for harness UI | Testing | `bp-99-e2e-harness-ui` | ☐ |

---

*This specification is the contract for Phase 1. If the pinned OpenCode API differs, stop and update
the contract tests and this document before continuing.*
