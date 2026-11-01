package com.vibecode.agent.harness;

import java.util.List;
import java.util.regex.Pattern;

/**
 * Blocks publishing empty, protected or dangerously large diffs.
 *
 * <p>Limits are configurable through {@code HARNESS_MAX_FILES},
 * {@code HARNESS_MAX_LINES} and {@code HARNESS_MAX_BYTES} so a legitimate large
 * ticket can be handled without weakening the default guard.</p>
 */
public final class PublishingGuard {

    private static final int DEFAULT_MAX_FILES = 50;
    private static final int DEFAULT_MAX_LINES = 2_000;
    private static final long DEFAULT_MAX_BYTES = 5L * 1024 * 1024;

    private final List<Pattern> protectedPatterns;
    private final int maxFiles;
    private final int maxLines;
    private final long maxBytes;

    public PublishingGuard(List<String> protectedGlobs) {
        this(
            protectedGlobs,
            intEnv("HARNESS_MAX_FILES", DEFAULT_MAX_FILES),
            intEnv("HARNESS_MAX_LINES", DEFAULT_MAX_LINES),
            longEnv("HARNESS_MAX_BYTES", DEFAULT_MAX_BYTES)
        );
    }

    public PublishingGuard(List<String> protectedGlobs, int maxFiles, int maxLines, long maxBytes) {
        this.protectedPatterns = protectedGlobs == null
            ? List.of()
            : protectedGlobs.stream()
                .filter(glob -> glob != null && !glob.isBlank())
                .map(PublishingGuard::globToRegex)
                .toList();
        this.maxFiles = maxFiles > 0 ? maxFiles : DEFAULT_MAX_FILES;
        this.maxLines = maxLines > 0 ? maxLines : DEFAULT_MAX_LINES;
        this.maxBytes = maxBytes > 0 ? maxBytes : DEFAULT_MAX_BYTES;
    }

    public void assertPublishable(DiffSummary diff) {
        if (diff == null || diff.isEmpty()) {
            throw new IllegalStateException("Nothing to publish: the workspace has no changes");
        }
        if (diff.changedFileCount() > maxFiles) {
            throw new IllegalStateException("Diff touches too many files: "
                + diff.changedFileCount() + " (limit " + maxFiles + ")");
        }
        if (diff.changedLines() > maxLines) {
            throw new IllegalStateException("Diff is too large: "
                + diff.changedLines() + " changed lines (limit " + maxLines + ")");
        }
        if (diff.changedBytes() > maxBytes) {
            throw new IllegalStateException("Diff is too large: "
                + diff.changedBytes() + " bytes (limit " + maxBytes + ")");
        }

        for (DiffSummary.ChangedFile file : diff.files()) {
            String path = normalizePath(file.path());
            for (Pattern pattern : protectedPatterns) {
                if (pattern.matcher(path).matches()) {
                    throw new IllegalStateException("Refusing to publish protected path: " + path);
                }
            }
        }
    }

    private static String normalizePath(String path) {
        String value = path == null ? "" : path.replace('\\', '/');
        while (value.startsWith("./")) {
            value = value.substring(2);
        }
        return value;
    }

    static Pattern globToRegex(String glob) {
        String normalized = glob.trim().replace('\\', '/');
        while (normalized.startsWith("./")) {
            normalized = normalized.substring(2);
        }
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

    private static int intEnv(String name, int fallback) {
        try {
            String value = System.getenv(name);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            int parsed = Integer.parseInt(value.trim());
            return parsed > 0 ? parsed : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static long longEnv(String name, long fallback) {
        try {
            String value = System.getenv(name);
            if (value == null || value.isBlank()) {
                return fallback;
            }
            long parsed = Long.parseLong(value.trim());
            return parsed > 0 ? parsed : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
