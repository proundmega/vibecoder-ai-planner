package com.vibecode.agent.harness;

import java.time.Duration;

/**
 * Hard limits for one harness run (fg-38 FR3/FR4/FR9).
 *
 * <p>Every dimension is enforced independently. A zero or negative value
 * disables that dimension, except duration which always has a positive value.</p>
 */
public record BudgetLimits(
    Duration maxDuration,
    long maxInputTokens,
    long maxOutputTokens,
    double maxCostUsd,
    int maxToolCalls,
    int maxRetries,
    double warnRatio
) {

    public static final double DEFAULT_WARN_RATIO = 0.8;

    public BudgetLimits {
        if (maxDuration == null || maxDuration.isNegative() || maxDuration.isZero()) {
            throw new IllegalArgumentException("maxDuration must be positive");
        }
        if (warnRatio <= 0 || warnRatio > 1) {
            throw new IllegalArgumentException("warnRatio must be greater than 0 and at most 1");
        }
    }

    public static BudgetLimits defaults(Duration maxDuration) {
        return new BudgetLimits(
            maxDuration == null || maxDuration.isNegative() || maxDuration.isZero()
                ? Duration.ofMinutes(45)
                : maxDuration,
            1_200_000L,
            300_000L,
            5.0,
            100,
            2,
            DEFAULT_WARN_RATIO
        );
    }
}
