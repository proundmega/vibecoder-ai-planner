# bp-25: Add AI_ENDPOINT_URL + OpenAI-Compatible Provider Adapter — Spec

**Target model**: 14B (Java)
**Date**: 2026-06-27

## File Operations

### MODIFY: `agent/src/com/vibecode/agent/AgentConfig.java`

**Add after** `public static final String AI_API_KEY = ...`:
```java
public static final String AI_ENDPOINT_URL = getEnv("AI_ENDPOINT_URL", "");
```

### CREATE: `agent/src/com/vibecode/agent/OpenAiCompatibleProvider.java`

**Imports**:
```java
package com.vibecode.agent;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;
import java.util.concurrent.TimeUnit;
```

**Fields**:
```
endpointUrl: String   — e.g. "http://ollama:11434/v1"
model: String         — e.g. "codellama:34b"
apiKey: String        — may be empty for local models
objectMapper: ObjectMapper
client: OkHttpClient
log: Logger
```

**Constructor**:
```java
public OpenAiCompatibleProvider(String endpointUrl, String model, String apiKey)
  - this.endpointUrl = endpointUrl.endsWith("/") ? endpointUrl.substring(0, endpointUrl.length()-1) : endpointUrl
  - this.model = model
  - this.apiKey = apiKey
  - this.objectMapper = new ObjectMapper()
  - this.client = new OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(120, TimeUnit.SECONDS)
      .build()
```

**Methods**:
```java
@Override
public String generateResponse(String systemPrompt, String userMessage) throws IOException
  1. ObjectNode body = objectMapper.createObjectNode()
  2. body.put("model", model)
  3. ArrayNode messages = body.putArray("messages")
  4. ObjectNode sysMsg = messages.addObject()
     sysMsg.put("role", "system"); sysMsg.put("content", systemPrompt)
  5. ObjectNode userMsg = messages.addObject()
     userMsg.put("role", "user"); userMsg.put("content", userMessage)
  6. body.put("max_tokens", 4096)
  7. body.put("temperature", 0.2)
  8. Request.Builder reqBuilder = new Request.Builder()
     .url(endpointUrl + "/chat/completions")
     .post(RequestBody.create(body.toString(), MediaType.parse("application/json")))
  9. if (apiKey != null && !apiKey.isEmpty()): reqBuilder.addHeader("Authorization", "Bearer " + apiKey)
  10. Response response = client.newCall(reqBuilder.build()).execute()
  11. if (!response.isSuccessful()): throw IOException("API error " + response.code() + ": " + response.body().string())
  12. JsonNode json = objectMapper.readTree(response.body().string())
  13. return json.get("choices").get(0).get("message").get("content").asText()
```

### MODIFY: `agent/src/com/vibecode/agent/TicketProcessor.java`

**Find the provider initialization block** (where ClaudeProvider or OpenAiProvider is created) and replace with:

```java
AiProvider provider;
if (!AgentConfig.AI_ENDPOINT_URL.isEmpty()) {
    provider = new OpenAiCompatibleProvider(
        AgentConfig.AI_ENDPOINT_URL,
        AgentConfig.AI_MODEL,
        AgentConfig.AI_API_KEY
    );
} else if ("openai".equalsIgnoreCase(AgentConfig.AI_PROVIDER)) {
    provider = new OpenAiProvider(AgentConfig.AI_API_KEY, AgentConfig.AI_MODEL);
} else {
    provider = new ClaudeProvider(AgentConfig.AI_API_KEY, AgentConfig.AI_MODEL);
}
```

**Imports to add** (if not already present):
```java
import com.vibecode.agent.OpenAiCompatibleProvider;
```

## Test Expectations

```
✓ OpenAiCompatibleProvider sends correct request body (model, messages, max_tokens)
✓ OpenAiCompatibleProvider parses choices[0].message.content from response
✓ OpenAiCompatibleProvider skips Authorization header when apiKey is null/empty
✓ OpenAiCompatibleProvider adds Bearer auth when apiKey is set
✓ AgentConfig.AI_ENDPOINT_URL selects OpenAiCompatibleProvider over ClaudeProvider
✓ Agent uses built-in provider when AI_ENDPOINT_URL is empty
```

## Edge Cases to Handle

1. **Endpoint URL with trailing slash**: strip before appending `/chat/completions`
2. **API returns error HTML instead of JSON**: catch IOException with response body in message
3. **Timeout**: 30s connect + 120s read timeout (local models can be slow)
4. **Empty response**: log warning, return empty string
