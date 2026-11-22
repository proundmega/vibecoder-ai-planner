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
        try {
            return new HarnessEvent("message.part.updated", mapper.readTree(
                "{\"type\":\"message.part.updated\",\"properties\":{\"part\":{"
                    + "\"type\":\"tool\",\"tool\":\"" + name + "\",\"callID\":\"call-1\","
                    + "\"state\":{\"status\":\"running\",\"input\":" + inputJson + "}}}}"),
                System.currentTimeMillis());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    void escalatesAtTheConfiguredRepeatCount() {
        DoomLoopDetector detector = new DoomLoopDetector(3, 3);
        HarnessEvent call = tool("bash", "{\"command\":\"npm test\"}");

        assertEquals(DoomLoopDetector.Decision.NONE, detector.observe(call));
        assertEquals(DoomLoopDetector.Decision.NONE, detector.observe(call));
        assertEquals(DoomLoopDetector.Decision.ESCALATE, detector.observe(call));
        // Still the same run of calls, but only one question is asked.
        assertEquals(DoomLoopDetector.Decision.NONE, detector.observe(call));
    }

    @Test
    void aDifferentSignatureResetsTheCount() {
        DoomLoopDetector detector = new DoomLoopDetector(2, 3);

        assertEquals(DoomLoopDetector.Decision.NONE, detector.observe(tool("bash", "{\"command\":\"a\"}")));
        assertEquals(DoomLoopDetector.Decision.ESCALATE, detector.observe(tool("bash", "{\"command\":\"a\"}")));
        assertEquals(DoomLoopDetector.Decision.NONE, detector.observe(tool("bash", "{\"command\":\"b\"}")));
        assertEquals(DoomLoopDetector.Decision.ESCALATE, detector.observe(tool("bash", "{\"command\":\"b\"}")));
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
            detector.observe(tool("bash", "{\"command\":\"loop\"}")));
        assertEquals(DoomLoopDetector.Decision.NONE, detector.continueAfterHuman());
        assertEquals(DoomLoopDetector.Decision.ESCALATE,
            detector.observe(tool("bash", "{\"command\":\"loop\"}")));
        assertEquals(DoomLoopDetector.Decision.ABORT, detector.continueAfterHuman());
        assertEquals(2, detector.continues());
    }

    @Test
    void nonToolEventsDoNotContribute() {
        DoomLoopDetector detector = new DoomLoopDetector(1, 1);

        assertEquals(DoomLoopDetector.Decision.NONE,
            detector.observe(new HarnessEvent("message.updated", mapper.createObjectNode(), 0)));
    }
}
