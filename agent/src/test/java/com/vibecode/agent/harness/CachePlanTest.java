package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CachePlanTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TempDir
    Path temp;

    private RepoProfile profile(String... caches) throws Exception {
        String json = """
            {"schema_version":1,"repo_url":"https://github.com/acme/app",
             "verify":["npm test"],"caches":[%s]}
            """.formatted(String.join(",",
                java.util.Arrays.stream(caches).map((c) -> "\"" + c + "\"").toList()));
        RepoProfile profile = MAPPER.readValue(json, RepoProfile.class);
        profile.validate();
        return profile;
    }

    private Path repo() throws IOException {
        Path repo = Files.createDirectories(temp.resolve("repo"));
        Files.writeString(repo.resolve("package-lock.json"), "{\"lockfileVersion\":3}");
        return repo;
    }

    @Test
    void preparesProjectScopedCachesWithEnvironment() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");

        CachePlan.Prepared prepared = CachePlan.prepare(
            profile("npm"), "42", 7, repo, cacheRoot);

        assertEquals(1, prepared.mounts().size());
        CachePlan.Mount mount = prepared.mounts().get(0);
        assertEquals("npm", mount.kind());
        assertEquals("/cache/npm", mount.target());
        assertEquals("/cache/npm", mount.env().get("NPM_CONFIG_CACHE"));
        assertTrue(Files.isDirectory(mount.source()));
        assertTrue(mount.source().startsWith(cacheRoot.resolve("projects")));

        CachePlan.Prepared other = CachePlan.prepare(
            profile("npm"), "43", 7, repo, cacheRoot);
        assertNotEquals(mount.source(), other.mounts().get(0).source());
    }

    @Test
    void changesGenerationWhenTheLockfileChanges() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");

        Path first = CachePlan.prepare(profile("npm"), "42", 7, repo, cacheRoot)
            .mounts().get(0).source();
        Files.writeString(repo.resolve("package-lock.json"), "{\"lockfileVersion\":2}");
        Path second = CachePlan.prepare(profile("npm"), "42", 7, repo, cacheRoot)
            .mounts().get(0).source();

        assertNotEquals(first, second);
    }

    @Test
    void evictsOldGenerationsAndSanitizesReusableCache() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");
        CachePlan.Prepared prepared = CachePlan.prepare(
            profile("npm", "pip"), "42", 7, repo, cacheRoot);
        Path generation = prepared.mounts().get(0).source().getParent();
        Path projectRoot = generation.getParent();

        Files.createSymbolicLink(generation.resolve("npm").resolve("escape"),
            Path.of("/etc/passwd"));
        Files.writeString(generation.resolve("npm").resolve(".npmrc"), "token=secret");
        Files.createDirectories(projectRoot.resolve("old"));
        Files.write(projectRoot.resolve("old").resolve("blob"), new byte[4096]);
        Files.setLastModifiedTime(projectRoot.resolve("old"),
            java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - Duration.ofDays(30).toMillis()));

        CachePlan.Prepared again = CachePlan.prepare(
            profile("npm", "pip"), "42", 7, repo, cacheRoot);

        assertEquals(2, again.mounts().size());
        assertFalse(Files.exists(generation.resolve("npm").resolve("escape")));
        assertFalse(Files.exists(generation.resolve("npm").resolve(".npmrc")));
        assertFalse(Files.exists(projectRoot.resolve("old")));
    }

    @Test
    void skipsCachesWhenTheCurrentGenerationExceedsTheQuota() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");
        CachePlan.Prepared prepared = CachePlan.prepare(
            profile("npm"), "42", 7, repo, cacheRoot, 1024, Duration.ofDays(14));
        Path npm = prepared.mounts().get(0).source();
        Files.write(npm.resolve("too-big"), new byte[4096]);

        CachePlan.Prepared skipped = CachePlan.prepare(
            profile("npm"), "42", 7, repo, cacheRoot, 1024, Duration.ofDays(14));

        assertTrue(skipped.mounts().isEmpty());
        assertTrue(skipped.skippedReason().contains("exceeds"));
        assertFalse(Files.exists(npm));
    }

    @Test
    void rejectsUnsupportedCacheKinds() {
        assertThrows(IOException.class, () -> CachePlan.prepare(
            List.of("unknown"), "https://github.com/acme/app", "42", 7,
            repo(), temp.resolve("cache"), 1024, Duration.ofDays(14)));
    }
}
