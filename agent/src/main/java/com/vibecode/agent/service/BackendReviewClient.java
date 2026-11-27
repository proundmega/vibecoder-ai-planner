package com.vibecode.agent.service;

import java.io.IOException;
import java.util.Map;

/**
 * Creates a review request through the backend so the agent never needs the
 * self-hosted provider's API base URL or credential. The backend owns the
 * connected provider, the branch/base resolution and review idempotency.
 */
public final class BackendReviewClient implements GitService.ReviewClient {

    private final ApiService apiService;
    private final String provider;

    public BackendReviewClient(ApiService apiService, String provider) {
        if (apiService == null) {
            throw new IllegalArgumentException("ApiService is required for review requests");
        }
        this.apiService = apiService;
        this.provider = provider;
    }

    @Override
    public String createReviewRequest(
        long ticketId,
        String title,
        String body,
        String headBranch,
        String baseBranch
    ) throws IOException {
        Map<String, Object> data = apiService.createReviewRequest(
            ticketId, body, headBranch, baseBranch, provider);
        Object url = data == null ? null : data.get("url");
        // Branch-only providers (local bare/SSH) return no URL; the harness
        // still publishes head_sha and moves the ticket to review.
        return url instanceof String value && !value.isBlank() ? value : null;
    }
}
