package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Rejects a publish candidate whose added lines contain a credential.
 *
 * <p>Prompt injection can make the model write a secret into the repository
 * (for example into a test fixture or documentation). The supervisor knows the
 * provider key and GitHub token, so it can check the staged diff for those
 * exact values as well as high-confidence credential formats. Only added lines
 * are scanned: deleting an existing fixture must remain possible.</p>
 *
 * <p>This is an output guard, not the reason the sandbox is safe. It runs in
 * addition to the publishing guard and never replaces secretless execution.</p>
 */
public final class SecretLeakGuard {

    private static final int MIN_KNOWN_SECRET_LENGTH = 8;
    private static final int MAX_SCAN_CHARS = 8 * 1024 * 1024;

    private static final List<Rule> PATTERNS = List.of(
        rule("a private key", "-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----"),
        rule("a GitHub token", "\\bgh[pousr]_[A-Za-z0-9]{20,}\\b"),
        rule("a GitHub fine-grained token", "\\bgithub_pat_[A-Za-z0-9_]{20,}\\b"),
        rule("an OpenAI-style key", "\\bsk-[A-Za-z0-9_-]{20,}\\b"),
        rule("an AWS access key", "\\bAKIA[0-9A-Z]{16}\\b"),
        rule("a Slack token", "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b"),
        rule("a Google API key", "\\bAIza[0-9A-Za-z_-]{35}\\b")
    );

    private final List<String> knownSecrets;

    public SecretLeakGuard(Collection<String> knownSecrets) {
        List<String> values = new ArrayList<>();
        if (knownSecrets != null) {
            for (String secret : knownSecrets) {
                if (secret != null && secret.length() >= MIN_KNOWN_SECRET_LENGTH) {
                    values.add(secret);
                }
            }
        }
        this.knownSecrets = List.copyOf(values);
    }

    /**
     * @throws IllegalStateException when an added diff line contains a known
     *     secret value or a high-confidence credential format
     */
    public void assertClean(String diffText) {
        String finding = findLeak(diffText);
        if (finding != null) {
            throw new IllegalStateException(
                "Refusing to publish a diff that contains " + finding);
        }
    }

    /** @return a description of the leak, or {@code null} when the diff is clean */
    String findLeak(String diffText) {
        if (diffText == null || diffText.isBlank()) {
            return null;
        }
        String bounded = diffText.length() > MAX_SCAN_CHARS
            ? diffText.substring(0, MAX_SCAN_CHARS)
            : diffText;
        for (String line : bounded.split("\\R")) {
            // `+++ b/path` is a file header, not added content.
            if (!line.startsWith("+") || line.startsWith("+++")) {
                continue;
            }
            for (String secret : knownSecrets) {
                if (line.contains(secret)) {
                    return "a configured credential";
                }
            }
            for (Rule rule : PATTERNS) {
                if (rule.pattern.matcher(line).find()) {
                    return rule.description;
                }
            }
        }
        return null;
    }

    private static Rule rule(String description, String regex) {
        return new Rule(description, Pattern.compile(regex, Pattern.CASE_INSENSITIVE));
    }

    private record Rule(String description, Pattern pattern) {
        private Rule {
            description = description == null ? "a credential" : description;
        }
    }
}
