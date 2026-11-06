package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SecretLeakGuardTest {

    private final SecretLeakGuard guard = new SecretLeakGuard(
        List.of("oc_sk_live_1234567890", "ghp_configuredToken1234567890"));

    @Test
    void allowsAnOrdinaryDiff() {
        String diff = """
            diff --git a/src/App.java b/src/App.java
            --- a/src/App.java
            +++ b/src/App.java
            @@ -1 +1,2 @@
            +class App {}
            +// process.env is mentioned in documentation
            """;

        assertNull(guard.findLeak(diff));
        guard.assertClean(diff);
    }

    @Test
    void blocksAConfiguredProviderKeyOrGitHubToken() {
        String provider = """
            +++ b/src/Config.java
            +String key = "oc_sk_live_1234567890";
            """;
        String github = """
            +++ b/README.md
            +token: ghp_configuredToken1234567890
            """;

        assertEquals("a configured credential", guard.findLeak(provider));
        assertEquals("a configured credential", guard.findLeak(github));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(provider));
    }

    @Test
    void blocksHighConfidenceCredentialFormats() {
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            "+++ b/key.pem\n+-----BEGIN RSA PRIVATE KEY-----"));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            "+++ b/ci.yml\n+token: ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            "+++ b/ci.yml\n+token: github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            "+++ b/.env.example\n+AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            "+++ b/ci.yml\n+api_key: sk-abcdefghijklmnopqrstuvwx"));
    }

    @Test
    void ignoresRemovedLinesAndFilePathHeaders() {
        String diff = """
            diff --git a/.env b/.env
            --- a/.env
            +++ b/.env
            -OPENAI_API_KEY=oc_sk_live_1234567890
            +PLACEHOLDER=replace-me
            """;

        assertNull(guard.findLeak(diff));
    }

    @Test
    void ignoresShortConfiguredValuesToAvoidFalsePositives() {
        SecretLeakGuard shortGuard = new SecretLeakGuard(java.util.Arrays.asList("abc", "", null));

        assertNull(shortGuard.findLeak("+++ b/file\n+abc is a normal token"));
    }
}
