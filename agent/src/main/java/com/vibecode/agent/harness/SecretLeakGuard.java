package com.vibecode.agent.harness;

import com.vibecode.agent.service.WorkspaceManager.GuardedBlob;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
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
 * with {@code ++}, or a secret used as a filename cannot hide content. Matches
 * already present in the base blob are ignored, so a pre-existing fixture does
 * not block an unrelated edit to the same file.</p>
 *
 * <p>This is an output guard, not the reason the sandbox is safe. It runs in
 * addition to the publishing guard and never replaces secretless execution.</p>
 */
public final class SecretLeakGuard {

    private static final int MIN_KNOWN_SECRET_LENGTH = 8;
    private static final int MAX_SCAN_BYTES = 8 * 1024 * 1024;

    /**
     * Private-key material is multi-line. The header-only rules catch a new
     * header in a new file; the full-block scanner below compares complete
     * blocks so a new key block with the same header as a pre-existing one is
     * still detected. PEM, PGP and SSH2 blocks are covered.
     */
    private static final List<KeyBlockFormat> KEY_BLOCK_FORMATS = List.of(
        new KeyBlockFormat(
            Pattern.compile("-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----",
                Pattern.CASE_INSENSITIVE),
            Pattern.compile("-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----",
                Pattern.CASE_INSENSITIVE)),
        new KeyBlockFormat(
            Pattern.compile("-----BEGIN PGP PRIVATE KEY BLOCK-----",
                Pattern.CASE_INSENSITIVE),
            Pattern.compile("-----END PGP PRIVATE KEY BLOCK-----",
                Pattern.CASE_INSENSITIVE)),
        new KeyBlockFormat(
            Pattern.compile("---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----",
                Pattern.CASE_INSENSITIVE),
            Pattern.compile("---- END SSH2 ENCRYPTED PRIVATE KEY ----",
                Pattern.CASE_INSENSITIVE))
    );

    private static final List<Rule> PATTERNS = List.of(
        rule("a private key", "-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----"),
        rule("a private key", "-----BEGIN PGP PRIVATE KEY BLOCK-----"),
        rule("a private key", "---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----"),
        rule("a GitHub token", "\\bgh[pousr]_[A-Za-z0-9]{20,}\\b"),
        rule("a GitHub fine-grained token", "\\bgithub_pat_[A-Za-z0-9_]{20,}\\b"),
        rule("an OpenAI-style key", "\\bsk-[A-Za-z0-9_-]{20,}\\b"),
        rule("an AWS access key", "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b"),
        rule("a Slack token", "\\bxox[abpcrsd]-[A-Za-z0-9-]{10,}\\b"),
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
     *     larger than the scan limit; also when the blob list is missing
     */
    public void assertClean(List<GuardedBlob> blobs) {
        if (blobs == null) {
            // Production always passes the guarded-tree list. Treat a missing
            // list as a fail-closed guard error rather than a clean result.
            throw new IllegalStateException("Guarded blobs are required");
        }
        for (GuardedBlob blob : blobs) {
            String finding = findLeak(blob);
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
    String findLeak(GuardedBlob blob) {
        if (blob == null) {
            return "a missing changed blob";
        }
        if (blob.newPath()) {
            String pathLeak = findLeakInText(blob.path());
            if (pathLeak != null) {
                return pathLeak;
            }
        }
        return findNewContentLeak(blob.content(), blob.baseContent());
    }

    /**
     * Compare the new blob with the base blob and only report matches that are
     * not already present in the base. This preserves added-line semantics for
     * modified files: a pre-existing test fixture is not treated as a new
     * leak, while a newly added credential is.
     */
    private String findNewContentLeak(byte[] content, byte[] baseContent) {
        if (content == null || content.length == 0) {
            return null;
        }
        if (content.length > MAX_SCAN_BYTES) {
            // Never scan a truncated prefix: a secret after the cut would be
            // published. Fail closed instead.
            return "a file larger than the credential-scan limit";
        }
        if (baseContent != null && baseContent.length > MAX_SCAN_BYTES) {
            return "a base file larger than the credential-scan limit";
        }
        String text = new String(content, StandardCharsets.ISO_8859_1);
        String baseText = baseContent == null
            ? ""
            : new String(baseContent, StandardCharsets.ISO_8859_1);

        for (String secret : knownSecrets) {
            if (text.contains(secret) && !baseText.contains(secret)) {
                return "a configured credential";
            }
        }

        Set<String> baseBlocks = privateKeyBlocks(baseText);
        for (String block : privateKeyBlocks(text)) {
            if (!baseBlocks.contains(block)) {
                return "a private key block";
            }
        }

        for (Rule rule : PATTERNS) {
            Set<String> baseMatches = matchedText(rule.pattern, baseText);
            Matcher matcher = rule.pattern.matcher(text);
            while (matcher.find()) {
                if (!baseMatches.contains(matcher.group())) {
                    return rule.description;
                }
            }
        }
        return null;
    }

    private static Set<String> matchedText(Pattern pattern, String text) {
        Set<String> matches = new HashSet<>();
        Matcher matcher = pattern.matcher(text);
        while (matcher.find()) {
            matches.add(matcher.group());
        }
        return matches;
    }

    /**
     * Extract complete PEM private-key blocks. A header without a matching
     * END is ignored here (the header-only pattern still catches it in a new
     * file); a complete block is compared as a whole so a new block using the
     * same header as a pre-existing block is not mistaken for the old one.
     *
     * <p>BEGIN/END markers are matched case-insensitively, like the header
     * rule. Block comparison itself is exact: re-wrapping, re-indenting or
     * changing the header casing of a pre-existing key counts as a new block
     * and is blocked. That is intentionally conservative; normalizing would
     * make the guard easier to evade.</p>
     */
    private static Set<String> privateKeyBlocks(String text) {
        Set<String> blocks = new HashSet<>();
        for (KeyBlockFormat format : KEY_BLOCK_FORMATS) {
            int index = 0;
            while (index < text.length()) {
                Matcher begin = format.begin().matcher(text);
                if (!begin.find(index)) {
                    break;
                }
                Matcher end = format.end().matcher(text);
                if (!end.find(begin.end())) {
                    break;
                }
                blocks.add(text.substring(begin.start(), end.end()));
                index = end.end();
            }
        }
        return blocks;
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

    private record KeyBlockFormat(Pattern begin, Pattern end) {
    }
}
