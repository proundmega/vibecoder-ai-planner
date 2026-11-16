package com.vibecode.agent.harness;

import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Budget and routing policy returned by the backend with the run start
 * (fg-38 FR5/FR6/FR8). Missing fields fall back to local conservative defaults,
 * so a policy read failure never disables enforcement.
 */
public record HarnessBudgetPolicy(
    BudgetLimits limits,
    double dailyCostLimitUsd,
    int projectMaxConcurrentRuns,
    int agentMaxConcurrentRuns,
    String routingPolicy,
    String freeModel,
    String paidModel,
    int complexityThreshold,
    Map<String, ModelPrice> prices,
    double dailySpendUsd,
    String killSwitchReason
) {

    public static final String FREE_ONLY = "free_only";
    public static final String FREE_THEN_PAID = "free_then_paid";
    public static final String PAID_FOR_COMPLEX = "paid_for_complex";
    public static final String PAID_ONLY = "paid_only";

    public HarnessBudgetPolicy {
        prices = prices == null ? Map.of() : Map.copyOf(prices);
    }

    public static HarnessBudgetPolicy defaults(Duration maxDuration, ProviderSettings provider) {
        String model = provider == null ? null : provider.model();
        return new HarnessBudgetPolicy(
            BudgetLimits.defaults(maxDuration),
            envDouble("HARNESS_DEFAULT_DAILY_COST_USD", 20.0),
            envInt("HARNESS_DEFAULT_PROJECT_MAX_CONCURRENT_RUNS", 4),
            envInt("HARNESS_DEFAULT_AGENT_MAX_CONCURRENT_RUNS", 1),
            FREE_THEN_PAID,
            defaultFreeModel(model, provider),
            model,
            envInt("HARNESS_COMPLEXITY_THRESHOLD", 3),
            Map.of(),
            0,
            null
        );
    }

    /**
     * Parse the `budgetPolicy` object from the start-run response. Unknown or
     * malformed fields are ignored rather than failing the run.
     */
    public static HarnessBudgetPolicy from(
        Map<String, Object> raw,
        Duration maxDuration,
        ProviderSettings provider
    ) {
        HarnessBudgetPolicy fallback = defaults(maxDuration, provider);
        if (raw == null || raw.isEmpty()) {
            return fallback;
        }

        Map<String, Object> limits = map(raw.get("limits"));
        Map<String, Object> quotas = map(raw.get("quotas"));
        Map<String, Object> routing = map(raw.get("routing"));
        double seconds = number(limits.get("maxDurationSeconds"), fallback.limits().maxDuration().toSeconds());
        Duration duration = seconds > 0 ? Duration.ofMillis((long) (seconds * 1000)) : maxDuration;
        double warn = number(limits.get("warnRatio"), fallback.limits().warnRatio());

        BudgetLimits parsedLimits = new BudgetLimits(
            duration == null || duration.isZero() || duration.isNegative()
                ? fallback.limits().maxDuration() : duration,
            (long) number(limits.get("maxInputTokens"), fallback.limits().maxInputTokens()),
            (long) number(limits.get("maxOutputTokens"), fallback.limits().maxOutputTokens()),
            number(limits.get("maxCostUsd"), fallback.limits().maxCostUsd()),
            (int) number(limits.get("maxToolCalls"), fallback.limits().maxToolCalls()),
            (int) number(limits.get("maxRetries"), fallback.limits().maxRetries()),
            warn > 0 && warn <= 1 ? warn : fallback.limits().warnRatio()
        );
        double reserved = number(raw.get("reservedCostUsd"), -1);
        if (reserved >= 0) {
            double cap = Math.min(parsedLimits.maxCostUsd(), Math.max(0.000001, reserved));
            parsedLimits = new BudgetLimits(
                parsedLimits.maxDuration(),
                parsedLimits.maxInputTokens(),
                parsedLimits.maxOutputTokens(),
                cap,
                parsedLimits.maxToolCalls(),
                parsedLimits.maxRetries(),
                parsedLimits.warnRatio()
            );
        }

        String policy = string(routing.get("policy"));
        if (policy == null
            || !(FREE_ONLY.equals(policy) || FREE_THEN_PAID.equals(policy)
                || PAID_FOR_COMPLEX.equals(policy) || PAID_ONLY.equals(policy))) {
            policy = fallback.routingPolicy();
        }

        String free = compatibleModel(string(routing.get("freeModel")), provider, fallback.freeModel());
        String paid = compatibleModel(string(routing.get("paidModel")), provider,
            provider == null ? fallback.paidModel() : provider.model());
        Map<String, ModelPrice> prices = parsePrices(map(raw.get("prices")));
        Map<String, Object> killSwitch = map(raw.get("killSwitch"));

        return new HarnessBudgetPolicy(
            parsedLimits,
            number(quotas.get("dailyCostUsd"), fallback.dailyCostLimitUsd()),
            (int) number(quotas.get("projectMaxConcurrentRuns"), fallback.projectMaxConcurrentRuns()),
            (int) number(quotas.get("agentMaxConcurrentRuns"), fallback.agentMaxConcurrentRuns()),
            policy,
            free,
            paid,
            (int) number(routing.get("complexityThreshold"), fallback.complexityThreshold()),
            prices,
            number(raw.get("dailySpendUsd"), 0),
            string(killSwitch.get("reason"))
        );
    }

    public ModelPrice priceFor(String model) {
        String key = normaliseModel(model);
        ModelPrice price = prices.get(key);
        return price != null ? price : ModelPrice.free(key);
    }

    /**
     * Per-run limits capped by the remaining project daily budget. A run that
     * starts near the daily limit must stop mid-run rather than spend its full
     * per-run budget past the project quota.
     */
    public BudgetLimits effectiveRunLimits() {
        if (dailyCostLimitUsd <= 0) {
            return limits;
        }
        double remaining = Math.max(0, dailyCostLimitUsd - dailySpendUsd);
        double cap = Math.min(limits.maxCostUsd(), Math.max(0.000001, remaining));
        if (cap >= limits.maxCostUsd()) {
            return limits;
        }
        return new BudgetLimits(
            limits.maxDuration(),
            limits.maxInputTokens(),
            limits.maxOutputTokens(),
            cap,
            limits.maxToolCalls(),
            limits.maxRetries(),
            limits.warnRatio()
        );
    }

    public double remainingDailyCostUsd() {
        if (dailyCostLimitUsd <= 0) {
            return Double.MAX_VALUE;
        }
        return Math.max(0, dailyCostLimitUsd - dailySpendUsd);
    }

    private static Map<String, ModelPrice> parsePrices(Map<String, Object> raw) {
        if (raw == null || raw.isEmpty()) {
            return Map.of();
        }
        Map<String, ModelPrice> parsed = new LinkedHashMap<>();
        for (Map.Entry<String, Object> entry : raw.entrySet()) {
            Map<String, Object> price = map(entry.getValue());
            if (price.isEmpty()) {
                continue;
            }
            parsed.put(normaliseModel(entry.getKey()), new ModelPrice(
                normaliseModel(entry.getKey()),
                number(price.get("inputPerMillion"), 0),
                number(price.get("outputPerMillion"), 0),
                number(price.get("cachedPerMillion"), 0)
            ));
        }
        return parsed;
    }

    private static String compatibleModel(String candidate, ProviderSettings provider, String fallback) {
        if (candidate == null || candidate.isBlank()) {
            return fallback;
        }
        String type = provider == null ? "generic" : provider.normalizedType();
        int slash = candidate.indexOf('/');
        if (slash > 0) {
            String prefix = candidate.substring(0, slash).toLowerCase(Locale.ROOT);
            String canonical = switch (prefix) {
                case "claude" -> "anthropic";
                default -> prefix;
            };
            String expected = switch (type) {
                case "opencode-go", "opencodego" -> "opencode-go";
                case "opencode", "opencode-console" -> "opencode";
                case "claude", "anthropic" -> "anthropic";
                case "openai" -> "openai";
                default -> "vibecode";
            };
            return canonical.equals(expected) ? candidate : fallback;
        }
        // A bare free model name is only meaningful for the OpenCode gateway;
        // other providers must keep their configured model.
        boolean gateway = "opencode".equals(type) || "opencode-go".equals(type)
            || "opencodego".equals(type);
        return gateway ? candidate : fallback;
    }

    private static String defaultFreeModel(String model, ProviderSettings provider) {
        String type = provider == null ? "generic" : provider.normalizedType();
        boolean gateway = "opencode".equals(type) || "opencode-go".equals(type)
            || "opencodego".equals(type);
        String configured = System.getenv("HARNESS_FREE_MODEL");
        if (configured != null && !configured.isBlank()) {
            return compatibleModel(configured, provider, model);
        }
        return gateway ? "beam-free" : model;
    }

    private static String normaliseModel(String model) {
        if (model == null || model.isBlank()) {
            return "default";
        }
        int slash = model.lastIndexOf('/');
        return slash >= 0 && slash < model.length() - 1 ? model.substring(slash + 1) : model;
    }

    private static int envInt(String name, int fallback) {
        try {
            String value = System.getenv(name);
            return value == null || value.isBlank() ? fallback : Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private static double envDouble(String name, double fallback) {
        try {
            String value = System.getenv(name);
            return value == null || value.isBlank() ? fallback : Double.parseDouble(value.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return Collections.emptyMap();
    }

    private static String string(Object value) {
        if (value == null) {
            return null;
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() || "null".equals(text) ? null : text;
    }

    private static double number(Object value, double fallback) {
        if (value instanceof Number number) {
            return number.doubleValue();
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return Double.parseDouble(text.trim());
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }
}
