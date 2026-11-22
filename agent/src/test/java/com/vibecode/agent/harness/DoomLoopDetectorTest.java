package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

/**
 * Signature counting, continue/reset and cap (fg-55 FR5).
 */
class DoomLoopDetectorTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private HarnessEvent tool(String name, String inputJson) {
        return tool(name, inputJson, "call-1", "running");
    }

    private HarnessEvent tool(String name, String inputJson, String callId, String status) {
        try {
            return new HarnessEvent("message.part.updated", mapper.readTree(
                "{\"type\":\"message.part.updated\",\"properties\":{\"part\":{"
                    + "\"type\":\"tool\",\"tool\":\"" + name + "\",\"callID\":\"" + callId + "\","
                    + "\"state\":{\"status\":\"" + status + "\",\"input\":" + inputJson + "}}}}"),
                System.currentTimeMillis());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void escalatesAtTheConfiguredRepeatCount() {
        DoomLoopDetector detector = new DoomLoopDetector(3, 3);
        String args = "{\"command\":\"npm test\"}";

        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", args, "call-1", "running")));
        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", args, "call-2", "running")));
        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", args, "call-3", "running")));
        // Still the same run of calls, but only one question is asked.
        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", args, "call-4", "running")));
    }

    @Test
    void aDifferentSignatureResetsTheCount() {
        DoomLoopDetector detector = new DoomLoopDetector(2, 3);

        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", "{\"command\":\"a\"}", "call-1", "running")));
        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", "{\"command\":\"a\"}", "call-2", "running")));
        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", "{\"command\":\"b\"}", "call-3", "running")));
        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", "{\"command\":\"b\"}", "call-4", "running")));
    }

    @Test
    void canonicalArgumentsIgnoreFieldOrder() {
        DoomLoopDetector detector = new DoomLoopDetector(3, 3);

        String first = detector.signature(tool("edit", "{\"b\":2,\"a\":1}"));
        String second = detector.signature(tool("edit", "{\"a\":1,\"b\":2}"));

        assertEquals(first, second);
        assertNotEquals(first, detector.signature(tool("edit", "{\"a\":2,\"b\":1}")));
    }

    @Test
    void continueResetsAndTheContinueCapAborts() {
        DoomLoopDetector detector = new DoomLoopDetector(1, 2);

        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", "{\"command\":\"loop\"}", "call-1", "running")));
        assertEquals(DoomLoopDetector.Decision.NONE, detector.continueAfterHuman());
        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", "{\"command\":\"loop\"}", "call-2", "running")));
        assertEquals(DoomLoopDetector.Decision.ABORT, detector.continueAfterHuman());
        assertEquals(2, detector.continues());
    }

    @Test
    void lifecycleUpdatesForOneCallDoNotCountAsRepeats() {
        DoomLoopDetector detector = new DoomLoopDetector(2, 3);
        String args = "{\"command\":\"npm test\"}";

        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", args, "call-1", "running")));
        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(tool("bash", args, "call-1", "completed")));
        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", args, "call-2", "running")));
    }

    @Test
    void nonToolEventsDoNotContribute() {
        DoomLoopDetector detector = new DoomLoopDetector(1, 1);

        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(new HarnessEvent("message.updated", mapper.createObjectNode(), 0)));
    }
}
