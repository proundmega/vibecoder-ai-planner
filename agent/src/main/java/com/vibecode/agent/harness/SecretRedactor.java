package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Redacts credentials from sandbox/verification output before it is stored in
 * ticket messages, branch names, harness run errors or pull-request
 * titles/bodies (NFR5).
 *
 * <p>The supervisor already replaces the exact provider/GitHub/agent secrets it
 * knows about. This class adds high-confidence credential <em>formats</em> so a
 * test or install script that prints a token it obtained elsewhere does not
 * persist it either. Redaction is deliberately conservative: it can replace
 * benign text that happens to look like a credential, but it must not miss a
 * known secret or a common token shape.</p>
 *
 * <p>This is a storage guard, not the sandbox boundary. It cannot catch every
 * encoded or split credential. Credential values shorter than eight characters
 * are left alone by the pattern rules (and configured secrets shorter than
 * eight characters are ignored) to avoid corrupting ordinary output.</p>
 */
public final class SecretRedactor {

    static final String REDACTED = "[REDACTED]";
    private static final int MIN_KNOWN_SECRET_LENGTH = 8;

    /**
     * Complete PEM/PGP/SSH2 private-key blocks. The alternation's second branch
     * redacts the remainder of the output when the END marker was lost (for
     * example because the capture ring split the block), so base64 material
     * cannot survive a truncated header. Matching the remainder also keeps the
     * scan linear when hostile output contains many unmatched headers.
     */
    private static final List<Rule> PATTERNS = List.of(
        new Rule("(?is)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"
            + "(?:.*?-----END [A-Z0-9 ]*PRIVATE KEY-----|.*)",
            "[REDACTED PRIVATE KEY]"),
        new Rule("(?is)-----BEGIN PGP PRIVATE KEY BLOCK-----"
            + "(?:.*?-----END PGP PRIVATE KEY BLOCK-----|.*)",
            "[REDACTED PRIVATE KEY]"),
        new Rule("(?is)---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----"
            + "(?:.*?---- END SSH2 ENCRYPTED PRIVATE KEY ----|.*)",
            "[REDACTED PRIVATE KEY]"),
        new Rule("\\b(?:gh[pousr]_[A-Za-z0-9]{20,}"
            + "|ghs_[A-Za-z0-9._-]{20,}"
            + "|github_pat_[A-Za-z0-9_]{20,})\\b", REDACTED),
        new Rule("\\bsk-[A-Za-z0-9_-]{20,}\\b", REDACTED),
        new Rule("\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b", REDACTED),
        new Rule("\\bxox[abpcrsd]-[A-Za-z0-9-]{10,}\\b", REDACTED),
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
            "$1" + REDACTED + "@")
    );

    /**
     * Credential key/value forms. The lookahead requires a credential keyword
     * somewhere in the identifier before the identifier is consumed. Without
     * it, a non-credential assignment such as {@code message="..."} would
     * consume the value span, and nested credentials inside it (for example
     * {@code {"message": "password=supersecret"}}) would never be examined.
     * The identifier is then matched once with a possessive quantifier so
     * repeated keywords are linear rather than quadratic.
     *
     * <p>The value branch is escape-aware so a JSON value containing
     * {@code \"} is redacted as a whole instead of stopping at the escaped
     * quote. An unquoted value continues to the end of the line (stopping only
     * at a quote or newline); over-redacting an unquoted closing delimiter is
     * preferred to leaving part of the value.</p>
     */
    private static final String CREDENTIAL_KEY =
        "(?:api[_-]*key|private[_-]*key|secret|token|password|passwd|pwd"
            + "|authorization|pass[_-]*phrase)";

    private static final Pattern KEY_VALUE = Pattern.compile(
        "(?i)(?<![\\w.-])(?=[\\w.-]*" + CREDENTIAL_KEY + ")"
            + "([\\w.-]++)([\"']?)(\\s*[:=]\\s*)"
            + "(?:\"((?:[^\"\\\\]|\\\\.){8,})\""
            + "|'((?:[^'\\\\]|\\\\.){8,})'"
            + "|([^\"'\\r\\n]{8,}))");

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
        // Run multi-line/format rules before key/value: a private-key block
        // assigned to a credential key (password=-----BEGIN...) must be redacted
        // across its END marker, not just on the first line.
        for (Rule rule : PATTERNS) {
            redacted = rule.pattern().matcher(redacted).replaceAll(rule.replacement());
        }
        redacted = redactKeyValues(redacted);
        return redacted;
    }

    private static String redactKeyValues(String value) {
        Matcher matcher = KEY_VALUE.matcher(value);
        StringBuilder out = new StringBuilder(value.length());
        while (matcher.find()) {
            String replacement = matcher.group(1) + matcher.group(2) + matcher.group(3);
            if (matcher.group(4) != null) {
                replacement += "\"" + REDACTED + "\"";
            } else if (matcher.group(5) != null) {
                replacement += "'" + REDACTED + "'";
            } else {
                replacement += REDACTED;
            }
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private record Rule(Pattern pattern, String replacement) {
        Rule(String regex, String replacement) {
            this(Pattern.compile(regex), replacement);
        }
    }
}
