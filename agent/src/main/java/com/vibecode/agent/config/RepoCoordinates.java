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

        // Bare owner/repo (legacy/internal value; the connect API normally
        // uses a full URL).
        if (!value.contains("://") && !value.contains("@") && !value.contains(":")) {
            String bare = stripQueryAndFragment(value);
            String[] parts = bare.split("/");
            if (parts.length == 2 && !parts[0].isBlank() && !parts[1].isBlank()) {
                return Optional.of(new RepoCoordinates(parts[0], stripGitSuffix(parts[1])));
            }
        }

        int scheme = value.indexOf("://");
        boolean hasScheme = scheme >= 0;
        if (hasScheme) {
            value = value.substring(scheme + 3);
        }

        // Strip userinfo (`git@host/...`, `user:pass@host/...`).
        int at = value.indexOf('@');
        if (at >= 0) {
            value = value.substring(at + 1);
        }

        // Without a scheme, a colon before the path is SCP-like syntax
        // (`host:owner/repo`), never a port: `git@host:123/group/repo` has the
        // owner path `123/group/repo`. Ports only exist in a scheme authority.
        int colon = value.indexOf(':');
        int slash = value.indexOf('/');
        if (colon >= 0 && (slash < 0 || colon < slash)) {
            String after = value.substring(colon + 1);
            int nextSlash = after.indexOf('/');
            String port = nextSlash >= 0 ? after.substring(0, nextSlash) : after;
            if (hasScheme && port.matches("\\d+")) {
                // ssh://host:22/owner/repo — drop the explicit port.
                value = value.substring(0, colon) + after.substring(port.length());
            } else if (!hasScheme) {
                value = value.substring(0, colon) + "/" + after;
            }
        }

        int pathStart = value.indexOf('/');
        if (pathStart < 0) return Optional.empty();
        String path = stripQueryAndFragment(value.substring(pathStart + 1));
        if (path.endsWith("/")) path = path.substring(0, path.length() - 1);
        path = stripGitSuffix(path);

        List<String> segments = new ArrayList<>();
        for (String segment : path.split("/")) {
            if (!segment.isBlank()) segments.add(segment);
        }
        if (segments.size() < 2) return Optional.empty();

        String name = segments.get(segments.size() - 1);
        String owner = String.join("/", segments.subList(0, segments.size() - 1));
        if (owner.isBlank() || name.isBlank()) return Optional.empty();
        return Optional.of(new RepoCoordinates(owner, stripGitSuffix(name)));
    }

    private static String stripQueryAndFragment(String value) {
        int cut = value.length();
        int query = value.indexOf('?');
        int fragment = value.indexOf('#');
        if (query >= 0 && query < cut) cut = query;
        if (fragment >= 0 && fragment < cut) cut = fragment;
        return value.substring(0, cut);
    }

    private static String stripGitSuffix(String value) {
        return value.endsWith(".git") ? value.substring(0, value.length() - 4) : value;
    }
}
