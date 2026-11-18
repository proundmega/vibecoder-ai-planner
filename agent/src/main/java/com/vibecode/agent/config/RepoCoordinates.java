package com.vibecode.agent.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Repository coordinates parsed from a project's configured repo URL.
 *
 * Supports HTTPS, `ssh://` and SCP-like Git URLs. The owner keeps any GitLab
 * subgroup segments (`group/sub/repo` -> owner `group/sub`).
 */
public record RepoCoordinates(String owner, String name) {

    public static Optional<RepoCoordinates> parse(String repoUrl) {
        if (repoUrl == null || repoUrl.isBlank()) return Optional.empty();

        String value = repoUrl.trim();
        int scheme = value.indexOf("://");
        if (scheme >= 0) {
            value = value.substring(scheme + 3);
        }

        // Strip userinfo (`git@host/...`, `user:pass@host/...`).
        int at = value.indexOf('@');
        if (at >= 0) {
            value = value.substring(at + 1);
        }

        // SCP-like Git URLs use a colon before the path (`host:owner/repo`).
        int colon = value.indexOf(':');
        int slash = value.indexOf('/');
        if (colon >= 0 && (slash < 0 || colon < slash)) {
            String after = value.substring(colon + 1);
            int nextSlash = after.indexOf('/');
            String port = nextSlash >= 0 ? after.substring(0, nextSlash) : after;
            if (port.matches("\\d+")) {
                // ssh://host:22/owner/repo — drop the explicit port.
                value = value.substring(0, colon) + after.substring(port.length());
            } else {
                // SCP-like host:owner/repo.
                value = value.substring(0, colon) + "/" + after;
            }
        }

        int pathStart = value.indexOf('/');
        if (pathStart < 0) return Optional.empty();
        String path = value.substring(pathStart + 1);
        if (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        if (path.endsWith(".git")) path = path.substring(0, path.length() - 4);

        List<String> segments = new ArrayList<>();
        for (String segment : path.split("/")) {
            if (!segment.isBlank()) segments.add(segment);
        }
        if (segments.size() < 2) return Optional.empty();

        String name = segments.get(segments.size() - 1);
        String owner = String.join("/", segments.subList(0, segments.size() - 1));
        if (owner.isBlank() || name.isBlank()) return Optional.empty();
        return Optional.of(new RepoCoordinates(owner, name));
    }
}
