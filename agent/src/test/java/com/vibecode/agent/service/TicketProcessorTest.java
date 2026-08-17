package com.vibecode.agent.service;

import com.vibecode.agent.model.FileOperation;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for TicketProcessor parsing and utility methods.
 */
class TicketProcessorTest {

    @Test
    void testExtractFileKeys_singleKey() {
        List<String> docs = Arrays.asList("=== 01_ARCHITECT_REQUIREMENT.md ===", "Content here");
        List<String> keys = TicketProcessor.extractFileKeys(docs);
        
        assertEquals(1, keys.size());
        assertEquals("01_ARCHITECT_REQUIREMENT.md", keys.get(0));
    }

    @Test
    void testExtractFileKeys_multipleKeys() {
        List<String> docs = Arrays.asList(
            "=== 01_ARCHITECT_REQUIREMENT.md ===", "Content 1",
            "=== 02_ARCHITECT_DESIGN.md ===", "Content 2"
        );
        List<String> keys = TicketProcessor.extractFileKeys(docs);
        
        assertEquals(2, keys.size());
        assertEquals("01_ARCHITECT_REQUIREMENT.md", keys.get(0));
        assertEquals("02_ARCHITECT_DESIGN.md", keys.get(1));
    }

    @Test
    void testExtractFileKeys_noKeys() {
        List<String> docs = Arrays.asList("No file keys here", "Just plain text");
        List<String> keys = TicketProcessor.extractFileKeys(docs);
        
        assertTrue(keys.isEmpty());
    }

    @Test
    void testExtractFileKeys_emptyList() {
        List<String> keys = TicketProcessor.extractFileKeys(Collections.emptyList());
        assertTrue(keys.isEmpty());
    }

    @Test
    void testInferPlanningStage_implementation() {
        List<String> docs = Arrays.asList("03_ARCHITECT_IMPLEMENTATION.md");
        String stage = TicketProcessor.inferPlanningStage(docs);
        assertEquals("validation", stage);
    }

    @Test
    void testInferPlanningStage_design() {
        List<String> docs = Arrays.asList("02_ARCHITECT_DESIGN.md");
        String stage = TicketProcessor.inferPlanningStage(docs);
        assertEquals("plan_generation", stage);
    }

    @Test
    void testInferPlanningStage_requirement() {
        List<String> docs = Arrays.asList("01_ARCHITECT_REQUIREMENT.md");
        String stage = TicketProcessor.inferPlanningStage(docs);
        assertEquals("requirement_extraction", stage);
    }

    @Test
    void testInferPlanningStage_noDocs() {
        List<String> docs = Collections.emptyList();
        String stage = TicketProcessor.inferPlanningStage(docs);
        assertEquals("requirement_extraction", stage);
    }

    @Test
    void testInferPlanningStage_priority() {
        // Implementation should take priority over design and requirement
        List<String> docs = Arrays.asList(
            "01_ARCHITECT_REQUIREMENT.md",
            "02_ARCHITECT_DESIGN.md",
            "03_ARCHITECT_IMPLEMENTATION.md"
        );
        String stage = TicketProcessor.inferPlanningStage(docs);
        assertEquals("validation", stage);
    }
}
