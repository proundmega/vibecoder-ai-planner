package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pause/resume excludes question wait time (fg-55 NFR2).
 */
class HarnessBudgetTrackerQuestionTest {

    @Test
    void pausedWaitDoesNotConsumeTheWallClockBudget() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-22T10:00:00Z"));
        List<String> breaches = new ArrayList<>();
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofSeconds(30), 0, 0, 0, 0, 0, 0.8),
            ModelPrice.free("test"),
            now.get(),
            now::get,
            warning -> { },
            breaches::add);

        now.set(now.get().plusSeconds(10));
        tracker.pause();
        now.set(now.get().plusSeconds(100));
        tracker.check();

        assertFalse(tracker.breached());
        assertTrue(breaches.isEmpty());
        assertEquals(10_000, tracker.snapshot().durationMs());
        assertEquals(100_000, tracker.snapshot().waitedMs());

        tracker.resume();
        now.set(now.get().plusSeconds(25));
        tracker.check();

        assertTrue(tracker.breached());
        assertEquals("wall-clock budget exhausted", tracker.breachReason());
        // 10s active before the wait + 25s after it; the 100s wait is excluded.
        assertEquals(35_000, tracker.snapshot().durationMs());
        assertEquals(100_000, tracker.snapshot().waitedMs());
    }

    @Test
    void pauseAndResumeAreIdempotent() {
        AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-11-22T10:00:00Z"));
        HarnessBudgetTracker tracker = new HarnessBudgetTracker(
            new BudgetLimits(Duration.ofMinutes(5), 0, 0, 0, 0, 0, 0.8),
            ModelPrice.free("test"),
            now.get(),
            now::get,
            warning -> { },
            reason -> { });

        tracker.pause();
        tracker.pause();
        now.set(now.get().plusSeconds(20));
        tracker.resume();
        tracker.resume();

        assertEquals(20_000, tracker.waitedMs());
        assertEquals(0, tracker.snapshot().durationMs());
        assertFalse(tracker.paused());
    }
}
