package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

/**
 * Configuration for the disposable sandbox that runs repo-controlled commands.
 *
 * <p>The default is {@link SandboxMode#HOST} so the Phase 1 harness keeps its
 * current behaviour. Host mode is not a security boundary and logs a warning;
 * {@code SANDBOX_REQUIRE=true} refuses to start unless Docker is selected.
 * A Docker failure never falls back to host execution.</p>
 */
public record SandboxConfig(
    SandboxMode mode,
    String image,
    String proxyImage,
    String dockerBinary,
    Duration execTimeout,
    Limits limits,
    Duration diskCheckInterval,
    boolean networkEnabled,
    List<String> allowedHosts,
    String egressProxy,
    String egressUpstreamNetwork,
    long egressProbeTimeoutMs,
    Map<String, String> runEnv,
    String user,
    boolean requireSandbox,
    boolean allowRoot,
    String seccompProfile,
    String apparmorProfile,
    long artifactMaxBytes,
    String containerWorkspaceRoot,
    String hostWorkspaceRoot
) {

    public static final String DEFAULT_IMAGE = "vibecode-agent-sandbox:latest";
    public static final String DEFAULT_PROXY_IMAGE = "vibecode-sandbox-proxy:latest";
    public static final String DEFAULT_DOCKER_BINARY = "docker";
    public static final String DEFAULT_USER = "1000:1000";
    public static final String DEFAULT_CONTAINER_WORKSPACE_ROOT = "/repos";
    public static final String DEFAULT_EGRESS_UPSTREAM_NETWORK = "bridge";
    public static final String NETWORK_NONE = "none";
    public static final String NETWORK_ALLOWLIST = "allowlist";
    public static final Duration DEFAULT_EXEC_TIMEOUT = Duration.ofMinutes(15);
    public static final Duration DEFAULT_DISK_CHECK_INTERVAL = Duration.ofSeconds(10);
    public static final long DEFAULT_ARTIFACT_MAX_BYTES = 5L * 1024 * 1024;

    /** Resource limits applied to one sandbox. */
    public record Limits(
        String cpus,
        long memoryBytes,
        int pids,
        long diskBytes,
        boolean diskEnforced,
        int openFiles,
        long tmpfsBytes
    ) {
    }

    public static SandboxConfig fromEnvironment() {
        return from(System::getenv);
    }

    /** Conservative defaults with no environment lookup. */
    public static SandboxConfig defaults() {
        return from(name -> null);
    }

    public static SandboxConfig from(Function<String, String> env) {
        SandboxMode mode = SandboxMode.from(value(env, "SANDBOX_MODE", "host"));

        Limits limits = new Limits(
            value(env, "SANDBOX_CPUS", "2.0"),
            mbToBytes(longValue(env, "SANDBOX_MEMORY_MB", 2048L, 1L)),
            (int) longValue(env, "SANDBOX_PIDS", 512L, 1L),
            mbToBytes(longValue(env, "SANDBOX_DISK_MB", 5120L, 0L)),
            booleanValue(env, "SANDBOX_DISK_ENFORCE", false),
            (int) longValue(env, "SANDBOX_NOFILE", 1024L, 1L),
            mbToBytes(longValue(env, "SANDBOX_TMPFS_MB", 256L, 1L))
        );

        String network = normalize(value(env, "SANDBOX_NETWORK", NETWORK_NONE));
        if (!NETWORK_NONE.equals(network) && !NETWORK_ALLOWLIST.equals(network)) {
            throw new IllegalStateException(
                "SANDBOX_NETWORK must be one of: none, allowlist (got: " + network + ")");
        }
        boolean networkEnabled = NETWORK_ALLOWLIST.equals(network);

        String sandboxImage = value(env, "SANDBOX_IMAGE", DEFAULT_IMAGE);

        SandboxConfig config = new SandboxConfig(
            mode,
            sandboxImage,
            value(env, "SANDBOX_PROXY_IMAGE", DEFAULT_PROXY_IMAGE),
            value(env, "SANDBOX_DOCKER_BIN", DEFAULT_DOCKER_BINARY),
            Duration.ofSeconds(longValue(env, "SANDBOX_EXEC_TIMEOUT_SECONDS",
                DEFAULT_EXEC_TIMEOUT.toSeconds(), 1L)),
            limits,
            Duration.ofSeconds(longValue(env, "SANDBOX_DISK_CHECK_INTERVAL_SECONDS",
                DEFAULT_DISK_CHECK_INTERVAL.toSeconds(), 1L)),
            networkEnabled,
            normalizeHosts(value(env, "SANDBOX_ALLOWED_HOSTS", "")),
            value(env, "SANDBOX_EGRESS_PROXY", ""),
            value(env, "SANDBOX_EGRESS_UPSTREAM_NETWORK", DEFAULT_EGRESS_UPSTREAM_NETWORK),
            longValue(env, "SANDBOX_EGRESS_PROBE_TIMEOUT_MS", 5_000L, 100L),
            parseEnv(value(env, "SANDBOX_ENV", "")),
            value(env, "SANDBOX_USER", defaultUser()),
            booleanValue(env, "SANDBOX_REQUIRE", false),
            booleanValue(env, "SANDBOX_ALLOW_ROOT", false),
            blankToNull(value(env, "SANDBOX_SECCOMP_PROFILE", "")),
            blankToNull(value(env, "SANDBOX_APPARMOR_PROFILE", "")),
            longValue(env, "SANDBOX_ARTIFACT_MAX_BYTES", DEFAULT_ARTIFACT_MAX_BYTES, 1L),
            value(env, "SANDBOX_CONTAINER_WORKSPACE_ROOT", DEFAULT_CONTAINER_WORKSPACE_ROOT),
            value(env, "SANDBOX_HOST_WORKSPACE_ROOT", "")
        );
        config.validate();
        return config;
    }

    public boolean isHost() {
        return mode == SandboxMode.HOST;
    }

    public boolean isDocker() {
        return mode == SandboxMode.DOCKER;
    }

    public void validate() {
        if (mode == null) {
            throw new IllegalStateException("SANDBOX_MODE is required");
        }
        if (mode == SandboxMode.HOST && requireSandbox) {
            throw new IllegalStateException(
                "SANDBOX_REQUIRE=true requires SANDBOX_MODE=docker; "
                    + "host mode is not a security boundary");
        }
        if (mode == SandboxMode.DOCKER) {
            requireText(image, "SANDBOX_IMAGE");
            requireText(proxyImage, "SANDBOX_PROXY_IMAGE");
            requireText(dockerBinary, "SANDBOX_DOCKER_BIN");
        }

        validateLimits();
        validateUser();
        if (diskCheckInterval == null
            || diskCheckInterval.isNegative() || diskCheckInterval.isZero()) {
            throw new IllegalStateException(
                "SANDBOX_DISK_CHECK_INTERVAL_SECONDS must be positive");
        }
        try {
            SandboxSecurity.validateEnv(runEnv, "SANDBOX_ENV");
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(e.getMessage(), e);
        }

        if (networkEnabled) {
            if (mode == SandboxMode.HOST) {
                throw new IllegalStateException(
                    "SANDBOX_NETWORK=allowlist requires SANDBOX_MODE=docker; "
                        + "host mode is not a security boundary");
            }
            if (allowedHosts == null || allowedHosts.isEmpty()) {
                throw new IllegalStateException(
                    "SANDBOX_ALLOWED_HOSTS must list at least one host when "
                        + "SANDBOX_NETWORK=allowlist");
            }
            if (egressProxy != null && !egressProxy.isBlank()) {
                // The built-in proxy runs inside the sandbox's internal network.
                // An arbitrary external proxy URL would reintroduce direct
                // egress without an enforceable boundary.
                throw new IllegalStateException(
                    "SANDBOX_EGRESS_PROXY is not supported with the built-in "
                        + "allowlist proxy; leave it empty");
            }
            requireText(egressUpstreamNetwork, "SANDBOX_EGRESS_UPSTREAM_NETWORK");
            if (!egressUpstreamNetwork.matches("[A-Za-z0-9_.-]+")) {
                throw new IllegalStateException(
                    "SANDBOX_EGRESS_UPSTREAM_NETWORK must be a Docker network name");
            }
        }

        requireText(containerWorkspaceRoot, "SANDBOX_CONTAINER_WORKSPACE_ROOT");
        if (!containerWorkspaceRoot.startsWith("/")
            || containerWorkspaceRoot.contains("..")) {
            throw new IllegalStateException(
                "SANDBOX_CONTAINER_WORKSPACE_ROOT must be an absolute, normalized path");
        }
        if (hostWorkspaceRoot != null && !hostWorkspaceRoot.isBlank()
            && !Path.of(hostWorkspaceRoot).isAbsolute()) {
            throw new IllegalStateException(
                "SANDBOX_HOST_WORKSPACE_ROOT must be an absolute path visible to the Docker daemon");
        }
        if (artifactMaxBytes <= 0) {
            throw new IllegalStateException("SANDBOX_ARTIFACT_MAX_BYTES must be positive");
        }
    }

    private void validateLimits() {
        if (limits == null) {
            throw new IllegalStateException("Sandbox limits are required");
        }
        try {
            double cpus = Double.parseDouble(limits.cpus());
            if (!Double.isFinite(cpus) || cpus <= 0) {
                throw new IllegalStateException("SANDBOX_CPUS must be a finite positive number");
            }
        } catch (NumberFormatException e) {
            throw new IllegalStateException("SANDBOX_CPUS must be a number");
        }
        requirePositive(limits.memoryBytes(), "SANDBOX_MEMORY_MB");
        requirePositive(limits.pids(), "SANDBOX_PIDS");
        requirePositive(limits.openFiles(), "SANDBOX_NOFILE");
        requirePositive(limits.tmpfsBytes(), "SANDBOX_TMPFS_MB");
        if (limits.diskBytes() < 0) {
            throw new IllegalStateException("SANDBOX_DISK_MB must not be negative");
        }
        if (limits.diskEnforced() && limits.diskBytes() <= 0) {
            throw new IllegalStateException(
                "SANDBOX_DISK_ENFORCE=true requires a positive SANDBOX_DISK_MB");
        }
    }

    private void validateUser() {
        if (user == null || user.isBlank()) {
            throw new IllegalStateException("SANDBOX_USER must not be blank");
        }
        String[] parts = user.split(":", -1);
        if (parts.length > 2) {
            throw new IllegalStateException("SANDBOX_USER must be uid or uid:gid");
        }
        long uid;
        try {
            uid = Long.parseLong(parts[0]);
            if (parts.length == 2 && !parts[1].isBlank()) {
                Long.parseLong(parts[1]);
            }
        } catch (NumberFormatException e) {
            throw new IllegalStateException("SANDBOX_USER must be uid or uid:gid");
        }
        if (uid == 0 && !allowRoot) {
            throw new IllegalStateException(
                "SANDBOX_USER resolves to root; set SANDBOX_USER to a non-root uid:gid "
                    + "or SANDBOX_ALLOW_ROOT=true (not recommended)");
        }
    }

    /**
     * Build a validated spec for one workspace.
     *
     * @throws IOException when the workspace is missing, is a symlink, or cannot
     *                     be mapped to the daemon-visible host path
     */
    public SandboxSpec specFor(Path workspace) throws IOException {
        validate();
        Path supervisorWorkspace = SandboxPaths.validateWorkspace(workspace);
        Path mountSource = mountSource(supervisorWorkspace);
        return new SandboxSpec(
            image,
            proxyImage,
            supervisorWorkspace,
            mountSource,
            execTimeout,
            limits,
            networkEnabled,
            allowedHosts,
            egressProxy,
            egressUpstreamNetwork,
            egressProbeTimeoutMs,
            withSafeDefaults(runEnv),
            user,
            seccompProfile,
            apparmorProfile,
            artifactMaxBytes
        );
    }

    /**
     * Translate the supervisor-local workspace path to the path the Docker
     * daemon must mount. A containerized agent needs this because bind mounts
     * are resolved on the host, not inside the agent container.
     */
    private Path mountSource(Path workspace) throws IOException {
        if (hostWorkspaceRoot == null || hostWorkspaceRoot.isBlank()) {
            return workspace;
        }
        Path containerRoot = Path.of(containerWorkspaceRoot).normalize();
        if (!workspace.startsWith(containerRoot)) {
            throw new IOException("Workspace " + workspace
                + " is outside SANDBOX_CONTAINER_WORKSPACE_ROOT " + containerRoot
                + "; cannot map it to SANDBOX_HOST_WORKSPACE_ROOT");
        }
        return Path.of(hostWorkspaceRoot).resolve(containerRoot.relativize(workspace)).normalize();
    }

    private static Map<String, String> withSafeDefaults(Map<String, String> configured) {
        Map<String, String> env = new LinkedHashMap<>(configured);
        env.putIfAbsent("CI", "1");
        env.putIfAbsent("GIT_CONFIG_NOSYSTEM", "1");
        env.putIfAbsent("GIT_CONFIG_GLOBAL", "/dev/null");
        env.putIfAbsent("GIT_TERMINAL_PROMPT", "0");
        env.putIfAbsent("HARNESS_VERIFICATION", "1");
        return Map.copyOf(env);
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must not be blank");
        }
    }

    private static void requirePositive(long value, String name) {
        if (value <= 0) {
            throw new IllegalStateException(name + " must be positive");
        }
    }

    private static long mbToBytes(long megabytes) {
        return megabytes * 1024L * 1024L;
    }

    private static List<String> normalizeHosts(String value) {
        if (value == null || value.isBlank()) {
            return List.of();
        }
        List<String> hosts = new ArrayList<>();
        for (String part : value.split("[;,]")) {
            String host = part.trim().toLowerCase(Locale.ROOT);
            if (host.isEmpty()) {
                continue;
            }
            validateHostPattern(host);
            hosts.add(host);
        }
        return List.copyOf(hosts);
    }

    private static void validateHostPattern(String pattern) {
        String host = pattern;
        if (host.startsWith("*.")) {
            host = host.substring(2);
            if (host.isEmpty() || !host.contains(".")) {
                throw new IllegalStateException(
                    "SANDBOX_ALLOWED_HOSTS wildcard must be *.domain.tld: " + pattern);
            }
        } else if (host.contains("*")) {
            throw new IllegalStateException(
                "SANDBOX_ALLOWED_HOSTS only supports a leading *.: " + pattern);
        }
        if (host.isEmpty() || host.length() > 253) {
            throw new IllegalStateException("SANDBOX_ALLOWED_HOSTS has an invalid host: " + pattern);
        }
        if (!host.matches("[a-z0-9.-]+")) {
            throw new IllegalStateException(
                "SANDBOX_ALLOWED_HOSTS has an invalid host: " + pattern);
        }
        if (isIpLiteral(host)) {
            throw new IllegalStateException(
                "SANDBOX_ALLOWED_HOSTS must list hostnames, not IP literals: " + pattern);
        }
        if (host.equals("localhost") || host.endsWith(".localhost")
            || host.equals("0.0.0.0") || host.equals("::") || host.equals("::1")
            || host.equals("metadata") || host.equals("metadata.google.internal")
            || host.endsWith(".local") || host.endsWith(".internal")
            || host.endsWith(".home.arpa")
            || host.equals("host.docker.internal")
            || host.equals("gateway.docker.internal")) {
            throw new IllegalStateException(
                "SANDBOX_ALLOWED_HOSTS must not allow internal or metadata hosts: " + pattern);
        }
    }

    private static boolean isIpLiteral(String host) {
        if (host.startsWith("[") && host.endsWith("]")) {
            return true;
        }
        if (host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) {
            return true;
        }
        // A bare IPv6 literal contains multiple colons; DNS names never do.
        return host.indexOf(':') >= 0;
    }

    private static Map<String, String> parseEnv(String value) {
        if (value == null || value.isBlank()) {
            return Map.of();
        }
        Map<String, String> env = new LinkedHashMap<>();
        for (String part : value.split(";")) {
            String entry = part.trim();
            if (entry.isEmpty()) {
                continue;
            }
            int equals = entry.indexOf('=');
            if (equals <= 0) {
                throw new IllegalStateException(
                    "SANDBOX_ENV entries must be KEY=VALUE (got: " + entry + ")");
            }
            env.put(entry.substring(0, equals).trim(), entry.substring(equals + 1));
        }
        return Map.copyOf(env);
    }

    private static String defaultUser() {
        try {
            String status = Files.readString(Path.of("/proc/self/status"));
            String uid = null;
            String gid = null;
            for (String line : status.lines().toList()) {
                if (line.startsWith("Uid:")) {
                    uid = line.trim().split("\\s+")[1];
                } else if (line.startsWith("Gid:")) {
                    gid = line.trim().split("\\s+")[1];
                }
            }
            if (uid != null && gid != null) {
                // Never default to root: a root supervisor gets a non-root
                // sandbox uid and fails closed at exec time if the workspace is
                // not writable by it.
                return "0".equals(uid) ? DEFAULT_USER : uid + ":" + gid;
            }
        } catch (IOException | RuntimeException ignored) {
            // Non-Linux or restricted /proc; fall back to a conventional uid.
        }
        return DEFAULT_USER;
    }

    private static String value(Function<String, String> env, String name, String fallback) {
        String value = env.apply(name);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static long longValue(
        Function<String, String> env,
        String name,
        long fallback,
        long minimum
    ) {
        String value = env.apply(name);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            long parsed = Long.parseLong(value.trim());
            if (parsed < minimum) {
                throw new IllegalStateException(name + " must be >= " + minimum);
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalStateException(name + " must be an integer >= " + minimum, e);
        }
    }

    private static boolean booleanValue(
        Function<String, String> env,
        String name,
        boolean fallback
    ) {
        String value = env.apply(name);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        return switch (value.trim().toLowerCase(Locale.ROOT)) {
            case "true", "1" -> true;
            case "false", "0" -> false;
            default -> throw new IllegalStateException(
                name + " must be one of: true, false, 1, 0 (got: " + value + ")");
        };
    }
}
