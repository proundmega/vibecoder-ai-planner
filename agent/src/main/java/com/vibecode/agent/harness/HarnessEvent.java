package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A single event received from an execution harness.
 */
public record HarnessEvent(String type, JsonNode payload, long timestampMs) {

    public static HarnessEvent of(String type, JsonNode payload) {
        return new HarnessEvent(type, payload, System.currentTimeMillis());
    }

    public boolean isToolEvent() {
        if (contains(type, "tool")) {
            return true;
        }
        if (payload == null) {
            return false;
        }
        return contains(payload.path("type").asText(""), "tool")
            || contains(payload.path("properties").path("part").path("type").asText(""), "tool");
    }

    public boolean isIdle() {
        return contains(type, "idle");
    }

    public boolean isError() {
        return contains(type, "error");
    }

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase().contains(needle);
    }
}
