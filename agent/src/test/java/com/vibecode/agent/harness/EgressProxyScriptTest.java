package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the allowlist checks in the Node egress proxy without Docker.
 * The script is also exercised end-to-end by the opt-in integration suite.
 */
class EgressProxyScriptTest {

    private static Path script;

    @BeforeAll
    static void locateScript() {
        script = Path.of("src/main/resources/sandbox/egress-proxy.js");
        Assumptions.assumeTrue(Files.isRegularFile(script),
            "egress proxy resource is not on the test path");
        Assumptions.assumeTrue(nodeAvailable(), "node is required for the proxy script test");
    }

    @Test
    void allowsAnExactHost() throws Exception {
        Result result = check("registry.npmjs.org:443");
        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("ALLOW"), result.output);
    }

    @Test
    void allowsAWildcardSubdomain() throws Exception {
        Result result = check("raw.githubusercontent.com:443");
        assertEquals(0, result.exitCode, result.output);
    }

    @Test
    void wildcardDoesNotMatchTheApex() throws Exception {
        assertDenied("githubusercontent.com:443");
    }

    @Test
    void deniesHostsOutsideTheAllowlist() throws Exception {
        assertDenied("example.org:443");
    }

    @Test
    void deniesLocalhostMetadataAndPrivateAddresses() throws Exception {
        assertDenied("localhost:443");
        assertDenied("169.254.169.254:80");
        assertDenied("10.0.0.1:443");
        assertDenied("127.0.0.1:443");
        assertDenied("metadata.google.internal:80");
    }

    @Test
    void deniesUnapprovedPorts() throws Exception {
        assertDenied("registry.npmjs.org:22");
        assertDenied("registry.npmjs.org:8080");
    }

    @Test
    void allowsAPublicHostAfterResolution() throws Exception {
        Result result = checkResolve("registry.npmjs.org");
        Assumptions.assumeFalse(result.output.contains("dns lookup failed"),
            "DNS is unavailable in this environment");
        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("ALLOW"), result.output);
    }

    @Test
    void blocksHostnamesThatResolveToLoopbackOrMetadata() throws Exception {
        Result loopback = checkResolve("localtest.me");
        Assumptions.assumeFalse(loopback.output.contains("dns lookup failed"),
            "DNS is unavailable in this environment");
        assertEquals(1, loopback.exitCode, loopback.output);
        assertTrue(loopback.output.contains("private"), loopback.output);

        Result metadata = checkResolve("169.254.169.254.nip.io");
        Assumptions.assumeFalse(metadata.output.contains("dns lookup failed"),
            "DNS is unavailable in this environment");
        assertEquals(1, metadata.exitCode, metadata.output);
    }

    private void assertDenied(String target) throws Exception {
        Result result = check(target);
        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("DENY"), result.output);
    }

    private Result check(String target) throws Exception {
        return run("--check-allow", target);
    }

    private Result checkResolve(String target) throws Exception {
        return run("--check-resolve", target);
    }

    private Result run(String mode, String target) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(
            List.of("node", script.toString(), mode, target));
        builder.environment().put("EGRESS_ALLOWED_HOSTS",
            "registry.npmjs.org,*.githubusercontent.com,"
                + "localtest.me,169.254.169.254.nip.io");
        builder.redirectErrorStream(true);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        return new Result(exit, output);
    }

    private static boolean nodeAvailable() {
        try {
            Process process = new ProcessBuilder("node", "--version")
                .redirectErrorStream(true)
                .start();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private record Result(int exitCode, String output) {
    }
}
