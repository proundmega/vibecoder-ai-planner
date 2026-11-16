package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RepoProfileTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static RepoProfile parse(String json) throws Exception {
        RepoProfile profile = MAPPER.readValue(json, RepoProfile.class);
        profile.validate();
        return profile;
    }

    @Test
    void parsesAndValidatesAV1Profile() throws Exception {
        RepoProfile profile = parse("""
            {
              "schema_version": 1,
              "repo_url": "https://github.com/acme/app",
              "base_branch": "develop",
              "languages": ["node"],
              "image": "node@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              "setup": ["npm ci"],
              "verify": ["npm test"],
              "caches": ["npm"],
              "env": {"NODE_ENV": "test"},
              "timeouts": {"setup_minutes": 5, "verify_minutes": 6},
              "max_round_minutes": 30
            }
            """);

        assertEquals("https://github.com/acme/app", profile.repoUrl());
        assertEquals("develop", profile.baseBranch());
        assertEquals("node@sha256:" + "a".repeat(64), profile.image());
        assertEquals(Map.of("NODE_ENV", "test", "NPM_CONFIG_CACHE", "/cache/npm"),
            profile.environment());
        assertEquals("vibecode-repo-cache-42-7", profile.cacheVolumeName("42", 7));
    }

    @Test
    void rejectsAnUnpinnedImage() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> parse("""
                {"schema_version":1,"verify":["npm test"],"image":"node:24"}
                """));
        assertTrue(error.getMessage().contains("digest"));
    }

    @Test
    void rejectsASecretEnvKeyOrValue() {
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"env":{"GITHUB_TOKEN":"x"}}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"env":{"NODE_ENV":"https://u:p@host"}}
            """));
    }

    @Test
    void rejectsAnEmptyVerifyListAndUnknownCaches() {
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":[]}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"caches":["bun"]}
            """));
    }

    @Test
    void rejectsUnsafeBaseBranchNames() {
        for (String branch : new String[]{"-main", "feature//x", "feature/", "main..x", "main."}) {
            assertThrows(IllegalArgumentException.class, () -> parse("""
                {"schema_version":1,"verify":["npm test"],"base_branch":"%s"}
                """.formatted(branch)));
        }
    }

    @Test
    void rejectsUnknownFieldsAndUnimplementedServicesFlakyTests() {
        assertThrows(Exception.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"unknown_field":true}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{"name":"postgres"}]}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"flaky_tests":["test/flake.js"]}
            """));
    }

    @Test
    void rejectsInvalidEgressHosts() {
        String ca = caBase64();
        for (String host : new String[]{"*.example.com", "localhost", "10.0.0.1"}) {
            assertThrows(IllegalArgumentException.class, () -> parse("""
                {"schema_version":1,"verify":["npm test"],"egress":{
                  "tls_mode":"terminate","origin_ca_hosts":["%s"],"origin_ca_b64":"%s"}}
                """.formatted(host, ca)));
        }
    }

    @Test
    void rejectsLeafCertificatesAndPrivateKeys() throws Exception {
        String leaf = Base64.getEncoder().encodeToString(
            Files.readAllBytes(Path.of("src/test/resources/egress-origin-leaf.pem")));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","origin_ca_hosts":["registry.example.com"],
              "origin_ca_b64":"%s"}}
            """.formatted(leaf)));

        String privateKey = Base64.getEncoder().encodeToString(
            "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","origin_ca_hosts":["registry.example.com"],
              "origin_ca_b64":"%s"}}
            """.formatted(privateKey)));
    }

    @Test
    void acceptsAValidCaBundle() throws Exception {
        RepoProfile profile = parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","origin_ca_hosts":["registry.example.com."],
              "origin_ca_b64":"%s"}}
            """.formatted(caBase64()));

        assertEquals(java.util.List.of("registry.example.com"),
            profile.egress().originCaHosts());
        assertTrue(profile.egress().originCaPem().contains("BEGIN CERTIFICATE"));
    }

    private static String caBase64() {
        try {
            return Base64.getEncoder().encodeToString(
                Files.readAllBytes(Path.of("src/test/resources/egress-origin-ca.pem")));
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
