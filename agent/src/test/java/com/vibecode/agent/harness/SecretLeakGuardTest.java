package com.vibecode.agent.harness;

import com.vibecode.agent.service.WorkspaceManager.GuardedBlob;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SecretLeakGuardTest {

    private final SecretLeakGuard guard = new SecretLeakGuard(
        List.of("oc_sk_live_1234567890", "ghp_configuredToken1234567890"));

    @Test
    void allowsAnOrdinaryBlob() {
        GuardedBlob blob = blob("src/App.java", """
            class App {}
            // process.env is mentioned in documentation
            """);

        assertNull(guard.findLeak(blob.path(), blob.content()));
        guard.assertClean(List.of(blob));
    }

    @Test
    void blocksAConfiguredProviderKeyOrGitHubTokenInContent() {
        assertEquals("a configured credential", guard.findLeak(
            "src/Config.java", bytes("String key = \"oc_sk_live_1234567890\";")));
        assertEquals("a configured credential", guard.findLeak(
            "README.md", bytes("token: ghp_configuredToken1234567890")));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            List.of(blob("README.md", "token: oc_sk_live_1234567890"))));
    }

    @Test
    void blocksHighConfidenceCredentialFormats() {
        assertFinding("a private key", "key.pem",
            "-----BEGIN RSA PRIVATE KEY-----");
        assertFinding("a GitHub token", "ci.yml",
            "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789");
        assertFinding("a GitHub fine-grained token", "ci.yml",
            "token: github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz");
        assertFinding("an AWS access key", ".env.example",
            "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
        assertFinding("an OpenAI-style key", "ci.yml",
            "api_key: sk-abcdefghijklmnopqrstuvwx");
    }

    @Test
    void blocksASecretUsedAsAFilename() {
        assertFinding("a configured credential",
            "docs/oc_sk_live_1234567890.txt", "ordinary content");
        assertFinding("a GitHub token",
            "src/ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ordinary content");
    }

    @Test
    void blocksABinaryBlobContainingACredential() {
        byte[] content = new byte[] {0, 1, 2, 'o', 'c', '_', 's', 'k', '_', 'l', 'i', 'v', 'e',
            '_', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 0};

        assertEquals("a configured credential",
            guard.findLeak("secret.bin", content));
    }

    @Test
    void blocksAnOversizedBlobInsteadOfTruncating() {
        byte[] content = new byte[8 * 1024 * 1024 + 16];
        Arrays.fill(content, (byte) 'a');
        byte[] secret = "oc_sk_live_1234567890".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(secret, 0, content, content.length - secret.length, secret.length);

        assertEquals("a file larger than the credential-scan limit",
            guard.findLeak("big.bin", content));
        assertThrows(IllegalStateException.class,
            () -> guard.assertClean(List.of(new GuardedBlob("big.bin", content))));
    }

    @Test
    void ignoresShortConfiguredValuesToAvoidFalsePositives() {
        SecretLeakGuard shortGuard = new SecretLeakGuard(
            Arrays.asList("abc", "", null));

        assertNull(shortGuard.findLeak("file.txt", bytes("abc is a normal token")));
    }

    @Test
    void toleratesAnEmptyBlobList() {
        guard.assertClean(null);
        guard.assertClean(List.of());
    }

    private void assertFinding(String expected, String path, String content) {
        assertEquals(expected, guard.findLeak(path, bytes(content)));
    }

    private static GuardedBlob blob(String path, String content) {
        return new GuardedBlob(path, bytes(content));
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
