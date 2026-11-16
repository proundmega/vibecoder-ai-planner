package com.vibecode.agent.harness;

import java.util.UUID;

/**
 * Correlation ids for every event in one supervised run (fg-41 FR3).
 *
 * <p>The trace id is generated once per run and shared by all events, including
 * backend audit records. The run id is the fg-33 durable run id.</p>
 */
public record HarnessEventContext(
    UUID traceId,
    UUID runId,
    Long ticketId,
    Long projectId,
    Long agentId,
    String sessionId
) {

    public HarnessEventContext withSessionId(String value) {
        return new HarnessEventContext(traceId, runId, ticketId, projectId, agentId, value);
    }
}
