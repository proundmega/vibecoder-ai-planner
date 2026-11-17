package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Privacy/data-governance policy returned with the run start (fg-42).
 *
 * <p>Missing fields fall back to conservative defaults. A policy read failure on
 * the backend fails the start; the agent also fails closed if a classification
 * exceeds the configured ceiling.</p>
 */
public record HarnessPrivacyPolicy(
    String maxDataClass,
    List<String> allowedProviders,
    boolean requireNoTraining,
    boolean localOnly,
    String localEndpoint,
    String localModel,
    String dataResidency,
    boolean blockOnSecret,
    boolean blockOnPii,
    boolean redactPii,
    int eventRetentionDays,
    int artifactRetentionDays,
    int policyVersion,
    String source
) {

    public static final String PUBLIC = "public";
    public static final String INTERNAL = "internal";
    public static final String CONFIDENTIAL = "confidential";
    public static final String SECRET = "secret";

    private static final List<String> CLASSES =
        List.of(PUBLIC, INTERNAL, CONFIDENTIAL, SECRET);

    public HarnessPrivacyPolicy {
        maxDataClass = classValue(maxDataClass, CONFIDENTIAL);
        allowedProviders = allowedProviders == null
            ? List.of()
            : List.copyOf(allowedProviders);
    }

    public static HarnessPrivacyPolicy defaults() {
        return new HarnessPrivacyPolicy(
            CONFIDENTIAL, List.of(), false, false, null, null, null,
            false, false, true, 30, 7, 0, "default");
    }

    public static HarnessPrivacyPolicy from(Map<String, Object> raw) {
        HarnessPrivacyPolicy fallback = defaults();
        if (raw == null || raw.isEmpty()) {
            return fallback;
        }
        return new HarnessPrivacyPolicy(
            classValue(string(raw.get("maxDataClass")), fallback.maxDataClass()),
            stringList(raw.get("allowedProviders")),
            booleanValue(raw.get("requireNoTraining"), fallback.requireNoTraining()),
            booleanValue(raw.get("localOnly"), fallback.localOnly()),
            string(raw.get("localEndpoint")),
            string(raw.get("localModel")),
            string(raw.get("dataResidency")),
            booleanValue(raw.get("blockOnSecret"), fallback.blockOnSecret()),
            booleanValue(raw.get("blockOnPii"), fallback.blockOnPii()),
            booleanValue(raw.get("redactPii"), fallback.redactPii()),
            intValue(raw.get("eventRetentionDays"), fallback.eventRetentionDays()),
            intValue(raw.get("artifactRetentionDays"), fallback.artifactRetentionDays()),
            intValue(raw.get("policyVersion"), 0),
            string(raw.get("source")) == null ? "backend" : string(raw.get("source"))
        );
    }

    public boolean allowsClass(String level) {
        return rank(level) <= rank(maxDataClass);
    }

    public boolean requiresLocalEndpoint() {
        return localOnly || SECRET.equals(maxDataClass);
    }

    public static int rank(String level) {
        int index = CLASSES.indexOf(level == null ? SECRET : level.toLowerCase(Locale.ROOT));
        return index < 0 ? CLASSES.size() - 1 : index;
    }

    public static String classValue(String value, String fallback) {
        if (value == null) {
            return fallback;
        }
        String normalised = value.trim().toLowerCase(Locale.ROOT);
        return CLASSES.contains(normalised) ? normalised : SECRET;
    }

    private static String string(Object value) {
        if (value == null) return null;
        String text = String.valueOf(value).trim();
        return text.isEmpty() || "null".equals(text) ? null : text;
    }

    private static List<String> stringList(Object value) {
        if (value instanceof List<?> list) {
            List<String> values = new ArrayList<>();
            for (Object item : list) {
                String text = string(item);
                if (text != null) {
                    values.add(text.toLowerCase(Locale.ROOT).replace('_', '-'));
                }
            }
            return values;
        }
        if (value instanceof String text) {
            if (text.isBlank()) return List.of();
            List<String> values = new ArrayList<>();
            for (String part : text.split(",")) {
                String item = string(part);
                if (item != null) {
                    values.add(item.toLowerCase(Locale.ROOT).replace('_', '-'));
                }
            }
            return values;
        }
        return Collections.emptyList();
    }

    private static boolean booleanValue(Object value, boolean fallback) {
        if (value instanceof Boolean bool) return bool;
        if (value instanceof String text) {
            return "true".equalsIgnoreCase(text) || "1".equals(text);
        }
        return fallback;
    }

    private static int intValue(Object value, int fallback) {
        if (value instanceof Number number) return number.intValue();
        if (value instanceof String text) {
            try {
                return Integer.parseInt(text.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }
}
