package com.vibecode.agent.service;

import java.io.IOException;

/**
 * A definitive token-endpoint rejection (as opposed to a network failure).
 * The provider must not use an ambient PAT fallback for these.
 */
public class GitHubTokenRequestException extends IOException {
    private final String code;

    public GitHubTokenRequestException(String code, String message) {
        super(code == null ? message : code + ": " + message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }
}
