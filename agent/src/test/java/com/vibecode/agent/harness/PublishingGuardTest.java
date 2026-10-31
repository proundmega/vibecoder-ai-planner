package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublishingGuardTest {

    private final PublishingGuard guard = new PublishingGuard(
        List.of(".env*", ".github/workflows/**", "**/secrets/**"));

    private DiffSummary diff(String... paths) {
        return new DiffSummary(
            java.util.Arrays.stream(paths)
                .map(path -> new DiffSummary.ChangedFile(path, "modified"))
                .toList(),
            10,
            2
        );
    }

    @Test
    void allowsNormalDiff() {
        assertDoesNotThrow(() -> guard.assertPublishable(diff("src/App.java", "README.md")));
    }

    @Test
    void rejectsEmptyDiff() {
        assertThrows(IllegalStateException.class, () -> guard.assertPublishable(DiffSummary.empty()));
        assertThrows(IllegalStateException.class, () -> guard.assertPublishable(null));
    }

    @Test
    void rejectsProtectedPaths() {
        for (String path : List.of(
            ".env",
            ".env.local",
            ".github/workflows/ci.yml",
            "backend/secrets/token.txt",
            "secrets/nested/key"
        )) {
            IllegalStateException error = assertThrows(
                IllegalStateException.class,
                () -> guard.assertPublishable(diff(path)),
                "Expected " + path + " to be protected"
            );
            assertTrue(error.getMessage().contains(path));
        }
    }

    @Test
    void rejectsTooManyFiles() {
        String[] paths = new String[51];
        for (int i = 0; i < paths.length; i++) {
            paths[i] = "src/File" + i + ".java";
        }

        assertThrows(IllegalStateException.class, () -> guard.assertPublishable(diff(paths)));
    }

    @Test
    void rejectsTooManyLines() {
        DiffSummary huge = new DiffSummary(
            List.of(new DiffSummary.ChangedFile("src/App.java", "modified")),
            1_500,
            600
        );

        assertThrows(IllegalStateException.class, () -> guard.assertPublishable(huge));
    }
}
