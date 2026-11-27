package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AgentAppRepoConfigTest {

    @Test
    void serverRepositoryOverridesEnvCoordinates() {
        AgentConfig config = new AgentConfig();
        config.setRepoCoordinates("env-owner", "env-repo");

        boolean applied = AgentApp.applyRepoCoordinates(
            config, Map.of("repoUrl", "https://github.com/server-org/server-repo.git"));

        assertTrue(applied);
        assertEquals("server-org", config.getRepoOwner());
        assertEquals("server-repo", config.getRepoName());
    }

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

    @Test
    void appliesProviderAndAuthModeFromTheServerRepo() {
        AgentConfig config = new AgentConfig();

        boolean applied = AgentApp.applyRepoCoordinates(config, Map.of(
            "repoUrl", "https://git.example.com/group/repo.git",
            "provider", "Forgejo",
            "authMode", "PAT"));

        assertTrue(applied);
        assertEquals("forgejo", config.getRepoProvider());
        assertEquals("pat", config.getRepoAuthMode());
    }

    @Test
    void reviewModeNeverLoadsTheRepository() {
        ModeConfig config = new ModeConfig();
        config.review = true;
        AtomicBoolean loaded = new AtomicBoolean(false);

        AgentApp.resolveRepoConfig(config, () -> {
            loaded.set(true);
            return null;
        });

        assertFalse(loaded.get());
    }

    @Test
    void buildModeFailsWhenNoRepoCanBeResolved() {
        ModeConfig config = new ModeConfig();
        config.build = true;
        config.hasRepo = false;

        assertThrows(IllegalStateException.class,
            () -> AgentApp.resolveRepoConfig(config, () -> null));
        assertThrows(IllegalStateException.class,
            () -> AgentApp.resolveRepoConfig(config, () -> {
                throw new IOException("backend unavailable");
            }));
    }

    @Test
    void buildModeKeepsEnvFallbackOnFetchFailure() {
        ModeConfig config = new ModeConfig();
        config.build = true;
        config.hasRepo = true;

        AgentApp.resolveRepoConfig(config, () -> {
            throw new IOException("backend unavailable");
        });
        assertTrue(config.hasRepo);
    }

    @Test
    void buildModeAppliesTheServerRepo() {
        ModeConfig config = new ModeConfig();
        config.build = true;
        config.hasRepo = false;

        AgentApp.resolveRepoConfig(config,
            () -> Map.of("repoUrl", "https://github.com/server-org/server-repo.git"));

        assertTrue(config.hasRepo);
    }

    @Test
    void autoBuildWithEnvRepoStillAppliesTheServerRepo() {
        ModeConfig config = new ModeConfig();
        config.review = false;
        config.build = false;
        config.hasRepo = true; // legacy REPO_OWNER/REPO_NAME pair

        AgentApp.resolveRepoConfig(config,
            () -> Map.of("repoUrl", "https://github.com/server-org/server-repo.git"));

        assertEquals("server-org", config.owner);
        assertEquals("server-repo", config.name);
    }

    static class TokenModeConfig extends AgentConfig {
        String provider = "github";
        String repoMode;

        @Override public String getRepoProvider() { return provider; }
        @Override public String getRepoAuthMode() { return repoMode; }
        @Override public String getGitHubAuthMode() { return "pat"; }
        @Override public boolean isAllowPat() { return false; }
    }

    @Test
    void selfHostedStoredPatIsAcceptedAsTheNormalCredential() throws Exception {
        TokenModeConfig config = new TokenModeConfig();
        config.provider = "forgejo";
        config.repoMode = "pat";

        var provider = AgentApp.buildTokenProvider(
            config,
            force -> Map.of("provider", "forgejo", "token", "scoped", "mode", "pat"),
            null);

        assertEquals("scoped", provider.get());
    }

    @Test
    void selfHostedProviderRejectsACredentialModeMismatch() {
        TokenModeConfig config = new TokenModeConfig();
        config.provider = "forgejo";
        config.repoMode = "pat";

        var provider = AgentApp.buildTokenProvider(
            config,
            force -> Map.of("provider", "forgejo", "token", "x", "mode", "app"),
            null);

        assertThrows(IOException.class, provider::get);
    }

    @Test
    void githubPatStillRequiresTheAllowPatFallbackFlag() {
        var provider = AgentApp.buildTokenProvider(
            new TokenModeConfig(),
            force -> Map.of("token", "stored", "mode", "pat"),
            null);

        assertThrows(IOException.class, provider::get);
    }

    @Test
    void missingOrInvalidServerRepoKeepsEnvFallback() {
        AgentConfig config = new AgentConfig();
        config.setRepoCoordinates("env-owner", "env-repo");

        assertFalse(AgentApp.applyRepoCoordinates(config, null));
        assertFalse(AgentApp.applyRepoCoordinates(config, Map.of()));
        assertFalse(AgentApp.applyRepoCoordinates(config, Map.of("repoUrl", "not-a-repo")));

        assertEquals("env-owner", config.getRepoOwner());
        assertEquals("env-repo", config.getRepoName());
    }
}
