package com.vibecode.agent.harness;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;

import javax.net.ssl.SNIHostName;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * End-to-end check of terminate mode against a real TLS origin. This does not
 * need Docker: the proxy and a local OpenSSL test server run as child
 * processes, with the loopback resolver seam explicitly enabled for the test.
 */
class EgressProxyTerminateIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    @Timeout(90)
    void allowsTheValidatedHostAndRejectsADifferentHost() throws Exception {
        Assumptions.assumeTrue(nodeAvailable(), "node is required");
        Assumptions.assumeTrue(opensslAvailable(), "openssl is required");
        Assumptions.assumeTrue(opensslServerAvailable(), "openssl s_server is required");

        Path caCert = tempDir.resolve("ca.crt");
        Path caKey = tempDir.resolve("ca.key");
        Path serverCert = tempDir.resolve("server.crt");
        Path serverKey = tempDir.resolve("server.key");
        Path serverCsr = tempDir.resolve("server.csr");
        Path serverExt = tempDir.resolve("server.ext");
        generateCertificates(caCert, caKey, serverCert, serverKey, serverCsr, serverExt);

        int originPort = freePort();
        Process origin = new ProcessBuilder(
            "openssl", "s_server", "-www", "-quiet",
            "-accept", "127.0.0.1:" + originPort,
            "-cert", serverCert.toString(),
            "-key", serverKey.toString())
            .redirectErrorStream(true)
            .start();
        int proxyPort = freePort();
        Path proxyCaDir = tempDir.resolve("proxy-ca");
        ProcessBuilder proxyBuilder = new ProcessBuilder(
            "node", Path.of("src/main/resources/sandbox/egress-proxy.js").toString());
        proxyBuilder.redirectErrorStream(true);
        proxyBuilder.environment().putAll(java.util.Map.of(
            "EGRESS_ALLOWED_HOSTS", "localhost.test",
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_PORT", String.valueOf(proxyPort),
            "EGRESS_CA_DIR", proxyCaDir.toString(),
            "EGRESS_TEST_MODE", "1",
            "EGRESS_TEST_RESOLVE_IP", "127.0.0.1",
            "EGRESS_TEST_ALLOW_LOOPBACK", "1",
            "EGRESS_TEST_CONNECT_PORT", String.valueOf(originPort),
            "NODE_EXTRA_CA_CERTS", caCert.toString()
        ));
        Process proxy = proxyBuilder.start();

        try {
            BlockingQueue<String> logs = awaitListening(proxy);
            awaitPort(originPort);
            awaitPort(proxyPort);

            X509Certificate proxyCa = readCertificate(proxyCaDir.resolve("ca.crt"));
            SSLContext context = trust(proxyCa);

            String allowed = request(context, proxyPort, originPort, "localhost.test");
            assertTrue(allowed.contains("200"), allowed + "\n" + String.join("\n", logs));
            assertTrue(request(context, proxyPort, originPort, "LOCALHOST.TEST")
                .contains("200"));
            assertTrue(request(context, proxyPort, originPort, "localhost.test.")
                .contains("200"));
            assertTrue(request(context, proxyPort, originPort, "localhost.test:443")
                .contains("200"));
            String denied = request(context, proxyPort, originPort, "evil.test");
            assertTrue(denied.contains("403") || denied.isEmpty(), denied);
            String wrongPort = request(context, proxyPort, originPort, "localhost.test:444");
            assertTrue(wrongPort.contains("403") || wrongPort.isEmpty(), wrongPort);
            assertDenied(context, proxyPort, originPort,
                "GET / HTTP/1.1\r\nHost: localhost.test\r\nHost: localhost.test\r\n\r\n");
            assertDenied(context, proxyPort, originPort,
                "OPTIONS * HTTP/1.1\r\nHost: localhost.test\r\n\r\n");
            assertDenied(context, proxyPort, originPort,
                "GET / HTTP/1.0\r\n\r\n");
            assertTrue(requestRaw(context, proxyPort, originPort,
                "GET / HTTP/1.0\r\nHost: localhost.test\r\n\r\n")
                .contains("200"));
            assertDenied(context, proxyPort, originPort,
                "POST / HTTP/1.1\r\nHost: localhost.test\r\n"
                    + "Content-Length: 4\r\nContent-Length: 4\r\n\r\nbody");
            assertDenied(context, proxyPort, originPort,
                "POST / HTTP/1.1\r\nHost: localhost.test\r\n"
                    + "Content-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n");
        } finally {
            stop(proxy);
            stop(origin);
        }
    }

    @Test
    @Timeout(90)
    void rejectsChunkedSmugglingAndPreservesDuplicateResponseHeaders() throws Exception {
        Assumptions.assumeTrue(nodeAvailable(), "node is required");
        Assumptions.assumeTrue(opensslAvailable(), "openssl is required");

        Path caCert = tempDir.resolve("ca2.crt");
        Path caKey = tempDir.resolve("ca2.key");
        Path serverCert = tempDir.resolve("server2.crt");
        Path serverKey = tempDir.resolve("server2.key");
        Path serverCsr = tempDir.resolve("server2.csr");
        Path serverExt = tempDir.resolve("server2.ext");
        generateCertificates(caCert, caKey, serverCert, serverKey, serverCsr, serverExt);

        int originPort = freePort();
        Path log = tempDir.resolve("origin.log");
        Process origin = startNodeOrigin(originPort, serverCert, serverKey, log);
        int proxyPort = freePort();
        Path proxyCaDir = tempDir.resolve("proxy-ca2");
        Process proxy = startProxy(proxyPort, proxyCaDir, originPort, caCert);
        try {
            awaitListening(proxy);
            awaitPort(originPort);
            awaitPort(proxyPort);
            SSLContext context = trust(readCertificate(proxyCaDir.resolve("ca.crt")));

            String smuggled = "GET /smuggled HTTP/1.1\r\nHost: evil.test\r\n\r\n";
            String chunked = Integer.toHexString(smuggled.length()) + "\r\n"
                + smuggled + "\r\n0\r\n\r\n";
            String response = requestRaw(context, proxyPort, originPort,
                "GET /outer HTTP/1.1\r\nHost: localhost.test\r\n"
                    + "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                    + chunked);
            assertTrue(response.contains("200"), response);
            Thread.sleep(200);
            List<String> lines = Files.readAllLines(log);
            assertEquals(1, lines.stream().filter(line -> line.contains("/outer")).count(),
                String.join("\n", lines));
            assertTrue(lines.stream().noneMatch(line -> line.contains("/smuggled")),
                String.join("\n", lines));

            String hop = requestRaw(context, proxyPort, originPort,
                "GET /hop HTTP/1.1\r\nHost: localhost.test\r\nConnection: close\r\n\r\n");
            assertTrue(hop.contains("a=1"), hop);
            assertTrue(hop.contains("b=2"), hop);

            assertTrue(requestRaw(context, proxyPort, originPort,
                "GET /204 HTTP/1.1\r\nHost: localhost.test\r\nConnection: close\r\n\r\n")
                .contains("204"));
            assertTrue(requestRaw(context, proxyPort, originPort,
                "GET /304 HTTP/1.1\r\nHost: localhost.test\r\nConnection: close\r\n\r\n")
                .contains("304"));
            String head = requestRaw(context, proxyPort, originPort,
                "HEAD / HTTP/1.1\r\nHost: localhost.test\r\nConnection: close\r\n\r\n");
            assertTrue(head.contains("200"), head);
            assertFalse(head.contains("ok"), head);
            String upgrade = requestRaw(context, proxyPort, originPort,
                "GET /101 HTTP/1.1\r\nHost: localhost.test\r\nConnection: close\r\n\r\n");
            assertTrue(upgrade.contains("403") || upgrade.isEmpty(), upgrade);
            String big = requestRaw(context, proxyPort, originPort,
                "GET /big HTTP/1.1\r\nHost: localhost.test\r\nConnection: close\r\n\r\n");
            assertFalse(big.contains("200"), big);
            String expect = requestRaw(context, proxyPort, originPort,
                "POST / HTTP/1.1\r\nHost: localhost.test\r\nExpect: 100-continue\r\n"
                    + "Content-Length: 0\r\nConnection: close\r\n\r\n");
            assertTrue(expect.contains("100") && expect.contains("200"), expect);
        } finally {
            stop(proxy);
            stop(origin);
        }
    }

    private static Process startNodeOrigin(
        int port,
        Path cert,
        Path key,
        Path log
    ) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(
            "node", Path.of("src/test/resources/egress-test-origin.js").toString(),
            String.valueOf(port), cert.toString(), key.toString(), log.toString());
        builder.redirectErrorStream(true);
        Process process = builder.start();
        awaitMessage(process, "origin listening");
        return process;
    }

    private static Process startProxy(
        int proxyPort,
        Path caDir,
        int originPort,
        Path originCa
    ) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(
            "node", Path.of("src/main/resources/sandbox/egress-proxy.js").toString());
        builder.redirectErrorStream(true);
        builder.environment().putAll(java.util.Map.of(
            "EGRESS_ALLOWED_HOSTS", "localhost.test",
            "EGRESS_TLS_MODE", "terminate",
            "EGRESS_PORT", String.valueOf(proxyPort),
            "EGRESS_CA_DIR", caDir.toString(),
            "EGRESS_TEST_MODE", "1",
            "EGRESS_TEST_RESOLVE_IP", "127.0.0.1",
            "EGRESS_TEST_ALLOW_LOOPBACK", "1",
            "EGRESS_TEST_CONNECT_PORT", String.valueOf(originPort),
            "NODE_EXTRA_CA_CERTS", originCa.toString()
        ));
        return builder.start();
    }

    private static void awaitMessage(Process process, String message) throws Exception {
        BlockingQueue<String> lines = new LinkedBlockingQueue<>();
        Thread reader = new Thread(() -> {
            try (BufferedReader buffered = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = buffered.readLine()) != null) {
                    lines.offer(line);
                }
            } catch (IOException ignored) {
                // The process was stopped.
            }
        }, "egress-test-log");
        reader.setDaemon(true);
        reader.start();
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (System.nanoTime() < deadline) {
            String line = lines.poll(200, TimeUnit.MILLISECONDS);
            if (line != null && line.contains(message)) {
                return;
            }
            if (!process.isAlive()) {
                throw new AssertionError("process exited before: " + message);
            }
        }
        throw new AssertionError("process did not emit: " + message);
    }

    private static String request(
        SSLContext context,
        int proxyPort,
        int originPort,
        String host
    ) throws Exception {
        return requestRaw(context, proxyPort, originPort,
            "GET / HTTP/1.1\r\nHost: " + host
                + "\r\nConnection: close\r\n\r\n");
    }

    private static String requestRaw(
        SSLContext context,
        int proxyPort,
        int originPort,
        String request
    ) throws Exception {
        try (Socket raw = new Socket("127.0.0.1", proxyPort)) {
            raw.setSoTimeout(15_000);
            OutputStream out = raw.getOutputStream();
            out.write(("CONNECT localhost.test:" + originPort
                + " HTTP/1.1\r\nHost: localhost.test:" + originPort + "\r\n\r\n")
                .getBytes(StandardCharsets.US_ASCII));
            out.flush();
            String connect = readHeaders(raw.getInputStream());
            if (!connect.contains(" 200 ")) {
                return connect;
            }
            SSLSocket tls = (SSLSocket) context.getSocketFactory()
                .createSocket(raw, "localhost.test", originPort, true);
            SSLParameters parameters = tls.getSSLParameters();
            parameters.setServerNames(List.of(new SNIHostName("localhost.test")));
            parameters.setEndpointIdentificationAlgorithm("HTTPS");
            tls.setSSLParameters(parameters);
            tls.startHandshake();
            OutputStream tlsOut = tls.getOutputStream();
            tlsOut.write(request.getBytes(StandardCharsets.US_ASCII));
            tlsOut.flush();
            return new String(tls.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static void assertDenied(
        SSLContext context,
        int proxyPort,
        int originPort,
        String request
    ) throws Exception {
        String response = requestRaw(context, proxyPort, originPort, request);
        assertTrue(response.contains("403") || response.isEmpty(), response);
    }

    private static String readHeaders(InputStream input) throws IOException {
        StringBuilder headers = new StringBuilder();
        int matched = 0;
        while (matched < 4) {
            int value = input.read();
            if (value < 0) {
                break;
            }
            headers.append((char) value);
            matched = (value == '\r' && (matched == 0 || matched == 2))
                || (value == '\n' && (matched == 1 || matched == 3))
                ? matched + 1
                : 0;
        }
        return headers.toString();
    }

    private static BlockingQueue<String> awaitListening(Process process) throws Exception {
        BlockingQueue<String> lines = new LinkedBlockingQueue<>();
        Thread reader = new Thread(() -> {
            try (BufferedReader buffered = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = buffered.readLine()) != null) {
                    lines.offer(line);
                }
            } catch (IOException ignored) {
                // The process was stopped.
            }
        }, "egress-proxy-log");
        reader.setDaemon(true);
        reader.start();
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (System.nanoTime() < deadline) {
            String line = lines.poll(200, TimeUnit.MILLISECONDS);
            if (line != null && line.contains("egress proxy listening")) {
                return lines;
            }
            if (!process.isAlive()) {
                throw new AssertionError("egress proxy exited before listening");
            }
        }
        throw new AssertionError("egress proxy did not start in time");
    }

    private static void awaitPort(int port) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        while (System.nanoTime() < deadline) {
            try (Socket ignored = new Socket("127.0.0.1", port)) {
                return;
            } catch (IOException e) {
                Thread.sleep(100);
            }
        }
        throw new AssertionError("port " + port + " did not open");
    }

    private static SSLContext trust(X509Certificate certificate) throws Exception {
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null, null);
        store.setCertificateEntry("proxy-ca", certificate);
        TrustManagerFactory factory = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm());
        factory.init(store);
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, factory.getTrustManagers(), null);
        return context;
    }

    private static X509Certificate readCertificate(Path path) throws Exception {
        return (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(Files.newInputStream(path));
    }

    private static void generateCertificates(
        Path caCert,
        Path caKey,
        Path serverCert,
        Path serverKey,
        Path serverCsr,
        Path serverExt
    ) throws Exception {
        openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", caKey.toString(), "-out", caCert.toString(), "-days", "1",
            "-subj", "/CN=vibecode-test-egress-ca",
            "-addext", "basicConstraints=critical,CA:TRUE",
            "-addext", "keyUsage=critical,keyCertSign,cRLSign");
        Files.writeString(serverExt, String.join("\n",
            "basicConstraints=critical,CA:FALSE",
            "keyUsage=critical,digitalSignature,keyEncipherment",
            "extendedKeyUsage=serverAuth",
            "subjectAltName=DNS:localhost.test",
            ""));
        openssl("req", "-new", "-newkey", "rsa:2048", "-nodes",
            "-keyout", serverKey.toString(), "-out", serverCsr.toString(),
            "-subj", "/CN=localhost.test",
            "-addext", "subjectAltName=DNS:localhost.test");
        openssl("x509", "-req", "-in", serverCsr.toString(),
            "-CA", caCert.toString(), "-CAkey", caKey.toString(),
            "-CAcreateserial", "-days", "1", "-extfile", serverExt.toString(),
            "-out", serverCert.toString());
    }

    private static void openssl(String... args) throws Exception {
        Process process = new ProcessBuilder(
            java.util.stream.Stream.concat(
                java.util.stream.Stream.of("openssl"),
                java.util.Arrays.stream(args)).toList())
            .redirectErrorStream(true)
            .start();
        String output = new String(process.getInputStream().readAllBytes(),
            StandardCharsets.UTF_8);
        assertEquals(0, process.waitFor(), output);
    }

    private static boolean nodeAvailable() {
        return commandAvailable("node", "--version");
    }

    private static boolean opensslAvailable() {
        return commandAvailable("openssl", "version");
    }

    private static boolean opensslServerAvailable() {
        try {
            Process process = new ProcessBuilder("openssl", "s_server", "-help")
                .redirectErrorStream(true)
                .start();
            process.getInputStream().readAllBytes();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private static boolean commandAvailable(String... command) {
        try {
            Process process = new ProcessBuilder(command).start();
            return process.waitFor() == 0;
        } catch (IOException | InterruptedException e) {
            return false;
        }
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static void stop(Process process) {
        if (process != null) {
            process.destroy();
            try {
                if (!process.waitFor(5, TimeUnit.SECONDS)) {
                    process.destroyForcibly();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }
}
