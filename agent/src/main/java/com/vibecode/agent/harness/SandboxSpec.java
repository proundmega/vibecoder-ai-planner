package com.vibecode.agent.harness;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Immutable description of one disposable sandbox.
 *
 * @param workspace       supervisor-local workspace path
 * @param mountSource     path the Docker daemon must bind-mount (equals
 *                        {@code workspace} unless a host-path mapping is set)
 */
public record SandboxSpec(
    String image,
    String proxyImage,
    Path workspace,
    Path mountSource,
    Duration maxDuration,
    SandboxConfig.Limits limits,
    boolean networkEnabled,
    List<String> allowedHosts,
    String egressProxy,
    String egressUpstreamNetwork,
    long egressProbeTimeoutMs,
    Map<String, String> env,
    String user,
    String seccompProfile,
    String apparmorProfile,
    long artifactMaxBytes
) {

    public SandboxSpec {
        if (image == null || image.isBlank()) {
            throw new IllegalArgumentException("Sandbox image must not be blank");
        }
        proxyImage = proxyImage == null || proxyImage.isBlank() ? image : proxyImage;
        if (workspace == null) {
            throw new IllegalArgumentException("Sandbox workspace is required");
        }
        mountSource = mountSource == null ? workspace : mountSource;
        maxDuration = maxDuration == null ? SandboxConfig.DEFAULT_EXEC_TIMEOUT : maxDuration;
        if (limits == null) {
            throw new IllegalArgumentException("Sandbox limits are required");
        }
        allowedHosts = allowedHosts == null ? List.of() : List.copyOf(allowedHosts);
        egressProxy = egressProxy == null ? "" : egressProxy;
        egressUpstreamNetwork = egressUpstreamNetwork == null || egressUpstreamNetwork.isBlank()
            ? SandboxConfig.DEFAULT_EGRESS_UPSTREAM_NETWORK
            : egressUpstreamNetwork;
        if (egressProbeTimeoutMs <= 0) {
            egressProbeTimeoutMs = 5_000L;
        }
        env = env == null ? Map.of() : Map.copyOf(env);
        user = user == null || user.isBlank() ? SandboxConfig.DEFAULT_USER : user;
        seccompProfile = blankToNull(seccompProfile);
        apparmorProfile = blankToNull(apparmorProfile);
        if (artifactMaxBytes <= 0) {
            artifactMaxBytes = SandboxConfig.DEFAULT_ARTIFACT_MAX_BYTES;
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
