package com.vibecode.agent.harness;

import com.vibecode.agent.service.WorkspaceManager.GuardedBlob;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Rejects a publish candidate whose changed blob content or path contains a
 * credential.
 *
 * <p>Prompt injection can make the model write a secret into the repository
 * (for example into a test fixture or documentation). The supervisor knows the
 * provider key and GitHub token, so it can check the guarded tree for those
 * exact values as well as high-confidence credential formats.</p>
 *
 * <p>The scanner reads the guarded tree blobs directly instead of parsing
 * {@code git diff} output. This closes the diff-format bypasses: a
 * {@code .gitattributes} {@code * -diff} rule, a binary file, a line beginning
 * with {@code ++}, or a secret used as a filename cannot hide content.</p>
 *
 * <p>This is an output guard, not the reason the sandbox is safe. It runs in
 * addition to the publishing guard and never replaces secretless execution.</p>
 */
public final class SecretLeakGuard {

    private static final int MIN_KNOWN_SECRET_LENGTH = 8;
    private static final int MAX_SCAN_BYTES = 8 * 1024 * 1024;

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
                if (secret != null && secret.length() >= MIN_KNOWN_SECRET_LENGTH
                    && !values.contains(secret)) {
                    values.add(secret);
                }
            }
        }
        this.knownSecrets = List.copyOf(values);
    }

    /**
     * @throws IllegalStateException when a changed path or blob contains a
     *     known secret value, a high-confidence credential format, or a blob
     *     larger than the scan limit
     */
    public void assertClean(List<GuardedBlob> blobs) {
        if (blobs == null) {
            return;
        }
        for (GuardedBlob blob : blobs) {
            String finding = findLeak(blob.path(), blob.content());
            if (finding != null) {
                throw new IllegalStateException(
                    "Refusing to publish a diff that contains " + finding);
            }
        }
    }

    /**
     * @return a description of the leak, or {@code null} when the path and
     *     content are clean
     */
    String findLeak(String path, byte[] content) {
        String pathLeak = findLeakInText(path);
        if (pathLeak != null) {
            return pathLeak;
        }
        if (content == null || content.length == 0) {
            return null;
        }
        if (content.length > MAX_SCAN_BYTES) {
            // Never scan a truncated prefix: a secret after the cut would be
            // published. Fail closed instead.
            return "a file larger than the credential-scan limit";
        }
        return findLeakInText(new String(content, StandardCharsets.ISO_8859_1));
    }

    private String findLeakInText(String text) {
        if (text == null || text.isEmpty()) {
            return null;
        }
        for (String secret : knownSecrets) {
            if (text.contains(secret)) {
                return "a configured credential";
            }
        }
        for (Rule rule : PATTERNS) {
            if (rule.pattern.matcher(text).find()) {
                return rule.description;
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
