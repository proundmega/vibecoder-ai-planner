package com.vibecode.agent.harness;

import java.nio.file.Path;
import java.time.Instant;

/** Handle to one running sandbox. */
public record SandboxHandle(String id, Path workspace, boolean host, Instant createdAt) {
    public SandboxHandle {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Sandbox id is required");
        }
        if (workspace == null) {
            throw new IllegalArgumentException("Sandbox workspace is required");
        }
        createdAt = createdAt == null ? Instant.now() : createdAt;
    }
}
