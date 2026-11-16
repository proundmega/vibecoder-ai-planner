package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenCodeUsageTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private JsonNode json(String value) throws IOException {
        return mapper.readTree(value);
    }

    @Test
    void extractsCumulativeMessageTokensAndCache() throws IOException {
        JsonNode payload = json("{\"type\":\"message.updated\",\"properties\":{\"info\":{"
            + "\"id\":\"msg-1\",\"cost\":0.25,"
            + "\"tokens\":{\"input\":120,\"output\":40,"
            + "\"cache\":{\"read\":10,\"write\":5}}}}}");

        OpenCodeUsage.TokenDelta delta = OpenCodeUsage.tokens(payload);

        assertNotNull(delta);
        assertEquals("msg:msg-1", delta.sourceKey());
        assertEquals(120, delta.inputTokens());
        assertEquals(40, delta.outputTokens());
        assertEquals(15, delta.cachedTokens());
        assertEquals(0.25, delta.costUsd());
    }

    @Test
    void extractsStepPartTokensWhenNoMessageInfoExists() throws IOException {
        JsonNode payload = json("{\"type\":\"message.part.updated\",\"properties\":{\"part\":{"
            + "\"id\":\"prt-1\",\"messageID\":\"msg-2\",\"type\":\"step-finish\","
            + "\"tokens\":{\"input\":7,\"output\":3}}}}");

        OpenCodeUsage.TokenDelta delta = OpenCodeUsage.tokens(payload);

        assertNotNull(delta);
        assertEquals("msg:msg-2", delta.sourceKey());
        assertEquals(7, delta.inputTokens());
        assertEquals(3, delta.outputTokens());
    }

    @Test
    void ignoresEventsWithoutUsage() throws IOException {
        assertNull(OpenCodeUsage.tokens(json(
            "{\"type\":\"session.idle\",\"properties\":{\"sessionID\":\"ses_1\"}}")));
    }

    @Test
    void extractsToolCallsAndFailures() throws IOException {
        JsonNode payload = json("{\"type\":\"message.part.updated\",\"properties\":{\"part\":{"
            + "\"id\":\"call-1\",\"type\":\"tool\",\"tool\":\"bash\","
            + "\"state\":{\"status\":\"error\",\"input\":{\"command\":\"npm test\"}}}}}");

        OpenCodeUsage.ToolCall call = OpenCodeUsage.toolCall(payload);

        assertNotNull(call);
        assertEquals("bash", call.tool());
        assertEquals("call-1", call.callId());
        assertTrue(call.failed());
        assertEquals("npm test", call.command());
        assertFalse(call.editsFile());
    }

    @Test
    void detectsFileEditingToolsAndPaths() throws IOException {
        JsonNode payload = json("{\"type\":\"message.part.updated\",\"properties\":{\"part\":{"
            + "\"id\":\"call-2\",\"type\":\"tool\",\"tool\":\"sandbox_edit\","
            + "\"state\":{\"status\":\"completed\",\"input\":{\"filePath\":\"src/App.java\"}}}}}");

        OpenCodeUsage.ToolCall call = OpenCodeUsage.toolCall(payload);

        assertNotNull(call);
        assertTrue(call.editsFile());
        assertEquals("src/App.java", call.filePath());
        assertFalse(call.failed());
    }
}
