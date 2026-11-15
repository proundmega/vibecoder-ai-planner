package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SandboxRunnerFactoryTest {

    @TempDir
    Path tempDir;

    @Test
    void hostModeReturnsTheHostRunner() {
        SandboxRunner runner = SandboxRunnerFactory.create(SandboxConfig.defaults());
        assertInstanceOf(HostSandboxRunner.class, runner);
    }

    @Test
    void dockerModeReturnsTheDockerRunner() {
        SandboxConfig config = SandboxConfig.from(Map.of(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000"
        )::get);

        SandboxRunner runner = SandboxRunnerFactory.create(config);
        assertInstanceOf(DockerSandboxRunner.class, runner);
    }

    @Test
    void productionGuardRefusesHostModeAtConfigLoad() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(Map.of(
                "SANDBOX_REQUIRE", "true",
                "SANDBOX_USER", "1000:1000"
            )::get));

        assertTrue(error.getMessage().contains("SANDBOX_REQUIRE"));
    }

    @Test
    void dockerFactoryReapsSameOwnerResources() throws Exception {
        Assumptions.assumeFalse(System.getProperty("os.name", "").toLowerCase().contains("win"),
            "fake docker script relies on POSIX sh");
        Path log = tempDir.resolve("docker.log");
        Path script = fakeDocker(log, """
            case "$1" in
              ps) echo abcdef123456 ;;
              network)
                case "$2" in
                  ls) echo 1234567890ab ;;
                  rm) exit 0 ;;
                esac
                ;;
              rm) exit 0 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script, "agent-42");

        try (SandboxRunner runner = SandboxRunnerFactory.create(config)) {
            assertInstanceOf(DockerSandboxRunner.class, runner);
        }

        String commands = Files.readString(log);
        assertTrue(commands.contains("ps -aq --filter label=vibecode.sandbox.owner=agent-42"),
            commands);
        assertTrue(commands.contains("rm -f abcdef123456"), commands);
        assertTrue(commands.contains("network rm 1234567890ab"), commands);
    }

    @Test
    void dockerFactorySkipsReapingWithoutAnOwner() throws Exception {
        Path log = tempDir.resolve("docker-empty.log");
        Path script = fakeDocker(log, "exit 0");
        SandboxConfig config = dockerConfig(script, null);

        try (SandboxRunner runner = SandboxRunnerFactory.create(config)) {
            assertInstanceOf(DockerSandboxRunner.class, runner);
        }

        assertTrue(!Files.exists(log), "no Docker calls expected without an owner");
    }

    @Test
    void reapingFailuresDoNotBlockFactoryStartup() throws Exception {
        Path log = tempDir.resolve("docker-fail.log");
        Path script = fakeDocker(log, """
            case "$1" in
              ps) exit 1 ;;
              network) exit 1 ;;
            esac
            """);
        SandboxConfig config = dockerConfig(script, "agent-42");

        try (SandboxRunner runner = SandboxRunnerFactory.create(config)) {
            assertInstanceOf(DockerSandboxRunner.class, runner);
        }

        assertTrue(Files.readString(log).contains("ps -aq"), Files.readString(log));
    }

    private SandboxConfig dockerConfig(Path docker, String owner) {
        Map<String, String> env = new java.util.HashMap<>();
        env.put("SANDBOX_MODE", "docker");
        env.put("SANDBOX_IMAGE", "test:img");
        env.put("SANDBOX_USER", "1000:1000");
        env.put("SANDBOX_DOCKER_BIN", docker.toString());
        if (owner != null) {
            env.put("AGENT_ID", owner);
        }
        return SandboxConfig.from(env::get);
    }

    private static Path fakeDocker(Path log, String body) throws IOException {
        Path script = log.getParent().resolve("fake-docker-" + System.nanoTime() + ".sh");
        Files.writeString(script, "#!/bin/sh\n"
            + "printf '%s\\n' \"$*\" >> '" + log + "'\n"
            + body + "\n");
        try {
            Files.setPosixFilePermissions(script,
                java.nio.file.attribute.PosixFilePermissions.fromString("rwxr-xr-x"));
        } catch (UnsupportedOperationException e) {
            script.toFile().setExecutable(true);
        }
        return script;
    }

    @Test
    void hostOnlyReturnsTheCompatibilityRunner() {
        assertInstanceOf(HostSandboxRunner.class, SandboxRunnerFactory.hostOnly());
    }
}
