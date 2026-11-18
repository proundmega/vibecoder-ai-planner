package com.vibecode.agent.config;

import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RepoCoordinatesTest {

    private void assertParsed(String url, String owner, String name) {
        Optional<RepoCoordinates> parsed = RepoCoordinates.parse(url);
        assertTrue(parsed.isPresent(), url);
        assertEquals(owner, parsed.get().owner(), url);
        assertEquals(name, parsed.get().name(), url);
    }

    @Test
    void parsesHttpsAndGitSuffix() {
        assertParsed("https://github.com/acme/widgets", "acme", "widgets");
        assertParsed("https://github.com/acme/widgets.git", "acme", "widgets");
        assertParsed("https://github.com/acme/widgets/", "acme", "widgets");
    }

    @Test
    void parsesSshAndScpLikeUrls() {
        assertParsed("git@github.com:acme/widgets.git", "acme", "widgets");
        assertParsed("ssh://git@github.com/acme/widgets.git", "acme", "widgets");
        assertParsed("ssh://git@github.com:22/acme/widgets.git", "acme", "widgets");
    }

    @Test
    void keepsGitlabSubgroupsInTheOwner() {
        assertParsed("https://gitlab.com/group/sub/widgets.git", "group/sub", "widgets");
    }

    @Test
    void rejectsNonRepositoryValues() {
        assertTrue(RepoCoordinates.parse(null).isEmpty());
        assertTrue(RepoCoordinates.parse("").isEmpty());
        assertTrue(RepoCoordinates.parse("not-a-url").isEmpty());
        assertTrue(RepoCoordinates.parse("https://github.com/only-owner").isEmpty());
    }
}
