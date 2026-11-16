package com.vibecode.agent.harness;

/** One versioned model price row, in USD per million tokens. */
public record ModelPrice(
    String model,
    double inputPerMillion,
    double outputPerMillion,
    double cachedPerMillion
) {

    public static ModelPrice free(String model) {
        return new ModelPrice(model, 0, 0, 0);
    }

    public double cost(long inputTokens, long outputTokens, long cachedTokens) {
        return (inputTokens / 1_000_000.0) * inputPerMillion
            + (outputTokens / 1_000_000.0) * outputPerMillion
            + (cachedTokens / 1_000_000.0) * cachedPerMillion;
    }
}
