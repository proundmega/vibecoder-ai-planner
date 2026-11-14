package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitOption;
import java.nio.file.FileVisitResult;
import java.nio.file.FileVisitor;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Loopback control channel for the model's read/grep tools.
 *
 * <p>OpenCode's built-in read/grep tools are disabled. The generated
 * {@code sandbox_read}/{@code sandbox_grep} tools forward here; every path is
 * resolved with {@link Path#toRealPath()} and must stay inside the workspace.
 * Grep never follows symlinks, so a workspace symlink cannot expose a
 * supervisor-only file.</p>
 */
final class WorkspaceFileBridge implements AutoCloseable {

    static final int MAX_BODY_BYTES = 64 * 1024;
    static final int MAX_WRITE_BYTES = 1024 * 1024;
    static final int MAX_READ_BYTES = 256 * 1024;
    static final long MAX_READ_FILE_BYTES = 4L * 1024 * 1024;
    static final int MAX_GREP_MATCHES = 200;
    static final long MAX_GREP_FILE_BYTES = 1024 * 1024;
    static final int MAX_GREP_FILES = 20_000;
    static final long MAX_GREP_TOTAL_BYTES = 64L * 1024 * 1024;
    private static final int MAX_GREP_LINE_CHARS = 500;
    private static final int DEFAULT_READ_LINES = 2000;
    private static final String TOKEN_HEADER = "X-Workspace-Token";
    private static final long FILE_LOCK_TIMEOUT_MS = 5_000L;

    private final Path workspaceReal;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String token = randomHex(32);
    private final Map<Path, ReentrantLock> fileLocks = new ConcurrentHashMap<>();

    private HttpServer server;
    private ExecutorService executor;
    private String baseUrl;

    WorkspaceFileBridge(Path workspace) throws IOException {
        this(workspace, false);
    }

    WorkspaceFileBridge(Path workspace, boolean requireSecureFileAccess) throws IOException {
        if (workspace == null) {
            throw new IllegalArgumentException("Workspace is required");
        }
        this.workspaceReal = workspace.toAbsolutePath().normalize().toRealPath();
        if (requireSecureFileAccess
            && !WorkspaceSecureFile.secureDirectoryStreamsAvailable(workspaceReal)) {
            throw new IOException(
                "secure directory streams are required in sandbox mode");
        }
    }

    synchronized void start() throws IOException {
        if (server != null) {
            return;
        }
        HttpServer created = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        ExecutorService createdExecutor = Executors.newFixedThreadPool(2, runnable -> {
            Thread thread = new Thread(runnable, "workspace-file-bridge");
            thread.setDaemon(true);
            return thread;
        });
        created.createContext("/read", this::handleRead);
        created.createContext("/grep", this::handleGrep);
        created.createContext("/write", this::handleWrite);
        created.createContext("/edit", this::handleEdit);
        created.setExecutor(createdExecutor);
        created.start();
        this.server = created;
        this.executor = createdExecutor;
        this.baseUrl = "http://127.0.0.1:" + created.getAddress().getPort();
    }

    String baseUrl() {
        return baseUrl;
    }

    String token() {
        return token;
    }

    @Override
    public synchronized void close() {
        HttpServer running = server;
        server = null;
        baseUrl = null;
        if (running != null) {
            running.stop(0);
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private void handleRead(HttpExchange exchange) throws IOException {
        try {
            if (!authorized(exchange)) {
                return;
            }
            JsonNode root = readJson(exchange, MAX_BODY_BYTES);
            if (root == null) {
                return;
            }
            try {
                Path file = WorkspacePathPolicy.resolveReadable(
                    workspaceReal, root.path("path").asText(""));
                if (!Files.isRegularFile(file, LinkOption.NOFOLLOW_LINKS)) {
                    throw new IOException("not a regular file");
                }
                if (Files.size(file) > MAX_READ_FILE_BYTES) {
                    throw new IOException("file is too large to read");
                }
                int offset = Math.max(1, root.path("offset").asInt(1));
                int limit = root.path("limit").asInt(DEFAULT_READ_LINES);
                if (limit <= 0) {
                    limit = DEFAULT_READ_LINES;
                }
                sendText(exchange, 200, readLines(file, offset,
                    Math.min(limit, DEFAULT_READ_LINES)));
            } catch (IOException e) {
                sendJson(exchange, 403, Map.of("error", safeMessage(e)));
            }
        } catch (RuntimeException e) {
            sendJson(exchange, 500, Map.of("error", "read failed: " + safeMessage(e)));
        } finally {
            exchange.close();
        }
    }

    private void handleGrep(HttpExchange exchange) throws IOException {
        try {
            if (!authorized(exchange)) {
                return;
            }
            JsonNode root = readJson(exchange, MAX_BODY_BYTES);
            if (root == null) {
                return;
            }
            String expression = root.path("pattern").asText("");
            if (expression.isBlank()) {
                sendJson(exchange, 400, Map.of("error", "pattern is required"));
                return;
            }
            Pattern pattern;
            try {
                pattern = Pattern.compile(expression);
            } catch (PatternSyntaxException e) {
                sendJson(exchange, 400, Map.of("error", "invalid regular expression"));
                return;
            }
            try {
                Path searchRoot = WorkspacePathPolicy.resolveReadable(
                    workspaceReal, root.path("path").asText("."));
                String include = root.path("include").asText("");
                int max = root.path("maxResults").asInt(MAX_GREP_MATCHES);
                if (max <= 0) {
                    max = MAX_GREP_MATCHES;
                }
                sendText(exchange, 200, grep(searchRoot, pattern, include,
                    Math.min(max, MAX_GREP_MATCHES)));
            } catch (IOException e) {
                sendJson(exchange, 403, Map.of("error", safeMessage(e)));
            }
        } catch (RuntimeException e) {
            sendJson(exchange, 500, Map.of("error", "grep failed: " + safeMessage(e)));
        } finally {
            exchange.close();
        }
    }

    private void handleWrite(HttpExchange exchange) throws IOException {
        try {
            if (!authorized(exchange)) {
                return;
            }
            JsonNode root = readJson(exchange, MAX_WRITE_BYTES);
            if (root == null) {
                return;
            }
            if (!root.has("content") || !root.path("content").isTextual()) {
                sendJson(exchange, 400, Map.of("error", "content is required"));
                return;
            }
            String content = root.path("content").asText();
            byte[] payload = content.getBytes(StandardCharsets.UTF_8);
            if (payload.length > MAX_WRITE_BYTES) {
                sendJson(exchange, 413, Map.of("error", "write exceeds " + MAX_WRITE_BYTES + " bytes"));
                return;
            }
            try {
                Path target = WorkspacePathPolicy.resolveWritable(
                    workspaceReal, root.path("path").asText(""));
                if (!tryLockFile(target)) {
                    sendJson(exchange, 409,
                        Map.of("error", "file is busy; retry the write"));
                    return;
                }
                try {
                    WorkspaceSecureFile.writeString(workspaceReal, target, content, true);
                    sendText(exchange, 200, "Wrote " + payload.length + " bytes to "
                        + workspaceReal.relativize(target).toString().replace('\\', '/'));
                } finally {
                    unlockFile(target);
                }
            } catch (IOException e) {
                sendJson(exchange, 403, Map.of("error", safeMessage(e)));
            }
        } catch (RuntimeException e) {
            sendJson(exchange, 500, Map.of("error", "write failed: " + safeMessage(e)));
        } finally {
            exchange.close();
        }
    }

    private void handleEdit(HttpExchange exchange) throws IOException {
        try {
            if (!authorized(exchange)) {
                return;
            }
            JsonNode root = readJson(exchange, MAX_WRITE_BYTES);
            if (root == null) {
                return;
            }
            String rawOldString = root.path("oldString").asText("");
            if (rawOldString.isEmpty()) {
                sendJson(exchange, 400, Map.of("error", "oldString is required"));
                return;
            }
            if (!root.has("newString") || !root.path("newString").isTextual()) {
                sendJson(exchange, 400, Map.of("error", "newString is required"));
                return;
            }
            String rawNewString = root.path("newString").asText();
            boolean replaceAll = root.path("replaceAll").asBoolean(false);
            try {
                Path target = WorkspacePathPolicy.resolveWritable(
                    workspaceReal, root.path("path").asText(""));
                if (!tryLockFile(target)) {
                    sendJson(exchange, 409,
                        Map.of("error", "file is busy; retry the edit"));
                    return;
                }
                try {
                try (SeekableByteChannel channel =
                         WorkspaceSecureFile.openReadWrite(workspaceReal, target)) {
                    long size = channel.size();
                    if (size > MAX_READ_FILE_BYTES) {
                        throw new IOException("file is too large to edit");
                    }
                    ByteBuffer buffer = ByteBuffer.allocate((int) size);
                    while (buffer.hasRemaining()) {
                        int read = channel.read(buffer);
                        if (read < 0) {
                            break;
                        }
                    }
                    String raw = WorkspaceSecureFile.decodeUtf8(buffer.array());
                    boolean bom = raw.startsWith("\uFEFF");
                    String body = bom ? raw.substring(1) : raw;
                    boolean crlf = body.contains("\r\n");
                    String normalized = normalizeNewlines(body, crlf);
                    String oldString = normalizeNewlines(rawOldString, crlf);
                    String newString = normalizeNewlines(rawNewString, crlf);
                    if (oldString.isEmpty()) {
                        sendJson(exchange, 400, Map.of("error", "oldString is required"));
                        return;
                    }

                    int occurrences = countOccurrences(normalized, oldString);
                    if (occurrences == 0) {
                        sendJson(exchange, 400, Map.of("error", "oldString not found"));
                        return;
                    }
                    if (occurrences > 1 && !replaceAll) {
                        sendJson(exchange, 400,
                            Map.of("error", "oldString is not unique; set replaceAll"));
                        return;
                    }
                    long projected = normalized.length()
                        - (long) occurrences * oldString.length()
                        + (long) occurrences * newString.length();
                    if (projected > MAX_WRITE_BYTES || projected < 0) {
                        sendJson(exchange, 413,
                            Map.of("error", "write exceeds " + MAX_WRITE_BYTES + " bytes"));
                        return;
                    }

                    String updatedNormalized = replaceAll
                        ? normalized.replace(oldString, newString)
                        : normalized.substring(0, normalized.indexOf(oldString))
                            + newString
                            + normalized.substring(
                                normalized.indexOf(oldString) + oldString.length());
                    String updatedBody = restoreNewlines(updatedNormalized, crlf);
                    String updated = bom ? "\uFEFF" + updatedBody : updatedBody;
                    byte[] payload = updated.getBytes(StandardCharsets.UTF_8);
                    if (payload.length > MAX_WRITE_BYTES) {
                        sendJson(exchange, 413,
                            Map.of("error", "write exceeds " + MAX_WRITE_BYTES + " bytes"));
                        return;
                    }
                    channel.truncate(0);
                    channel.position(0);
                    WorkspaceSecureFile.writeFully(channel, payload);
                }
                } finally {
                    unlockFile(target);
                }
                sendText(exchange, 200, "Edited "
                    + workspaceReal.relativize(target).toString().replace('\\', '/'));
            } catch (CharacterCodingException e) {
                sendJson(exchange, 403, Map.of("error", "file is not valid UTF-8 text"));
            } catch (IOException e) {
                sendJson(exchange, 403, Map.of("error", safeMessage(e)));
            }
        } catch (RuntimeException e) {
            sendJson(exchange, 500, Map.of("error", "edit failed: " + safeMessage(e)));
        } finally {
            exchange.close();
        }
    }

    private static String normalizeNewlines(String value, boolean crlf) {
        return crlf ? value.replace("\r\n", "\n") : value;
    }

    private static String restoreNewlines(String value, boolean crlf) {
        return crlf ? value.replace("\n", "\r\n") : value;
    }

    private static int countOccurrences(String content, String needle) {
        if (needle.isEmpty()) {
            return 0;
        }
        int count = 0;
        int index = 0;
        while ((index = content.indexOf(needle, index)) >= 0) {
            count++;
            index += needle.length();
        }
        return count;
    }

    private String readLines(Path file, int offset, int limit) throws IOException {
        StringBuilder out = new StringBuilder();
        int lineNumber = 0;
        int shown = 0;
        try (BufferedReader reader = WorkspaceSecureFile.newBufferedReader(workspaceReal, file)) {
            String line;
            while ((line = reader.readLine()) != null) {
                lineNumber++;
                if (lineNumber < offset) {
                    continue;
                }
                if (shown >= limit) {
                    appendNote(out, "(truncated at " + limit + " lines)");
                    break;
                }
                String formatted = lineNumber + ": " + line;
                if (out.length() + formatted.length() + 1 > MAX_READ_BYTES) {
                    appendNote(out, "(truncated at " + MAX_READ_BYTES + " bytes)");
                    break;
                }
                if (out.length() > 0) {
                    out.append('\n');
                }
                out.append(formatted);
                shown++;
            }
        } catch (CharacterCodingException e) {
            throw new IOException("file is not valid UTF-8 text");
        }
        if (lineNumber == 0) {
            return "(empty file)";
        }
        if (out.length() == 0) {
            return "(no lines at offset " + offset + ")";
        }
        return out.toString();
    }

    private String grep(Path root, Pattern pattern, String include, int maxMatches)
        throws IOException {
        List<String> matches = new ArrayList<>();
        boolean[] truncated = {false};
        int[] visited = {0};
        long[] scannedBytes = {0};
        PathMatcher matcher = include == null || include.isBlank()
            ? null
            : root.getFileSystem().getPathMatcher("glob:" + include);

        if (Files.isRegularFile(root, LinkOption.NOFOLLOW_LINKS)) {
            searchFile(root, pattern, maxMatches, matches, truncated);
        } else if (Files.isDirectory(root, LinkOption.NOFOLLOW_LINKS)) {
            Files.walkFileTree(root, EnumSet.noneOf(FileVisitOption.class), Integer.MAX_VALUE,
                new FileVisitor<Path>() {
                    @Override
                    public FileVisitResult preVisitDirectory(
                        Path dir, BasicFileAttributes attrs
                    ) {
                        if (!dir.equals(root)
                            && WorkspacePathPolicy.isIgnoredDirectory(
                                dir.getFileName().toString())) {
                            return FileVisitResult.SKIP_SUBTREE;
                        }
                        return truncated[0]
                            ? FileVisitResult.TERMINATE
                            : FileVisitResult.CONTINUE;
                    }

                    @Override
                    public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                        if (truncated[0]) {
                            return FileVisitResult.TERMINATE;
                        }
                        if (!attrs.isRegularFile() || attrs.isSymbolicLink()
                            || attrs.size() > MAX_GREP_FILE_BYTES) {
                            return FileVisitResult.CONTINUE;
                        }
                        if (visited[0]++ >= MAX_GREP_FILES
                            || scannedBytes[0] + attrs.size() > MAX_GREP_TOTAL_BYTES) {
                            truncated[0] = true;
                            return FileVisitResult.TERMINATE;
                        }
                        scannedBytes[0] += attrs.size();
                        Path relative = workspaceReal.relativize(file);
                        if (WorkspacePathPolicy.isDenied(workspaceReal, file)) {
                            return FileVisitResult.CONTINUE;
                        }
                        if (matcher != null
                            && !matcher.matches(relative)
                            && !matcher.matches(relative.getFileName())) {
                            return FileVisitResult.CONTINUE;
                        }
                        searchFile(file, pattern, maxMatches, matches, truncated);
                        return truncated[0]
                            ? FileVisitResult.TERMINATE
                            : FileVisitResult.CONTINUE;
                    }

                    @Override
                    public FileVisitResult visitFileFailed(Path file, IOException exc) {
                        return FileVisitResult.CONTINUE;
                    }

                    @Override
                    public FileVisitResult postVisitDirectory(Path dir, IOException exc) {
                        return truncated[0]
                            ? FileVisitResult.TERMINATE
                            : FileVisitResult.CONTINUE;
                    }
                });
        } else {
            throw new IOException("not a file or directory");
        }

        if (matches.isEmpty()) {
            return "No matches.";
        }
        StringBuilder out = new StringBuilder(String.join("\n", matches));
        if (truncated[0]) {
            out.append("\n(truncated at ").append(maxMatches).append(" matches)");
        }
        return out.toString();
    }

    private void searchFile(
        Path file,
        Pattern pattern,
        int maxMatches,
        List<String> matches,
        boolean[] truncated
    ) {
        Path relative = workspaceReal.relativize(file);
        String display = relative.toString().replace('\\', '/');
        try (BufferedReader reader = WorkspaceSecureFile.newBufferedReader(workspaceReal, file)) {
            String line;
            int lineNumber = 0;
            while ((line = reader.readLine()) != null) {
                lineNumber++;
                if (pattern.matcher(line).find()) {
                    if (matches.size() >= maxMatches) {
                        truncated[0] = true;
                        return;
                    }
                    String shown = line.length() > MAX_GREP_LINE_CHARS
                        ? line.substring(0, MAX_GREP_LINE_CHARS) + "..."
                        : line;
                    matches.add(display + ":" + lineNumber + ": " + shown);
                }
            }
        } catch (CharacterCodingException e) {
            // Binary/invalid UTF-8 files are not searchable text.
        } catch (IOException e) {
            // A single unreadable file must not abort the whole search.
        }
    }

    private boolean tryLockFile(Path target) throws IOException {
        ReentrantLock lock = fileLocks.computeIfAbsent(
            target.toAbsolutePath().normalize(), key -> new ReentrantLock());
        try {
            return lock.tryLock(FILE_LOCK_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted while waiting for the file lock");
        }
    }

    private void unlockFile(Path target) {
        ReentrantLock lock = fileLocks.get(target.toAbsolutePath().normalize());
        if (lock != null && lock.isHeldByCurrentThread()) {
            lock.unlock();
        }
    }

    boolean tryLockForTesting(Path target) throws IOException {
        return tryLockFile(target);
    }

    void unlockForTesting(Path target) {
        unlockFile(target);
    }

    private boolean authorized(HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendJson(exchange, 405, Map.of("error", "POST required"));
            return false;
        }
        if (!tokenMatches(exchange.getRequestHeaders().getFirst(TOKEN_HEADER))) {
            sendJson(exchange, 401, Map.of("error", "invalid workspace bridge token"));
            return false;
        }
        return true;
    }

    private JsonNode readJson(HttpExchange exchange, int maxBytes) throws IOException {
        String body;
        try {
            body = readBody(exchange.getRequestBody(), maxBytes);
        } catch (IOException e) {
            sendJson(exchange, 413, Map.of("error", e.getMessage()));
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(body);
            return root == null ? objectMapper.createObjectNode() : root;
        } catch (IOException e) {
            sendJson(exchange, 400, Map.of("error", "invalid JSON body"));
            return null;
        }
    }

    private String readBody(InputStream input, int maxBytes) throws IOException {
        byte[] bytes = input.readNBytes(maxBytes + 1);
        if (bytes.length > maxBytes) {
            throw new IOException("request body exceeds " + maxBytes + " bytes");
        }
        return new String(bytes, StandardCharsets.UTF_8);
    }

    private void sendText(HttpExchange exchange, int status, String body) throws IOException {
        byte[] payload = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
    }

    private void sendJson(HttpExchange exchange, int status, Map<String, ?> body)
        throws IOException {
        byte[] payload = objectMapper.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
    }

    private boolean tokenMatches(String provided) {
        if (provided == null) {
            return false;
        }
        return MessageDigest.isEqual(
            provided.getBytes(StandardCharsets.UTF_8),
            token.getBytes(StandardCharsets.UTF_8));
    }

    private static void appendNote(StringBuilder out, String note) {
        if (out.length() > 0) {
            out.append('\n');
        }
        out.append(note);
    }

    private static String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        new SecureRandom().nextBytes(value);
        StringBuilder builder = new StringBuilder(bytes * 2);
        for (byte b : value) {
            builder.append(String.format("%02x", b));
        }
        return builder.toString();
    }

    private static String safeMessage(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }
}
