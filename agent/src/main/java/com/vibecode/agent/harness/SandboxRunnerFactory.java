package com.vibecode.agent.harness;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Creates the configured {@link SandboxRunner}.
 *
 * <p>Selection is explicit: host mode is the compatibility default but logs a
 * loud warning, and a Docker configuration never silently degrades to host
 * execution.</p>
 */
public final class SandboxRunnerFactory {

    private static final Logger log = LoggerFactory.getLogger(SandboxRunnerFactory.class);

    private SandboxRunnerFactory() {
    }

    public static SandboxRunner create(SandboxConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("Sandbox config is required");
        }
        config.validate();
        if (config.isHost()) {
            log.warn("SANDBOX_MODE=host: repo code runs on the supervisor filesystem. "
                + "This is not a security boundary; use SANDBOX_MODE=docker for untrusted repos.");
            return new HostSandboxRunner();
        }
        log.info("Sandbox mode: docker (image {}, network {})",
            config.image(), config.networkEnabled() ? "allowlist" : "none");
        return new DockerSandboxRunner(config);
    }

    /** Host-only runner for the legacy/test path; never logs a production warning. */
    public static SandboxRunner hostOnly() {
        return new HostSandboxRunner();
    }
}
