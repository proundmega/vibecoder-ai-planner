package com.vibecode.agent.harness;

import java.util.Map;

/**
 * One ephemeral service container started for a repo profile (fg-39 slice 2).
 *
 * <p>The connection URL is a template; the runner substitutes the generated
 * password and Docker service name at runtime. The generated password is never
 * stored in the profile or logged.</p>
 */
public record ServiceSpec(
    String name,
    String image,
    Map<String, String> env,
    String passwordEnv,
    String connectionEnv,
    String connectionUrl,
    Healthcheck healthcheck
) {

    public ServiceSpec {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Service name is required");
        }
        if (image == null || image.isBlank()) {
            throw new IllegalArgumentException("Service image is required: " + name);
        }
        env = env == null ? Map.of() : Map.copyOf(env);
        passwordEnv = passwordEnv == null || passwordEnv.isBlank() ? null : passwordEnv;
        if (connectionEnv == null || connectionEnv.isBlank()) {
            throw new IllegalArgumentException("Service connection_env is required: " + name);
        }
        if (connectionUrl == null || connectionUrl.isBlank()) {
            throw new IllegalArgumentException("Service connection_url is required: " + name);
        }
        if (healthcheck == null) {
            throw new IllegalArgumentException("Service healthcheck is required: " + name);
        }
    }

    public record Healthcheck(
        String command,
        int intervalSeconds,
        int timeoutSeconds,
        int retries,
        int startPeriodSeconds
    ) {
        public Healthcheck {
            if (command == null || command.isBlank()) {
                throw new IllegalArgumentException("Service healthcheck command is required");
            }
        }
    }
}
