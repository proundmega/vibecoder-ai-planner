package com.vibecode.agent.harness;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class SandboxIntegrationScriptTest {

    private static final Path SCRIPT = Path.of(
        "scripts", "sandbox-integration-test.sh").toAbsolutePath();

    @TempDir
    Path tempDir;

    @BeforeEach
    void requireBash() {
        assumeTrue(bashAvailable(), "bash is not available on this platform");
    }

    @Test
    void buildsBothImagesAndRunsTheDockerSuite() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(Map.of());

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker build --load -f " + fixture.root
            + "/sandbox.Dockerfile -t vibecode-agent-sandbox:ci"), log);
        assertTrue(log.contains("docker build --load -f " + fixture.root
            + "/sandbox-proxy.Dockerfile -t vibecode-sandbox-proxy:ci"), log);
        assertTrue(log.contains(fixture.root.toString()), log);
        assertTrue(log.contains("mvn -Dtest=DockerSandboxRunnerIntegrationTest test"), log);
        assertTrue(log.contains("SANDBOX_IT_IMAGE=vibecode-agent-sandbox:ci"), log);
        assertTrue(log.contains("SANDBOX_IT_PROXY_IMAGE=vibecode-sandbox-proxy:ci"), log);
        assertFalse(log.contains("SANDBOX_IT_NETWORK_IMAGE="), log);
    }

    @Test
    void fr2SandboxAndProxyBuildsCarryCiLabelsAndBuildTag() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(Map.of(
            "VIBECODE_CI", "true",
            "VIBECODE_CI_JOB", "planner/main",
            "VIBECODE_CI_BUILD", "7",
            "SANDBOX_IT_BUILD_TAG", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("--label com.vibecode.ci=true"), log);
        assertTrue(log.contains("--label com.vibecode.ci.job=planner/main"), log);
        assertTrue(log.contains("--label com.vibecode.ci.build=7"), log);
        assertTrue(log.contains("-t vibecode-agent-sandbox:7"), log);
        assertTrue(log.contains("-t vibecode-sandbox-proxy:7"), log);
    }

    @Test
    void passesTheNetworkImageWhenTheEgressSuiteIsEnabled() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(Map.of("SANDBOX_IT_NETWORK", "1"));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("SANDBOX_IT_NETWORK_IMAGE=vibecode-agent-sandbox:ci"), log);
    }

    @Test
    void skipsTheBuildsWhenRequested() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(Map.of("SANDBOX_IT_BUILD", "0"));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("docker build"), log);
        assertTrue(log.contains("mvn -Dtest=DockerSandboxRunnerIntegrationTest test"), log);
    }

    @Test
    void honoursCustomImageTags() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(Map.of(
            "SANDBOX_IT_IMAGE", "sandbox:under-test",
            "SANDBOX_IT_PROXY_IMAGE", "proxy:under-test"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("-t sandbox:under-test"), log);
        assertTrue(log.contains("-t proxy:under-test"), log);
        assertTrue(log.contains("SANDBOX_IT_IMAGE=sandbox:under-test"), log);
        assertTrue(log.contains("SANDBOX_IT_PROXY_IMAGE=proxy:under-test"), log);
    }

    @Test
    void failsWhenTheBuiltImageIsNotVisibleToTheDaemon() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(Map.of("FAIL_IMAGE_INSPECT", "1"));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains(
            "is not present after the build"), result.output);
        assertTrue(Files.readString(fixture.log).contains("docker info"),
            result.output);
    }

    private Fixture fixture() throws IOException {
        Path root = Files.createDirectories(tempDir.resolve("agent"));
        Path scripts = Files.createDirectories(root.resolve("scripts"));
        Path script = scripts.resolve("sandbox-integration-test.sh");
        Files.copy(SCRIPT, script);
        Files.writeString(root.resolve("sandbox.Dockerfile"), "FROM scratch\n");
        Files.writeString(root.resolve("sandbox-proxy.Dockerfile"), "FROM scratch\n");

        Path bin = Files.createDirectories(tempDir.resolve("bin"));
        Path log = tempDir.resolve("commands.log");
        writeStub(bin, "docker", """
            if [ "${FAIL_IMAGE_INSPECT:-0}" = "1" ] && [ "$1" = "image" ]; then
                echo "Error: No such image" >&2
                exit 1
            fi
            echo "docker $*" >> "$COMMAND_LOG"
            """);
        writeStub(bin, "mvn", """
            echo "mvn $* SANDBOX_IT_IMAGE=${SANDBOX_IT_IMAGE:-} SANDBOX_IT_PROXY_IMAGE=${SANDBOX_IT_PROXY_IMAGE:-}" >> "$COMMAND_LOG"
            if [ -n "${SANDBOX_IT_NETWORK_IMAGE:-}" ]; then
                echo "SANDBOX_IT_NETWORK_IMAGE=$SANDBOX_IT_NETWORK_IMAGE" >> "$COMMAND_LOG"
            fi
            """);
        return new Fixture(root, script, bin, log);
    }

    private void writeStub(Path dir, String name, String body) throws IOException {
        Path stub = dir.resolve(name);
        Files.writeString(stub, "#!/usr/bin/env bash\n" + body);
        Files.setPosixFilePermissions(stub, PosixFilePermissions.fromString("rwxr-xr-x"));
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

    private record Fixture(Path root, Path script, Path bin, Path log) {

        Result run(Map<String, String> extraEnv) throws IOException, InterruptedException {
            List<String> command = List.of("bash", script.toString());
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            Map<String, String> env = builder.environment();
            env.remove("SANDBOX_IT_IMAGE");
            env.remove("SANDBOX_IT_PROXY_IMAGE");
            env.remove("SANDBOX_IT_NETWORK");
            env.remove("SANDBOX_IT_NETWORK_IMAGE");
            env.remove("SANDBOX_IT_BUILD");
            env.put("COMMAND_LOG", log.toString());
            env.putAll(extraEnv);
            env.put("PATH", bin + ":" + env.getOrDefault("PATH", ""));
            Process process = builder.start();
            String output = new String(process.getInputStream().readAllBytes(),
                StandardCharsets.UTF_8);
            return new Result(process.waitFor(), output);
        }
    }

    private record Result(int exitCode, String output) {
    }
}
