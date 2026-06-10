package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.*;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * GitHub API client for creating branches and PRs.
 * Uses the GitHub REST API.
 */
public class GitHubService {

    private static final String API_BASE = "https://api.github.com";

    private final String authToken;
    private final String owner;
    private final String repo;
    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public GitHubService(String authToken, String owner, String repo) {
        this.authToken = authToken;
        this.owner = owner;
        this.repo = repo;
        this.httpClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();
        this.objectMapper = new ObjectMapper();
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
            .url(API_BASE + "/repos/" + owner + "/" + repo + "/git/refs")
            .header("Authorization", "token " + authToken)
            .header("Accept", "application/vnd.github+json")
            .post(body)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
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

        // Create the commit
        Map<String, Object> parentSha = new HashMap<>();
        // We'd need to get the latest commit SHA first - simplified version
        Map<String, Object> commitBody = new HashMap<>();
        commitBody.put("message", message);
        commitBody.put("tree", treeSha);
        // parent_sha would go here in a full implementation

        String bodyJson = objectMapper.writeValueAsString(commitBody);
        RequestBody body = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request request = new Request.Builder()
            .url(API_BASE + "/repos/" + owner + "/" + repo + "/git/commits")
            .header("Authorization", "token " + authToken)
            .header("Accept", "application/vnd.github+json")
            .post(body)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
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
        Map<String, Object> requestBody = new HashMap<>();
        requestBody.put("title", title);
        requestBody.put("body", body);
        requestBody.put("head", headBranch);
        requestBody.put("base", baseBranch);
        requestBody.put("draft", false);

        String bodyJson = objectMapper.writeValueAsString(requestBody);
        RequestBody request = RequestBody.create(bodyJson, MediaType.get("application/json"));

        Request httpRequest = new Request.Builder()
            .url(API_BASE + "/repos/" + owner + "/" + repo + "/pulls")
            .header("Authorization", "token " + authToken)
            .header("Accept", "application/vnd.github+json")
            .post(request)
            .build();

        try (Response response = httpClient.newCall(httpRequest).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                throw new IOException("Failed to create PR: " + errorBody);
            }

            JsonNode root = objectMapper.readTree(response.body().string());
            return root.path("html_url").asText();
        }
    }

    private String getBranchSha(String branchName) throws IOException {
        Request request = new Request.Builder()
            .url(API_BASE + "/repos/" + owner + "/" + repo + "/branches/" + branchName)
            .header("Authorization", "token " + authToken)
            .header("Accept", "application/vnd.github+json")
            .get()
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Failed to get branch " + branchName + ": " + response.code());
            }
            return objectMapper.readTree(response.body().string()).path("commit").path("sha").asText();
        }
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
            .url(API_BASE + "/repos/" + owner + "/" + repo + "/git/trees")
            .header("Authorization", "token " + authToken)
            .header("Accept", "application/vnd.github+json")
            .post(body)
            .build();

        try (Response response = httpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Failed to create tree: " + response.code());
            }
            return objectMapper.readTree(response.body().string()).path("sha").asText();
        }
    }
}
