package com.vibecode.agent.supervisor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.regex.Pattern;

/** fg-58: periodic runtime-root/legacy/temp sweep and quarantine. */
final class StorageSweeper {

    private static final Logger log = LoggerFactory.getLogger(StorageSweeper.class);
    private static final Pattern LEGACY = Pattern.compile("^[0-9a-f]{8}-.+");
    private static final String[] TEMP_PREFIXES = {"opencode-harness-", "vibecode-askpass-"};

    private StorageSweeper() {
    }

    /** Remove runtime roots older than ttl that are not in activeRuntimeIds. */
    static int sweepRuntimeRoots(
        Path runtimeBase,
        Path orphans,
        Duration ttl,
        Duration markerTtl,
        Set<String> activeRuntimeIds
    ) {
        if (runtimeBase == null || !Files.isDirectory(runtimeBase)) return 0;
        Instant cutoff = Instant.now().minus(ttl);
        int removed = 0;
        try (var entries = Files.list(runtimeBase)) {
            for (Path entry : entries.toList()) {
                if (!Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) continue;
                String id = entry.getFileName().toString();
                if (activeRuntimeIds != null && activeRuntimeIds.contains(id)) continue;
                if (hasActiveMarker(entry, markerTtl)) continue;
                if (!olderThan(entry, cutoff)) continue;
                try {
                    quarantine(entry, orphans);
                    removed++;
                } catch (IOException e) {
                    log.warn("Could not quarantine runtime root {}: {}", entry, e.getMessage());
                }
            }
        } catch (IOException e) {
            log.warn("Runtime-root sweep failed in {}: {}", runtimeBase, e.getMessage());
        }
        return removed;
    }

    /** Reap old legacy /repos/<8hex>-* and temp directories. */
    static int sweepLegacy(Path repoBase, Path tempRoot, Duration ttl) {
        int removed = 0;
        removed += sweepMatching(repoBase, ttl, name -> LEGACY.matcher(name).matches());
        removed += sweepMatching(tempRoot, ttl, name -> {
            for (String prefix : TEMP_PREFIXES) {
                if (name.startsWith(prefix)) return true;
            }
            return false;
        });
        return removed;
    }

    /** Delete quarantined directories older than the orphan TTL. */
    static int sweepOrphans(Path orphans, Duration ttl) {
        if (orphans == null || !Files.isDirectory(orphans)) return 0;
        Instant cutoff = Instant.now().minus(ttl);
        int removed = 0;
        try (var entries = Files.list(orphans)) {
            for (Path entry : entries.toList()) {
                if (!olderThan(entry, cutoff)) continue;
                try {
                    deleteTree(entry);
                    removed++;
                } catch (IOException e) {
                    log.warn("Could not delete orphan {}: {}", entry, e.getMessage());
                }
            }
        } catch (IOException e) {
            log.warn("Orphan sweep failed in {}: {}", orphans, e.getMessage());
        }
        return removed;
    }

    static Path quarantine(Path root, Path orphans) throws IOException {
        if (orphans == null) {
            deleteTree(root);
            return null;
        }
        Files.createDirectories(orphans);
        Path target = orphans.resolve(root.getFileName() + "-" + Instant.now().toEpochMilli());
        try {
            Files.move(root, target);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(root, target);
        }
        return target;
    }

    static boolean hasActiveMarker(Path root, Duration markerTtl) {
        if (root == null || !Files.isDirectory(root)) return false;
        Instant cutoff = Instant.now().minus(
            markerTtl == null || markerTtl.isNegative() ? Duration.ZERO : markerTtl);
        try (var walk = Files.walk(root, 3)) {
            return walk.anyMatch(path -> ".active".equals(path.getFileName().toString())
                && Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)
                && !olderThan(path, cutoff));
        } catch (IOException | java.io.UncheckedIOException e) {
            return true; // fail closed for an unreadable root
        }
    }

    static boolean olderThan(Path path, Instant cutoff) {
        try {
            return Files.getLastModifiedTime(path, LinkOption.NOFOLLOW_LINKS)
                .toInstant().isBefore(cutoff);
        } catch (IOException e) {
            return false;
        }
    }

    static void deleteTree(Path root) throws IOException {
        if (root == null || !Files.exists(root, LinkOption.NOFOLLOW_LINKS)) return;
        Files.walkFileTree(root, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs)
                throws IOException {
                Files.deleteIfExists(file);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult postVisitDirectory(Path dir, IOException exc)
                throws IOException {
                if (exc != null) throw exc;
                Files.deleteIfExists(dir);
                return FileVisitResult.CONTINUE;
            }
        });
    }

    private static int sweepMatching(Path root, Duration ttl, NameMatcher matcher) {
        if (root == null || !Files.isDirectory(root)) return 0;
        Instant cutoff = Instant.now().minus(ttl);
        int removed = 0;
        try (var entries = Files.list(root)) {
            for (Path entry : entries.toList()) {
                if (!Files.isDirectory(entry, LinkOption.NOFOLLOW_LINKS)) continue;
                if (!matcher.matches(entry.getFileName().toString())) continue;
                if (!olderThan(entry, cutoff)) continue;
                try {
                    deleteTree(entry);
                    removed++;
                } catch (IOException e) {
                    log.warn("Could not remove {}: {}", entry, e.getMessage());
                }
            }
        } catch (IOException e) {
            log.warn("Sweep failed in {}: {}", root, e.getMessage());
        }
        return removed;
    }

    @FunctionalInterface
    private interface NameMatcher {
        boolean matches(String name);
    }
}
