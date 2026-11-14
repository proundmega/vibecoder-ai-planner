package com.vibecode.agent;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.harness.HarnessTicketProcessor;
import com.vibecode.agent.service.ApiService;
import com.vibecode.agent.service.GitHubService;
import com.vibecode.agent.service.GitHubTokenProvider;
import com.vibecode.agent.service.TicketProcessor;
import com.vibecode.agent.service.TicketWorker;
import com.vibecode.agent.service.WorkspaceManager;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.function.Function;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * fg-35: AgentApp must build its GitHub clients from the provider object so
 * refresh() reaches GitHubTokenProvider instead of the interface default.
 */
class AgentAppWiringTest {

    private static Object field(Object target, String name) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return field.get(target);
    }

    @SuppressWarnings("unchecked")
    private static WorkspaceManager workspaceFor(TicketWorker worker) throws Exception {
        if (worker instanceof TicketProcessor) {
            return (WorkspaceManager) field(worker, "workspaceManager");
        }
        assertTrue(worker instanceof HarnessTicketProcessor,
            "unexpected ticket worker: " + worker.getClass());
        Function<String, WorkspaceManager> factory =
            (Function<String, WorkspaceManager>) field(worker, "workspaceFactory");
        return factory.apply("wiring-test");
    }

    @Test
    void buildsClientsFromTheProviderObject() throws Exception {
        AgentConfig config = new AgentConfig();
        ApiService apiService = new ApiService(config);
        GitHubTokenProvider provider = new GitHubTokenProvider(
            force -> Map.of("token", "ghs_wiring", "mode", "app"));

        AgentApp.GitHubWiring wiring = AgentApp.createGitHubWiring(
            config, apiService, null, null, provider, "ghs_wiring",
            config.getHarnessConfig());

        assertSame(provider, field(wiring.gitHubService(), "tokenSource"),
            "GitHubService must hold the provider object");
        WorkspaceManager workspace = workspaceFor(wiring.ticketWorker());
        assertSame(provider, field(workspace, "tokenSource"),
            "the workspace must hold the provider object");
    }
}
