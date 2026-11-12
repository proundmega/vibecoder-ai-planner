package com.vibecode.agent.harness;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class SandboxCiEnvScriptTest {

    private static final Path SCRIPT = Path.of(
        "scripts", "sandbox-ci-env.sh").toAbsolutePath();

    @TempDir
    Path tempDir;

    private Path bin;

    @BeforeEach
    void setUp() throws IOException {
        assumeTrue(bashAvailable(), "bash is not available on this platform");
        bin = Files.createDirectories(tempDir.resolve("bin"));
        Path docker = bin.resolve("docker");
        Files.writeString(docker, """
            #!/usr/bin/env bash
            if [ "$1" = "info" ]; then
                [ "${FAKE_LOCAL_DOCKER:-0}" = "1" ] && exit 0 || exit 1
            fi
            if [ "$1" = "inspect" ]; then
                echo "${FAKE_INSPECT_SOURCE:-}"
                exit 0
            fi
            exit 0
            """);
        Files.setPosixFilePermissions(docker,
            PosixFilePermissions.fromString("rwxr-xr-x"));
    }

    @Test
    void prefersTheLocalDockerSocket() throws Exception {
        Result result = run(Map.of(
            "FAKE_LOCAL_DOCKER", "1",
            "DOCKER_HOST", "unix:///proxy.sock",
            "WORKSPACE", "/tmp/build"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertEquals("unix:///var/run/docker.sock", result.value("DOCKER_HOST"));
        assertEquals("/tmp/build", result.value("HOST_WORKSPACE"));
    }

    @Test
    void mapsTheWorkspaceThroughJenkinsHostHome() throws Exception {
        Result result = run(Map.of(
            "FAKE_LOCAL_DOCKER", "0",
            "DOCKER_HOST", "unix:///proxy.sock",
            "JENKINS_HOME", "/var/jenkins_home",
            "JENKINS_HOST_HOME", "/host/jenkins",
            "WORKSPACE", "/var/jenkins_home/workspace/job"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertEquals("unix:///proxy.sock", result.value("DOCKER_HOST"));
        assertEquals("/host/jenkins/workspace/job", result.value("HOST_WORKSPACE"));
    }

    @Test
    void discoversTheHostHomeThroughTheOriginalDaemon() throws Exception {
        Result result = run(Map.of(
            "FAKE_LOCAL_DOCKER", "0",
            "FAKE_INSPECT_SOURCE", "/host/inspect",
            "DOCKER_HOST", "unix:///proxy.sock",
            "JENKINS_HOME", "/var/jenkins_home",
            "WORKSPACE", "/var/jenkins_home/workspace/job"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertEquals("/host/inspect/workspace/job", result.value("HOST_WORKSPACE"));
    }

    @Test
    void fallsBackToIdentityMapping() throws Exception {
        Result result = run(Map.of(
            "FAKE_LOCAL_DOCKER", "0",
            "DOCKER_HOST", "unix:///proxy.sock",
            "JENKINS_HOME", "/var/jenkins_home",
            "WORKSPACE", "/var/jenkins_home/workspace/job"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertEquals("/var/jenkins_home/workspace/job", result.value("HOST_WORKSPACE"));
        assertTrue(result.output.contains("using identity mapping"), result.output);
    }

    @Test
    void leavesANonJenkinsWorkspaceUnchanged() throws Exception {
        Result result = run(Map.of(
            "FAKE_LOCAL_DOCKER", "0",
            "DOCKER_HOST", "unix:///proxy.sock",
            "JENKINS_HOME", "/var/jenkins_home",
            "JENKINS_HOST_HOME", "/host/jenkins",
            "WORKSPACE", "/tmp/build"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertEquals("/tmp/build", result.value("HOST_WORKSPACE"));
    }

    private Result run(Map<String, String> extraEnv) throws Exception {
        String command = ". " + SCRIPT + "; "
            + "printf 'DOCKER_HOST=%s\\nHOST_WORKSPACE=%s\\n' "
            + "\"${DOCKER_HOST:-}\" \"${SANDBOX_CI_HOST_WORKSPACE:-}\"";
        ProcessBuilder builder = new ProcessBuilder("bash", "-c", command);
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.remove("DOCKER_HOST");
        env.remove("DOCKER_HOST_FALLBACK");
        env.remove("JENKINS_HOME");
        env.remove("JENKINS_HOST_HOME");
        env.remove("WORKSPACE");
        env.put("PATH", bin + ":" + env.getOrDefault("PATH", ""));
        env.putAll(extraEnv);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(),
            StandardCharsets.UTF_8);
        return new Result(process.waitFor(), output);
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

    private record Result(int exitCode, String output) {

        String value(String key) {
            for (String line : output.split("\\R")) {
                if (line.startsWith(key + "=")) {
                    return line.substring(key.length() + 1);
                }
            }
            return "";
        }
    }
}
