package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SandboxConfigTest {

    @TempDir
    Path tempDir;

    private static Map<String, String> env(String... entries) {
        Map<String, String> env = new HashMap<>();
        for (int i = 0; i < entries.length; i += 2) {
            env.put(entries[i], entries[i + 1]);
        }
        return env;
    }

    @Test
    void defaultsToHostModeWithConservativeLimits() {
        SandboxConfig config = SandboxConfig.from(name -> null);

        assertTrue(config.isHost());
        assertFalse(config.isDocker());
        assertEquals(SandboxConfig.DEFAULT_IMAGE, config.image());
        assertEquals(SandboxConfig.DEFAULT_DOCKER_BINARY, config.dockerBinary());
        assertEquals(Duration.ofMinutes(15), config.execTimeout());
        assertEquals("2.0", config.limits().cpus());
        assertEquals(2L * 1024 * 1024 * 1024, config.limits().memoryBytes());
        assertEquals(512, config.limits().pids());
        assertEquals(1_024, config.limits().openFiles());
        assertEquals(256L * 1024 * 1024, config.limits().tmpfsBytes());
        assertEquals(5120L * 1024 * 1024, config.limits().diskBytes());
        assertEquals(Duration.ofSeconds(10), config.diskCheckInterval());
        assertFalse(config.limits().diskEnforced());
        assertFalse(config.networkEnabled());
        assertEquals(List.of(), config.allowedHosts());
        assertEquals(Map.of(), config.runEnv());
        assertFalse(config.requireSandbox());
        assertTrue(config.user().matches("\\d+(:\\d+)?"), config.user());
    }

    @Test
    void parsesDockerConfiguration() {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "example/sandbox@sha256:abc",
            "SANDBOX_CPUS", "1.5",
            "SANDBOX_MEMORY_MB", "512",
            "SANDBOX_PIDS", "128",
            "SANDBOX_DISK_MB", "1024",
            "SANDBOX_DISK_ENFORCE", "true",
            "SANDBOX_NOFILE", "256",
            "SANDBOX_TMPFS_MB", "64",
            "SANDBOX_USER", "1000:1000",
            "SANDBOX_REQUIRE", "true",
            "SANDBOX_EXEC_TIMEOUT_SECONDS", "120",
            "SANDBOX_ENV", "CI=1;FEATURE_FLAG=on",
            "SANDBOX_CONTAINER_WORKSPACE_ROOT", "/repos"
        )::get);

        assertTrue(config.isDocker());
        assertEquals("example/sandbox@sha256:abc", config.image());
        assertEquals(Duration.ofSeconds(120), config.execTimeout());
        assertEquals("1.5", config.limits().cpus());
        assertEquals(512L * 1024 * 1024, config.limits().memoryBytes());
        assertEquals(128, config.limits().pids());
        assertEquals(1024L * 1024 * 1024, config.limits().diskBytes());
        assertTrue(config.limits().diskEnforced());
        assertEquals("1000:1000", config.user());
        assertEquals(Map.of("CI", "1", "FEATURE_FLAG", "on"), config.runEnv());
        assertTrue(config.requireSandbox());
    }

    @Test
    void rejectsUnknownMode() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env("SANDBOX_MODE", "vm")::get));
        assertTrue(error.getMessage().contains("SANDBOX_MODE"));
    }

    @Test
    void rejectsPodmanBecauseTheRunnerUsesDockerFlags() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env("SANDBOX_MODE", "podman")::get));
        assertTrue(error.getMessage().contains("host, docker"));
    }

    @Test
    void rejectsAmbiguousBooleansInsteadOfFailingOpen() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "host",
                "SANDBOX_REQUIRE", "yes"
            )::get));
        assertTrue(error.getMessage().contains("SANDBOX_REQUIRE"));
    }

    @Test
    void rejectsMalformedNumericLimits() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_MEMORY_MB", "lots"
            )::get));
        assertTrue(error.getMessage().contains("SANDBOX_MEMORY_MB"));
    }

    @Test
    void requireSandboxRefusesHostMode() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env("SANDBOX_REQUIRE", "true")::get));
        assertTrue(error.getMessage().contains("SANDBOX_REQUIRE"));
    }

    @Test
    void acceptsAnEgressAllowlistWithConcreteHosts() {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org,*.githubusercontent.com"
        )::get);

        assertTrue(config.networkEnabled());
        assertEquals(
            List.of("registry.npmjs.org", "*.githubusercontent.com"),
            config.allowedHosts());
        assertEquals("bridge", config.egressUpstreamNetwork());
    }

    @Test
    void rejectsAnAllowlistWithoutHosts() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_NETWORK", "allowlist"
            )::get));
        assertTrue(error.getMessage().contains("SANDBOX_ALLOWED_HOSTS"));
    }

    @Test
    void rejectsAnAllowlistInHostMode() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_NETWORK", "allowlist",
                "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org"
            )::get));
        assertTrue(error.getMessage().contains("SANDBOX_MODE=docker"));
    }

    @Test
    void rejectsUnknownNetworkModes() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_NETWORK", "proxy"
            )::get));
        assertTrue(error.getMessage().contains("none, allowlist"));
    }

    @Test
    void rejectsInternalMetadataAndIpAllowlistEntries() {
        for (String host : List.of(
            "localhost", "127.0.0.1", "169.254.169.254",
            "10.0.0.1", "metadata.google.internal", "host.docker.internal",
            "*.local", "*")) {
            assertThrows(IllegalStateException.class,
                () -> SandboxConfig.from(env(
                    "SANDBOX_MODE", "docker",
                    "SANDBOX_NETWORK", "allowlist",
                    "SANDBOX_ALLOWED_HOSTS", host
                )::get),
                "expected " + host + " to be rejected");
        }
    }

    @Test
    void rejectsAnExternalEgressProxyUrl() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_NETWORK", "allowlist",
                "SANDBOX_ALLOWED_HOSTS", "registry.npmjs.org",
                "SANDBOX_EGRESS_PROXY", "http://proxy:3128"
            )::get));
        assertTrue(error.getMessage().contains("SANDBOX_EGRESS_PROXY"));
    }

    @Test
    void rejectsSecretBearingEnvironment() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_ENV", "SAFE=1;AI_API_KEY=sk-live"
            )::get));
        assertTrue(error.getMessage().contains("AI_API_KEY"));
    }

    @Test
    void rejectsCredentialUrlsInEnvironment() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_ENV", "DATABASE_URL=postgres://user:secret@db/test"
            )::get));
        assertTrue(error.getMessage().contains("credentials"));
    }

    @Test
    void rejectsBareKeyNames() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_ENV", "OPENAI_KEY=sk-live"
            )::get));
        assertTrue(error.getMessage().contains("OPENAI_KEY"));
    }

    @Test
    void rejectsSchemeLessCredentialUrls() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_ENV", "HTTP_PROXY=proxy-user:proxy-pass@proxy:8080"
            )::get));
        assertTrue(error.getMessage().contains("credentials"));
    }

    @Test
    void rejectsNonFiniteCpuLimits() {
        assertThrows(IllegalStateException.class, () -> SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_CPUS", "NaN"
        )::get));
        assertThrows(IllegalStateException.class, () -> SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_CPUS", "Infinity"
        )::get));
    }

    @Test
    void rejectsSchemeLessCredentialUrlsWithDoubleSlash() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_ENV", "HTTP_PROXY=//proxy-user:proxy-pass@proxy:8080"
            )::get));
        assertTrue(error.getMessage().contains("credentials"));
    }

    @Test
    void allowsNonSecretDatabaseUrl() {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_ENV", "DATABASE_URL=postgres://db/test"
        )::get);
        assertEquals(Map.of("DATABASE_URL", "postgres://db/test"), config.runEnv());
    }

    @Test
    void rejectsRootSandboxUser() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_USER", "0:0"
            )::get));
        assertTrue(error.getMessage().contains("root"));
    }

    @Test
    void allowRootIsExplicit() {
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_USER", "0:0",
            "SANDBOX_ALLOW_ROOT", "true"
        )::get);
        assertEquals("0:0", config.user());
    }

    @Test
    void rejectsMalformedUser() {
        assertThrows(IllegalStateException.class, () -> SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_USER", "user:group"
        )::get));
    }

    @Test
    void diskEnforcementRequiresAPositiveLimit() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(env(
                "SANDBOX_MODE", "docker",
                "SANDBOX_DISK_MB", "0",
                "SANDBOX_DISK_ENFORCE", "true"
            )::get));
        assertTrue(error.getMessage().contains("SANDBOX_DISK_ENFORCE"));
    }

    @Test
    void specForRejectsSymlinkedWorkspace() throws IOException {
        Path real = Files.createDirectories(tempDir.resolve("real"));
        Path link = tempDir.resolve("link");
        try {
            Files.createSymbolicLink(link, real);
        } catch (UnsupportedOperationException | IOException e) {
            return;
        }

        SandboxConfig config = SandboxConfig.from(env("SANDBOX_MODE", "docker")::get);
        assertThrows(IOException.class, () -> config.specFor(link));
    }

    @Test
    void mapsContainerWorkspaceToTheDaemonVisibleHostPath() throws IOException {
        Path containerRoot = Files.createDirectories(tempDir.resolve("repos"));
        Path workspace = Files.createDirectories(containerRoot.resolve("run-1"));
        Files.createDirectories(workspace.resolve(".git"));

        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_CONTAINER_WORKSPACE_ROOT", containerRoot.toString(),
            "SANDBOX_HOST_WORKSPACE_ROOT", "/host/agent-workspaces"
        )::get);

        SandboxSpec spec = config.specFor(workspace);
        assertEquals(workspace.toRealPath(), spec.workspace());
        assertEquals(Path.of("/host/agent-workspaces/run-1"), spec.mountSource());
        assertTrue(Files.isDirectory(spec.workspace().resolve(".git")));
        assertFalse(Files.exists(spec.mountSource().resolve(".git")),
            "the mapped daemon path is intentionally not visible in the supervisor test");
    }

    @Test
    void rejectsWorkspaceOutsideTheMappedContainerRoot() throws IOException {
        Path workspace = Files.createDirectories(tempDir.resolve("elsewhere"));
        SandboxConfig config = SandboxConfig.from(env(
            "SANDBOX_MODE", "docker",
            "SANDBOX_CONTAINER_WORKSPACE_ROOT", "/repos",
            "SANDBOX_HOST_WORKSPACE_ROOT", "/host/agent-workspaces"
        )::get);

        assertThrows(IOException.class, () -> config.specFor(workspace));
    }

    @Test
    void specAddsNonSecretVerificationDefaults() throws IOException {
        Path workspace = Files.createDirectories(tempDir.resolve("workspace"));
        SandboxConfig config = SandboxConfig.from(env("SANDBOX_MODE", "docker")::get);

        SandboxSpec spec = config.specFor(workspace);

        assertEquals("1", spec.env().get("CI"));
        assertEquals("1", spec.env().get("GIT_CONFIG_NOSYSTEM"));
        assertEquals("/dev/null", spec.env().get("GIT_CONFIG_GLOBAL"));
        assertEquals("1", spec.env().get("HARNESS_VERIFICATION"));
        assertFalse(spec.env().containsKey("HOME"));
    }
}
