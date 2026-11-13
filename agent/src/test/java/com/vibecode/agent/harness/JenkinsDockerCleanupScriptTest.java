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
            "--build-id", "12", "--job", "job-a"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker compose -f " + fixture.root
            + "/docker-compose.yml -f " + fixture.root
            + "/docker-compose.test.yml -f " + fixture.root
            + "/docker-compose.e2e.yml --profile e2e -p vibecode-pr-7-12 "
            + "down -v --rmi local --remove-orphans"), log);
        assertTrue(log.contains("--filter label=com.vibecode.ci.job=job-a"), log);
        assertTrue(log.contains("--filter label=com.vibecode.ci.build=12"), log);
    }

    @Test
    void fr1ComposeCleanupRequiresABuildId() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--job", "job-a"), Map.of());

        assertEquals(2, result.exitCode, result.output);
        assertTrue(result.output.contains("--build-id is required"), result.output);
        assertFalse(Files.exists(fixture.log)
            && Files.readString(fixture.log).contains("down -v"), result.output);
    }

    @Test
    void fr1ProjectAnchorIgnoresDockerStderr() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12", "--job", "job-a"), Map.of(
            "FAKE_ANCHOR", "0",
            "FAKE_NETWORK_WARNING", "1"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("nothing to do"), result.output);
        assertTrue(result.output.contains("warning: docker network ls"),
            result.output);
        assertFalse(Files.readString(fixture.log).contains("down -v"), result.output);
    }

    @Test
    void fr1ProjectAnchorRejectsMismatchedJob() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12", "--job", "job-a"), Map.of(
            "FAKE_ANCHOR_JOB", "job-b"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("nothing to do"), result.output);
        assertFalse(Files.readString(fixture.log).contains("down -v"), result.output);
    }

    @Test
    void fr4DryRunDoesNotTearDownOrRemoveAnything() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12",
            "--job", "job-a",
            "--dry-run"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("down -v"), log);
        assertTrue(result.output.contains("DRY-RUN:"), result.output);
    }

    @Test
    void fr4RefusesTheLocalDevProjectAndUnrecognizedNames() throws Exception {
        Fixture fixture = fixture();

        Result local = fixture.run(List.of("--compose-project", "vibecoder-ai-planner",
            "--build-id", "12", "--job", "job-a"), Map.of());
        assertEquals(2, local.exitCode, local.output);
        assertTrue(local.output.contains("refusing unrecognized project name"), local.output);

        Result typo = fixture.run(List.of("--compose-project", "vibecode-pr",
            "--build-id", "12", "--job", "job-a"), Map.of());
        assertEquals(2, typo.exitCode, typo.output);
        assertTrue(typo.output.contains("refusing unrecognized project name"), typo.output);
    }

    @Test
    void nfr1MissingAnchorIsANoOp() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--compose-project", "vibecode-pr-7-12",
                "--build-id", "12", "--job", "job-a"),
            Map.of("FAKE_ANCHOR", "0"));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("nothing to do"), result.output);
        assertFalse(Files.readString(fixture.log).contains("down -v"), result.output);
    }

    @Test
    void fr2BuildImageRemovalKeepsTheSharedCiAlias() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7", "--job", "job-a"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:ci vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7",
            "FAKE_JOB_LABEL", "job-a"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker image rm vibecode-agent:7"), log);
        assertFalse(log.contains("docker image rm vibecode-agent:ci"), log);
        assertTrue(result.output.contains("keeping shared alias vibecode-agent:ci"), result.output);
    }

    @Test
    void fr2BuildImageCleanupRequiresAJob() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7"
        ));

        assertEquals(2, result.exitCode, result.output);
        assertTrue(result.output.contains("--job/CI_JOB is required"), result.output);
        assertFalse(Files.exists(fixture.log)
            && Files.readString(fixture.log).contains("docker image rm"), result.output);
    }

    @Test
    void fr2BuildImageCleanupIsJobScopedOnASharedDaemon() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "8", "--job", "job-a"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_MULTI_IMAGES", "img-a|job-a|8|vibecode-agent:8|2020-01-01 00:00:00 +0000 UTC"
                + "\nimg-b|job-b|8|vibecode-agent:8|2020-01-01 00:00:00 +0000 UTC"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker image rm img-a"), log);
        assertTrue(log.contains("--filter label=com.vibecode.ci.job=job-a"), log);
        assertFalse(log.contains("docker image rm img-b"), log);
        assertEquals(1, countOccurrences(log, "docker image rm vibecode-agent:8"), log);
    }

    @Test
    void fr2BuildImageCleanupOnlyRemovesTheBuildTag() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7", "--job", "job-a"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7 vibecode-agent:ci vibecode-agent:latest",
            "FAKE_BUILD_LABEL", "7",
            "FAKE_JOB_LABEL", "job-a"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker image rm vibecode-agent:7"), log);
        assertFalse(log.contains("docker image rm vibecode-agent:latest"), log);
        assertFalse(log.contains("docker image rm vibecode-agent:ci"), log);
        assertFalse(log.contains("docker image rm img1"), log);
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
    void nfr2GraceAndOptionalBuildIdSkipCurrentResources() throws Exception {
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
            "--build-id", "12", "--job", "job-a"), Map.of());

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
            "--build-id", "12", "--job", "job-a"), Map.of());

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("Using explicit Docker host unix:///fake.sock"),
            result.output);
    }

    @Test
    void fr5PostCleanupFallsBackToExplicitHost() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of(
            "--compose-project", "vibecode-pr-7-12",
            "--build-id", "12", "--job", "job-a"), Map.of(
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

        Result result = fixture.run(List.of("--compose-project", "vibecode-pr-7-12",
                "--build-id", "12", "--job", "job-a"),
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
    void fr3OrphanSandboxNetworksRemoveOldNetworks() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_SANDBOX_NETWORK", "sandbox-net"
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
    void fr3OrphanComposeProjectsUseVolumeCreatedAt() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_COMPOSE_JSON",
            "[{\"Name\":\"vibecode-pr-7-12\",\"Status\":\"running(1)\"}]",
            "FAKE_NETWORK_EMPTY", "1",
            "FAKE_PROJECT_VOLUME", "vibecode-pr-7-12_postgres_data",
            "FAKE_VOLUME_CREATED", "2020-01-01 00:00:00 +0000 UTC"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("DRY-RUN: docker compose ... -p vibecode-pr-7-12"),
            result.output);
    }

    @Test
    void fr3OrphanComposeProjectsSkipVolumeWithoutCreatedAt() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_COMPOSE_JSON",
            "[{\"Name\":\"vibecode-pr-7-12\",\"Status\":\"running(1)\"}]",
            "FAKE_NETWORK_EMPTY", "1",
            "FAKE_PROJECT_VOLUME", "vibecode-pr-7-12_postgres_data",
            "FAKE_VOLUME_CREATED", "<no value>"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("cannot determine the creation time"), result.output);
        assertFalse(result.output.contains("DRY-RUN: docker compose"), result.output);
    }

    @Test
    void nfr1ComposeDownFailureIsNotTreatedAsRace() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans"), Map.of(
            "FAKE_COMPOSE_JSON",
            "[{\"Name\":\"vibecode-pr-7-12\",\"Status\":\"running(1)\"}]",
            "FAKE_COMPOSE_DOWN_WARNING", "network is in use",
            "FAKE_COMPOSE_DOWN_ERROR", "no such file or directory"
        ));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("docker compose down failed for vibecode-pr-7-12"),
            result.output);
        assertTrue(result.output.contains("WARNING: network is in use"), result.output);
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
        assertTrue(Files.readString(fixture.log).contains(
            "docker images -a --filter label=com.vibecode.ci=true"), result.output);
    }

    @Test
    void fr2BuildImageRemovalRemovesUntaggedImageId() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7", "--job", "job-a"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7",
            "FAKE_JOB_LABEL", "job-a"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(log.contains("docker image rm vibecode-agent:7"), log);
        assertTrue(log.contains("docker image rm img1"), log);
    }

    @Test
    void fr2BuildImageRemovalSkipsWhenTagInspectFails() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--build-images", "7", "--job", "job-a"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:ci",
            "FAKE_BUILD_LABEL", "7",
            "FAKE_JOB_LABEL", "job-a",
            "FAKE_TAGS_INSPECT_FAIL", "1"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("docker image rm vibecode-agent:ci"), log);
        assertFalse(log.contains("docker image rm img1"), log);
        assertTrue(result.output.contains("docker image inspect img1 failed"), result.output);
    }

    @Test
    void fr3OrphanCiImagesSkipWhenTagInspectFails() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7",
            "FAKE_BUILD_LABEL", "7",
            "FAKE_TAGS_INSPECT_FAIL", "1"
        ));

        assertEquals(1, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertFalse(log.contains("docker image rm"), log);
        assertTrue(result.output.contains("docker image inspect img1 failed"), result.output);
    }

    @Test
    void fr3OrphanCiImagesPreserveUnrelatedAliases() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-agent:7 vibecode-agent:latest",
            "FAKE_BUILD_LABEL", "7"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("DRY-RUN: docker image rm vibecode-agent:7"),
            result.output);
        assertFalse(result.output.contains("docker image rm vibecode-agent:latest"),
            result.output);
        assertFalse(result.output.contains("docker image rm img1"), result.output);
    }

    @Test
    void fr3OrphanGcStaysJobAgnostic() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_IMAGES", "1",
            "CI_JOB", "job-a",
            "FAKE_MULTI_IMAGES", "img-a|job-a|8||2020-01-01 00:00:00 +0000 UTC"
                + "\nimg-b|job-b|8||2020-01-01 00:00:00 +0000 UTC"
        ));

        assertEquals(0, result.exitCode, result.output);
        String log = Files.readString(fixture.log);
        assertTrue(result.output.contains("DRY-RUN: docker image rm img-a"), result.output);
        assertTrue(result.output.contains("DRY-RUN: docker image rm img-b"), result.output);
        assertFalse(log.contains("label=com.vibecode.ci.job="), log);
    }

    @Test
    void fr3OrphanCiImagesRemoveOldComposeProjectImages() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_IMAGES", "1",
            "FAKE_IMAGE_TAGS", "vibecode-pr-7-job-a-12-api:latest",
            "FAKE_BUILD_LABEL", "12"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains(
            "DRY-RUN: docker image rm vibecode-pr-7-job-a-12-api:latest"), result.output);
        assertTrue(result.output.contains("docker image rm img1 (old CI image with no :ci alias)"),
            result.output);
    }

    @Test
    void nfr1OrphanGcFailsOnDockerListingErrors() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans", "--dry-run"), Map.of(
            "FAKE_FAIL_COMMANDS", "ps images compose"
        ));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("docker ps failed"), result.output);
        assertTrue(result.output.contains("docker images failed"), result.output);
        assertTrue(result.output.contains("docker compose ls failed"), result.output);
        assertTrue(result.output.contains("Docker operation(s) failed"), result.output);
    }

    @Test
    void nfr1OrphanGcToleratesInUseRaces() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans"), Map.of(
            "FAKE_PS", "container1\t2020-01-01 00:00:00 +0000 UTC\trunning",
            "FAKE_RM_ERROR", "container1 is in use by a running process"
        ));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("disappeared or is still in use"), result.output);
    }

    @Test
    void nfr1OrphanGcFailsOnNonRaceRemovalErrors() throws Exception {
        Fixture fixture = fixture();

        Result result = fixture.run(List.of("--orphans"), Map.of(
            "FAKE_PS", "container1\t2020-01-01 00:00:00 +0000 UTC\trunning",
            "FAKE_RM_ERROR", "permission denied"
        ));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("docker rm -f container1 failed"), result.output);
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
        assertTrue(log.contains("docker images -a --filter dangling=true"), log);
    }

    private static int countOccurrences(String text, String needle) {
        int count = 0;
        int index = 0;
        while ((index = text.indexOf(needle, index)) >= 0) {
            count++;
            index += needle.length();
        }
        return count;
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
            cmd="$1"
            sub="${2:-}"

            for fail in ${FAKE_FAIL_COMMANDS:-}; do
              if [ "$fail" = "$cmd" ] || [ "$fail" = "$cmd $sub" ]; then
                echo "fake docker failure for '$fail'" >&2
                exit 1
              fi
            done

            parse_image_filters() {
              want_job=""
              want_build=""
              want_ci=""
              want_dangling=""
              while [ $# -gt 0 ]; do
                case "$1" in
                  --filter)
                    case "$2" in
                      label=com.vibecode.ci.job=*) want_job="${2#label=com.vibecode.ci.job=}" ;;
                      label=com.vibecode.ci.build=*) want_build="${2#label=com.vibecode.ci.build=}" ;;
                      label=com.vibecode.ci=*) want_ci="${2#label=com.vibecode.ci=}" ;;
                      dangling=true) want_dangling=1 ;;
                    esac
                    shift 2
                    ;;
                  *) shift ;;
                esac
              done
            }

            image_rows() {
              if [ -n "${FAKE_MULTI_IMAGES:-}" ]; then
                printf '%s\\n' "$FAKE_MULTI_IMAGES"
              else
                printf '%s|%s|%s|%s|%s\\n' \\
                  "${FAKE_IMAGE_ID:-img1}" \\
                  "${FAKE_JOB_LABEL:-}" \\
                  "${FAKE_BUILD_LABEL:-}" \\
                  "${FAKE_IMAGE_TAGS-vibecode-agent:ci}" \\
                  "2020-01-01 00:00:00 +0000 UTC"
              fi
            }

            row_matches() {
              local job="$1" build="$2" tags="$3"
              [ -z "$want_job" ] || [ "$job" = "$want_job" ] || return 1
              [ -z "$want_build" ] || [ "$build" = "$want_build" ] || return 1
              if [ -n "$want_ci" ]; then
                [ "$want_ci" = "true" ] || return 1
              fi
              if [ -n "$want_dangling" ]; then
                [ -z "${tags// /}" ] || return 1
              fi
              return 0
            }

            find_image_row() {
              local id="$1"
              image_rows | while IFS='|' read -r rid job build tags created; do
                if [ "$rid" = "$id" ]; then
                  printf '%s|%s|%s|%s\\n' "$job" "$build" "$tags" "$created"
                  return 0
                fi
              done
            }

            anchor_allowed() {
              local want_job="" want_build="" arg
              for arg in "$@"; do
                case "$arg" in
                  label=com.vibecode.ci.job=*) want_job="${arg#label=com.vibecode.ci.job=}" ;;
                  label=com.vibecode.ci.build=*) want_build="${arg#label=com.vibecode.ci.build=}" ;;
                esac
              done
              [ "${FAKE_ANCHOR:-1}" = "1" ] || return 1
              if [ -n "$want_job" ] && [ -n "${FAKE_ANCHOR_JOB:-}" ] \\
                  && [ "$want_job" != "$FAKE_ANCHOR_JOB" ]; then
                return 1
              fi
              if [ -n "$want_build" ] && [ -n "${FAKE_ANCHOR_BUILD:-}" ] \\
                  && [ "$want_build" != "$FAKE_ANCHOR_BUILD" ]; then
                return 1
              fi
              return 0
            }

            case "$cmd" in
              info)
                echo "${FAKE_DAEMON_ID:-daemon-1}"
                ;;
              network)
                if [ "$sub" = "ls" ]; then
                  if [ "${FAKE_NETWORK_WARNING:-0}" = "1" ]; then
                    echo "fake docker warning on stderr" >&2
                  fi
                  case "$*" in
                    *label=vibecode.sandbox.managed=true*)
                      [ -n "${FAKE_SANDBOX_NETWORK:-}" ] && echo "$FAKE_SANDBOX_NETWORK"
                      ;;
                    *label=com.vibecode.ci=true*)
                      if [ "${FAKE_NETWORK_EMPTY:-0}" != "1" ]; then
                        anchor_allowed "$@" && echo "net-1"
                      fi
                      ;;
                    *label=com.docker.compose.project=*)
                      if [ "${FAKE_NETWORK_EMPTY:-0}" != "1" ]; then
                        anchor_allowed "$@" && echo "net-1"
                      fi
                      ;;
                  esac
                elif [ "$sub" = "inspect" ]; then
                  case "$*" in
                    *"{{.Created}}"*) echo "${FAKE_NETWORK_CREATED:-2020-01-01 00:00:00 +0000 UTC}" ;;
                    *"{{len .Containers}}"*) echo "0" ;;
                  esac
                elif [ "$sub" = "rm" ]; then
                  if [ -n "${FAKE_NETWORK_RM_ERROR:-}" ]; then
                    echo "$FAKE_NETWORK_RM_ERROR" >&2
                    exit 1
                  fi
                fi
                ;;
              volume)
                if [ "$sub" = "ls" ]; then
                  if [ -n "${FAKE_VOLUMES:-}" ]; then
                    printf '%s\\n' "$FAKE_VOLUMES"
                  elif [ -n "${FAKE_PROJECT_VOLUME:-}" ]; then
                    case "$*" in
                      *com.docker.compose.project=*) echo "$FAKE_PROJECT_VOLUME" ;;
                    esac
                  else
                    anchor_allowed "$@" && echo "volume-1"
                  fi
                elif [ "$sub" = "inspect" ]; then
                  case "$*" in
                    *"{{.CreatedAt}}"*) echo "${FAKE_VOLUME_CREATED:-2020-01-01 00:00:00 +0000 UTC}" ;;
                  esac
                fi
                ;;
              images)
                if [ "${FAKE_IMAGES:-0}" = "1" ]; then
                  parse_image_filters "$@"
                  if [ -n "$want_dangling" ] && [ -n "${FAKE_DANGLING_IMAGES:-}" ]; then
                    printf '%s\\n' "$FAKE_DANGLING_IMAGES"
                  elif printf '%s' "$*" | grep -q '{{.Repository}}' \\
                      && [ -n "${FAKE_LEGACY_IMAGES:-}" ]; then
                    printf '%s\\n' "$FAKE_LEGACY_IMAGES"
                  else
                    while IFS='|' read -r id job build tags created; do
                      [ -n "$id" ] || continue
                      row_matches "$job" "$build" "$tags" || continue
                      case "$*" in
                        *'{{.Repository}}'*)
                          if [ -z "${tags// /}" ]; then
                            printf '<none>:<none>\\t%s\\t%s\\t1MB\\n' "$id" "$created"
                          else
                            for tag in $tags; do
                              printf '%s\\t%s\\t%s\\t1MB\\n' "$tag" "$id" "$created"
                            done
                          fi
                          ;;
                        *dangling=true*)
                          [ -z "${tags// /}" ] && printf '%s\\t%s\\n' "$id" "$created"
                          ;;
                        *CreatedAt*)
                          printf '%s\\t%s\\n' "$id" "$created"
                          ;;
                        *)
                          printf '%s\\n' "$id"
                          ;;
                      esac
                    done < <(image_rows)
                  fi
                fi
                ;;
              image)
                if [ "$sub" = "inspect" ]; then
                  id=""
                  for last in "$@"; do id="$last"; done
                  row="$(find_image_row "$id")"
                  if [ -z "$row" ] && [ -n "${FAKE_DANGLING_IMAGES:-}" ]; then
                    case "$FAKE_DANGLING_IMAGES" in
                      *"$id"*)
                        row="|${FAKE_JOB_LABEL:-}|${FAKE_BUILD_LABEL:-7}||2020-01-01 00:00:00 +0000 UTC"
                        ;;
                    esac
                  fi
                  if [ -z "$row" ]; then
                    echo "Error: No such image: $id" >&2
                    exit 1
                  fi
                  IFS='|' read -r job build tags created <<< "$row"
                  case "$*" in
                    *"RepoTags"*)
                      if [ "${FAKE_TAGS_INSPECT_FAIL:-0}" = "1" ]; then
                        echo "fake tag inspect failure" >&2
                        exit 1
                      fi
                      echo "$tags"
                      ;;
                    *"com.vibecode.ci.build"*) echo "$build" ;;
                    *"com.vibecode.ci.job"*) echo "$job" ;;
                    *"com.vibecode.ci"*) echo "true" ;;
                    *"{{.Created}}"*) echo "$created" ;;
                  esac
                elif [ "$sub" = "rm" ]; then
                  if [ -n "${FAKE_IMAGE_RM_ERROR:-}" ]; then
                    echo "$FAKE_IMAGE_RM_ERROR" >&2
                    exit 1
                  fi
                fi
                ;;
              rm)
                if [ -n "${FAKE_RM_ERROR:-}" ]; then
                  echo "$FAKE_RM_ERROR" >&2
                  exit 1
                fi
                ;;
              ps)
                [ "${FAKE_PS:-}" != "" ] && printf '%s\\n' "$FAKE_PS"
                ;;
              compose)
                if [ "$sub" = "ls" ]; then
                  echo "${FAKE_COMPOSE_JSON:-[]}"
                elif printf '%s' "$*" | grep -q ' down '; then
                  if [ -n "${FAKE_COMPOSE_DOWN_WARNING:-}" ]; then
                    echo "WARNING: $FAKE_COMPOSE_DOWN_WARNING" >&2
                  fi
                  if [ -n "${FAKE_COMPOSE_DOWN_ERROR:-}" ]; then
                    echo "$FAKE_COMPOSE_DOWN_ERROR" >&2
                    exit 1
                  fi
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
