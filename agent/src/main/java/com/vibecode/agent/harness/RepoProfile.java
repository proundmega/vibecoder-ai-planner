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
import java.util.Set;
import java.util.regex.Matcher;
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
    private static final Pattern ENV_REFERENCE = Pattern.compile(
        "^\\$(?:\\{[A-Za-z_][A-Za-z0-9_]*\\}|[A-Za-z_][A-Za-z0-9_]*)$");
    private static final Pattern ASSIGNMENT = Pattern.compile(
        "(?:^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\\s*(?::|=(?!=))\\s*"
            + "(?:\"([^\"]*)\"|'([^']*)'|([^\\s;&|)`\"']+))");
    private static final Pattern SECRET_FLAG = Pattern.compile(
        "(?i)(?:^|\\s)--?(?:password|passwd|pwd|token|secret|api[_-]?key|passphrase)"
            + "(?:=|\\s+)(?:\"([^\"]*)\"|'([^']*)'|([^\\s;&|]+))");
    private static final Pattern MYSQL_PASSWORD = Pattern.compile(
        "(?i:(?:mysql|mariadb|mysqladmin|mysqldump|mariadb-admin|mariadb-dump))"
            + "\\b[^\\n;&|]*?\\s-p(?:\\s*=\\s*|\\s*)"
            + "(?:\"([^\"]*)\"|'([^']*)'|([^\\s;&|]+))");
    private static final Pattern REDIS_PASSWORD = Pattern.compile(
        "(?i:redis-cli)\\b[^\\n;&|]*?\\s-a(?:\\s*=\\s*|\\s*)"
            + "(?:\"([^\"]*)\"|'([^']*)'|([^\\s;&|]+))");
    private static final Pattern REDISCLI_AUTH = Pattern.compile(
        "(?i:REDISCLI_AUTH)\\b\\s*[:=]\\s*"
            + "(?:\"([^\"]*)\"|'([^']*)'|([^\\s;&|]+))");
    private static final Pattern CREDENTIAL_LIKE_ANY = Pattern.compile("(?i)[a-f0-9]{32,}");
    private static final Pattern URL_PARTS = Pattern.compile(
        "^(?<scheme>[A-Za-z][A-Za-z0-9+.-]*)://(?:(?<userinfo>[^/@]*)@)?"
            + "(?<host>[^/?#]+)(?<path>/[^?#]*)?(?:\\?(?<query>[^#]*))?"
            + "(?:#(?<fragment>.*))?$");
    private static final Pattern PATH_ASSIGNMENT = Pattern.compile(
        "^([A-Za-z_][A-Za-z0-9_]*)\\s*[:=]\\s*(.+)$");
    private static final Pattern CREDENTIAL_LIKE = Pattern.compile("(?i)^[a-f0-9]{32,}$");
    private static final List<Pattern> SECRET_VALUES = List.of(
        Pattern.compile("-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"),
        Pattern.compile("\\bAKIA[0-9A-Z]{16}\\b"),
        Pattern.compile("\\bASIA[0-9A-Z]{16}\\b"),
        Pattern.compile("\\bgh[pousr]_[A-Za-z0-9]{20,}\\b"),
        Pattern.compile("\\bgithub_pat_[A-Za-z0-9_]{20,}\\b"),
        Pattern.compile("\\bxox[abcdepr]-[A-Za-z0-9-]{10,}\\b"),
        Pattern.compile("(?i)[a-z][a-z0-9+.-]*://[^\\s/@]+:(?!\\$\\{password\\})[^\\s/@]+@"),
        Pattern.compile("(?i)\\b(Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]{20,}")
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
    private List<Service> services = List.of();
    @JsonProperty("flaky_tests")
    private List<String> flakyTests = List.of();
    @JsonProperty("flaky_retries")
    private int flakyRetries = 2;
    @JsonProperty("test_data")
    private TestData testData = new TestData();
    private Egress egress;

    @JsonIgnoreProperties(ignoreUnknown = false)
    public static class TestData {
        @JsonProperty("setup")
        private List<String> setup = List.of();
        @JsonProperty("cleanup")
        private List<String> cleanup = List.of();

        public List<String> setup() {
            return setup == null ? List.of() : List.copyOf(setup);
        }

        public List<String> cleanup() {
            return cleanup == null ? List.of() : List.copyOf(cleanup);
        }
    }

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


    @JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY,
        getterVisibility = JsonAutoDetect.Visibility.NONE,
        isGetterVisibility = JsonAutoDetect.Visibility.NONE,
        setterVisibility = JsonAutoDetect.Visibility.NONE)
    @JsonIgnoreProperties(ignoreUnknown = false)
    public static class Service {
        private String name;
        private String image;
        private Map<String, String> env = Map.of();
        @JsonProperty("password_env")
        private String passwordEnv;
        @JsonProperty("connection_env")
        private String connectionEnv;
        @JsonProperty("connection_url")
        private String connectionUrl;
        private Healthcheck healthcheck;

        public String name() {
            return name;
        }

        public String image() {
            return image;
        }

        public Map<String, String> env() {
            return env == null ? Map.of() : Map.copyOf(env);
        }

        public String passwordEnv() {
            return passwordEnv == null || passwordEnv.isBlank() ? null : passwordEnv;
        }

        public String connectionEnv() {
            return connectionEnv;
        }

        public String connectionUrl() {
            return connectionUrl;
        }

        public Healthcheck healthcheck() {
            return healthcheck;
        }

        public ServiceSpec toSpec() {
            Healthcheck check = healthcheck();
            return new ServiceSpec(
                name(),
                image(),
                env(),
                passwordEnv(),
                connectionEnv(),
                connectionUrl(),
                new ServiceSpec.Healthcheck(
                    check.command(),
                    check.intervalSeconds(),
                    check.timeoutSeconds(),
                    check.retries(),
                    check.startPeriodSeconds()
                )
            );
        }
    }

    @JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY,
        getterVisibility = JsonAutoDetect.Visibility.NONE,
        isGetterVisibility = JsonAutoDetect.Visibility.NONE,
        setterVisibility = JsonAutoDetect.Visibility.NONE)
    @JsonIgnoreProperties(ignoreUnknown = false)
    public static class Healthcheck {
        private String command;
        @JsonProperty("interval_seconds")
        private int intervalSeconds = 2;
        @JsonProperty("timeout_seconds")
        private int timeoutSeconds = 5;
        private int retries = 30;
        @JsonProperty("start_period_seconds")
        private int startPeriodSeconds = 0;

        public String command() {
            return command;
        }

        public int intervalSeconds() {
            return intervalSeconds;
        }

        public int timeoutSeconds() {
            return timeoutSeconds;
        }

        public int retries() {
            return retries;
        }

        public int startPeriodSeconds() {
            return startPeriodSeconds;
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

    public List<Service> services() {
        return services == null ? List.of() : List.copyOf(services);
    }

    public List<String> flakyTests() {
        return flakyTests == null ? List.of() : List.copyOf(flakyTests);
    }

    public int flakyRetries() {
        return flakyRetries;
    }

    public TestData testData() {
        return testData == null ? new TestData() : testData;
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
        if (caches().size() > CachePlan.KINDS.size()) {
            throw new IllegalArgumentException("profile caches has too many entries");
        }
        Set<String> seenCaches = new LinkedHashSet<>();
        for (String cache : caches()) {
            if (cache == null || !CachePlan.KINDS.contains(cache)) {
                throw new IllegalArgumentException("profile cache is unsupported: " + cache);
            }
            if (!seenCaches.add(cache)) {
                throw new IllegalArgumentException("profile cache is duplicated: " + cache);
            }
        }
        for (Map.Entry<String, String> entry : env().entrySet()) {
            validateEnvEntry(entry.getKey(), entry.getValue(), "profile");
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
        validateServices();
        if (flakyTests().size() > 20) {
            throw new IllegalArgumentException("profile flaky_tests has too many entries");
        }
        for (String test : flakyTests()) {
            if (test == null || test.isBlank() || test.length() > 500
                || test.indexOf('\0') >= 0 || test.indexOf('\n') >= 0
                || test.indexOf('\r') >= 0) {
                throw new IllegalArgumentException("profile flaky_tests contains an invalid entry");
            }
        }
        if (flakyRetries < 0 || flakyRetries > 2) {
            throw new IllegalArgumentException("profile flaky_retries must be 0-2");
        }
        if (testData().setup().size() > 20 || testData().cleanup().size() > 20) {
            throw new IllegalArgumentException("profile test_data has too many commands");
        }
        validateCommands(testData().setup(), "test_data.setup");
        validateCommands(testData().cleanup(), "test_data.cleanup");
        validateEgress();
    }


    private void validateServices() {
        if (services().size() > 5) {
            throw new IllegalArgumentException("profile services must contain at most 5 entries");
        }
        Set<String> names = new LinkedHashSet<>();
        Set<String> connectionEnvs = new LinkedHashSet<>();
        for (Service service : services()) {
            if (service == null) {
                throw new IllegalArgumentException("profile service is null");
            }
            if (service.name() == null || !service.name().matches("[a-z][a-z0-9-]{0,30}")) {
                throw new IllegalArgumentException("profile service name is invalid: " + service.name());
            }
            if (!names.add(service.name())) {
                throw new IllegalArgumentException("profile service name is duplicated: " + service.name());
            }
            if (service.image() == null || !IMAGE.matcher(service.image()).matches()) {
                throw new IllegalArgumentException(
                    "profile service image must be pinned by digest: " + service.name());
            }
            for (Map.Entry<String, String> entry : service.env().entrySet()) {
                if (SandboxSecurity.isReservedEnv(entry.getKey())) {
                    throw new IllegalArgumentException(
                        "profile service " + service.name() + " env key is reserved: "
                            + entry.getKey());
                }
                validateEnvEntry(entry.getKey(), entry.getValue(), "service " + service.name());
            }
            String passwordEnv = service.passwordEnv();
            if (passwordEnv != null) {
                if (!ENV_KEY.matcher(passwordEnv).matches()) {
                    throw new IllegalArgumentException(
                        "profile service " + service.name() + " password_env is invalid");
                }
                if (SandboxSecurity.isReservedEnv(passwordEnv)) {
                    throw new IllegalArgumentException(
                        "profile service " + service.name() + " password_env is reserved");
                }
                if (service.env().containsKey(passwordEnv)) {
                    throw new IllegalArgumentException(
                        "profile service " + service.name() + " must not set password_env directly");
                }
                if (service.connectionUrl() == null
                    || !service.connectionUrl().contains("${password}")) {
                    throw new IllegalArgumentException(
                        "profile service " + service.name()
                            + " connection_url must include ${password}");
                }
            } else if (service.connectionUrl() != null
                && service.connectionUrl().contains("${password}")) {
                throw new IllegalArgumentException(
                    "profile service " + service.name()
                        + " uses ${password} without password_env");
            }
            if (service.connectionUrl() == null || !service.connectionUrl().contains("${host}")) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " connection_url must include ${host}");
            }
            Matcher placeholders = Pattern.compile("\\$\\{([^}]+)\\}")
                .matcher(service.connectionUrl());
            while (placeholders.find()) {
                String token = placeholders.group(1);
                if (!token.equals("host") && !token.equals("password")) {
                    throw new IllegalArgumentException(
                        "profile service " + service.name()
                            + " connection_url has unsupported placeholder ${" + token + "}");
                }
            }
            String urlIssue = connectionUrlIssue(service.connectionUrl(), passwordEnv);
            if (urlIssue != null) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " connection_url " + urlIssue);
            }
            if (service.connectionEnv() == null || !ENV_KEY.matcher(service.connectionEnv()).matches()) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " connection_env is invalid");
            }
            if (SandboxSecurity.isReservedEnv(service.connectionEnv())) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " connection_env is reserved");
            }
            if (SandboxSecurity.isSecretKey(service.connectionEnv())) {
                throw new IllegalArgumentException(
                    "profile service " + service.name()
                        + " connection_env must not look secret; use password_env");
            }
            if (env().containsKey(service.connectionEnv())) {
                throw new IllegalArgumentException(
                    "profile service connection_env conflicts with profile env: "
                        + service.connectionEnv());
            }
            if (!connectionEnvs.add(service.connectionEnv())) {
                throw new IllegalArgumentException(
                    "profile service connection_env is duplicated: " + service.connectionEnv());
            }
            Healthcheck healthcheck = service.healthcheck();
            if (healthcheck == null) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " healthcheck is required");
            }
            if (healthcheck.command() == null || healthcheck.command().isBlank()
                || healthcheck.command().length() > 500
                || healthcheck.command().indexOf('\0') >= 0
                || healthcheck.command().indexOf('\n') >= 0
                || healthcheck.command().indexOf('\r') >= 0) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " healthcheck command is invalid");
            }
            String healthIssue = commandIssue(healthcheck.command());
            if (healthIssue != null) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " healthcheck command " + healthIssue);
            }
            if (healthcheck.intervalSeconds() < 1 || healthcheck.intervalSeconds() > 60
                || healthcheck.timeoutSeconds() < 1 || healthcheck.timeoutSeconds() > 60
                || healthcheck.retries() < 1 || healthcheck.retries() > 120
                || healthcheck.startPeriodSeconds() < 0
                || healthcheck.startPeriodSeconds() > 120) {
                throw new IllegalArgumentException(
                    "profile service " + service.name() + " healthcheck bounds are invalid");
            }
        }
    }

    private static void validateEnvEntry(String key, String value, String source) {
        if (key == null || !ENV_KEY.matcher(key).matches()) {
            throw new IllegalArgumentException(source + " env key is invalid: " + key);
        }
        if (SandboxSecurity.isReservedEnv(key)) {
            throw new IllegalArgumentException(source + " env key is reserved: " + key);
        }
        if (SandboxSecurity.isSecretKey(key)) {
            throw new IllegalArgumentException(source + " env key looks secret: " + key);
        }
        String text = value == null ? "" : value;
        if (text.length() > 4000 || text.indexOf('\0') >= 0
            || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0) {
            throw new IllegalArgumentException(source + " env value is invalid: " + key);
        }
        if (containsSecretValue(text)) {
            throw new IllegalArgumentException(source + " env value looks like a credential: " + key);
        }
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
            String issue = commandIssue(command);
            if (issue != null) {
                throw new IllegalArgumentException(
                    "profile " + field + " command " + issue);
            }
        }
    }

    private static boolean isEnvReference(String value) {
        if (value == null) {
            return false;
        }
        String text = value.trim();
        if (text.length() >= 2
            && ((text.startsWith("\"") && text.endsWith("\""))
                || (text.startsWith("'") && text.endsWith("'")))) {
            text = text.substring(1, text.length() - 1).trim();
        }
        return ENV_REFERENCE.matcher(text).matches();
    }

    private static boolean containsSecretValue(String value) {
        String text = value == null ? "" : value;
        for (Pattern pattern : SECRET_VALUES) {
            if (pattern.matcher(text).find()) {
                return true;
            }
        }
        return false;
    }

    private static String commandIssue(String command) {
        String text = command == null ? "" : command;
        if (containsSecretValue(percentDecode(text))) {
            return "contains a literal credential";
        }
        Matcher assignment = ASSIGNMENT.matcher(text);
        while (assignment.find()) {
            String key = assignment.group(1);
            String value = assignment.group(2) != null
                ? assignment.group(2)
                : (assignment.group(3) != null ? assignment.group(3) : assignment.group(4));
            if (SandboxSecurity.isSecretKey(key) && !isEnvReference(value)) {
                return "assigns a literal credential to " + key;
            }
        }
        Matcher flag = SECRET_FLAG.matcher(text);
        while (flag.find()) {
            String value = flag.group(1) != null
                ? flag.group(1)
                : (flag.group(2) != null ? flag.group(2) : flag.group(3));
            if (!isEnvReference(value)) {
                return "passes a literal credential on the command line";
            }
        }
        for (Pattern pattern : List.of(MYSQL_PASSWORD, REDIS_PASSWORD, REDISCLI_AUTH)) {
            Matcher client = pattern.matcher(text);
            while (client.find()) {
                String value = client.group(1) != null
                    ? client.group(1)
                    : (client.group(2) != null ? client.group(2) : client.group(3));
                if (value.startsWith("-") || isEnvReference(value)) {
                    continue;
                }
                return "passes a literal client password on the command line";
            }
        }
        return null;
    }

    private static String connectionUrlIssue(String url, String passwordEnv) {
        String text = url == null ? "" : url;
        if (text.isEmpty() || text.length() > 1000
            || text.indexOf('\0') >= 0 || text.indexOf('\n') >= 0
            || text.indexOf('\r') >= 0) {
            return "is invalid";
        }
        String decodedText = percentDecode(text);
        if ((decodedText.contains("${host}") && !text.contains("${host}"))
            || (decodedText.contains("${password}") && !text.contains("${password}"))) {
            return "must use literal ${host}/${password} placeholders, not percent-encoded forms";
        }
        Matcher parts = URL_PARTS.matcher(text);
        if (!parts.matches()) {
            return "must be a valid URL";
        }
        String userinfo = parts.group("userinfo");
        if (userinfo != null && !userinfo.isEmpty()) {
            int colon = userinfo.indexOf(':');
            if (colon >= 0) {
                String password = percentDecode(userinfo.substring(colon + 1));
                if (!password.isEmpty()) {
                    if (passwordEnv == null) {
                        return "must not contain a literal password without password_env";
                    }
                    if (!password.equals("${password}")) {
                        return "must use ${password} in the userinfo, not a literal password";
                    }
                }
            }
        }
        if (containsSecretValue(decodedText)) {
            return "contains a literal credential";
        }
        String query = parts.group("query");
        if (query != null) {
            for (String pair : query.split("&")) {
                if (pair.isEmpty()) {
                    continue;
                }
                int equals = pair.indexOf('=');
                String name = percentDecode(equals >= 0 ? pair.substring(0, equals) : pair);
                String value = equals >= 0 ? percentDecode(pair.substring(equals + 1)) : "";
                if (SandboxSecurity.isSecretKey(name) && !value.equals("${password}")) {
                    return "query parameter " + name + " must use ${password}";
                }
                if (containsSecretValue(value) || CREDENTIAL_LIKE_ANY.matcher(value).find()) {
                    return "query parameter " + name + " contains a literal credential";
                }
            }
        }
        String path = parts.group("path");
        if (path != null) {
            for (String segment : path.split("/")) {
                String decoded = percentDecode(segment);
                if (containsSecretValue(decoded)) {
                    return "path contains a literal credential";
                }
                Matcher assignment = PATH_ASSIGNMENT.matcher(decoded);
                if (assignment.matches() && SandboxSecurity.isSecretKey(assignment.group(1))
                    && !assignment.group(2).equals("${password}")) {
                    return "path parameter " + assignment.group(1) + " must use ${password}";
                }
                if (CREDENTIAL_LIKE.matcher(decoded).matches()) {
                    return "path contains a credential-like value";
                }
            }
        }
        String fragment = parts.group("fragment");
        if (fragment != null) {
            String decoded = percentDecode(fragment);
            if (containsSecretValue(decoded) || CREDENTIAL_LIKE_ANY.matcher(decoded).find()) {
                return "fragment contains a literal credential";
            }
        }
        return null;
    }

    private static String percentDecode(String value) {
        String text = value == null ? "" : value;
        StringBuilder decoded = new StringBuilder(text.length());
        for (int index = 0; index < text.length(); index++) {
            char current = text.charAt(index);
            if (current == '%' && index + 2 < text.length()) {
                try {
                    int code = Integer.parseInt(text.substring(index + 1, index + 3), 16);
                    decoded.append((char) code);
                    index += 2;
                    continue;
                } catch (NumberFormatException ignored) {
                    // Keep the raw percent sign when it is not a valid escape.
                }
            }
            decoded.append(current);
        }
        return decoded.toString();
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
