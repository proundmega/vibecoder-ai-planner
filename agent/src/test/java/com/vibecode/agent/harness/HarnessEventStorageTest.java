package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-44: storage event payloads and correlation. */
class HarnessEventStorageTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void recognisesStorageEventTypes() {
        HarnessEvent event = HarnessEvent.of("storage.cleanup", mapper.createObjectNode());
        assertTrue(event.isStorageEvent());
        assertFalse(HarnessEvent.of("tool.called", mapper.createObjectNode()).isStorageEvent());
    }

    @Test
    void recognisesEveryStorageEventType() {
        for (String type : java.util.List.of(
                "storage.workspace", "storage.refresh", "storage.refresh_failed",
                "storage.watermark", "storage.orphan", "storage.image_prune",
                "storage.log_bytes", "storage.cleanup", "storage.cleanup_failed",
                "storage.budget_exceeded")) {
            assertTrue(HarnessEvent.of(type, mapper.createObjectNode()).isStorageEvent(), type);
        }
    }

    @Test
    void carriesWorkspaceAndWatermarkFields() {
        Map<String, Object> workspace = new LinkedHashMap<>();
        workspace.put("runtimeId", 12);
        workspace.put("ticketId", 34);
        workspace.put("bytes", 1024);
        workspace.put("inodes", 9);
        HarnessEvent event = HarnessEvent.of("storage.workspace",
            mapper.valueToTree(workspace));

        assertTrue(event.isStorageEvent());
        assertEquals(12, event.payload().path("runtimeId").asInt());
        assertEquals(34, event.payload().path("ticketId").asInt());
        assertEquals(1024, event.payload().path("bytes").asInt());
        assertEquals(9, event.payload().path("inodes").asInt());
    }
}
