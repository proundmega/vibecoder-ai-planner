package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Redacts event payloads before they leave the supervisor (fg-41 FR4, NFR5).
 *
 * <p>Known credentials are replaced by {@link RedactionRegistry}. Credential
 * keys are dropped, file/prompt content becomes a hash plus length, and long
 * strings are truncated with a hash. This is the emission-side guard; the
 * backend re-scans at ingest.</p>
 */
public final class HarnessPayloadRedactor {

    private static final int MAX_STRING = 4096;
    private static final int PREVIEW_LENGTH = 1000;
    private static final int MAX_DEPTH = 20;
    private static final java.util.Set<String> TOKEN_COUNT_KEYS = java.util.Set.of(
        "tokens", "inputtokens", "outputtokens", "cachedtokens",
        "reasoningtokens", "maxtokens", "tokencount", "tokencounts",
        "totaltokens", "prompttokens", "completiontokens", "tokensin", "tokensout");

    private HarnessPayloadRedactor() {
    }

    public static Map<String, Object> redact(Map<String, Object> payload) {
        Map<String, Object> safe = new LinkedHashMap<>();
        boolean secretFlagged = false;
        if (payload != null) {
            for (Map.Entry<String, Object> entry : payload.entrySet()) {
                RedactedValue value = redactValue(entry.getKey(), entry.getValue(), 0);
                safe.put(entry.getKey(), value.value());
                secretFlagged |= value.secretFlagged();
            }
        }
        if (secretFlagged) {
            Map<String, Object> redaction = new LinkedHashMap<>();
            redaction.put("version", 1);
            redaction.put("secret_flagged", true);
            safe.put("_redaction", redaction);
        }
        return safe;
    }

    private static RedactedValue redactValue(String key, Object value, int depth) {
        if (value == null) {
            return new RedactedValue(null, false);
        }
        if (depth > MAX_DEPTH) {
            return new RedactedValue("[TRUNCATED: max depth]", false);
        }
        if (key != null && isSensitiveKey(key)) {
            return new RedactedValue("[REDACTED]", true);
        }
        if (value instanceof String text) {
            return redactString(key, text);
        }
        if (value instanceof Number || value instanceof Boolean) {
            return new RedactedValue(value, false);
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> nested = new LinkedHashMap<>();
            boolean flagged = false;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String childKey = String.valueOf(entry.getKey());
                RedactedValue child = redactValue(childKey, entry.getValue(), depth + 1);
                nested.put(childKey, child.value());
                flagged |= child.secretFlagged();
            }
            return new RedactedValue(nested, flagged);
        }
        if (value instanceof Iterable<?> iterable) {
            List<Object> list = new ArrayList<>();
            boolean flagged = false;
            int count = 0;
            for (Object item : iterable) {
                if (count++ >= 200) {
                    list.add("[TRUNCATED: max items]");
                    break;
                }
                RedactedValue child = redactValue(key, item, depth + 1);
                list.add(child.value());
                flagged |= child.secretFlagged();
            }
            return new RedactedValue(list, flagged);
        }
        if (value.getClass().isArray()) {
            return redactValue(key, List.of((Object[]) value), depth);
        }
        return new RedactedValue("[UNSUPPORTED]", false);
    }

    private static RedactedValue redactString(String key, String text) {
        if (key != null && isContentKey(key)) {
            Map<String, Object> digest = new LinkedHashMap<>();
            digest.put("redacted", "content");
            digest.put("sha256", HarnessDigest.sha256(text));
            digest.put("length", text.length());
            return new RedactedValue(digest, false);
        }
        String redacted = RedactionRegistry.redact(text);
        boolean flagged = !redacted.equals(text);
        if (redacted.length() > MAX_STRING) {
            Map<String, Object> truncated = new LinkedHashMap<>();
            truncated.put("redacted", "truncated");
            truncated.put("sha256", HarnessDigest.sha256(redacted));
            truncated.put("length", redacted.length());
            truncated.put("preview", redacted.substring(0, PREVIEW_LENGTH));
            return new RedactedValue(truncated, flagged);
        }
        return new RedactedValue(redacted, flagged);
    }

    private static boolean isSensitiveKey(String key) {
        String value = key.toLowerCase(Locale.ROOT);
        if (TOKEN_COUNT_KEYS.contains(value.replace("_", "").replace("-", ""))) {
            return false;
        }
        return value.contains("password")
            || value.contains("passwd")
            || value.contains("passphrase")
            || value.contains("secret")
            || value.contains("token")
            || value.contains("api_key")
            || value.contains("apiKey".toLowerCase(Locale.ROOT))
            || value.contains("apikey")
            || value.contains("private_key")
            || value.contains("privatekey")
            || value.contains("authorization")
            || value.contains("credential")
            || value.equals("cookie");
    }

    private static boolean isContentKey(String key) {
        String value = key.toLowerCase(Locale.ROOT);
        return value.equals("content")
            || value.equals("filecontent")
            || value.equals("file_content")
            || value.equals("fullpatch")
            || value.equals("full_patch")
            || value.equals("patch")
            || value.equals("prompt")
            || value.equals("prompttext")
            || value.equals("prompt_text");
    }

    private record RedactedValue(Object value, boolean secretFlagged) {
    }
}
