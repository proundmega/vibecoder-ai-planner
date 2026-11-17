package com.vibecode.agent.harness;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Scoped client-certificate material for {@code terminate} mode (fg-34 D29).
 *
 * <p>The private key is held only here, in the supervisor, and in the egress
 * proxy process. The sandbox spec's {@link #toString()} redacts it so command
 * logging cannot copy it into run output.</p>
 */
public final class EgressMtlsMaterial {

    private static final int MAX_PEM_BYTES = 32 * 1024;
    private static final int MAX_HOSTS = 16;
    private static final Pattern CERT_BLOCK = Pattern.compile(
        "-----BEGIN CERTIFICATE-----[\\s\\S]*?-----END CERTIFICATE-----");
    private static final Pattern PRIVATE_KEY = Pattern.compile(
        "-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----");

    private final List<String> hosts;
    private final String certPem;
    private final String keyPem;
    private final String certSha256;

    public EgressMtlsMaterial(List<String> hosts, String certPem, String keyPem) {
        if (hosts == null || hosts.isEmpty() || hosts.size() > MAX_HOSTS) {
            throw new IllegalArgumentException("mTLS hosts must contain 1-" + MAX_HOSTS + " hosts");
        }
        Set<String> normalized = new LinkedHashSet<>();
        for (String host : hosts) {
            normalized.add(validateHost(host));
        }
        this.hosts = List.copyOf(normalized);
        this.certPem = requirePem(certPem, "mTLS client certificate");
        this.keyPem = requirePem(keyPem, "mTLS client key");
        if (PRIVATE_KEY.matcher(this.certPem).find()) {
            throw new IllegalArgumentException("mTLS client certificate must not contain a private key");
        }
        if (!PRIVATE_KEY.matcher(this.keyPem).find()
            || this.keyPem.contains("CERTIFICATE")) {
            throw new IllegalArgumentException("mTLS client key must contain a private key only");
        }
        Matcher certs = CERT_BLOCK.matcher(this.certPem);
        List<String> blocks = new ArrayList<>();
        while (certs.find()) {
            blocks.add(certs.group());
        }
        if (blocks.size() != 1) {
            throw new IllegalArgumentException("mTLS client certificate must contain exactly one certificate");
        }
        try {
            X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
                .generateCertificate(new java.io.ByteArrayInputStream(
                    blocks.get(0).getBytes(StandardCharsets.US_ASCII)));
            if (certificate.getBasicConstraints() >= 0) {
                throw new IllegalArgumentException("mTLS client certificate must not be a CA");
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("mTLS client certificate is not a valid X.509 certificate", e);
        }
        this.certSha256 = sha256(this.certPem);
    }

    public List<String> hosts() {
        return hosts;
    }

    String certPem() {
        return certPem;
    }

    String keyPem() {
        return keyPem;
    }

    public String certSha256() {
        return certSha256;
    }

    @Override
    public String toString() {
        return "EgressMtlsMaterial{hosts=" + hosts
            + ", certSha256=" + certSha256
            + ", key=<redacted>}";
    }

    private static String requirePem(String pem, String field) {
        if (pem == null || pem.isBlank()) {
            throw new IllegalArgumentException(field + " is required");
        }
        if (pem.getBytes(StandardCharsets.UTF_8).length > MAX_PEM_BYTES) {
            throw new IllegalArgumentException(field + " exceeds 32 KiB");
        }
        return pem;
    }

    private static String validateHost(String host) {
        String normalized = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        if (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.isEmpty() || normalized.length() > 253
            || normalized.contains("*")
            || !normalized.matches("[a-z0-9.-]+")
            || normalized.matches("\\d{1,3}(\\.\\d{1,3}){3}")
            || normalized.contains(":")) {
            throw new IllegalArgumentException("mTLS host is invalid: " + host);
        }
        if (normalized.equals("localhost") || normalized.endsWith(".localhost")
            || normalized.equals("metadata") || normalized.equals("metadata.google.internal")
            || normalized.endsWith(".local") || normalized.endsWith(".internal")
            || normalized.endsWith(".home.arpa")
            || normalized.equals("host.docker.internal")
            || normalized.equals("gateway.docker.internal")) {
            throw new IllegalArgumentException(
                "mTLS host must not be internal or metadata: " + host);
        }
        return normalized;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
