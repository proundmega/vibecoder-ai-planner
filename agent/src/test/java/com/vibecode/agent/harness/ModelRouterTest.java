package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModelRouterTest {

    private final ProviderSettings provider = new ProviderSettings(
        "opencode-go", "key", null, "beam-free", 4096);
    private final ModelRouter router = new ModelRouter(new ProviderHealth());

    private Ticket ticket(String description, String priority) {
        Ticket ticket = new Ticket();
        ticket.setId(1L);
        ticket.setTitle("Add filtering");
        ticket.setDescription(description);
        ticket.setPriority(priority);
        return ticket;
    }

    private HarnessBudgetPolicy policy(String routing, String free, String paid) {
        return new HarnessBudgetPolicy(
            BudgetLimits.defaults(Duration.ofMinutes(45)),
            20,
            4,
            1,
            routing,
            free,
            paid,
            3,
            Map.of(
                "beam-free", ModelPrice.free("beam-free"),
                "gpt-4o", new ModelPrice("gpt-4o", 2.5, 10, 1.25)),
            0,
            null);
    }

    @Test
    void freeOnlyAlwaysSelectsTheFreeModel() throws Exception {
        ModelRouter.RoutingDecision decision = router.select(
            policy(HarnessBudgetPolicy.FREE_ONLY, "beam-free", "gpt-4o"),
            ticket("tiny change", "low"), List.of(), provider, 5, 1, null);

        assertEquals("beam-free", decision.model());
        assertTrue(decision.reason().contains("free_only"));
    }

    @Test
    void paidForComplexUsesThePaidModelOnlyAboveTheThreshold() throws Exception {
        Ticket simple = ticket("tiny change", "low");
        ModelRouter.RoutingDecision simpleDecision = router.select(
            policy(HarnessBudgetPolicy.PAID_FOR_COMPLEX, "beam-free", "gpt-4o"),
            simple, List.of(), provider, 5, 1, null);
        assertEquals("beam-free", simpleDecision.model());

        Ticket complex = ticket(
            "Refactor the database migration and concurrency architecture. ".repeat(40),
            "critical");
        ModelRouter.RoutingDecision complexDecision = router.select(
            policy(HarnessBudgetPolicy.PAID_FOR_COMPLEX, "beam-free", "gpt-4o"),
            complex, List.of("a", "b", "c", "d"), provider, 5, 1, null);
        assertEquals("gpt-4o", complexDecision.model());
        assertTrue(complexDecision.complexity() >= 3);
    }

    @Test
    void freeThenPaidFallsBackToFreeWhenTheBudgetCannotCoverPaid() throws Exception {
        Ticket complex = ticket(
            "Refactor the database migration and concurrency architecture. ".repeat(40),
            "critical");

        ModelRouter.RoutingDecision decision = router.select(
            policy(HarnessBudgetPolicy.FREE_THEN_PAID, "beam-free", "gpt-4o"),
            complex, List.of("a", "b", "c", "d"), provider, 0.01, 1, null);

        assertEquals("beam-free", decision.model());
        assertTrue(decision.reason().contains("budget"));
    }

    @Test
    void explicitHarnessModelWins() throws Exception {
        ModelRouter.RoutingDecision decision = router.select(
            policy(HarnessBudgetPolicy.PAID_FOR_COMPLEX, "beam-free", "gpt-4o"),
            ticket("tiny", "low"), List.of(), provider, 5, 1, "opencode-go/explicit-model");

        assertEquals("opencode-go/explicit-model", decision.model());
        assertEquals("explicit HARNESS_MODEL override", decision.reason());
    }

    @Test
    void paidOnlyFailsCleanlyWhenTheBudgetIsGone() {
        Ticket ticket = ticket("tiny", "low");
        HarnessBudgetPolicy policy = policy(HarnessBudgetPolicy.PAID_ONLY, "beam-free", "gpt-4o");

        IOException error = assertThrows(IOException.class, () -> router.select(
            policy, ticket, List.of(), provider, 0, 1, null));

        assertTrue(error.getMessage().contains("budget is exhausted"));
    }

    @Test
    void circuitOpenPrimaryFallsBackToTheAlternateModel() throws Exception {
        ProviderHealth health = new ProviderHealth(1, Duration.ofMinutes(5));
        health.recordFailure("beam-free", new IOException("503 service unavailable"));
        ModelRouter routing = new ModelRouter(health);

        ModelRouter.RoutingDecision decision = routing.select(
            policy(HarnessBudgetPolicy.FREE_THEN_PAID, "beam-free", "gpt-4o"),
            ticket("tiny", "low"), List.of(), provider, 5, 1, null);

        assertEquals("gpt-4o", decision.model());
        assertTrue(decision.reason().contains("circuit open"));
    }

    @Test
    void complexityUsesTicketTextPriorityAndPlanningDocs() {
        int simple = router.complexity(ticket("small", "low"), List.of());
        int complex = router.complexity(
            ticket("migration refactor " + "word ".repeat(200), "critical"),
            List.of("a", "b", "c", "d"));

        assertTrue(complex > simple);
        assertTrue(complex >= 5);
    }

    @Test
    void budgetsDefaultToEnvIndependentLimits() {
        HarnessBudgetPolicy policy = HarnessBudgetPolicy.defaults(
            Duration.ofMinutes(30), provider);
        assertEquals(30 * 60, policy.limits().maxDuration().toSeconds());
        assertEquals(5.0, policy.limits().maxCostUsd());
        assertNotNull(policy.freeModel());
        assertFalse(policy.routingPolicy() == null);
    }
}
