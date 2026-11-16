package com.vibecode.agent.harness;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/** A claimed or finished repo-profile dry run. */
@JsonAutoDetect(fieldVisibility = JsonAutoDetect.Visibility.ANY,
    getterVisibility = JsonAutoDetect.Visibility.NONE,
    isGetterVisibility = JsonAutoDetect.Visibility.NONE,
    setterVisibility = JsonAutoDetect.Visibility.NONE)
@JsonIgnoreProperties(ignoreUnknown = true)
public class RepoProfileValidation {

    private String id;
    @JsonProperty("profile_id")
    private String profileId;
    @JsonProperty("profile_version")
    private int profileVersion;
    private String status;
    private RepoProfile profile;

    public String id() {
        return id;
    }

    public String profileId() {
        return profileId;
    }

    public int profileVersion() {
        return profileVersion;
    }

    public String status() {
        return status;
    }

    public RepoProfile profile() {
        return profile;
    }

    public void validateProfile() {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("repo profile validation has no id");
        }
        if (profile == null) {
            throw new IllegalArgumentException("repo profile validation has no profile body");
        }
        if (profileVersion <= 0) {
            throw new IllegalArgumentException("repo profile validation has an invalid version");
        }
        profile.validate();
    }
}
