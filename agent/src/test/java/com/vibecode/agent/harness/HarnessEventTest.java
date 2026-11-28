package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessEventTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void readsTheOpenCodeQuestionPromptAndOptionsFromTheRealEnvelope() throws Exception {
        JsonNode payload = mapper.readTree("""
            {
              "id": "evt_1",
              "type": "question.asked",
              "properties": {
                "id": "que_1",
                "sessionID": "ses_test",
                "questions": [{
                  "question": "Which theme should be the default?",
                  "header": "Theme",
                  "options": [
                    {"label": "system", "description": "Follow the OS"},
                    {"label": "dark", "description": "Always dark"}
                  ]
                }]
              }
            }
            """);

        HarnessEvent event = HarnessEvent.of("question.asked", payload);

        assertTrue(event.isQuestionEvent());
        assertEquals("question", event.questionKind());
        assertEquals("que_1", event.questionRequestId(),
            "the SSE envelope evt_ id must not win over properties.id");
        assertEquals("Which theme should be the default?", event.questionText());
        assertEquals("system", event.questionOptions().get(0).path("label").asText());
    }

    @Test
    void treatsQuestionRepliedAndRejectedAsResolvedEvents() throws Exception {
        JsonNode replied = mapper.readTree("""
            {
              "id": "evt_reply",
              "type": "question.replied",
              "properties": {
                "sessionID": "ses_test",
                "requestID": "que_1",
                "answers": [["dark"]]
              }
            }
            """);
        JsonNode rejected = mapper.readTree("""
            {
              "id": "evt_reject",
              "type": "question.rejected",
              "properties": {"sessionID": "ses_test", "requestID": "que_1"}
            }
            """);

        HarnessEvent repliedEvent = HarnessEvent.of("question.replied", replied);
        HarnessEvent rejectedEvent = HarnessEvent.of("question.rejected", rejected);

        assertFalse(repliedEvent.isQuestionEvent());
        assertFalse(rejectedEvent.isQuestionEvent());
        assertEquals("que_1", repliedEvent.questionRequestId());
        assertEquals("que_1", rejectedEvent.questionRequestId());
    }

    @Test
    void treatsPermissionRepliedAsAResolvedEvent() throws Exception {
        JsonNode payload = mapper.readTree("""
            {
              "id": "evt_perm_reply",
              "type": "permission.replied",
              "properties": {
                "sessionID": "ses_test",
                "requestID": "per_1",
                "reply": "once"
              }
            }
            """);

        HarnessEvent event = HarnessEvent.of("permission.replied", payload);

        assertFalse(event.isQuestionEvent());
        assertEquals("per_1", event.questionRequestId());
    }

    @Test
    void readsV2DataIdsAfterProperties() throws Exception {
        JsonNode payload = mapper.readTree("""
            {
              "id": "evt_v2",
              "type": "question.asked",
              "data": {"id": "que_v2"}
            }
            """);

        HarnessEvent event = HarnessEvent.of("question.asked", payload);

        assertTrue(event.isQuestionEvent());
        assertEquals("que_v2", event.questionRequestId());
    }
}
