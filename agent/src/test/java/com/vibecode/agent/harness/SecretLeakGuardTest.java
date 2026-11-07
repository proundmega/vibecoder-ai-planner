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
        GuardedBlob blob = newBlob("src/App.java", """
            class App {}
            // process.env is mentioned in documentation
            """);

        assertNull(guard.findLeak(blob));
        guard.assertClean(List.of(blob));
    }

    @Test
    void blocksAConfiguredProviderKeyOrGitHubTokenInContent() {
        assertEquals("a configured credential", guard.findLeak(
            newBlob("src/Config.java", "String key = \"oc_sk_live_1234567890\";")));
        assertEquals("a configured credential", guard.findLeak(
            newBlob("README.md", "token: ghp_configuredToken1234567890")));
        assertThrows(IllegalStateException.class, () -> guard.assertClean(
            List.of(newBlob("README.md", "token: oc_sk_live_1234567890"))));
    }

    @Test
    void blocksHighConfidenceCredentialFormats() {
        assertFinding("a private key",
            newBlob("key.pem", "-----BEGIN RSA PRIVATE KEY-----"));
        assertFinding("a GitHub token",
            newBlob("ci.yml", "token: ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
        assertFinding("a GitHub fine-grained token",
            newBlob("ci.yml", "token: github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz"));
        assertFinding("an AWS access key",
            newBlob(".env.example", "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"));
        assertFinding("an OpenAI-style key",
            newBlob("ci.yml", "api_key: sk-abcdefghijklmnopqrstuvwx"));
    }

    @Test
    void blocksASecretUsedAsAFilename() {
        assertFinding("a configured credential",
            newBlob("docs/oc_sk_live_1234567890.txt", "ordinary content"));
        assertFinding("a GitHub token",
            newBlob("src/ghp_abcdefghijklmnopqrstuvwxyz0123456789", "ordinary content"));
    }

    @Test
    void blocksABinaryBlobContainingACredential() {
        byte[] content = new byte[] {0, 1, 2, 'o', 'c', '_', 's', 'k', '_', 'l', 'i', 'v', 'e',
            '_', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 0};

        assertEquals("a configured credential",
            guard.findLeak(newBlobBytes("secret.bin", content)));
    }

    @Test
    void allowsAPreExistingFixtureInAModifiedBlob() {
        String fixture = "const key = \"sk-ant-api03-long-token-1234567890\";\n";
        GuardedBlob modified = modifiedBlob(
            "src/config.js",
            fixture + "// unrelated change\n",
            fixture);

        assertNull(guard.findLeak(modified));
        guard.assertClean(List.of(modified));
    }

    @Test
    void blocksANewSecretInAModifiedBlobWithAPreExistingFixture() {
        String fixture = "const key = \"sk-ant-api03-long-token-1234567890\";\n";
        String added = "const token = \"ghp_abcdefghijklmnopqrstuvwxyz0123456789\";\n";
        GuardedBlob modified = modifiedBlob(
            "src/config.js",
            fixture + "// unrelated change\n" + added,
            fixture);

        assertEquals("a GitHub token", guard.findLeak(modified));
        assertThrows(IllegalStateException.class,
            () -> guard.assertClean(List.of(modified)));
    }

    @Test
    void ignoresAPreExistingCredentialShapedPathButBlocksANewOne() {
        String path = "fixtures/ghp_abcdefghijklmnopqrstuvwxyz0123456789.txt";
        GuardedBlob existing = modifiedBlob(path, "ordinary\n", "ordinary\n");
        GuardedBlob added = newBlob(path, "ordinary\n");

        assertNull(guard.findLeak(existing));
        assertEquals("a GitHub token", guard.findLeak(added));
    }

    @Test
    void blocksANewPrivateKeyBlockAlongsideAPreExistingOne() {
        String oldBlock = """
            -----BEGIN RSA PRIVATE KEY-----
            OLDKEYMATERIAL
            -----END RSA PRIVATE KEY-----
            """;
        String newBlock = """
            -----BEGIN RSA PRIVATE KEY-----
            NEWKEYMATERIAL
            -----END RSA PRIVATE KEY-----
            """;
        GuardedBlob modified = modifiedBlob("key.pem", oldBlock + newBlock, oldBlock);

        assertEquals("a private key block", guard.findLeak(modified));
        assertThrows(IllegalStateException.class,
            () -> guard.assertClean(List.of(modified)));
    }

    @Test
    void blocksANewPrivateKeyBlockWhenTheBaseOnlyHasAHeader() {
        String header = "-----BEGIN RSA PRIVATE KEY-----\n";
        String block = header + "NEWKEYMATERIAL\n-----END RSA PRIVATE KEY-----\n";
        GuardedBlob modified = modifiedBlob("key.pem", block, header);

        assertEquals("a private key block", guard.findLeak(modified));
    }

    @Test
    void allowsAVerbatimCopiedPrivateKeyBlock() {
        String block = """
            -----BEGIN RSA PRIVATE KEY-----
            OLDKEYMATERIAL
            -----END RSA PRIVATE KEY-----
            """;
        GuardedBlob modified = modifiedBlob("key.pem", block + block, block);

        assertNull(guard.findLeak(modified));
        guard.assertClean(List.of(modified));
    }

    @Test
    void blocksAnOversizedBlobInsteadOfTruncating() {
        byte[] content = new byte[8 * 1024 * 1024 + 16];
        Arrays.fill(content, (byte) 'a');
        byte[] secret = "oc_sk_live_1234567890".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(secret, 0, content, content.length - secret.length, secret.length);

        assertEquals("a file larger than the credential-scan limit",
            guard.findLeak(newBlobBytes("big.bin", content)));
        assertThrows(IllegalStateException.class,
            () -> guard.assertClean(List.of(new GuardedBlob(
                "big.bin", content, new byte[0], true))));
    }

    @Test
    void blocksWhenTheBaseBlobIsTooLargeToCompare() {
        byte[] base = new byte[8 * 1024 * 1024 + 1];
        Arrays.fill(base, (byte) 'a');

        assertEquals("a base file larger than the credential-scan limit",
            guard.findLeak(new GuardedBlob("big.txt", bytes("ordinary"), base, false)));
    }

    @Test
    void ignoresShortConfiguredValuesToAvoidFalsePositives() {
        SecretLeakGuard shortGuard = new SecretLeakGuard(
            Arrays.asList("abc", "", null));

        assertNull(shortGuard.findLeak(newBlob("file.txt", "abc is a normal token")));
    }

    @Test
    void failsClosedOnAMissingBlobList() {
        assertThrows(IllegalStateException.class, () -> guard.assertClean(null));
        guard.assertClean(List.of());
    }

    private void assertFinding(String expected, GuardedBlob blob) {
        assertEquals(expected, guard.findLeak(blob));
    }

    private static GuardedBlob newBlob(String path, String content) {
        return newBlobBytes(path, bytes(content));
    }

    private static GuardedBlob newBlobBytes(String path, byte[] content) {
        return new GuardedBlob(path, content, new byte[0], true);
    }

    private static GuardedBlob modifiedBlob(String path, String content, String base) {
        return new GuardedBlob(path, bytes(content), bytes(base), false);
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.UTF_8);
    }
}
