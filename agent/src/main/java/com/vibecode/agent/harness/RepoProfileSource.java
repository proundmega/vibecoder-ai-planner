package com.vibecode.agent.harness;

import java.io.IOException;

/** Test seam for fetching the active repo profile. */
@FunctionalInterface
public interface RepoProfileSource {
    /**
     * @return the active profile, or {@code null} when the project has none
     * @throws IOException for a transient backend failure (fallback allowed)
     * @throws IllegalArgumentException for invalid profile configuration
     */
    RepoProfileSnapshot fetch() throws IOException;
}
