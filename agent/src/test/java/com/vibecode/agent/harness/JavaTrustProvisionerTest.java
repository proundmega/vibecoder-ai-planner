package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JavaTrustProvisionerTest {

    private static final Duration TIMEOUT = Duration.ofSeconds(5);

    @Test
    void provisionsATruststoreWhenAJDKIsPresent() throws IOException {
        FakeExecutor executor = new FakeExecutor(
            new JavaTrustProvisioner.Result(0, "PRESENT /opt/java\n", false),
            new JavaTrustProvisioner.Result(0, "OK\n", false));
        byte[] ca = "-----BEGIN CERTIFICATE-----".getBytes(StandardCharsets.US_ASCII);

        Map<String, String> env = JavaTrustProvisioner.provision(executor, ca, TIMEOUT);

        assertEquals("/opt/java", env.get("JAVA_HOME"));
        assertTrue(env.get("JAVA_TOOL_OPTIONS").contains(
            "-Djavax.net.ssl.trustStore=" + JavaTrustProvisioner.TRUSTSTORE_PATH));
        assertTrue(env.get("JAVA_TOOL_OPTIONS").contains(
            "-Djavax.net.ssl.trustStorePassword=" + JavaTrustProvisioner.STOREPASS));
        assertTrue(executor.writes.containsKey(JavaTrustProvisioner.CA_PATH));
        assertEquals(ca, executor.writes.get(JavaTrustProvisioner.CA_PATH));
        assertEquals(2, executor.scripts.size());
        assertTrue(executor.scripts.get(0).contains("command -v keytool"));
        String imported = executor.scripts.get(1);
        assertTrue(imported.contains("/opt/java/lib/security/cacerts"), imported);
        assertTrue(imported.contains("vibecode-egress"), imported);
        assertTrue(imported.contains("chmod 0444 " + JavaTrustProvisioner.TRUSTSTORE_PATH),
            imported);
        assertTrue(imported.contains("rm -f " + JavaTrustProvisioner.CA_PATH), imported);
    }

    @Test
    void skipsWithoutAKeytool() throws IOException {
        FakeExecutor executor = new FakeExecutor(
            new JavaTrustProvisioner.Result(0, "ABSENT\n", false));

        Map<String, String> env = JavaTrustProvisioner.provision(
            executor, "ca".getBytes(StandardCharsets.US_ASCII), TIMEOUT);

        assertTrue(env.isEmpty());
        assertTrue(executor.writes.isEmpty());
    }

    @Test
    void failsWhenJDKCacertsAreMissing() {
        FakeExecutor executor = new FakeExecutor(
            new JavaTrustProvisioner.Result(0, "NOCACERTS\n", false));

        IOException error = assertThrows(IOException.class,
            () -> JavaTrustProvisioner.provision(
                executor, "ca".getBytes(StandardCharsets.US_ASCII), TIMEOUT));
        assertTrue(error.getMessage().contains("cacerts"), error.getMessage());
    }

    @Test
    void failsWhenTheImportFails() {
        FakeExecutor executor = new FakeExecutor(
            new JavaTrustProvisioner.Result(0, "PRESENT /opt/java\n", false),
            new JavaTrustProvisioner.Result(1, "keytool failed\n", false));

        IOException error = assertThrows(IOException.class,
            () -> JavaTrustProvisioner.provision(
                executor, "ca".getBytes(StandardCharsets.US_ASCII), TIMEOUT));
        assertTrue(error.getMessage().contains("import the per-run CA"), error.getMessage());
        assertTrue(executor.writes.containsKey(JavaTrustProvisioner.CA_PATH));
    }

    @Test
    void failsWhenTheProbeTimesOut() {
        FakeExecutor executor = new FakeExecutor(
            new JavaTrustProvisioner.Result(-1, "", true));

        IOException error = assertThrows(IOException.class,
            () -> JavaTrustProvisioner.provision(
                executor, "ca".getBytes(StandardCharsets.US_ASCII), TIMEOUT));
        assertTrue(error.getMessage().contains("probe"), error.getMessage());
    }

    @Test
    void rejectsAnUnsafeJavaHome() {
        FakeExecutor executor = new FakeExecutor(
            new JavaTrustProvisioner.Result(0, "PRESENT /opt/java;id\n", false));

        IOException error = assertThrows(IOException.class,
            () -> JavaTrustProvisioner.provision(
                executor, "ca".getBytes(StandardCharsets.US_ASCII), TIMEOUT));
        assertTrue(error.getMessage().contains("Invalid JAVA_HOME"), error.getMessage());
        assertTrue(executor.writes.isEmpty());
    }

    @Test
    void doesNotLogOrExposeTheTruststoreInTheWorkspace() {
        Map<String, String> env = JavaTrustProvisioner.environment("/opt/java");

        assertFalse(env.containsKey("TRUSTSTORE"));
        assertEquals(2, env.size());
        assertTrue(JavaTrustProvisioner.TRUSTSTORE_PATH.startsWith("/tmp/"));
    }

    private static final class FakeExecutor implements JavaTrustProvisioner.Executor {
        private final Deque<JavaTrustProvisioner.Result> results = new ArrayDeque<>();
        private final List<String> scripts = new ArrayList<>();
        private final Map<String, byte[]> writes = new LinkedHashMap<>();

        private FakeExecutor(JavaTrustProvisioner.Result... results) {
            this.results.addAll(List.of(results));
        }

        @Override
        public JavaTrustProvisioner.Result exec(
            String script,
            Duration timeout,
            int maxOutputBytes
        ) {
            scripts.add(script);
            JavaTrustProvisioner.Result result = results.pollFirst();
            if (result == null) {
                throw new AssertionError("unexpected exec: " + script);
            }
            return result;
        }

        @Override
        public void write(String path, byte[] bytes) {
            writes.put(path, bytes);
        }
    }
}
