package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublishingGuardTest {

    private final PublishingGuard guard = new PublishingGuard(
        List.of(".env*", "**/.env*", "Jenkinsfile", "**/Jenkinsfile",
            ".github/**", "**/.github/**", "**/secrets/**"));

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
            "backend/.env",
            "backend/.env.local",
            "Jenkinsfile",
            ".github/workflows/ci.yml",
            ".github/actions/build/action.yml",
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

    @Test
    void rejectsOversizedBinaryDiffByBytes() {
        PublishingGuard byteGuard = new PublishingGuard(
            List.of(), 50, 2_000, 10);
        DiffSummary binary = new DiffSummary(
            List.of(new DiffSummary.ChangedFile("fixture.bin", "added")),
            0, 0, 11);

        assertThrows(IllegalStateException.class, () -> byteGuard.assertPublishable(binary));
    }

    @Test
    void configurableLimitsAllowLegitimateLargeDiffs() {
        PublishingGuard larger = new PublishingGuard(List.of(), 100, 5_000, 1_000_000);
        String[] paths = new String[80];
        for (int i = 0; i < paths.length; i++) {
            paths[i] = "src/File" + i + ".java";
        }

        assertDoesNotThrow(() -> larger.assertPublishable(diff(paths)));
    }
}
