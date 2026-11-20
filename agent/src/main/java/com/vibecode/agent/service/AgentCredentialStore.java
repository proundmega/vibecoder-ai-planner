package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Persists enrollment-issued node credentials on a mounted volume.
 *
 * <p>Writes are atomic (temp file + move) and the file mode is narrowed to
 * 0600. The refresh token is the durable secret; the access token is cached
 * only to avoid an unnecessary refresh on restart. {@link #withLock} takes an
 * OS file lock (and a JVM-wide lock for tests/in-process callers) so the
 * supervisor and every child on one host rotate the same node credential
 * exactly once. The idempotency key for the current rotation is persisted with
 * the credential, so a retry or a second process replays the same key instead
 * of presenting a rotated token under a new key.</p>
 */
public class AgentCredentialStore {

    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());
    private static final Map<Path, ReentrantLock> JVM_LOCKS = new ConcurrentHashMap<>();

    private final Path path;

    public AgentCredentialStore(Path path) {
        this.path = path.toAbsolutePath();
    }

    public Path path() {
        return path;
    }

    public boolean exists() {
        return Files.isRegularFile(path);
    }

    public Credentials load() throws IOException {
        JsonNode node = MAPPER.readTree(Files.readString(path, StandardCharsets.UTF_8));
        return new Credentials(
            text(node, "nodeId"),
            text(node, "accessToken"),
            text(node, "refreshToken"),
            instant(node, "accessExpiresAt"),
            instant(node, "refreshExpiresAt"),
            textOrNull(node, "refreshKey"));
    }

    public void save(Credentials credentials) throws IOException {
        Path parent = path.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }

        String json = MAPPER.writeValueAsString(credentials.toJson());
        Path tmp = Files.createTempFile(parent, ".agent-credentials", ".tmp");
        try {
            Files.writeString(tmp, json, StandardCharsets.UTF_8);
            restrictPermissions(tmp);
            try {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
            }
            restrictPermissions(path);
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    /**
     * Serialize a credential read/refresh/write across every process that
     * shares this file. The JVM lock prevents {@link java.nio.channels.OverlappingFileLockException}
     * when two agents run in one JVM (tests, local tools).
     */
    public <T> T withLock(IoAction<T> action) throws IOException {
        Path lockPath = path.resolveSibling(path.getFileName() + ".lock");
        Path parent = lockPath.getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        ReentrantLock jvmLock = JVM_LOCKS.computeIfAbsent(lockPath.toAbsolutePath(), key -> new ReentrantLock());
        jvmLock.lock();
        try (FileChannel channel = FileChannel.open(lockPath,
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             FileLock ignored = channel.lock()) {
            return action.run();
        } finally {
            jvmLock.unlock();
        }
    }

    @FunctionalInterface
    public interface IoAction<T> {
        T run() throws IOException;
    }

    private static void restrictPermissions(Path file) {
        try {
            Set<PosixFilePermission> mode = EnumSet.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE);
            Files.setPosixFilePermissions(file, mode);
        } catch (UnsupportedOperationException | IOException ignored) {
            // Non-POSIX filesystems: the volume/permissions are the operator's
            // responsibility; never fail startup because chmod is unavailable.
        }
    }

    private static String text(JsonNode node, String field) throws IOException {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || value.asText().isBlank()) {
            throw new IOException("Credential file is missing " + field);
        }
        return value.asText();
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || value.asText().isBlank()) return null;
        return value.asText();
    }

    private static Instant instant(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || value.asText().isBlank()) return null;
        try {
            return Instant.parse(value.asText());
        } catch (RuntimeException e) {
            return null;
        }
    }

    public record Credentials(
            String nodeId,
            String accessToken,
            String refreshToken,
            Instant accessExpiresAt,
            Instant refreshExpiresAt,
            String refreshKey) {

        /** Backward-compatible constructor for enroll responses. */
        public Credentials(String nodeId, String accessToken, String refreshToken,
                           Instant accessExpiresAt, Instant refreshExpiresAt) {
            this(nodeId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, null);
        }

        Object toJson() {
            java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
            map.put("nodeId", nodeId);
            map.put("accessToken", accessToken);
            map.put("refreshToken", refreshToken);
            map.put("accessExpiresAt", accessExpiresAt != null ? accessExpiresAt.toString() : null);
            map.put("refreshExpiresAt", refreshExpiresAt != null ? refreshExpiresAt.toString() : null);
            map.put("refreshKey", refreshKey);
            return map;
        }
    }
}
