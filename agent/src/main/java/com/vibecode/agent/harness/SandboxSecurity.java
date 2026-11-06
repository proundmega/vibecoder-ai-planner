package com.vibecode.agent.harness;

import java.util.Map;
import java.util.regex.Pattern;

/**
 * Shared safety checks for values that cross into a sandbox.
 *
 * <p>A sandbox is only secretless if callers cannot accidentally pass a
 * credential through {@code SANDBOX_ENV} or a per-command environment. These
 * checks are deliberately conservative: a false positive is a configuration
 * error, while a false negative leaks a secret to hostile repo code.</p>
 */
final class SandboxSecurity {

    /**
     * Credential-shaped environment variable names. Kept narrow enough to allow
     * the non-secret knobs the harness needs ({@code CI}, {@code GIT_CONFIG_*},
     * {@code HOME}, {@code NPM_CONFIG_CACHE}, ...).
     */
    private static final Pattern SECRET_KEY = Pattern.compile(
        "(?i).*(api[_-]?key|access[_-]?key|secret|token|password|passwd|credential|private[_-]?key).*");

    /**
     * URLs with embedded userinfo ({@code scheme://user:pass@host}). Non-secret
     * test configuration may still contain a database URL without credentials.
     */
    private static final Pattern CREDENTIAL_URL = Pattern.compile(
        "(?i)[a-z][a-z0-9+.-]*://[^/@\\s]+:[^/@\\s]+@");

    private SandboxSecurity() {
    }

    static boolean isSecretKey(String name) {
        return name != null && SECRET_KEY.matcher(name).matches();
    }

    static boolean looksLikeCredential(String value) {
        return value != null && CREDENTIAL_URL.matcher(value).find();
    }

    /**
     * Reject any environment map that could carry a long-lived credential.
     *
     * @param source human-readable origin used in the error message
     */
    static void validateEnv(Map<String, String> env, String source) {
        if (env == null || env.isEmpty()) {
            return;
        }
        for (Map.Entry<String, String> entry : env.entrySet()) {
            String key = entry.getKey();
            if (key == null || key.isBlank()) {
                throw new IllegalArgumentException(source + " contains a blank environment variable name");
            }
            if (!key.matches("[A-Za-z_][A-Za-z0-9_]*")) {
                throw new IllegalArgumentException(
                    source + " contains an invalid environment variable name: " + key);
            }
            if (isSecretKey(key)) {
                throw new IllegalArgumentException(
                    source + " must not contain secret-looking variable: " + key
                        + ". Provider keys and tokens stay in the supervisor.");
            }
            if (looksLikeCredential(entry.getValue())) {
                throw new IllegalArgumentException(
                    source + " must not contain credentials in " + key
                        + ". Remove the userinfo from the URL.");
            }
        }
    }
}
