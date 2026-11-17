package com.vibecode.agent.harness;

/**
 * One storage/model boundary for privacy-sensitive text (fg-42).
 *
 * <p>Tool output, prompts and model output are redacted before they reach the
 * model. Persisted/published strings (ticket messages, branch names, run
 * errors, commit/PR text) always lose known credentials and high-confidence
 * PII, independent of the prompt policy, so a failed verification cannot write
 * PII back into the platform.</p>
 */
public final class HarnessPrivacyGuard {

    private static volatile HarnessPrivacyPolicy policy = HarnessPrivacyPolicy.defaults();

    private HarnessPrivacyGuard() {
    }

    public static void configure(HarnessPrivacyPolicy value) {
        policy = value == null ? HarnessPrivacyPolicy.defaults() : value;
    }

    public static HarnessPrivacyPolicy policy() {
        return policy;
    }

    /**
     * Redact text before it is returned to the model. Secrets are always
     * removed. PII is scanned even when redaction is disabled so a configured
     * block cannot be bypassed.
     */
    public static String forModel(String value) throws HarnessPrivacyPipeline.PrivacyViolationException {
        if (value == null || value.isEmpty()) {
            return "";
        }
        HarnessPrivacyPolicy effective = policy;
        String withoutSecrets = RedactionRegistry.redact(value);
        if (!withoutSecrets.equals(value) && effective.blockOnSecret()) {
            throw new HarnessPrivacyPipeline.PrivacyViolationException(
                "Secret pattern detected in tool output; refusing to return it");
        }
        PiiRedactor.Result pii = PiiRedactor.redact(withoutSecrets);
        if (pii.count() > 0 && effective.blockOnPii()) {
            throw new HarnessPrivacyPipeline.PrivacyViolationException(
                "PII pattern detected in tool output; refusing to return it");
        }
        return effective.redactPii() ? pii.text() : withoutSecrets;
    }

    /**
     * Redact text before it is persisted or published. Secrets and PII are
     * always removed here; storage is not a policy choice.
     */
    public static String forStorage(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String withoutSecrets = RedactionRegistry.redact(value);
        return PiiRedactor.redact(withoutSecrets).text();
    }
}
