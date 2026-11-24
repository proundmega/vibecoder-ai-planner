package com.vibecode.agent.harness;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Parses the reviewer's structured output (fg-31b, FR4).
 *
 * <p>Validation is strict and fails closed: an unknown verdict, a missing or
 * blank required field, a malformed finding, or a {@code critical}/{@code
 * warning} finding outside the diff is rejected. A model-supplied
 * {@code verification} field is ignored; verification belongs to the
 * supervisor.</p>
 */
public final class ReviewResultParser {

    static final Set<String> VERDICTS = Set.of("approve", "request_changes", "comment");
    static final Set<String> SEVERITIES = Set.of("critical", "warning", "info");
    static final int MAX_TEXT_CHARS = 8_000;
    static final int MAX_LIST_ITEMS = 200;

    private final ObjectMapper objectMapper = new ObjectMapper();

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
        List<Finding> findings = parseFindings(root.get("findings"), diffFiles);
        List<String> residualRisks = parseStringArray(root.get("residual_risks"), "residual_risks");
        List<String> humanQuestions = parseStringArray(
            root.get("human_questions"),
            "human_questions"
        );

        return new Result(verdict, summary, findings, residualRisks, humanQuestions);
    }

    private JsonNode readObject(String raw) {
        String json = extractJson(raw);
        JsonNode root;
        try {
            root = objectMapper.readTree(json);
        } catch (JsonProcessingException error) {
            throw new InvalidReviewException("review output is not valid JSON", error);
        }
        if (root == null || !root.isObject()) {
            throw invalid("review output must be a JSON object");
        }
        return root;
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
            text = text.substring(firstNewline + 1).trim();
            if (text.endsWith("```")) {
                text = text.substring(0, text.length() - 3).trim();
            }
        }
        if (!text.startsWith("{")) {
            throw invalid("review output must be a JSON object");
        }
        return text;
    }

    private List<Finding> parseFindings(JsonNode node, Set<String> diffFiles) {
        if (node == null || node.isNull()) {
            return List.of();
        }
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
            String file = optionalText(item.get("file"), label + ".file", 1_024);
            Integer line = optionalLine(item.get("line"), label + ".line");
            String suggestion = optionalText(
                item.get("suggestion"),
                label + ".suggestion",
                MAX_TEXT_CHARS
            );

            if (!"info".equals(severity)) {
                if (file == null) {
                    throw invalid(label + ".file is required unless severity is info");
                }
                if (!diffFiles.contains(file)) {
                    throw invalid(label + ".file is outside the diff: " + file);
                }
            }
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
            if (item == null || !item.isTextual()) {
                throw invalid(field + "[" + index + "] must be a string");
            }
            String value = item.asText().trim();
            if (!value.isEmpty()) {
                values.add(value);
            }
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
