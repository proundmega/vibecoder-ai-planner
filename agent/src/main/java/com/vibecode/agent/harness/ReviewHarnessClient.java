package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Runs one read-only review session (fg-31c, FR1/FR3).
 *
 * <p>The client owns the OpenCode lifecycle and prompt/event handling; the
 * caller owns the disposable workspace and supervisor verification. The
 * OpenCode config denies the write/edit bridge tools, and the returned text is
 * the assistant's final message for {@link ReviewResultParser}.</p>
 */
public final class ReviewHarnessClient implements AutoCloseable {

    private final HarnessClient harness;
    private final ReviewPromptBuilder promptBuilder;

    public ReviewHarnessClient(HarnessClient harness) {
        this(harness, new ReviewPromptBuilder());
    }

    ReviewHarnessClient(HarnessClient harness, ReviewPromptBuilder promptBuilder) {
        if (harness == null) {
            throw new IllegalArgumentException("harness is required");
        }
        this.harness = harness;
        this.promptBuilder = promptBuilder == null ? new ReviewPromptBuilder() : promptBuilder;
    }

    /**
     * Production factory. {@code reviewMode} denies the guarded write/edit
     * tools while leaving the workspace writable for verification.
     */
    public static ReviewHarnessClient open(
        HarnessConfig config,
        ProviderSettings provider,
        Path tempDir
    ) {
        return new ReviewHarnessClient(
            new OpenCodeClient(config, provider, tempDir, null, true));
    }

    /**
     * Start the harness in the workspace, send the review prompt and return the
     * assistant's final text. An empty or unhealthy result is an IOException so
     * the processor fails closed.
     */
    public String review(Path workspace, String title, ReviewPromptBuilder.Request request)
        throws IOException {
        if (request == null) {
            throw new IOException("review prompt request is required");
        }
        return review(workspace, title, promptBuilder.build(request));
    }

    public String review(Path workspace, String title, String prompt) throws IOException {
        if (workspace == null) {
            throw new IOException("review workspace is required");
        }
        if (prompt == null || prompt.isBlank()) {
            throw new IOException("review prompt is required");
        }
        harness.start(workspace);
        String sessionId = harness.createSession(title == null ? "review" : title);
        Transcript transcript = new Transcript();
        harness.subscribe(sessionId, transcript::accept);
        harness.sendPrompt(sessionId, prompt);
        if (!harness.isHealthy()) {
            throw new IOException("review harness is unhealthy after the prompt");
        }
        String text = transcript.text();
        if (text.isBlank()) {
            throw new IOException("reviewer returned no review text");
        }
        return text;
    }

    public boolean isHealthy() {
        return harness.isHealthy();
    }

    @Override
    public void close() {
        harness.close();
    }

    /**
     * Collects assistant text parts from OpenCode SSE events. Events are
     * version-dependent, so both {@code properties.info}/{@code properties.part}
     * and flat payload shapes are accepted.
     */
    static final class Transcript {

        private final Map<String, String> partTexts = new LinkedHashMap<>();
        private final Map<String, String> partMessages = new HashMap<>();
        private final List<String> messageOrder = new ArrayList<>();
        private final Set<String> assistantMessages = new HashSet<>();
        private String lastMessageId;

        void accept(HarnessEvent event) {
            if (event == null || event.payload() == null) {
                return;
            }
            JsonNode payload = event.payload();
            JsonNode properties = payload.path("properties");
            JsonNode info = properties.path("info");
            if (info.isObject()) {
                String messageId = firstText(info, "id");
                if (messageId != null) {
                    noteMessage(messageId);
                    if ("assistant".equalsIgnoreCase(firstText(info, "role"))) {
                        assistantMessages.add(messageId);
                    }
                }
            }

            JsonNode part = properties.has("part") ? properties.path("part") : payload.path("part");
            if (part.isObject()) {
                String type = part.path("type").asText("");
                JsonNode text = part.path("text");
                if ((type.isBlank() || "text".equals(type)) && text.isTextual()) {
                    String messageId = firstText(part, "messageID", "messageId", "message_id");
                    if (messageId == null) {
                        messageId = lastMessageId == null ? "message" : lastMessageId;
                    }
                    noteMessage(messageId);
                    String partId = firstText(part, "id");
                    String key = partId == null
                        ? messageId + "#" + partTexts.size()
                        : messageId + "/" + partId;
                    partTexts.put(key, text.asText());
                    partMessages.put(key, messageId);
                }
            }
        }

        String text() {
            String chosen = lastAssistantMessage();
            if (chosen == null && !messageOrder.isEmpty()) {
                chosen = messageOrder.get(messageOrder.size() - 1);
            }
            String text = join(chosen);
            if (!text.isBlank()) {
                return text;
            }
            StringBuilder all = new StringBuilder();
            for (String value : partTexts.values()) {
                all.append(value);
            }
            return all.toString();
        }

        private String lastAssistantMessage() {
            String chosen = null;
            for (String messageId : messageOrder) {
                if (assistantMessages.contains(messageId)) {
                    chosen = messageId;
                }
            }
            return chosen;
        }

        private String join(String messageId) {
            if (messageId == null) {
                return "";
            }
            StringBuilder text = new StringBuilder();
            for (Map.Entry<String, String> entry : partTexts.entrySet()) {
                if (messageId.equals(partMessages.get(entry.getKey()))) {
                    text.append(entry.getValue());
                }
            }
            return text.toString();
        }

        private void noteMessage(String messageId) {
            lastMessageId = messageId;
            if (!messageOrder.contains(messageId)) {
                messageOrder.add(messageId);
            }
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
    }
}
