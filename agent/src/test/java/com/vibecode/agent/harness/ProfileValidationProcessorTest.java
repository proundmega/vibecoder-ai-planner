package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.WorkspaceManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ProfileValidationProcessorTest {

    @TempDir
    Path tempDir;

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private AgentConfig config;
    private ApiService apiService;
    private WorkspaceManager workspace;
    private VerificationRunner verificationRunner;
    private SandboxRunner sandboxRunner;

    @BeforeEach
    void setUp() throws Exception {
        config = mock(AgentConfig.class);
        when(config.getProjectId()).thenReturn("1");
        when(config.getRepoCloneDir()).thenReturn(tempDir.toString());
        when(config.getRepoOwner()).thenReturn("acme");
        when(config.getRepoName()).thenReturn("app");
        when(config.isDryRun()).thenReturn(false);

        apiService = mock(ApiService.class);
        workspace = mock(WorkspaceManager.class);
        when(workspace.getRepoDir()).thenReturn(tempDir);
        when(workspace.getBaseCommit()).thenReturn("abc123");

        verificationRunner = mock(VerificationRunner.class);
        sandboxRunner = mock(SandboxRunner.class);
    }

    private ProfileValidationProcessor processor(SandboxConfig sandboxConfig) {
        return new ProfileValidationProcessor(
            config, apiService, sandboxConfig, sandboxRunner,
            name -> workspace, verificationRunner);
    }

    private RepoProfileValidation validation(String profileJson) throws Exception {
        String json = """
            {
              "id": "22222222-2222-4222-8222-222222222222",
              "profile_id": "11111111-1111-4111-8111-111111111111",
              "profile_version": 3,
              "status": "running",
              "profile": %s
            }
            """.formatted(profileJson);
        return MAPPER.readValue(json, RepoProfileValidation.class);
    }

    private static String profileJson(String extra) {
        return """
            {
              "schema_version": 1,
              "repo_url": "https://github.com/acme/app",
              "base_branch": "main",
              "setup": ["npm ci"],
              "verify": ["npm test"],
              "env": {"NODE_ENV": "test"}
              %s
            }
            """.formatted(extra);
    }

    @Test
    void doesNothingWhenTheQueueIsEmpty() throws Exception {
        when(apiService.claimRepoProfileValidation("1")).thenReturn(null);

        processor(SandboxConfig.defaults()).pollOnce();

        verify(workspace, never()).cloneRepo(anyString(), anyString(), any(), any());
        verify(apiService, never()).finishRepoProfileValidation(
            anyString(), anyString(), anyString(), anyMap(), any());
    }

    @Test
    void runsSetupThenVerifyAndReportsSuccess() throws Exception {
        RepoProfileValidation validation = validation(profileJson(""));
        when(apiService.claimRepoProfileValidation("1")).thenReturn(validation);
        when(verificationRunner.run(any(Path.class), anyList(), any(Duration.class), anyMap()))
            .thenReturn(List.of(new VerificationResult("npm ci", 0, "ok", false)))
            .thenReturn(List.of(new VerificationResult("npm test", 0, "ok", false)));

        processor(SandboxConfig.defaults()).pollOnce();

        verify(workspace).cloneRepo(
            eq("https://github.com/acme/app.git"), eq("vibecode/profile-validate-22222222"),
            eq("main"), any(Duration.class));
        ArgumentCaptor<Map<String, Object>> result = ArgumentCaptor.forClass(Map.class);
        verify(apiService).finishRepoProfileValidation(
            eq("1"),
            eq("22222222-2222-4222-8222-222222222222"),
            eq("succeeded"),
            result.capture(),
            eq(null)
        );
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) result.getValue().get("commands");
        assertEquals(2, commands.size());
        assertEquals("setup", commands.get(0).get("phase"));
        assertEquals("verify", commands.get(1).get("phase"));
        verify(workspace).cleanup();
    }

    @Test
    void setupFailureSkipsVerifyAndReportsFailure() throws Exception {
        when(apiService.claimRepoProfileValidation("1"))
            .thenReturn(validation(profileJson("")));
        when(verificationRunner.run(any(Path.class), anyList(), any(Duration.class), anyMap()))
            .thenReturn(List.of(new VerificationResult("npm ci", 1, "boom", false)));

        processor(SandboxConfig.defaults()).pollOnce();

        ArgumentCaptor<Map<String, Object>> result = ArgumentCaptor.forClass(Map.class);
        verify(apiService).finishRepoProfileValidation(
            eq("1"), anyString(), eq("failed"), result.capture(), anyString());
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> commands = (List<Map<String, Object>>) result.getValue().get("commands");
        assertEquals("setup", commands.get(0).get("phase"));
        assertEquals(true, commands.get(1).get("skipped"));
        verify(verificationRunner).run(any(Path.class), anyList(), any(Duration.class), anyMap());
    }


    @Test
    void rejectsAProfileThatDoesNotMatchTheConfiguredRepository() throws Exception {
        when(apiService.claimRepoProfileValidation("1")).thenReturn(validation("""
            {"schema_version":1,"repo_url":"https://github.com/other/repo",
             "verify":["npm test"]}
            """));

        processor(SandboxConfig.defaults()).pollOnce();

        verify(workspace, never()).cloneRepo(anyString(), anyString(), any(), any());
        verify(apiService).finishRepoProfileValidation(
            eq("1"), anyString(), eq("failed"), anyMap(),
            org.mockito.ArgumentMatchers.contains("does not match"));
    }

    @Test
    void invalidProfileFailsWithoutCloning() throws Exception {
        when(apiService.claimRepoProfileValidation("1"))
            .thenReturn(validation("""
                {"schema_version":1,"verify":[]}
                """));

        processor(SandboxConfig.defaults()).pollOnce();

        verify(apiService).finishRepoProfileValidation(
            eq("1"), anyString(), eq("failed"), anyMap(),
            org.mockito.ArgumentMatchers.contains("Invalid repo profile"));
        verify(workspace, never()).cloneRepo(anyString(), anyString(), any(), any());
    }


    @Test
    void maxRoundMinutesCapsTheSetupAndVerifyTimeouts() throws Exception {
        when(apiService.claimRepoProfileValidation("1")).thenReturn(validation("""
            {"schema_version":1,"repo_url":"https://github.com/acme/app",
             "setup":["npm ci"],"verify":["npm test"],
             "timeouts":{"setup_minutes":60,"verify_minutes":60},
             "max_round_minutes":1}
            """));
        when(verificationRunner.run(any(Path.class), anyList(), any(Duration.class), anyMap()))
            .thenAnswer(invocation -> List.of(new VerificationResult(
                invocation.<List<String>>getArgument(1).get(0), 0, "ok", false)));

        processor(SandboxConfig.defaults()).pollOnce();

        ArgumentCaptor<Duration> timeouts = ArgumentCaptor.forClass(Duration.class);
        verify(verificationRunner, org.mockito.Mockito.times(2)).run(
            any(Path.class), anyList(), timeouts.capture(), anyMap());
        assertTrue(timeouts.getAllValues().get(0).toMillis() <= 60_000);
        assertTrue(timeouts.getAllValues().get(1).toMillis() <= 60_000);
    }

    @Test
    void dockerModeCreatesAndDestroysTheProfileSandbox() throws Exception {
        Path repoDir = Files.createDirectories(tempDir.resolve("docker-workspace"));
        Files.createDirectories(repoDir.resolve(".git"));
        when(workspace.getRepoDir()).thenReturn(repoDir);

        SandboxConfig docker = SandboxConfig.from(new HashMap<>(Map.of(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "operator/default:latest",
            "SANDBOX_NETWORK", "allowlist",
            "SANDBOX_ALLOWED_HOSTS", "registry.example.com",
            "SANDBOX_EGRESS_TLS_MODE", "terminate"
        ))::get);
        SandboxHandle handle = new SandboxHandle(
            "sbx-1", repoDir, false, Instant.now());
        when(sandboxRunner.create(any(SandboxSpec.class))).thenReturn(handle);
        when(apiService.claimRepoProfileValidation("1")).thenReturn(validation(
            profileJson(",\"image\":\"node@sha256:"
                + "a".repeat(64) + "\",\"egress\":{\"tls_mode\":\"terminate\","
                + "\"mtls\":{\"credential_id\":5,"
                + "\"hosts\":[\"registry.example.com\"]}}")));
        EgressMtlsMaterial material = new EgressMtlsMaterial(
            List.of("registry.example.com"),
            Files.readString(Path.of("src/test/resources/egress-client-cert.pem")),
            Files.readString(Path.of("src/test/resources/egress-client-key.pem")));
        when(apiService.getRepoProfileMtls("1")).thenReturn(material);
        when(verificationRunner.run(
            eq(sandboxRunner), eq(handle), anyList(), any(Duration.class)))
            .thenReturn(List.of(new VerificationResult("npm ci", 0, "ok", false)));

        processor(docker).pollOnce();

        ArgumentCaptor<SandboxSpec> spec = ArgumentCaptor.forClass(SandboxSpec.class);
        verify(sandboxRunner).create(spec.capture());
        assertEquals("node@sha256:" + "a".repeat(64), spec.getValue().image());
        assertEquals(List.of("registry.example.com"), spec.getValue().egressMtls().hosts());
        assertFalse(spec.getValue().toString().contains("PRIVATE KEY"));
        verify(sandboxRunner).destroy(handle);
        verify(workspace).cleanup();
    }
}
