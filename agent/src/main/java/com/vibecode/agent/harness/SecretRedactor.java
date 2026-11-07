package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Redacts credentials from sandbox/verification output before it is stored in
 * ticket messages, harness run errors or pull-request bodies (NFR5).
 *
 * <p>The supervisor already replaces the exact provider/GitHub/agent secrets it
 * knows about. This class adds high-confidence credential <em>formats</em> so a
 * test or install script that prints a token it obtained elsewhere does not
 * persist it either. Redaction is deliberately conservative: it can replace
 * benign text that happens to look like a credential, but it must not miss a
 * known secret or a common token shape.</p>
 *
 * <p>This is a storage guard, not the sandbox boundary. It cannot catch every
 * encoded or split credential.</p>
 */
public final class SecretRedactor {

    static final String REDACTED = "[REDACTED]";
    private static final int MIN_KNOWN_SECRET_LENGTH = 8;

    private static final List<Rule> PATTERNS = List.of(
        // Complete PEM private-key blocks. The fallback below handles a BEGIN
        // whose END was lost (for example because the capture ring split the
        // block) by redacting the remainder rather than leaking the material.
        new Rule("(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"
            + ".*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
            "[REDACTED PRIVATE KEY]"),
        new Rule("(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*",
            "[REDACTED PRIVATE KEY]"),
        new Rule("\\b(?:gh[pousr]_[A-Za-z0-9]{20,}"
            + "|github_pat_[A-Za-z0-9_]{20,})\\b", REDACTED),
        new Rule("\\bsk-[A-Za-z0-9_-]{20,}\\b", REDACTED),
        new Rule("\\bAKIA[0-9A-Z]{16}\\b", REDACTED),
        new Rule("\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b", REDACTED),
        new Rule("\\bAIza[0-9A-Za-z_-]{35}\\b", REDACTED),
        new Rule("\\beyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}"
            + "\\.[A-Za-z0-9_-]{10,}\\b", REDACTED),
        new Rule("(?i)\\b(Bearer|Basic)\\s+[A-Za-z0-9._~+/=-]{20,}",
            "$1 " + REDACTED),
        // scheme://user:password@host and scheme://:password@host (Redis).
        // The boundary plus possessive quantifiers keep this linear on
        // ordinary text; a runaway scheme class would otherwise backtrack at
        // every position.
        new Rule("(?i)(?<![A-Za-z0-9+.-])"
            + "([a-z][a-z0-9+.-]*+://)([^/\\s:@]*+):([^/\\s@]++)@",
            "$1" + REDACTED + "@"),
        // key=value / "key": "value" forms for common credential names.
        // Prefixes/suffixes allow client_secret, access_token, DB_PASSWORD,
        // AWS_SECRET_ACCESS_KEY and clientSecret; the [:=] requirement keeps
        // ordinary prose out. The lookbehind starts at most one attempt per
        // identifier, which keeps the backtracking-linear.
        new Rule("(?i)(?<![A-Za-z0-9_.-])"
            + "([A-Za-z0-9_.-]*(?:api[_-]?key|private[_-]?key|secret|token"
            + "|password|passwd|pwd|authorization)[A-Za-z0-9_.-]*)"
            + "[\"']?\\s*[:=]\\s*"
            + "(?:\"([^\"]{8,})\"|'([^']{8,})'|([^\\s\"',}]{8,}))",
            "$1=" + REDACTED),
        // Header-only fallback for any BEGIN not consumed above.
        new Rule("(?i)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----",
            "[REDACTED PRIVATE KEY]")
    );

    private final List<String> knownSecrets;

    public SecretRedactor(Collection<String> knownSecrets) {
        List<String> values = new ArrayList<>();
        if (knownSecrets != null) {
            for (String secret : knownSecrets) {
                if (secret != null && secret.length() >= MIN_KNOWN_SECRET_LENGTH
                    && !values.contains(secret)) {
                    values.add(secret);
                }
            }
        }
        // Replace longer values first so one known secret cannot be partially
        // rewritten by a shorter secret it contains.
        values.sort(Comparator.comparingInt(String::length).reversed());
        this.knownSecrets = List.copyOf(values);
    }

    /**
     * Pattern-only redaction for components that do not have access to the
     * supervisor's configured secrets (for example the verification runner).
     */
    public static SecretRedactor patternsOnly() {
        return new SecretRedactor(List.of());
    }

    /**
     * @return {@code value} with known secrets and credential patterns replaced;
     *     never {@code null}
     */
    public String redact(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String redacted = value;
        for (String secret : knownSecrets) {
            redacted = redacted.replace(secret, REDACTED);
        }
        for (Rule rule : PATTERNS) {
            redacted = rule.pattern().matcher(redacted).replaceAll(rule.replacement());
        }
        return redacted;
    }

    private record Rule(Pattern pattern, String replacement) {
        Rule(String regex, String replacement) {
            this(Pattern.compile(regex), replacement);
        }
    }
}
