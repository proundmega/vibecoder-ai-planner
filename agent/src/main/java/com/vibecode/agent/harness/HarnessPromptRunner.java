package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;

import java.io.IOException;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs one prompt turn on a started harness session (fg-32c2c3b3b).
 *
 * <p>Extracted from {@link ReviewHarnessClient} so the fix loop reuses the same
 * terminal-event handling instead of duplicating the SSE transcript logic. The
 * caller owns the harness lifecycle and the workspace.</p>
 */
final class HarnessPromptRunner {

    private final String label;
    private final String emptyTextMessage;
    private final Duration terminalTimeout;

    HarnessPromptRunner(String label, String emptyTextMessage, Duration terminalTimeout) {
        this.label = label == null || label.isBlank() ? "harness" : label;
        this.emptyTextMessage = emptyTextMessage == null || emptyTextMessage.isBlank()
            ? this.label + " returned no text"
            : emptyTextMessage;
        this.terminalTimeout = terminalTimeout == null || terminalTimeout.isNegative()
            ? ReviewHarnessClient.DEFAULT_TERMINAL_TIMEOUT
            : terminalTimeout;
    }

    /**
     * Start in the workspace (when needed), send the prompt and return the
     * assistant's final text. OpenCode event delivery is asynchronous, so a
     * blank transcript waits for a terminal (idle/error) event. An empty or
     * unhealthy result is an IOException so the caller fails closed.
     */
    String run(HarnessClient harness, Path workspace, String title, String prompt)
        throws IOException {
        if (harness == null) {
            throw new IOException("harness client is required");
        }
        if (workspace == null) {
            throw new IOException(label + " workspace is required");
        }
        if (prompt == null || prompt.isBlank()) {
            throw new IOException(label + " prompt is required");
        }
        harness.start(workspace);
        String sessionId = harness.createSession(title == null || title.isBlank()
            ? label : title);
        Transcript transcript = new Transcript();
        CountDownLatch terminal = new CountDownLatch(1);
        AtomicBoolean errored = new AtomicBoolean();
        harness.subscribe(sessionId, event -> {
            transcript.accept(event);
            if (event == null) {
                return;
            }
            if (event.isError()) {
                errored.set(true);
                terminal.countDown();
            } else if (event.isIdle()) {
                terminal.countDown();
            }
        });
        harness.sendPrompt(sessionId, prompt);
        // SSE runs on its own thread: the blocking POST can return after an
        // early partial part but before the final assistant message and idle.
        if (!awaitTerminal(terminal)) {
            throw new IOException(label + " harness did not report a terminal event");
        }
        if (errored.get()) {
            throw new IOException(label + " harness reported an error");
        }
        if (!harness.isHealthy()) {
            throw new IOException(label + " harness is unhealthy after the prompt");
        }
        String text = transcript.text();
        if (text.isBlank()) {
            throw new IOException(emptyTextMessage);
        }
        return text;
    }

    private boolean awaitTerminal(CountDownLatch terminal) throws IOException {
        try {
            return terminal.await(terminalTimeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IOException("interrupted while waiting for the " + label, error);
        }
    }

    /**
     * Collects assistant text parts from OpenCode SSE events. Events are
     * version-dependent, so both {@code properties.info}/{@code properties.part}
     * and flat payload shapes are accepted. The listener runs on the SSE thread,
     * so every read/write is synchronized.
     */
    static final class Transcript {

        private final Map<String, String> partTexts = new LinkedHashMap<>();
        private final Map<String, String> partMessages = new HashMap<>();
        private final List<String> messageOrder = new ArrayList<>();
        private final Set<String> assistantMessages = new HashSet<>();
        private final Set<String> userMessages = new HashSet<>();
        private final Set<String> knownMessages = new HashSet<>();
        private String lastMessageId;

        synchronized void accept(HarnessEvent event) {
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
                    knownMessages.add(messageId);
                    String role = firstText(info, "role");
                    if ("assistant".equalsIgnoreCase(role)) {
                        assistantMessages.add(messageId);
                    } else if ("user".equalsIgnoreCase(role)) {
                        userMessages.add(messageId);
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
                        ? messageId + "#text"
                        : messageId + "/" + partId;
                    partTexts.put(key, text.asText());
                    partMessages.put(key, messageId);
                }
            }
        }

        synchronized String text() {
            String chosen = lastAssistantMessage();
            if (chosen != null) {
                // An assistant message wins even when its text is blank: never
                // fall back to a user message or an unrelated part.
                return join(chosen);
            }
            if (!userMessages.isEmpty()) {
                // Fail closed: a user-only transcript is never the review.
                return "";
            }
            if (!messageOrder.isEmpty()) {
                return join(messageOrder.get(messageOrder.size() - 1));
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
