package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.Call;
import okhttp3.Credentials;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

/**
 * Minimal OpenCode server client for Phase 1.
 *
 * <p>Starts {@code opencode serve} on a free loopback port with an isolated HOME,
 * a per-run server password and a temporary config, then drives a single session
 * in blocking prompt mode. Event streaming is supported for progress reporting
 * and idle detection but is not required for correctness.</p>
 */
public final class OpenCodeClient implements HarnessClient {

    private static final Logger log = LoggerFactory.getLogger(OpenCodeClient.class);
    private static final MediaType JSON = MediaType.get("application/json");
    private static final int MAX_LOG_CHARS = 8_192;
    private static final int PORT_ATTEMPTS = 3;

    private final HarnessConfig config;
    private final ProviderSettings provider;
    private final Path tempDir;
    private final boolean externalServer;
    private final String externalBaseUrl;
    private final String externalPassword;
    private final SandboxBashBridge bridge;
    private volatile WorkspaceFileBridge workspaceBridge;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final ConcurrentLinkedDeque<String> logTail = new ConcurrentLinkedDeque<>();
    private final List<Subscription> subscriptions = new CopyOnWriteArrayList<>();

    private volatile Process process;
    private volatile int port = -1;
    private volatile String password = "";
    private volatile String baseUrl;
    private volatile OkHttpClient httpClient;
    private volatile OkHttpClient promptHttpClient;
    private volatile EventSource eventSource;
    private volatile String lastSessionId;
    private volatile boolean closed;

    public OpenCodeClient(HarnessConfig config, ProviderSettings provider, Path tempDir) {
        this(config, provider, tempDir, null);
    }

    public OpenCodeClient(
        HarnessConfig config,
        ProviderSettings provider,
        Path tempDir,
        SandboxBashBridge bridge
    ) {
        this(config, provider, tempDir, false, null, null, bridge);
    }

    /**
     * Test seam: talks to an already-running server without spawning a process.
     */
    OpenCodeClient(String baseUrl, String password, Path tempDir) {
        this(null, null, tempDir, true, baseUrl, password, null);
    }

    OpenCodeClient(String baseUrl, String password, Path tempDir, HarnessConfig config) {
        this(config, null, tempDir, true, baseUrl, password, null);
    }

    private OpenCodeClient(
        HarnessConfig config,
        ProviderSettings provider,
        Path tempDir,
        boolean externalServer,
        String externalBaseUrl,
        String externalPassword,
        SandboxBashBridge bridge
    ) {
        this.config = config;
        this.provider = provider;
        this.tempDir = tempDir;
        this.externalServer = externalServer;
        this.externalBaseUrl = externalBaseUrl;
        this.externalPassword = externalPassword == null ? "" : externalPassword;
        this.bridge = bridge;
    }

    @Override
    public void start(Path workspace) throws IOException {
        if (externalServer) {
            this.baseUrl = normalizeBaseUrl(externalBaseUrl);
            this.password = externalPassword;
            this.httpClient = buildControlHttpClient();
            this.promptHttpClient = buildPromptHttpClient();
            waitForHealth(startupTimeout());
            return;
        }

        if (workspace == null || !Files.isDirectory(workspace)) {
            throw new IOException("Harness workspace does not exist: " + workspace);
        }
        if (config == null) {
            throw new IOException("Harness config is required to start OpenCode");
        }
        config.validate();

        Files.createDirectories(tempDir);
        Path configFile = OpenCodeConfigWriter.write(
            tempDir, provider, config, bridge != null);
        Path home = Files.createDirectories(tempDir.resolve("home"));
        Files.createDirectories(home.resolve(".config"));
        Files.createDirectories(home.resolve(".local/share"));
        Files.createDirectories(home.resolve(".cache"));

        closeWorkspaceBridge();
        WorkspaceFileBridge createdBridge = new WorkspaceFileBridge(workspace);
        createdBridge.start();
        this.workspaceBridge = createdBridge;
        try {
            writeWorkspaceTools(home);
            if (bridge != null) {
                writeSandboxTool(home);
            }

            IOException lastFailure = null;
            for (int attempt = 1; attempt <= PORT_ATTEMPTS; attempt++) {
                int candidate = findFreePort();
                try {
                    launch(workspace, candidate, home, configFile);
                    return;
                } catch (IOException e) {
                    lastFailure = e;
                    log.warn("OpenCode start attempt {}/{} failed: {}",
                        attempt, PORT_ATTEMPTS, redact(e.getMessage()));
                    stopProcess();
                    String message = String.valueOf(e.getMessage()).toLowerCase();
                    boolean portCollision = message.contains("address already in use")
                        || message.contains("eaddrinuse");
                    if (!portCollision) {
                        break;
                    }
                }
            }
            throw lastFailure == null
                ? new IOException("Could not start the OpenCode server")
                : lastFailure;
        } catch (IOException | RuntimeException e) {
            closeWorkspaceBridge();
            throw e;
        }
    }

    private void launch(Path workspace, int candidatePort, Path home, Path configFile) throws IOException {
        this.port = candidatePort;
        this.password = randomHex(32);
        this.baseUrl = "http://127.0.0.1:" + candidatePort;
        this.httpClient = buildControlHttpClient();
        this.promptHttpClient = buildPromptHttpClient();

        ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(List.of(
            config.binary(), "serve",
            "--hostname", "127.0.0.1",
            "--port", String.valueOf(candidatePort)
        )));
        builder.directory(workspace.toFile());
        builder.redirectErrorStream(true);

        configureChildEnvironment(builder.environment(), home, configFile, password, bridge,
            workspaceBridge);

        Process started = builder.start();
        this.process = started;
        Thread reader = new Thread(() -> pumpProcessOutput(started), "opencode-output");
        reader.setDaemon(true);
        reader.start();

        waitForHealth(config.startupTimeout());
        log.info("OpenCode server healthy on port {}", candidatePort);
    }

    @Override
    public String createSession(String title) throws IOException {
        JsonNode root = postJson("/session", Map.of("title", title == null ? "ticket" : title));
        String id = root.path("id").asText("");
        if (id.isBlank()) {
            id = root.path("session").path("id").asText("");
        }
        if (id.isBlank()) {
            throw new IOException("OpenCode did not return a session id");
        }
        this.lastSessionId = id;
        return id;
    }

    @Override
    public void sendPrompt(String sessionId, String prompt) throws IOException {
        Map<String, Object> body = Map.of(
            "parts", List.of(Map.of("type", "text", "text", prompt))
        );
        // This single POST blocks for the whole agent run. Use the long-lived
        // client only here; all control-plane calls have a short timeout.
        postJson("/session/" + sessionId + "/message", body, true);
    }

    @Override
    public void subscribe(String sessionId, Consumer<HarnessEvent> listener) throws IOException {
        if (listener == null) {
            return;
        }
        subscriptions.add(new Subscription(sessionId, listener));
        if (eventSource == null) {
            Request request = requestBuilder("/event").get().build();
            eventSource = EventSources.createFactory(http())
                .newEventSource(request, new EventSourceListener() {
                    @Override
                    public void onEvent(EventSource source, String id, String type, String data) {
                        dispatch(type, data);
                    }

                    @Override
                    public void onFailure(EventSource source, Throwable t, Response response) {
                        log.debug("OpenCode event stream closed: {}", redact(String.valueOf(t)));
                    }
                });
        }
    }

    @Override
    public DiffSummary getDiff(String sessionId) throws IOException {
        try {
            JsonNode root = getJson("/session/" + sessionId + "/diff");
            return parseDiff(root);
        } catch (IOException e) {
            log.debug("OpenCode diff endpoint unavailable, supervisor will use git: {}", redact(e.getMessage()));
            return DiffSummary.empty();
        }
    }

    @Override
    public boolean isHealthy() {
        String url = baseUrl;
        if (url == null) {
            return false;
        }
        try (Response response = controlCall(
            requestBuilder("/global/health").get().build()
        ).execute()) {
            return response.isSuccessful();
        } catch (IOException e) {
            return false;
        }
    }

    public int getPort() {
        if (port > 0) {
            return port;
        }
        try {
            HttpUrl url = HttpUrl.get(baseUrl);
            return url.port();
        } catch (Exception e) {
            return -1;
        }
    }

    public void deleteSession(String sessionId) {
        if (sessionId == null || sessionId.isBlank() || baseUrl == null) {
            return;
        }
        try (Response ignored = controlCall(
            requestBuilder("/session/" + sessionId).delete().build()
        ).execute()) {
            // Best effort.
        } catch (IOException e) {
            log.debug("Could not delete OpenCode session {}: {}", sessionId, redact(e.getMessage()));
        }
    }

    @Override
    public void close() {
        if (closed) {
            return;
        }
        closed = true;

        EventSource source = eventSource;
        if (source != null) {
            source.cancel();
            eventSource = null;
        }

        // Stop the process group first: a hung server must not delay cleanup,
        // and any background child it spawned must die with it.
        stopProcess();
        closeWorkspaceBridge();

        if (lastSessionId != null) {
            deleteSession(lastSessionId);
            lastSessionId = null;
        }

        if (!externalServer && tempDir != null) {
            deleteRecursively(tempDir);
        }
    }

    private void closeWorkspaceBridge() {
        WorkspaceFileBridge current = workspaceBridge;
        workspaceBridge = null;
        if (current != null) {
            current.close();
        }
    }

    private void waitForHealth(Duration timeout) throws IOException {
        Duration effective = timeout == null || timeout.isNegative() || timeout.isZero()
            ? Duration.ofSeconds(30)
            : timeout;
        long deadline = System.nanoTime() + effective.toNanos();

        while (System.nanoTime() < deadline) {
            if (process != null && !process.isAlive()) {
                throw new IOException(
                    "OpenCode server exited during startup (exit " + process.exitValue() + "): "
                        + processLogTail()
                );
            }
            if (isHealthy()) {
                return;
            }
            sleep(200);
        }

        String tail = processLogTail();
        stopProcess();
        throw new IOException(
            "OpenCode server did not become healthy within " + effective.toMillis() + "ms"
                + (tail.isBlank() ? "" : ": " + tail)
        );
    }

    private void dispatch(String type, String data) {
        HarnessEvent event = parseEvent(type, data);
        if (event == null) {
            return;
        }

        String eventSession = sessionIdOf(event.payload());
        for (Subscription subscription : subscriptions) {
            if (subscription.sessionId == null
                || eventSession == null
                || subscription.sessionId.equals(eventSession)) {
                try {
                    subscription.listener.accept(event);
                } catch (RuntimeException e) {
                    log.debug("Harness event listener failed: {}", e.getMessage());
                }
            }
        }
    }

    HarnessEvent parseEvent(String type, String data) {
        JsonNode payload = null;
        if (data != null && !data.isBlank()) {
            try {
                payload = objectMapper.readTree(data);
            } catch (IOException e) {
                log.debug("Ignoring malformed OpenCode event payload");
            }
        }
        String eventType = type;
        if (payload != null) {
            String payloadType = payload.path("type").asText("");
            if (!payloadType.isBlank()) {
                eventType = payloadType;
            }
        }
        return new HarnessEvent(eventType, payload, System.currentTimeMillis());
    }

    static String sessionIdOf(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        String[] candidates = {
            "sessionID", "sessionId",
            "properties.sessionID", "properties.sessionId",
            "properties.info.sessionID", "info.sessionID"
        };
        for (String candidate : candidates) {
            JsonNode node = payload;
            for (String part : candidate.split("\\.")) {
                node = node.path(part);
            }
            String value = node.asText("");
            if (!value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private DiffSummary parseDiff(JsonNode root) {
        List<DiffSummary.ChangedFile> files = new ArrayList<>();
        int additions = 0;
        int deletions = 0;

        JsonNode array = root.isArray() ? root : root.path("files");
        if (array.isArray()) {
            for (JsonNode file : array) {
                String path = firstText(file, "path", "file", "filename");
                if (path.isBlank()) {
                    continue;
                }
                String status = firstText(file, "status", "type");
                files.add(new DiffSummary.ChangedFile(path, status.isBlank() ? "modified" : status));
                additions += firstInt(file, "additions", "added");
                deletions += firstInt(file, "deletions", "deleted");
            }
        }
        return new DiffSummary(files, additions, deletions);
    }

    private static String firstText(JsonNode node, String... names) {
        for (String name : names) {
            String value = node.path(name).asText("");
            if (!value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private static int firstInt(JsonNode node, String... names) {
        for (String name : names) {
            JsonNode value = node.path(name);
            if (value.isNumber()) {
                return value.asInt();
            }
        }
        return 0;
    }

    private JsonNode postJson(String path, Object body) throws IOException {
        return postJson(path, body, false);
    }

    private JsonNode postJson(String path, Object body, boolean longRunning) throws IOException {
        String json = objectMapper.writeValueAsString(body);
        Request request = requestBuilder(path)
            .post(RequestBody.create(json, JSON))
            .build();
        Call call = longRunning
            ? promptHttp().newCall(request)
            : controlCall(request);
        if (longRunning) {
            applyPromptTimeout(call);
        }
        try (Response response = call.execute()) {
            String text = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException(
                    "OpenCode request failed (" + response.code() + "): " + redact(truncate(text))
                );
            }
            return text.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(text);
        }
    }

    private JsonNode getJson(String path) throws IOException {
        Request request = requestBuilder(path).get().build();
        try (Response response = controlCall(request).execute()) {
            String text = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException(
                    "OpenCode request failed (" + response.code() + "): " + redact(truncate(text))
                );
            }
            return text.isBlank() ? objectMapper.createObjectNode() : objectMapper.readTree(text);
        }
    }

    private Request.Builder requestBuilder(String path) {
        HttpUrl url = HttpUrl.get(normalizeBaseUrl(baseUrl) + path);
        Request.Builder builder = new Request.Builder()
            .url(url)
            .header("Accept", "application/json");
        if (password != null && !password.isBlank()) {
            builder.header("Authorization", Credentials.basic("opencode", password));
        }
        return builder;
    }

    /**
     * Blocking prompts can legitimately run for many minutes, so the read
     * timeout is infinite; the wall-clock budget is enforced on the call itself.
     */
    private void applyPromptTimeout(Call call) {
        Duration budget = config == null || config.maxDuration() == null
            ? Duration.ofMinutes(45)
            : config.maxDuration();
        call.timeout().timeout(budget.toMillis(), TimeUnit.MILLISECONDS);
    }

    private OkHttpClient http() {
        if (httpClient == null) {
            httpClient = buildControlHttpClient();
        }
        return httpClient;
    }

    private OkHttpClient promptHttp() {
        if (promptHttpClient == null) {
            promptHttpClient = buildPromptHttpClient();
        }
        return promptHttpClient;
    }

    private Call controlCall(Request request) {
        Call call = http().newCall(request);
        // A hung control-plane call must not defeat startupTimeout or block
        // cleanup forever.
        call.timeout().timeout(10, TimeUnit.SECONDS);
        return call;
    }

    private OkHttpClient buildControlHttpClient() {
        return new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build();
    }

    private OkHttpClient buildPromptHttpClient() {
        return new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build();
    }

    private void pumpProcessOutput(Process running) {
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(running.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                String safeLine = redact(line);
                logTail.addLast(safeLine);
                while (logTail.size() > 200) {
                    logTail.pollFirst();
                }
                log.debug("[opencode] {}", safeLine);
            }
        } catch (IOException e) {
            log.debug("OpenCode output reader stopped: {}", e.getMessage());
        }
    }

    private String processLogTail() {
        StringBuilder builder = new StringBuilder();
        for (String line : logTail) {
            builder.append(line).append('\n');
        }
        String text = builder.toString();
        return text.length() > MAX_LOG_CHARS
            ? text.substring(text.length() - MAX_LOG_CHARS)
            : text;
    }

    private void stopProcess() {
        Process running = process;
        process = null;
        if (running == null) {
            return;
        }
        running.destroy();
        try {
            if (!running.waitFor(5, TimeUnit.SECONDS)) {
                ProcessGroup.kill(running);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            ProcessGroup.kill(running);
        }
        // Always reap the group: the leader may have exited while a background
        // child (for example a shell started by the agent) is still alive.
        ProcessGroup.kill(running);
    }

    private static void deleteRecursively(Path path) {
        if (path == null || !Files.exists(path)) {
            return;
        }
        try (var stream = Files.walk(path)) {
            stream.sorted(java.util.Comparator.reverseOrder()).forEach(entry -> {
                try {
                    Files.deleteIfExists(entry);
                } catch (IOException ignored) {
                    // Best effort cleanup.
                }
            });
        } catch (IOException e) {
            log.debug("Could not remove harness temp directory: {}", e.getMessage());
        }
    }

    /**
     * Replaces the inherited environment with the shared allowlist used by
     * verification and git children. Package-visible for tests.
     */
    static void sanitizeEnvironment(Map<String, String> environment) {
        EnvironmentSanitizer.sanitize(environment);
    }

    /**
     * Package-visible for tests: the exact environment handed to
     * {@code opencode serve}.
     */
    static void configureChildEnvironment(
        Map<String, String> environment,
        Path home,
        Path configFile,
        String password
    ) {
        configureChildEnvironment(environment, home, configFile, password, null);
    }

    static void configureChildEnvironment(
        Map<String, String> environment,
        Path home,
        Path configFile,
        String password,
        SandboxBashBridge bridge
    ) {
        configureChildEnvironment(environment, home, configFile, password, bridge, null);
    }

    static void configureChildEnvironment(
        Map<String, String> environment,
        Path home,
        Path configFile,
        String password,
        SandboxBashBridge bridge,
        WorkspaceFileBridge workspaceBridge
    ) {
        // The harness must not inherit planner credentials. The provider key is
        // injected through the temporary config instead.
        sanitizeEnvironment(environment);
        environment.put("HOME", home.toString());
        environment.put("XDG_CONFIG_HOME", home.resolve(".config").toString());
        environment.put("XDG_DATA_HOME", home.resolve(".local/share").toString());
        environment.put("XDG_CACHE_HOME", home.resolve(".cache").toString());
        environment.put("OPENCODE_CONFIG", configFile.toString());
        environment.put("OPENCODE_SERVER_PASSWORD", password);
        environment.put("OPENCODE_DISABLE_AUTOUPDATE", "true");
        // OpenCode v1 merges project opencode.json/.opencode after
        // OPENCODE_CONFIG. A cloned repository could otherwise re-enable bash,
        // add plugins/MCP servers, or change the model. The temporary config
        // generated outside the workspace must be authoritative.
        environment.put("OPENCODE_DISABLE_PROJECT_CONFIG", "true");
        // The bash tool is replaced by a global tool that forwards to the
        // sandbox bridge. Only expose its loopback URL and per-run token when a
        // sandbox is active; host mode keeps the built-in bash tool.
        if (bridge != null && bridge.baseUrl() != null) {
            environment.put("VIBECODE_SANDBOX_BRIDGE_URL", bridge.baseUrl());
            environment.put("VIBECODE_SANDBOX_BRIDGE_TOKEN", bridge.token());
        } else {
            environment.remove("VIBECODE_SANDBOX_BRIDGE_URL");
            environment.remove("VIBECODE_SANDBOX_BRIDGE_TOKEN");
        }
        // The read/grep tools always go through the guarded workspace bridge.
        if (workspaceBridge != null && workspaceBridge.baseUrl() != null) {
            environment.put("VIBECODE_WORKSPACE_BRIDGE_URL", workspaceBridge.baseUrl());
            environment.put("VIBECODE_WORKSPACE_BRIDGE_TOKEN", workspaceBridge.token());
        } else {
            environment.remove("VIBECODE_WORKSPACE_BRIDGE_URL");
            environment.remove("VIBECODE_WORKSPACE_BRIDGE_TOKEN");
        }
    }

    /**
     * Install a global OpenCode tool that overrides the built-in {@code bash}
     * tool. It forwards the command to the supervisor bridge, which runs it in
     * the disposable sandbox. The file lives in the per-run HOME, never in the
     * repository.
     */
    static Path writeSandboxTool(Path home) throws IOException {
        Path tools = Files.createDirectories(home.resolve(".config/opencode/tools"));
        Path file = tools.resolve("sandbox_bash.ts");
        Files.writeString(file, sandboxToolSource(), StandardCharsets.UTF_8);
        return file;
    }

    /**
     * Install the guarded read/grep tools. The built-in tools are denied in the
     * config; these wrappers forward to the loopback workspace bridge, which
     * resolves paths with {@code toRealPath()} and rejects escapes.
     */
    static Path writeWorkspaceTools(Path home) throws IOException {
        Path tools = Files.createDirectories(home.resolve(".config/opencode/tools"));
        Files.writeString(tools.resolve("sandbox_read.ts"),
            workspaceReadToolSource(), StandardCharsets.UTF_8);
        Files.writeString(tools.resolve("sandbox_grep.ts"),
            workspaceGrepToolSource(), StandardCharsets.UTF_8);
        Files.writeString(tools.resolve("sandbox_write.ts"),
            workspaceWriteToolSource(), StandardCharsets.UTF_8);
        Files.writeString(tools.resolve("sandbox_edit.ts"),
            workspaceEditToolSource(), StandardCharsets.UTF_8);
        return tools;
    }

    static String workspaceReadToolSource() {
        return """
            import { tool } from "@opencode-ai/plugin"

            const url = process.env.VIBECODE_WORKSPACE_BRIDGE_URL
            const token = process.env.VIBECODE_WORKSPACE_BRIDGE_TOKEN

            export default tool({
              description: "Read a text file inside the repository. The built-in read tool is disabled. "
                + "Paths are resolved inside the workspace; symlinks that escape it and credential paths are rejected.",
              args: {
                filePath: tool.schema.string().describe("File path relative to the workspace or absolute inside it"),
                offset: tool.schema.number().int().positive().optional().describe("1-based start line"),
                limit: tool.schema.number().int().positive().optional().describe("Maximum lines to return"),
              },
              async execute(args) {
                if (!url || !token) {
                  throw new Error("workspace guard is not configured")
                }
                const response = await fetch(url + "/read", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-workspace-token": token,
                  },
                  body: JSON.stringify({
                    path: args.filePath,
                    offset: args.offset,
                    limit: args.limit,
                  }),
                })
                const text = await response.text()
                if (!response.ok) {
                  throw new Error("read rejected: " + text)
                }
                return text
              },
            })
            """;
    }

    static String workspaceGrepToolSource() {
        return """
            import { tool } from "@opencode-ai/plugin"

            const url = process.env.VIBECODE_WORKSPACE_BRIDGE_URL
            const token = process.env.VIBECODE_WORKSPACE_BRIDGE_TOKEN

            export default tool({
              description: "Search file contents inside the repository. The built-in grep tool is disabled. "
                + "Paths and symlinks are resolved inside the workspace; credential paths are rejected.",
              args: {
                pattern: tool.schema.string().describe("Regular expression to search for"),
                path: tool.schema.string().optional().describe("File or directory relative to the workspace"),
                include: tool.schema.string().optional().describe("Optional file-name glob, for example *.java"),
              },
              async execute(args) {
                if (!url || !token) {
                  throw new Error("workspace guard is not configured")
                }
                const response = await fetch(url + "/grep", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-workspace-token": token,
                  },
                  body: JSON.stringify({
                    pattern: args.pattern,
                    path: args.path,
                    include: args.include,
                  }),
                })
                const text = await response.text()
                if (!response.ok) {
                  throw new Error("grep rejected: " + text)
                }
                return text
              },
            })
            """;
    }

    static String workspaceWriteToolSource() {
        return """
            import { tool } from "@opencode-ai/plugin"

            const url = process.env.VIBECODE_WORKSPACE_BRIDGE_URL
            const token = process.env.VIBECODE_WORKSPACE_BRIDGE_TOKEN

            export default tool({
              description: "Write a text file inside the repository. The built-in write/edit tools are disabled. "
                + "The parent directory must already exist; symlink writes and credential/VCS/control paths are rejected. "
                + "Writes UTF-8 exactly; use sandbox_edit for BOM/CRLF-preserving changes.",
              args: {
                filePath: tool.schema.string().describe("File path relative to the workspace or absolute inside it"),
                content: tool.schema.string().describe("Full UTF-8 file content"),
              },
              async execute(args) {
                if (!url || !token) {
                  throw new Error("workspace guard is not configured")
                }
                const response = await fetch(url + "/write", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-workspace-token": token,
                  },
                  body: JSON.stringify({
                    path: args.filePath,
                    content: args.content,
                  }),
                })
                const text = await response.text()
                if (!response.ok) {
                  throw new Error("write rejected: " + text)
                }
                return text
              },
            })
            """;
    }

    static String workspaceEditToolSource() {
        return """
            import { tool } from "@opencode-ai/plugin"

            const url = process.env.VIBECODE_WORKSPACE_BRIDGE_URL
            const token = process.env.VIBECODE_WORKSPACE_BRIDGE_TOKEN

            export default tool({
              description: "Replace text in a file inside the repository. The built-in edit/write tools are disabled. "
                + "oldString must be unique unless replaceAll is true; paths are guarded like sandbox_write. "
                + "Preserves BOM/CRLF; the resulting file must be at most 1 MiB.",
              args: {
                filePath: tool.schema.string().describe("File path relative to the workspace or absolute inside it"),
                oldString: tool.schema.string().describe("Exact text to replace"),
                newString: tool.schema.string().describe("Replacement text"),
                replaceAll: tool.schema.boolean().optional().describe("Replace every occurrence"),
              },
              async execute(args) {
                if (!url || !token) {
                  throw new Error("workspace guard is not configured")
                }
                const response = await fetch(url + "/edit", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-workspace-token": token,
                  },
                  body: JSON.stringify({
                    path: args.filePath,
                    oldString: args.oldString,
                    newString: args.newString,
                    replaceAll: args.replaceAll,
                  }),
                })
                const text = await response.text()
                if (!response.ok) {
                  throw new Error("edit rejected: " + text)
                }
                return text
              },
            })
            """;
    }

    static String sandboxToolSource() {
        return """
            import { tool } from "@opencode-ai/plugin"

            const url = process.env.VIBECODE_SANDBOX_BRIDGE_URL
            const token = process.env.VIBECODE_SANDBOX_BRIDGE_TOKEN

            export default tool({
              description: "Run a shell command in the isolated ticket sandbox. "
                + "Use this instead of the disabled built-in bash tool. "
                + "The workspace is mounted at /workspace; prefer relative paths.",
              args: {
                command: tool.schema.string().describe("Shell command to run in /workspace"),
                timeout: tool.schema.number().int().positive().optional()
                  .describe("Timeout in seconds"),
                description: tool.schema.string().optional().describe("Short description"),
              },
              async execute(args, context) {
                if (!url || !token) {
                  throw new Error("sandbox bridge is not configured")
                }
                const response = await fetch(url + "/exec", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-sandbox-token": token,
                  },
                  body: JSON.stringify({
                    command: args.command,
                    cwd: context.directory,
                    timeoutSeconds: args.timeout,
                  }),
                })
                const text = await response.text()
                if (!response.ok) {
                  throw new Error("sandbox command rejected: " + text)
                }
                const body = JSON.parse(text)
                if (body.timedOut) {
                  throw new Error("sandbox command timed out\\n" + (body.output || ""))
                }
                const output = body.output || ""
                return body.exitCode === 0
                  ? output
                  : output + "\\n\\n(exit code " + body.exitCode + ")"
              },
            })
            """;
    }

    private static int findFreePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            socket.setReuseAddress(true);
            return socket.getLocalPort();
        }
    }

    private static String normalizeBaseUrl(String value) {
        if (value == null) {
            return "";
        }
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private static String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        new SecureRandom().nextBytes(value);
        StringBuilder builder = new StringBuilder(bytes * 2);
        for (byte b : value) {
            builder.append(String.format("%02x", b));
        }
        return builder.toString();
    }

    private static String truncate(String value) {
        if (value == null) {
            return "";
        }
        return value.length() > 1_000 ? value.substring(0, 1_000) + "..." : value;
    }

    private String redact(String value) {
        if (value == null) {
            return "";
        }
        String redacted = value;
        if (password != null && !password.isBlank()) {
            redacted = redacted.replace(password, "[REDACTED]");
        }
        if (externalPassword != null && !externalPassword.isBlank()) {
            redacted = redacted.replace(externalPassword, "[REDACTED]");
        }
        if (provider != null && provider.hasApiKey()) {
            redacted = redacted.replace(provider.apiKey(), "[REDACTED]");
        }
        if (bridge != null && bridge.token() != null && !bridge.token().isBlank()) {
            redacted = redacted.replace(bridge.token(), "[REDACTED]");
        }
        return redacted;
    }

    private Duration startupTimeout() {
        return config == null ? Duration.ofSeconds(30) : config.startupTimeout();
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private record Subscription(String sessionId, Consumer<HarnessEvent> listener) {
    }
}
