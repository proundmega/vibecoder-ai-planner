package com.vibecode.agent.harness;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Guards the fg-39 FR4 / D11 real-Docker cache smoke script.
 *
 * <p>The script is operator-run (it needs Docker and, for the first Maven
 * run, Maven Central), so this test validates the script syntax and keeps its
 * mount/env contract aligned with {@link CachePlan}. The real evidence comes
 * from running it against the stack images.</p>
 */
class SandboxCacheSmokeScriptTest {

    private static final Path SCRIPT = Path.of(
        System.getProperty("basedir", "."),
        "scripts",
        "smoke-sandbox-caches.sh").toAbsolutePath();

    @BeforeEach
    void requireBash() {
        assumeTrue(bashAvailable(), "bash is not available on this platform");
    }

    @Test
    void isSyntacticallyValid() throws Exception {
        Process process = new ProcessBuilder("bash", "-n", SCRIPT.toString())
            .redirectErrorStream(true)
            .start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        assertEquals(0, process.waitFor(), output);
    }

    @Test
    void exercisesEveryPersistentCacheContract() throws IOException {
        String script = Files.readString(SCRIPT);

        assertTrue(script.contains("NPM_CONFIG_CACHE=/cache/npm"), script);
        assertTrue(script.contains("MAVEN_OPTS=-Dmaven.repo.local=/cache/maven"), script);
        assertTrue(script.contains("GOMODCACHE=/cache/go/mod"), script);
        assertTrue(script.contains("GOCACHE=/cache/go/build"), script);

        assertTrue(script.contains("npm install --offline"), script);
        assertTrue(script.contains("mvn -q -B -o test"), script);
        assertTrue(script.contains("run_go none off go test ./..."), script);

        assertTrue(script.contains("--network \"$network\""), script);
        assertTrue(script.contains("--user 1000:1000"), script);
        assertTrue(script.contains("--target \"$target\""), script);
    }

    @Test
    void documentsTheNetworkBoundary() throws IOException {
        String script = Files.readString(SCRIPT);
        assertTrue(script.contains("public Maven Central"), script);
        assertTrue(script.contains("reuse run uses --network none"), script);
    }

    private static boolean bashAvailable() {
        try {
            Process process = new ProcessBuilder("bash", "-c", "exit 0")
                .redirectErrorStream(true)
                .start();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }
}
