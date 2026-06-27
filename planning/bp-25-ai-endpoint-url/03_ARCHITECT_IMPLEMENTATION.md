# bp-25: Add AI_ENDPOINT_URL + OpenAI-Compatible Provider Adapter — Implementation

**Status**: planned
**Priority**: P0
**Effort**: Medium
**Scope**: Agent

## Purpose
Allow agents to use any OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp) instead of only Claude/OpenAI.

## Implementation Order

1. **Modify AgentConfig.java** — Add AI_ENDPOINT_URL field
   - *Depends on*: nothing

2. **Create OpenAiCompatibleProvider.java** — New provider class
   - Implements AiProvider interface
   - POST to {endpointUrl}/chat/completions with standard OpenAI request body
   - Parse response: choices[0].message.content
   - Skip Authorization header if apiKey is null/empty
   - *Depends on*: nothing

3. **Modify TicketProcessor.java** — Use factory method for provider selection
   - If AI_ENDPOINT_URL is set, use OpenAiCompatibleProvider
   - Otherwise fall back to existing provider selection
   - *Depends on*: Steps 1-2

## Per-File Action Plan

### `agent/src/.../AgentConfig.java` (MODIFY)
- Add after AI_API_KEY:
  ```java
  public static final String AI_ENDPOINT_URL = getEnv("AI_ENDPOINT_URL", "");
  ```

### `agent/src/.../OpenAiCompatibleProvider.java` (CREATE)
- Implements `com.vibecode.agent.AiProvider`
- Constructor: `OpenAiCompatibleProvider(String endpointUrl, String model, String apiKey)`
- `generateResponse(systemPrompt, userMessage)`:
  ```java
  OkHttpClient client = new OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .build();
  // Build JSON body: { model, messages: [{role: system, content}, {role: user, content}], max_tokens: 4096 }
  // POST to endpointUrl/chat/completions
  // Parse response JSON: choices[0].message.content
  ```

### `agent/src/.../TicketProcessor.java` (MODIFY)
- Replace hardcoded ClaudeProvider/OpenAiProvider construction:
  ```java
  AiProvider provider;
  if (!AgentConfig.AI_ENDPOINT_URL.isEmpty()) {
      provider = new OpenAiCompatibleProvider(
          AgentConfig.AI_ENDPOINT_URL,
          AgentConfig.AI_MODEL,
          AgentConfig.AI_API_KEY
      );
  } else if ("openai".equals(AgentConfig.AI_PROVIDER)) {
      provider = new OpenAiProvider(AgentConfig.AI_API_KEY, AgentConfig.AI_MODEL);
  } else {
      provider = new ClaudeProvider(AgentConfig.AI_API_KEY, AgentConfig.AI_MODEL);
  }
  ```

## Test Plan
1. Set AI_ENDPOINT_URL to a local Ollama instance
2. Run agent against a test ticket
3. Verify agent generates and writes code using the local model
4. Unset AI_ENDPOINT_URL, verify agent falls back to Claude/OpenAI

## Rollback Steps
Revert Java changes and rebuild.
