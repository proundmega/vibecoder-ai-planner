package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DockerSandboxRunnerTest {

    @TempDir
    Path tempDir;

    private static boolean windows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static Map<String, String> env(String... entries) {
        Map<String, String> env = new HashMap<>();
        for (int i = 0; i < entries.length; i += 2) {
            env.put(entries[i], entries[i + 1]);
        }
        return env;
    }

    private static SandboxConfig dockerConfig(String dockerBinary) {
        return SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", dockerBinary,
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_MEMORY_MB", "256",
            "SANDBOX_PIDS", "512",
            "SANDBOX_NOFILE", "1024",
            "SANDBOX_TMPFS_MB", "64",
            "SANDBOX_CPUS", "2.0"
        )::get);
    }

    private Path workspace() throws IOException {
        Path workspace = Files.createDirectories(tempDir.resolve("workspace"));
        Files.createDirectories(workspace.resolve(".git"));
        return workspace.toRealPath();
    }

    @Test
    void createArgsCarryEveryHardeningFlag() throws IOException {
        SandboxConfig config = dockerConfig("docker");
        SandboxSpec spec = config.specFor(workspace());
        String name = "vibecode-sandbox-test";

        List<String> args = DockerSandboxRunner.buildCreateArgs(spec, name);
        String joined = String.join(" ", args);

        assertTrue(args.contains("run"));
        assertTrue(args.contains("-d"));
        assertTrue(args.contains(name));
        assertTrue(args.contains("--read-only"));
        assertTrue(args.contains("--tmpfs"));
        assertTrue(args.contains("--init"));
        assertTrue(args.contains("--cap-drop"));
        assertTrue(args.contains("ALL"));
        assertTrue(joined.contains("--security-opt no-new-privileges"));
        assertTrue(joined.contains("--pids-limit 512"));
        assertTrue(joined.contains("--memory 268435456"));
        assertTrue(joined.contains("--memory-swap 268435456"));
        assertTrue(joined.contains("--cpus 2.0"));
        assertTrue(joined.contains("--ulimit nofile=1024:1024"));
        assertTrue(joined.contains("--user 1000:1000"));
        assertTrue(joined.contains("--network none"));
        assertTrue(joined.contains("-v " + spec.mountSource() + ":/workspace:rw"));
        assertTrue(joined.contains(
            spec.mountSource().resolve(".git") + ":/workspace/.git:ro"));
        assertTrue(joined.contains("--entrypoint /bin/sh"));
        assertTrue(joined.contains("-e CI=1"));
        assertTrue(joined.contains("-e HOME=/tmp"));
        assertTrue(joined.contains("-e TMPDIR=/tmp"));
        assertFalse(joined.contains("docker.sock"));
        assertFalse(joined.contains("--privileged"));
        assertFalse(joined.contains("--network host"));
    }

    @Test
    void createArgsIncludeDiskBoundsWhenConfigured() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", "docker",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_DISK_MB", "1024",
            "SANDBOX_DISK_ENFORCE", "true"
        )::get);
        SandboxSpec spec = config.specFor(workspace());

        String joined = String.join(" ",
            DockerSandboxRunner.buildCreateArgs(spec, "sandbox-disk"));

        assertTrue(joined.contains("--ulimit fsize=1073741824"));
        assertTrue(joined.contains("--storage-opt size=1073741824"));
    }

    @Test
    void containerEnvironmentRejectsSecrets() throws IOException {
        SandboxConfig config = dockerConfig("docker");
        SandboxSpec spec = config.specFor(workspace());
        SandboxSpec poisoned = new SandboxSpec(
            spec.image(), spec.workspace(), spec.mountSource(), spec.maxDuration(),
            spec.limits(), spec.networkEnabled(), spec.allowedHosts(), spec.egressProxy(),
            Map.of("GITHUB_TOKEN", "ghp_secret"), spec.user(), spec.seccompProfile(),
            spec.apparmorProfile(), spec.artifactMaxBytes());

        assertThrows(IllegalArgumentException.class,
            () -> DockerSandboxRunner.containerEnvironment(poisoned));
    }

    @Test
    void execArgsMapTheWorkspaceAndEnvironment() throws IOException {
        SandboxHandle handle = new SandboxHandle("sandbox-1", workspace(), false, null);
        ExecRequest request = new ExecRequest(
            "npm test", "backend", Duration.ofSeconds(30), 1_024, Map.of("FEATURE_FLAG", "on"));

        List<String> args = DockerSandboxRunner.buildExecArgs(handle, request);

        assertTrue(args.contains("exec"));
        assertTrue(args.contains("-w"));
        assertTrue(args.contains("/workspace/backend"));
        assertTrue(args.contains("-e"));
        assertTrue(args.contains("FEATURE_FLAG=on"));
        assertTrue(args.contains("sandbox-1"));
        assertTrue(args.contains("/bin/sh"));
        assertTrue(args.contains("-lc"));
        assertTrue(args.contains("npm test"));
    }

    @Test
    void createExecAndDestroyUseTheDockerLifecycle() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) echo fake-output ;;
              *) exit 0 ;;
            esac
            """);

        SandboxConfig config = dockerConfig(script.toString());
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            ExecResult result = runner.exec(handle, ExecRequest.of("echo hi", Duration.ofSeconds(5)));
            assertEquals(0, result.exitCode());
            assertEquals("fake-output", result.output().trim());

            Path local = Files.writeString(tempDir.resolve("upload.txt"), "hello");
            runner.putFile(handle, local, "/workspace/upload.txt");
            runner.getFile(handle, "/workspace/upload.txt", tempDir.resolve("download.txt"));

            runner.destroy(handle);
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("run -d --name"), logText);
        assertTrue(logText.contains("inspect -f {{.State.Running}}"), logText);
        assertTrue(logText.contains("exec -w /workspace"), logText);
        assertTrue(logText.contains("cp"), logText);
        assertTrue(logText.contains("rm -f"), logText);
    }

    @Test
    void createFailureIsFatalAndCleansUp() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) echo boom; exit 1 ;;
              *) exit 0 ;;
            esac
            """);

        SandboxConfig config = dockerConfig(script.toString());
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            IOException error = assertThrows(IOException.class,
                () -> runner.create(config.specFor(workspace())));
            assertTrue(error.getMessage().contains("Could not start sandbox"));
        }

        assertTrue(Files.readString(log).contains("rm -f"));
    }

    @Test
    void createFailsClosedWhenTheContainerIsNotRunning() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo false ;;
              *) exit 0 ;;
            esac
            """);

        SandboxConfig config = dockerConfig(script.toString());
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            assertThrows(IOException.class, () -> runner.create(config.specFor(workspace())));
        }
        assertTrue(Files.readString(log).contains("rm -f"));
    }

    @Test
    void timeoutKillsTheContainer() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) sleep 10 ;;
              *) exit 0 ;;
            esac
            """);

        SandboxConfig config = dockerConfig(script.toString());
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            ExecResult result = runner.exec(handle,
                new ExecRequest("sleep 10", null, Duration.ofMillis(500), 1_024, Map.of()));
            assertTrue(result.timedOut());
            assertFalse(runnerCanExec(runner, handle));
        }

        assertTrue(Files.readString(log).contains("kill --signal KILL"), Files.readString(log));
    }

    @Test
    void execRejectsAnInactiveSandbox() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              *) exit 0 ;;
            esac
            """);

        SandboxConfig config = dockerConfig(script.toString());
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            runner.destroy(handle);
            assertThrows(IOException.class, () -> runner.exec(handle,
                ExecRequest.of("echo hi", Duration.ofSeconds(5))));
        }
    }

    @Test
    void fileTransferRejectsPathsOutsideTheWorkspace() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path script = fakeDocker(tempDir.resolve("docker.log"), """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class, () -> runner.putFile(handle, local, "/etc/passwd"));
            assertThrows(IOException.class, () -> runner.getFile(handle, "/etc/passwd", local));
        }
    }

    private static boolean runnerCanExec(DockerSandboxRunner runner, SandboxHandle handle) {
        try {
            runner.exec(handle, ExecRequest.of("echo hi", Duration.ofSeconds(1)));
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private Path fakeDocker(Path log, String body) throws IOException {
        Path script = tempDir.resolve("fake-docker.sh");
        String content = "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + log + "'\n" + body + "\n";
        Files.writeString(script, content);
        try {
            Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwxr-xr-x"));
        } catch (UnsupportedOperationException e) {
            script.toFile().setExecutable(true);
        }
        return script;
    }
}
