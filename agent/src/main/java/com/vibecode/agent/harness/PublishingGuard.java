package com.vibecode.agent.harness;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Blocks publishing empty, protected or dangerously large diffs.
 */
public final class PublishingGuard {

    private static final int MAX_FILES = 50;
    private static final int MAX_LINES = 2_000;

    private final List<Pattern> protectedPatterns;

    public PublishingGuard(List<String> protectedGlobs) {
        this.protectedPatterns = protectedGlobs == null
            ? List.of()
            : protectedGlobs.stream().map(PublishingGuard::globToRegex).toList();
    }

    public void assertPublishable(DiffSummary diff) {
        if (diff == null || diff.isEmpty()) {
            throw new IllegalStateException("Nothing to publish: the workspace has no changes");
        }
        if (diff.changedFileCount() > MAX_FILES) {
            throw new IllegalStateException("Diff touches too many files: " + diff.changedFileCount());
        }
        if (diff.changedLines() > MAX_LINES) {
            throw new IllegalStateException("Diff is too large: " + diff.changedLines() + " changed lines");
        }

        for (DiffSummary.ChangedFile file : diff.files()) {
            String path = file.path() == null ? "" : file.path().replace('\\', '/');
            for (Pattern pattern : protectedPatterns) {
                if (pattern.matcher(path).matches()) {
                    throw new IllegalStateException("Refusing to publish protected path: " + path);
                }
            }
        }
    }

    static Pattern globToRegex(String glob) {
        String normalized = glob.trim().replace('\\', '/');
        StringBuilder regex = new StringBuilder("^");
        for (int i = 0; i < normalized.length(); i++) {
            char c = normalized.charAt(i);
            if (c == '*') {
                boolean doubleStar = i + 1 < normalized.length() && normalized.charAt(i + 1) == '*';
                if (doubleStar) {
                    i++;
                    if (i + 1 < normalized.length() && normalized.charAt(i + 1) == '/') {
                        i++;
                        regex.append("(?:.*/)?");
                    } else {
                        regex.append(".*");
                    }
                } else {
                    regex.append("[^/]*");
                }
            } else if (c == '?') {
                regex.append("[^/]");
            } else if ("\\.[]{}()+-^$|".indexOf(c) >= 0) {
                regex.append('\\').append(c);
            } else {
                regex.append(c);
            }
        }
        regex.append('$');
        return Pattern.compile(regex.toString(), Pattern.CASE_INSENSITIVE);
    }
}
