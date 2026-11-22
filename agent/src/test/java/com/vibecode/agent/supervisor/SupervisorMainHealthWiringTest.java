package com.vibecode.agent.supervisor;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * fg-56: prove SupervisorMain.run stops at the startup health gate before it
 * opens the credential store, enrolls or declares runtimes.
 */
class SupervisorMainHealthWiringTest {

    @TempDir
    Path tempDir;

    @Test
    void runStopsAtTheHealthGateBeforeCredentialsOrDeclaration() throws Exception {
        List<String> requestPaths = new CopyOnWriteArrayList<>();
        HttpServer unhealthy = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        unhealthy.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            requestPaths.add(path);
            // Only /api/health is present and unhealthy. Any other request
            // (enrollment/declaration) proves startup advanced past the gate.
            exchange.sendResponseHeaders(path.equals("/api/health") ? 503 : 200, -1);
            exchange.close();
        });
        unhealthy.start();
        try {
            Path ini = tempDir.resolve("agent.ini");
            Files.writeString(ini, """
                [runtime "workers"]
                role = worker
                model = acme/model
                count = 1
                project = 1
                """);

            String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
            Path outputFile = tempDir.resolve("child.out");
            ProcessBuilder builder = new ProcessBuilder(
                java, "-cp", classpath(),
                SupervisorMainHarness.class.getName(), ini.toString());
            builder.redirectErrorStream(true);
            builder.redirectOutput(outputFile.toFile());
            builder.environment().put(
                "BACKEND_URL", "http://127.0.0.1:" + unhealthy.getAddress().getPort());
            builder.environment().put("ENROLLMENT_TOKEN", "test-enrollment-token");
            builder.environment().put(
                "AGENT_CREDENTIALS_FILE", tempDir.resolve("missing-credentials.json").toString());
            builder.environment().put("SUPERVISOR_HEALTH_REQUIRED", "true");
            builder.environment().put("SUPERVISOR_HEALTH_TIMEOUT_SECONDS", "1");
            builder.environment().put("SUPERVISOR_HEALTH_INTERVAL_SECONDS", "1");
            builder.environment().put("SUPERVISOR_HEALTH_MONITOR_ENABLED", "false");

            Process process = builder.start();
            boolean exited = process.waitFor(15, TimeUnit.SECONDS);
            if (!exited) process.destroyForcibly();
            String output = Files.exists(outputFile)
                ? Files.readString(outputFile, StandardCharsets.UTF_8)
                : "";

            assertTrue(exited, "SupervisorMain.run did not stop after the health timeout: " + output);
            assertNotEquals(0, process.exitValue(), output);
            assertTrue(output.contains("health gate timed out"),
                "expected the gate failure before any startup work: " + output);
            assertFalse(output.contains("No node credentials"),
                "startup reached credential handling before health passed: " + output);
            assertFalse(requestPaths.isEmpty(), "the fake backend received no health probe");
            assertTrue(requestPaths.stream().allMatch("/api/health"::equals),
                "startup made a non-health request before the gate passed: " + requestPaths);
        } finally {
            unhealthy.stop(0);
        }
    }

    private static String classpath() throws IOException {
        String current = System.getProperty("java.class.path");
        Path testClasses = Path.of("target", "test-classes");
        Path classes = Path.of("target", "classes");
        if (Files.isDirectory(testClasses) && !current.contains(testClasses.toString())) {
            return testClasses + java.io.File.pathSeparator + classes
                + java.io.File.pathSeparator + current;
        }
        return current;
    }
}
