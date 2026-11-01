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
import java.util.Set;

/**
 * Writes a temporary OpenCode config and provider key outside the repository.
 *
 * <p>The harness runs with a per-run HOME, so this file is the only place the
 * provider key touches disk. It is deleted with the temporary directory when the
 * session ends.</p>
 */
public final class OpenCodeConfigWriter {

    private static final Set<String> KNOWN_PROVIDER_IDS = Set.of(
        "opencode", "opencode-go", "anthropic", "openai", "vibecode", "claude"
    );

    private OpenCodeConfigWriter() {
    }

    /**
     * @deprecated The workspace is not needed to write the config; use
     * {@link #write(Path, ProviderSettings, HarnessConfig)}.
     */
    @Deprecated
    public static Path write(
        Path tempDir,
        ProviderSettings provider,
        HarnessConfig config,
        Path workspace
    ) throws IOException {
        return write(tempDir, provider, config);
    }

    public static Path write(
        Path tempDir,
        ProviderSettings provider,
        HarnessConfig config
    ) throws IOException {
        Files.createDirectories(tempDir);

        ModelSelection selection = selectModel(provider, config);

        Path keyFile = tempDir.resolve("provider.key");
        if (provider.hasApiKey()) {
            Files.writeString(keyFile, provider.apiKey(), StandardCharsets.UTF_8);
            restrictPermissions(keyFile);
        }

        ProviderMapping mapping = mapProvider(
            provider.normalizedType(),
            selection.model(),
            provider.baseUrl(),
            provider.hasApiKey());

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("$schema", "https://opencode.ai/config.json");
        root.put("autoupdate", false);
        root.put("share", "disabled");
        root.put("snapshot", false);
        root.put("permission", permissions());

        Map<String, Object> providers = new LinkedHashMap<>();
        providers.put(mapping.providerId, providerEntry(mapping));
        root.put("provider", providers);
        root.put("model", selection.modelId());
        root.put("small_model", selection.modelId());

        Path configFile = tempDir.resolve("opencode.json");
        ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.INDENT_OUTPUT);
        mapper.writeValue(configFile.toFile(), root);
        restrictPermissions(configFile);
        return configFile;
    }

    /**
     * Normalize the configured model and reject an override that names a
     * provider different from the temporary config's only provider. An
     * {@code HARNESS_MODEL=anthropic/...} override on an opencode-go agent
     * would otherwise point at a provider that does not exist.
     */
    private static ModelSelection selectModel(ProviderSettings provider, HarnessConfig config) throws IOException {
        String providerId = providerIdFor(provider.normalizedType());
        String raw = config != null && config.modelOverride() != null
            && !config.modelOverride().isBlank()
            ? config.modelOverride().trim()
            : provider.model();
        if (raw == null || raw.isBlank()) {
            throw new IOException("No model configured for the harness provider");
        }

        String qualifiedProvider = null;
        String model = raw;
        int slash = raw.indexOf('/');
        if (slash > 0 && slash < raw.length() - 1) {
            String prefix = raw.substring(0, slash);
            if (KNOWN_PROVIDER_IDS.contains(prefix)) {
                qualifiedProvider = canonicalProviderId(prefix);
                model = raw.substring(slash + 1);
            }
        }
        if (qualifiedProvider != null && !qualifiedProvider.equals(providerId)) {
            throw new IOException("HARNESS_MODEL provider '" + qualifiedProvider
                + "' does not match the configured provider '" + providerId + "'");
        }
        if (model.isBlank()) {
            throw new IOException("No model configured for the harness provider");
        }
        return new ModelSelection(providerId + "/" + model, model);
    }

    private static String providerIdFor(String type) {
        String normalized = type == null ? "generic" : type.replace('_', '-');
        return switch (normalized) {
            case "opencode-go", "opencodego" -> "opencode-go";
            case "opencode", "opencode-console" -> "opencode";
            case "claude", "anthropic" -> "anthropic";
            case "openai" -> "openai";
            default -> "vibecode";
        };
    }

    private static String canonicalProviderId(String id) {
        return "claude".equals(id) ? "anthropic" : id;
    }

    private static ProviderMapping mapProvider(
        String type,
        String model,
        String baseUrl,
        boolean hasApiKey
    ) {
        String providerId = providerIdFor(type);
        boolean custom = "vibecode".equals(providerId);
        return new ProviderMapping(providerId, model, baseUrl, custom, hasApiKey);
    }

    private static Map<String, Object> providerEntry(ProviderMapping mapping) {
        Map<String, Object> entry = new LinkedHashMap<>();
        if (mapping.custom) {
            entry.put("npm", "@ai-sdk/openai-compatible");
            entry.put("name", "Vibecode provider");
        }

        Map<String, Object> options = new LinkedHashMap<>();
        // Preserve a custom base URL for every provider type. The legacy path
        // supports it for opencode/opencode-go too; dropping it silently sent
        // those agents to the public endpoint.
        if (mapping.baseUrl != null && !mapping.baseUrl.isBlank()) {
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
        Map<String, Object> edit = new LinkedHashMap<>();
        edit.put("*", "allow");
        for (String denied : List.of(
            ".git/**", "**/.git/**",
            "opencode.json", "**/opencode.json",
            "opencode.jsonc", "**/opencode.jsonc",
            ".opencode/**", "**/.opencode/**"
        )) {
            edit.put(denied, "deny");
        }
        permission.put("edit", edit);

        for (String tool : List.of("grep", "glob", "todowrite", "lsp")) {
            permission.put(tool, "allow");
        }
        permission.put("webfetch", "deny");
        permission.put("websearch", "deny");
        permission.put("task", "deny");
        permission.put("question", "deny");
        permission.put("doom_loop", "deny");
        permission.put("external_directory", "deny");

        Map<String, Object> read = new LinkedHashMap<>();
        read.put("*", "allow");
        read.put("*.env", "deny");
        read.put("*.env.*", "deny");
        read.put(".env*", "deny");
        read.put("**/.env*", "deny");
        // Allow configuration examples after the deny rules.
        read.put("*.env.example", "allow");
        read.put("**/.env.example", "allow");
        read.put("**/*.env.example", "allow");
        permission.put("read", read);

        Map<String, Object> bash = new LinkedHashMap<>();
        bash.put("*", "allow");
        for (String denied : List.of(
            "git push*", "git commit*", "git merge*", "git reset --hard*",
            "git clean*", "git -C * push*", "git -c * push*",
            "bash -c *git*push*", "sh -c *git*push*", "env *git*push*",
            "rm -rf*", "sudo*", "docker*", "kubectl*",
            "curl*|*sh*", "wget*|*sh*", "*| sh*", "*| bash*", "*|sh*", "*|bash*"
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

    private record ModelSelection(String modelId, String model) {
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
    }
}
