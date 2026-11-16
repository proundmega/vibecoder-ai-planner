package com.vibecode.agent.harness;

import com.vibecode.agent.model.Ticket;

import java.io.IOException;
import java.util.List;
import java.util.Locale;

/**
 * Chooses a model from policy, task complexity, remaining budget and provider
 * health (fg-38 FR6/FR7). The decision is persisted as an event and as run
 * metadata so the reason is auditable.
 */
public final class ModelRouter {

    private static final double PAID_ESTIMATE_INPUT = 50_000;
    private static final double PAID_ESTIMATE_OUTPUT = 10_000;

    /** Outcome of routing; fallbackModel is used for one transient retry. */
    public record RoutingDecision(
        String model,
        String fallbackModel,
        String reason,
        double budgetRemainingUsd,
        int complexity
    ) {
    }

    private final ProviderHealth health;

    public ModelRouter(ProviderHealth health) {
        this.health = health == null ? new ProviderHealth() : health;
    }

    public RoutingDecision select(
        HarnessBudgetPolicy policy,
        Ticket ticket,
        List<String> planningDocs,
        ProviderSettings provider,
        double remainingCostUsd,
        int attempt,
        String explicitModel
    ) throws IOException {
        String configured = provider == null ? null : provider.model();
        String free = firstNonBlank(policy.freeModel(), configured);
        String paid = firstNonBlank(policy.paidModel(), configured);
        int complexity = complexity(ticket, planningDocs);

        if (explicitModel != null && !explicitModel.isBlank()) {
            return new RoutingDecision(
                explicitModel.trim(), null,
                "explicit HARNESS_MODEL override", remainingCostUsd, complexity);
        }

        String policyName = policy.routingPolicy() == null
            ? HarnessBudgetPolicy.FREE_THEN_PAID
            : policy.routingPolicy();
        boolean complex = complexity >= policy.complexityThreshold();

        String selected;
        String reason;
        switch (policyName) {
            case HarnessBudgetPolicy.FREE_ONLY -> {
                selected = free;
                reason = "policy free_only";
            }
            case HarnessBudgetPolicy.PAID_ONLY -> {
                selected = paid;
                reason = "policy paid_only";
            }
            case HarnessBudgetPolicy.PAID_FOR_COMPLEX -> {
                selected = complex ? paid : free;
                reason = complex
                    ? "paid_for_complex: complexity " + complexity + " >= threshold"
                    : "paid_for_complex: complexity " + complexity + " < threshold";
            }
            default -> {
                // free_then_paid: paid only for complex work when the remaining
                // budget covers a conservative estimate.
                double estimate = estimatePaidCost(policy, paid);
                boolean budgetAllows = remainingCostUsd > estimate;
                selected = complex && budgetAllows ? paid : free;
                reason = complex
                    ? (budgetAllows
                        ? "free_then_paid: complex ticket and budget covers paid estimate"
                        : "free_then_paid: paid budget exhausted; using free model")
                    : "free_then_paid: small ticket; using free model";
            }
        }

        if (selected == null || selected.isBlank()) {
            throw new IOException("No harness model is configured by policy or provider");
        }
        if (paid != null && !paid.equals(free) && selected.equals(paid)
            && remainingCostUsd <= 0) {
            if (HarnessBudgetPolicy.PAID_ONLY.equals(policyName)) {
                throw new IOException("Paid model required but the harness budget is exhausted");
            }
            selected = free;
            reason = reason + "; paid budget exhausted, fell back to free model";
        }

        String fallback = fallbackFor(policyName, selected, free, paid);

        if (health.isOpen(selected)) {
            if (fallback != null && !health.isOpen(fallback)) {
                reason = reason + "; primary circuit open, using fallback";
                selected = fallback;
                fallback = fallbackFor(policyName, selected, free, paid);
            } else {
                throw new IOException(
                    "All candidate harness models are circuit-open after repeated provider failures");
            }
        }

        return new RoutingDecision(selected, fallback, reason, remainingCostUsd, complexity);
    }

    /**
     * Complexity is intentionally cheap and deterministic. It never inspects
     * source content, only the ticket text, priority and planning doc count.
     */
    public int complexity(Ticket ticket, List<String> planningDocs) {
        if (ticket == null) {
            return 0;
        }
        int score = 0;
        int words = wordCount(ticket.getTitle()) + wordCount(ticket.getDescription());
        if (words >= 300) score += 2;
        else if (words >= 100) score += 1;

        int docs = planningDocs == null ? 0 : planningDocs.size();
        if (docs >= 4) score += 2;
        else if (docs >= 2) score += 1;

        String priority = ticket.getPriority() == null
            ? "" : ticket.getPriority().toLowerCase(Locale.ROOT);
        if ("critical".equals(priority)) score += 2;
        else if ("high".equals(priority)) score += 1;

        String text = ((ticket.getTitle() == null ? "" : ticket.getTitle()) + " "
            + (ticket.getDescription() == null ? "" : ticket.getDescription()))
            .toLowerCase(Locale.ROOT);
        for (String keyword : List.of(
            "migration", "refactor", "architecture", "security", "database",
            "concurrency", "distributed", "breaking change")) {
            if (text.contains(keyword)) {
                score += 1;
                break;
            }
        }
        return score;
    }

    private static double estimatePaidCost(HarnessBudgetPolicy policy, String paid) {
        if (paid == null) return Double.MAX_VALUE;
        ModelPrice price = policy.priceFor(paid);
        return price.cost((long) PAID_ESTIMATE_INPUT, (long) PAID_ESTIMATE_OUTPUT, 0);
    }

    private static String fallbackFor(String policyName, String selected, String free, String paid) {
        if (HarnessBudgetPolicy.FREE_ONLY.equals(policyName)
            || HarnessBudgetPolicy.PAID_ONLY.equals(policyName)) {
            return null;
        }
        String alternate = selected.equals(paid) ? free : paid;
        return alternate == null || alternate.equals(selected) ? null : alternate;
    }

    private static int wordCount(String value) {
        if (value == null || value.isBlank()) return 0;
        return value.trim().split("\\s+").length;
    }

    private static String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }
}
