package com.vibecode.agent.harness;

import java.util.List;

/**
 * A summary of changes made in the workspace.
 */
public record DiffSummary(List<ChangedFile> files, int additions, int deletions, long bytes) {
    public record ChangedFile(String path, String status) {}

    /**
     * Backwards-compatible constructor used by callers that do not have a byte
     * count (for example the optional OpenCode diff endpoint).
     */
    public DiffSummary(List<ChangedFile> files, int additions, int deletions) {
        this(files, additions, deletions, 0);
    }

    public static DiffSummary empty() {
        return new DiffSummary(List.of(), 0, 0, 0);
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

    public long changedBytes() {
        return bytes;
    }
}
