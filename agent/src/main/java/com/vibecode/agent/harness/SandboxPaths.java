package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Path safety shared by every {@link SandboxRunner}.
 *
 * <p>A hostile workspace can contain symlinks and {@code ..} segments. The
 * sandbox only ever exposes {@code /workspace}; every path that crosses the
 * control channel is normalized and proven to stay inside it.</p>
 */
final class SandboxPaths {

    static final String CONTAINER_WORKSPACE = "/workspace";

    private SandboxPaths() {
    }

    static Path validateWorkspace(Path workspace) throws IOException {
        if (workspace == null) {
            throw new IOException("Sandbox workspace is required");
        }
        if (Files.isSymbolicLink(workspace)) {
            throw new IOException("Refusing to sandbox a symlinked workspace: " + workspace);
        }
        Path real = workspace.toRealPath();
        if (!Files.isDirectory(real)) {
            throw new IOException("Sandbox workspace is not a directory: " + workspace);
        }
        return real;
    }

    /** Resolve a sandbox-relative cwd to a real path inside the workspace. */
    static Path resolveCwd(Path workspace, String cwd) throws IOException {
        Path root = validateWorkspace(workspace);
        if (cwd == null || cwd.isBlank() || ".".equals(cwd.trim())) {
            return root;
        }
        String value = cwd.replace('\\', '/').trim();
        if (value.equals(CONTAINER_WORKSPACE)) {
            return root;
        }
        if (value.startsWith(CONTAINER_WORKSPACE + "/")) {
            value = value.substring(CONTAINER_WORKSPACE.length() + 1);
        } else if (value.startsWith("/")) {
            throw new IOException("Absolute sandbox cwd must start with /workspace: " + cwd);
        }

        Path resolved = root.resolve(value).normalize();
        if (!resolved.startsWith(root)) {
            throw new IOException("Sandbox cwd escapes the workspace: " + cwd);
        }
        if (Files.exists(resolved)) {
            Path real = resolved.toRealPath();
            if (!real.startsWith(root)) {
                throw new IOException("Sandbox cwd resolves outside the workspace: " + cwd);
            }
        }
        return resolved;
    }

    /** Normalize a path to its in-container form, rejecting any escape. */
    static String containerPath(String raw) throws IOException {
        String value = raw == null || raw.isBlank()
            ? CONTAINER_WORKSPACE
            : raw.replace('\\', '/').trim();
        if (!value.startsWith("/")) {
            value = CONTAINER_WORKSPACE + "/" + value;
        }

        Deque<String> segments = new ArrayDeque<>();
        for (String segment : value.split("/")) {
            if (segment.isEmpty() || ".".equals(segment)) {
                continue;
            }
            if ("..".equals(segment)) {
                if (segments.isEmpty()) {
                    throw new IOException("Sandbox path escapes the workspace: " + raw);
                }
                segments.removeLast();
            } else {
                segments.addLast(segment);
            }
        }

        String normalized = "/" + String.join("/", segments);
        if (!normalized.equals(CONTAINER_WORKSPACE)
            && !normalized.startsWith(CONTAINER_WORKSPACE + "/")) {
            throw new IOException("Sandbox path is outside /workspace: " + raw);
        }
        return normalized;
    }

    static String containerCwd(String cwd) throws IOException {
        return containerPath(cwd == null || cwd.isBlank() ? CONTAINER_WORKSPACE : cwd);
    }

    /** Map an in-container path back to the supervisor-local workspace. */
    static Path remoteToLocal(Path workspace, String remote) throws IOException {
        Path root = validateWorkspace(workspace);
        String container = containerPath(remote);
        String relative = container.equals(CONTAINER_WORKSPACE)
            ? ""
            : container.substring(CONTAINER_WORKSPACE.length() + 1);
        Path resolved = root.resolve(relative).normalize();
        if (!resolved.startsWith(root)) {
            throw new IOException("Sandbox path escapes the workspace: " + remote);
        }
        return resolved;
    }
}
