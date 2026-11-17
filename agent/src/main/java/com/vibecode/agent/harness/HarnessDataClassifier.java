package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.List;

/**
 * Classifies harness input before a prompt is sent (fg-42 FR1).
 *
 * <p>Classification is deliberately conservative: source changes are
 * confidential, ticket/planning text is internal, and any high-confidence
 * secret makes the whole context secret. The most restrictive result wins.</p>
 */
public final class HarnessDataClassifier {

    public record Classification(
        String level,
        List<String> reasons,
        boolean secret,
        boolean pii
    ) {
        public Classification {
            reasons = reasons == null ? List.of() : List.copyOf(reasons);
        }
    }

    private final SecretRedactor secretRedactor;

    public HarnessDataClassifier() {
        this(SecretRedactor.patternsOnly());
    }

    public HarnessDataClassifier(SecretRedactor secretRedactor) {
        this.secretRedactor = secretRedactor == null
            ? SecretRedactor.patternsOnly()
            : secretRedactor;
    }

    public Classification classify(
        String ticketText,
        List<String> planningDocs,
        List<String> changedPaths
    ) {
        List<String> reasons = new ArrayList<>();
        String level = HarnessPrivacyPolicy.PUBLIC;
        boolean secret = false;
        boolean pii = false;

        if (ticketText != null && !ticketText.isBlank()) {
            level = raise(level, HarnessPrivacyPolicy.INTERNAL);
            reasons.add("ticket text");
            secret |= containsSecret(ticketText);
            pii |= PiiRedactor.containsPii(ticketText);
        }

        if (planningDocs != null) {
            int docs = 0;
            for (String doc : planningDocs) {
                if (doc == null || doc.isBlank()) continue;
                docs++;
                secret |= containsSecret(doc);
                pii |= PiiRedactor.containsPii(doc);
            }
            if (docs > 0) {
                level = raise(level, HarnessPrivacyPolicy.INTERNAL);
                reasons.add("planning documents");
            }
        }

        if (changedPaths != null && !changedPaths.isEmpty()) {
            level = raise(level, HarnessPrivacyPolicy.CONFIDENTIAL);
            reasons.add("repository source changes");
        }

        if (pii) {
            level = raise(level, HarnessPrivacyPolicy.CONFIDENTIAL);
            reasons.add("PII pattern");
        }
        if (secret) {
            level = HarnessPrivacyPolicy.SECRET;
            reasons.add("secret pattern");
        }
        return new Classification(level, reasons, secret, pii);
    }

    private boolean containsSecret(String value) {
        if (value == null || value.isEmpty()) return false;
        return !secretRedactor.redact(value).equals(value);
    }

    private static String raise(String current, String candidate) {
        return HarnessPrivacyPolicy.rank(candidate) > HarnessPrivacyPolicy.rank(current)
            ? candidate
            : current;
    }
}
