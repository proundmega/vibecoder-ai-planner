package com.vibecode.agent.service;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

/**
 * fg-35 FR3/FR4/FR10: the agent caches a short-lived credential and refreshes
 * it before expiry without persisting or logging the token.
 */
class GitHubTokenProviderTest {

    private static Map<String, Object> payload(String token, Instant expiresAt) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("token", token);
        data.put("mode", "app");
        data.put("expiresAt", expiresAt == null ? null : expiresAt.toString());
        return data;
    }

    @Test
    void cachesUntilShortlyBeforeExpiryThenRefreshes() throws Exception {
        AtomicLong clock = new AtomicLong(Instant.parse("2026-11-14T00:00:00Z").toEpochMilli());
        AtomicInteger calls = new AtomicInteger();
        GitHubTokenProvider provider = new GitHubTokenProvider(() -> {
            int call = calls.incrementAndGet();
            return payload("ghs_" + call,
                Instant.ofEpochMilli(clock.get() + 3600_000L));
        }, clock::get, 300_000L);

        assertEquals("ghs_1", provider.get());
        assertEquals("ghs_1", provider.get());
        assertEquals(1, calls.get());

        clock.addAndGet(56 * 60 * 1000L);
        assertEquals("ghs_2", provider.get());
        assertEquals(2, calls.get());
        assertEquals(Set.of("ghs_1", "ghs_2"), provider.knownTokens());
    }

    @Test
    void keepsAStaticPatWithoutRefreshing() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        GitHubTokenProvider provider = new GitHubTokenProvider(() -> {
            calls.incrementAndGet();
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("token", "stored-pat");
            data.put("mode", "pat");
            data.put("expiresAt", null);
            return data;
        });

        assertEquals("stored-pat", provider.get());
        assertEquals("stored-pat", provider.get());
        assertEquals(1, calls.get());
        assertEquals("pat", provider.getMode());
    }

    @Test
    void usesTheExplicitPatFallbackOnlyWhenConfigured() throws Exception {
        GitHubTokenProvider withFallback = new GitHubTokenProvider(
            () -> {
                throw new IOException("backend unavailable");
            },
            () -> "stored-pat");
        assertEquals("stored-pat", withFallback.get());
        assertEquals("pat", withFallback.getMode());

        GitHubTokenProvider withoutFallback = new GitHubTokenProvider(() -> {
            throw new IOException("backend unavailable");
        });
        assertThrows(IOException.class, withoutFallback::get);
    }

    @Test
    void invalidationForcesAFreshFetch() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        GitHubTokenProvider provider = new GitHubTokenProvider(() -> {
            int call = calls.incrementAndGet();
            return payload("ghs_" + call, null);
        });

        assertEquals("ghs_1", provider.get());
        provider.invalidate();
        assertEquals("ghs_2", provider.get());
        assertEquals(2, calls.get());
    }

    @Test
    void failsClosedWhenTheBackendReturnsNoToken() {
        GitHubTokenProvider provider = new GitHubTokenProvider(() -> Map.of("mode", "app"));

        assertThrows(IOException.class, provider::get);
        assertThrows(IOException.class, () -> new GitHubTokenProvider(() -> null).get());
    }

    @Test
    void parsesIsoOffsetAndEpochExpiryValues() {
        assertEquals(Instant.parse("2026-11-14T01:00:00Z"),
            GitHubTokenProvider.parseExpiry("2026-11-14T01:00:00Z"));
        assertEquals(Instant.parse("2026-11-14T01:00:00Z"),
            GitHubTokenProvider.parseExpiry("2026-11-14T02:00:00+01:00"));
        assertEquals(Instant.ofEpochSecond(1_800_000_000L),
            GitHubTokenProvider.parseExpiry(1_800_000_000L));
        assertNull(GitHubTokenProvider.parseExpiry("not-a-date"));
        assertNull(GitHubTokenProvider.parseExpiry(null));
    }
}
