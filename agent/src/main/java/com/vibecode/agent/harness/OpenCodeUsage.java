package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Set;

/**
 * Defensive extraction of token usage and tool calls from OpenCode events.
 *
 * <p>OpenCode versions differ in where they put usage (message info, step
 * parts) and tool state. Missing fields yield no delta rather than zero, so a
 * provider that does not report usage never looks like free usage.</p>
 */
public final class OpenCodeUsage {

    private static final Set<String> EDIT_TOOLS = Set.of(
        "write", "edit", "multiedit", "apply_patch", "patch",
        "sandbox_write", "sandbox_edit");

    private OpenCodeUsage() {
    }

    /** A cumulative token snapshot for one message or step part. */
    public record TokenDelta(
        String sourceKey,
        long inputTokens,
        long outputTokens,
        long cachedTokens,
        double costUsd
    ) {
    }

    /** One tool invocation observed in the event stream. */
    public record ToolCall(
        String tool,
        String callId,
        boolean failed,
        String filePath,
        String command
    ) {
        public boolean editsFile() {
            return tool != null && EDIT_TOOLS.contains(tool);
        }
    }

    public static TokenDelta tokens(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        JsonNode info = payload.path("properties").path("info");
        if (info.isMissingNode() || info.isNull()) {
            info = payload.path("info");
        }
        JsonNode part = payload.path("properties").path("part");
        if (part.isMissingNode() || part.isNull()) {
            part = payload.path("part");
        }

        JsonNode tokenNode = firstObject(info.path("tokens"), part.path("tokens"));
        if (tokenNode == null) {
            tokenNode = firstObject(payload.path("tokens"));
        }
        if (tokenNode == null) {
            return null;
        }

        long input = longValue(tokenNode, "input", "input_tokens", "prompt_tokens");
        long output = longValue(tokenNode, "output", "output_tokens", "completion_tokens");
        JsonNode cache = tokenNode.path("cache");
        long cached = longValue(cache, "read", "read_tokens")
            + longValue(cache, "write", "write_tokens");
        if (input == 0 && output == 0 && cached == 0) {
            return null;
        }

        String messageId = text(info, "id");
        if (messageId == null) {
            messageId = text(part, "messageID", "messageId");
        }
        if (messageId == null) {
            messageId = text(payload, "messageID", "messageId");
        }
        String partId = text(part, "id", "callID");
        String sourceKey = messageId != null
            ? "msg:" + messageId
            : (partId != null ? "part:" + partId : "anon");

        double cost = info.path("cost").isNumber()
            ? info.path("cost").asDouble()
            : (part.path("cost").isNumber() ? part.path("cost").asDouble() : -1);

        return new TokenDelta(sourceKey, input, output, cached, cost);
    }

    public static ToolCall toolCall(JsonNode payload) {
        if (payload == null) {
            return null;
        }
        JsonNode part = payload.path("properties").path("part");
        if (part.isMissingNode() || part.isNull()) {
            part = payload.path("part");
        }
        String partType = text(part, "type");
        String eventType = text(payload, "type");
        boolean toolPart = (partType != null && partType.toLowerCase().contains("tool"))
            || (eventType != null && eventType.toLowerCase().contains("tool"));
        if (!toolPart) {
            return null;
        }

        String tool = text(part, "tool", "name");
        if (tool == null) {
            tool = text(part.path("state"), "tool", "name");
        }
        if (tool == null) {
            return null;
        }
        String callId = text(part, "callID", "callId", "id");
        JsonNode state = part.path("state");
        String status = text(state, "status");
        boolean failed = "error".equalsIgnoreCase(status)
            || "failed".equalsIgnoreCase(status)
            || state.has("error")
            || part.path("isError").asBoolean(false);

        JsonNode input = state.path("input");
        String filePath = text(input, "filePath", "file_path", "path");
        String command = text(input, "command", "cmd");
        return new ToolCall(tool, callId, failed, filePath, command);
    }

    private static JsonNode firstObject(JsonNode... candidates) {
        for (JsonNode candidate : candidates) {
            if (candidate != null && candidate.isObject()) {
                return candidate;
            }
        }
        return null;
    }

    private static long longValue(JsonNode node, String... names) {
        if (node == null) {
            return 0;
        }
        for (String name : names) {
            JsonNode value = node.path(name);
            if (value.isNumber()) {
                return Math.max(0, value.asLong());
            }
        }
        return 0;
    }

    private static String text(JsonNode node, String... names) {
        if (node == null) {
            return null;
        }
        for (String name : names) {
            String value = node.path(name).asText("");
            if (!value.isBlank()) {
                return value;
            }
        }
        return null;
    }
}
