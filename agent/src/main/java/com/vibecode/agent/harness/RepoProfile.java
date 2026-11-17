package com.vibecode.agent.harness;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Admin-approved repository environment profile (fg-39).
 *
 * <p>The backend validates the same schema, but the agent never trusts another
 * process for security-relevant fields: it re-validates the image digest,
 * environment, cache names and origin CA bundle before using them.</p>
 */
@JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY,
    getterVisibility = JsonAutoDetect.Visibility.NONE,
    isGetterVisibility = JsonAutoDetect.Visibility.NONE,
    setterVisibility = JsonAutoDetect.Visibility.NONE)
@JsonIgnoreProperties(ignoreUnknown = false)
public class RepoProfile {

    private static final Pattern GITHUB_URL = Pattern.compile(
        "^https://github\\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$");
    private static final Pattern BRANCH = Pattern.compile(
        "^(?!-)(?!.*\\.\\.)(?!.*//)(?!.*/$)(?!.*\\.$)[A-Za-z0-9._/-]{1,255}$");
    private static final Pattern IMAGE = Pattern.compile(
        "^[A-Za-z0-9][A-Za-z0-9._/:@-]*@sha256:[a-f0-9]{64}$");
    private static final Pattern ENV_KEY = Pattern.compile("^[A-Z_][A-Z0-9_]*$");
    private static final Pattern SECRET_KEY = Pattern.compile(
        "(?i)(?:^|_)(?:API_?KEY|ACCESS_?KEY|KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY)(?:$|_)");
    private static final List<Pattern> SECRET_VALUES = List.of(
        Pattern.compile("-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
        Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b"),
        Pattern.compile("\\bASIA[0-9A-Z]{16}\\b"),
        Pattern.compile("\\bgh[pousr]_[A-Za-z0-9]{20,}\\b"),
        Pattern.compile("\\bgithub_pat_[A-Za-z0-9_]{20,}\\b"),
        Pattern.compile("\\bxox[abcdepr]-[A-Za-z0-9-]{10,}\\b"),
        Pattern.compile("https?://[^\\s/@]+:[^\\s/@]+@")
    );
    private static final int MAX_CA_BYTES = 64 * 1024;
    private static final int MAX_CA_CERTIFICATES = 16;

    @JsonProperty("schema_version")
    private int schemaVersion = 1;
    @JsonProperty("repo_url")
    private String repoUrl;
    @JsonProperty("base_branch")
    private String baseBranch;
    private List<String> languages = List.of();
    private String image;
    private List<String> setup = List.of();
    private List<String> verify = List.of();
    private List<String> caches = List.of();
    private Map<String, String> env = Map.of();
    private Timeouts timeouts = new Timeouts();
    @JsonProperty("max_round_minutes")
    private int maxRoundMinutes = 45;
    private List<Object> services = List.of();
    @JsonProperty("flaky_tests")
    private List<String> flakyTests = List.of();
    private Egress egress;

    @JsonIgnoreProperties(ignoreUnknown = false)
    public static class Timeouts {
        @JsonProperty("setup_minutes")
        private int setupMinutes = 15;
        @JsonProperty("verify_minutes")
        private int verifyMinutes = 20;

        public int setupMinutes() {
            return setupMinutes;
        }

        public int verifyMinutes() {
            return verifyMinutes;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public static class Egress {
        @JsonProperty("tls_mode")
        private String tlsMode = "terminate";
        @JsonProperty("origin_ca_hosts")
        private List<String> originCaHosts = List.of();
        @JsonProperty("origin_ca_b64")
        private String originCaB64;
        @JsonProperty("mtls")
        private Mtls mtls;

        public String tlsMode() {
            return tlsMode;
        }

        public Mtls mtls() {
            return mtls;
        }

        public List<String> originCaHosts() {
            if (originCaHosts == null) {
                return List.of();
            }
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (String host : originCaHosts) {
                String value = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
                if (value.endsWith(".")) {
                    value = value.substring(0, value.length() - 1);
                }
                normalized.add(value);
            }
            return List.copyOf(normalized);
        }

        public boolean hasOriginCa() {
            return !originCaHosts().isEmpty()
                || (originCaB64 != null && !originCaB64.isBlank());
        }

        public String originCaPem() {
            if (originCaB64 == null || originCaB64.isBlank()) {
                throw new IllegalArgumentException("profile egress origin_ca_b64 is required");
            }
            return new String(Base64.getDecoder().decode(originCaB64), StandardCharsets.UTF_8);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public static class Mtls {
        @JsonProperty("credential_id")
        private long credentialId;
        @JsonProperty("hosts")
        private List<String> hosts = List.of();

        public long credentialId() {
            return credentialId;
        }

        public List<String> hosts() {
            if (hosts == null) {
                return List.of();
            }
            LinkedHashSet<String> normalized = new LinkedHashSet<>();
            for (String host : hosts) {
                String value = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
                if (value.endsWith(".")) {
                    value = value.substring(0, value.length() - 1);
                }
                normalized.add(value);
            }
            return List.copyOf(normalized);
        }
    }

    public int schemaVersion() {
        return schemaVersion;
    }

    public String repoUrl() {
        return repoUrl;
    }

    public String baseBranch() {
        return baseBranch;
    }

    public String baseBranchOr(String fallback) {
        return baseBranch == null || baseBranch.isBlank() ? fallback : baseBranch;
    }

    public List<String> languages() {
        return languages == null ? List.of() : List.copyOf(languages);
    }

    public String image() {
        return image == null || image.isBlank() ? null : image;
    }

    public List<String> setup() {
        return setup == null ? List.of() : List.copyOf(setup);
    }

    public List<String> verify() {
        return verify == null ? List.of() : List.copyOf(verify);
    }

    public List<String> caches() {
        return caches == null ? List.of() : List.copyOf(caches);
    }

    public Map<String, String> env() {
        return env == null ? Map.of() : Map.copyOf(env);
    }

    public Timeouts timeouts() {
        return timeouts == null ? new Timeouts() : timeouts;
    }

    public int maxRoundMinutes() {
        return maxRoundMinutes;
    }

    public List<Object> services() {
        return services == null ? List.of() : List.copyOf(services);
    }

    public List<String> flakyTests() {
        return flakyTests == null ? List.of() : List.copyOf(flakyTests);
    }

    public Egress egress() {
        return egress;
    }

    /** Environment applied to the sandbox/verification process. */
    public Map<String, String> environment() {
        return Map.copyOf(env());
    }

    public void validate() {
        if (schemaVersion != 1) {
            throw new IllegalArgumentException("profile schema_version must be 1");
        }
        if (repoUrl != null && !repoUrl.isBlank() && !GITHUB_URL.matcher(repoUrl).matches()) {
            throw new IllegalArgumentException("profile repo_url must be a GitHub HTTPS URL");
        }
        if (baseBranch != null && !baseBranch.isBlank() && !BRANCH.matcher(baseBranch).matches()) {
            throw new IllegalArgumentException("profile base_branch is invalid");
        }
        if (image != null && !image.isBlank() && !IMAGE.matcher(image).matches()) {
            throw new IllegalArgumentException(
                "profile image must be pinned by digest (@sha256:...)");
        }
        validateCommands(setup, "setup");
        validateCommands(verify, "verify");
        if (verify == null || verify.isEmpty()) {
            throw new IllegalArgumentException("profile verify must contain at least one command");
        }
        if (!caches().isEmpty()) {
            throw new IllegalArgumentException(
                "profile caches are not implemented until D9/fg-44");
        }
        for (Map.Entry<String, String> entry : env().entrySet()) {
            if (!ENV_KEY.matcher(entry.getKey()).matches()) {
                throw new IllegalArgumentException(
                    "profile env key is invalid: " + entry.getKey());
            }
            if (SECRET_KEY.matcher(entry.getKey()).find()) {
                throw new IllegalArgumentException(
                    "profile env key looks secret: " + entry.getKey());
            }
            String value = entry.getValue() == null ? "" : entry.getValue();
            for (Pattern pattern : SECRET_VALUES) {
                if (pattern.matcher(value).find()) {
                    throw new IllegalArgumentException(
                        "profile env value looks like a credential: " + entry.getKey());
                }
            }
        }
        if (timeouts().setupMinutes() < 1 || timeouts().setupMinutes() > 120) {
            throw new IllegalArgumentException("profile setup_minutes must be 1-120");
        }
        if (timeouts().verifyMinutes() < 1 || timeouts().verifyMinutes() > 180) {
            throw new IllegalArgumentException("profile verify_minutes must be 1-180");
        }
        if (maxRoundMinutes < 1 || maxRoundMinutes > 240) {
            throw new IllegalArgumentException("profile max_round_minutes must be 1-240");
        }
        if (!services().isEmpty()) {
            throw new IllegalArgumentException(
                "profile services are not implemented until fg-39 slice 2");
        }
        if (!flakyTests().isEmpty()) {
            throw new IllegalArgumentException(
                "profile flaky_tests are not implemented until fg-39 slice 3");
        }
        validateEgress();
    }

    private void validateEgress() {
        if (egress == null) {
            return;
        }
        if (!"terminate".equals(egress.tlsMode())) {
            throw new IllegalArgumentException(
                "profile egress tls_mode must be terminate");
        }
        boolean hasCa = !egress.originCaHosts().isEmpty()
            || (egress.originCaB64 != null && !egress.originCaB64.isBlank());
        if (hasCa) {
            validateOriginCa(egress);
        }
        if (egress.mtls() != null) {
            if (egress.mtls().credentialId() <= 0) {
                throw new IllegalArgumentException(
                    "profile egress.mtls credential_id must be positive");
            }
            List<String> mtlsHosts = egress.mtls().hosts();
            if (mtlsHosts.isEmpty() || mtlsHosts.size() > 16) {
                throw new IllegalArgumentException(
                    "profile egress.mtls.hosts must contain 1-16 hosts");
            }
            for (String host : mtlsHosts) {
                validateExactHost(host);
            }
        }
        if (!hasCa && egress.mtls() == null) {
            throw new IllegalArgumentException(
                "profile egress must configure an origin CA or client-certificate mTLS");
        }
    }

    private void validateOriginCa(Egress egress) {
        List<String> hosts = egress.originCaHosts();
        if (hosts.isEmpty() || hosts.size() > 16) {
            throw new IllegalArgumentException(
                "profile egress origin_ca_hosts must contain 1-16 hosts");
        }
        if (egress.originCaB64 == null || egress.originCaB64.isBlank()) {
            throw new IllegalArgumentException(
                "profile egress origin_ca_b64 is required with origin_ca_hosts");
        }
        for (String host : hosts) {
            validateExactHost(host);
        }
        String pem = egress.originCaPem();
        if (pem.getBytes(StandardCharsets.UTF_8).length > MAX_CA_BYTES) {
            throw new IllegalArgumentException("profile origin CA bundle exceeds 64 KiB");
        }
        if (pem.contains("PRIVATE KEY")) {
            throw new IllegalArgumentException("profile origin CA bundle must not contain a private key");
        }
        try {
            CertificateFactory factory = CertificateFactory.getInstance("X.509");
            List<Certificate> certificates = new ArrayList<>(
                factory.generateCertificates(new ByteArrayInputStream(
                    pem.getBytes(StandardCharsets.UTF_8))));
            if (certificates.isEmpty() || certificates.size() > MAX_CA_CERTIFICATES) {
                throw new IllegalArgumentException(
                    "profile origin CA bundle must contain 1-16 certificates");
            }
            for (Certificate certificate : certificates) {
                X509Certificate x509 = (X509Certificate) certificate;
                if (x509.getBasicConstraints() < 0) {
                    throw new IllegalArgumentException(
                        "profile origin CA bundle must contain CA certificates only");
                }
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException(
                "profile origin CA bundle is not a valid PEM certificate bundle", e);
        }
    }

    private static void validateCommands(List<String> commands, String field) {
        if (commands == null) {
            return;
        }
        if (commands.size() > 30) {
            throw new IllegalArgumentException("profile " + field + " has too many commands");
        }
        for (String command : commands) {
            if (command == null || command.isBlank() || command.length() > 1000
                || command.indexOf('\0') >= 0 || command.indexOf('\n') >= 0
                || command.indexOf('\r') >= 0) {
                throw new IllegalArgumentException(
                    "profile " + field + " contains an invalid command");
            }
        }
    }

    private static void validateExactHost(String host) {
        String normalized = host == null ? "" : host.trim().toLowerCase(Locale.ROOT);
        if (normalized.endsWith(".")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.isEmpty() || normalized.length() > 253
            || normalized.contains("*")
            || !normalized.matches("[a-z0-9.-]+")
            || normalized.matches("\\d{1,3}(\\.\\d{1,3}){3}")
            || normalized.contains(":")) {
            throw new IllegalArgumentException("profile origin CA host is invalid: " + host);
        }
        if (normalized.equals("localhost") || normalized.endsWith(".localhost")
            || normalized.equals("metadata") || normalized.equals("metadata.google.internal")
            || normalized.endsWith(".local") || normalized.endsWith(".internal")
            || normalized.endsWith(".home.arpa")
            || normalized.equals("host.docker.internal")
            || normalized.equals("gateway.docker.internal")) {
            throw new IllegalArgumentException(
                "profile origin CA host must not be internal or metadata: " + host);
        }
    }
}
