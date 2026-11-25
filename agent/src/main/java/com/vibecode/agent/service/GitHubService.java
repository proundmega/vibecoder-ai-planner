package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.harness.RedactionRegistry;
import com.vibecode.agent.harness.SecretRedactor;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * GitHub API client for creating branches and PRs.
 * Uses the GitHub REST API.
 */
public class GitHubService {

    private static final Logger log = LoggerFactory.getLogger(GitHubService.class);
    private static final String DEFAULT_API_BASE = "https://api.github.com";

    private final GitHubTokenSource tokenSource;
    private final String owner;
    private final String repo;
    private final String apiBase;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final java.util.function.UnaryOperator<String> redactor;

    public GitHubService(String authToken, String owner, String repo) {
        this(() -> authToken, owner, repo, DEFAULT_API_BASE, RedactionRegistry::redact);
    }

    /** Package-visible so contract tests can target a local HTTP server. */
    GitHubService(String authToken, String owner, String repo, String apiBase) {
        this(() -> authToken, owner, repo, apiBase, RedactionRegistry::redact);
    }

    public GitHubService(GitHubTokenSource tokenSource, String owner, String repo) {
        this(tokenSource, owner, repo, DEFAULT_API_BASE, RedactionRegistry::redact);
    }

    /** Package-visible so contract tests can inject a deterministic redactor. */
    GitHubService(
        GitHubTokenSource tokenSource,
        String owner,
        String repo,
        SecretRedactor redactor
    ) {
        this(tokenSource, owner, repo, DEFAULT_API_BASE,
            redactor == null ? RedactionRegistry::redact : redactor::redact);
    }

    /** Package-visible so contract tests can target a local HTTP server. */
    GitHubService(GitHubTokenSource tokenSource, String owner, String repo, String apiBase) {
        this(tokenSource, owner, repo, apiBase, RedactionRegistry::redact);
    }

    /** Package-visible so contract tests can target a local HTTP server. */
    GitHubService(
        GitHubTokenSource tokenSource,
        String owner,
        String repo,
        String apiBase,
        java.util.function.UnaryOperator<String> redactor
    ) {
        this.tokenSource = tokenSource;
        this.owner = owner;
        this.repo = repo;
        this.apiBase = apiBase;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();
        this.objectMapper = new ObjectMapper();
        this.redactor = redactor == null ? RedactionRegistry::redact : redactor;
    }

    private Response executeWithAuth(Request request) throws IOException {
        Response response = httpClient.newCall(request).execute();
        if (response.code() != 401) {
            return response;
        }
        response.close();
        String refreshed = tokenSource.refresh();
        if (refreshed == null || refreshed.isBlank()) {
            throw new IOException("No GitHub credential is available after a 401");
        }
        RedactionRegistry.register(refreshed);
        Request retry = request.newBuilder()
            .header("Authorization", "token " + refreshed)
            .build();
        return httpClient.newCall(retry).execute();
    }

    private String token() throws IOException {
        String value = tokenSource.get();
        if (value == null || value.isBlank()) {
            throw new IOException("No GitHub credential is available");
        }
        RedactionRegistry.register(value);
        return value;
    }

    /**
     * Create a new branch from the default branch.
     */
    public String createBranch(String branchName, String fromBranch) throws IOException {
        // Get the SHA of the source branch
        String sha = getBranchSha(fromBranch);

        // Create the new branch
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("ref", "refs/heads/" + branchName);
        requestBody.put("sha", sha);

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo + "/git/refs")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .post(body)
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                // Branch might already exist
                if (response.code() == 422 && errorBody.contains("already exists")) {
                    return "refs/heads/" + branchName;
                }
                throw new IOException("Failed to create branch " + branchName + ": " + errorBody);
            }

            JsonNode root = objectMapper.readTree(response.body().string());
            return root.path("ref").asText();
        }
    }

    /**
     * Create a commit on a branch.
     */
    public String createCommit(String branchName, String message, String filePath, String content) throws IOException {
        // Get the SHA of the file (or tree)
        String treeSha = createTree(filePath, content);

        // Get the latest commit SHA from the branch to use as parent
        String parentSha = getBranchSha(branchName);

        // Create the commit
        Map<String, Object> commitBody = new HashMap<>();
        commitBody.put("message", redactor.apply(message));
        commitBody.put("tree", treeSha);
        commitBody.put("parent", parentSha);

        String bodyJson = objectMapper.writeValueAsString(commitBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo + "/git/commits")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .post(body)
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                throw new IOException("Failed to create commit: " + errorBody);
            }
            return objectMapper.readTree(response.body().string()).path("sha").asText();
        }
    }

    /**
     * Create a pull request.
     */
    public String createPullRequest(String title, String body, String headBranch, String baseBranch) throws IOException {
        // Auto-detect default branch if baseBranch is not found
        String actualBase = baseBranch;
        try {
            getBranchSha(baseBranch);
        } catch (IOException e) {
            log.warn("Base branch '{}' not found, trying to detect default branch", baseBranch);
            String detected = detectDefaultBranch();
            if (detected != null) {
                actualBase = detected;
                log.info("Detected default branch: {}", actualBase);
            }
        }
        
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("title", redactor.apply(title));
        requestBody.put("body", redactor.apply(body));
        requestBody.put("head", headBranch);
        requestBody.put("base", actualBase);
        requestBody.put("draft", false);

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody request = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request httpRequest = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo + "/pulls")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .post(request)
            .build();

        try (Response response = executeWithAuth(httpRequest)) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                if (response.code() == 422 && errorBody.contains("A pull request already exists")) {
                    log.info("PR already exists for branch {}, fetching existing PR URL", headBranch);
                    String existingUrl = getExistingPRUrl(headBranch, actualBase, "all");
                    if (existingUrl != null) {
                        return existingUrl;
                    }
                    throw new IOException("PR already exists for branch " + headBranch + " but could not fetch its URL");
                }
                throw new IOException("Failed to create PR: " + errorBody);
            }

            JsonNode root = objectMapper.readTree(response.body().string());
            return root.path("html_url").asText();
        }
    }

    private String detectDefaultBranch() throws IOException {
        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo)
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = executeWithAuth(request)) {
            if (response.isSuccessful()) {
                JsonNode root = objectMapper.readTree(response.body().string());
                String defaultBranch = root.path("default_branch").asText();
                if (defaultBranch != null && !defaultBranch.isEmpty()) {
                    return defaultBranch;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to detect default branch: {}", e.getMessage());
        }
        return null;
    }

    /**
     * Find an existing PR for a branch. Used by startup recovery to adopt a
     * publish whose finish call was lost.
     */
    public String findPullRequestUrl(String headBranch) throws IOException {
        // Recovery must only adopt an open PR; a closed PR is not a publish.
        return getExistingPRUrl(headBranch, null, "open");
    }

    private String getExistingPRUrl(
        String headBranch,
        String baseBranch,
        String state
    ) throws IOException {
        String url = apiBase + "/repos/" + owner + "/" + repo
            + "/pulls?head=" + owner + ":" + headBranch + "&state=" + state;
        if (baseBranch != null && !baseBranch.isBlank()) {
            url += "&base=" + baseBranch;
        }

        Request request = new Request.Builder()
            .url(url)
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = executeWithAuth(request)) {
            if (response.isSuccessful()) {
                JsonNode pulls = objectMapper.readTree(response.body().string());
                if (pulls.isArray() && pulls.size() > 0) {
                    JsonNode existingPR = pulls.get(0);
                    String htmlUrl = existingPR.path("html_url").asText();
                    log.info("Found existing PR #{}: {}", existingPR.path("number").asInt(), htmlUrl);
                    return htmlUrl;
                }
            }
        } catch (Exception e) {
            log.warn("Failed to get existing PR URL: {}", e.getMessage());
        }
        return null;
    }

    private String getBranchSha(String branchName) throws IOException {
        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo + "/branches/" + branchName)
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                throw new IOException("Failed to get branch " + branchName + ": " + response.code());
            }
            return objectMapper.readTree(response.body().string()).path("commit").path("sha").asText();
        }
    }

    /**
     * Fetch the authenticated login. Used to require that a review adopted for
     * partial-publish recovery was authored by this reviewer identity.
     */
    public String getAuthenticatedLogin() throws IOException {
        Request request = new Request.Builder()
            .url(apiBase + "/user")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                throw new IOException("Failed to get authenticated login: " + response.code());
            }
            String login = objectMapper.readTree(response.body().string())
                .path("login").asText("");
            if (login.isBlank()) {
                throw new IOException("GitHub did not return an authenticated login");
            }
            return login;
        }
    }

    /**
     * Fetch the current head SHA of a pull request. Used to re-check the
     * reviewed commit immediately before publishing a review.
     */
    public String getPullRequestHeadSha(int pullNumber) throws IOException {
        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo + "/pulls/" + pullNumber)
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                throw new IOException(
                    "Failed to get pull request " + pullNumber + ": " + response.code());
            }
            JsonNode root = objectMapper.readTree(response.body().string());
            String sha = root.path("head").path("sha").asText("");
            if (sha.isBlank()) {
                throw new IOException("Pull request " + pullNumber + " has no head SHA");
            }
            return sha;
        }
    }

    /**
     * List the existing reviews on a pull request. Used to adopt a review that
     * posted successfully before an attempt-completion write failed.
     */
    public List<PullRequestReview> listPullRequestReviews(int pullNumber) throws IOException {
        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo
                + "/pulls/" + pullNumber + "/reviews?per_page=100")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                throw new IOException(
                    "Failed to list reviews for pull request " + pullNumber + ": "
                        + response.code());
            }
            JsonNode root = objectMapper.readTree(response.body().string());
            List<PullRequestReview> reviews = new ArrayList<>();
            if (root.isArray()) {
                for (JsonNode node : root) {
                    long id = node.path("id").asLong(0);
                    if (id <= 0) {
                        continue;
                    }
                    reviews.add(new PullRequestReview(
                        id,
                        node.path("commit_id").asText(""),
                        node.path("body").asText(""),
                        node.path("user").path("login").asText(""),
                        node.path("state").asText("")
                    ));
                }
            }
            return reviews;
        }
    }

    /**
     * Create a COMMENT-only pull request review attached to an exact commit.
     * Phase 1 never sends APPROVE or REQUEST_CHANGES.
     */
    public long createPullRequestReview(int pullNumber, String commitId, String body)
        throws IOException {
        if (commitId == null || commitId.isBlank()) {
            throw new IOException("A reviewed commit id is required");
        }
        Map<String, Object> payload = new HashMap<>();
        payload.put("commit_id", commitId);
        payload.put("body", redactor.apply(body == null ? "" : body));
        payload.put("event", "COMMENT");

        String bodyJson = objectMapper.writeValueAsString(payload);
        RequestBody requestBody = RequestBody.create(
            bodyJson, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo
                + "/pulls/" + pullNumber + "/reviews")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .post(requestBody)
            .build();

        try (Response response = executeWithAuth(request)) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException(
                    "Failed to create pull request review: " + response.code()
                        + (responseBody.isBlank() ? "" : " " + redactor.apply(responseBody)));
            }
            JsonNode root = objectMapper.readTree(responseBody);
            long id = root.path("id").asLong(0);
            if (id <= 0) {
                throw new IOException("GitHub did not return a review id");
            }
            return id;
        }
    }

    public record PullRequestReview(
        long id,
        String commitId,
        String body,
        String author,
        String state
    ) {
    }

    private String createTree(String filePath, String content) throws IOException {
        // Simplified: in a real implementation, you'd need to get the base tree SHA
        // and create a proper tree with all files
        Map<String, Object> treeItem = new HashMap<>();
        treeItem.put("path", filePath);
        treeItem.put("content", content);
        treeItem.put("type", "blob");
        treeItem.put("mode", "100644");

        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("tree", java.util.Collections.singletonList(treeItem));

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(apiBase + "/repos/" + owner + "/" + repo + "/git/trees")
            .header("Authorization", "token " + token())
            .header("Accept", "application/vnd.github+json")
            .post(body)
            .build();

        try (Response response = executeWithAuth(request)) {
            if (!response.isSuccessful()) {
                throw new IOException("Failed to create tree: " + response.code());
            }
            return objectMapper.readTree(response.body().string()).path("sha").asText();
        }
    }
}
