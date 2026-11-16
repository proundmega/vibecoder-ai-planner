package com.vibecode.agent.harness;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
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
        // PID 1 must be a single childless process for the frozen sweep.
        assertTrue(joined.contains("exec sleep 2147483647"));
        assertFalse(joined.contains("while :"));
        assertTrue(joined.contains("-e CI=1"));
        assertTrue(joined.contains("-e HOME=/tmp"));
        assertTrue(joined.contains("-e TMPDIR=/tmp"));
        assertTrue(joined.contains("--log-opt max-size=1m"));
        assertTrue(joined.contains("--log-opt max-file=1"));
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
        assertTrue(joined.contains("EGRESS_TUNNEL_PROBE_TIMEOUT_MS=5000"));
        assertTrue(joined.contains("EGRESS_TLS_MODE=sni-only"));
        assertTrue(joined.contains("EGRESS_ORIGIN_CA_HOSTS= "));
        assertTrue(joined.contains("EGRESS_ORIGIN_CA_PEM_B64= "));
        assertTrue(joined.contains("--entrypoint node"));
        assertTrue(joined.contains("Buffer.from("));
        assertFalse(joined.contains("--privileged"));
        assertFalse(joined.contains("docker.sock"));
    }

    @Test
    void proxyArgsCarryTheTerminateMode() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org",
            "SANDBOX_EGRESS_TLS_MODE", "terminate"
        )::get);
        SandboxSpec spec = config.specFor(workspace());

        String joined = String.join(" ",
            DockerSandboxRunner.buildProxyRunArgs(spec, "proxy-1", "internal-1"));

        assertTrue(joined.contains("EGRESS_TLS_MODE=terminate"));
    }

    @Test
    void proxyArgsCarryTheScopedOriginCa() throws IOException {
        String ca = Base64.getEncoder().encodeToString(
            Files.readAllBytes(Path.of("src/test/resources/egress-origin-ca.pem")));
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org",
            "SANDBOX_EGRESS_TLS_MODE", "terminate",
            "SANDBOX_EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "SANDBOX_EGRESS_ORIGIN_CA_B64", ca
        )::get);
        SandboxSpec spec = config.specFor(workspace());

        List<String> args = DockerSandboxRunner.buildProxyRunArgs(
            spec, "proxy-1", "internal-1");
        String joined = String.join(" ", args);

        assertTrue(joined.contains("EGRESS_ORIGIN_CA_HOSTS=registry.npmjs.org"), joined);
        String encoded = args.stream()
            .filter(argument -> argument.startsWith("EGRESS_ORIGIN_CA_PEM_B64="))
            .findFirst()
            .orElseThrow()
            .substring("EGRESS_ORIGIN_CA_PEM_B64=".length());
        assertEquals(spec.egressOriginCaPem(),
            new String(Base64.getDecoder().decode(encoded), StandardCharsets.UTF_8));
        assertFalse(joined.contains("PRIVATE KEY"), joined);
        assertEquals(List.of("registry.npmjs.org"), spec.egressOriginCaHosts());
        assertTrue(spec.egressOriginCaPem().contains("BEGIN CERTIFICATE"));
        assertTrue(DockerSandboxRunner.originCaSha256(spec.egressOriginCaPem())
            .matches("[0-9a-f]{64}"));
    }

    @Test
    void originCaNeverReachesTheSandboxContainer() throws IOException {
        String ca = Base64.getEncoder().encodeToString(
            Files.readAllBytes(Path.of("src/test/resources/egress-origin-ca.pem")));
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org",
            "SANDBOX_EGRESS_TLS_MODE", "terminate",
            "SANDBOX_EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "SANDBOX_EGRESS_ORIGIN_CA_B64", ca
        )::get);
        SandboxSpec spec = config.specFor(workspace());
        DockerSandboxRunner.EgressRuntime egress = new DockerSandboxRunner.EgressRuntime(
            "internal-1", "proxy-1", "172.19.0.2", "http://172.19.0.2:3128");

        String create = String.join(" ",
            DockerSandboxRunner.buildCreateArgs(spec, "sandbox-1"));
        Map<String, String> env = DockerSandboxRunner.containerEnvironment(spec, egress);

        assertFalse(create.contains("EGRESS_ORIGIN_CA"), create);
        assertFalse(env.keySet().stream().anyMatch(key -> key.startsWith("EGRESS_ORIGIN_CA")),
            env.toString());
        assertFalse(env.values().stream().anyMatch(value ->
            value.contains("BEGIN CERTIFICATE") || value.contains(ca)), env.toString());
    }

    @Test
    void carriesTheAgentOwnerLabelOnSandboxesAndProxies() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "AGENT_ID", "agent-42",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
        )::get);
        SandboxSpec spec = config.specFor(workspace());

        String create = String.join(" ",
            DockerSandboxRunner.buildCreateArgs(spec, "sandbox-1"));
        String proxy = String.join(" ",
            DockerSandboxRunner.buildProxyRunArgs(spec, "proxy-1", "internal-1"));

        assertTrue(create.contains("vibecode.sandbox.owner=agent-42"), create);
        assertTrue(proxy.contains("vibecode.sandbox.owner=agent-42"), proxy);
    }

    @Test
    void reapsContainersAndNetworksForTheSameAgentOwner() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              ps) echo abcdef123456 ;;
              network)
                case "$2" in
                  ls) echo 1234567890ab ;;
                esac
                ;;
              rm) exit 0 ;;
              network_rm_placeholder) exit 0 ;;
            esac
            """);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "AGENT_ID", "agent-42"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            runner.reapOrphans();
        }

        String commands = Files.readString(log);
        assertTrue(commands.contains("ps -aq --filter label=vibecode.sandbox.owner=agent-42"),
            commands);
        assertTrue(commands.contains("rm -f abcdef123456"), commands);
        assertTrue(commands.contains(
            "network ls -q --filter label=vibecode.sandbox.owner=agent-42"), commands);
        assertTrue(commands.contains("network rm 1234567890ab"), commands);
    }

    @Test
    void reapsStalePoolAgentResourcesWhenNoAgentOwnerIsLive() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              ps)
                case "$*" in
                  *"label=vibecode.sandbox.owner=pool-2"*) echo aaaaaaaaaaaa ;;
                  *"label=vibecode.agent.owner=pool-1"*) : ;;
                  *"label=vibecode.agent.owner=pool-3"*) echo eeeeeeeeeeee ;;
                  *"label=vibecode.sandbox.managed=true"*)
                    printf 'bbbbbbbbbbbb pool-1\ncccccccccccc pool-3\n' ;;
                  *) : ;;
                esac
                ;;
              network)
                case "$*" in
                  *"ls -q --filter label=vibecode.sandbox.owner=pool-2"*)
                    echo 111111111111 ;;
                  *"ls"*"label=vibecode.sandbox.managed=true"*)
                    printf '222222222222 pool-1\n333333333333 pool-3\n' ;;
                esac
                ;;
              info) echo daemon-1 ;;
              rm) exit 0 ;;
            esac
            """);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "AGENT_ID", "2",
            "SANDBOX_OWNER", "pool-2",
            "SANDBOX_POOL_AGENT", "true",
            "SANDBOX_DAEMON_ID", "daemon-1"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            runner.reapOrphans();
        }

        String commands = Files.readString(log);
        assertTrue(commands.contains(
            "ps -aq --filter label=vibecode.sandbox.owner=pool-2"), commands);
        assertTrue(commands.contains("info --format {{.ID}}"), commands);
        assertTrue(commands.contains(
            "ps -a --filter label=vibecode.sandbox.managed=true --format"), commands);
        assertTrue(commands.contains(
            "ps -aq --filter label=vibecode.agent.owner=pool-1"), commands);
        assertTrue(commands.contains(
            "ps -aq --filter label=vibecode.agent.owner=pool-3"), commands);
        assertTrue(commands.contains("rm -f aaaaaaaaaaaa"), commands);
        assertTrue(commands.contains("rm -f bbbbbbbbbbbb"), commands);
        assertTrue(commands.contains("network rm 111111111111"), commands);
        assertTrue(commands.contains("network rm 222222222222"), commands);
        assertFalse(commands.contains("rm -f cccccccccccc"), commands);
        assertFalse(commands.contains("network rm 333333333333"), commands);
    }

    @Test
    void skipsTheStaleSweepWhenTheAgentAndApiDaemonsDiffer() throws IOException {
        String commands = runPoolReap("""
            case "$1" in
              info) echo daemon-2 ;;
              ps)
                case "$*" in
                  *"sandbox.owner=pool-2"*) : ;;
                  *"sandbox.managed=true"*)
                    printf 'bbbbbbbbbbbb pool-1\n' ;;
                  *) : ;;
                esac
                ;;
              network)
                case "$*" in
                  *"ls -q --filter label=vibecode.sandbox.owner=pool-2"*) : ;;
                esac
                ;;
              rm) exit 0 ;;
            esac
            """);

        assertTrue(commands.contains("info --format {{.ID}}"), commands);
        assertFalse(commands.contains("label=vibecode.sandbox.managed=true"), commands);
        assertFalse(commands.contains("rm -f bbbbbbbbbbbb"), commands);
    }

    @Test
    void skipsTheStaleOwnerWhenAgentLivenessCannotBeChecked() throws IOException {
        String commands = runPoolReap("""
            case "$1" in
              info) echo daemon-1 ;;
              ps)
                case "$*" in
                  *"sandbox.owner=pool-2"*) : ;;
                  *"agent.owner=pool-1"*) exit 1 ;;
                  *"sandbox.managed=true"*)
                    printf 'bbbbbbbbbbbb pool-1\n' ;;
                  *) : ;;
                esac
                ;;
              network)
                case "$*" in
                  *"ls -q --filter label=vibecode.sandbox.owner=pool-2"*) : ;;
                esac
                ;;
              rm) exit 0 ;;
            esac
            """);

        assertTrue(commands.contains("agent.owner=pool-1"), commands);
        assertFalse(commands.contains("rm -f bbbbbbbbbbbb"), commands);
    }

    @Test
    void ignoresNumericOwnersAndManagedListFailures() throws IOException {
        String commands = runPoolReap("""
            case "$1" in
              info) echo daemon-1 ;;
              ps)
                case "$*" in
                  *"sandbox.owner=pool-2"*) : ;;
                  *"sandbox.managed=true"*)
                    printf 'bbbbbbbbbbbb 123\n' ;;
                  *) : ;;
                esac
                ;;
              network)
                case "$*" in
                  *"ls -q --filter label=vibecode.sandbox.owner=pool-2"*) : ;;
                  *"label=vibecode.sandbox.managed=true"*) exit 1 ;;
                esac
                ;;
              rm) exit 0 ;;
            esac
            """);

        assertFalse(commands.contains("rm -f bbbbbbbbbbbb"), commands);
        assertFalse(commands.contains("network rm "), commands);
    }

    @Test
    void skipsTheStaleSweepWhenTheAgentDaemonIdCannotBeRead() throws IOException {
        String commands = runPoolReap("""
            case "$1" in
              info) exit 1 ;;
              ps)
                case "$*" in
                  *"sandbox.owner=pool-2"*) : ;;
                  *"sandbox.managed=true"*)
                    printf 'bbbbbbbbbbbb pool-1\n' ;;
                  *) : ;;
                esac
                ;;
              network)
                case "$*" in
                  *"ls -q --filter label=vibecode.sandbox.owner=pool-2"*) : ;;
                esac
                ;;
              rm) exit 0 ;;
            esac
            """);

        assertTrue(commands.contains("info --format {{.ID}}"), commands);
        assertFalse(commands.contains("label=vibecode.sandbox.managed=true"), commands);
        assertFalse(commands.contains("rm -f bbbbbbbbbbbb"), commands);
    }

    private String runPoolReap(String body) throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, body);
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "AGENT_ID", "2",
            "SANDBOX_OWNER", "pool-2",
            "SANDBOX_POOL_AGENT", "true",
            "SANDBOX_DAEMON_ID", "daemon-1"
        )::get);
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            runner.reapOrphans();
        }
        return Files.readString(log);
    }

    @Test
    void proxyArgsClearTheTestSeamAndUseTheConfiguredImage() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_PROXY_IMAGE", "proxy:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
        )::get);
        SandboxSpec spec = config.specFor(workspace());

        String joined = String.join(" ",
            DockerSandboxRunner.buildProxyRunArgs(spec, "proxy-1", "internal-1"));

        assertTrue(joined.contains("--entrypoint node proxy:img"));
        assertTrue(joined.contains("-e EGRESS_TEST_MODE=0"));
        assertTrue(joined.contains("EGRESS_TEST_RESOLVE_IP="));
        assertTrue(joined.contains("--log-opt max-size=1m"));
    }

    @Test
    void writeContainerFileViaExecTimesOutWhenTheShellIgnoresStdin() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path script = fakeDocker(tempDir.resolve("docker.log"), """
            case "$1" in
              exec) sleep 30 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            long started = System.nanoTime();
            IOException error = assertThrows(IOException.class,
                () -> runner.writeContainerFileViaExec(
                    "sandbox-1", "/tmp/vibecode-ca-bundle.crt",
                    new byte[512 * 1024], Duration.ofMillis(300)));
            long elapsed = Duration.ofNanos(System.nanoTime() - started).toMillis();
            assertTrue(error.getMessage().contains("timed out"), error.getMessage());
            assertTrue(elapsed < 5_000, "write timeout took " + elapsed + "ms");
        }
    }

    @Test
    void classifiesContainerPathStates() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path script = fakeDocker(tempDir.resolve("docker.log"), """
            case "$1" in
              exec)
                case "$*" in
                  *"/missing"*) echo MISSING ;;
                  *"/broken"*) echo BROKEN ;;
                  *"/dir"*) echo NOTFILE ;;
                  *"/file"*) echo FILE ;;
                  *) echo UNKNOWN ;;
                esac
                ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            assertEquals(DockerSandboxRunner.ContainerPathState.FILE,
                runner.containerPathState("sandbox-1", "/file"));
            assertEquals(DockerSandboxRunner.ContainerPathState.MISSING,
                runner.containerPathState("sandbox-1", "/missing"));
            assertEquals(DockerSandboxRunner.ContainerPathState.BROKEN_SYMLINK,
                runner.containerPathState("sandbox-1", "/broken"));
            assertEquals(DockerSandboxRunner.ContainerPathState.NOT_A_FILE,
                runner.containerPathState("sandbox-1", "/dir"));
            assertEquals(DockerSandboxRunner.ContainerPathState.UNKNOWN,
                runner.containerPathState("sandbox-1", "/other"));
        }
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
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org",
            "AGENT_ID", "agent-42"
        )::get);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            runner.exec(handle, ExecRequest.of("echo hi", Duration.ofSeconds(5)));
            runner.destroy(handle);
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("network create --driver bridge --internal"), logText);
        assertTrue(logText.contains("--network vibecode-egress-"), logText);
        assertTrue(logText.contains(
            "network create --driver bridge --internal --label "
                + "vibecode.sandbox.managed=true --label "
                + "vibecode.sandbox.owner=agent-42"), logText);
        assertTrue(logText.contains("network connect bridge vibecode-egress-proxy-"), logText);
        assertTrue(logText.contains("logs --tail 10000 vibecode-egress-proxy-"), logText);
        assertTrue(logText.contains("rm -f vibecode-egress-proxy-"), logText);
        assertTrue(logText.contains("network rm vibecode-egress-"), logText);
    }

    @Test
    void surfacesOriginCaAuditLinesBeforeRemovingTheProxy() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker-audit.log");
        Path script = fakeDocker(log, """
            case "$1" in
              logs)
                echo '{"level":"info","message":"egress origin CA configured","hosts":["registry.npmjs.org"],"sha256":"abc123"}'
                echo '{"level":"info","message":"egress origin CA used","host":"registry.npmjs.org","sha256":"abc123"}'
                i=0
                while [ "$i" -lt 300 ]; do
                  echo '{"level":"warn","message":"egress denied","decision":"deny","host":"evil.test","reason":"not in allowlist"}'
                  i=$((i + 1))
                done
                exit 0
                ;;
              rm) exit 0 ;;
              network) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        Logger logger = (Logger) LoggerFactory.getLogger(DockerSandboxRunner.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            runner.stopEgress("internal-1", "proxy-1");
        } finally {
            logger.detachAppender(appender);
        }

        String messages = appender.list.stream()
            .map(ILoggingEvent::getFormattedMessage)
            .collect(java.util.stream.Collectors.joining("\n"));
        assertTrue(messages.contains("egress origin CA configured"), messages);
        assertTrue(messages.contains("egress origin CA used"), messages);
        assertTrue(messages.contains("abc123"), messages);
        long forwarded = appender.list.stream()
            .map(ILoggingEvent::getFormattedMessage)
            .filter(message -> message.startsWith("Sandbox egress denied: "))
            .count();
        assertEquals(200, forwarded);
        assertTrue(messages.contains(
            "Sandbox egress denial summary: 100 line(s) suppressed; 200 forwarded"),
            messages);
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
    void terminateModeAddsThePerRunTrustEnvironment() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org",
            "SANDBOX_EGRESS_TLS_MODE", "terminate"
        )::get);
        SandboxSpec spec = config.specFor(workspace());
        DockerSandboxRunner.EgressRuntime egress = new DockerSandboxRunner.EgressRuntime(
            "internal-1", "proxy-1", "172.19.0.2", "http://172.19.0.2:3128");

        Map<String, String> env = DockerSandboxRunner.containerEnvironment(spec, egress);

        assertEquals("/tmp/vibecode-egress-ca.crt", env.get("NODE_EXTRA_CA_CERTS"));
        assertEquals("/tmp/vibecode-ca-bundle.crt", env.get("SSL_CERT_FILE"));
        assertEquals("/tmp/vibecode-ca-bundle.crt", env.get("GIT_SSL_CAINFO"));
        assertEquals("/tmp/vibecode-ca-bundle.crt", env.get("CURL_CA_BUNDLE"));
        assertEquals("/tmp/vibecode-ca-bundle.crt", env.get("PIP_CERT"));
        assertEquals("/tmp/vibecode-ca-bundle.crt", env.get("REQUESTS_CA_BUNDLE"));
        assertEquals("/tmp/vibecode-ca-bundle.crt", env.get("CARGO_HTTP_CAINFO"));
    }

    @Test
    void sniOnlyModeDoesNotAddTheTrustEnvironment() throws IOException {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
        )::get);
        SandboxSpec spec = config.specFor(workspace());
        DockerSandboxRunner.EgressRuntime egress = new DockerSandboxRunner.EgressRuntime(
            "internal-1", "proxy-1", "172.19.0.2", "http://172.19.0.2:3128");

        Map<String, String> env = DockerSandboxRunner.containerEnvironment(spec, egress);

        assertFalse(env.containsKey("NODE_EXTRA_CA_CERTS"));
    }

    @Test
    void containerEnvironmentRejectsSecrets() throws IOException {
        SandboxConfig config = dockerConfig("docker");
        SandboxSpec spec = config.specFor(workspace());
        SandboxSpec poisoned = new SandboxSpec(
            spec.image(), spec.proxyImage(), spec.workspace(), spec.mountSource(), spec.maxDuration(),
            spec.limits(), spec.networkEnabled(), spec.allowedHosts(), spec.egressProxy(),
            spec.egressUpstreamNetwork(), spec.egressProbeTimeoutMs(), spec.egressTlsMode(),
            spec.owner(), Map.of("OPENAI_KEY", "sk-secret"), spec.user(), spec.seccompProfile(),
            spec.apparmorProfile(), spec.artifactMaxBytes(), spec.egressOriginCaHosts(),
            spec.egressOriginCaPem(), spec.cacheVolume());

        assertThrows(IllegalArgumentException.class,
            () -> DockerSandboxRunner.containerEnvironment(poisoned));
    }

    @Test
    void perHandleTrustEnvironmentOverridesCommandEnvironment() {
        Map<String, String> merged = DockerSandboxRunner.mergeExecEnvironment(
            Map.of("JAVA_TOOL_OPTIONS", "-Djavax.net.ssl.trustStore=/tmp/trust"),
            Map.of("FEATURE_FLAG", "on", "JAVA_TOOL_OPTIONS", "-Duser.override=true"));

        assertEquals("-Duser.override=true -Djavax.net.ssl.trustStore=/tmp/trust",
            merged.get("JAVA_TOOL_OPTIONS"));
        assertEquals("on", merged.get("FEATURE_FLAG"));

        String conflicting = DockerSandboxRunner.mergeExecEnvironment(
            Map.of("JAVA_TOOL_OPTIONS", "-Djavax.net.ssl.trustStore=/tmp/trust"),
            Map.of("JAVA_TOOL_OPTIONS", "-Djavax.net.ssl.trustStore=/tmp/caller"))
            .get("JAVA_TOOL_OPTIONS");
        assertTrue(conflicting.endsWith("-Djavax.net.ssl.trustStore=/tmp/trust"),
            conflicting);
        assertTrue(conflicting.indexOf("/tmp/caller")
            < conflicting.lastIndexOf("/tmp/trust"), conflicting);
        assertEquals("-Djavax.net.ssl.trustStore=/tmp/trust",
            DockerSandboxRunner.mergeExecEnvironment(
                Map.of("JAVA_TOOL_OPTIONS", "-Djavax.net.ssl.trustStore=/tmp/trust"),
                Map.of()).get("JAVA_TOOL_OPTIONS"));
        assertTrue(DockerSandboxRunner.mergeExecEnvironment(null, null).isEmpty());
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
              cp)
                case "$*" in
                  *" -")
                    tmp=$(mktemp -d)
                    printf 'hello' > "$tmp/upload.txt"
                    tar -C "$tmp" -cf - upload.txt
                    rm -rf "$tmp"
                    ;;
                  *) exit 0 ;;
                esac
                ;;
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

            List<String> chunks = new ArrayList<>();
            ExecResult streamed = runner.execStreaming(
                handle, ExecRequest.of("echo hi", Duration.ofSeconds(5)), chunks::add);
            assertEquals(0, streamed.exitCode());
            assertEquals("fake-output", String.join("", chunks).trim());

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
        assertTrue(logText.contains(":/workspace/upload.txt -"), logText);
        assertFalse(logText.contains("cp -L"), logText);
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
            state='__STATE__'
            write_state() { printf '%s\n' "$1" > "$state.$$"; mv "$state.$$" "$state"; }
            case "$1" in
              run) write_state true; exit 0 ;;
              inspect)
                case "$*" in
                  *"State.Running"*) cat "$state" 2>/dev/null || echo true ;;
                  *) echo true ;;
                esac
                ;;
              kill|rm) write_state false; exit 0 ;;
              exec) sleep 10 ;;
              *) exit 0 ;;
            esac
            """.replace("__STATE__", log + ".state"));

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
    void parsesOnlyLiveNonInitProcessesFromTop() {
        assertEquals(List.of(),
            DockerSandboxRunner.parseSurvivors("", true, 4242));
        // docker top reports host PIDs; the init host PID is the one to ignore.
        assertEquals(List.of(),
            DockerSandboxRunner.parseSurvivors(
                "PID STAT COMMAND\n3677124 Ss sleep\n3677209 Z [evil]\n", true,
                3677124));
        assertEquals(List.of("4300 R evil"),
            DockerSandboxRunner.parseSurvivors(
                "PID STAT COMMAND\n3677124 Ss sleep\n4300 R evil\n", true,
                3677124));
        assertEquals(List.of(),
            DockerSandboxRunner.parseSurvivors("7 S worker\n", true, 7));
        assertEquals(List.of("7 S worker"),
            DockerSandboxRunner.parseSurvivors("7 S worker\n", true, 4242));
        assertTrue(DockerSandboxRunner.containsInitRow(
            "PID STAT COMMAND\n4242 Ss sleep\n", true, 4242));
        assertFalse(DockerSandboxRunner.containsInitRow(
            "PID STAT COMMAND\n", true, 4242));
        assertTrue(DockerSandboxRunner.containsInitRow(
            "UID PID PPID C STIME TTY TIME CMD\n"
                + "root 4242 0 0 10:00 ? 00:00:00 sleep\n", false, 4242));
        // Without a state column, a zombie-looking command is not exempt.
        assertEquals(List.of("root 9 1 0 10:00 ? 00:00:00 [evil] <defunct>"),
            DockerSandboxRunner.parseSurvivors(
                "UID PID PPID C STIME TTY TIME CMD\n"
                    + "root 4242 0 0 10:00 ? 00:00:00 sleep\n"
                    + "root 9 1 0 10:00 ? 00:00:00 [evil] <defunct>\n", false, 4242));
    }

    @Test
    void freezesAndVerifiesQuiescenceAfterTheDescendantSweep() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
              top)
                echo "PID STAT COMMAND"
                echo "4242 Ss sleep"
                echo "9 Z [evil]"
                exit 0
                ;;
              pause|unpause) exit 0 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            runner.exec(handle, ExecRequest.of("echo hi", Duration.ofSeconds(5)));
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("pause vibecode-sandbox-"), logText);
        assertTrue(logText.contains("top vibecode-sandbox-"), logText);
        assertTrue(logText.contains("unpause vibecode-sandbox-"), logText);
    }

    @Test
    void stopsTheSandboxWhenAForkSurvivesTheFrozenSweep() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
              top)
                echo "PID STAT COMMAND"
                echo "4242 Ss sleep"
                echo "4300 R evil"
                exit 0
                ;;
              pause|unpause) exit 0 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.exec(handle,
                    ExecRequest.of("echo hi", Duration.ofSeconds(5))));
            // The handle is compromised: the pre-publish destroy must not
            // report it as cleanly gone.
            assertThrows(IOException.class, () -> runner.destroy(handle));
            // The compromised flag is terminal until close(): even after the
            // container is gone, a later destroy still refuses to report the
            // handle as publishable.
            assertThrows(IOException.class, () -> runner.destroy(handle));
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("pause vibecode-sandbox-"), logText);
        assertTrue(logText.contains("top vibecode-sandbox-"), logText);
        assertFalse(logText.contains("unpause vibecode-sandbox-"), logText);
        assertTrue(logText.contains("rm -f vibecode-sandbox-"), logText);
    }

    @Test
    void fallsBackToPortableTopAndFailsClosedWithoutAStateColumn() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
              top)
                case "$*" in
                  *"-eo"*) echo "unsupported"; exit 1 ;;
                  *)
                    echo "UID PID PPID C STIME TTY TIME CMD"
                    echo "root 4242 0 0 10:00 ? 00:00:00 sleep"
                    echo "root 4300 1 0 10:00 ? 00:00:00 evil"
                    exit 0
                    ;;
                esac
                ;;
              pause|unpause) exit 0 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.exec(handle,
                    ExecRequest.of("echo hi", Duration.ofSeconds(5))));
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("-eo pid,stat,comm"), logText);
        assertEquals(2, logText.lines()
            .filter(line -> line.startsWith("top vibecode-sandbox-")).count());
        assertFalse(logText.contains("unpause vibecode-sandbox-"), logText);
        assertTrue(logText.contains("rm -f vibecode-sandbox-"), logText);
    }

    @Test
    void stopsTheSandboxWhenItCannotBeFrozen() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *) echo fake-output ;;
                esac
                ;;
              pause) echo "freezer unavailable"; exit 1 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            assertThrows(IOException.class,
                () -> runner.exec(handle,
                    ExecRequest.of("echo hi", Duration.ofSeconds(5))));
        }

        String logText = Files.readString(log);
        assertTrue(logText.contains("pause vibecode-sandbox-"), logText);
        assertFalse(logText.contains("unpause vibecode-sandbox-"), logText);
        assertTrue(logText.contains("rm -f vibecode-sandbox-"), logText);
    }

    @Test
    void failsClosedWhenTheFrozenProcessTableIsBlankOrTruncated() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        for (String top : List.of(
            "top) exit 0 ;;",
            "top) echo 'PID STAT COMMAND'; exit 0 ;;",
            "top) echo 'PID STAT COMMAND'; "
                + "yes '4242 S sleep' | head -n 4000; exit 0 ;;")) {
            Path log = tempDir.resolve("docker.log");
            Path script = fakeDocker(log, """
                case "$1" in
                  run) exit 0 ;;
                  inspect) echo true ;;
                  exec)
                    case "$*" in
                      *"/proc/"*) echo OK ;;
                      *) echo fake-output ;;
                    esac
                    ;;
                  __TOP__
                  pause|unpause) exit 0 ;;
                  *) exit 0 ;;
                esac
                """.replace("__TOP__", top));
            SandboxConfig config = dockerConfig(script.toString());

            try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
                SandboxHandle handle = runner.create(config.specFor(workspace()));
                assertThrows(IOException.class,
                    () -> runner.exec(handle,
                        ExecRequest.of("echo hi", Duration.ofSeconds(5))),
                    "an unverifiable process table must fail the exec");
            }
        }
    }

    @Test
    void failsTheExecWhenCleanupCannotBeVerified() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo FAILED ;;
                  *) echo fake-output ;;
                esac
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());

        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            // The sweep fails, kill "succeeds", but inspect still says the
            // container is running: exec must fail rather than report success.
            assertThrows(IOException.class,
                () -> runner.exec(handle,
                    ExecRequest.of("echo hi", Duration.ofSeconds(5))));
        }
    }

    @Test
    void serializesConcurrentExecsPerSandbox() throws Exception {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path busy = tempDir.resolve("busy");
        Path script = fakeDocker(tempDir.resolve("docker.log"), """
            case "$1" in
              run) exit 0 ;;
              inspect) echo true ;;
              exec)
                case "$*" in
                  *"/proc/"*) echo OK ;;
                  *)
                    if [ -e '__BUSY__' ]; then
                      echo OVERLAP
                    else
                      touch '__BUSY__'
                      sleep 0.3
                      rm -f '__BUSY__'
                      echo fake-output
                    fi
                    ;;
                esac
                ;;
              top) echo "PID STAT COMMAND"; echo "4242 Ss sleep"; exit 0 ;;
              pause|unpause) exit 0 ;;
              *) exit 0 ;;
            esac
            """.replace("__BUSY__", busy.toString()));
        SandboxConfig config = dockerConfig(script.toString());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            Future<ExecResult> first = pool.submit(
                () -> runner.exec(handle, ExecRequest.of("echo a", Duration.ofSeconds(5))));
            Future<ExecResult> second = pool.submit(
                () -> runner.exec(handle, ExecRequest.of("echo b", Duration.ofSeconds(5))));

            ExecResult firstResult = first.get(10, TimeUnit.SECONDS);
            ExecResult secondResult = second.get(10, TimeUnit.SECONDS);
            assertTrue(firstResult.passed(), firstResult.output());
            assertTrue(secondResult.passed(), secondResult.output());
            assertFalse(firstResult.output().contains("OVERLAP"), firstResult.output());
            assertFalse(secondResult.output().contains("OVERLAP"), secondResult.output());
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void capsExecAtTheConfiguredTimeout() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            state='__STATE__'
            write_state() { printf '%s\n' "$1" > "$state.$$"; mv "$state.$$" "$state"; }
            case "$1" in
              run) write_state true; exit 0 ;;
              inspect)
                case "$*" in
                  *"State.Running"*) cat "$state" 2>/dev/null || echo true ;;
                  *) echo true ;;
                esac
                ;;
              kill|rm) write_state false; exit 0 ;;
              exec) sleep 10 ;;
              *) exit 0 ;;
            esac
            """.replace("__STATE__", log + ".state"));
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
            state='__STATE__'
            write_state() { printf '%s\n' "$1" > "$state.$$"; mv "$state.$$" "$state"; }
            case "$1" in
              run) write_state true; exit 0 ;;
              inspect)
                case "$*" in
                  *"State.Running"*) cat "$state" 2>/dev/null || echo true ;;
                  *) echo true ;;
                esac
                ;;
              kill|rm) write_state false; exit 0 ;;
              exec) sleep 10 ;;
              *) exit 0 ;;
            esac
            """.replace("__STATE__", log + ".state"));
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
                if [ "$last" = "-" ]; then
                  tmp=$(mktemp -d)
                  head -c 100 /dev/zero > "$tmp/big"
                  tar -C "$tmp" -cf - big
                  rm -rf "$tmp"
                fi
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
    void getFileRejectsASymlinkTarEntryDespiteAPassingGuard() throws IOException {
        assertTarEntryRejected("""
            tmp=$(mktemp -d)
            ln -s /etc/passwd "$tmp/leak"
            tar -C "$tmp" -cf - leak
            rm -rf "$tmp"
            """);
    }

    @Test
    void getFileRejectsAFifoTarEntryDespiteAPassingGuard() throws IOException {
        assertTarEntryRejected("""
            tmp=$(mktemp -d)
            mkfifo "$tmp/fifo"
            tar -C "$tmp" -cf - fifo
            rm -rf "$tmp"
            """);
    }

    @Test
    void getFileFailsWhenTheTarReaderDoesNotSeeEof() throws IOException {
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
                if [ "$last" = "-" ]; then
                  tmp=$(mktemp -d)
                  printf 'hello' > "$tmp/file.txt"
                  tar -C "$tmp" -cf "$tmp/archive.tar" file.txt
                  # Emit only the header and data block so the reader must wait
                  # for another header, then hold the pipe open after exit.
                  dd if="$tmp/archive.tar" bs=512 count=2 2>/dev/null
                  rm -rf "$tmp"
                  (sleep 10) &
                fi
                ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        Path local = Files.writeString(tempDir.resolve("existing.txt"), "keep");

        IOException error;
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            error = assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/file.txt", local));
        }

        assertTrue(error.getMessage().contains("output reader did not finish"),
            error.getMessage());
        assertEquals("keep", Files.readString(local));
        try (var listing = Files.list(tempDir)) {
            assertFalse(listing.anyMatch(path -> path.getFileName().toString()
                .startsWith(".sandbox-download-")));
        }
    }

    @Test
    void tarReaderFailureIsNotReadBeforeCompletion() throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicInteger aborted = new AtomicInteger();
        AtomicBoolean read = new AtomicBoolean();
        Supplier<Throwable> failure = () -> {
            read.set(true);
            throw new AssertionError("failure read before the reader finished");
        };

        IOException error = assertThrows(IOException.class,
            () -> DockerSandboxRunner.awaitReaderFailure(
                done, failure, aborted::incrementAndGet, "/workspace/file.txt"));

        assertTrue(error.getMessage().contains("did not finish"), error.getMessage());
        assertEquals(1, aborted.get());
        assertFalse(read.get());
    }

    @Test
    void tarReaderFailureIsReadAfterCompletion() throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicInteger aborted = new AtomicInteger();
        IOException marker = new IOException("tar entry is not a regular file");
        done.countDown();

        Throwable result = DockerSandboxRunner.awaitReaderFailure(
            done, () -> marker, aborted::incrementAndGet, "/workspace/file.txt");

        assertSame(marker, result);
        assertEquals(0, aborted.get());
    }

    private void assertTarEntryRejected(String emitTar) throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        String body = """
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
                if [ "$last" = "-" ]; then
                  @@EMIT_TAR@@
                fi
                ;;
              *) exit 0 ;;
            esac
            """;
        Path script = fakeDocker(log, body.replace("@@EMIT_TAR@@", emitTar));
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_DOCKER_BIN", script.toString(),
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_ARTIFACT_MAX_BYTES", "10"
        )::get);
        Path local = Files.writeString(tempDir.resolve("existing.txt"), "keep");

        IOException error;
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            error = assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/file.txt", local));
        }

        assertTrue(error.getCause() != null
                && error.getCause().getMessage().contains("not a regular file"),
            String.valueOf(error.getCause()));
        assertEquals("keep", Files.readString(local));
        assertTrue(Files.readString(log).contains(":/workspace/file.txt -"),
            Files.readString(log));
        try (var listing = Files.list(tempDir)) {
            assertFalse(listing.anyMatch(path -> path.getFileName().toString()
                .startsWith(".sandbox-download-")));
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
                if [ "$last" = "-" ]; then
                  tmp=$(mktemp -d)
                  head -c 100 /dev/zero > "$tmp/big"
                  tar -C "$tmp" -cf - big
                  rm -rf "$tmp"
                fi
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

        IOException error;
        try (DockerSandboxRunner runner = new DockerSandboxRunner(config)) {
            SandboxHandle handle = runner.create(config.specFor(workspace()));
            error = assertThrows(IOException.class,
                () -> runner.getFile(handle, "/workspace/file.txt", local));
        }

        assertTrue(error.getCause() != null
                && error.getCause().getMessage().contains("size bound"),
            String.valueOf(error.getCause()));
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
            state='__STATE__'
            write_state() { printf '%s\n' "$1" > "$state.$$"; mv "$state.$$" "$state"; }
            case "$1" in
              run) write_state true; exit 0 ;;
              inspect)
                case "$*" in
                  *"State.Running"*) cat "$state" 2>/dev/null || echo true ;;
                  *) echo true ;;
                esac
                ;;
              kill|rm) write_state false; exit 0 ;;
              exec)
                rm -rf '__WORKSPACE__'
                sleep 10
                ;;
              *) exit 0 ;;
            esac
            """.replace("__WORKSPACE__", workspace.toString())
            .replace("__STATE__", log + ".state");
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

    @Test
    void createInitializesAProfileCacheVolumeAndMountsIt() throws IOException {
        Assumptions.assumeFalse(windows(), "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("cache-docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              volume)
                case "$2" in
                  inspect) exit 1 ;;
                  create) exit 0 ;;
                  *) exit 1 ;;
                esac
                ;;
              run) exit 0 ;;
              inspect) echo true ;;
              rm) exit 0 ;;
              network) exit 0 ;;
              *) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script.toString());
        RepoProfile profile = new com.fasterxml.jackson.databind.ObjectMapper().readValue("""
            {
              "schema_version": 1,
              "image": "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "verify": ["npm test"],
              "caches": ["npm"],
              "env": {"NODE_ENV": "test"}
            }
            """, RepoProfile.class);
        SandboxConfig effective = config.withRepoProfile(profile, "7", 2);

        try (DockerSandboxRunner runner = new DockerSandboxRunner(effective)) {
            SandboxHandle handle = runner.create(effective.specFor(workspace()));
            runner.destroy(handle);
        }

        String calls = Files.readString(log);
        assertTrue(calls.contains("volume inspect vibecode-repo-cache-7-2"), calls);
        assertTrue(calls.contains("volume create --label vibecode.sandbox.cache=true"), calls);
        assertTrue(calls.contains("vibecode-repo-cache-7-2"), calls);
        assertTrue(calls.contains("chown -R 1000:1000 /cache"), calls);
        assertTrue(calls.contains("-v vibecode-repo-cache-7-2:/cache:rw"), calls);
        assertTrue(calls.contains("-e NPM_CONFIG_CACHE=/cache/npm"), calls);
        assertTrue(calls.contains("-e NODE_ENV=test"), calls);
    }

    private Path fakeDocker(Path log, String body) throws IOException {
        return fakeDocker(log, body, "4242");
    }

    private Path fakeDocker(Path log, String body, String initPid) throws IOException {
        Path script = tempDir.resolve("fake-docker.sh");
        // `docker top` reports host PIDs, so the quiescence check reads the
        // init host PID from inspect before parsing the process table.
        // Tests that do not script `top` get a header and a single init row.
        String emptyTable = body.contains("top)")
            ? ""
            : "if [ \"$1\" = top ]; then\n"
                + "  echo 'PID STAT COMMAND'\n"
                + "  echo '" + initPid + " Ss sleep'\n"
                + "  exit 0\n"
                + "fi\n";
        String content = "#!/bin/sh\n"
            + "printf '%s\\n' \"$*\" >> '" + log + "'\n"
            + "if [ \"$1\" = inspect ]; then\n"
            + "  case \"$*\" in\n"
            + "    *\".State.Pid\"*) echo '" + initPid + "'; exit 0 ;;\n"
            + "  esac\n"
            + "fi\n"
            + emptyTable
            + body + "\n";
        Files.writeString(script, content);
        try {
            Files.setPosixFilePermissions(script, PosixFilePermissions.fromString("rwxr-xr-x"));
        } catch (UnsupportedOperationException e) {
            script.toFile().setExecutable(true);
        }
        return script;
    }
}
