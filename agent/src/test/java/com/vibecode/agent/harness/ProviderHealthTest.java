package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProviderHealthTest {

    @Test
    void opensAfterConsecutiveTransientFailures() {
        ProviderHealth health = new ProviderHealth(2, Duration.ofMinutes(5));

        health.recordFailure("gpt-4o", new IOException("503 unavailable"));
        assertFalse(health.isOpen("gpt-4o"));

        health.recordFailure("gpt-4o", new IOException("429 rate limit"));
        assertTrue(health.isOpen("gpt-4o"));
    }

    @Test
    void ignoresNonTransientFailures() {
        ProviderHealth health = new ProviderHealth(1, Duration.ofMinutes(5));
        health.recordFailure("gpt-4o", new IOException("invalid api key"));
        assertFalse(health.isOpen("gpt-4o"));
    }

    @Test
    void successClosesTheCircuit() {
        ProviderHealth health = new ProviderHealth(1, Duration.ofMinutes(5));
        health.recordFailure("gpt-4o", new IOException("timeout"));
        assertTrue(health.isOpen("gpt-4o"));

        health.recordSuccess("gpt-4o");
        assertFalse(health.isOpen("gpt-4o"));
    }

    @Test
    void cooldownReopensTheCircuit() throws Exception {
        ProviderHealth health = new ProviderHealth(1, Duration.ofMillis(20));
        health.recordFailure("gpt-4o", new IOException("connection refused"));
        assertTrue(health.isOpen("gpt-4o"));

        Thread.sleep(40);
        assertFalse(health.isOpen("gpt-4o"));
    }
}
