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
        Files.writeString(generation.resolve("npm").resolve(".env.local"), "SECRET=1");
        Files.writeString(generation.resolve("npm").resolve(".yarnrc.yml"), "token: x");
        Files.writeString(generation.resolve("gradle.properties"), "org.gradle.jvmargs=-Xmx1g");
        Files.writeString(generation.resolve("config.toml"), "[net]\ngit-fetch-with-cli = true");
        Files.writeString(generation.resolve("credentials.toml"), "[registry]\ntoken = \"x\"");
        Path initDir = Files.createDirectories(generation.resolve("init.d"));
        Files.writeString(initDir.resolve("evil.gradle"), "println 'x'");
        Files.createDirectories(projectRoot.resolve("old"));
        Files.write(projectRoot.resolve("old").resolve("blob"), new byte[4096]);
        Files.setLastModifiedTime(projectRoot.resolve("old"),
            java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis() - Duration.ofDays(30).toMillis()));

        CachePlan.Prepared again = CachePlan.prepare(
            profile("npm", "pip"), "42", 7, repo, cacheRoot);

        assertEquals(2, again.mounts().size());
        assertFalse(Files.exists(generation.resolve("npm").resolve("escape")));
        assertFalse(Files.exists(generation.resolve("npm").resolve(".npmrc")));
        assertFalse(Files.exists(generation.resolve("npm").resolve(".env.local")));
        assertFalse(Files.exists(generation.resolve("npm").resolve(".yarnrc.yml")));
        assertFalse(Files.exists(generation.resolve("gradle.properties")));
        assertFalse(Files.exists(generation.resolve("config.toml")));
        assertFalse(Files.exists(generation.resolve("credentials.toml")));
        assertFalse(Files.exists(generation.resolve("init.d")));
        assertFalse(Files.exists(projectRoot.resolve("old")));
    }

    @Test
    void changesGenerationForLargeLockfileTailChanges() throws Exception {
        Path repo = repo();
        int size = (int) (17L * 1024 * 1024);
        byte[] content = new byte[size];
        java.util.Arrays.fill(content, (byte) 'a');
        Files.write(repo.resolve("package-lock.json"), content);

        Path first = CachePlan.prepare(profile("npm"), "42", 7, repo, temp.resolve("cache"))
            .mounts().get(0).source();
        content[size - 1] = 'b';
        Files.write(repo.resolve("package-lock.json"), content);
        Path second = CachePlan.prepare(profile("npm"), "42", 7, repo, temp.resolve("cache"))
            .mounts().get(0).source();

        assertNotEquals(first, second);
    }

    @Test
    void evictsOldGenerationsByTotalQuota() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");
        CachePlan.Prepared prepared = CachePlan.prepare(
            profile("npm"), "42", 7, repo, cacheRoot, 2000, Duration.ofDays(14));
        Path projectRoot = prepared.mounts().get(0).source().getParent().getParent();
        for (int i = 0; i < 3; i++) {
            Path old = Files.createDirectories(projectRoot.resolve("old-" + i));
            Files.write(old.resolve("blob"), new byte[1500]);
            Files.setLastModifiedTime(old, java.nio.file.attribute.FileTime.fromMillis(
                System.currentTimeMillis() - (i + 1) * 60_000L));
        }

        CachePlan.Prepared again = CachePlan.prepare(
            profile("npm"), "42", 7, repo, cacheRoot, 2000, Duration.ofDays(14));

        assertEquals(1, again.mounts().size());
        long remaining = Files.list(projectRoot)
            .filter((path) -> path.getFileName().toString().startsWith("old-"))
            .count();
        assertTrue(remaining <= 1, "quota should evict old generations: " + remaining);
    }

    @Test
    void wiresEnvironmentForEveryCacheKind() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");
        assertEquals("/cache/npm",
            envFor("npm", repo, cacheRoot).get("NPM_CONFIG_CACHE"));
        assertEquals("/cache/pip",
            envFor("pip", repo, cacheRoot).get("PIP_CACHE_DIR"));
        assertTrue(envFor("maven", repo, cacheRoot).get("MAVEN_OPTS")
            .contains("-Dmaven.repo.local=/cache/maven"));
        assertEquals("/cache/go/mod", envFor("go", repo, cacheRoot).get("GOMODCACHE"));
        assertEquals("/cache/go/build", envFor("go", repo, cacheRoot).get("GOCACHE"));
        assertEquals("/tmp/.gradle", envFor("gradle", repo, cacheRoot).get("GRADLE_USER_HOME"));
        assertEquals("/tmp/.cargo", envFor("cargo", repo, cacheRoot).get("CARGO_HOME"));
    }

    private java.util.Map<String, String> envFor(String kind, Path repo, Path cacheRoot)
        throws Exception {
        java.util.Map<String, String> env = new java.util.HashMap<>();
        for (CachePlan.Mount mount : CachePlan.prepare(
            profile(kind), "42", 7, repo, cacheRoot).mounts()) {
            env.putAll(mount.env());
        }
        return env;
    }

    @Test
    void scrubsCommonCredentialAndConfigLocations() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");
        CachePlan.Prepared prepared = CachePlan.prepare(
            profile("npm"), "42", 7, repo, cacheRoot);
        Path generation = prepared.mounts().get(0).source().getParent();
        Files.writeString(generation.resolve(".pgpass"), "host:5432:db:user:pass");
        Files.writeString(generation.resolve(".authinfo"), "machine x login y password z");
        Files.writeString(generation.resolve(".gitconfig"), "[url \"x\"] insteadOf = y");
        Files.writeString(generation.resolve(".terraformrc"), "credentials \"x\" {}");
        Files.writeString(generation.resolve(".vault-token"), "token");
        Files.createDirectories(generation.resolve(".ssh"));
        Files.writeString(generation.resolve(".ssh").resolve("config"),
            "Host *\n  ProxyCommand evil");
        Files.createDirectories(generation.resolve(".kube"));
        Files.writeString(generation.resolve(".kube").resolve("config"), "token: x");
        Files.createDirectories(generation.resolve(".aws"));
        Files.writeString(generation.resolve(".aws").resolve("config"), "secret");
        Files.createDirectories(generation.resolve(".config").resolve("gh"));
        Files.writeString(generation.resolve(".config").resolve("gh").resolve("hosts.yml"),
            "oauth_token: x");
        Files.createDirectories(generation.resolve(".gnupg"));
        Files.writeString(generation.resolve(".gnupg").resolve("gpg.conf"), "x");

        CachePlan.prepare(profile("npm"), "42", 7, repo, cacheRoot);

        for (String name : new String[]{
            ".pgpass", ".authinfo", ".gitconfig", ".terraformrc", ".vault-token",
            ".ssh", ".kube", ".aws", ".config", ".gnupg"}) {
            assertFalse(Files.exists(generation.resolve(name)), name + " should be scrubbed");
        }
    }

    @Test
    void mountsOnlyGradleAndCargoCacheSubdirectories() throws Exception {
        Path repo = repo();
        Path cacheRoot = temp.resolve("cache");

        CachePlan.Prepared gradle = CachePlan.prepare(
            profile("gradle"), "42", 7, repo, cacheRoot);
        assertEquals(2, gradle.mounts().size());
        assertTrue(gradle.mounts().stream().allMatch(
            (mount) -> mount.target().startsWith("/tmp/.gradle/")));
        assertTrue(gradle.mounts().stream().allMatch(
            (mount) -> "/tmp/.gradle".equals(mount.env().get("GRADLE_USER_HOME"))));
        assertTrue(gradle.mounts().stream().noneMatch(
            (mount) -> mount.source().getFileName().toString().equals("gradle")));

        CachePlan.Prepared cargo = CachePlan.prepare(
            profile("cargo"), "42", 7, repo, cacheRoot);
        assertEquals(2, cargo.mounts().size());
        assertTrue(cargo.mounts().stream().allMatch(
            (mount) -> mount.target().startsWith("/tmp/.cargo/")));
        assertTrue(cargo.mounts().stream().allMatch(
            (mount) -> "/tmp/.cargo".equals(mount.env().get("CARGO_HOME"))));
    }

    @Test
    void mountsGoCacheAndEnvironment() throws Exception {
        CachePlan.Prepared go = CachePlan.prepare(
            profile("go"), "42", 7, repo(), temp.resolve("cache"));
        assertEquals(1, go.mounts().size());
        assertEquals("/cache/go", go.mounts().get(0).target());
        assertEquals("/cache/go/mod", go.mounts().get(0).env().get("GOMODCACHE"));
        assertEquals("/cache/go/build", go.mounts().get(0).env().get("GOCACHE"));
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
