package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JenkinsfileCiCleanupTest {

    private static final Path JENKINSFILE = Path.of("..", "Jenkinsfile")
        .toAbsolutePath().normalize();
    private static final Path CLEANUP_PIPELINE = Path.of("..", "Jenkinsfile.cleanup")
        .toAbsolutePath().normalize();

    @Test
    void fr1TeardownRunsBeforeCleanWsInPostAlways() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        int post = text.lastIndexOf("post {");
        assertTrue(post > 0, "Jenkinsfile has no post block");
        int always = text.indexOf("always {", post);
        int cleanup = text.indexOf("cleanup {", post);
        int cleanWs = text.indexOf("cleanWs()", post);
        int teardown = text.indexOf("jenkins-docker-cleanup.sh", post);
        assertTrue(always > post, "post has no always block");
        assertTrue(cleanup > always, "cleanWs is not in the cleanup condition");
        assertTrue(cleanWs > cleanup, "cleanWs is not after the cleanup condition");
        assertTrue(teardown > always && teardown < cleanWs,
            "teardown must run in always before cleanWs");
        assertFalse(text.substring(post).contains("success {"),
            "the old success-only cleanup is still present");
    }

    @Test
    void fr2SupervisorAndComposeBuildsCarryCiLabels() throws IOException {
        String jenkinsfile = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        assertTrue(jenkinsfile.contains("com.vibecode.ci.build"),
            "supervisor CI label is missing");
        for (String file : new String[] {
            "../docker-compose.yml", "../docker-compose.test.yml", "../docker-compose.e2e.yml"
        }) {
            String text = Files.readString(Path.of(file).toAbsolutePath().normalize(),
                StandardCharsets.UTF_8);
            assertTrue(text.contains("x-ci-labels"), file + " has no CI label anchor");
            assertTrue(text.contains("labels: *ci-labels"), file + " has no CI labels");
        }
        String compose = Files.readString(
            Path.of("../docker-compose.yml").toAbsolutePath().normalize(),
            StandardCharsets.UTF_8);
        assertTrue(compose.contains("labels: *ci-labels"),
            "Compose network/volume labels are missing");
    }

    @Test
    void fr5PostCleanupUsesPipelineDaemonVariable() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        assertTrue(text.contains("sh(script:"), "no sh(returnStdout) capture");
        assertTrue(text.contains("returnStdout: true"),
            "the daemon capture must use returnStdout");
        assertTrue(text.contains("env.CI_DOCKER_HOST"));
        assertTrue(text.contains("env.CI_DOCKER_DAEMON_ID"));
        assertTrue(text.contains("--compose-project"));
        assertTrue(text.contains("--build-images"));
        assertTrue(text.contains("--job '${VIBECODE_CI_JOB}'"),
            "post cleanup must be scoped to the Jenkins job");
        assertFalse(text.contains("target/ci-docker-daemon.env"),
            "the workspace daemon file must not be used");
    }

    @Test
    void fr1ComposeProjectNameIncludesJobIdentity() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        assertTrue(text.contains("JOB_SLUG"), "no job slug for the Compose project");
        assertTrue(text.contains("JOB_NAME"), "job slug does not use the Jenkins job name");
        assertTrue(text.contains("-${JOB_SLUG}-${BUILD_NUMBER}"),
            "Compose project name is not job+build scoped");
    }

    @Test
    void fr1CleanWsRunsInPostCleanup() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        int post = text.lastIndexOf("post {");
        int cleanup = text.indexOf("cleanup {", post);
        int cleanWs = text.indexOf("cleanWs()", cleanup);
        assertTrue(cleanup > post, "cleanup condition is missing");
        assertTrue(cleanWs > cleanup, "cleanWs is not inside cleanup");
    }

    @Test
    void fr1SmokeFailureHookAndCiLabels() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        assertTrue(text.contains("CI_SMOKE_FAIL"), "CI_SMOKE_FAIL is missing");
        assertTrue(text.contains("com.vibecode.ci.build"), "CI build label is missing");
        assertTrue(text.contains("vibecode-agent:${BUILD_NUMBER}"),
            "supervisor build-unique tag is missing");
        assertTrue(text.contains("SANDBOX_IT_BUILD_TAG"),
            "sandbox build-unique tag is missing");
    }

    @Test
    void nfr4RunbookDocumentsTheSameDefaults() throws IOException {
        String runbook = Files.readString(
            Path.of("../planning/bp-135-ci-docker-resource-cleanup/05_RUNBOOK.md")
                .toAbsolutePath().normalize(), StandardCharsets.UTF_8);
        assertTrue(runbook.contains("CI_IMAGE_GRACE_HOURS"));
        assertTrue(runbook.contains("CI_CONTAINER_GRACE_HOURS"));
        assertTrue(runbook.contains("CI_BUILD_GRACE_HOURS"));
        String readme = Files.readString(
            Path.of("../README.md").toAbsolutePath().normalize(), StandardCharsets.UTF_8);
        assertTrue(readme.contains("CI_IMAGE_GRACE_HOURS"));
    }

    @Test
    void nfr5NoWorkspaceDaemonFileIsTrusted() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        assertFalse(text.contains("target/ci-docker-daemon.env"),
            "the Jenkinsfile must not trust a workspace daemon file");
    }

    @Test
    void fr5CypressTeardownRemovesImages() throws IOException {
        String text = Files.readString(JENKINSFILE, StandardCharsets.UTF_8);
        assertTrue(text.contains(
            "docker compose -f \\${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml "
                + "down -v --rmi local --remove-orphans"), text);
    }

    @Test
    void nfr1ScheduledCleanupDefaultsToDryRun() throws IOException {
        String text = Files.readString(CLEANUP_PIPELINE, StandardCharsets.UTF_8);
        assertTrue(text.contains("booleanParam(name: 'DRY_RUN', defaultValue: true"));
        assertTrue(text.contains("ENABLE_DESTRUCTIVE_CLEANUP"));
        assertTrue(text.contains("destructive cleanup requires"));
    }

    @Test
    void fr5ScheduledJobPinsNodeAndDaemon() throws IOException {
        String text = Files.readString(CLEANUP_PIPELINE, StandardCharsets.UTF_8);
        assertTrue(text.contains("agent { label 'vibecode-ci-docker' }"),
            "scheduled job is not pinned to the dedicated node");
        assertTrue(text.contains("cron('H */6 * * *')"), "cron trigger is missing");
        assertTrue(text.contains("--orphans"), "scheduled job does not run orphans");
        assertTrue(text.contains("CI_DOCKER_HOST"));
        assertTrue(text.contains("CI_DOCKER_DAEMON_ID"));
        assertFalse(text.contains("--job"),
            "the scheduled GC must stay job-agnostic");
    }
}
