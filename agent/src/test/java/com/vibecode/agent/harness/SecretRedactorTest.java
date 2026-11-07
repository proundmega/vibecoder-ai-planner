package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
    void leavesBenignTextAlone() {
        String text = "token bucket refilled\nBearer essentials\nthe password is short\n"
            + "assert token == value";

        assertEquals(text, redactor.redact(text));
    }
}
