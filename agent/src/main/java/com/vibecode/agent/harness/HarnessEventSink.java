package com.vibecode.agent.harness;

import java.util.Map;

/**
 * Destination for structured harness events (fg-41 FR1/FR2).
 *
 * <p>Emission is best effort: a sink failure must never abort a ticket. The
 * supervisor still records the same information in checkpoints and run state,
 * so observability degrades rather than blocking publishing.</p>
 */
public interface HarnessEventSink extends AutoCloseable {

    void emit(HarnessEventContext context, String type, Map<String, Object> payload);

    @Override
    default void close() {
    }

    static HarnessEventSink noop() {
        return (context, type, payload) -> {
        };
    }
}
