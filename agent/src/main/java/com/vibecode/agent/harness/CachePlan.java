package com.vibecode.agent.harness;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Persistent, per-project dependency caches for fg-39 FR4 / D9.
 *
 * <p>Caches live under the runtime cache directory, scoped by project and by a
 * generation key (normalized repo + profile version + lockfile hash). They are
 * never shared across projects. Each run gets a writable mount because package
 * managers must populate the cache; the next prepare removes symlinks and
 * credential-shaped files, and evicts old generations to stay within the
 * configured quota.</p>
 */
public final class CachePlan {

    public static final List<String> KINDS = List.of(
        "npm", "maven", "gradle", "pip", "go", "cargo");

    private static final List<String> LOCKFILES = List.of(
        "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml",
        "pom.xml", "build.gradle", "build.gradle.kts", "gradle.lockfile",
        "requirements.txt", "poetry.lock", "Pipfile.lock", "pyproject.toml",
        "go.sum", "go.mod", "Cargo.lock");
    private static final Set<String> SENSITIVE_NAMES = Set.of(
        ".env", ".npmrc", ".netrc", "credentials", "id_rsa", "id_ed25519",
        "id_ecdsa", "token", "secrets");
    private static final Set<String> SENSITIVE_SUFFIXES = Set.of(
        ".pem", ".key", ".p12", ".pfx", ".keystore", ".jks");
    private static final long MAX_HASHED_LOCKFILE_BYTES = 16L * 1024 * 1024;
    private static final long DEFAULT_MAX_BYTES = 2048L * 1024 * 1024;
    private static final long DEFAULT_RETENTION_DAYS = 14L;

    private CachePlan() {
    }

    public record Mount(
        String kind,
        Path source,
        String target,
        Map<String, String> env
    ) {
        public Mount {
            env = env == null ? Map.of() : Map.copyOf(env);
        }
    }

    public record Prepared(List<Mount> mounts, String skippedReason) {
        public Prepared {
            mounts = mounts == null ? List.of() : List.copyOf(mounts);
        }

        public static Prepared skipped(String reason) {
            return new Prepared(List.of(), reason);
        }
    }

    public static synchronized Prepared prepare(
        RepoProfile profile,
        String projectId,
        int profileVersion,
        Path repoDir,
        Path cacheRoot
    ) throws IOException {
        if (profile == null || profile.caches().isEmpty()) {
            return new Prepared(List.of(), null);
        }
        long maxBytes = longEnv("SANDBOX_CACHE_MAX_MB", DEFAULT_MAX_BYTES / (1024 * 1024))
            * 1024 * 1024;
        long retentionDays = longEnv("SANDBOX_CACHE_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
        return prepare(
            profile.caches(), profile.repoUrl(), projectId, profileVersion,
            repoDir, cacheRoot, maxBytes, Duration.ofDays(Math.max(1L, retentionDays)));
    }

    static synchronized Prepared prepare(
        RepoProfile profile,
        String projectId,
        int profileVersion,
        Path repoDir,
        Path cacheRoot,
        long maxBytes,
        Duration retention
    ) throws IOException {
        if (profile == null || profile.caches().isEmpty()) {
            return new Prepared(List.of(), null);
        }
        return prepare(
            profile.caches(), profile.repoUrl(), projectId, profileVersion,
            repoDir, cacheRoot, maxBytes, retention);
    }

    static synchronized Prepared prepare(
        List<String> caches,
        String repoUrl,
        String projectId,
        int profileVersion,
        Path repoDir,
        Path cacheRoot,
        long maxBytes,
        Duration retention
    ) throws IOException {
        if (caches == null || caches.isEmpty()) {
            return new Prepared(List.of(), null);
        }
        if (projectId == null || projectId.isBlank()) {
            throw new IOException("A project id is required to scope dependency caches");
        }
        if (cacheRoot == null) {
            throw new IOException("A cache root is required for dependency caches");
        }
        List<String> kinds = new ArrayList<>();
        for (String kind : caches) {
            if (kind == null || !KINDS.contains(kind)) {
                throw new IOException("Unsupported dependency cache: " + kind);
            }
            if (!kinds.contains(kind)) {
                kinds.add(kind);
            }
        }

        Path projectRoot = cacheRoot.resolve("projects").resolve(shortHash(projectId));
        String generation = shortHash(
            normalizeRepo(repoUrl) + "|" + profileVersion + "|" + lockfileHash(repoDir));
        Path current = projectRoot.resolve(generation);
        Files.createDirectories(projectRoot);

        long max = Math.max(1L, maxBytes);
        enforceQuota(projectRoot, current, max, retention);
        long currentBytes = size(current);
        if (currentBytes > max) {
            deleteTree(current);
            return Prepared.skipped("dependency cache exceeds SANDBOX_CACHE_MAX_MB");
        }

        // Writes from earlier runs are untrusted input: remove symlinks,
        // non-regular files and credential-shaped artifacts before reuse.
        sanitizeTree(current);

        List<Mount> mounts = new ArrayList<>();
        for (String kind : kinds) {
            Path source = current.resolve(kind);
            Files.createDirectories(source);
            String target = "/cache/" + kind;
            mounts.add(new Mount(kind, source, target, cacheEnv(kind, target)));
        }
        return new Prepared(mounts, null);
    }

    private static Map<String, String> cacheEnv(String kind, String target) {
        Map<String, String> env = new LinkedHashMap<>();
        switch (kind) {
            case "npm" -> env.put("NPM_CONFIG_CACHE", target);
            case "pip" -> env.put("PIP_CACHE_DIR", target);
            case "maven" -> env.put("MAVEN_OPTS", "-Dmaven.repo.local=" + target);
            case "gradle" -> env.put("GRADLE_USER_HOME", target);
            case "go" -> {
                env.put("GOMODCACHE", target + "/mod");
                env.put("GOCACHE", target + "/build");
            }
            case "cargo" -> env.put("CARGO_HOME", target);
            default -> throw new IllegalArgumentException("Unsupported cache: " + kind);
        }
        return Map.copyOf(env);
    }

    private static void enforceQuota(
        Path projectRoot,
        Path current,
        long maxBytes,
        Duration retention
    ) throws IOException {
        List<Path> generations = new ArrayList<>();
        try (var stream = Files.list(projectRoot)) {
            stream.filter((path) -> Files.isDirectory(path, LinkOption.NOFOLLOW_LINKS))
                .forEach(generations::add);
        }
        long total = 0;
        Map<Path, Long> sizes = new LinkedHashMap<>();
        for (Path generation : generations) {
            long size = size(generation);
            sizes.put(generation, size);
            total += size;
        }
        Instant cutoff = retention == null || retention.isZero() || retention.isNegative()
            ? null : Instant.now().minus(retention);
        generations.sort(Comparator.comparingLong(CachePlan::lastModified));
        for (Path generation : generations) {
            if (generation.equals(current)) {
                continue;
            }
            boolean expired = cutoff != null && lastModified(generation) < cutoff.toEpochMilli();
            if (expired || total > maxBytes) {
                long removed = sizes.getOrDefault(generation, 0L);
                deleteTree(generation);
                total -= removed;
            }
        }
    }

    static void sanitizeTree(Path root) throws IOException {
        if (root == null || !Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
                throws IOException {
                if (Files.isSymbolicLink(file)
                    || !attrs.isRegularFile()
                    || sensitive(file)) {
                    Files.deleteIfExists(file);
                }
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static boolean sensitive(Path file) {
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        if (SENSITIVE_NAMES.contains(name)) {
            return true;
        }
        for (String suffix : SENSITIVE_SUFFIXES) {
            if (name.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }

    private static String lockfileHash(Path repoDir) throws IOException {
        MessageDigest digest = sha256();
        if (repoDir == null || !Files.isDirectory(repoDir, LinkOption.NOFOLLOW_LINKS)) {
            return "no-repo";
        }
        for (String name : LOCKFILES) {
            Path lockfile = repoDir.resolve(name);
            if (!Files.isRegularFile(lockfile, LinkOption.NOFOLLOW_LINKS)) {
                continue;
            }
            digest.update(name.getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            long size = Files.size(lockfile);
            digest.update(Long.toString(size).getBytes(StandardCharsets.UTF_8));
            if (size > MAX_HASHED_LOCKFILE_BYTES) {
                continue;
            }
            try (InputStream in = Files.newInputStream(lockfile)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    digest.update(buffer, 0, read);
                }
            }
        }
        return hex(digest.digest());
    }

    private static String normalizeRepo(String repoUrl) {
        return String.valueOf(repoUrl == null ? "" : repoUrl)
            .trim()
            .replaceAll("\\.git$", "")
            .replaceAll("/+$", "")
            .toLowerCase(Locale.ROOT);
    }

    private static String shortHash(String value) {
        return hex(sha256().digest(String.valueOf(value).getBytes(StandardCharsets.UTF_8)))
            .substring(0, 32);
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(Character.forDigit((value >> 4) & 0xF, 16));
            builder.append(Character.forDigit(value & 0xF, 16));
        }
        return builder.toString();
    }

    private static long lastModified(Path path) {
        try {
            return Files.getLastModifiedTime(path, LinkOption.NOFOLLOW_LINKS).toMillis();
        } catch (IOException e) {
            return 0L;
        }
    }

    private static long size(Path root) {
        if (root == null || !Files.exists(root, LinkOption.NOFOLLOW_LINKS)) {
            return 0L;
        }
        long[] total = {0L};
        try {
            Files.walkFileTree(root, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (attrs.isRegularFile() && !Files.isSymbolicLink(file)) {
                        total[0] += attrs.size();
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            return Long.MAX_VALUE;
        }
        return total[0];
    }

    private static void deleteTree(Path root) throws IOException {
        if (root == null || !Files.exists(root, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
                throws IOException {
                Files.deleteIfExists(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc)
                throws IOException {
                Files.deleteIfExists(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static long longEnv(String name, long fallback) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            return Math.max(0L, Long.parseLong(value.trim()));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
