package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/**
 * fg-45: structured READINESS_FAILED response from the backend.
 *
 * <p>The supervisor must not clone, start a harness or publish for an unready
 * ticket. It posts the issue codes back to the ticket and leaves it in
 * backlog.</p>
 */
public class ReadinessException extends IOException {

    private final String code;
    private final JsonNode details;

    public ReadinessException(String message, JsonNode details) {
        super(message == null ? "Ticket is not ready" : message);
        this.code = "READINESS_FAILED";
        this.details = details;
    }

    public String getCode() {
        return code;
    }

    public JsonNode getDetails() {
        return details;
    }

    /** Issue codes from {@code details.issues[]}. */
    public List<String> issueCodes() {
        List<String> codes = new ArrayList<>();
        if (details == null) return codes;
        JsonNode issues = details.path("issues");
        if (issues.isArray()) {
            for (JsonNode issue : issues) {
                String issueCode = issue.path("code").asText(null);
                if (issueCode != null && !issueCode.isBlank()) {
                    codes.add(issueCode);
                }
            }
        }
        return codes;
    }

    public String summary() {
        List<String> codes = issueCodes();
        return codes.isEmpty() ? getMessage() : String.join(", ", codes);
    }
}
