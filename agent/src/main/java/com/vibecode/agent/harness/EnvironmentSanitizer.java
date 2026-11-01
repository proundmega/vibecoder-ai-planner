package com.vibecode.agent.harness;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Builds the child-process environment used by the harness, verification
 * commands and git.
 *
 * <p>Everything the supervisor has access to (GitHub PATs, provider keys,
 * database URLs, cloud credentials, ...) must be treated as secret. Rather than
 * trying to block an ever-growing denylist, only variables that are required to
 * run a process are inherited. Callers can then add the few values the child
 * genuinely needs (HOME, OPENCODE_CONFIG, ...).</p>
 */
public final class EnvironmentSanitizer {

    /**
     * Variables that are safe and commonly required by shells, Node, npm, Maven
     * and git on POSIX systems.
     */
    private static final Set<String> POSIX_ALLOWED = Set.of(
        "PATH",
        "HOME",
        "LANG",
        "LANGUAGE",
        "LC_ALL",
        "LC_CTYPE",
        "LC_MESSAGES",
        "TERM",
        "TZ",
        "TMPDIR",
        "TEMP",
        "TMP",
        "USER",
        "LOGNAME",
        "SHELL",
        "HOSTNAME",
        "JAVA_HOME",
        "MAVEN_HOME",
        "MAVEN_OPTS",
        // Non-secret network configuration needed by enterprise agents.
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "NODE_EXTRA_CA_CERTS",
        "NPM_CONFIG_REGISTRY"
    );

    /**
     * Windows essentials. These are harmless machine configuration values, not
     * credentials.
     */
    private static final Set<String> WINDOWS_ALLOWED = Set.of(
        "SYSTEMROOT",
        "SYSTEMDRIVE",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "NUMBER_OF_PROCESSORS",
        "PROCESSOR_ARCHITECTURE",
        "PROCESSOR_IDENTIFIER",
        "OS",
        "HOMEDRIVE",
        "HOMEPATH",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA"
    );

    private EnvironmentSanitizer() {
    }

    /**
     * Replaces {@code environment} with an allowlisted copy. The map instance is
     * mutated so it can be passed straight to {@link ProcessBuilder#environment()}.
     */
    public static void sanitize(Map<String, String> environment) {
        if (environment == null) {
            return;
        }
        Map<String, String> copy = new LinkedHashMap<>(environment);
        environment.clear();
        for (Map.Entry<String, String> entry : copy.entrySet()) {
            if (isAllowed(entry.getKey())) {
                environment.put(entry.getKey(), entry.getValue());
            }
        }
        if (!environment.containsKey("PATH")) {
            environment.put("PATH", defaultPath());
        }
    }

    static boolean isAllowed(String name) {
        if (name == null || name.isBlank()) {
            return false;
        }
        String upper = name.toUpperCase(Locale.ROOT);
        if (POSIX_ALLOWED.contains(upper) || WINDOWS_ALLOWED.contains(upper)) {
            return true;
        }
        // Windows exposes a handful of read-only processor/OS variables with a
        // stable prefix. None of them can contain a credential.
        return upper.startsWith("PROCESSOR_") || upper.startsWith("NUMBER_OF_");
    }

    private static String defaultPath() {
        boolean windows = System.getProperty("os.name", "").toLowerCase(Locale.ROOT).contains("win");
        return windows
            ? "C:\\Windows\\system32;C:\\Windows"
            : "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
    }
}
