package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** fg-54: runtime declaration response mapping (contract has no client name). */
class SupervisorMainTest {

    private static RuntimeConfig config() {
        return RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/model
            count = 2

            [runtime "reviewers"]
            role = reviewer
            model = acme/review
            count = 1
            """);
    }

    @Test
    void mapsRuntimeIdsInDeclarationOrderWhenTheResponseHasNoNames() {
        Map<String, Long> ids = SupervisorMain.mapIdsInOrder(config(), List.of(
            Map.of("id", 10),
            Map.of("id", 11),
            Map.of("id", 12)));

        assertEquals(10L, ids.get("workers-1"));
        assertEquals(11L, ids.get("workers-2"));
        assertEquals(12L, ids.get("reviewers-1"));
    }

    @Test
    void refusesToGuessWhenTheCountDoesNotMatch() {
        assertTrue(SupervisorMain.mapIdsInOrder(config(), List.of(Map.of("id", 10))).isEmpty());
    }

    @Test
    void prefersServerNamesWhenPresent() {
        Map<String, Long> ids = SupervisorMain.mapRuntimeIds(List.of(
            Map.of("id", 10, "name", "workers-1"),
            Map.of("id", 11, "name", "workers-2")));

        assertEquals(10L, ids.get("workers-1"));
        assertEquals(11L, ids.get("workers-2"));
    }
}
