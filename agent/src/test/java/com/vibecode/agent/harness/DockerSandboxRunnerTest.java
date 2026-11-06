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
    void createArgsUseTheInternalEgressNetworkAndProxyEnvironment() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org,*.githubusercontent.com"
        )::get);
        SandboxSpec spec = config.specFor(workspace());
        DockerSandboxRunner.EgressRuntime egress = new DockerSandboxRunner.EgressRuntime(
            "vibecode-egress-test",
            "vibecode-egress-proxy-test",
            "172.19.0.2",
            "http://172.19.0.2:3128");

        String joined = String.join(" ",
            DockerSandboxRunner.buildCreateArgs(spec, "vibecode-sandbox-test", egress));

        assertTrue(joined.contains("--network vibecode-egress-test"));
        assertFalse(joined.contains("--network none"));
        assertTrue(joined.contains("--dns 127.0.0.1"));
        assertTrue(joined.contains("--add-host vibecode-egress-proxy-test:172.19.0.2"));
        assertTrue(joined.contains("-e HTTP_PROXY=http://172.19.0.2:3128"));
        assertTrue(joined.contains("-e HTTPS_PROXY=http://172.19.0.2:3128"));
        assertTrue(joined.contains("-e http_proxy=http://172.19.0.2:3128"));
        assertTrue(joined.contains("-e NO_PROXY=localhost,127.0.0.1,::1"));
        assertTrue(joined.contains("-e npm_config_https_proxy=http://172.19.0.2:3128"));
    }

    @Test
    void proxyContainerIsHardenedAndReceivesTheAllowlist() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org,*.githubusercontent.com"
        )::get);
        SandboxSpec spec = config.specFor(workspace());

        String joined = String.join(" ",
            DockerSandboxRunner.buildProxyRunArgs(spec, "proxy-1", "internal-1"));

        assertTrue(joined.contains("--read-only"));
        assertTrue(joined.contains("--cap-drop ALL"));
        assertTrue(joined.contains("--security-opt no-new-privileges"));
        assertTrue(joined.contains("--user 1000:1000"));
        assertTrue(joined.contains("--network internal-1"));
        assertTrue(joined.contains("--pids-limit 64"));
        assertTrue(joined.contains("EGRESS_ALLOWED_HOSTS=registry.npmjs.org,*.githubusercontent.com"));
        assertTrue(joined.contains("--entrypoint node"));
        assertTrue(joined.contains("Buffer.from("));
        assertFalse(joined.contains("--privileged"));
        assertFalse(joined.contains("docker.sock"));
    }

    @Test
    void createStartsAndDestroysTheEgressProxyAndNetwork() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              network) exit 0 ;;
              run) exit 0 ;;
              inspect)
                case "$*" in
                  *"State.Running"*) echo true ;;
                  *) echo 172.19.0.2 ;;
                esac
                ;;
              logs) echo '{"message":"egress proxy listening"}'; exit 0 ;;
              rm) exit 0 ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *"wc -c"*) echo "OK 0" ;;
                  *"mkdir -p"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            runner.exec(handle, ExecRequest.of("echo hi", Duration.ofSeconds(5)));
            runner.destroy(handle);
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("network create --driver bridge --internal"), logText);
        assertTrue(logText.contains("--network vibecode-egress-"), logText);
        assertTrue(logText.contains("network connect bridge vibecode-egress-proxy-"), logText);
        assertTrue(logText.contains("logs --tail 200 vibecode-egress-proxy-"), logText);
        assertTrue(logText.contains("rm -f vibecode-egress-proxy-"), logText);
        assertTrue(logText.contains("network rm vibecode-egress-"), logText);
    }

    @Test
    void egressCleanupRunsWhenTheSandboxContainerFailsToStart() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path runs = tempDir.resolve("runs");
        Path script = fakeDocker(log, """
            case "$1" in
              network) exit 0 ;;
              run)
                count=$(cat '__RUNS__' 2>/dev/null || echo 0)
                count=$((count + 1))
                echo "$count" > '__RUNS__'
                if [ "$count" -ge 2 ]; then echo "sandbox boom"; exit 1; fi
                exit 0
                ;;
              inspect)
                case "$*" in
                  *"State.Running"*) echo true ;;
                  *) echo 172.19.0.2 ;;
                esac
                ;;
              logs) echo '{"message":"egress proxy listening"}'; exit 0 ;;
              *) exit 0 ;;
            esac
            """.replace("__RUNS__", runs.toString()));
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            assertThrows(IOException.class, () -> runner.create(config.specFor(workspace())));
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("network rm vibecode-egress-"), logText);
    }

    @Test
    void createArgsMountTheMappedGitPathReadOnly() throws IOException {
        Path containerRoot = Files.createDirectories(tempDir.resolve("repos"));
        Path mappedWorkspace = Files.createDirectories(containerRoot.resolve("run-1"));
        Files.createDirectories(mappedWorkspace.resolve(".git"));
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_CONTAINER_WORKSPACE_ROOT", containerRoot.toString(),
            "SANDBOX_HOST_WORKSPACE_ROOT", "/host/repos"
        )::get);
        SandboxSpec spec = config.specFor(mappedWorkspace);

        String joined = String.join(" ",
            DockerSandboxRunner.buildCreateArgs(spec, "mapped-sandbox"));

        // The supervisor can see .git; the daemon mounts the mapped path.
        assertTrue(joined.contains("-v /host/repos/run-1:/workspace:rw"));
        assertTrue(joined.contains("-v /host/repos/run-1/.git:/workspace/.git:ro"));
        assertFalse(joined.contains(mappedWorkspace + ":/workspace:rw"));
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
            spec.image(), spec.proxyImage(), spec.workspace(), spec.mountSource(), spec.maxDuration(),
            spec.limits(), spec.networkEnabled(), spec.allowedHosts(), spec.egressProxy(),
            spec.egressUpstreamNetwork(),
            Map.of("OPENAI_KEY", "sk-secret"), spec.user(), spec.seccompProfile(),
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
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *"wc -c"*) echo "OK 0" ;;
                  *"mkdir -p"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
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

    @Test
    void capsExecAtTheConfiguredTimeout() throws IOException {
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
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_EXEC_TIMEOUT_SECONDS", "1"
        )::get);
        long started = System.currentTimeMillis();

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            ExecResult result = runner.exec(handle,
                ExecRequest.of("sleep 10", Duration.ofSeconds(30)));
            assertTrue(result.timedOut());
        }

        assertTrue(System.currentTimeMillis() - started < 5_000);
    }

    @Test
    void killsTheSandboxWhenTheWorkspaceExceedsItsQuota() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path workspace = workspace();
        // Pre-populate over the quota so the first watchdog tick is
        // deterministic; the script only needs to stay alive.
        Files.write(workspace.resolve("big"), new byte[3 * 1024 * 1024]);
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) sleep 10 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_DISK_MB", "1",
            "SANDBOX_DISK_CHECK_INTERVAL_SECONDS", "1"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace));
            ExecResult result = runner.exec(handle,
                ExecRequest.of("sleep 10", Duration.ofSeconds(5)));
            assertTrue(result.timedOut(), result.toString());
            assertTrue(result.output().contains("workspace disk quota exceeded"), result.output());
        }

        assertTrue(Files.readString(log).contains("kill --signal KILL"));
    }

    @Test
    void enforcesArtifactMaxBytesOnUploadAndDownload() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"wc -c"*) echo "OK 100" ;;
                  *"mkdir -p"*) echo OK ;;
                  *) exit 0 ;;
                esac
                ;;
              cp)
                last=""
                for a in "$@"; do last="$a"; done
                case "$last" in
                  *:*) : ;;
                  *) head -c 100 /dev/zero > "$last" ;;
                esac
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_ARTIFACT_MAX_BYTES", "10"
        )::get);
        Path local = Files.writeString(tempDir.resolve("big.txt"), "x".repeat(100));

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.putFile(handle, local, "/workspace/big.txt"));

            Path downloaded = tempDir.resolve("downloaded.bin");
            assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/big.txt", downloaded));
            assertFalse(Files.exists(downloaded));
            assertFalse(Files.readString(log).contains("cp "),
                "download must be rejected before docker cp");
        }
    }

    @Test
    void getFileOverflowPreservesAnExistingLocalFile() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"wc -c"*) echo "OK 0" ;;
                  *"mkdir -p"*) echo OK ;;
                  *) exit 0 ;;
                esac
                ;;
              cp)
                last=""
                for a in "$@"; do last="$a"; done
                case "$last" in
                  *:*) : ;;
                  *) head -c 100 /dev/zero > "$last" ;;
                esac
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_ARTIFACT_MAX_BYTES", "10"
        )::get);
        Path local = Files.writeString(tempDir.resolve("existing.txt"), "keep");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/file.txt", local));
        }

        assertEquals("keep", Files.readString(local));
        try (var listing = Files.list(tempDir)) {
            assertFalse(listing.anyMatch(path -> path.getFileName().toString()
                .startsWith(".sandbox-download-")));
        }
    }

    @Test
    void rejectsSymlinkedContainerPaths() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path script = fakeDocker(tempDir.resolve("docker.log"), """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) echo SYMLINK ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/leak", tempDir.resolve("leak.out")));
            assertThrows(IOException.class,
                () -> runner.putFile(handle, local, "/workspace/nested/file"));
        }
    }

    @Test
    void destroyFailureThrowsAndKeepsTheSandboxTracked() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              rm) echo "rm failed"; exit 1 ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *"wc -c"*) echo "OK 0" ;;
                  *"mkdir -p"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class, () -> runner.destroy(handle));

            // A failed destroy must not remove tracking, so a retry can still
            // see (and kill) the container.
            ExecResult result = runner.exec(handle,
                ExecRequest.of("echo hi", Duration.ofSeconds(5)));
            assertEquals("fake-output", result.output().trim());
        }

        assertTrue(Files.readString(log).contains("rm -f"));
    }

    @Test
    void destroyTreatsAnAlreadyRemovedContainerAsSuccess() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path marker = tempDir.resolve("removed.marker");
        String body = """
            case "$1" in
              run) exit 0 ;;
              inspect)
                if [ -f '__MARKER__' ]; then echo "Error: No such object"; exit 1; fi
                echo true
                ;;
              rm)
                touch '__MARKER__'
                echo "Error: No such container: $*"
                exit 1
                ;;
              *) exit 0 ;;
            esac
            """.replace("__MARKER__", marker.toString());
        Path script = fakeDocker(log, body);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            runner.destroy(handle);
        }

        assertTrue(Files.readString(log).contains("rm -f"));
    }

    @Test
    void createRetainsTrackingWhenWatchdogSchedulingAndRemovalFail() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              rm) echo "rm failed"; exit 1 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        DockerSandboxRunner runner = new DockerSandboxRunner(config,
            (name, workspace, exceeded) -> {
                throw new RuntimeException("no scheduler threads");
            });

        IOException error = assertThrows(IOException.class,
            () -> runner.create(config.specFor(workspace())));
        assertTrue(error.getMessage().contains("watchdog"));
        runner.close();

        assertTrue(countOccurrences(Files.readString(log), "rm -f") >= 2,
            "create cleanup and close must both retry removal");
    }

    @Test
    void closeWarnsAndRetainsAContainerItCannotRemove() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              rm) echo "rm failed"; exit 1 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        DockerSandboxRunner runner = new DockerSandboxRunner(config);

        runner.create(config.specFor(workspace()));
        runner.close();
        runner.close();

        assertTrue(countOccurrences(Files.readString(log), "rm -f") >= 2,
            "a retained container must be retried by a later close()");
    }

    @Test
    void guardFailureWithAZeroExitAndFailureTokenIsRejected() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) echo SYMLINK; exit 0 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/leak", tempDir.resolve("out")));
            assertThrows(IOException.class,
                () -> runner.putFile(handle, local, "/workspace/leak"));
        }

        assertFalse(Files.readString(log).contains("cp "));
    }

    @Test
    void guardFloodCannotHideAFailureExitCode() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                echo SYMLINK
                i=0
                while [ $i -lt 500 ]; do printf ' '; i=$((i+1)); done
                echo "OK 0"
                exit 11
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/leak", tempDir.resolve("out")));
            assertThrows(IOException.class,
                () -> runner.putFile(handle, local, "/workspace/leak"));
        }

        assertFalse(Files.readString(log).contains("cp "));
    }

    @Test
    void guardFailureFailsClosedAndNeverRunsDockerCp() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) exit 1 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/file", tempDir.resolve("out")));
            assertThrows(IOException.class,
                () -> runner.putFile(handle, local, "/workspace/file"));
        }

        assertFalse(Files.readString(log).contains("cp "),
            "a failed guard must never reach docker cp");
    }

    @Test
    void uploadRejectsANonRegularTarget() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec) echo NOTFILE ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("local.txt"), "hello");

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.putFile(handle, local, "/workspace/fifo"));
        }

        assertFalse(Files.readString(log).contains("cp "));
    }

    @Test
    void failsClosedWhenTheWorkspaceCannotBeMeasured() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path workspace = workspace();
        Path log = tempDir.resolve("docker.log");
        String body = """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                rm -rf '__WORKSPACE__'
                sleep 10
                ;;
              *) exit 0 ;;
            esac
            """.replace("__WORKSPACE__", workspace.toString());
        Path script = fakeDocker(log, body);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_DISK_MB", "1",
            "SANDBOX_DISK_CHECK_INTERVAL_SECONDS", "1"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace));
            ExecResult result = runner.exec(handle,
                ExecRequest.of("sleep 10", Duration.ofSeconds(5)));
            assertTrue(result.timedOut(), result.toString());
            assertTrue(result.output().contains("workspace disk quota exceeded"),
                result.output());
        }

        assertTrue(Files.readString(log).contains("kill --signal KILL"));
    }

    @Test
    void workspaceSizeCountsRegularFilesAndIgnoresSymlinks() throws IOException {
        Assumptions.assumeFalse(windows(), "symlink creation is not portable");
        Path root = Files.createDirectories(tempDir.resolve("size"));
        Files.writeString(root.resolve("a.txt"), "12345");
        Path outside = Files.writeString(tempDir.resolve("outside.txt"), "outside");
        try {
            Files.createSymbolicLink(root.resolve("link"), outside);
        } catch (UnsupportedOperationException | IOException e) {
            return;
        }

        assertEquals(5L, DockerSandboxRunner.workspaceSize(root));
        assertEquals(-1L, DockerSandboxRunner.workspaceSize(tempDir.resolve("missing")));
    }

    private static boolean runnerCanExec(DockerSandboxRunner runner, SandboxHandle handle) {
        try {
            runner.exec(handle, ExecRequest.of("echo hi", Duration.ofSeconds(1)));
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    private static int countOccurrences(String text, String token) {
        int count = 0;
        int index = 0;
        while ((index = text.indexOf(token, index)) >= 0) {
            count++;
            index += token.length();
        }
        return count;
    }

    private Path fakeDocker(Path log, String body) throws IOException {        Path script = tempDir.resolve("fake-docker.sh");
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
