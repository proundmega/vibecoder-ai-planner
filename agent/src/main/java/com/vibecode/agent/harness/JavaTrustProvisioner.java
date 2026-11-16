package com.vibecode.agent.harness;

import java.io.IOException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Builds a Java truststore for terminate-mode egress.
 *
 * <p>The sandbox base image has no JDK. When a sandbox does contain a JDK and
 * {@code keytool}, this copies {@code $JAVA_HOME/lib/security/cacerts} into the
 * sandbox tmpfs and imports the per-run proxy CA. Execs then receive
 * {@code JAVA_TOOL_OPTIONS} pointing at that truststore. Without a JDK the
 * environment stays empty; a JDK installed later does not trust the per-run CA
 * and fails TLS closed.</p>
 *
 * <p>The truststore and CA live only in the sandbox tmpfs, never in the
 * workspace. {@code changeit} is the public default cacerts password, not a
 * secret; the truststore path and password are not logged. This assumes a
 * standard JDK cacerts store using that default password; a custom store
 * password fails sandbox creation closed. The truststore is mode 0444 and
 * owned by the sandbox user, so sandbox code can replace it. It is not a host
 * boundary.</p>
 */
final class JavaTrustProvisioner {

    static final String TRUSTSTORE_PATH = "/tmp/vibecode-java-truststore";
    static final String CA_PATH = "/tmp/vibecode-java-ca.crt";
    static final String STOREPASS = "changeit";
    private static final String ALIAS = "vibecode-egress";

    private JavaTrustProvisioner() {
    }

    interface Executor {
        Result exec(String script, Duration timeout, int maxOutputBytes) throws IOException;

        void write(String path, byte[] bytes) throws IOException;
    }

    record Result(int exitCode, String output, boolean timedOut) {
        boolean ok() {
            return !timedOut && exitCode == 0;
        }
    }

    /**
     * @return the extra exec environment, or an empty map when no JDK/keytool
     *     is present (Java toolchains then fail TLS closed)
     * @throws IOException when a JDK is present but the truststore cannot be
     *     built, or the probe itself fails
     */
    static Map<String, String> provision(
        Executor executor,
        byte[] ca,
        Duration timeout
    ) throws IOException {
        if (executor == null) {
            throw new IllegalArgumentException("executor is required");
        }
        if (ca == null || ca.length == 0) {
            throw new IOException("Per-run CA is empty");
        }
        Result probe = executor.exec(probeScript(), timeout, 4_096);
        if (!probe.ok()) {
            throw new IOException("Could not probe the sandbox for a JDK/keytool: "
                + probe.output());
        }
        String output = probe.output().trim();
        if ("ABSENT".equals(output)) {
            return Map.of();
        }
        if ("NOCACERTS".equals(output)) {
            throw new IOException(
                "A JDK/keytool is present but $JAVA_HOME/lib/security/cacerts is unreadable");
        }
        if (!output.startsWith("PRESENT ")) {
            throw new IOException("Unexpected JDK probe output: " + output);
        }
        String javaHome = output.substring("PRESENT ".length()).trim();
        if (!isSafeJavaHome(javaHome)) {
            throw new IOException("Invalid JAVA_HOME reported by the sandbox: " + javaHome);
        }

        executor.write(CA_PATH, ca);
        Result imported = executor.exec(importScript(javaHome), timeout, 4_096);
        if (!imported.ok()) {
            throw new IOException(
                "Could not import the per-run CA into the Java truststore: "
                    + imported.output());
        }
        return environment(javaHome);
    }

    static Map<String, String> environment(String javaHome) {
        Map<String, String> env = new LinkedHashMap<>();
        env.put("JAVA_HOME", javaHome);
        env.put("JAVA_TOOL_OPTIONS",
            "-Djavax.net.ssl.trustStore=" + TRUSTSTORE_PATH
                + " -Djavax.net.ssl.trustStorePassword=" + STOREPASS);
        return Map.copyOf(env);
    }

    static String probeScript() {
        return "if command -v keytool >/dev/null 2>&1; then "
            + "jh=$(keytool -J-XshowSettings:properties -version 2>&1 "
            + "| sed -n 's/^[[:space:]]*java.home = //p' | head -n1); "
            + "if [ -z \"$jh\" ] || [ ! -r \"$jh/lib/security/cacerts\" ]; then "
            + "echo NOCACERTS; else echo \"PRESENT $jh\"; fi; "
            + "else echo ABSENT; fi";
    }

    static String importScript(String javaHome) {
        if (!isSafeJavaHome(javaHome)) {
            throw new IllegalArgumentException("Invalid JAVA_HOME: " + javaHome);
        }
        String cacerts = shellQuote(javaHome + "/lib/security/cacerts");
        return "set -e; "
            + "cp " + cacerts + " " + TRUSTSTORE_PATH + "; "
            + "keytool -delete -alias " + ALIAS
            + " -keystore " + TRUSTSTORE_PATH
            + " -storepass " + STOREPASS + " >/dev/null 2>&1 || true; "
            + "keytool -importcert -noprompt -alias " + ALIAS
            + " -file " + CA_PATH
            + " -keystore " + TRUSTSTORE_PATH
            + " -storepass " + STOREPASS + " >/dev/null 2>&1; "
            + "chmod 0444 " + TRUSTSTORE_PATH + "; "
            + "rm -f " + CA_PATH;
    }

    private static boolean isSafeJavaHome(String javaHome) {
        return javaHome != null
            && javaHome.startsWith("/")
            && !javaHome.contains("\n")
            && !javaHome.contains("\r")
            && javaHome.matches("[/A-Za-z0-9._+ -]+");
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\\''") + "'";
    }
}
