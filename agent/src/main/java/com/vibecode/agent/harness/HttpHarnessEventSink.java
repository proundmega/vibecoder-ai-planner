package com.vibecode.agent.harness;

import com.vibecode.agent.service.ApiService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Ships harness events to the append-only backend store (fg-41 slice 1).
 *
 * <p>Emission is best effort and never throws: a backend outage must not stop a
 * ticket. Failures are counted and logged with redaction, and the supervisor's
 * own checkpoints remain the durable fallback.</p>
 */
public final class HttpHarnessEventSink implements HarnessEventSink {

    private static final Logger log = LoggerFactory.getLogger(HttpHarnessEventSink.class);

    private final ApiService apiService;
    private final AtomicLong emitted = new AtomicLong();
    private final AtomicLong failures = new AtomicLong();
    private volatile int consecutiveFailures;
    private volatile long suppressedUntil;

    public HttpHarnessEventSink(ApiService apiService) {
        this.apiService = apiService;
    }

    @Override
    public void emit(HarnessEventContext context, String type, Map<String, Object> payload) {
        if (context == null || context.runId() == null || type == null || type.isBlank()) {
            return;
        }
        long now = System.currentTimeMillis();
        if (now < suppressedUntil) {
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("eventId", UUID.randomUUID().toString());
        body.put("traceId", context.traceId().toString());
        body.put("runId", context.runId().toString());
        if (context.ticketId() != null) body.put("ticketId", context.ticketId());
        if (context.projectId() != null) body.put("projectId", context.projectId());
        if (context.agentId() != null) {
            // fg-54: the run identity is a runtime id; keep agentId for the
            // append-only historical schema (fg-41).
            body.put("agentId", context.agentId());
            body.put("runtimeId", context.agentId());
        }
        if (context.sessionId() != null) body.put("sessionId", context.sessionId());
        body.put("type", type);
        body.put("version", 1);
        body.put("timestamp", Instant.now().toString());
        body.put("payload", HarnessPayloadRedactor.redact(payload == null ? Map.of() : payload));

        try {
            apiService.emitHarnessEvent(body);
            emitted.incrementAndGet();
            consecutiveFailures = 0;
        } catch (IOException | RuntimeException e) {
            failures.incrementAndGet();
            int failuresInARow = ++consecutiveFailures;
            if (failuresInARow >= 3) {
                // Do not let a down backend add a request timeout to every
                // tool event. Retry after a short cooldown.
                suppressedUntil = System.currentTimeMillis() + 60_000L;
                consecutiveFailures = 0;
            }
            log.debug("Could not emit harness event {}: {}", type,
                RedactionRegistry.redact(String.valueOf(e.getMessage())));
        }
    }

    public long emittedCount() {
        return emitted.get();
    }

    public long failureCount() {
        return failures.get();
    }
}
