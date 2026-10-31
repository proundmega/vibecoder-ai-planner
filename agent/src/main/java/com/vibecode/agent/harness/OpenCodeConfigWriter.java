package com.vibecode.agent.harness;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Writes a temporary OpenCode config and provider key outside the repository.
 *
 * <p>The harness runs with a per-run HOME, so this file is the only place the
 * provider key touches disk. It is deleted with the temporary directory when the
 * session ends.</p>
 */
public final class OpenCodeConfigWriter {

    private OpenCodeConfigWriter() {
    }

    public static Path write(
        Path tempDir,
        ProviderSettings provider,
        HarnessConfig config,
        Path workspace
    ) throws IOException {
        Files.createDirectories(tempDir);

        String rawModel = selectModel(provider, config);
        if (rawModel == null || rawModel.isBlank()) {
            throw new IOException("No model configured for the harness provider");
        }

        Path keyFile = tempDir.resolve("provider.key");
        if (provider.hasApiKey()) {
            Files.writeString(keyFile, provider.apiKey(), StandardCharsets.UTF_8);
            restrictPermissions(keyFile);
        }

        ProviderMapping mapping = mapProvider(
            provider.normalizedType(), rawModel, provider.baseUrl(), provider.hasApiKey());
        String modelId = mapping.modelId();

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("$schema", "https://opencode.ai/config.json");
        root.put("autoupdate", false);
        root.put("share", "disabled");
        root.put("snapshot", false);
        root.put("permission", permissions());

        String override = config == null ? null : config.modelOverride();
        if (override != null && !override.isBlank()) {
            modelId = override.contains("/") ? override : mapping.providerId + "/" + override;
        }

        Map<String, Object> providers = new LinkedHashMap<>();
        providers.put(mapping.providerId, providerEntry(mapping));
        root.put("provider", providers);
        root.put("model", modelId);
        root.put("small_model", modelId);

        Path configFile = tempDir.resolve("opencode.json");
        ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(configFile.toFile(), root);
        restrictPermissions(configFile);
        return configFile;
    }

    private static String selectModel(ProviderSettings provider, HarnessConfig config) {
        if (config != null && config.modelOverride() != null && !config.modelOverride().isBlank()) {
            String override = config.modelOverride().trim();
            int slash = override.indexOf('/');
            return slash >= 0 ? override.substring(slash + 1) : override;
        }
        return provider.model();
    }

    private static ProviderMapping mapProvider(
        String type,
        String model,
        String baseUrl,
        boolean hasApiKey
    ) {
        String normalized = type == null ? "generic" : type.replace('_', '-');
        switch (normalized) {
            case "opencode-go":
            case "opencodego":
                return new ProviderMapping("opencode-go", model, null, false, hasApiKey);
            case "opencode":
            case "opencode-console":
                return new ProviderMapping("opencode", model, null, false, hasApiKey);
            case "claude":
            case "anthropic":
                return new ProviderMapping("anthropic", model, null, false, hasApiKey);
            case "openai":
                return new ProviderMapping("openai", model, null, false, hasApiKey);
            default:
                return new ProviderMapping("vibecode", model, baseUrl, true, hasApiKey);
        }
    }

    private static Map<String, Object> providerEntry(ProviderMapping mapping) {
        Map<String, Object> entry = new LinkedHashMap<>();
        if (mapping.custom) {
            entry.put("npm", "@ai-sdk/openai-compatible");
            entry.put("name", "Vibecode provider");
        }

        Map<String, Object> options = new LinkedHashMap<>();
        if (mapping.custom && mapping.baseUrl != null && !mapping.baseUrl.isBlank()) {
            options.put("baseURL", mapping.baseUrl);
        }
        if (mapping.hasApiKey) {
            options.put("apiKey", "{file:./provider.key}");
        }
        if (!options.isEmpty()) {
            entry.put("options", options);
        }

        String modelName = mapping.model;
        entry.put("models", Map.of(modelName, Map.of("name", modelName)));
        return entry;
    }

    private static Map<String, Object> permissions() {
        Map<String, Object> permission = new LinkedHashMap<>();
        for (String tool : List.of("edit", "grep", "glob", "todowrite", "lsp")) {
            permission.put(tool, "allow");
        }
        permission.put("webfetch", "deny");
        permission.put("websearch", "deny");
        permission.put("task", "deny");
        permission.put("question", "deny");
        permission.put("external_directory", "deny");

        Map<String, Object> read = new LinkedHashMap<>();
        read.put("*", "allow");
        read.put("*.env", "deny");
        read.put("*.env.*", "deny");
        read.put(".env*", "deny");
        read.put("**/.env*", "deny");
        permission.put("read", read);

        Map<String, Object> bash = new LinkedHashMap<>();
        bash.put("*", "allow");
        for (String denied : List.of(
            "git push*", "git commit*", "git merge*", "git reset --hard*",
            "git clean*", "rm -rf*", "sudo*", "docker*", "kubectl*",
            "curl*|*sh*", "wget*|*sh*"
        )) {
            bash.put(denied, "deny");
        }
        permission.put("bash", bash);

        return permission;
    }

    private static void restrictPermissions(Path file) {
        try {
            if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
                Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
            }
        } catch (Exception ignored) {
            // Windows and other non-POSIX filesystems are handled by OS ACLs.
        }
    }

    private static final class ProviderMapping {
        private final String providerId;
        private final String model;
        private final String baseUrl;
        private final boolean custom;
        private final boolean hasApiKey;

        private ProviderMapping(
            String providerId,
            String model,
            String baseUrl,
            boolean custom,
            boolean hasApiKey
        ) {
            this.providerId = providerId;
            this.model = model;
            this.baseUrl = baseUrl;
            this.custom = custom;
            this.hasApiKey = hasApiKey;
        }

        private String modelId() {
            return providerId + "/" + model;
        }
    }
}
