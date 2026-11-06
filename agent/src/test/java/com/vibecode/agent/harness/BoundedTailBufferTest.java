package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoundedTailBufferTest {

    @Test
    void exactlyFullIsNotReportedAsTruncated() {
        BoundedTailBuffer buffer = new BoundedTailBuffer(4);
        buffer.write("abcd".getBytes(StandardCharsets.UTF_8), 0, 4);

        assertFalse(buffer.truncated());
        assertEquals("abcd", buffer.text());
    }

    @Test
    void overflowKeepsTheTailAndReportsTruncation() {
        BoundedTailBuffer buffer = new BoundedTailBuffer(4);
        buffer.write("abcde".getBytes(StandardCharsets.UTF_8), 0, 5);

        assertTrue(buffer.truncated());
        assertEquals("bcde", buffer.text());
    }
}
