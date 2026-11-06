package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HostSandboxRunnerTest {

    @TempDir
    Path tempDir;

    private static boolean windows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private HostSandboxRunner runner() throws IOException {
        return new HostSandboxRunner();
    }

    private SandboxHandle handle(HostSandboxRunner runner) throws IOException {
        SandboxConfig config = SandboxConfig.from(name -> null);
        return runner.create(config.specFor(tempDir));
    }

    @Test
    void runsCommandsInTheWorkspace() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle handle = handle(runner);

        ExecResult result = runner.exec(handle, ExecRequest.of("pwd", Duration.ofSeconds(20)));

        assertTrue(result.passed());
        assertEquals(tempDir.toRealPath().toString(), result.output().trim());
    }

    @Test
    void reportsNonZeroExit() throws IOException {
        HostSandboxRunner runner = runner();
        ExecResult result = runner.exec(handle(runner), ExecRequest.of("exit 3", Duration.ofSeconds(20)));

        assertFalse(result.passed());
        assertEquals(3, result.exitCode());
    }

    @Test
    void killsCommandsThatExceedTheTimeout() throws IOException {
        HostSandboxRunner runner = runner();
        String command = windows() ? "ping -n 10 127.0.0.1 >nul" : "sleep 5";
        long started = System.currentTimeMillis();

        ExecResult result = runner.exec(handle(runner),
            new ExecRequest(command, null, Duration.ofMillis(500), 8_192, Map.of()));

        long elapsed = System.currentTimeMillis() - started;
        assertTrue(result.timedOut());
        assertTrue(elapsed < 4_000, "Command should be killed quickly, took " + elapsed + "ms");
    }

    @Test
    void passesOnlyTheRequestedEnvironment() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle handle = handle(runner);

        ExecResult result = runner.exec(handle, ExecRequest.of(
            windows() ? "echo %FEATURE_FLAG%" : "printf '%s' \"$FEATURE_FLAG\"",
            Duration.ofSeconds(20),
            Map.of("FEATURE_FLAG", "on")
        ));

        assertTrue(result.passed());
        assertEquals("on", result.output().trim());
    }

    @Test
    void rejectsCwdEscapes() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle handle = handle(runner);

        assertThrows(IOException.class, () -> runner.exec(handle,
            new ExecRequest("echo nope", "../", Duration.ofSeconds(5), 1_024, Map.of())));
    }

    @Test
    void copiesFilesInsideTheWorkspaceOnly() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle handle = handle(runner);
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        runner.putFile(handle, local, "/workspace/nested/remote.txt");
        assertEquals("hello", Files.readString(tempDir.resolve("nested/remote.txt")));

        Path downloaded = tempDir.resolve("downloaded.txt");
        runner.getFile(handle, "/workspace/nested/remote.txt", downloaded);
        assertEquals("hello", Files.readString(downloaded));

        assertThrows(IOException.class, () -> runner.putFile(handle, local, "/etc/passwd"));
    }

    @Test
    void lifecycleIsANoOp() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle handle = handle(runner);

        runner.stop(handle);
        runner.destroy(handle);
        runner.close();

        // Nothing on disk is owned by the host runner.
        assertTrue(Files.isDirectory(tempDir));
    }

    @Test
    void rejectsAHandleFromAnotherRunner() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle dockerHandle = new SandboxHandle("docker", tempDir, false, null);

        assertThrows(IOException.class, () -> runner.exec(dockerHandle,
            ExecRequest.of("echo nope", Duration.ofSeconds(5))));
    }

    @Test
    void putFileRejectsNonRegularFiles() throws IOException {
        HostSandboxRunner runner = runner();
        SandboxHandle handle = handle(runner);
        Path directory = Files.createDirectories(tempDir.resolve("dir"));

        assertThrows(IOException.class, () -> runner.putFile(handle, directory, "/workspace/dir"));
    }
}
