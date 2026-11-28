package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessEventTest {

    @Test
    void readsTheOpenCodeQuestionPromptAndOptions() throws Exception {
        JsonNode payload = new ObjectMapper().readTree("""
            {
              "type": "question.asked",
              "properties": {
                "id": "que_1",
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
        assertEquals("que_1", event.questionRequestId());
        assertEquals("Which theme should be the default?", event.questionText());
        assertEquals("system", event.questionOptions().get(0).path("label").asText());
    }
}
