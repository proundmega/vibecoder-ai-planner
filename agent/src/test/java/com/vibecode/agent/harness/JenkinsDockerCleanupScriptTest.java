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

class JenkinsDockerCleanupScriptTest {

    private static final Path SCRIPT = Path.of(
        "scripts", "jenkins-docker-cleanup.sh").toAbsolutePath();
    private static final Path HELPER = Path.of(
        "scripts", "sandbox-ci-env.sh").toAbsolutePath();

    @TempDir
    Path tempDir;

    @BeforeEach
    void requireBash() {
        assumeTrue(bashAvailable(), "bash is not available on this platform");
    }

    @Test
    void fr1ComposeProjectTeardownIsScopedAndUsesTheValidatedName() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker compose -f " + fixture.root
            + "/docker-compose.yml -f " + fixture.root
            + "/docker-compose.test.yml -f " + fixture.root
            + "/docker-compose.e2e.yml --profile e2e -p vibecode-pr-7-12 "
            + "down -v --rmi local --remove-orphans"), log);
    }

    @Test
    void fr4DryRunDoesNotTearDownOrRemoveAnything() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12",
            "--dry-run"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("down -v"), log);
        assertTrue(result.output.contains("DRY-RUN:"), result.output);
    }

    @Test
    void fr4RefusesTheLocalDevProjectAndUnrecognizedNames() throws Exception {
        Fixture fixture = fixture();

        Result local = fixture.run(List.of("--compose-project", "vibecoder-ai-planner"), Map.of());
        assertEquals(2, local.exitCode, local.output);
        assertTrue(local.output.contains("refusing unrecognized project name"), local.output);

        Result typo = fixture.run(List.of("--compose-project", "vibecode-pr"), Map.of());
        assertEquals(2, typo.exitCode, typo.output);
        assertTrue(typo.output.contains("refusing unrecognized project name"), typo.output);
    }

    @Test
    void nfr1MissingAnchorIsANoOp() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--compose-project", "vibecode-pr-7-12"),
            Map.of("FAKE_ANCHOR", "0"));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("nothing to do"), result.output);
        assertFalse(Files.readString(fixture.log).contains("down -v"), result.output);
    }

    @Test
    void fr2BuildImageRemovalKeepsTheSharedCiAlias() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:ci vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker image rm vibecode-agent:7"), log);
        assertFalse(log.contains("docker image rm vibecode-agent:ci"), log);
        assertTrue(result.output.contains("keeping shared alias vibecode-agent:ci"), result.output);
    }

    @Test
    void fr3OrphanGcKeepsSharedCiAlias() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:ci",
            "FAKE_BUILD_LABEL", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("keeping shared alias vibecode-agent:ci"),
            result.output);
        assertFalse(Files.readString(fixture.log).contains("docker image rm vibecode-agent:ci"),
            result.output);
    }

    @Test
    void nfr2GraceAndBuildIdSkipCurrentResources() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7",
            "CI_CURRENT_BUILD_ID", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertFalse(Files.readString(fixture.log).contains("docker image rm vibecode-agent:7"),
            result.output);
    }

    @Test
    void nfr4RetentionValuesComeFromEnvironment() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_PS", "container1\t2020-01-01 00:00:00 +0000 UTC\texited",
            "CI_CONTAINER_GRACE_HOURS", "999999"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertFalse(result.output.contains("docker rm -f container1"), result.output);
    }

    @Test
    void nfr5WorkspaceDaemonFileCannotRedirectCleanup() throws Exception {
        Fixture fixture = fixture();
        Path target = Files.createDirectories(fixture.root.resolve("target"));
        Files.writeString(target.resolve("ci-docker-daemon.env"),
            "CI_DOCKER_HOST=unix:///hostile.sock\n");

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("Using explicit Docker host unix:///fake.sock"),
            result.output);
        assertFalse(result.output.contains("hostile.sock"), result.output);
    }

    @Test
    void fr6LegacyInventoryIsReadOnlyAndProtectsSharedAliases() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--legacy-inventory"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_LEGACY_IMAGES", "vibecode-agent:ci\timg1\t2020-01-01\t1MB"
                + "\nvibecode-agent:7\timg2\t2020-01-01\t1MB"
                + "\nvibecode-agent:latest\timg3\t2020-01-01\t1MB"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("docker image rm"), log);
        assertFalse(log.contains("docker system prune"), log);
        assertFalse(log.contains("down -v"), log);
        assertTrue(result.output.contains("shared/current - do not remove: vibecode-agent:ci"),
            result.output);
        assertTrue(result.output.contains("candidate build image tag: vibecode-agent:7"), result.output);
        assertTrue(result.output.contains("not a build-unique tag - review only: vibecode-agent:latest"),
            result.output);
    }

    @Test
    void fr5PostCleanupUsesPipelineDaemon() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("Using explicit Docker host unix:///fake.sock"),
            result.output);
    }

    @Test
    void fr5PostCleanupFallsBackToExplicitHost() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12"), Map.of(
            "CI_DOCKER_HOST", "",
            "DOCKER_HOST", "unix:///fallback.sock"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("Using explicit Docker host unix:///fallback.sock"),
            result.output);
    }

    @Test
    void fr5DaemonMismatchFailsBeforeDeletion() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--compose-project", "vibecode-pr-7-12"),
            Map.of("CI_DOCKER_DAEMON_ID", "other-daemon"));

        assertEquals(2, result.exitCode, result.output);
        assertTrue(result.output.contains("daemon mismatch"), result.output);
        assertFalse(Files.readString(fixture.log).contains("down -v"), result.output);
    }

    @Test
    void fr3OrphanSandboxContainersRemoveOldRunningContainers() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_PS", "container1\t2020-01-01 00:00:00 +0000 UTC\trunning"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("DRY-RUN: docker rm -f container1"), result.output);
        assertFalse(Files.readString(fixture.log).contains("docker rm -f container1"),
            result.output);
    }

    @Test
    void fr3OrphanSandboxNetworksRemoveOldAttachedNetworks() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_SANDBOX_NETWORK", "sandbox-net",
            "FAKE_NETWORK_CONTAINERS", "1"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("DRY-RUN: docker network rm sandbox-net"),
            result.output);
    }

    @Test
    void fr3OrphanComposeProjectsRemoveOldRunningProjects() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_COMPOSE_JSON",
            "[{\"Name\":\"vibecode-pr-7-12\",\"Status\":\"running(1)\"}]"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("DRY-RUN: docker compose ... -p vibecode-pr-7-12"),
            result.output);
    }

    @Test
    void fr3OrphanCiImagesRemoveDanglingImages() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "",
            "FAKE_BUILD_LABEL", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains(
            "DRY-RUN: docker image rm img1 (old CI image with no :ci alias)"), result.output);
    }

    @Test
    void fr2BuildImageRemovalRemovesUntaggedImageId() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker image rm vibecode-agent:7"), log);
        assertTrue(log.contains("docker image rm img1"), log);
    }

    @Test
    void nfr3FakeDockerCoversAllCleanupPaths() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--legacy-inventory"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_LEGACY_IMAGES", "vibecode-agent:ci\timg1\t2020-01-01\t1MB"
                + "\nvibecode-agent:7\timg2\t2020-01-01\t1MB",
            "FAKE_DANGLING_IMAGES", "dangling1\t2020-01-01\t1MB",
            "FAKE_VOLUMES", "vibecode-pr-7-12_postgres_data\tlocal"
                + "\njenkins_home\tlocal"
                + "\npostgres_data\tlocal"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("docker image rm"), log);
        assertFalse(log.contains("down -v"), log);
        assertTrue(result.output.contains("dangling CI image - review only: dangling1"),
            result.output);
        assertTrue(result.output.contains("candidate volume: vibecode-pr-7-12_postgres_data"),
            result.output);
        assertTrue(result.output.contains("unrelated volume - review only: jenkins_home"),
            result.output);
        assertTrue(result.output.contains("EXCLUDED (shared volume): postgres_data"),
            result.output);
    }

    private Fixture fixture() throws IOException {
        Path root = Files.createDirectories(tempDir.resolve("agent"));
        Path scripts = Files.createDirectories(root.resolve("scripts"));
        Path script = scripts.resolve("jenkins-docker-cleanup.sh");
        Files.copy(SCRIPT, script);
        Files.copy(HELPER, scripts.resolve("sandbox-ci-env.sh"));
        Files.writeString(root.resolve("docker-compose.yml"), "services: {}\n");
        Files.writeString(root.resolve("docker-compose.test.yml"), "services: {}\n");
        Files.writeString(root.resolve("docker-compose.e2e.yml"), "services: {}\n");

        Path bin = Files.createDirectories(tempDir.resolve("bin"));
        Path log = tempDir.resolve("commands.log");
        Path docker = bin.resolve("docker");
        Files.writeString(docker, """
            #!/usr/bin/env bash
            echo "docker $*" >> "$COMMAND_LOG"
            case "$1" in
              info)
                echo "${FAKE_DAEMON_ID:-daemon-1}"
                ;;
              network)
                if [ "$2" = "ls" ]; then
                  case "$*" in
                    *label=vibecode.sandbox.managed=true*)
                      [ -n "${FAKE_SANDBOX_NETWORK:-}" ] && echo "$FAKE_SANDBOX_NETWORK"
                      ;;
                    *label=com.vibecode.ci=true*)
                      [ "${FAKE_ANCHOR:-1}" = "1" ] && echo "net-1"
                      ;;
                    *label=com.docker.compose.project=*)
                      [ "${FAKE_ANCHOR:-1}" = "1" ] && echo "net-1"
                      ;;
                  esac
                elif [ "$2" = "inspect" ]; then
                  case "$*" in
                    *"{{.Created}}"*) echo "2020-01-01 00:00:00 +0000 UTC" ;;
                    *"{{len .Containers}}"*) echo "${FAKE_NETWORK_CONTAINERS:-0}" ;;
                  esac
                fi
                ;;
              volume)
                if [ "$2" = "ls" ]; then
                  if [ -n "${FAKE_VOLUMES:-}" ]; then
                    printf '%s\\n' "$FAKE_VOLUMES"
                  else
                    [ "${FAKE_ANCHOR:-1}" = "1" ] && echo "volume-1"
                  fi
                fi
                ;;
              images)
                if [ "${FAKE_IMAGES:-0}" = "1" ]; then
                  case "$*" in
                    *dangling=true*)
                      printf '%s\\n' "${FAKE_DANGLING_IMAGES:-}"
                      ;;
                    *"{{.Repository}}"*)
                      printf '%s\\n' "${FAKE_LEGACY_IMAGES:-}"
                      ;;
                    *"{{.ID}}"*CreatedAt*)
                      printf 'img1\\t2020-01-01 00:00:00 +0000 UTC\\n'
                      ;;
                    *"{{.ID}}"*)
                      echo "img1"
                      ;;
                  esac
                fi
                ;;
              image)
                if [ "$2" = "inspect" ]; then
                  case "$*" in
                    *"RepoTags"*) echo "${FAKE_IMAGE_TAGS-vibecode-agent:ci}" ;;
                    *"com.vibecode.ci.build"*) echo "${FAKE_BUILD_LABEL:-}" ;;
                    *"com.vibecode.ci"*) echo "${FAKE_CI_LABEL:-true}" ;;
                    *"{{.Created}}"*) echo "2020-01-01 00:00:00 +0000 UTC" ;;
                  esac
                fi
                ;;
              ps)
                [ "${FAKE_PS:-}" != "" ] && printf '%s\\n' "$FAKE_PS"
                ;;
              compose)
                if [ "$2" = "ls" ]; then
                  echo "${FAKE_COMPOSE_JSON:-[]}"
                fi
                ;;
            esac
            exit 0
            """);
        Files.setPosixFilePermissions(docker,
            PosixFilePermissions.fromString("rwxr-xr-x"));
        return new Fixture(root, script, bin, log);
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

        Result run(List<String> args, Map<String, String> extraEnv)
            throws IOException, InterruptedException {
            List<String> command = new java.util.ArrayList<>();
            command.add("bash");
            command.add(script.toString());
            command.addAll(args);
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            Map<String, String> env = builder.environment();
            env.remove("CI_DOCKER_HOST");
            env.remove("CI_DOCKER_DAEMON_ID");
            env.remove("DOCKER_HOST");
            env.remove("DOCKER_HOST_FALLBACK");
            env.remove("JENKINS_HOME");
            env.remove("JENKINS_HOST_HOME");
            env.remove("WORKSPACE");
            env.put("PATH", bin + ":" + env.getOrDefault("PATH", ""));
            env.put("COMMAND_LOG", log.toString());
            env.put("CI_REPO_ROOT", root.toString());
            env.put("CI_DOCKER_HOST", "unix:///fake.sock");
            env.put("FAKE_DAEMON_ID", "daemon-1");
            env.putAll(extraEnv);
            Process process = builder.start();
            String output = new String(process.getInputStream().readAllBytes(),
                StandardCharsets.UTF_8);
            return new Result(process.waitFor(), output);
        }
    }

    private record Result(int exitCode, String output) {
    }
}
