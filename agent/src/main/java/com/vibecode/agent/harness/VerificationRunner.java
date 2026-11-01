package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Runs project verification commands and captures bounded output.
 *
 * <p>Verification commands come from the cloned (hostile) repository, or from
 * the supervisor's {@code HARNESS_VERIFY_COMMANDS}. Children therefore receive
 * only the allowlisted {@link EnvironmentSanitizer} environment and never the
 * supervisor's GitHub/provider/cloud credentials.</p>
 */
public class VerificationRunner {

    private static final Logger log = LoggerFactory.getLogger(VerificationRunner.class);
    private static final int MAX_OUTPUT_CHARS = 8_192;
    /**
     * Capture a little more than the advertised tail so cutting in the middle
     * of a UTF-8 sequence cannot shorten the visible output.
     */
    private static final int MAX_CAPTURE_BYTES = MAX_OUTPUT_CHARS * 4;

    private final HarnessConfig config;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VerificationRunner(HarnessConfig config) {
        this.config = config;
    }

    public VerificationRunner() {
        this(null);
    }

    /**
     * Resolve the dependency-install commands that must run before verification.
     * A fresh clone has no node_modules, so running {@code npm test} directly
     * fails for reasons unrelated to the ticket.
     *
     * <p>When the operator supplied explicit {@code HARNESS_VERIFY_COMMANDS},
     * they own the full sequence (including any installs).</p>
     */
    public List<String> resolveInstallCommands(Path workspace) throws IOException {
        if (config != null && config.verificationCommands() != null
            && !config.verificationCommands().isEmpty()) {
            return List.of();
        }
        if (workspace == null) {
            return List.of();
        }

        List<String> commands = new ArrayList<>();
        Path rootPackage = workspace.resolve("package.json");
        if (Files.isRegularFile(rootPackage)) {
            addNodeInstall(commands, workspace, null);
        } else {
            Path backend = workspace.resolve("backend/package.json");
            if (Files.isRegularFile(backend)) {
                addNodeInstall(commands, workspace.resolve("backend"), "backend");
            }
            Path frontend = workspace.resolve("frontend/package.json");
            if (Files.isRegularFile(frontend)) {
                addNodeInstall(commands, workspace.resolve("frontend"), "frontend");
            }
        }
        return commands;
    }

    private void addNodeInstall(List<String> commands, Path packageDir, String relative) {
        boolean hasLock = Files.isRegularFile(packageDir.resolve("package-lock.json"))
            || Files.isRegularFile(packageDir.resolve("npm-shrinkwrap.json"));
        String install = hasLock ? "npm ci --no-audit --no-fund" : "npm install --no-audit --no-fund";
        commands.add(relative == null ? install : "cd " + relative + " && " + install);
    }

    public List<String> resolveCommands(Path workspace) throws IOException {
        if (config != null && config.verificationCommands() != null
            && !config.verificationCommands().isEmpty()) {
            return config.verificationCommands();
        }
        if (workspace == null) {
            return List.of();
        }

        List<String> commands = new ArrayList<>();
        Path packageJson = workspace.resolve("package.json");
        if (Files.isRegularFile(packageJson)) {
            commands.addAll(nodeCommands(packageJson, null));
        }

        // Monorepo layout used by this project (and many Node apps): verify the
        // backend and frontend packages when they are not covered by a root
        // package.json test script.
        Path backendPackage = workspace.resolve("backend/package.json");
        if (!Files.isRegularFile(packageJson) && Files.isRegularFile(backendPackage)) {
            commands.addAll(nodeCommands(backendPackage, "backend"));
        }
        Path frontendPackage = workspace.resolve("frontend/package.json");
        if (!Files.isRegularFile(packageJson) && Files.isRegularFile(frontendPackage)) {
            commands.addAll(nodeCommands(frontendPackage, "frontend"));
        }

        if (Files.isRegularFile(workspace.resolve("pom.xml"))) {
            commands.add("mvn test -q");
        }

        Path makefile = workspace.resolve("Makefile");
        if (Files.isRegularFile(makefile) && hasMakeTestTarget(makefile)) {
            commands.add("make test");
        }

        return commands;
    }

    private List<String> nodeCommands(Path packageJson, String directory) throws IOException {
        List<String> commands = new ArrayList<>();
        JsonNode scripts;
        try {
            scripts = objectMapper.readTree(packageJson.toFile()).path("scripts");
        } catch (IOException e) {
            log.warn("Could not parse package.json at {}: {}", packageJson, e.getMessage());
            return commands;
        }
        if (!scripts.isObject()) {
            return commands;
        }

        String prefix = directory == null || directory.isBlank() ? "" : "cd " + directory + " && ";
        if (scripts.hasNonNull("test")) {
            String testScript = scripts.path("test").asText("");
            boolean watchMode = testScript.contains("vitest") && !testScript.contains("--run");
            commands.add(prefix + (watchMode ? "npm test -- --run" : "npm test"));
        }
        if (scripts.hasNonNull("lint")) {
            commands.add(prefix + "npm run lint");
        }
        if (scripts.hasNonNull("typecheck")) {
            commands.add(prefix + "npm run typecheck");
        }
        return commands;
    }

    private boolean hasMakeTestTarget(Path makefile) {
        try {
            return Files.readString(makefile).lines().anyMatch(line -> line.matches("^test\\s*:.*"));
        } catch (IOException e) {
            return false;
        }
    }

    public List<VerificationResult> run(Path workspace, List<String> commands, Duration timeout) {
        List<VerificationResult> results = new ArrayList<>();
        if (commands == null || workspace == null) {
            return results;
        }
        for (String command : commands) {
            if (command == null || command.isBlank()) {
                continue;
            }
            results.add(runOne(workspace, command.trim(), timeout));
        }
        return results;
    }

    private VerificationResult runOne(Path workspace, String command, Duration timeout) {
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        ProcessBuilder builder = windows
            ? new ProcessBuilder("cmd.exe", "/c", command)
            : new ProcessBuilder("sh", "-c", command);
        builder.directory(workspace.toFile());
        builder.redirectErrorStream(true);
        sanitizeEnvironment(builder.environment());

        Process process = null;
        try {
            process = builder.start();
            TailBuffer output = new TailBuffer(MAX_CAPTURE_BYTES);
            Process finalProcess = process;
            Thread reader = new Thread(() -> {
                try (InputStream input = finalProcess.getInputStream()) {
                    input.transferTo(output);
                } catch (IOException e) {
                    log.debug("Verification output reader stopped: {}", e.getMessage());
                }
            }, "verify-output");
            reader.setDaemon(true);
            reader.start();

            long timeoutMs = timeout == null ? 600_000L : Math.max(1, timeout.toMillis());
            boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!finished) {
                killProcessTree(process);
                process.waitFor(5, TimeUnit.SECONDS);
            }
            reader.join(5_000);

            String text = output.text();
            if (text.length() > MAX_OUTPUT_CHARS) {
                text = text.substring(text.length() - MAX_OUTPUT_CHARS);
            }
            return new VerificationResult(
                command,
                finished ? process.exitValue() : -1,
                text,
                !finished
            );
        } catch (IOException e) {
            return new VerificationResult(command, -1, e.getMessage(), false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                killProcessTree(process);
            }
            return new VerificationResult(command, -1, "interrupted", false);
        }
    }

    /**
     * Package-visible for tests: the environment seen by verification children.
     */
    static void sanitizeEnvironment(Map<String, String> environment) {
        EnvironmentSanitizer.sanitize(environment);
        environment.putIfAbsent("CI", "1");
        environment.put("GIT_CONFIG_NOSYSTEM", "1");
        environment.put("GIT_CONFIG_GLOBAL", devNull());
        environment.put("GIT_TERMINAL_PROMPT", "0");
        environment.put("HARNESS_VERIFICATION", "1");
    }

    private static String devNull() {
        return System.getProperty("os.name", "").toLowerCase().contains("win") ? "NUL" : "/dev/null";
    }

    private static void killProcessTree(Process process) {
        try {
            process.descendants().forEach(handle -> {
                try {
                    handle.destroyForcibly();
                } catch (RuntimeException ignored) {
                    // Process already exited.
                }
            });
        } catch (RuntimeException ignored) {
            // Descendant enumeration is best effort.
        }
        process.destroyForcibly();
    }

    /**
     * Fixed-size ring buffer: a noisy or hostile test cannot grow the
     * supervisor's heap without bound.
     */
    private static final class TailBuffer extends OutputStream {
        private final byte[] buffer;
        private int size;
        private int writePosition;

        private TailBuffer(int capacity) {
            this.buffer = new byte[Math.max(1, capacity)];
        }

        @Override
        public synchronized void write(int value) {
            buffer[writePosition] = (byte) value;
            writePosition = (writePosition + 1) % buffer.length;
            if (size < buffer.length) {
                size++;
            }
        }

        @Override
        public synchronized void write(byte[] bytes, int offset, int length) {
            for (int i = 0; i < length; i++) {
                write(bytes[offset + i]);
            }
        }

        private synchronized String text() {
            byte[] ordered = new byte[size];
            int start = (writePosition - size + buffer.length) % buffer.length;
            for (int i = 0; i < size; i++) {
                ordered[i] = buffer[(start + i) % buffer.length];
            }
            return new String(ordered, StandardCharsets.UTF_8);
        }
    }
}
