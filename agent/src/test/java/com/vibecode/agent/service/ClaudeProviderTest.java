package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** fg-54: extended thinking blocks must not hide the text answer. */
class ClaudeProviderTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void joinsTextBlocksAfterThinkingBlocks() throws Exception {
        JsonNode root = MAPPER.readTree("""
            {"content":[
              {"type":"thinking","thinking":"private reasoning"},
              {"type":"text","text":"the answer"},
              {"type":"text","text":"second paragraph"}
            ]}
            """);

        assertEquals("the answer\nsecond paragraph", ClaudeProvider.extractText(root));
    }

    @Test
    void keepsTheFallbackForEndpointsWithoutBlockTypes() throws Exception {
        JsonNode root = MAPPER.readTree("{\"content\":[{\"text\":\"plain\"}]}");
        assertEquals("plain", ClaudeProvider.extractText(root));
    }

    @Test
    void returnsEmptyForAnEmptyContentArray() throws Exception {
        assertEquals("", ClaudeProvider.extractText(MAPPER.readTree("{\"content\":[]}")));
    }
}
