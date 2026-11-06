package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the allowlist checks in the Node egress proxy without Docker.
 * The script is also exercised end-to-end by the opt-in integration suite.
 */
class EgressProxyScriptTest {

    private static Path script;

    @BeforeAll
    static void locateScript() {
        script = Path.of("src/main/resources/sandbox/egress-proxy.js");
        Assumptions.assumeTrue(Files.isRegularFile(script),
            "egress proxy resource is not on the test path");
        Assumptions.assumeTrue(nodeAvailable(), "node is required for the proxy script test");
    }

    @Test
    void allowsAnExactHost() throws Exception {
        Result result = check("registry.npmjs.org:443");
        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("ALLOW"), result.output);
    }

    @Test
    void allowsAWildcardSubdomain() throws Exception {
        Result result = check("raw.githubusercontent.com:443");
        assertEquals(0, result.exitCode, result.output);
    }

    @Test
    void wildcardDoesNotMatchTheApex() throws Exception {
        assertDenied("githubusercontent.com:443");
    }

    @Test
    void deniesHostsOutsideTheAllowlist() throws Exception {
        assertDenied("example.org:443");
    }

    @Test
    void deniesLocalhostMetadataAndPrivateAddresses() throws Exception {
        assertDenied("localhost:443");
        assertDenied("169.254.169.254:80");
        assertDenied("10.0.0.1:443");
        assertDenied("127.0.0.1:443");
        assertDenied("metadata.google.internal:80");
    }

    @Test
    void deniesUnapprovedPorts() throws Exception {
        assertDenied("registry.npmjs.org:22");
        assertDenied("registry.npmjs.org:8080");
    }

    @Test
    void connectProbeIs443Only() throws Exception {
        Result allowed = checkConnect("registry.npmjs.org:443");
        assertEquals(0, allowed.exitCode, allowed.output);

        Result port80 = checkConnect("registry.npmjs.org:80");
        assertEquals(1, port80.exitCode, port80.output);
        assertTrue(port80.output.contains("443"), port80.output);
    }

    @Test
    void allowsAPublicHostAfterResolution() throws Exception {        Result result = checkResolve("registry.npmjs.org", "93.184.216.34");
        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("ALLOW"), result.output);
    }

    @Test
    void blocksHostnamesThatResolveToLoopbackOrMetadata() throws Exception {
        Result loopback = checkResolve("localtest.me", "127.0.0.1");
        assertEquals(1, loopback.exitCode, loopback.output);
        assertTrue(loopback.output.contains("private"), loopback.output);

        Result metadata = checkResolve("169.254.169.254.nip.io", "169.254.169.254");
        assertEquals(1, metadata.exitCode, metadata.output);
        assertTrue(metadata.output.contains("private"), metadata.output);
    }

    @Test
    void parsesASingleClientHelloSni() throws Exception {
        Result result = checkHello(clientHello(List.of("registry.npmjs.org")));
        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("SNI registry.npmjs.org"), result.output);
    }

    @Test
    void rejectsMultipleSniNamesInOneExtension() throws Exception {
        Result result = checkHello(clientHello(
            List.of("registry.npmjs.org", "example.org")));
        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("multiple SNI names"), result.output);
    }

    @Test
    void rejectsDuplicateSniExtensions() throws Exception {
        Result result = checkHello(clientHelloWithGroups(List.of(
            List.of("registry.npmjs.org"),
            List.of("example.org"))));
        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("multiple SNI names"), result.output);
    }

    @Test
    void rejectsASecondClientHelloInTheBufferedPrefix() throws Exception {
        byte[] first = clientHello(List.of("registry.npmjs.org"));
        byte[] second = clientHello(List.of("example.org"));
        Result result = checkHello(concat(first, second));
        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("multiple TLS handshakes"), result.output);
    }

    private void assertDenied(String target) throws Exception {
        Result result = check(target);
        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("DENY"), result.output);
    }

    private Result checkHello(byte[] hello) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(List.of(
            "node", script.toString(), "--check-hello",
            Base64.getEncoder().encodeToString(hello)));
        builder.redirectErrorStream(true);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        return new Result(process.waitFor(), output);
    }

    private static byte[] clientHello(List<String> snis) {
        return clientHelloWithGroups(List.of(snis));
    }

    private static byte[] clientHelloWithGroups(List<List<String>> groups) {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        writeUInt16(body, 0x0303);
        body.writeBytes(new byte[32]);
        body.write(0);
        writeUInt16(body, 2);
        writeUInt16(body, 0x1301);
        body.write(1);
        body.write(0);

        ByteArrayOutputStream extensions = new ByteArrayOutputStream();
        for (List<String> group : groups) {
            ByteArrayOutputStream names = new ByteArrayOutputStream();
            for (String sni : group) {
                byte[] name = sni.getBytes(StandardCharsets.US_ASCII);
                names.write(0);
                writeUInt16(names, name.length);
                names.writeBytes(name);
            }
            ByteArrayOutputStream extension = new ByteArrayOutputStream();
            writeUInt16(extension, names.size());
            extension.writeBytes(names.toByteArray());
            writeUInt16(extensions, 0);
            writeUInt16(extensions, extension.size());
            extensions.writeBytes(extension.toByteArray());
        }
        writeUInt16(body, extensions.size());
        body.writeBytes(extensions.toByteArray());

        byte[] bodyBytes = body.toByteArray();
        ByteArrayOutputStream handshake = new ByteArrayOutputStream();
        handshake.write(0x01);
        writeUInt24(handshake, bodyBytes.length);
        handshake.writeBytes(bodyBytes);

        byte[] handshakeBytes = handshake.toByteArray();
        ByteArrayOutputStream record = new ByteArrayOutputStream();
        record.write(0x16);
        writeUInt16(record, 0x0301);
        writeUInt16(record, handshakeBytes.length);
        record.writeBytes(handshakeBytes);
        return record.toByteArray();
    }

    private static void writeUInt16(ByteArrayOutputStream out, int value) {
        out.write((value >> 8) & 0xff);
        out.write(value & 0xff);
    }

    private static void writeUInt24(ByteArrayOutputStream out, int value) {
        out.write((value >> 16) & 0xff);
        out.write((value >> 8) & 0xff);
        out.write(value & 0xff);
    }

    private static byte[] concat(byte[] first, byte[] second) {
        byte[] result = new byte[first.length + second.length];
        System.arraycopy(first, 0, result, 0, first.length);
        System.arraycopy(second, 0, result, first.length, second.length);
        return result;
    }

    private Result check(String target) throws Exception {
        return run("--check-allow", target, Map.of());
    }

    private Result checkResolve(String target, String ip) throws Exception {
        return run("--check-resolve", target, Map.of(
            "EGRESS_TEST_MODE", "1",
            "EGRESS_TEST_RESOLVE_IP", ip));
    }

    private Result checkConnect(String target) throws Exception {
        return run("--check-connect", target, Map.of());
    }

    private Result run(String mode, String target, Map<String, String> extra) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(
            List.of("node", script.toString(), mode, target));
        builder.environment().put("EGRESS_ALLOWED_HOSTS",
            "registry.npmjs.org,*.githubusercontent.com,"
                + "localtest.me,169.254.169.254.nip.io");
        builder.environment().putAll(extra);
        builder.redirectErrorStream(true);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        return new Result(exit, output);
    }

    private static boolean nodeAvailable() {
        try {
            Process process = new ProcessBuilder("node", "--version")
                .redirectErrorStream(true)
                .start();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private record Result(int exitCode, String output) {
    }
}
