package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class VerificationRunnerTest {

    @TempDir
    Path tempDir;

    private static boolean windows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    @Test
    void runsPassingCommandAndReportsExitZero() {
        List<VerificationResult> results = new VerificationRunner()
            .run(tempDir, List.of("echo hello"), Duration.ofSeconds(20));

        assertEquals(1, results.size());
        assertTrue(results.get(0).passed());
        assertEquals(0, results.get(0).exitCode());
        assertTrue(results.get(0).output().contains("hello"));
    }

    @Test
    void reportsNonZeroExitAndCapturesOutput() {
        List<VerificationResult> results = new VerificationRunner()
            .run(tempDir, List.of("exit 3"), Duration.ofSeconds(20));

        assertEquals(1, results.size());
        assertFalse(results.get(0).passed());
        assertEquals(3, results.get(0).exitCode());
    }

    @Test
    void killsCommandThatExceedsTimeout() {
        String command = windows() ? "ping -n 10 127.0.0.1 >nul" : "sleep 5";
        long started = System.currentTimeMillis();

        List<VerificationResult> results = new VerificationRunner()
            .run(tempDir, List.of(command), Duration.ofMillis(500));

        long elapsed = System.currentTimeMillis() - started;
        assertEquals(1, results.size());
        assertTrue(results.get(0).timedOut());
        assertFalse(results.get(0).passed());
        assertTrue(elapsed < 4_000, "Command should be killed quickly, took " + elapsed + "ms");
    }

    @Test
    void truncatesOutputToLast8192Chars() throws IOException {
        Path overflow = tempDir.resolve("overflow.txt");
        Files.writeString(overflow, "x".repeat(20_000));

        String command = windows() ? "type overflow.txt" : "cat overflow.txt";
        List<VerificationResult> results = new VerificationRunner()
            .run(tempDir, List.of(command), Duration.ofSeconds(20));

        assertEquals(1, results.size());
        assertTrue(results.get(0).passed());
        assertEquals(8_192, results.get(0).output().length());
    }

    @Test
    void resolvesNodeScriptsFromPackageJson() throws IOException {
        Files.writeString(tempDir.resolve("package.json"), """
            {
              "scripts": {
                "test": "vitest",
                "lint": "eslint .",
                "typecheck": "vue-tsc --noEmit"
              }
            }
            """);

        List<String> commands = new VerificationRunner().resolveCommands(tempDir);

        assertEquals(List.of("npm test -- --run", "npm run lint", "npm run typecheck"), commands);
    }

    @Test
    void resolvesBackendAndFrontendPackagesInMonorepo() throws IOException {
        java.nio.file.Files.createDirectories(tempDir.resolve("backend"));
        java.nio.file.Files.createDirectories(tempDir.resolve("frontend"));
        Files.writeString(tempDir.resolve("backend/package.json"),
            "{\"scripts\":{\"test\":\"jest\",\"lint\":\"eslint .\"}}");
        Files.writeString(tempDir.resolve("frontend/package.json"),
            "{\"scripts\":{\"test\":\"vitest\",\"typecheck\":\"vue-tsc --noEmit\"}}");

        List<String> commands = new VerificationRunner().resolveCommands(tempDir);

        assertEquals(List.of(
            "cd backend && npm test",
            "cd backend && npm run lint",
            "cd frontend && npm test -- --run",
            "cd frontend && npm run typecheck"
        ), commands);
    }

    @Test
    void resolvesMavenCommandFromPom() throws IOException {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>");

        List<String> commands = new VerificationRunner().resolveCommands(tempDir);

        assertEquals(List.of("mvn test -q"), commands);
    }

    @Test
    void resolvesNpmCiInstallCommandsForNodePackages() throws IOException {
        Files.createDirectories(tempDir.resolve("backend"));
        Files.createDirectories(tempDir.resolve("frontend"));
        Files.writeString(tempDir.resolve("backend/package.json"), "{\"scripts\":{\"test\":\"jest\"}}");
        Files.writeString(tempDir.resolve("backend/package-lock.json"), "{}");
        Files.writeString(tempDir.resolve("frontend/package.json"), "{\"scripts\":{\"test\":\"vitest\"}}");

        List<String> commands = new VerificationRunner().resolveInstallCommands(tempDir);

        assertEquals(List.of(
            "cd backend && npm ci --no-audit --no-fund",
            "cd frontend && npm install --no-package-lock --no-audit --no-fund"
        ), commands);
    }

    @Test
    void explicitVerificationCommandsDisableAutomaticInstall() throws IOException {
        Files.writeString(tempDir.resolve("package.json"), "{\"scripts\":{\"test\":\"jest\"}}");
        HarnessConfig config = new HarnessConfig(
            "opencode", "opencode", Duration.ofSeconds(30), Duration.ofSeconds(30),
            Duration.ofMinutes(45), List.of("make verify"), List.of(".env*"), null);

        VerificationRunner runner = new VerificationRunner(config);

        assertEquals(List.of(), runner.resolveInstallCommands(tempDir));
        assertEquals(List.of("make verify"), runner.resolveCommands(tempDir));
    }

    @Test
    void killsBackgroundDescendantsAfterASuccessfulCommand() throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(
            ProcessGroup.isGroupIsolationAvailable(),
            "Process-group isolation (setsid) is unavailable on this platform");
        java.nio.file.Path marker = tempDir.resolve("background-marker");

        String command = windows()
            ? "start /b cmd /c \"ping -n 3 127.0.0.1 >nul & echo ran > background-marker\""
            : "(sleep 2; touch '" + marker + "') &";
        List<VerificationResult> results = new VerificationRunner()
            .run(tempDir, List.of(command), Duration.ofSeconds(20));

        assertEquals(1, results.size());
        Thread.sleep(3_000);
        assertFalse(Files.exists(marker), "background child survived the verification command");
    }

    @Test
    void verificationEnvironmentIsAllowlisted() {
        java.util.Map<String, String> environment = new java.util.HashMap<>();
        environment.put("PATH", "/usr/bin");
        environment.put("HOME", "/home/agent");
        environment.put("GITHUB_TOKEN", "ghp_secret");
        environment.put("AGENT_API_KEY", "agent_secret");
        environment.put("DATABASE_URL", "postgres://user:pw@db/app");

        VerificationRunner.sanitizeEnvironment(environment);

        assertEquals("/usr/bin", environment.get("PATH"));
        assertEquals("/home/agent", environment.get("HOME"));
        assertFalse(environment.containsKey("GITHUB_TOKEN"));
        assertFalse(environment.containsKey("AGENT_API_KEY"));
        assertFalse(environment.containsKey("DATABASE_URL"));
        assertEquals("1", environment.get("CI"));
    }

    @Test
    void verificationChildCannotReadSupervisorSecrets() {
        String command = windows()
            ? "echo %GITHUB_TOKEN% %AGENT_API_KEY%"
            : "printf '%s %s' \"$GITHUB_TOKEN\" \"$AGENT_API_KEY\"";

        List<VerificationResult> results = new VerificationRunner()
            .run(tempDir, List.of(command), Duration.ofSeconds(20));

        assertEquals(1, results.size());
        assertEquals(" ", results.get(0).output());
    }

    @Test
    void configuredCommandsOverrideDetection() throws IOException {
        Files.writeString(tempDir.resolve("pom.xml"), "<project/>");
        HarnessConfig config = new HarnessConfig(
            "opencode", "opencode", Duration.ofSeconds(30), Duration.ofSeconds(30),
            Duration.ofMinutes(45), List.of("make verify"), List.of(".env*"), null);

        List<String> commands = new VerificationRunner(config).resolveCommands(tempDir);

        assertEquals(List.of("make verify"), commands);
    }
}
