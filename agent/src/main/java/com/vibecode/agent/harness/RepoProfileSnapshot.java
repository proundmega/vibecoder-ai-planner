package com.vibecode.agent.harness;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/** Active repo profile plus its immutable backend revision metadata. */
@JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY,
    getterVisibility = JsonAutoDetect.Visibility.NONE,
    isGetterVisibility = JsonAutoDetect.Visibility.NONE,
    setterVisibility = JsonAutoDetect.Visibility.NONE)
@JsonIgnoreProperties(ignoreUnknown = true)
public class RepoProfileSnapshot {

    private String id;
    private int version;
    private String status;
    private RepoProfile profile;

    public String id() {
        return id;
    }

    public int version() {
        return version;
    }

    public String status() {
        return status;
    }

    public RepoProfile profile() {
        return profile;
    }

    public void validate() {
        if (profile == null) {
            throw new IllegalArgumentException("repo profile response has no profile body");
        }
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("repo profile response has no id");
        }
        if (version <= 0) {
            throw new IllegalArgumentException("repo profile response has an invalid version");
        }
        profile.validate();
    }
}
