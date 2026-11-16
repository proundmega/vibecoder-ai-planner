package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Exercises the allowlist checks in the Node egress proxy without Docker.
 * The script is also exercised end-to-end by the opt-in integration suite.
 */
class EgressProxyScriptTest {

    @TempDir
    Path tempDir;

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

    @Test
    void terminateModeCreatesAPerRunCaTrustAnchor() throws Exception {
        Path caDir = tempDir.resolve("ca");
        Result result = run("--check-tls-init", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_CA_DIR", caDir.toString()));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("CA "), result.output);
        X509Certificate ca = certificate(Files.readString(caDir.resolve("ca.crt")));
        assertTrue(ca.getBasicConstraints() >= 0);
        boolean[] usage = ca.getKeyUsage();
        assertTrue(usage[5], "keyCertSign");
        assertTrue(usage[6], "cRLSign");
        assertTrue(Files.getPosixFilePermissions(caDir.resolve("ca.key"))
            .contains(PosixFilePermission.OWNER_READ));
        assertFalse(Files.getPosixFilePermissions(caDir.resolve("ca.key"))
            .contains(PosixFilePermission.GROUP_READ));
    }

    @Test
    void terminateModeMintsALeafForTheValidatedSni() throws Exception {
        Path caDir = tempDir.resolve("leaf-ca");
        Result result = run("--check-leaf", "registry.npmjs.org", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_CA_DIR", caDir.toString()));

        assertEquals(0, result.exitCode, result.output);
        X509Certificate leaf = certificate(result.output);
        assertEquals(-1, leaf.getBasicConstraints());
        Collection<List<?>> names = leaf.getSubjectAlternativeNames();
        assertTrue(names.stream().anyMatch(entry ->
            Integer.valueOf(2).equals(entry.get(0))
                && "registry.npmjs.org".equals(entry.get(1))));
    }

    @Test
    void terminateModeRejectsAnInvalidSni() throws Exception {
        Result result = run("--check-leaf", "bad/sni", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_CA_DIR", tempDir.resolve("bad-ca").toString()));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("invalid SNI"), result.output);
    }

    @Test
    void acceptsAScopedOriginCa() throws Exception {
        Result result = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_PEM_B64", originCaBase64("egress-origin-ca.pem")));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("ORIGIN_CA registry.npmjs.org"), result.output);
    }

    @Test
    void rejectsAnUnscopedOrInvalidOriginCa() throws Exception {
        Result outside = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "other.example.com",
            "EGRESS_ORIGIN_CA_PEM_B64", originCaBase64("egress-origin-ca.pem")));
        assertEquals(1, outside.exitCode, outside.output);
        assertTrue(outside.output.contains("not in the allowlist"), outside.output);

        Result leaf = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_PEM_B64", originCaBase64("egress-origin-leaf.pem")));
        assertEquals(1, leaf.exitCode, leaf.output);
        assertTrue(leaf.output.contains("CA certificates only"), leaf.output);

        Result missing = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org"));
        assertEquals(1, missing.exitCode, missing.output);
        assertTrue(missing.output.contains("must be set together"), missing.output);

        Result sniOnly = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "sni-only",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_PEM_B64", originCaBase64("egress-origin-ca.pem")));
        assertEquals(1, sniOnly.exitCode, sniOnly.output);
        assertTrue(sniOnly.output.contains("terminate"), sniOnly.output);
    }

    @Test
    void rejectsWildcardBlockedAndOversizedOriginCaScopesAtTheProxy() throws Exception {
        String ca = originCaBase64("egress-origin-ca.pem");
        Result wildcard = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ALLOWED_HOSTS", "*.example.com",
            "EGRESS_ORIGIN_CA_HOSTS", "*.example.com",
            "EGRESS_ORIGIN_CA_PEM_B64", ca));
        assertEquals(1, wildcard.exitCode, wildcard.output);
        assertTrue(wildcard.output.contains("wildcards"), wildcard.output);

        Result blocked = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ALLOWED_HOSTS", "metadata.google.internal",
            "EGRESS_ORIGIN_CA_HOSTS", "metadata.google.internal",
            "EGRESS_ORIGIN_CA_PEM_B64", ca));
        assertEquals(1, blocked.exitCode, blocked.output);
        assertTrue(blocked.output.contains("internal or metadata"), blocked.output);

        Result ip = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ALLOWED_HOSTS", "127.0.0.1",
            "EGRESS_ORIGIN_CA_HOSTS", "127.0.0.1",
            "EGRESS_ORIGIN_CA_PEM_B64", ca));
        assertEquals(1, ip.exitCode, ip.output);
        assertTrue(ip.output.contains("IP literals"), ip.output);

        Result tooMany = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_PEM_B64", Base64.getEncoder().encodeToString(
                Files.readString(Path.of("src/test/resources/egress-origin-ca.pem"))
                    .repeat(17).getBytes(StandardCharsets.US_ASCII))));
        assertEquals(1, tooMany.exitCode, tooMany.output);
        assertTrue(tooMany.output.contains("1-16"), tooMany.output);

        Result tooLarge = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_PEM_B64", Base64.getEncoder().encodeToString(
                new byte[64 * 1024 + 1])));
        assertEquals(1, tooLarge.exitCode, tooLarge.output);
        assertTrue(tooLarge.output.contains("bounded"), tooLarge.output);
    }

    @Test
    void normalizesATrailingDotOriginCaHost() throws Exception {
        Result result = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ALLOWED_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org.",
            "EGRESS_ORIGIN_CA_PEM_B64", originCaBase64("egress-origin-ca.pem")));

        assertEquals(0, result.exitCode, result.output);
        assertTrue(result.output.contains("ORIGIN_CA registry.npmjs.org"), result.output);
    }

    @Test
    void rejectsPrivateKeyMaterialInTheProxy() throws Exception {
        String key = Base64.getEncoder().encodeToString(
            "-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n"
                .getBytes(StandardCharsets.US_ASCII));
        Result result = run("--check-origin-ca", "", Map.of(
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_ORIGIN_CA_HOSTS", "registry.npmjs.org",
            "EGRESS_ORIGIN_CA_PEM_B64", key));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("certificates only"), result.output);
    }

    private static String originCaBase64(String resource) throws IOException {
        return Base64.getEncoder().encodeToString(
            Files.readAllBytes(Path.of("src/test/resources", resource)));
    }

    @Test
    void rejectsUnknownTlsModes() throws Exception {
        Result result = run("--check-allow", "registry.npmjs.org:443", Map.of(
            "EGRESS_TLS_MODE", "mitm"));

        assertEquals(1, result.exitCode, result.output);
        assertTrue(result.output.contains("sni-only, terminate"), result.output);
    }

    private static X509Certificate certificate(String pem) throws Exception {
        return (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(
                pem.getBytes(StandardCharsets.US_ASCII)));
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
        builder.environment().remove("EGRESS_ORIGIN_CA_HOSTS");
        builder.environment().remove("EGRESS_ORIGIN_CA_PEM_B64");
        builder.environment().remove("NODE_EXTRA_CA_CERTS");
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
