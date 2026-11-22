package com.vibecode.agent.supervisor;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RuntimeConfigTest {

    @TempDir
    Path tempDir;

    private static final String VALID = """
        ; supervisor declarations — no secrets here
        # blank lines and both comment styles are allowed

        [runtime "workers"]
        role = worker
        model = acme/claude-sonnet
        count = 3
        effort = high

        [runtime "reviewers"]
        role = reviewer
        model = acme/claude-opus
        count = 2
        effort = max
        project = 42
        """;

    private static String single(String body) {
        return "[runtime \"workers\"]\n" + body;
    }

    private static String base(String extra) {
        return single("role = worker\nmodel = acme/model\ncount = 1\n" + extra);
    }

    @Test
    void parsesDeclaredRuntimes() {
        RuntimeConfig config = RuntimeConfig.parse(VALID);

        assertEquals(2, config.runtimes().size());
        RuntimeConfig.DeclaredRuntime workers = config.runtimes().get(0);
        assertEquals("workers", workers.name());
        assertEquals(RuntimeConfig.Role.WORKER, workers.role());
        assertEquals("acme/claude-sonnet", workers.modelRef());
        assertEquals(3, workers.count());
        assertEquals(RuntimeConfig.Effort.HIGH, workers.effort());
        assertNull(workers.project());

        RuntimeConfig.DeclaredRuntime reviewers = config.runtimes().get(1);
        assertEquals(RuntimeConfig.Role.REVIEWER, reviewers.role());
        assertEquals(RuntimeConfig.Effort.MAX, reviewers.effort());
        assertEquals("42", reviewers.project());

        assertThrows(UnsupportedOperationException.class,
            () -> config.runtimes().add(reviewers));
    }

    @Test
    void expandsTheSevenRuntimeReferenceCase() {
        RuntimeConfig config = RuntimeConfig.parse("""
            [runtime "workers"]
            role = worker
            model = acme/claude-sonnet
            count = 3
            project = 1

            [runtime "reviewers"]
            role = reviewer
            model = acme/claude-opus
            count = 2

            [runtime "planners"]
            role = planner
            model = acme/claude-sonnet
            count = 2
            """);

        assertEquals(7, config.expandedSlots().size());
        assertEquals(List.of("workers-1", "workers-2", "workers-3",
            "reviewers-1", "reviewers-2", "planners-1", "planners-2"),
            config.expandedSlots().stream().map(RuntimeConfig.RuntimeSlot::name).toList());
    }

    @Test
    void parsesAFile() throws IOException {
        Path file = tempDir.resolve("agent.ini");
        Files.writeString(file, VALID);

        RuntimeConfig config = RuntimeConfig.parse(file);

        assertEquals(2, config.runtimes().size());
        assertEquals("workers", config.runtimes().get(0).name());
    }

    @Test
    void rejectsUnknownKey() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(base("colour = red")));

        assertTrue(error.getMessage().contains("unknown key 'colour'"), error.getMessage());
        assertTrue(error.getMessage().contains("[runtime \"workers\"]"), error.getMessage());
    }

    @Test
    void rejectsSecretLookingKeys() {
        for (String key : List.of(
                "api_key", "API-KEY", "apikey", "key", "token", "secret",
                "password", "credential", "authorization", "bearer", "private_key")) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> RuntimeConfig.parse(base(key + " = value")), key);
            assertTrue(error.getMessage().contains("secret-looking key"), key + ": " + error.getMessage());
            assertFalse(error.getMessage().contains("value"), error.getMessage());
        }
    }

    @Test
    void rejectsSecretLookingValuesWithoutEchoingThem() {
        List<String> secrets = List.of(
            "sk-live-abcdefghijklmnop",
            "ak_0123456789abcdef",
            "enr_0123456789abcdef",
            "ghp_0123456789abcdefghij",
            "xoxb-0123456789",
            "Bearer abcdefghijklmnop",
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef");
        for (String secret : secrets) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> RuntimeConfig.parse(base("project = " + secret)), secret);
            assertTrue(error.getMessage().contains("value looks like a secret"),
                secret + ": " + error.getMessage());
            assertFalse(error.getMessage().contains(secret),
                "the rejected value must not be echoed: " + error.getMessage());
        }
    }

    @Test
    void rejectsInvalidRole() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(base("").replace("role = worker", "role = super-agent")));
        assertTrue(error.getMessage().contains("role must be one of"), error.getMessage());
    }

    @Test
    void rejectsInvalidEffort() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(base("effort = extreme")));
        assertTrue(error.getMessage().contains("effort must be one of"), error.getMessage());
    }

    @Test
    void rejectsInvalidCount() {
        for (String count : List.of("0", "-1", "abc", "1.5", "101")) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> RuntimeConfig.parse(single(
                    "role = worker\nmodel = acme/model\ncount = " + count)), count);
            assertTrue(error.getMessage().contains("count"), count + ": " + error.getMessage());
        }
    }

    @Test
    void rejectsDuplicateSectionNames() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(VALID + "\n[runtime \"workers\"]\n"
                + "role = worker\nmodel = acme/model\ncount = 1\n"));
        assertTrue(error.getMessage().contains("duplicate runtime section"), error.getMessage());
    }

    @Test
    void rejectsUnknownAndMalformedSections() {
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse("[provider \"acme\"]\nrole = worker\n"));
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse("[runtime workers]\nrole = worker\n"));
    }

    @Test
    void rejectsUnsafeSectionNames() {
        for (String name : List.of("../escape", "a/b", "a b", ".hidden", "")) {
            assertThrows(IllegalArgumentException.class,
                () -> RuntimeConfig.parse("[runtime \"" + name + "\"]\n"
                    + "role = worker\nmodel = acme/model\ncount = 1\n"), name);
        }
    }

    @Test
    void rejectsMissingRequiredKeys() {
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(single("model = acme/model\ncount = 1\n")));
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(single("role = worker\ncount = 1\n")));
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(single("role = worker\nmodel = acme/model\n")));
    }

    @Test
    void rejectsInvalidModelReferences() {
        for (String model : List.of("acme", "/model", "acme/", "acme/my model", "acme//model")) {
            IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> RuntimeConfig.parse(single(
                    "role = worker\nmodel = " + model + "\ncount = 1\n")), model);
            assertTrue(error.getMessage().contains("credential-name"), error.getMessage());
        }
    }

    @Test
    void rejectsKeysOutsideASectionAndDuplicateKeys() {
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse("role = worker\n" + VALID));
        assertThrows(IllegalArgumentException.class,
            () -> RuntimeConfig.parse(base("role = reviewer")));
    }

    @Test
    void specHashIsStableAndIgnoresNameAndCount() {
        RuntimeConfig.DeclaredRuntime first = new RuntimeConfig.DeclaredRuntime(
            "workers", RuntimeConfig.Role.WORKER, "acme/model", 1,
            RuntimeConfig.Effort.HIGH, "42");
        RuntimeConfig.DeclaredRuntime renamed = new RuntimeConfig.DeclaredRuntime(
            "other", RuntimeConfig.Role.WORKER, "acme/model", 9,
            RuntimeConfig.Effort.HIGH, "42");

        assertEquals(first.specHash(), first.specHash());
        assertEquals(first.specHash(), renamed.specHash());

        RuntimeConfig.DeclaredRuntime otherRole = new RuntimeConfig.DeclaredRuntime(
            "workers", RuntimeConfig.Role.REVIEWER, "acme/model", 1,
            RuntimeConfig.Effort.HIGH, "42");
        RuntimeConfig.DeclaredRuntime otherModel = new RuntimeConfig.DeclaredRuntime(
            "workers", RuntimeConfig.Role.WORKER, "acme/other", 1,
            RuntimeConfig.Effort.HIGH, "42");
        RuntimeConfig.DeclaredRuntime otherEffort = new RuntimeConfig.DeclaredRuntime(
            "workers", RuntimeConfig.Role.WORKER, "acme/model", 1,
            RuntimeConfig.Effort.LOW, "42");
        RuntimeConfig.DeclaredRuntime otherProject = new RuntimeConfig.DeclaredRuntime(
            "workers", RuntimeConfig.Role.WORKER, "acme/model", 1,
            RuntimeConfig.Effort.HIGH, "43");

        assertNotEquals(first.specHash(), otherRole.specHash());
        assertNotEquals(first.specHash(), otherModel.specHash());
        assertNotEquals(first.specHash(), otherEffort.specHash());
        assertNotEquals(first.specHash(), otherProject.specHash());
    }

    @Test
    void expandedChildNamesAreDeterministic() {
        RuntimeConfig config = RuntimeConfig.parse(VALID);
        RuntimeConfig.DeclaredRuntime workers = config.runtimes().get(0);

        List<RuntimeConfig.RuntimeSlot> slots = workers.expanded();

        assertEquals(3, slots.size());
        assertEquals(List.of("workers-1", "workers-2", "workers-3"),
            slots.stream().map(RuntimeConfig.RuntimeSlot::name).toList());
        assertEquals(List.of(1, 2, 3),
            slots.stream().map(RuntimeConfig.RuntimeSlot::index).toList());
        assertEquals(workers.specHash(), slots.get(0).specHash());
        assertEquals(slots.get(0).specHash(), slots.get(2).specHash());
        assertThrows(UnsupportedOperationException.class, () -> slots.add(slots.get(0)));
        assertEquals(5, config.expandedSlots().size());
    }
}
