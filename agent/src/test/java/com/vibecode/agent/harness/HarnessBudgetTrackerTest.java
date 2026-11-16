package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HarnessBudgetTrackerTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private HarnessEvent event(String json) {
        try {
            return new HarnessEvent("test", mapper.readTree(json), System.currentTimeMillis());
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private HarnessEvent tokens(int input, int output) {
        return event("{\"type\":\"message.updated\",\"properties\":{\"info\":{"
            + "\"id\":\"msg-1\",\"tokens\":{\"input\":" + input
            + ",\"output\":" + output + "}}}}");
    }

    @Test
    void warnsOnceAtTheSoftThresholdAndDoesNotBreach() {
        List<HarnessBudgetTracker.BudgetWarning> warnings = new ArrayList<>();
        List<String> breaches = new ArrayList<>();
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofHours(1), 100, 100, 5, 10, 2, 0.8),
            ModelPrice.free("beam-free"),
            Instant.now(),
            () -> Instant.now(),
            warnings::add,
            breaches::add);

        tracker.accept(tokens(85, 0));
        tracker.accept(tokens(90, 0));

        assertFalse(tracker.breached());
        assertEquals(1, warnings.size());
        assertEquals("input_tokens", warnings.get(0).dimension());
        assertTrue(breaches.isEmpty());
    }

    @Test
    void breachesOnInputTokensAtOneHundredPercent() {
        List<String> breaches = new ArrayList<>();
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofHours(1), 100, 100, 5, 10, 2, 0.8),
            ModelPrice.free("beam-free"),
            Instant.now(),
            Instant::now,
            warning -> { },
            breaches::add);

        tracker.accept(tokens(150, 0));

        assertTrue(tracker.breached());
        assertEquals("input token budget exhausted", tracker.breachReason());
        assertEquals(List.of("input token budget exhausted"), breaches);
    }

    @Test
    void breachesOnToolCallsAndDeduplicatesPartUpdates() {
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofHours(1), 1000, 1000, 5, 2, 2, 0.8),
            ModelPrice.free("beam-free"),
            Instant.now(),
            Instant::now,
            warning -> { },
            reason -> { });

        String tool = "{\"type\":\"message.part.updated\",\"properties\":{\"part\":{"
            + "\"id\":\"call-1\",\"type\":\"tool\",\"tool\":\"bash\","
            + "\"state\":{\"status\":\"completed\"}}}}";
        Optional<OpenCodeUsage.ToolCall> first = tracker.accept(event(tool));
        Optional<OpenCodeUsage.ToolCall> second = tracker.accept(event(tool));
        tracker.accept(event(tool.replace("call-1", "call-2")));
        tracker.accept(event(tool.replace("call-1", "call-3")));

        assertTrue(first.isPresent());
        assertTrue(second.isEmpty());
        assertEquals(3, tracker.snapshot().toolCalls());
        assertTrue(tracker.breached());
        assertEquals("tool-call budget exhausted", tracker.breachReason());
    }

    @Test
    void pricesTokensWhenTheProviderDoesNotReportCost() {
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofHours(1), 10_000_000, 10_000_000, 20, 100, 2, 0.8),
            new ModelPrice("gpt-4o", 2.5, 10, 1.25),
            Instant.now(),
            Instant::now,
            warning -> { },
            reason -> { });

        tracker.accept(tokens(1_000_000, 1_000_000));

        assertEquals(12.5, tracker.snapshot().costUsd(), 0.0001);
        assertFalse(tracker.breached());
    }

    @Test
    void usesProviderReportedCostAndBreachesTheCostLimit() {
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofHours(1), 10_000_000, 10_000_000, 5, 100, 2, 0.8),
            ModelPrice.free("beam-free"),
            Instant.now(),
            Instant::now,
            warning -> { },
            reason -> { });

        tracker.accept(event("{\"type\":\"message.updated\",\"properties\":{\"info\":{"
            + "\"id\":\"msg-1\",\"cost\":6.0,\"tokens\":{\"input\":1,\"output\":1}}}}"));

        assertTrue(tracker.breached());
        assertEquals("cost budget exhausted", tracker.breachReason());
        assertEquals(6.0, tracker.snapshot().costUsd(), 0.0001);
    }

    @Test
    void watchdogStyleChecksBreachOnWallClock() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-16T10:00:00Z"));
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofMinutes(1), 1000, 1000, 5, 100, 2, 0.8),
            ModelPrice.free("beam-free"),
            now.get(),
            now::get,
            warning -> { },
            reason -> { });

        tracker.check();
        assertFalse(tracker.breached());

        now.set(now.get().plusSeconds(61));
        tracker.check();

        assertTrue(tracker.breached());
        assertEquals("wall-clock budget exhausted", tracker.breachReason());
        assertTrue(tracker.snapshot().durationMs() >= 61_000);
    }
}
