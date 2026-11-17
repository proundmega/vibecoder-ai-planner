package com.vibecode.agent.harness;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Pre-flight and post-flight privacy pipeline (fg-42 FR2-FR4/FR10).
 *
 * <p>Pre-flight classifies the input, enforces the project classification
 * ceiling, and redacts known secrets/PII. Post-flight scans the PR body and
 * verification output before publishing. Any policy failure throws; the
 * supervisor then fails the run without publishing.</p>
 */
public final class HarnessPrivacyPipeline {

    public static final class PrivacyViolationException extends IOException {
        public PrivacyViolationException(String message) {
            super(message);
        }
    }

    public record PreflightResult(
        String prompt,
        HarnessDataClassifier.Classification classification,
        int secretRedactions,
        int piiRedactions
    ) {
        public Map<String, Object> eventPayload(HarnessPrivacyPolicy policy) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("level", classification.level());
            payload.put("reasons", classification.reasons());
            payload.put("sensitive", classification.secret());
            payload.put("pii", classification.pii());
            payload.put("sensitiveRedactions", secretRedactions);
            payload.put("piiRedactions", piiRedactions);
            payload.put("policyVersion", policy.policyVersion());
            payload.put("maxDataClass", policy.maxDataClass());
            return payload;
        }
    }

    public record PostflightResult(String text, int secretRedactions, int piiRedactions) {
    }

    private final HarnessDataClassifier classifier;
    private final SecretRedactor secretRedactor;

    public HarnessPrivacyPipeline() {
        this(new HarnessDataClassifier(), SecretRedactor.patternsOnly());
    }

    public HarnessPrivacyPipeline(
        HarnessDataClassifier classifier,
        SecretRedactor secretRedactor
    ) {
        this.classifier = classifier == null ? new HarnessDataClassifier() : classifier;
        this.secretRedactor = secretRedactor == null
            ? SecretRedactor.patternsOnly()
            : secretRedactor;
    }

    public HarnessDataClassifier.Classification classify(
        String ticketText,
        java.util.List<String> planningDocs,
        java.util.List<String> changedPaths
    ) {
        return classifier.classify(ticketText, planningDocs, changedPaths);
    }

    public PreflightResult preflight(
        String prompt,
        HarnessDataClassifier.Classification classification,
        HarnessPrivacyPolicy policy
    ) throws PrivacyViolationException {
        HarnessPrivacyPolicy effective = policy == null
            ? HarnessPrivacyPolicy.defaults()
            : policy;
        // Secret-class data is allowed through the ceiling only because the
        // next step either blocks it (blockOnSecret) or removes it; a project
        // ceiling must not make every run with a stray test token impossible.
        if (!classification.secret() && !effective.allowsClass(classification.level())) {
            throw new PrivacyViolationException(
                "Data class '" + classification.level()
                    + "' exceeds project limit '" + effective.maxDataClass() + "'");
        }
        if (classification.secret() && effective.blockOnSecret()) {
            throw new PrivacyViolationException(
                "Secret pattern detected in prompt; refusing to send it");
        }

        String redacted = RedactionRegistry.redact(prompt == null ? "" : prompt);
        int secretRedactions = count(redacted);
        if (secretRedactions > 0 && effective.blockOnSecret()) {
            throw new PrivacyViolationException(
                "Secret pattern detected in prompt; refusing to send it");
        }
        PiiRedactor.Result piiScan = PiiRedactor.redact(redacted);
        if (piiScan.count() > 0 && effective.blockOnPii()) {
            throw new PrivacyViolationException(
                "PII pattern detected in prompt; refusing to send it");
        }
        String output = effective.redactPii() ? piiScan.text() : redacted;
        int piiRedactions = effective.redactPii() ? piiScan.count() : 0;
        return new PreflightResult(
            output,
            classification,
            secretRedactions,
            piiRedactions
        );
    }

    public PostflightResult postflight(String text, HarnessPrivacyPolicy policy)
        throws PrivacyViolationException {
        HarnessPrivacyPolicy effective = policy == null
            ? HarnessPrivacyPolicy.defaults()
            : policy;
        String redacted = RedactionRegistry.redact(text == null ? "" : text);
        int secretRedactions = count(redacted);
        if (secretRedactions > 0 && effective.blockOnSecret()) {
            throw new PrivacyViolationException(
                "Secret pattern detected in model output; refusing to publish");
        }
        PiiRedactor.Result piiScan = PiiRedactor.redact(redacted);
        if (piiScan.count() > 0 && effective.blockOnPii()) {
            throw new PrivacyViolationException(
                "PII pattern detected in model output; refusing to publish");
        }
        String output = effective.redactPii() ? piiScan.text() : redacted;
        int piiRedactions = effective.redactPii() ? piiScan.count() : 0;
        return new PostflightResult(output, secretRedactions, piiRedactions);
    }

    private static int count(String value) {
        if (value == null) return 0;
        int count = 0;
        int index = 0;
        while ((index = value.indexOf(SecretRedactor.REDACTED, index)) >= 0) {
            count++;
            index += SecretRedactor.REDACTED.length();
        }
        return count;
    }
}
