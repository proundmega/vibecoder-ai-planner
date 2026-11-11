package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;

/**
 * Path policy for the model-facing {@code sandbox_read}/{@code sandbox_grep}
 * tools.
 *
 * <p>OpenCode's built-in read tool resolves symlinks after its literal path
 * deny rules, and its grep tool can bypass those rules. The supervisor therefore
 * replaces both tools with wrappers that resolve {@code toRealPath()} first and
 * only accept a target inside the workspace. Credential-bearing paths remain
 * denied after resolution, so a symlink cannot hide one.</p>
 */
final class WorkspacePathPolicy {

    private static final Set<String> DENIED_SEGMENTS = Set.of(
        "secrets", ".ssh", ".aws", ".docker", ".kube"
    );
    private static final Set<String> WRITE_DENIED_SEGMENTS = Set.of(".git", ".opencode");
    private static final Set<String> WRITE_DENIED_FILES = Set.of("opencode.json", "opencode.jsonc");
    private static final Set<String> DENIED_FILES = Set.of(
        ".npmrc", ".netrc", ".git-credentials", ".gitconfig"
    );
    private static final List<String> IGNORED_DIRECTORIES = List.of(
        ".git", "node_modules", "target", "build", "dist", ".gradle"
    );

    private WorkspacePathPolicy() {
    }

    /**
     * Resolve a model-supplied path inside {@code workspaceReal}.
     *
     * @throws IOException when the path is missing, invalid, outside the
     *     workspace or denied by the credential-path policy
     */
    static Path resolveReadable(Path workspaceReal, String requested) throws IOException {
        if (requested == null || requested.isBlank()) {
            throw new IOException("path is required");
        }
        Path raw;
        try {
            raw = Path.of(requested);
        } catch (InvalidPathException e) {
            throw new IOException("invalid path");
        }
        Path candidate = raw.isAbsolute()
            ? raw.normalize()
            : workspaceReal.resolve(raw).normalize();
        Path real;
        try {
            real = candidate.toRealPath();
        } catch (IOException e) {
            throw new IOException("path not found");
        }
        if (!real.startsWith(workspaceReal)) {
            throw new IOException("path escapes the workspace");
        }
        if (isDenied(workspaceReal, real)) {
            throw new IOException("path is denied by the read policy");
        }
        return real;
    }

    static boolean isDenied(Path workspaceReal, Path real) {
        Path relative;
        try {
            relative = workspaceReal.relativize(real);
        } catch (IllegalArgumentException e) {
            return true;
        }
        for (Path segment : relative) {
            if (DENIED_SEGMENTS.contains(segment.toString())) {
                return true;
            }
        }
        String path = relative.toString().replace('\\', '/');
        String fileName = relative.getFileName() == null
            ? ""
            : relative.getFileName().toString();
        if (path.equals(".git/config") || path.endsWith("/.git/config")) {
            return true;
        }
        if (DENIED_FILES.contains(fileName)) {
            return true;
        }
        boolean envLike = fileName.equals(".env")
            || fileName.equals(".envrc")
            || fileName.startsWith(".env.")
            || fileName.endsWith(".env")
            || fileName.contains(".env.");
        return envLike && !fileName.endsWith(".env.example");
    }

    /**
     * Resolve a model-supplied write target inside {@code workspaceReal}.
     *
     * <p>The parent is resolved with {@code toRealPath()} so a symlinked
     * directory cannot redirect a write. The final component must not itself be
     * a symlink, and the target must not be a credential, VCS or OpenCode
     * control path.</p>
     */
    static Path resolveWritable(Path workspaceReal, String requested) throws IOException {
        if (requested == null || requested.isBlank()) {
            throw new IOException("path is required");
        }
        Path raw;
        try {
            raw = Path.of(requested);
        } catch (InvalidPathException e) {
            throw new IOException("invalid path");
        }
        Path candidate = raw.isAbsolute()
            ? raw.normalize()
            : workspaceReal.resolve(raw).normalize();
        Path parent = candidate.getParent();
        if (parent == null) {
            parent = workspaceReal;
        }
        Path parentReal;
        try {
            parentReal = parent.toRealPath();
        } catch (IOException e) {
            throw new IOException("parent directory not found");
        }
        if (!parentReal.startsWith(workspaceReal)) {
            throw new IOException("path escapes the workspace");
        }
        Path fileName = candidate.getFileName();
        if (fileName == null) {
            throw new IOException("a file path is required");
        }
        Path target = parentReal.resolve(fileName.toString()).normalize();
        if (!target.startsWith(workspaceReal)) {
            throw new IOException("path escapes the workspace");
        }
        if (Files.isSymbolicLink(target)) {
            throw new IOException("refusing to write through a symlink");
        }
        if (Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            Path real = target.toRealPath();
            if (!real.startsWith(workspaceReal)) {
                throw new IOException("path escapes the workspace");
            }
            if (isWriteDenied(workspaceReal, real)) {
                throw new IOException("path is denied by the write policy");
            }
            return real;
        }
        if (isWriteDenied(workspaceReal, target)) {
            throw new IOException("path is denied by the write policy");
        }
        return target;
    }

    static boolean isWriteDenied(Path workspaceReal, Path target) {
        if (isDenied(workspaceReal, target)) {
            return true;
        }
        Path relative;
        try {
            relative = workspaceReal.relativize(target);
        } catch (IllegalArgumentException e) {
            return true;
        }
        for (Path segment : relative) {
            if (WRITE_DENIED_SEGMENTS.contains(segment.toString())) {
                return true;
            }
        }
        String fileName = relative.getFileName() == null
            ? ""
            : relative.getFileName().toString();
        return WRITE_DENIED_FILES.contains(fileName);
    }

    static boolean isIgnoredDirectory(String name) {
        return IGNORED_DIRECTORIES.contains(name);
    }
}
