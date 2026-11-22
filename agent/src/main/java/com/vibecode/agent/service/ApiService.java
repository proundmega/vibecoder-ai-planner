package com.vibecode.agent.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.model.ApiResponse;
import com.vibecode.agent.model.Ticket;
import com.vibecode.agent.model.TicketMessage;
import com.vibecode.agent.harness.RedactionRegistry;
import com.vibecode.agent.harness.HarnessPrivacyGuard;
import com.vibecode.agent.harness.EgressMtlsMaterial;
import com.vibecode.agent.harness.QuestionBridge;
import com.vibecode.agent.harness.RepoProfileSnapshot;
import com.vibecode.agent.harness.RepoProfileValidation;
import com.fasterxml.jackson.databind.JsonNode;
import okhttp3.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * HTTP client for communicating with the Vibecode backend API.
 * Handles authentication, request/response parsing, and error handling.
 */
public class ApiService implements QuestionBridge.Transport {

    private final OkHttpClient httpClient;
    private final OkHttpClient eventHttpClient;
    private final ObjectMapper objectMapper;
    private final AgentConfig config;
    private final AgentAuthManager authManager;
    private final String baseUrl;
    private volatile Map<String, Object> lastBudgetPolicy;
    private volatile Map<String, Object> lastPrivacyPolicy;
    private volatile String providerBaseUrlContext;
    private volatile String providerRegionContext;

    public ApiService(AgentConfig config) {
        this(config, null);
    }

    public ApiService(AgentConfig config, AgentAuthManager authManager) {
        this.config = config;
        this.authManager = authManager;
        this.baseUrl = config.getApiUrl();
        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(java.time.Duration.ofSeconds(10))
            .readTimeout(java.time.Duration.ofSeconds(30))
            .writeTimeout(java.time.Duration.ofSeconds(30))
            .addInterceptor(new AgentAuthInterceptor())
            .build();
        // Event emission runs on the supervisor's tool-event path. Use a short,
        // event-specific timeout so a slow observability backend cannot stall
        // the harness itself.
        this.eventHttpClient = new OkHttpClient.Builder()
            .connectTimeout(java.time.Duration.ofSeconds(2))
            .readTimeout(java.time.Duration.ofSeconds(3))
            .writeTimeout(java.time.Duration.ofSeconds(3))
            .addInterceptor(new AgentAuthInterceptor())
            .build();
    }

    /**
     * Injects the current node credential and retries once after a 401 when a
     * refresh token is available. Legacy static keys keep the old behavior.
     */
    private final class AgentAuthInterceptor implements Interceptor {
        @Override
        public Response intercept(Chain chain) throws IOException {
            String token = authManager != null ? authManager.ensureValidAccessToken() : null;
            if (token == null || token.isBlank()) {
                throw new IOException("Node credential is not initialized");
            }
            Request request = withRuntime(chain.request().newBuilder()
                .header("X-API-Key", token));
            Response response = chain.proceed(request);
            if (response.code() == 401 && authManager != null) {
                response.close();
                authManager.refreshAfterUnauthorized(token);
                String refreshed = authManager.ensureValidAccessToken();
                Response retry = chain.proceed(withRuntime(chain.request().newBuilder()
                    .header("X-API-Key", refreshed)));
                return retry;
            }
            return response;
        }

        private Request withRuntime(Request.Builder builder) {
            String runtimeId = config.getRuntimeId();
            if (runtimeId != null && !runtimeId.isBlank()) {
                builder.header("X-Agent-Runtime", runtimeId);
            }
            return builder.build();
        }
    }

    /** Current node access token, for callers that build their own requests. */
    public String currentAccessToken() throws IOException {
        return authManager != null ? authManager.ensureValidAccessToken() : null;
    }

    /**
     * List available backlog tickets for the project.
     */
    public List<Ticket> listBacklogTickets() throws IOException {
        String url = baseUrl + "/tickets/project/" + config.getProjectId() + "/backlog";
        ApiResponse<List<Ticket>> response = executeGet(url, new TypeReference<ApiResponse<List<Ticket>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to list tickets: " + response.getError());
        }
        
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    /**
     * Pick up a ticket (assign to self, set status to in_progress).
     */
    public Ticket pickUpTicket(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/pickup";
        ApiResponse<Ticket> response = executePost(url, null, new TypeReference<ApiResponse<Ticket>>() {});

        if (response.hasError()) {
            if (isReadinessFailed(response)) {
                throw new ReadinessException(response.getError().getMessage(),
                    response.getError().getDetails());
            }
            throw new IOException("Failed to pick up ticket " + ticketId + ": " + response.getError());
        }

        return response.getData();
    }

    /** fg-45: `READINESS_FAILED` has a machine-readable issue list. */
    private static boolean isReadinessFailed(ApiResponse<?> response) {
        return response.getError() != null
            && "READINESS_FAILED".equalsIgnoreCase(response.getError().getCode());
    }

    /**
     * Release a ticket (clear ownership, set status back to backlog).
     */
    public Ticket releaseTicket(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/release";
        ApiResponse<Ticket> response = executePost(url, null, new TypeReference<ApiResponse<Ticket>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to release ticket " + ticketId + ": " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Update ticket status.
     */
    public Ticket updateTicketStatus(Long ticketId, String newStatus) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId;
        Map<String, String> body = Map.of("status", newStatus);
        ApiResponse<Ticket> response = executePut(url, body, new TypeReference<ApiResponse<Ticket>>() {});

        if (response.hasError()) {
            if (isReadinessFailed(response)) {
                throw new ReadinessException(response.getError().getMessage(),
                    response.getError().getDetails());
            }
            throw new IOException("Failed to update ticket status: " + response.getError());
        }

        return response.getData();
    }

    /**
     * Update ticket PR URL (called after PR creation).
     */
    public void updateTicketPrUrl(Long ticketId, String prUrl) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId;
        Map<String, String> body = Map.of("prUrl", prUrl);
        ApiResponse<Ticket> response = executePut(url, body, new TypeReference<ApiResponse<Ticket>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to update ticket pr_url: " + response.getError());
        }
    }

    /**
     * Persist a durable harness run before starting side effects (fg-33).
     */
    public Map<String, Object> startHarnessRun(
        Long ticketId,
        String branch,
        String workspacePath,
        String provider,
        String model,
        int attempt
    ) throws IOException {
        return startHarnessRun(ticketId, branch, workspacePath, provider, model, attempt,
            null, null);
    }

    public Map<String, Object> startHarnessRun(
        Long ticketId,
        String branch,
        String workspacePath,
        String provider,
        String model,
        int attempt,
        String repoProfileId,
        Integer repoProfileVersion
    ) throws IOException {
        return startHarnessRun(ticketId, branch, workspacePath, provider, model,
            attempt, repoProfileId, repoProfileVersion,
            providerBaseUrlContext, providerRegionContext);
    }

    /**
     * Provider metadata for the next run start (fg-42). The supervisor sets it
     * from the resolved provider settings so the backend can enforce
     * residency/local-only policy before the model is called.
     */
    public void setProviderContext(String baseUrl, String region) {
        this.providerBaseUrlContext = baseUrl;
        this.providerRegionContext = region;
    }

    public Map<String, Object> startHarnessRun(
        Long ticketId,
        String branch,
        String workspacePath,
        String provider,
        String model,
        int attempt,
        String repoProfileId,
        Integer repoProfileVersion,
        String providerBaseUrl,
        String providerRegion
    ) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("ticketId", ticketId);
        body.put("branch", branch);
        body.put("attempt", attempt);
        if (workspacePath != null && !workspacePath.isBlank()) {
            body.put("workspacePath", workspacePath);
        }
        if (provider != null && !provider.isBlank()) {
            body.put("provider", provider);
        }
        if (model != null && !model.isBlank()) {
            body.put("model", model);
        }
        if (providerBaseUrl != null && !providerBaseUrl.isBlank()) {
            body.put("providerBaseUrl", providerBaseUrl);
        }
        if (providerRegion != null && !providerRegion.isBlank()) {
            body.put("providerRegion", providerRegion);
        }
        if (repoProfileId != null && !repoProfileId.isBlank()) {
            body.put("repoProfileId", repoProfileId);
            if (repoProfileVersion != null && repoProfileVersion > 0) {
                body.put("repoProfileVersion", repoProfileVersion);
            }
        }

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            if (isFatalRunError(response)) {
                throw new FatalRunException(
                    "Harness run rejected: " + response.getError());
            }
            throw new IOException("Failed to start harness run: " + response.getError());
        }
        this.lastBudgetPolicy = response.getBudgetPolicy();
        this.lastPrivacyPolicy = response.getPrivacyPolicy();
        return response.getData();
    }

    /**
     * Budget/routing policy returned with the most recent run start, or null
     * when the backend did not include one.
     */
    public Map<String, Object> getLastBudgetPolicy() {
        return lastBudgetPolicy;
    }

    /**
     * Privacy/data-governance policy returned with the most recent run start.
     */
    public Map<String, Object> getLastPrivacyPolicy() {
        return lastPrivacyPolicy;
    }

    /**
     * Append a structured harness event. Best effort: the caller owns failure
     * handling, because observability must never abort a ticket.
     */
    public void emitHarnessEvent(Map<String, Object> event) throws IOException {
        ApiResponse<Map<String, Object>> response = executePostWithClient(
            eventHttpClient,
            baseUrl + "/harness/events",
            event,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );
        if (response.hasError()) {
            throw new IOException("Failed to emit harness event: " + response.getError());
        }
    }

    /**
     * Persist a human question for a run (fg-55). The OpenCode prompt stays
     * blocked while the bridge polls; this call is the persistence half.
     */
    @Override
    public long createHarnessQuestion(
        String runId,
        String externalId,
        String kind,
        String prompt,
        JsonNode options,
        Instant expiresAt
    ) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("kind", kind == null ? "question" : kind);
        body.put("prompt", prompt);
        if (externalId != null && !externalId.isBlank()) {
            body.put("externalId", externalId);
        }
        if (options != null && !options.isMissingNode() && !options.isNull()) {
            body.put("options", objectMapper.convertValue(options, Object.class));
        }
        if (expiresAt != null) {
            body.put("expiresAt", expiresAt.toString());
        }
        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/questions",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );
        if (response.hasError()) {
            throw new IOException("Failed to create harness question: " + response.getError());
        }
        Object id = response.getData() == null ? null : response.getData().get("id");
        if (id == null) {
            throw new IOException("Harness question response had no id");
        }
        return Long.parseLong(String.valueOf(id));
    }

    @Override
    public Map<String, Object> getHarnessQuestion(String runId, long questionId)
        throws IOException {
        ApiResponse<Map<String, Object>> response = executeGet(
            baseUrl + "/harness/runs/" + runId + "/questions/" + questionId,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );
        if (response.hasError()) {
            throw new IOException("Failed to read harness question: " + response.getError());
        }
        return response.getData() == null ? Map.of() : response.getData();
    }

    @Override
    public void expireHarnessQuestion(String runId, long questionId) throws IOException {
        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/questions/" + questionId + "/expire",
            Map.of(),
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );
        if (response.hasError()) {
            throw new IOException("Failed to expire harness question: " + response.getError());
        }
    }

    /**
     * Report a cumulative usage snapshot for a run. The backend prices it from
     * the versioned table and keeps the greatest value.
     */
    public boolean recordHarnessUsage(String runId, Map<String, Object> usage) throws IOException {
        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/usage",
            usage,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );
        if (response.hasError()) {
            throw new IOException("Failed to record harness usage: " + response.getError());
        }
        Object exceeded = response.getData() == null
            ? null
            : response.getData().get("quotaExceeded");
        return Boolean.TRUE.equals(exceeded) || "true".equals(String.valueOf(exceeded));
    }

    public void checkpointHarnessRun(
        String runId,
        String step,
        Map<String, Object> payload
    ) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("step", step);
        body.put("payload", payload == null ? Map.of() : payload);

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/checkpoints",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            if (isErrorCode(response, "NOT_FOUND") || isErrorCode(response, "CONFLICT")) {
                throw new RunGoneException(
                    "Harness run is no longer active: " + response.getError());
            }
            throw new IOException("Failed to record harness checkpoint: " + response.getError());
        }
    }

    public void heartbeatHarnessRun(String runId, String step) throws IOException {
        Map<String, Object> body = new HashMap<>();
        if (step != null && !step.isBlank()) {
            body.put("step", step);
        }

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/heartbeat",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            if (isErrorCode(response, "NOT_FOUND") || isErrorCode(response, "CONFLICT")) {
                throw new RunGoneException(
                    "Harness run is no longer active: " + response.getError());
            }
            throw new IOException("Failed to heartbeat harness run: " + response.getError());
        }
    }

    /**
     * Finish a run and return its terminal status. The backend finish is
     * idempotent, so retrying after a lost response is safe.
     */
    public String finishHarnessRun(
        String runId,
        String status,
        String error,
        String headSha,
        String prUrl
    ) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        if (error != null && !error.isBlank()) {
            body.put("error", error);
        }
        if (headSha != null && !headSha.isBlank()) {
            body.put("headSha", headSha);
        }
        if (prUrl != null && !prUrl.isBlank()) {
            body.put("prUrl", prUrl);
        }

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/finish",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            throw new IOException("Failed to finish harness run: " + response.getError());
        }
        Object terminalStatus = response.getData() == null
            ? null
            : response.getData().get("status");
        return terminalStatus == null ? status : String.valueOf(terminalStatus);
    }

    /**
     * Claim the ticket lease. False means another unexpired run owns it;
     * transient errors throw so the caller can fail closed.
     */
    public boolean claimHarnessLease(Long ticketId, String runId, int ttlSeconds) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("ticketId", ticketId);
        body.put("runId", runId);
        body.put("ttlSeconds", ttlSeconds);

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/leases",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            if (isErrorCode(response, "CONFLICT")) {
                return false;
            }
            throw new IOException("Failed to claim harness lease: " + response.getError());
        }
        return response.getData() != null;
    }

    /**
     * Renew an already-held lease. False means the lease was lost; transient
     * errors throw so the heartbeat can retry on the next tick.
     */
    public boolean renewHarnessLease(Long ticketId, String runId, int ttlSeconds) throws IOException {
        Map<String, Object> body = new HashMap<>();
        body.put("runId", runId);
        body.put("ttlSeconds", ttlSeconds);

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/leases/" + ticketId + "/renew",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            if (isErrorCode(response, "CONFLICT")) {
                return false;
            }
            throw new IOException("Failed to renew harness lease: " + response.getError());
        }
        return response.getData() != null;
    }

    /**
     * Active runs owned by this agent, used for startup recovery.
     */
    public List<Map<String, Object>> listActiveHarnessRuns(long agentId) throws IOException {
        ApiResponse<List<Map<String, Object>>> response = executeGet(
            baseUrl + "/harness/agents/" + agentId + "/runs",
            new TypeReference<ApiResponse<List<Map<String, Object>>>>() {}
        );

        if (response.hasError()) {
            throw new IOException("Failed to list active harness runs: " + response.getError());
        }
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    /**
     * Workspace paths protected by a running run or an unexpired lease.
     * Workspace cleanup must fail closed when this call fails.
     */
    public List<String> listActiveWorkspacePaths(long agentId) throws IOException {
        ApiResponse<List<String>> response = executeGet(
            baseUrl + "/harness/agents/" + agentId + "/workspaces",
            new TypeReference<ApiResponse<List<String>>>() {}
        );

        if (response.hasError()) {
            throw new IOException("Failed to list active harness workspaces: " + response.getError());
        }
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    /**
     * Persist publish evidence before the terminal finish so recovery can adopt
     * a run whose finish response was lost.
     */
    public void recordHarnessPublish(String runId, String headSha, String prUrl) throws IOException {
        Map<String, Object> body = new HashMap<>();
        if (headSha != null && !headSha.isBlank()) {
            body.put("headSha", headSha);
        }
        if (prUrl != null && !prUrl.isBlank()) {
            body.put("prUrl", prUrl);
        }
        if (body.isEmpty()) {
            return;
        }

        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/publish",
            body,
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            throw new IOException("Failed to record harness publish: " + response.getError());
        }
    }

    /**
     * Ask the backend to reconcile a terminal run immediately. This closes the
     * window where recovery has finished a published run but the ticket is
     * still in backlog until the next reaper sweep.
     */
    public Map<String, Object> reconcileHarnessRun(String runId) throws IOException {
        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/reconcile",
            Map.of(),
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            throw new IOException("Failed to reconcile harness run: " + response.getError());
        }
        return response.getData();
    }

    /**
     * Return the ticket to backlog after recovery failed its run. The backend
     * only releases when the ticket is still in_progress with no PR.
     */
    public boolean releaseHarnessTicket(String runId) throws IOException {
        ApiResponse<Map<String, Object>> response = executePost(
            baseUrl + "/harness/runs/" + runId + "/release-ticket",
            Map.of(),
            new TypeReference<ApiResponse<Map<String, Object>>>() {}
        );

        if (response.hasError()) {
            throw new IOException("Failed to release harness ticket: " + response.getError());
        }
        Object released = response.getData() == null
            ? null
            : response.getData().get("released");
        return Boolean.TRUE.equals(released) || "true".equals(String.valueOf(released));
    }

    private static boolean isErrorCode(ApiResponse<?> response, String code) {
        return response.getError() != null && code.equals(response.getError().getCode());
    }

    /** A backend decision (401/403/409/400) that must stop the run immediately. */
    static boolean isFatalRunError(ApiResponse<?> response) {
        if (response == null) {
            return false;
        }
        return isErrorCode(response, "CONFLICT")
            || isErrorCode(response, "FORBIDDEN")
            || isErrorCode(response, "VALIDATION_ERROR")
            || isErrorCode(response, "UNAUTHORIZED")
            || isErrorCode(response, "KEY_EXPIRED");
    }

    /** The run was reaped or finished while this agent was still working. */
    public static class RunGoneException extends IOException {
        public RunGoneException(String message) {
            super(message);
        }
    }

    /** The backend refused the run for an authorization/conflict reason. */
    public static class FatalRunException extends IOException {
        public FatalRunException(String message) {
            super(message);
        }
    }

    /**
     * Post a message on a ticket.
     */
    public TicketMessage postMessage(Long ticketId, String messageType, String content) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/messages";
        Map<String, Object> body = Map.of(
            "messageType", messageType,
            "content", HarnessPrivacyGuard.forStorage(content)
        );
        ApiResponse<TicketMessage> response = executePost(url, body, new TypeReference<ApiResponse<TicketMessage>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to post message: " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Get messages for a ticket.
     */
    public List<TicketMessage> getMessages(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/messages";
        ApiResponse<List<TicketMessage>> response = executeGet(url, new TypeReference<ApiResponse<List<TicketMessage>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get messages: " + response.getError());
        }
        
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    private <T> ApiResponse<T> executeGet(String url, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        Request request = new Request.Builder()
            .url(url)
            .get()
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String body = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(body, typeRef);
        }
    }

    private <T> ApiResponse<T> executePost(String url, Object body, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        return executePostWithClient(httpClient, url, body, typeRef);
    }

    private <T> ApiResponse<T> executePostWithClient(
            OkHttpClient client,
            String url,
            Object body,
            TypeReference<ApiResponse<T>> typeRef) throws IOException {
        String json = body != null ? objectMapper.writeValueAsString(body) : "{}";
        RequestBody requestBody = RequestBody.create(json, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .post(requestBody)
            .build();

        try (Response response = client.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(responseBody, typeRef);
        }
    }

    private <T> ApiResponse<T> executePatch(String url, Object body, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        String json = body != null ? objectMapper.writeValueAsString(body) : "{}";
        RequestBody requestBody = RequestBody.create(json, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .patch(requestBody)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(responseBody, typeRef);
        }
    }

    private <T> ApiResponse<T> executePut(String url, Object body, TypeReference<ApiResponse<T>> typeRef) throws IOException {
        String json = body != null ? objectMapper.writeValueAsString(body) : "{}";
        RequestBody requestBody = RequestBody.create(json, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .put(requestBody)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            return objectMapper.readValue(responseBody, typeRef);
        }
    }

    /**
     * Send a runtime heartbeat. The backend binds the runtime header to a
     * runtime owned by the presented node credential.
     */
    public void sendHeartbeat(String runtimeId, String status, Object currentProjectId) throws IOException {
        String url = baseUrl + "/agent-runtimes/" + runtimeId + "/heartbeat";
        Map<String, Object> body = new java.util.HashMap<>();
        if (status != null) body.put("status", status);
        if (currentProjectId != null) body.put("currentProjectId", currentProjectId);
        String json = objectMapper.writeValueAsString(body);
        Request request = new Request.Builder()
            .url(url)
            .header("Content-Type", "application/json")
            .post(RequestBody.create(json, MediaType.get("application/json")))
            .build();
        try (Response response = httpClient.newCall(request).execute()) {
            if (response.code() == 401 || response.code() == 403 || response.code() == 404) {
                throw new RuntimeRevokedException(
                    "Runtime or node is no longer authorized (HTTP " + response.code() + ")");
            }
            if (!response.isSuccessful()) {
                throw new IOException("Heartbeat failed with HTTP " + response.code());
            }
            String responseBody = response.body() != null ? response.body().string() : "";
            ApiResponse<Object> parsed = objectMapper.readValue(
                responseBody, new TypeReference<ApiResponse<Object>>() {});
            if (parsed.hasError()) {
                throw new IOException("Heartbeat failed: " + parsed.getError());
            }
        }
    }

    /** The node/runtime credential was revoked, drained or removed. */
    public static class RuntimeRevokedException extends IOException {
        public RuntimeRevokedException(String message) {
            super(message);
        }
    }

    /**
     * Get the decrypted provider config for this runtime. The node credential
     * and runtime header bind the request; the response is no-store.
     */
    public Map<String, Object> getProviderConfig() throws IOException {
        if (authManager == null || authManager.getNodeId() == null || config.getRuntimeId() == null) {
            throw new IOException("Node/runtime credential is not initialized");
        }
        String url = baseUrl + "/agent-nodes/" + authManager.getNodeId()
            + "/runtimes/" + config.getRuntimeId() + "/provider-config";
        ApiResponse<Map<String, Object>> response = executeGet(url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get provider config: " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Request a short-lived, repo-scoped GitHub credential for the project.
     * The backend chooses App or PAT mode and enforces the fallback flag.
     */
    public Map<String, Object> requestGitHubToken(String projectId) throws IOException {
        return requestGitHubToken(projectId, false);
    }

    public Map<String, Object> requestGitHubToken(String projectId, boolean forceRefresh)
            throws IOException {
        String url = baseUrl + "/github/" + projectId + "/token";
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("operation", "agent");
        body.put("forceRefresh", forceRefresh);
        ApiResponse<Map<String, Object>> response = executePost(
            url, body, new TypeReference<ApiResponse<Map<String, Object>>>() {});

        if (response.hasError()) {
            ApiResponse.Error error = response.getError();
            throw new GitHubTokenRequestException(
                error == null ? null : error.getCode(),
                error == null ? "token request failed" : error.getMessage());
        }

        return response.getData();
    }

    /**
     * Get repository connection config (including GitHub PAT) for the project.
     * PAT mode only; App mode returns no token and agents should use
     * {@link #requestGitHubToken(String)}.
     */
    public Map<String, Object> getRepoConfig(String projectId) throws IOException {
        String url = baseUrl + "/github/" + projectId + "/repo/agent";
        ApiResponse<Map<String, Object>> response = executeGet(url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get repo config: " + response.getError());
        }
        
        return response.getData();
    }

    /**
     * Fetch the project's active repo profile (fg-39). Returns null when the
     * project has no active profile.
     */
    public RepoProfileSnapshot getRepoProfile(String projectId) throws IOException {
        String url = baseUrl + "/projects/" + projectId + "/repo-profile/agent";
        ApiResponse<Map<String, Object>> response = executeGet(
            url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        if (response.hasError()) {
            throw new IOException("Failed to get repo profile: " + response.getError());
        }
        if (response.getData() == null) {
            return null;
        }
        return objectMapper.convertValue(response.getData(), RepoProfileSnapshot.class);
    }


    /**
     * Fetch one exact profile revision's scoped client-certificate material.
     * The private key is returned only to the agent and is never part of the
     * profile JSON or ordinary profile responses.
     */
    public EgressMtlsMaterial getRepoProfileMtls(
        String projectId,
        String profileId,
        int profileVersion,
        long expectedCredentialId
    ) throws IOException {
        String url = baseUrl + "/projects/" + projectId + "/repo-profile/agent/mtls"
            + "?profileId=" + profileId + "&profileVersion=" + profileVersion;
        ApiResponse<Map<String, Object>> response = executeGet(
            url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        if (response.hasError()) {
            throw new IOException("Failed to get repo profile mTLS material: " + response.getError());
        }
        if (response.getData() == null) {
            return null;
        }
        Map<String, Object> data = response.getData();
        Object versionValue = data.get("profile_version");
        if (!String.valueOf(profileId).equals(String.valueOf(data.get("profile_id")))
            || !String.valueOf(profileVersion).equals(String.valueOf(versionValue))) {
            throw new IllegalArgumentException(
                "repo profile mTLS response is for a different profile revision");
        }
        // pg returns BIGSERIAL ids as strings. Compare as strings so large ids
        // keep their exact value and a JSON string does not fail the check.
        Object credentialValue = data.get("credential_id");
        if (credentialValue == null
            || !String.valueOf(expectedCredentialId)
                .equals(String.valueOf(credentialValue))) {
            throw new IllegalArgumentException(
                "repo profile mTLS response is for a different credential");
        }
        Object hostsValue = data.get("hosts");
        if (!(hostsValue instanceof List<?> rawHosts)) {
            throw new IllegalArgumentException("repo profile mTLS response has no hosts");
        }
        List<String> hosts = new ArrayList<>();
        for (Object host : rawHosts) {
            hosts.add(String.valueOf(host));
        }
        String certB64 = data.get("cert_b64") == null ? null : String.valueOf(data.get("cert_b64"));
        String keyB64 = data.get("key_b64") == null ? null : String.valueOf(data.get("key_b64"));
        if (certB64 == null || keyB64 == null) {
            throw new IllegalArgumentException("repo profile mTLS response has no certificate/key");
        }
        String certPem = new String(Base64.getDecoder().decode(certB64), StandardCharsets.UTF_8);
        String keyPem = new String(Base64.getDecoder().decode(keyB64), StandardCharsets.UTF_8);
        EgressMtlsMaterial material = new EgressMtlsMaterial(hosts, certPem, keyPem);
        if (data.get("cert_sha256") != null
            && !material.certSha256().equals(String.valueOf(data.get("cert_sha256")))) {
            throw new IllegalArgumentException(
                "repo profile mTLS certificate fingerprint does not match the response");
        }
        return material;
    }

    /**
     * Claim the next queued repo-profile dry run for this project. Returns
     * null when the queue is empty.
     */
    public RepoProfileValidation claimRepoProfileValidation(String projectId) throws IOException {
        String url = baseUrl + "/projects/" + projectId
            + "/repo-profile/validations/claim";
        ApiResponse<Map<String, Object>> response = executePost(
            url, Map.of(), new TypeReference<ApiResponse<Map<String, Object>>>() {});
        if (response.hasError()) {
            throw new IOException("Failed to claim repo profile validation: " + response.getError());
        }
        if (response.getData() == null) {
            return null;
        }
        return objectMapper.convertValue(response.getData(), RepoProfileValidation.class);
    }

    /**
     * Report a repo-profile dry-run result. Retried calls return the first
     * terminal result, so a lost response is safe.
     */
    public RepoProfileValidation finishRepoProfileValidation(
        String projectId,
        String validationId,
        String status,
        Map<String, Object> result,
        String error
    ) throws IOException {
        String url = baseUrl + "/projects/" + projectId
            + "/repo-profile/validations/" + validationId + "/finish";
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        body.put("result", result == null ? Map.of() : result);
        if (error != null && !error.isBlank()) {
            body.put("error", error);
        }
        ApiResponse<Map<String, Object>> response = executePost(
            url, body, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        if (response.hasError()) {
            throw new IOException("Failed to finish repo profile validation: " + response.getError());
        }
        return response.getData() == null
            ? null
            : objectMapper.convertValue(response.getData(), RepoProfileValidation.class);
    }

    /**
     * Return the underlying OkHttpClient for reuse by in-process helpers.
     */
    public OkHttpClient getHttpClient() {
        return httpClient;
    }

    /**
     * List tickets in review status for the project.
     */
    public List<Ticket> listReviewTickets() throws IOException {
        String url = baseUrl + "/tickets/project/" + config.getProjectId() + "?status=review";
        ApiResponse<List<Ticket>> response = executeGet(url, new TypeReference<ApiResponse<List<Ticket>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to list review tickets: " + response.getError());
        }
        
        return response.getData() != null ? response.getData() : Collections.emptyList();
    }

    /**
     * Get PR diff for a ticket.
     */
    public Map<String, Object> getPRDiff(Long ticketId) throws IOException {
        String url = baseUrl + "/tickets/" + ticketId + "/review/diff";
        ApiResponse<Map<String, Object>> response = executeGet(url, new TypeReference<ApiResponse<Map<String, Object>>>() {});
        
        if (response.hasError()) {
            throw new IOException("Failed to get PR diff: " + response.getError());
        }
        
        return response.getData() != null ? response.getData() : Collections.emptyMap();
    }
}
