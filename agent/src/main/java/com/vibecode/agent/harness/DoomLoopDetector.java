package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Supervisor-side repetition policy (fg-55 FR5).
 *
 * <p>OpenCode's own `doom_loop` action is denied because it is V1-only and not a
 * V2 action. Instead the supervisor hashes each tool call as
 * {@code sha256(tool + "\n" + canonicalJson(args))} and counts consecutive
 * equal signatures. At the configured cap it asks a human; a human "continue"
 * resets the counter, and exceeding the continue cap aborts the run. Budget and
 * tool-call caps remain authoritative.</p>
 */
public final class DoomLoopDetector {

    public enum Decision {
        NONE,
        ESCALATE,
        ABORT
    }

    private final int maxRepeats;
    private final int maxContinues;
    private final Set<String> seenCallIds = new HashSet<>();
    private String lastSignature;
    private int repeats;
    private int continues;
    private boolean escalated;

    public DoomLoopDetector(int maxRepeats, int maxContinues) {
        this.maxRepeats = Math.max(1, maxRepeats);
        this.maxContinues = Math.max(1, maxContinues);
    }

    /**
     * Record one event. Only tool events contribute; a different signature
     * resets the run of identical calls.
     */
    public synchronized Decision observe(HarnessEvent event) {
        OpenCodeUsage.ToolCall call = event == null ? null : OpenCodeUsage.toolCall(event.payload());
        if (call == null) {
            return Decision.NONE;
        }
        // OpenCode emits running and completed updates for the same call. Count
        // a physical invocation once, not once per lifecycle event.
        if (call.callId() != null && !call.callId().isBlank()
            && !seenCallIds.add(call.callId())) {
            return Decision.NONE;
        }
        String signature = signature(event);
        if (signature == null) {
            return Decision.NONE;
        }
        if (signature.equals(lastSignature)) {
            repeats++;
        } else {
            lastSignature = signature;
            repeats = 1;
            escalated = false;
        }
        if (repeats >= maxRepeats && !escalated) {
            escalated = true;
            return Decision.ESCALATE;
        }
        return Decision.NONE;
    }

    /** The human chose continue: reset the repeat run and enforce the cap. */
    public synchronized Decision continueAfterHuman() {
        continues++;
        lastSignature = null;
        repeats = 0;
        escalated = false;
        if (continues >= maxContinues) {
            return Decision.ABORT;
        }
        return Decision.NONE;
    }

    /** The human chose abort. */
    public synchronized Decision abort() {
        return Decision.ABORT;
    }

    public synchronized int continues() {
        return continues;
    }

    public synchronized String signature(HarnessEvent event) {
        if (event == null || !event.isToolEvent()) {
            return null;
        }
        OpenCodeUsage.ToolCall tool = OpenCodeUsage.toolCall(event.payload());
        String name = tool == null ? null : tool.tool();
        if (name == null || name.isBlank()) {
            return null;
        }
        JsonNode args = event.payload() == null
            ? null
            : event.payload().path("properties").path("part").path("state").path("input");
        if (args == null || args.isMissingNode() || args.isNull()) {
            args = event.payload() == null
                ? null
                : event.payload().path("part").path("state").path("input");
        }
        return sha256(name + "\n" + canonical(args));
    }

    static String canonical(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return "null";
        }
        if (node.isObject()) {
            List<String> names = new ArrayList<>();
            Iterator<String> iterator = node.fieldNames();
            iterator.forEachRemaining(names::add);
            Collections.sort(names);
            StringBuilder builder = new StringBuilder("{");
            for (int i = 0; i < names.size(); i++) {
                if (i > 0) {
                    builder.append(',');
                }
                String name = names.get(i);
                builder.append(quote(name)).append(':').append(canonical(node.get(name)));
            }
            return builder.append('}').toString();
        }
        if (node.isArray()) {
            List<String> values = new ArrayList<>();
            node.forEach(child -> values.add(canonical(child)));
            return "[" + String.join(",", values) + "]";
        }
        if (node.isTextual()) {
            return quote(node.asText());
        }
        return node.toString();
    }

    private static String quote(String value) {
        return '"' + value.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    }

    static String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    /** Exposed for tests and diagnostics. */
    public Map<String, Object> state() {
        return Map.of(
            "repeats", repeats,
            "continues", continues,
            "escalated", escalated
        );
    }
}
