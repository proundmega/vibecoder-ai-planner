package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Runs project verification commands and captures bounded output.
 */
public class VerificationRunner {

    private static final Logger log = LoggerFactory.getLogger(VerificationRunner.class);
    private static final int MAX_OUTPUT_CHARS = 8_192;

    private final HarnessConfig config;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public VerificationRunner(HarnessConfig config) {
        this.config = config;
    }

    public VerificationRunner() {
        this(null);
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

        Process process = null;
        try {
            process = builder.start();
            ByteArrayOutputStream output = new ByteArrayOutputStream();
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

            long timeoutMs = timeout == null ? 600_000L : timeout.toMillis();
            boolean finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS);
            if (!finished) {
                killProcessTree(process);
                process.waitFor(5, TimeUnit.SECONDS);
            }
            reader.join(5_000);

            String text = output.toString(StandardCharsets.UTF_8);
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
}
