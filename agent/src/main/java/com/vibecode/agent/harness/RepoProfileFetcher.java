package com.vibecode.agent.harness;

import com.vibecode.agent.config.AgentConfig;
import com.vibecode.agent.service.ApiService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

/**
 * Fetch the project's active repo profile. A missing profile or a transient
 * backend failure keeps the fg-30 autodetection path and logs a warning; an
 * invalid profile body fails closed in {@link RepoProfile#validate()}.
 */
public class RepoProfileFetcher implements RepoProfileSource {

    private static final Logger log = LoggerFactory.getLogger(RepoProfileFetcher.class);

    private final ApiService apiService;
    private final AgentConfig config;

    public RepoProfileFetcher(ApiService apiService, AgentConfig config) {
        this.apiService = apiService;
        this.config = config;
    }

    @Override
    public RepoProfileSnapshot fetch() throws IOException {
        String projectId = config.getProjectId();
        if (projectId == null || projectId.isBlank()) {
            return null;
        }
        RepoProfileSnapshot snapshot;
        try {
            snapshot = apiService.getRepoProfile(projectId);
        } catch (IOException e) {
            log.warn("Could not fetch repo profile for project {}; "
                + "using autodetection and verification defaults: {}", projectId, e.getMessage());
            return null;
        }
        if (snapshot == null) {
            log.warn("No active repo profile for project {}; using autodetection. "
                + "Create and activate an fg-39 profile for deterministic setup/verify commands.",
                projectId);
            return null;
        }
        snapshot.validate();
        log.info("Using repo profile {} version {} for project {} ({} setup, {} verify command(s))",
            snapshot.id(), snapshot.version(), projectId,
            snapshot.profile().setup().size(), snapshot.profile().verify().size());
        return snapshot;
    }
}
