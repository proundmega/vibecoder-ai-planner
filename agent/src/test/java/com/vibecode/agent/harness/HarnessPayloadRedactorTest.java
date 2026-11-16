package com.vibecode.agent.harness;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessPayloadRedactorTest {

    @AfterEach
    void reset() {
        RedactionRegistry.reset();
    }

    @Test
    void redactsCredentialKeysAndFlagsThePayload() {
        Map<String, Object> safe = HarnessPayloadRedactor.redact(Map.of(
            "apiKey", "sk-abcdefghijklmnopqrstuvwxyz1234",
            "nested", Map.of("password", "super-secret-value", "ok", "visible")));

        assertEquals("[REDACTED]", safe.get("apiKey"));
        Map<?, ?> nested = assertInstanceOf(Map.class, safe.get("nested"));
        assertEquals("[REDACTED]", nested.get("password"));
        assertEquals("visible", nested.get("ok"));
        Map<?, ?> redaction = assertInstanceOf(Map.class, safe.get("_redaction"));
        assertEquals(true, redaction.get("secret_flagged"));
    }

    @Test
    void redactsKnownAndPatternTokensInsideStrings() {
        RedactionRegistry.register("configured-secret-value");
        Map<String, Object> safe = HarnessPayloadRedactor.redact(Map.of(
            "log", "configured-secret-value ghp_abcdefghijklmnopqrstuvwxyz012345"));

        String log = String.valueOf(safe.get("log"));
        assertFalse(log.contains("configured-secret-value"), log);
        assertFalse(log.contains("ghp_"), log);
        assertTrue(log.contains("[REDACTED]"), log);
    }

    @Test
    void hashesFileContentAndPromptText() {
        Map<String, Object> safe = HarnessPayloadRedactor.redact(Map.of(
            "content", "whole file content",
            "prompt", "the entire prompt"));

        Map<?, ?> content = assertInstanceOf(Map.class, safe.get("content"));
        assertEquals("content", content.get("redacted"));
        assertEquals(64, String.valueOf(content.get("sha256")).length());
        assertEquals("whole file content".length(), content.get("length"));
        assertInstanceOf(Map.class, safe.get("prompt"));
    }

    @Test
<<<<<<< HEAD
    void keepsTokenCountFieldsVisible() {
        Map<String, Object> safe = HarnessPayloadRedactor.redact(Map.of(
            "inputTokens", 1200,
            "outputTokens", 300,
            "cachedTokens", 50,
            "input_tokens", 1200,
            "output_tokens", 300,
            "token_count", 1800,
            "access_token", "ghp_abcdefghijklmnopqrstuvwxyz012345"));

        assertEquals(1200, safe.get("inputTokens"));
        assertEquals(300, safe.get("outputTokens"));
        assertEquals(50, safe.get("cachedTokens"));
        assertEquals(1200, safe.get("input_tokens"));
        assertEquals(300, safe.get("output_tokens"));
        assertEquals(1800, safe.get("token_count"));
        assertEquals("[REDACTED]", safe.get("access_token"));
    }

    @Test
=======
>>>>>>> 8422e0f (feat(fg-41): append-only harness event stream, sink and redaction)
    void truncatesLongStringsAndCapsCollections() {
        Map<String, Object> safe = HarnessPayloadRedactor.redact(Map.of(
            "note", "x".repeat(5000),
            "items", List.of(1, 2, 3)));

        Map<?, ?> note = assertInstanceOf(Map.class, safe.get("note"));
        assertEquals("truncated", note.get("redacted"));
    }
}
