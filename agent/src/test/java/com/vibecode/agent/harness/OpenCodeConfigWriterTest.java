package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OpenCodeConfigWriterTest {

    @TempDir
    Path tempDir;

    private final ObjectMapper mapper = new ObjectMapper();

    private HarnessConfig config(String modelOverride) {
        return new HarnessConfig(
            "opencode",
            "opencode",
            Duration.ofSeconds(30),
            Duration.ofSeconds(30),
            Duration.ofMinutes(45),
            List.of(),
            List.of(".env*", ".github/workflows/**", "**/secrets/**"),
            modelOverride
        );
    }

    @Test
    void writesOpenCodeGoProviderWithoutLeakingKey() throws Exception {
        ProviderSettings provider = new ProviderSettings(
            "opencode-go", "oc_sk_secret", null, "beam-free", 4096);

        Path configFile = OpenCodeConfigWriter.write(tempDir, provider, config(null), tempDir);
        JsonNode root = mapper.readTree(configFile.toFile());

        assertEquals("opencode-go/beam-free", root.path("model").asText());
        assertEquals("disabled", root.path("share").asText());
        assertFalse(root.path("autoupdate").asBoolean());
        assertEquals("deny", root.path("permission").path("question").asText());
        assertEquals("deny", root.path("permission").path("bash").path("git push*").asText());
        assertTrue(root.path("provider").has("opencode-go"));

        String configText = Files.readString(configFile);
        assertFalse(configText.contains("oc_sk_secret"));
        assertEquals("oc_sk_secret", Files.readString(tempDir.resolve("provider.key")).trim());
    }

    @Test
    void writesGenericOpenAiCompatibleProvider() throws Exception {
        ProviderSettings provider = new ProviderSettings(
            "generic", "sk-local", "http://localhost:11434/v1", "qwen", 4096);

        Path configFile = OpenCodeConfigWriter.write(tempDir, provider, config(null), tempDir);
        JsonNode root = mapper.readTree(configFile.toFile());

        assertEquals("vibecode/qwen", root.path("model").asText());
        JsonNode entry = root.path("provider").path("vibecode");
        assertEquals("@ai-sdk/openai-compatible", entry.path("npm").asText());
        assertEquals("http://localhost:11434/v1", entry.path("options").path("baseURL").asText());
    }

    @Test
    void honorsFullyQualifiedModelOverride() throws Exception {
        ProviderSettings provider = new ProviderSettings(
            "opencode-go", "oc_sk_secret", null, "beam-free", 4096);

        Path configFile = OpenCodeConfigWriter.write(tempDir, provider, config("opencode-go/paid-model"), tempDir);
        JsonNode root = mapper.readTree(configFile.toFile());

        assertEquals("opencode-go/paid-model", root.path("model").asText());
        assertNotEquals("opencode-go/opencode-go/paid-model", root.path("model").asText());
    }

    @Test
    void mapsClaudeAndOpenAiProviders() throws Exception {
        Path claude = OpenCodeConfigWriter.write(
            tempDir.resolve("claude"),
            new ProviderSettings("claude", "key", null, "claude-sonnet-4", 4096),
            config(null),
            tempDir
        );
        assertEquals("anthropic/claude-sonnet-4",
            mapper.readTree(claude.toFile()).path("model").asText());

        Path openai = OpenCodeConfigWriter.write(
            tempDir.resolve("openai"),
            new ProviderSettings("openai", "key", null, "gpt-4.1", 4096),
            config(null),
            tempDir
        );
        assertEquals("openai/gpt-4.1",
            mapper.readTree(openai.toFile()).path("model").asText());
    }
}
