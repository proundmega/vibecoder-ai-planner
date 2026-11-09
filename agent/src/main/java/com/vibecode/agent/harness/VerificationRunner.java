package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.InputStream;
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
    private static final SecretRedactor REDACTOR = SecretRedactor.patternsOnly();

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
        // Without a lockfile, npm install would create/modify package-lock.json
        // and the supervisor would publish it. Keep installs out of the diff.
        String install = hasLock
            ? "npm ci --no-audit --no-fund"
            : "npm install --no-package-lock --no-audit --no-fund";
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
        long budgetMs = timeout == null ? 600_000L : Math.max(1, timeout.toMillis());
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs);
        for (String command : commands) {
            if (command == null || command.isBlank()) {
                continue;
            }
            long remainingMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remainingMs <= 0) {
                results.add(new VerificationResult(
                    command.trim(), -1, "verification budget exhausted", true));
                continue;
            }
            results.add(runOne(workspace, command.trim(), Duration.ofMillis(remainingMs)));
        }
        return results;
    }

    /**
     * Run verification commands through an explicit sandbox.
     *
     * <p>This is the production path when {@code SANDBOX_MODE=docker}; the host
     * overload above remains the Phase 1 compatibility path.</p>
     */
    public List<VerificationResult> run(
        SandboxRunner sandbox,
        SandboxHandle handle,
        List<String> commands,
        Duration timeout
    ) {
        List<VerificationResult> results = new ArrayList<>();
        if (commands == null || sandbox == null || handle == null) {
            return results;
        }
        long budgetMs = timeout == null ? 600_000L : Math.max(1, timeout.toMillis());
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(budgetMs);
        for (String command : commands) {
            if (command == null || command.isBlank()) {
                continue;
            }
            long remainingMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
            if (remainingMs <= 0) {
                results.add(new VerificationResult(
                    command.trim(), -1, "verification budget exhausted", true));
                continue;
            }
            String trimmed = command.trim();
            try {
                ExecResult result = sandbox.exec(handle, new ExecRequest(
                    trimmed,
                    null,
                    Duration.ofMillis(remainingMs),
                    MAX_CAPTURE_BYTES,
                    Map.of()
                ));
                results.add(new VerificationResult(
                    trimmed,
                    result.exitCode(),
                    truncateOutput(result.output()),
                    result.timedOut()
                ));
            } catch (IOException e) {
                results.add(new VerificationResult(
                    trimmed, -1, redactedMessage(e), false));
            }
        }
        return results;
    }

    private static String truncateOutput(String text) {
        String value = text == null ? "" : text;
        // Redact before truncating so a credential that straddles the tail
        // boundary is not partially exposed.
        value = REDACTOR.redact(value);
        return value.length() > MAX_OUTPUT_CHARS
            ? value.substring(value.length() - MAX_OUTPUT_CHARS)
            : value;
    }

    private static String redactedMessage(Throwable failure) {
        return REDACTOR.redact(failure == null ? "" : failure.getMessage());
    }

    private VerificationResult runOne(Path workspace, String command, Duration timeout) {
        boolean windows = System.getProperty("os.name", "").toLowerCase().contains("win");
        List<String> processCommand = windows
            ? List.of("cmd.exe", "/c", command)
            : List.of("sh", "-c", command);
        ProcessBuilder builder = new ProcessBuilder(ProcessGroup.wrap(processCommand));
        builder.directory(workspace.toFile());
        builder.redirectErrorStream(true);
        sanitizeEnvironment(builder.environment());

        Process process = null;
        try {
            process = builder.start();
            BoundedTailBuffer output = new BoundedTailBuffer(MAX_CAPTURE_BYTES);
            Process finalProcess = process;
            Thread reader = new Thread(() -> {
                try (InputStream input = finalProcess.getInputStream()) {
                    input.transferTo(output);
                } catch (IOException e) {
                    log.debug("Verification output reader stopped: {}", redactedMessage(e));
                }
            }, "verify-output");
            reader.setDaemon(true);
            reader.start();

            long timeoutMs = timeout == null ? 600_000L : Math.max(1, timeout.toMillis());
            boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            int exitCode = finished ? process.exitValue() : -1;

            // Even a normally-exiting command can leave background children
            // behind. Kill the whole group before joining the reader: a
            // background child may hold the output pipe open for its lifetime.
            ProcessGroup.kill(process);
            reader.join(5_000);

            String text = output.text();
            return new VerificationResult(
                command,
                exitCode,
                truncateOutput(text),
                !finished
            );
        } catch (IOException e) {
            // An exception message is another capture path; never let it bypass
            // the same redaction as the normal output.
            return new VerificationResult(command, -1, redactedMessage(e), false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (process != null) {
                ProcessGroup.kill(process);
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
}
