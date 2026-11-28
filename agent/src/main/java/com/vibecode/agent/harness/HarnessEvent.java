package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.Locale;

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

    /** fg-44 storage lifecycle event (`storage.*`). */
    public boolean isStorageEvent() {
        return type != null && type.toLowerCase().startsWith("storage.");
    }

    /**
     * A question or permission request that blocks the OpenCode session until a
     * human (or the supervisor) replies.
     */
    public boolean isQuestionEvent() {
        String eventType = type == null ? "" : type;
        String payloadType = payload == null ? "" : payload.path("type").asText("");
        if (!contains(eventType, "question") && !contains(eventType, "permission")
            && !contains(payloadType, "question") && !contains(payloadType, "permission")) {
            return false;
        }
        // OpenCode publishes question.replied/rejected (and permission.replied)
        // on the same stream. Only *.asked blocks the session and needs a human;
        // treating the resolved events as new requests creates phantom questions.
        return isAsked(eventType) || isAsked(payloadType);
    }

    private static boolean isAsked(String value) {
        return value != null && value.toLowerCase(Locale.ROOT).endsWith(".asked");
    }

    /** `permission` for permission requests, `question` otherwise. */
    public String questionKind() {
        String source = type == null ? "" : type;
        String payloadType = payload == null ? "" : payload.path("type").asText("");
        return contains(source, "permission") || contains(payloadType, "permission")
            ? "permission"
            : "question";
    }

    /**
     * The OpenCode request id used for deduplication. Versions differ in where
     * the id lives, so every observed shape is checked.
     */
    public String questionRequestId() {
        if (payload == null) {
            return null;
        }
        String[] names = {
            "requestID", "requestId", "id", "questionID", "questionId",
            "permissionID", "permissionId"
        };
        // Prefer the nested request id. The SSE envelope id is `evt_...`, while
        // OpenCode question ids are `que_...` and permission ids are `per_...`.
        String value = firstText(payload.path("properties"), names);
        if (value != null) {
            return value;
        }
        value = firstText(payload.path("data"), names);
        if (value != null) {
            return value;
        }
        value = firstText(payload.path("properties").path("info"), names);
        if (value != null) {
            return value;
        }
        value = firstText(payload.path("info"), names);
        if (value != null) {
            return value;
        }
        return firstText(payload, names);
    }

    /** Best-effort human-readable prompt carried by the event. */
    public String questionText() {
        if (payload == null) {
            return null;
        }
        String value = firstText(payload, "prompt", "question", "text", "message", "title");
        if (value != null) {
            return value;
        }
        JsonNode properties = payload.path("properties");
        value = firstText(properties, "prompt", "question", "text", "message", "title");
        if (value != null) {
            return value;
        }
        JsonNode questions = properties.path("questions");
        if (!questions.isArray()) {
            questions = payload.path("questions");
        }
        if (questions.isArray() && questions.size() > 0) {
            value = firstText(questions.get(0), "question", "text", "message", "header");
            if (value != null) {
                return value;
            }
        }
        return firstText(properties.path("info"), "prompt", "question", "text", "message", "title");
    }

    public JsonNode questionOptions() {
        if (payload == null) {
            return null;
        }
        JsonNode options = payload.path("options");
        if (options.isMissingNode() || options.isNull()) {
            options = payload.path("properties").path("options");
        }
        JsonNode questions = payload.path("properties").path("questions");
        if ((options.isMissingNode() || options.isNull())
            && questions.isArray() && questions.size() > 0) {
            options = questions.get(0).path("options");
        }
        if (options.isMissingNode() || options.isNull()) {
            options = payload.path("properties").path("info").path("options");
        }
        return options.isMissingNode() || options.isNull() ? null : options;
    }

    private static String firstText(JsonNode node, String... names) {
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

    private static boolean contains(String value, String needle) {
        return value != null && value.toLowerCase().contains(needle);
    }
}
