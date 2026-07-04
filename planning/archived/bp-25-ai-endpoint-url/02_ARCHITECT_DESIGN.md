# bp-25: Add AI_ENDPOINT_URL + OpenAI-Compatible Provider Adapter — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Agent

## Current State

Agent provider selection in `AgentConfig.java`:
```java
AI_PROVIDER = getEnv("AI_PROVIDER", "claude"); // "claude" or "openai"
AI_MODEL = getEnv("AI_MODEL", "claude-sonnet-4-20250514");
AI_API_KEY = getEnv("AI_API_KEY", "");
```

Existing providers:
- `ClaudeProvider.java` — calls Anthropic Messages API, endpoint hardcoded
- `OpenAiProvider.java` — calls OpenAI Chat Completions, endpoint hardcoded

Both implement `AiProvider` interface with method: `String generateResponse(String systemPrompt, String userMessage)`.

## Proposed Solution

### New Config

```java
// In AgentConfig.java, new fields:
String AI_ENDPOINT_URL = getEnv("AI_ENDPOINT_URL", "");  // e.g. "http://192.168.1.50:11434/v1"
// AI_API_KEY remains but can be empty for local models
// AI_MODEL remains — used both for cloud and local (e.g. "codellama:34b")
```

### New Provider: OpenAiCompatibleProvider

```java
class OpenAiCompatibleProvider implements AiProvider {
    String endpointUrl;     // e.g. "http://ollama:11434/v1"
    String model;           // e.g. "codellama:34b"
    String apiKey;          // optional — null for local models

    String generateResponse(String systemPrompt, String userMessage) {
        POST to {endpointUrl}/chat/completions
        Body: {
            "model": model,
            "messages": [
                {"role": "system", "content": systemPrompt},
                {"role": "user", "content": userMessage}
            ],
            "max_tokens": 4096,
            "temperature": 0.2
        }
        Headers: { "Authorization": "Bearer " + apiKey }  // omitted if apiKey is null
        Response: parse choices[0].message.content
    }
}
```

### Selection Logic (in TicketProcessor or factory)

```java
AiProvider selectProvider(AgentConfig config) {
    if (!config.AI_ENDPOINT_URL.isEmpty()) {
        return new OpenAiCompatibleProvider(config.AI_ENDPOINT_URL, config.AI_MODEL, config.AI_API_KEY);
    }
    switch (config.AI_PROVIDER) {
        case "claude": return new ClaudeProvider(config.AI_API_KEY, config.AI_MODEL);
        case "openai": return new OpenAiProvider(config.AI_API_KEY, config.AI_MODEL);
        default: throw new IllegalArgumentException("Unknown provider: " + config.AI_PROVIDER);
    }
}
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `agent/src/.../AgentConfig.java` | MODIFY | Add AI_ENDPOINT_URL field |
| `agent/src/.../OpenAiCompatibleProvider.java` | CREATE | New class implementing AiProvider |
| `agent/src/.../TicketProcessor.java` | MODIFY | Use selectProvider factory logic |

## Alternatives Considered

- **Alternative: One provider class with configurable endpoint** — Rejected because Claude and OpenAI have different API shapes. Better to keep ClaudeProvider/OpenAiProvider as-is and add a new adapter for the OpenAI-compatible format.
