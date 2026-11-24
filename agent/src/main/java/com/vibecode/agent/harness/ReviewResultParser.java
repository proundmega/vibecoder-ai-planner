package com.vibecode.agent.harness;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Parses the reviewer's structured output (fg-31b, FR4).
 *
 * <p>Validation is strict and fails closed: extra content after the JSON
 * object, an unknown verdict, a missing or blank required field, a malformed
 * finding, or a {@code critical}/{@code warning} finding outside the diff is
 * rejected. A model-supplied {@code verification} field is ignored;
 * verification belongs to the supervisor.</p>
 */
public final class ReviewResultParser {

    static final Set<String> VERDICTS = Set.of("approve", "request_changes", "comment");
    static final Set<String> SEVERITIES = Set.of("critical", "warning", "info");
    static final int MAX_TEXT_CHARS = 8_000;
    static final int MAX_LIST_ITEM_CHARS = 2_000;
    static final int MAX_LIST_ITEMS = 200;

    private final ObjectMapper objectMapper = new ObjectMapper()
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    public Result parse(String raw) {
        return parse(raw, List.of());
    }

    public Result parse(String raw, Collection<String> changedFiles) {
        Set<String> diffFiles = changedFiles == null ? Set.of() : new HashSet<>(changedFiles);
        JsonNode root = readObject(raw);

        String verdict = requiredText(root, "verdict", "verdict", MAX_TEXT_CHARS);
        if (!VERDICTS.contains(verdict)) {
            throw invalid("verdict must be one of: approve, request_changes, comment");
        }

        String summary = requiredText(root, "summary", "summary", MAX_TEXT_CHARS);
        JsonNode findingsNode = root.get("findings");
        if (findingsNode == null || findingsNode.isNull()) {
            throw invalid("findings is required");
        }
        List<Finding> findings = parseFindings(findingsNode, diffFiles);
        List<String> residualRisks = parseStringArray(root.get("residual_risks"), "residual_risks");
        List<String> humanQuestions = parseStringArray(
            root.get("human_questions"),
            "human_questions"
        );

        return new Result(verdict, summary, findings, residualRisks, humanQuestions);
    }

    private JsonNode readObject(String raw) {
        String json = extractJson(raw);
        try (JsonParser parser = objectMapper.getFactory().createParser(json)) {
            JsonNode root = objectMapper.readTree(parser);
            if (hasTrailingContent(parser)) {
                throw invalid("review output contains trailing content");
            }
            if (root == null || !root.isObject()) {
                throw invalid("review output must be a JSON object");
            }
            return root;
        } catch (JsonProcessingException error) {
            throw new InvalidReviewException("review output is not valid JSON", error);
        } catch (IOException error) {
            throw new InvalidReviewException("review output could not be read", error);
        }
    }

    private static boolean hasTrailingContent(JsonParser parser) {
        try {
            return parser.nextToken() != null;
        } catch (IOException error) {
            return true;
        }
    }

    private static String extractJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw invalid("review output is empty");
        }
        String text = raw.trim();
        if (text.startsWith("```")) {
            int firstNewline = text.indexOf('\n');
            if (firstNewline < 0) {
                throw invalid("fenced review output has no body");
            }
            String body = text.substring(firstNewline + 1).trim();
            if (!body.endsWith("```")) {
                throw invalid("fenced review output is missing its closing fence");
            }
            body = body.substring(0, body.length() - 3).trim();
            if (body.contains("```")) {
                throw invalid("review output must contain exactly one JSON object");
            }
            if (!body.startsWith("{")) {
                throw invalid("review output must be a JSON object");
            }
            return body;
        }
        if (text.contains("```")) {
            throw invalid("review output must not mix fences and bare JSON");
        }
        if (!text.startsWith("{")) {
            throw invalid("review output must be a JSON object");
        }
        return text;
    }

    private List<Finding> parseFindings(JsonNode node, Set<String> diffFiles) {
        if (!node.isArray()) {
            throw invalid("findings must be an array");
        }
        if (node.size() > MAX_LIST_ITEMS) {
            throw invalid("findings exceeds " + MAX_LIST_ITEMS + " entries");
        }

        List<Finding> findings = new ArrayList<>();
        for (int index = 0; index < node.size(); index++) {
            JsonNode item = node.get(index);
            String label = "findings[" + index + "]";
            if (item == null || !item.isObject()) {
                throw invalid(label + " must be an object");
            }

            String severity = requiredText(item, "severity", label + ".severity", 64);
            if (!SEVERITIES.contains(severity)) {
                throw invalid(label + ".severity must be one of: critical, warning, info");
            }
            String message = requiredText(item, "message", label + ".message", MAX_TEXT_CHARS);
            String rawFile = optionalText(item.get("file"), label + ".file", 1_024);
            Integer line = optionalLine(item.get("line"), label + ".line");
            String suggestion = optionalText(
                item.get("suggestion"),
                label + ".suggestion",
                MAX_TEXT_CHARS
            );

            String matchedFile = rawFile == null ? null : matchedDiffPath(rawFile, diffFiles);
            if (!"info".equals(severity)) {
                if (rawFile == null) {
                    throw invalid(label + ".file is required unless severity is info");
                }
                if (matchedFile == null) {
                    throw invalid(label + ".file is outside the diff: " + rawFile);
                }
                if (line == null) {
                    throw invalid(label + ".line is required unless severity is info");
                }
            }
            String file = matchedFile != null
                ? matchedFile
                : (rawFile == null ? null : canonicalPath(rawFile));

            findings.add(new Finding(severity, file, line, message, suggestion));
        }
        return findings;
    }

    private static List<String> parseStringArray(JsonNode node, String field) {
        if (node == null || node.isNull()) {
            return List.of();
        }
        if (!node.isArray()) {
            throw invalid(field + " must be an array");
        }
        if (node.size() > MAX_LIST_ITEMS) {
            throw invalid(field + " exceeds " + MAX_LIST_ITEMS + " entries");
        }
        List<String> values = new ArrayList<>();
        for (int index = 0; index < node.size(); index++) {
            JsonNode item = node.get(index);
            String label = field + "[" + index + "]";
            if (item == null || !item.isTextual()) {
                throw invalid(label + " must be a string");
            }
            String value = item.asText().trim();
            if (value.isEmpty()) {
                continue;
            }
            if (value.length() > MAX_LIST_ITEM_CHARS) {
                throw invalid(label + " exceeds " + MAX_LIST_ITEM_CHARS + " characters");
            }
            values.add(value);
        }
        return values;
    }

    private static String requiredText(JsonNode node, String field, String label, int max) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || !value.isTextual()) {
            throw invalid(label + " is required");
        }
        return bounded(value.asText().trim(), label, max, true);
    }

    private static String optionalText(JsonNode value, String label, int max) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw invalid(label + " must be a string");
        }
        String text = value.asText().trim();
        if (text.isEmpty()) {
            return null;
        }
        return bounded(text, label, max, false);
    }

    private static Integer optionalLine(JsonNode value, String label) {
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isIntegralNumber() || !value.canConvertToInt()) {
            throw invalid(label + " must be a positive integer");
        }
        int line = value.asInt();
        if (line <= 0) {
            throw invalid(label + " must be a positive integer");
        }
        return line;
    }

    private static String bounded(String value, String label, int max, boolean required) {
        if (value.isEmpty()) {
            if (required) {
                throw invalid(label + " is required");
            }
            return null;
        }
        if (value.length() > max) {
            throw invalid(label + " exceeds " + max + " characters");
        }
        return value;
    }

    private static String matchedDiffPath(String file, Set<String> diffFiles) {
        String target = comparablePath(file);
        for (String changed : diffFiles) {
            if (comparablePath(changed).equals(target)) {
                return canonicalPath(changed);
            }
        }
        return null;
    }

    private static String comparablePath(String path) {
        String value = canonicalPath(path);
        if (value.startsWith("a/") || value.startsWith("b/")) {
            value = value.substring(2);
        }
        return value;
    }

    private static String canonicalPath(String path) {
        String value = path.replace('\\', '/');
        while (value.startsWith("./")) {
            value = value.substring(2);
        }
        return value.replaceAll("/{2,}", "/");
    }

    private static InvalidReviewException invalid(String message) {
        return new InvalidReviewException(message);
    }

    public record Finding(
        String severity,
        String file,
        Integer line,
        String message,
        String suggestion
    ) {
    }

    public record Result(
        String verdict,
        String summary,
        List<Finding> findings,
        List<String> residualRisks,
        List<String> humanQuestions
    ) {
        public Result {
            findings = findings == null ? List.of() : List.copyOf(findings);
            residualRisks = residualRisks == null ? List.of() : List.copyOf(residualRisks);
            humanQuestions = humanQuestions == null ? List.of() : List.copyOf(humanQuestions);
        }

        public boolean hasCriticalFinding() {
            return findings.stream().anyMatch(finding -> "critical".equals(finding.severity()));
        }
    }

    public static final class InvalidReviewException extends RuntimeException {
        public InvalidReviewException(String message) {
            super(message);
        }

        public InvalidReviewException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
