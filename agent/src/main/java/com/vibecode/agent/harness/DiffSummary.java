package com.vibecode.agent.harness;

import java.util.List;

/**
 * A summary of changes made in the workspace.
 */
public record DiffSummary(List<ChangedFile> files, int additions, int deletions) {
    public record ChangedFile(String path, String status) {}

    public static DiffSummary empty() {
        return new DiffSummary(List.of(), 0, 0);
    }

    public boolean isEmpty() {
        return files == null || files.isEmpty();
    }

    public int changedFileCount() {
        return files == null ? 0 : files.size();
    }

    public int changedLines() {
        return additions + deletions;
    }
}
