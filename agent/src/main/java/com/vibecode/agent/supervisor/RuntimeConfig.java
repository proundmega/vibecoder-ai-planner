package com.vibecode.agent.supervisor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parsed supervisor runtime declaration file ({@code agent.ini}).
 *
 * <p>The file contains one or more {@code [runtime "<name>"]} sections. Each
 * section declares a closed role ({@code worker}, {@code reviewer},
 * {@code planner}), a model reference of the form
 * {@code <credential-name>/<model>}, a positive child {@code count}, and an
 * optional reasoning {@code effort} and project. No secret may appear in the
 * file: keys that look like credentials and values that look like tokens are
 * rejected before any child is spawned.</p>
 *
 * <p>Instances are immutable and safe to share between threads.</p>
 */
public final class RuntimeConfig {

    /** Maximum children declared by a single section. */
    public static final int MAX_COUNT = 64;

    /** Maximum section (runtime) name length. */
    public static final int MAX_NAME_LENGTH = 100;

    private static final Pattern SECTION = Pattern.compile(
        "^\\[\\s*runtime\\s+(?:\"([^\"]+)\"|'([^']+)')\\s*\\]$");
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._-]*$");
    private static final Pattern MODEL_REF = Pattern.compile("^[^\\s/]+/[^\\s/]\\S*$");
    private static final Pattern BASE64_LIKE = Pattern.compile("^[A-Za-z0-9+]{32,}={0,2}$");
    private static final Pattern HEX_LIKE = Pattern.compile("^[0-9a-fA-F]{32,}$");

    private static final Set<String> SECRET_KEY_TOKENS = Set.of(
        "apikey", "token", "secret", "password", "credential",
        "authorization", "bearer", "privatekey");

    private static final List<String> SECRET_VALUE_PREFIXES = List.of(
        "sk-", "sk_", "ak_", "ar_", "enr_", "ghp_", "gho_", "ghs_", "ghu_",
        "xoxb", "xoxp", "xoxa", "xoxr", "xoxs", "xoxc", "xoxd");

    private final List<DeclaredRuntime> runtimes;

    private RuntimeConfig(List<DeclaredRuntime> runtimes) {
        this.runtimes = List.copyOf(runtimes);
    }

    /**
     * Read and parse a supervisor config file.
     *
     * @throws IOException              if the file cannot be read
     * @throws IllegalArgumentException if the content is invalid or secret-bearing
     */
    public static RuntimeConfig parse(Path path) throws IOException {
        Objects.requireNonNull(path, "path");
        return parse(Files.readString(path, StandardCharsets.UTF_8));
    }

    /**
     * Parse supervisor config content.
     *
     * @throws IllegalArgumentException if the content is invalid or secret-bearing
     */
    public static RuntimeConfig parse(String content) {
        Objects.requireNonNull(content, "content");
        List<DeclaredRuntime> parsed = new ArrayList<>();
        Set<String> seenSections = new HashSet<>();
        SectionBuilder current = null;
        String[] lines = content.split("\\R", -1);

        for (int index = 0; index < lines.length; index++) {
            int lineNo = index + 1;
            String raw = lines[index];
            if (index == 0 && !raw.isEmpty() && raw.charAt(0) == '\uFEFF') {
                raw = raw.substring(1);
            }
            String line = stripComment(raw).trim();
            if (line.isEmpty()) {
                continue;
            }

            if (line.startsWith("[")) {
                if (current != null) {
                    parsed.add(current.build());
                    current = null;
                }
                Matcher matcher = SECTION.matcher(line);
                if (!matcher.matches()) {
                    if (!line.toLowerCase(Locale.ROOT).startsWith("[runtime")) {
                        throw error(lineNo, null, "unknown section '" + line
                            + "'; only [runtime \"<name>\"] is allowed");
                    }
                    throw error(lineNo, null, "malformed runtime section '" + line
                        + "'; expected [runtime \"<name>\"]");
                }
                String name = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
                validateName(lineNo, name);
                if (!seenSections.add(name)) {
                    throw error(lineNo, name, "duplicate runtime section");
                }
                current = new SectionBuilder(lineNo, name);
                continue;
            }

            int equals = line.indexOf('=');
            if (equals < 0) {
                throw error(lineNo, current != null ? current.name : null,
                    "expected 'key = value'");
            }
            String key = line.substring(0, equals).trim();
            String value = line.substring(equals + 1).trim();
            if (key.isEmpty()) {
                throw error(lineNo, current != null ? current.name : null, "empty key");
            }
            if (current == null) {
                throw error(lineNo, null, "key '" + key + "' outside a [runtime] section");
            }
            current.put(lineNo, key, value);
        }

        if (current != null) {
            parsed.add(current.build());
        }
        return new RuntimeConfig(parsed);
    }

    /** Declared runtimes in file order. Immutable. */
    public List<DeclaredRuntime> runtimes() {
        return runtimes;
    }

    /** One {@link RuntimeSlot} per declared child, in deterministic order. */
    public List<RuntimeSlot> expandedSlots() {
        List<RuntimeSlot> slots = new ArrayList<>();
        for (DeclaredRuntime runtime : runtimes) {
            slots.addAll(runtime.expanded());
        }
        return Collections.unmodifiableList(slots);
    }

    private static String stripComment(String raw) {
        boolean quoted = false;
        char quote = 0;
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            if ((c == '"' || c == '\'') && (i == 0 || raw.charAt(i - 1) != '\\')) {
                if (quoted && c == quote) {
                    quoted = false;
                } else if (!quoted) {
                    quoted = true;
                    quote = c;
                }
                continue;
            }
            if (!quoted && (c == ';' || c == '#')
                    && (i == 0 || Character.isWhitespace(raw.charAt(i - 1)))) {
                return raw.substring(0, i);
            }
        }
        return raw;
    }

    private static void validateName(int lineNo, String name) {
        if (name == null || name.isBlank()) {
            throw error(lineNo, null, "runtime name is required");
        }
        if (name.length() > MAX_NAME_LENGTH) {
            throw error(lineNo, name, "runtime name is longer than " + MAX_NAME_LENGTH + " characters");
        }
        if (!SAFE_NAME.matcher(name).matches() || name.contains("..")) {
            throw error(lineNo, name,
                "runtime name must contain only letters, digits, '.', '_' and '-'");
        }
    }

    static IllegalArgumentException error(int lineNo, String section, String message) {
        String location = section != null
            ? "line " + lineNo + " [runtime \"" + section + "\"]"
            : "line " + lineNo;
        return new IllegalArgumentException(location + ": " + message);
    }

    /** Compute the stable spec hash for a runtime declaration. */
    static String specHash(Role role, String modelRef, Effort effort, String project) {
        String canonical = role.wireName() + "\n"
            + modelRef + "\n"
            + (effort == null ? "" : effort.wireName()) + "\n"
            + (project == null ? "" : project);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }

    private static boolean isSecretKey(String key) {
        String normalized = normalizeKey(key);
        if (normalized.equals("key") || normalized.equals("authorization")
                || normalized.equals("bearer")) {
            return true;
        }
        for (String token : SECRET_KEY_TOKENS) {
            if (normalized.contains(token)) {
                return true;
            }
        }
        return false;
    }

    private static String normalizeKey(String key) {
        return key.toLowerCase(Locale.ROOT).replace("-", "").replace("_", "");
    }

    private static boolean looksLikeSecretValue(String value) {
        String trimmed = value.trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if (lower.equals("bearer") || lower.startsWith("bearer ")) {
            return true;
        }
        for (String prefix : SECRET_VALUE_PREFIXES) {
            if (lower.startsWith(prefix)) {
                return true;
            }
        }
        if (trimmed.indexOf('/') >= 0) {
            return false;
        }
        return BASE64_LIKE.matcher(trimmed).matches() || HEX_LIKE.matcher(trimmed).matches();
    }

    /** Closed runtime role enum. */
    public enum Role {
        WORKER("worker"),
        REVIEWER("reviewer"),
        PLANNER("planner");

        private final String wireName;

        Role(String wireName) {
            this.wireName = wireName;
        }

        public String wireName() {
            return wireName;
        }

        public static Role fromWire(String raw) {
            if (raw != null) {
                for (Role role : values()) {
                    if (role.wireName.equalsIgnoreCase(raw)) {
                        return role;
                    }
                }
            }
            throw new IllegalArgumentException(
                "role must be one of worker, reviewer, planner (got '" + raw + "')");
        }
    }

    /** Canonical reasoning effort enum. */
    public enum Effort {
        MINIMAL("minimal"),
        LOW("low"),
        MEDIUM("medium"),
        HIGH("high"),
        MAX("max");

        private final String wireName;

        Effort(String wireName) {
            this.wireName = wireName;
        }

        public String wireName() {
            return wireName;
        }

        public static Effort fromWire(String raw) {
            if (raw != null) {
                for (Effort effort : values()) {
                    if (effort.wireName.equalsIgnoreCase(raw)) {
                        return effort;
                    }
                }
            }
            throw new IllegalArgumentException(
                "effort must be one of minimal, low, medium, high, max (got '" + raw + "')");
        }
    }

    /**
     * A declared runtime section.
     *
     * @param name     section name
     * @param role     closed runtime role
     * @param modelRef {@code <credential-name>/<model>} reference
     * @param count    number of child slots
     * @param effort   optional reasoning effort ({@code null} = model default)
     * @param project  optional project binding ({@code null} = assigned per lease)
     */
    public record DeclaredRuntime(
        String name,
        Role role,
        String modelRef,
        int count,
        Effort effort,
        String project
    ) {
        public DeclaredRuntime {
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(role, "role");
            Objects.requireNonNull(modelRef, "modelRef");
            if (count < 1 || count > MAX_COUNT) {
                throw new IllegalArgumentException("count must be between 1 and " + MAX_COUNT);
            }
        }

        /** Stable hash over role, model, effort and project (name/index excluded). */
        public String specHash() {
            return RuntimeConfig.specHash(role, modelRef, effort, project);
        }

        /** Expand this declaration into one child slot per {@code count}. */
        public List<RuntimeSlot> expanded() {
            List<RuntimeSlot> slots = new ArrayList<>(count);
            String hash = specHash();
            for (int i = 1; i <= count; i++) {
                slots.add(new RuntimeSlot(name, name + "-" + i, i, role, modelRef,
                    effort, project, hash));
            }
            return Collections.unmodifiableList(slots);
        }
    }

    /**
     * One concrete child process slot.
     *
     * @param runtimeName declared section name
     * @param name        deterministic child name ({@code <section>-<index>})
     * @param index       1-based child index
     * @param role        runtime role
     * @param modelRef    model reference
     * @param effort      optional effort
     * @param project     optional project
     * @param specHash    stable spec hash shared by all children of a declaration
     */
    public record RuntimeSlot(
        String runtimeName,
        String name,
        int index,
        Role role,
        String modelRef,
        Effort effort,
        String project,
        String specHash
    ) {
        public RuntimeSlot {
            Objects.requireNonNull(runtimeName, "runtimeName");
            Objects.requireNonNull(name, "name");
            Objects.requireNonNull(role, "role");
            Objects.requireNonNull(modelRef, "modelRef");
            Objects.requireNonNull(specHash, "specHash");
        }
    }

    private static final class SectionBuilder {
        private final int lineNo;
        private final String name;
        private final Set<String> seenKeys = new HashSet<>();
        private final Map<String, String> values = new LinkedHashMap<>();

        private SectionBuilder(int lineNo, String name) {
            this.lineNo = lineNo;
            this.name = name;
        }

        private void put(int keyLineNo, String key, String value) {
            if (isSecretKey(key)) {
                // Never echo the value: it may be the secret itself.
                throw error(keyLineNo, name,
                    "secret-looking key '" + key + "' is not allowed in the supervisor config");
            }
            switch (key.toLowerCase(Locale.ROOT)) {
                case "role", "model", "count", "effort", "project" -> {
                    // allowed
                }
                default -> throw error(keyLineNo, name,
                    "unknown key '" + key + "'; allowed keys are role, model, count, effort, project");
            }
            if (!seenKeys.add(key.toLowerCase(Locale.ROOT))) {
                throw error(keyLineNo, name, "duplicate key '" + key + "'");
            }
            if (looksLikeSecretValue(value)) {
                throw error(keyLineNo, name,
                    "value looks like a secret; supervisor config must not contain secrets");
            }
            values.put(key.toLowerCase(Locale.ROOT), value);
        }

        private DeclaredRuntime build() {
            String role = require("role");
            String modelRef = require("model");
            String countRaw = require("count");
            String effortRaw = values.get("effort");
            String project = values.get("project");

            Role parsedRole;
            try {
                parsedRole = Role.fromWire(role);
            } catch (IllegalArgumentException e) {
                throw error(lineNo, name, e.getMessage());
            }

            if (modelRef.isEmpty() || !MODEL_REF.matcher(modelRef).matches()) {
                throw error(lineNo, name,
                    "model must be a '<credential-name>/<model>' reference");
            }

            int count;
            try {
                count = Integer.parseInt(countRaw);
            } catch (NumberFormatException e) {
                throw error(lineNo, name, "count must be a positive integer (got '" + countRaw + "')");
            }
            if (count < 1 || count > MAX_COUNT) {
                throw error(lineNo, name,
                    "count must be between 1 and " + MAX_COUNT + " (got " + count + ")");
            }

            Effort effort = null;
            if (effortRaw != null) {
                try {
                    effort = Effort.fromWire(effortRaw);
                } catch (IllegalArgumentException e) {
                    throw error(lineNo, name, e.getMessage());
                }
            }

            if (project != null) {
                if (project.isEmpty()) {
                    throw error(lineNo, name, "project must not be blank");
                }
                if (project.length() > 200) {
                    throw error(lineNo, name, "project is longer than 200 characters");
                }
            }
            return new DeclaredRuntime(name, parsedRole, modelRef, count, effort, project);
        }

        private String require(String key) {
            String value = values.get(key);
            if (value == null || value.isEmpty()) {
                throw error(lineNo, name, "missing required key '" + key + "'");
            }
            return value;
        }
    }
}
