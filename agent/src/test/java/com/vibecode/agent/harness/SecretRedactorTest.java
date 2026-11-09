package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

class SecretRedactorTest {

    private final SecretRedactor redactor = new SecretRedactor(List.of("configured-secret-value"));

    @Test
    void replacesConfiguredSecrets() {
        String redacted = redactor.redact("before configured-secret-value after");

        assertEquals("before [REDACTED] after", redacted);
    }

    @Test
    void ignoresConfiguredSecretsShorterThanEightCharacters() {
        SecretRedactor shortSecrets = new SecretRedactor(List.of("abc"));

        assertEquals("abc", shortSecrets.redact("abc"));
    }

    @Test
    void redactsKnownCredentialFormats() {
        List<String> secrets = List.of(
            "ghp_abcdefghijklmnopqrstuvwxyz012345",
            "github_pat_abcdefghijklmnopqrstuvwxyz012345",
            "sk-abcdefghijklmnopqrstuvwxyz012345",
            "AKIAIOSFODNN7EXAMPLE",
            "xoxb-123456789012-abcdefghijkl",
            "AIza" + "a".repeat(35),
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature1234567890"
        );

        for (String secret : secrets) {
            String redacted = redactor.redact("value=" + secret);
            assertFalse(redacted.contains(secret), "Not redacted: " + secret);
            assertTrue(redacted.contains("[REDACTED]"), redacted);
        }
    }

    @Test
    void redactsBearerAndBasicAuthorizationValues() {
        String redacted = redactor.redact(
            "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345");

        assertFalse(redacted.contains("abcdefghijklmnopqrstuvwxyz012345"), redacted);
        assertTrue(redacted.contains("[REDACTED]"), redacted);
    }

    @Test
    void redactsUrlUserInfo() {
        String redacted = redactor.redact("https://user:super-secret@internal.example/path");

        assertEquals("https://[REDACTED]@internal.example/path", redacted);
    }

    @Test
    void redactsPrefixedAndSuffixedCredentialKeys() {
        List<String> keys = List.of(
            "client_secret",
            "access_token",
            "refresh_token",
            "db_password",
            "DB_PASSWORD",
            "secret_key",
            "private_key",
            "auth_token",
            "clientSecret",
            "accessToken"
        );

        for (String key : keys) {
            String redacted = redactor.redact(key + "=abcdefghijklmnop");
            assertFalse(redacted.contains("abcdefghijklmnop"), key + " -> " + redacted);
            assertTrue(redacted.contains("[REDACTED]"), key + " -> " + redacted);
        }
    }

    @Test
    void redactsAwsSecretAccessKeys() {
        String redacted = redactor.redact(
            "AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz0123456789ABCD");

        assertFalse(redacted.contains("abcdefghijklmnopqrstuvwxyz0123456789ABCD"), redacted);
    }

    @Test
    void redactsPasswordBearingUrlsWithAndWithoutAUsername() {
        String redis = redactor.redact("redis://:super-secret@host:6379/0");
        assertFalse(redis.contains("super-secret"), redis);
        assertTrue(redis.contains("redis://[REDACTED]@host:6379/0"), redis);

        String https = redactor.redact("https://user:super-secret@internal.example/path");
        assertFalse(https.contains("super-secret"), https);
    }

    @Test
    void redactsQuotedCredentialValuesWithSpaces() {
        String redacted = redactor.redact("\"password\": \"super secret phrase\"");

        assertFalse(redacted.contains("super secret phrase"), redacted);
        assertTrue(redacted.contains("[REDACTED]"), redacted);
    }

    @Test
    void redactsTheRemainderOfAnUnmatchedPrivateKey() {
        String redacted = redactor.redact(
            "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234567890");

        assertFalse(redacted.contains("MIIEowIBAAKCAQEA1234567890"), redacted);
        assertTrue(redacted.contains("[REDACTED PRIVATE KEY]"), redacted);
    }

    @Test
    void redactsLargeAlphanumericOutputWithoutCatastrophicBacktracking() {
        String input = "x".repeat(32_768);

        assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
            assertEquals(input, redactor.redact(input));
        });
    }

    @Test
    void redactsRepeatedCredentialKeywordsInBoundedTime() {
        String sixtyFourK = "token".repeat(13_107);
        String oneTwentyEightK = "token".repeat(26_214);

        assertTimeoutPreemptively(Duration.ofSeconds(10), () -> {
            assertEquals(sixtyFourK, redactor.redact(sixtyFourK));
            assertEquals(oneTwentyEightK, redactor.redact(oneTwentyEightK));
        });
    }

    @Test
    void redactsARepeatedKeywordIdentifierFollowedByASeparator() {
        String input = "token".repeat(1_000) + "=abcdefghijklmnop";

        assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
            String redacted = redactor.redact(input);
            assertFalse(redacted.contains("abcdefghijklmnop"), redacted);
            assertTrue(redacted.contains("[REDACTED]"), redacted);
        });
    }

    @Test
    void redactsQuotedValuesContainingEscapedQuotes() {
        String escapedSuffix = redactor.redact(
            "{\"password\": \"abcdefgh\\\"ijklmnop\"}");
        assertFalse(escapedSuffix.contains("abcdefgh"), escapedSuffix);
        assertFalse(escapedSuffix.contains("ijklmnop"), escapedSuffix);
        assertTrue(escapedSuffix.contains("\"[REDACTED]\""), escapedSuffix);

        String escapedPrefix = redactor.redact(
            "{\"password\": \"\\\"abcdefghijklmnop\"}");
        assertFalse(escapedPrefix.contains("abcdefghijklmnop"), escapedPrefix);
        assertTrue(escapedPrefix.contains("\"[REDACTED]\""), escapedPrefix);
    }

    @Test
    void preservesKeyValueSyntaxWhenRedacting() {
        assertEquals("api_key: [REDACTED]",
            redactor.redact("api_key: abcdefghijklmnop"));
        assertEquals("\"password\": \"[REDACTED]\"",
            redactor.redact("\"password\": \"abcdefghijklmnop\""));
        assertEquals("password='[REDACTED]'",
            redactor.redact("password='abcdefghijklmnop'"));
    }

    @Test
    void redactsTemporaryAwsKeysAndAdditionalSlackPrefixes() {
        assertFalse(redactor.redact("ASIAIOSFODNN7EXAMPLE")
            .contains("ASIAIOSFODNN7EXAMPLE"));
        assertFalse(redactor.redact("xoxc-123456789012-abcdefghijkl")
            .contains("xoxc-123456789012-abcdefghijkl"));
        assertFalse(redactor.redact("xoxd-123456789012-abcdefghijkl")
            .contains("xoxd-123456789012-abcdefghijkl"));
    }

    @Test
    void redactsPgpAndSsh2PrivateKeyBlocks() {
        String pgp = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nABCDEF\n"
            + "-----END PGP PRIVATE KEY BLOCK-----";
        String pgpRedacted = redactor.redact(pgp);
        assertFalse(pgpRedacted.contains("ABCDEF"), pgpRedacted);
        assertTrue(pgpRedacted.contains("[REDACTED PRIVATE KEY]"), pgpRedacted);

        String ssh2 = "---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nABCDEF\n"
            + "---- END SSH2 ENCRYPTED PRIVATE KEY ----";
        String ssh2Redacted = redactor.redact(ssh2);
        assertFalse(ssh2Redacted.contains("ABCDEF"), ssh2Redacted);
        assertTrue(ssh2Redacted.contains("[REDACTED PRIVATE KEY]"), ssh2Redacted);
    }

    @Test
    void redactsNestedCredentialsInsideNonCredentialValues() {
        assertEquals("AssertionError: password=[REDACTED]",
            redactor.redact("AssertionError: password=supersecret"));
        assertEquals("{\"message\": \"password=[REDACTED]\"}",
            redactor.redact("{\"message\": \"password=supersecret\"}"));
        assertEquals("https://example.com?token=[REDACTED]",
            redactor.redact("https://example.com?token=abcdefghijklmnop"));
        assertEquals("redirect=https://example.com?token=[REDACTED]",
            redactor.redact(
                "redirect=https://example.com?token=abcdefghijklmnop"));
    }

    @Test
    void redactsUnquotedMultiWordCredentialValues() {
        String password = redactor.redact("password=supersecret phrase");
        assertFalse(password.contains("supersecret"), password);
        assertFalse(password.contains("phrase"), password);

        String passphrase = redactor.redact("passphrase=super secret phrase");
        assertTrue(passphrase.contains("[REDACTED]"), passphrase);
        assertFalse(passphrase.contains("super secret phrase"), passphrase);
    }

    @Test
    void redactsAuthorizationSchemesAndShortBearerValues() {
        for (String scheme : List.of("Negotiate", "Token", "ApiKey", "Digest")) {
            String redacted = redactor.redact(
                "Authorization: " + scheme + " supersecret");
            assertFalse(redacted.contains("supersecret"), redacted);
            assertFalse(redacted.contains(scheme), redacted);
        }

        String bearer = redactor.redact("Authorization: Bearer shorttoken");
        assertFalse(bearer.contains("shorttoken"), bearer);
    }

    @Test
    void redactsPassphraseKeys() {
        String quoted = redactor.redact("passphrase=\"super secret phrase\"");
        assertFalse(quoted.contains("super secret phrase"), quoted);
    }

    @Test
    void leavesShortCredentialValuesAlone() {
        assertEquals("password=hunter2", redactor.redact("password=hunter2"));
        assertEquals("\"password\": \"hunter2\"",
            redactor.redact("\"password\": \"hunter2\""));
    }

    @Test
    void redactsCommonKeyValueForms() {
        assertFalse(redactor.redact("password=super-secret").contains("super-secret"));
        assertFalse(redactor.redact("\"token\": \"abcdefghijklmnop\"").contains("abcdefghijklmnop"));
        assertFalse(redactor.redact("api_key: abcdefghijklmnop").contains("abcdefghijklmnop"));
    }

    @Test
    void redactsCompleteAndHeaderOnlyPrivateKeyBlocks() {
        String block = "-----BEGIN RSA PRIVATE KEY-----\n"
            + "MIIEowIBAAKCAQEA1234567890\n"
            + "-----END RSA PRIVATE KEY-----";

        String redacted = redactor.redact("before\n" + block + "\nafter");

        assertFalse(redacted.contains("MIIEowIBAAKCAQEA1234567890"), redacted);
        assertTrue(redacted.contains("[REDACTED PRIVATE KEY]"), redacted);
        assertTrue(redacted.contains("before") && redacted.contains("after"), redacted);

        String headerOnly = redactor.redact("-----BEGIN OPENSSH PRIVATE KEY-----");
        assertFalse(headerOnly.contains("OPENSSH PRIVATE KEY"), headerOnly);
    }

    @Test
    void redactsAMultiLinePrivateKeyAssignedToACredentialKey() {
        String input = "password=-----BEGIN RSA PRIVATE KEY-----\n"
            + "MIIEowIBAAKCAQEA1234567890\n"
            + "-----END RSA PRIVATE KEY-----";

        String redacted = redactor.redact(input);

        assertFalse(redacted.contains("MIIEowIBAAKCAQEA1234567890"), redacted);
        assertTrue(redacted.contains("[REDACTED"), redacted);
    }

    @Test
    void leavesBenignTextAlone() {
        String text = "token bucket refilled\nBearer essentials\nthe password is short\n"
            + "assert token == value";

        assertEquals(text, redactor.redact(text));
    }
}
