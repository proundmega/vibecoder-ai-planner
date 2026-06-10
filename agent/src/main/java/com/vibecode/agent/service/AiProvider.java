package com.vibecode.agent.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.vibecode.agent.config.AgentConfig;
import okhttp3.*;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * Interface for AI provider services.
 * Agents use this to generate code and responses based on ticket descriptions.
 */
public interface AiProvider {
    /**
     * Generate a response based on the ticket description.
     * Returns the generated code/plan as a string.
     */
    String generateResponse(String systemPrompt, String userMessage) throws IOException;

    /**
     * Get the provider type name.
     */
    String getType();
}
