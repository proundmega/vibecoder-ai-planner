package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PromptBuilderTest {

    private Ticket ticket() {
        Ticket ticket = new Ticket();
        ticket.setId(42L);
        ticket.setTitle("Add ticket filtering");
        ticket.setDescription("Users should be able to filter tickets by status.");
        return ticket;
    }

    @Test
    void includesTicketIdTitleAndDescription() {
        String prompt = new PromptBuilder().build(ticket(), List.of(), List.of("npm test"));

        assertTrue(prompt.contains("42"));
        assertTrue(prompt.contains("Add ticket filtering"));
        assertTrue(prompt.contains("filter tickets by status"));
    }

    @Test
    void includesPlanningDocsAndTruncationMarker() {
        String small = "=== 01_ARCHITECT_REQUIREMENT ===\nSmall requirement";
        String oversized = "=== 02_ARCHITECT_DESIGN ===\n" + "x".repeat(45_000) + "UNIQUE_TAIL";

        String prompt = new PromptBuilder().build(ticket(), List.of(small, oversized), List.of());

        assertTrue(prompt.contains("Small requirement"));
        assertTrue(prompt.contains("[truncated]"));
        assertFalse(prompt.contains("UNIQUE_TAIL"));
    }

    @Test
    void includesVerificationCommandsAndDefinitionOfDone() {
        String prompt = new PromptBuilder().build(
            ticket(),
            List.of(),
            List.of("npm test -- --run", "npm run lint")
        );

        assertTrue(prompt.contains("npm test -- --run"));
        assertTrue(prompt.contains("npm run lint"));
        assertTrue(prompt.toLowerCase().contains("definition of done"));
        assertTrue(prompt.contains("Do NOT run git commit"));
    }

    @Test
    void emptyPlanningDocsStillProducesValidPrompt() {
        String prompt = new PromptBuilder().build(ticket(), null, null);

        assertFalse(prompt.isBlank());
        assertTrue(prompt.contains("Add ticket filtering"));
        assertTrue(prompt.contains("Verification"));
    }

    @Test
    void promptDoesNotInjectSupervisorEnvironment() {
        String prompt = new PromptBuilder().build(ticket(), List.of("doc"), List.of("npm test"));

        for (String name : List.of("GITHUB_TOKEN", "AI_API_KEY", "AGENT_API_KEY")) {
            String value = System.getenv(name);
            if (value != null && !value.isBlank()) {
                assertFalse(prompt.contains(value), "prompt leaked " + name);
            }
        }
        assertFalse(prompt.contains("OPENCODE_SERVER_PASSWORD"));
        assertEquals(-1, prompt.indexOf("provider.key"));
    }

    @Test
    void capsTheTotalPlanningDocumentBudget() {
        List<String> docs = List.of(
            "a".repeat(40_000),
            "b".repeat(40_000),
            "c".repeat(40_000),
            "d".repeat(40_000)
        );

        String prompt = new PromptBuilder().build(ticket(), docs, List.of("npm test"));

        assertTrue(prompt.contains("prompt budget exhausted"));
        assertTrue(prompt.length() < 150_000);
    }
}
