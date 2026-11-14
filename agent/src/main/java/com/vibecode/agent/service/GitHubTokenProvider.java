package com.vibecode.agent.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.function.LongSupplier;

/**
 * Fetches a short-lived GitHub App installation token from the backend and
 * refreshes it shortly before it expires. The token is kept in memory only.
 */
public class GitHubTokenProvider implements GitHubTokenSource {

    private static final Logger log = LoggerFactory.getLogger(GitHubTokenProvider.class);
    private static final long DEFAULT_REFRESH_SKEW_MS = 5 * 60 * 1000L;

    /** Fetches the token payload from the backend. */
    @FunctionalInterface
    public interface Fetcher {
        Map<String, Object> fetch(boolean forceRefresh) throws IOException;
    }

    private final Fetcher fetcher;
    private final GitHubTokenSource fallback;
    private final String expectedMode;
    private final boolean allowPat;
    private final LongSupplier clockMillis;
    private final long refreshSkewMillis;
    private final Set<String> knownTokens = new LinkedHashSet<>();

    private String token;
    private Instant expiresAt;
    private String mode;

    public GitHubTokenProvider(Fetcher fetcher) {
        this(fetcher, null);
    }

    public GitHubTokenProvider(Fetcher fetcher, GitHubTokenSource fallback) {
        this(fetcher, fallback, null, false);
    }

    public GitHubTokenProvider(
        Fetcher fetcher, GitHubTokenSource fallback,
        String expectedMode, boolean allowPat) {
        this(fetcher, fallback, expectedMode, allowPat,
            System::currentTimeMillis, DEFAULT_REFRESH_SKEW_MS);
    }

    GitHubTokenProvider(Fetcher fetcher, LongSupplier clockMillis, long refreshSkewMillis) {
        this(fetcher, null, null, false, clockMillis, refreshSkewMillis);
    }

    GitHubTokenProvider(
        Fetcher fetcher, GitHubTokenSource fallback,
        LongSupplier clockMillis, long refreshSkewMillis) {
        this(fetcher, fallback, null, false, clockMillis, refreshSkewMillis);
    }

    GitHubTokenProvider(
        Fetcher fetcher, GitHubTokenSource fallback,
        String expectedMode, boolean allowPat,
        LongSupplier clockMillis, long refreshSkewMillis) {
        this.fetcher = fetcher;
        this.fallback = fallback;
        this.expectedMode = expectedMode;
        this.allowPat = allowPat;
        this.clockMillis = clockMillis;
        this.refreshSkewMillis = Math.max(0, refreshSkewMillis);
    }

    @Override
    public synchronized String get() throws IOException {
        return get(false);
    }

    @Override
    public synchronized String refresh() throws IOException {
        token = null;
        expiresAt = null;
        return get(true);
    }

    private synchronized String get(boolean forceRefresh) throws IOException {
        if (token != null && !forceRefresh && !needsRefresh()) {
            return token;
        }
        Map<String, Object> data;
        try {
            data = fetcher.fetch(forceRefresh);
        } catch (IOException error) {
            return useFallback(error);
        }
        if (data == null) {
            return useFallback(new IOException("Backend returned no GitHub credential"));
        }
        Object value = data.get("token");
        if (!(value instanceof String) || ((String) value).isBlank()) {
            return useFallback(new IOException("Backend returned no GitHub token"));
        }
        String responseMode = stringValue(data.get("mode"));
        validateMode(responseMode);
        token = (String) value;
        mode = responseMode;
        expiresAt = parseExpiry(data.get("expiresAt"));
        knownTokens.add(token);
        log.info("Fetched GitHub credential (mode={}, expiresAt={})",
            mode == null ? "unknown" : mode,
            expiresAt == null ? "none" : expiresAt);
        return token;
    }

    private void validateMode(String responseMode) throws IOException {
        if (expectedMode == null) {
            return;
        }
        if (responseMode == null || !expectedMode.equalsIgnoreCase(responseMode)) {
            throw new IOException(
                "GitHub credential mode mismatch: expected " + expectedMode
                    + ", got " + (responseMode == null ? "unknown" : responseMode));
        }
        if ("pat".equalsIgnoreCase(responseMode) && !allowPat) {
            throw new IOException(
                "Backend returned a PAT but ALLOW_PAT is not enabled");
        }
    }

    private String useFallback(IOException failure) throws IOException {
        if (fallback == null) {
            throw failure;
        }
        if (expectedMode != null
            && !"pat".equalsIgnoreCase(expectedMode)) {
            throw failure;
        }
        if (expectedMode != null && !allowPat) {
            throw failure;
        }
        String legacy = fallback.get();
        if (legacy == null || legacy.isBlank()) {
            throw failure;
        }
        token = legacy;
        expiresAt = null;
        mode = "pat";
        knownTokens.add(legacy);
        log.warn("Using the explicit GitHub PAT fallback after the token request failed");
        return legacy;
    }

    @Override
    public synchronized void invalidate() {
        token = null;
        expiresAt = null;
    }

    public synchronized String getMode() {
        return mode;
    }

    public synchronized Instant getExpiresAt() {
        return expiresAt;
    }

    /** Tokens seen this run, used by redaction and leak guards. */
    public synchronized Set<String> knownTokens() {
        return new LinkedHashSet<>(knownTokens);
    }

    private boolean needsRefresh() {
        if (expiresAt == null) {
            return false;
        }
        long remaining = expiresAt.toEpochMilli() - clockMillis.getAsLong();
        return remaining <= refreshSkewMillis;
    }

    private static String stringValue(Object value) {
        return value instanceof String ? (String) value : null;
    }

    static Instant parseExpiry(Object value) {
        if (value instanceof Number) {
            long raw = ((Number) value).longValue();
            return Instant.ofEpochMilli(raw < 10_000_000_000L ? raw * 1000 : raw);
        }
        if (!(value instanceof String) || ((String) value).isBlank()) {
            return null;
        }
        String text = (String) value;
        try {
            return Instant.parse(text);
        } catch (RuntimeException ignored) {
            try {
                return OffsetDateTime.parse(text).toInstant();
            } catch (RuntimeException stillInvalid) {
                log.warn("Ignoring unparseable GitHub token expiry");
                return null;
            }
        }
    }
}
