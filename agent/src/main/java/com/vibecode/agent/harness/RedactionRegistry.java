package com.vibecode.agent.harness;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Process-wide registry of secrets that must never be persisted or shipped.
 *
 * <p>The agent resolves some credentials after startup (provider settings and
 * short-lived GitHub App tokens), so services and the logback encoder cannot
 * capture a fixed snapshot at construction. They call {@link #redact(String)}
 * at the boundary instead, and {@link #register} replaces the immutable
 * {@link SecretRedactor} whenever a new credential is learned.</p>
 */
public final class RedactionRegistry {

    private static final Object LOCK = new Object();
    private static final Set<String> SECRETS = new LinkedHashSet<>();
    private static volatile SecretRedactor redactor = SecretRedactor.patternsOnly();

    static {
        register(System.getenv("AGENT_API_KEY"), System.getenv("AI_API_KEY"),
            System.getenv("GITHUB_TOKEN"));
    }

    private RedactionRegistry() {
    }

    public static void register(String... values) {
        if (values == null || values.length == 0) {
            return;
        }
        synchronized (LOCK) {
            boolean changed = false;
            for (String value : values) {
                if (value != null && !value.isBlank() && SECRETS.add(value)) {
                    changed = true;
                }
            }
            if (changed) {
                redactor = new SecretRedactor(SECRETS);
            }
        }
    }

    public static void register(Collection<String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        register(values.toArray(String[]::new));
    }

    /** Remove per-run secrets once the resource that owned them is gone. */
    public static void unregister(Collection<String> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        synchronized (LOCK) {
            boolean changed = false;
            for (String value : values) {
                if (value != null && SECRETS.remove(value)) {
                    changed = true;
                }
            }
            if (changed) {
                redactor = new SecretRedactor(SECRETS);
            }
        }
    }

    public static String redact(String value) {
        return redactor.redact(value);
    }

    /** Test seam: clears registered secrets and returns to pattern-only redaction. */
    public static void reset() {
        synchronized (LOCK) {
            SECRETS.clear();
            redactor = SecretRedactor.patternsOnly();
        }
    }
}
