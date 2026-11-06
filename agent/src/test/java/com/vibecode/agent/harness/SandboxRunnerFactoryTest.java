package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SandboxRunnerFactoryTest {

    @Test
    void hostModeReturnsTheHostRunner() {
        SandboxRunner runner = SandboxRunnerFactory.create(SandboxConfig.defaults());
        assertInstanceOf(HostSandboxRunner.class, runner);
    }

    @Test
    void dockerModeReturnsTheDockerRunner() {
        SandboxConfig config = SandboxConfig.from(Map.of(
            "SANDBOX_MODE", "docker",
            "SANDBOX_IMAGE", "test:img",
            "SANDBOX_USER", "1000:1000"
        )::get);

        SandboxRunner runner = SandboxRunnerFactory.create(config);
        assertInstanceOf(DockerSandboxRunner.class, runner);
    }

    @Test
    void productionGuardRefusesHostModeAtConfigLoad() {
        IllegalStateException error = assertThrows(IllegalStateException.class,
            () -> SandboxConfig.from(Map.of(
                "SANDBOX_REQUIRE", "true",
                "SANDBOX_USER", "1000:1000"
            )::get));

        assertTrue(error.getMessage().contains("SANDBOX_REQUIRE"));
    }

    @Test
    void hostOnlyReturnsTheCompatibilityRunner() {
        assertInstanceOf(HostSandboxRunner.class, SandboxRunnerFactory.hostOnly());
    }
}
