package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
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
              "env": {"NODE_ENV": "test"},
              "timeouts": {"setup_minutes": 5, "verify_minutes": 6},
              "max_round_minutes": 30
            }
            """);

        assertEquals("https://github.com/acme/app", profile.repoUrl());
        assertEquals("develop", profile.baseBranch());
        assertEquals("node@sha256:" + "a".repeat(64), profile.image());
        assertEquals(Map.of("NODE_ENV", "test"), profile.environment());
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
            {"schema_version":1,"verify":["npm test"],"caches":["npm"]}
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
    void rejectsUnknownFieldsAndUnimplementedFlakyTests() {
        assertThrows(Exception.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"unknown_field":true}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"flaky_tests":["test/flake.js"]}
            """));
    }

    @Test
    void parsesAValidServiceDefinition() throws Exception {
        RepoProfile profile = parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres",
              "image":"postgres@sha256:%s",
              "env":{"POSTGRES_USER":"vibecode","POSTGRES_DB":"test"},
              "password_env":"POSTGRES_PASSWORD",
              "connection_env":"DATABASE_URL",
              "connection_url":"postgresql://vibecode:${password}@${host}:5432/test",
              "healthcheck":{"command":"pg_isready -U vibecode -d test",
                "interval_seconds":2,"timeout_seconds":5,"retries":30}
            }]}
            """.formatted("a".repeat(64)));

        assertEquals(1, profile.services().size());
        ServiceSpec spec = profile.services().get(0).toSpec();
        assertEquals("postgres", spec.name());
        assertEquals("DATABASE_URL", spec.connectionEnv());
        assertEquals(2, spec.healthcheck().intervalSeconds());
    }

    @Test
    void rejectsInvalidServiceDefinitions() {
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres",
              "image":"postgres:16",
              "connection_env":"DATABASE_URL",
              "connection_url":"postgresql://vibecode:${password}@${host}:5432/test",
              "healthcheck":{"command":"pg_isready"}
            }]}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres",
              "image":"postgres@sha256:%s",
              "connection_env":"DATABASE_URL",
              "connection_url":"postgresql://vibecode:secret@${host}:5432/test",
              "healthcheck":{"command":"pg_isready"}
            }]}
            """.formatted("a".repeat(64))));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres",
              "image":"postgres@sha256:%s",
              "password_env":"not a valid key",
              "connection_env":"DATABASE_URL",
              "connection_url":"postgresql://vibecode:${password}@${host}:5432/test",
              "healthcheck":{"command":"pg_isready"}
            }]}
            """.formatted("a".repeat(64))));
    }


    @Test
    void rejectsLiteralCredentialsAndReservedServiceNames() {
        String image = "postgres@sha256:" + "a".repeat(64);
        String base = """
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres","image":"%s",
              "env":{"POSTGRES_USER":"vibecode","POSTGRES_DB":"test"},
              "password_env":"POSTGRES_PASSWORD","connection_env":"DATABASE_URL",
              "connection_url":"%s",
              "healthcheck":{"command":"%s"}
            }]}
            """;
        for (String envKey : new String[]{"DB_PASS", "DB_PWD", "PGPASS", "DBPASS"}) {
            assertThrows(IllegalArgumentException.class, () -> parse("""
                {"schema_version":1,"verify":["npm test"],"services":[{
                  "name":"postgres","image":"%s",
                  "env":{"%s":"x"},"connection_env":"DATABASE_URL",
                  "connection_url":"postgresql://vibecode@${host}:5432/test",
                  "healthcheck":{"command":"pg_isready"}
                }]}
                """.formatted(image, envKey)));
        }
        String hex = "a".repeat(64);
        for (String url : new String[]{
            "postgresql://vibecode:hunter2@${host}:5432/test?token=${password}",
            "postgresql://vibecode:${password}@${host}:5432/test?password=hunter2",
            "postgresql://vibecode:${password}@${host}:5432/password=hunter2",
            "postgresql://vibecode:${password}@${host}:5432/" + hex,
            "postgresql://vibecode:${password}@${host}:5432/test?auth=" + hex,
            "postgresql://vibecode:${password}@${host}:5432/test?x=" + hex,
            "postgresql://vibecode:${password}@${host}:5432/test#x=" + hex,
            "postgresql://vibecode:%24%7Bpassword%7D@${host}:5432/test",
            "postgresql://vibecode:${password}@${host}:5432/test\\nEVIL=1",
        }) {
            assertThrows(IllegalArgumentException.class,
                () -> parse(base.formatted(image, url, "pg_isready")));
        }
        for (String command : new String[]{
            "mysql -uroot -psecret",
            "MYSQL -psecret",
            "mysql -u root -p hunter2",
            "mysqladmin -u root -psecret ping",
            "mysqldump -u root -psecret db",
            "redis-cli -a secret",
            "REDISCLI_AUTH=secret redis-cli ping",
        }) {
            assertThrows(IllegalArgumentException.class,
                () -> parse(base.formatted(image,
                    "postgresql://vibecode:${password}@${host}:5432/test", command)));
        }
        assertThrows(IllegalArgumentException.class,
            () -> parse(base.formatted(image,
                "postgresql://vibecode:${password}@${host}:5432/test",
                "PGPASSWORD=hunter2 pg_isready")));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres","image":"%s",
              "env":{"PATH":"/evil"},"connection_env":"DATABASE_URL",
              "connection_url":"postgresql://vibecode@${host}:5432/test",
              "healthcheck":{"command":"pg_isready"}
            }]}
            """.formatted(image)));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres","image":"%s",
              "connection_env":"DATABASE_PASSWORD",
              "connection_url":"postgresql://vibecode@${host}:5432/test",
              "healthcheck":{"command":"pg_isready"}
            }]}
            """.formatted(image)));
        assertDoesNotThrow(() -> parse(base.formatted(image,
            "postgresql://vibecode:${password}@${host}:5432/test",
            "mysql -P 3306 -h db -u root")));
        assertDoesNotThrow(() -> parse(base.formatted(image,
            "postgresql://vibecode:${password}@${host}:5432/test",
            "MYSQL -P 3306 -h db -u root")));
        assertDoesNotThrow(() -> parse(base.formatted(image,
            "postgresql://vibecode:${password}@${host}:5432/test",
            "mysql -p '$MYSQL_PWD' -h db -u root")));
        assertDoesNotThrow(() -> parse(base.formatted(image,
            "postgresql://vibecode:${password}@${host}:5432/test",
            "mysql -p -h db -u root")));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"services":[{
              "name":"postgres","image":"%s",
              "env":{"REDISCLI_AUTH":"secret","AUTHORIZATION":"secret",
              "AUTH":"secret"},"connection_env":"DATABASE_URL",
              "connection_url":"postgresql://vibecode@${host}:5432/test",
              "healthcheck":{"command":"pg_isready"}
            }]}
            """.formatted(image)));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"env":{"LD_PRELOAD":"/evil.so"}}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["PGPASSWORD=hunter2 psql -c 'select 1'"]}
            """));
        assertDoesNotThrow(() -> parse("""
            {"schema_version":1,
             "verify":["PGPASSWORD=$PGPASSWORD psql -c 'select 1'"]}
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
    void rejectsNonCanonicalBase64ForOriginCa() {
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","origin_ca_hosts":["registry.example.com"],
              "origin_ca_b64":"YWJj\\nZA=="}}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","origin_ca_hosts":["registry.example.com"],
              "origin_ca_b64":"YWJj-_=="}}
            """));
    }

    @Test
    void parsesMtlsOnlyEgress() throws Exception {
        RepoProfile profile = parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","mtls":{
                "credential_id":5,"hosts":["Registry.Example.com."]}}}
            """);

        assertEquals(5, profile.egress().mtls().credentialId());
        assertEquals(java.util.List.of("registry.example.com"),
            profile.egress().mtls().hosts());
    }

    @Test
    void rejectsInvalidMtlsEgress() {
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","mtls":{"credential_id":0,"hosts":["registry.example.com"]}}}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","mtls":{"credential_id":5,"hosts":[]}}}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{
              "tls_mode":"terminate","mtls":{"credential_id":5,"hosts":["*.example.com"]}}}
            """));
        assertThrows(IllegalArgumentException.class, () -> parse("""
            {"schema_version":1,"verify":["npm test"],"egress":{"tls_mode":"terminate"}}
            """));
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
