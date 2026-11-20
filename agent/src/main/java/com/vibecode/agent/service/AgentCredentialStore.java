package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;

/**
 * Persists enrollment-issued node credentials on a mounted volume.
 *
 * Writes are atomic (temp file + move) and the file mode is narrowed to 0600.
 * The refresh token is the durable secret; the access token is cached only to
 * avoid an unnecessary refresh on restart.
 */
public class AgentCredentialStore {

    private static final ObjectMapper MAPPER = new ObjectMapper().registerModule(new JavaTimeModule());

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
            instant(node, "refreshExpiresAt"));
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
            Instant refreshExpiresAt) {

        Object toJson() {
            java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
            map.put("nodeId", nodeId);
            map.put("accessToken", accessToken);
            map.put("refreshToken", refreshToken);
            map.put("accessExpiresAt", accessExpiresAt != null ? accessExpiresAt.toString() : null);
            map.put("refreshExpiresAt", refreshExpiresAt != null ? refreshExpiresAt.toString() : null);
            return map;
        }
    }
}
