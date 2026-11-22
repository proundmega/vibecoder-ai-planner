package com.vibecode.agent.harness;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Live budget meter for one harness run (fg-38 FR1-FR4/FR9).
 *
 * <p>Consumes OpenCode events, tracks cumulative tokens/cost/tool calls and
 * wall-clock time, warns once per dimension at the soft threshold, and invokes
 * the breach callback once at 100%. The supervisor turns a breach into a
 * `budget_exceeded` run with no publish.</p>
 */
public final class HarnessBudgetTracker {

    public record BudgetWarning(String dimension, double used, double limit, double ratio) {
    }

    public record UsageSnapshot(
        long inputTokens,
        long outputTokens,
        long cachedTokens,
        double costUsd,
        int toolCalls,
        long durationMs,
        long waitedMs
    ) {
    }

    private final BudgetLimits limits;
    private ModelPrice price;
    private final Instant startedAt;
    private final Supplier<Instant> clock;
    private final Consumer<BudgetWarning> onWarning;
    private final Consumer<String> onBreach;

    private final Map<String, long[]> tokenSources = new HashMap<>();
    private final Map<String, Double> costSources = new HashMap<>();
    private final Set<String> seenToolCalls = new HashSet<>();
    private final Set<String> warnedDimensions = new HashSet<>();

    private long inputTokens;
    private long outputTokens;
    private long cachedTokens;
    private double costUsd;
    private int toolCalls;
    private boolean breached;
    private String breachReason;
    private Instant pausedAt;
    private long pausedMs;

    public HarnessBudgetTracker(
        BudgetLimits limits,
        ModelPrice price,
        Instant startedAt,
        Consumer<BudgetWarning> onWarning,
        Consumer<String> onBreach
    ) {
        this(limits, price, startedAt, Instant::now, onWarning, onBreach);
    }

    HarnessBudgetTracker(
        BudgetLimits limits,
        ModelPrice price,
        Instant startedAt,
        Supplier<Instant> clock,
        Consumer<BudgetWarning> onWarning,
        Consumer<String> onBreach
    ) {
        if (limits == null) {
            throw new IllegalArgumentException("limits are required");
        }
        this.limits = limits;
        this.price = price == null ? ModelPrice.free("unknown") : price;
        this.startedAt = startedAt == null ? Instant.now() : startedAt;
        this.clock = clock == null ? Instant::now : clock;
        this.onWarning = onWarning == null ? warning -> { } : onWarning;
        this.onBreach = onBreach == null ? reason -> { } : onBreach;
    }

    public BudgetLimits limits() {
        return limits;
    }

    public Instant startedAt() {
        return startedAt;
    }

    /**
     * Consume one OpenCode event. Returns a tool call when the event is a new
     * invocation (part updates for the same call id are ignored).
     */
    public synchronized Optional<OpenCodeUsage.ToolCall> accept(HarnessEvent event) {
        if (event == null) {
            return Optional.empty();
        }
        consumeTokens(OpenCodeUsage.tokens(event.payload()));
        Optional<OpenCodeUsage.ToolCall> tool = consumeTool(event);
        check();
        return tool;
    }

    private void consumeTokens(OpenCodeUsage.TokenDelta delta) {
        if (delta == null) {
            return;
        }
        long[] previous = tokenSources.computeIfAbsent(
            delta.sourceKey(), ignored -> new long[]{0, 0, 0});
        long nextInput = Math.max(previous[0], delta.inputTokens());
        long nextOutput = Math.max(previous[1], delta.outputTokens());
        long nextCached = Math.max(previous[2], delta.cachedTokens());
        long addInput = Math.max(0, nextInput - previous[0]);
        long addOutput = Math.max(0, nextOutput - previous[1]);
        long addCached = Math.max(0, nextCached - previous[2]);
        tokenSources.put(delta.sourceKey(), new long[]{nextInput, nextOutput, nextCached});
        inputTokens += addInput;
        outputTokens += addOutput;
        cachedTokens += addCached;

        if (delta.costUsd() >= 0) {
            double previousCost = costSources.getOrDefault(delta.sourceKey(), 0.0);
            double nextCost = Math.max(previousCost, delta.costUsd());
            costUsd += Math.max(0, nextCost - previousCost);
            costSources.put(delta.sourceKey(), nextCost);
        } else {
            costUsd += price.cost(addInput, addOutput, addCached);
        }
    }

    private Optional<OpenCodeUsage.ToolCall> consumeTool(HarnessEvent event) {
        OpenCodeUsage.ToolCall tool = OpenCodeUsage.toolCall(event.payload());
        if (tool == null) {
            return Optional.empty();
        }
        String key = tool.callId() != null && !tool.callId().isBlank()
            ? tool.callId()
            : Integer.toHexString(String.valueOf(event.payload()).hashCode());
        if (seenToolCalls.add(key)) {
            toolCalls++;
            return Optional.of(tool);
        }
        return Optional.empty();
    }

    /**
     * Evaluate every dimension. Called by the event listener and a wall-clock
     * watchdog (verification time counts toward the run budget).
     */
    public synchronized void check() {
        if (breached) {
            return;
        }
        Duration maxDuration = limits.maxDuration();
        long activeMs = activeDurationMs();
        double timeRatio = ratio(activeMs, maxDuration.toMillis());
        double inputRatio = ratio(inputTokens, limits.maxInputTokens());
        double outputRatio = ratio(outputTokens, limits.maxOutputTokens());
        double costRatio = ratio(costUsd, limits.maxCostUsd());
        double toolRatio = ratio(toolCalls, limits.maxToolCalls());

        warn("time", timeRatio, activeMs / 1000.0, maxDuration.toSeconds());
        warn("input_tokens", inputRatio, inputTokens, limits.maxInputTokens());
        warn("output_tokens", outputRatio, outputTokens, limits.maxOutputTokens());
        warn("cost_usd", costRatio, costUsd, limits.maxCostUsd());
        warn("tool_calls", toolRatio, toolCalls, limits.maxToolCalls());

        if (timeRatio >= 1.0) {
            breach("wall-clock budget exhausted");
        } else if (inputRatio >= 1.0) {
            breach("input token budget exhausted");
        } else if (outputRatio >= 1.0) {
            breach("output token budget exhausted");
        } else if (costRatio >= 1.0) {
            breach("cost budget exhausted");
        } else if (toolRatio >= 1.0) {
            breach("tool-call budget exhausted");
        }
    }

    private void warn(String dimension, double ratio, double used, double limit) {
        if (ratio < limits.warnRatio() || ratio >= 1.0) {
            return;
        }
        if (!warnedDimensions.add(dimension)) {
            return;
        }
        try {
            onWarning.accept(new BudgetWarning(dimension, used, limit, ratio));
        } catch (RuntimeException ignored) {
            // Observability hooks must not break metering.
        }
    }

    private void breach(String reason) {
        breached = true;
        breachReason = reason;
        try {
            onBreach.accept(reason);
        } catch (RuntimeException ignored) {
            // The caller also checks breached() before publishing.
        }
    }

    public synchronized boolean breached() {
        return breached;
    }

    /** Force a breach from a backend quota response. */
    public synchronized void forceBreach(String reason) {
        if (breached) {
            return;
        }
        breach(reason == null || reason.isBlank() ? "budget exhausted" : reason);
    }

    /** Switch pricing when routing falls back to another model. */
    public synchronized void updatePrice(ModelPrice next) {
        if (next != null) {
            this.price = next;
        }
    }

    public synchronized String breachReason() {
        return breachReason;
    }

    public synchronized double remainingCostUsd() {
        return Math.max(0, limits.maxCostUsd() - costUsd);
    }

    public synchronized UsageSnapshot snapshot() {
        long activeMs = activeDurationMs();
        return new UsageSnapshot(
            inputTokens,
            outputTokens,
            cachedTokens,
            costUsd,
            toolCalls,
            Math.max(0, activeMs),
            waitedMs()
        );
    }

    /**
     * Pause the wall-clock meter while a human answers a question (fg-55
     * NFR2). Token/cost/tool caps stay active. Repeated pause calls are
     * idempotent.
     */
    public synchronized void pause() {
        if (pausedAt == null) {
            pausedAt = clock.get();
        }
    }

    /** Resume the wall-clock meter and accumulate the paused interval. */
    public synchronized void resume() {
        if (pausedAt == null) {
            return;
        }
        pausedMs += Math.max(0, Duration.between(pausedAt, clock.get()).toMillis());
        pausedAt = null;
    }

    public synchronized boolean paused() {
        return pausedAt != null;
    }

    /** Total human wait time, including the current pause. */
    public synchronized long waitedMs() {
        long total = pausedMs;
        if (pausedAt != null) {
            total += Math.max(0, Duration.between(pausedAt, clock.get()).toMillis());
        }
        return total;
    }

    private long activeDurationMs() {
        long total = Duration.between(startedAt, clock.get()).toMillis() - pausedMs;
        if (pausedAt != null) {
            total -= Math.max(0, Duration.between(pausedAt, clock.get()).toMillis());
        }
        return Math.max(0, total);
    }

    private static double ratio(double used, double limit) {
        return limit <= 0 ? 0 : used / limit;
    }
}
