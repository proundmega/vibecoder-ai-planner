package com.vibecode.agent.harness;

import com.vibecode.agent.service.ApiService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class HttpHarnessEventSinkTest {

    private final UUID runId = UUID.randomUUID();
    private final UUID traceId = UUID.randomUUID();
    private final HarnessEventContext context = new HarnessEventContext(
        traceId, runId, 42L, 7L, 9L, "ses_test");

    @Test
    void shipsACorrelatedRedactedEvent() throws Exception {
        ApiService apiService = mock(ApiService.class);
        HttpHarnessEventSink sink = new HttpHarnessEventSink(apiService);

        sink.emit(context, "tool.called", Map.of(
            "tool", "bash",
            "token", "ghp_abcdefghijklmnopqrstuvwxyz012345"));

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
        verify(apiService).emitHarnessEvent(captor.capture());
        Map<String, Object> body = captor.getValue();
        assertEquals(traceId.toString(), body.get("traceId"));
        assertEquals(runId.toString(), body.get("runId"));
        assertEquals(42L, body.get("ticketId"));
        assertEquals("tool.called", body.get("type"));
        assertEquals(1, sink.emittedCount());
        assertFalse(body.toString().contains("ghp_"), body.toString());
    }

    @Test
    void countsFailuresWithoutThrowing() throws Exception {
        ApiService apiService = mock(ApiService.class);
        doThrow(new IOException("backend down")).when(apiService).emitHarnessEvent(anyMap());
        HttpHarnessEventSink sink = new HttpHarnessEventSink(apiService);

        sink.emit(context, "step.changed", Map.of("step", "verifying"));

        assertEquals(1, sink.failureCount());
        assertEquals(0, sink.emittedCount());
    }

    @Test
    void ignoresAnEventWithoutARun() throws Exception {
        ApiService apiService = mock(ApiService.class);
        HttpHarnessEventSink sink = new HttpHarnessEventSink(apiService);

        sink.emit(new HarnessEventContext(traceId, null, null, null, null, null),
            "run.started", Map.of());

        verify(apiService, org.mockito.Mockito.never()).emitHarnessEvent(anyMap());
    }
}
