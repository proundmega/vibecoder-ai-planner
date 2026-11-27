package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.ApiService;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentAppConstructorRepoTest {

    static class ModeConfig extends AgentConfig {
        boolean review;
        boolean build;
        boolean hasRepo;
        String owner;
        String name;

        @Override public boolean isReviewMode() { return review; }
        @Override public boolean isBuildMode() { return build; }
        @Override public boolean hasRepoCoordinates() { return hasRepo; }
        @Override public void setRepoCoordinates(String owner, String name) {
            this.owner = owner;
            this.name = name;
            this.hasRepo = true;
        }
    }

    static class StubApi extends ApiService {
        final AtomicBoolean repoRequested = new AtomicBoolean(false);
        final boolean failRepo;
        final java.util.List<String> startupCalls = new java.util.ArrayList<>();

        StubApi(AgentConfig config, boolean failRepo) {
            super(config);
            this.failRepo = failRepo;
        }

        @Override
        public void sendHeartbeat(String runtimeId, String status, Object currentProjectId) {
            startupCalls.add("heartbeat:" + status);
        }

        @Override
        public Map<String, Object> getRepoConfig(String projectId) throws IOException {
            startupCalls.add("repo");
            repoRequested.set(true);
            if (failRepo) throw new IOException("backend unavailable");
            return Map.of("repoUrl", "https://github.com/server-org/server-repo.git");
        }

        @Override
        public Map<String, Object> getProviderConfig() {
            return null;
        }

        @Override
        public Map<String, Object> requestGitHubToken(
                String projectId, String provider, boolean forceRefresh) {
            return Map.of("token", "ghs_constructor_test", "mode", "app");
        }
    }

    @Test
    void constructorFetchesAndAppliesTheProjectRepoBeforeWiring() {
        ModeConfig config = new ModeConfig();
        config.build = true;
        config.setRuntimeId("77");
        StubApi api = new StubApi(config, false);

        new AgentApp(config, null, api);

        assertTrue(api.repoRequested.get());
        assertEquals("server-org", config.owner);
        assertEquals("server-repo", config.name);
        assertEquals(java.util.List.of("heartbeat:running", "repo"), api.startupCalls,
            "the runtime must be running before the #182 repo read");
    }

    @Test
    void constructorFailsForBuildModeWhenTheRepoCannotBeLoaded() {
        ModeConfig config = new ModeConfig();
        config.build = true;
        StubApi api = new StubApi(config, true);

        assertThrows(IllegalStateException.class, () -> new AgentApp(config, null, api));
        assertTrue(api.repoRequested.get());
    }

    @Test
    void reviewConstructorDoesNotFetchTheRepo() {
        ModeConfig config = new ModeConfig();
        config.review = true;
        StubApi api = new StubApi(config, false);

        new AgentApp(config, null, api);

        assertFalse(api.repoRequested.get());
        assertFalse(config.hasRepo);
    }
}
