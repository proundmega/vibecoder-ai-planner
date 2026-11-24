package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReviewResultParserTest {

    private final ReviewResultParser parser = new ReviewResultParser();

    private static final List<String> CHANGED_FILES = List.of(
        "backend/src/services/TicketService.js",
        "backend/src/filter.js"
    );

    @Test
    void parsesAValidResultWithFindings() {
        ReviewResultParser.Result result = parser.parse("""
            {
              "verdict": "request_changes",
              "summary": "One blocking issue and one nit.",
              "findings": [
                {
                  "severity": "critical",
                  "file": "backend/src/services/TicketService.js",
                  "line": 198,
                  "message": "The filter drops the owner scope.",
                  "suggestion": "Add the owner predicate."
                },
                {
                  "severity": "info",
                  "file": "docs/unknown.md",
                  "message": "Consider a changelog entry."
                }
              ],
              "residual_risks": ["Pagination is untested"],
              "human_questions": ["Should admins see every project?"]
            }
            """, CHANGED_FILES);

        assertEquals("request_changes", result.verdict());
        assertEquals("One blocking issue and one nit.", result.summary());
        assertEquals(2, result.findings().size());
        ReviewResultParser.Finding blocking = result.findings().get(0);
        assertEquals("critical", blocking.severity());
        assertEquals("backend/src/services/TicketService.js", blocking.file());
        assertEquals(198, blocking.line());
        assertEquals("The filter drops the owner scope.", blocking.message());
        assertEquals("Add the owner predicate.", blocking.suggestion());
        assertNull(result.findings().get(1).line());
        assertEquals(List.of("Pagination is untested"), result.residualRisks());
        assertEquals(List.of("Should admins see every project?"), result.humanQuestions());
        assertTrue(result.hasCriticalFinding());
    }

    @Test
    void acceptsOneFencedBlock() {
        ReviewResultParser.Result result = parser.parse("""
            ```json
            {"verdict": "comment", "summary": "Looks fine", "findings": []}
            ```
            """, CHANGED_FILES);

        assertEquals("comment", result.verdict());
        assertTrue(result.findings().isEmpty());
        assertEquals(List.of(), result.residualRisks());
        assertEquals(List.of(), result.humanQuestions());
    }

    @Test
    void rejectsEmptyAndNonObjectOutput() {
        assertMessage("review output is empty", () -> parser.parse("  ", CHANGED_FILES));
        assertMessage("review output is empty", () -> parser.parse(null, CHANGED_FILES));
        assertMessage("must be a JSON object", () -> parser.parse("[1, 2]", CHANGED_FILES));
        assertMessage(
            "must be a JSON object",
            () -> parser.parse("I think this is fine.", CHANGED_FILES)
        );
    }

    @Test
    void rejectsMalformedJson() {
        assertMessage(
            "not valid JSON",
            () -> parser.parse("{\"verdict\": \"approve\",", CHANGED_FILES)
        );
    }

    @Test
    void rejectsTrailingContentAndBrokenFences() {
        // A valid object followed by prose.
        assertRejected(() -> parser.parse("""
            {"verdict": "approve", "summary": "ok", "findings": []}
            I cannot approve; this is unsafe.
            """, CHANGED_FILES));
        // A valid object followed by a second object.
        assertRejected(() -> parser.parse("""
            {"verdict": "approve", "summary": "ok", "findings": []}
            {"verdict": "request_changes", "summary": "no", "findings": []}
            """, CHANGED_FILES));
        // A fenced block with trailing text after the closing fence.
        assertMessage("missing its closing fence", () -> parser.parse("""
            ```json
            {"verdict": "approve", "summary": "ok", "findings": []}
            ```
            I cannot approve.
            """, CHANGED_FILES));
        // A fenced block without a closing fence.
        assertMessage("missing its closing fence", () -> parser.parse("""
            ```json
            {"verdict": "approve", "summary": "ok", "findings": []}
            """, CHANGED_FILES));
        // Two fenced blocks: the second block becomes trailing content.
        assertRejected(() -> parser.parse("""
            ```json
            {"verdict": "approve", "summary": "ok", "findings": []}
            ```
            ```json
            {"verdict": "request_changes", "summary": "no", "findings": []}
            ```
            """, CHANGED_FILES));
    }

    @Test
    void acceptsCodeFencesInsideJsonStrings() {
        // A bare finding message may contain a markdown code block.
        ReviewResultParser.Result bareFinding = parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": [
              {"severity": "info", "message": "Use ```js\\nconst x = 1;\\n``` here"}]}
            """, CHANGED_FILES);
        assertEquals(1, bareFinding.findings().size());
        assertTrue(bareFinding.findings().get(0).message().contains("```js"));

        // The same object inside one fenced block.
        ReviewResultParser.Result fencedFinding = parser.parse("""
            ```json
            {"verdict": "comment", "summary": "ok", "findings": [
              {"severity": "info", "message": "Use ```js\\nconst x = 1;\\n``` here"}]}
            ```
            """, CHANGED_FILES);
        assertEquals(1, fencedFinding.findings().size());
        assertTrue(fencedFinding.findings().get(0).message().contains("```js"));

        // A bare summary may contain a fence marker.
        ReviewResultParser.Result summary = parser.parse("""
            {"verdict": "comment", "summary": "Use ``` to fence code", "findings": []}
            """, CHANGED_FILES);
        assertEquals("Use ``` to fence code", summary.summary());
    }

    @Test
    void rejectsUnknownVerdict() {
        assertMessage("verdict must be one of", () -> parser.parse("""
            {"verdict": "merge", "summary": "ok", "findings": []}
            """, CHANGED_FILES));
    }

    @Test
    void rejectsMissingOrBlankSummary() {
        assertMessage("verdict is required", () -> parser.parse("""
            {"summary": "ok", "findings": []}
            """, CHANGED_FILES));
        assertMessage("summary is required", () -> parser.parse("""
            {"verdict": "approve", "summary": "  ", "findings": []}
            """, CHANGED_FILES));
    }

    @Test
    void requiresFindings() {
        assertMessage("findings is required", () -> parser.parse("""
            {"verdict": "approve", "summary": "ok"}
            """, CHANGED_FILES));
        assertMessage("findings is required", () -> parser.parse("""
            {"verdict": "approve", "summary": "ok", "findings": null}
            """, CHANGED_FILES));
    }

    @Test
    void rejectsMalformedFindings() {
        assertMessage("findings must be an array", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": {}}
            """, CHANGED_FILES));
        assertMessage("findings[0] must be an object", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": ["nope"]}
            """, CHANGED_FILES));
        assertMessage("findings[0].severity must be one of", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "high", "message": "x"}]}
            """, CHANGED_FILES));
        assertMessage("findings[0].message is required", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "info"}]}
            """, CHANGED_FILES));
        assertMessage("findings[0].line must be a positive integer", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "info", "message": "x", "line": 0}]}
            """, CHANGED_FILES));
        assertMessage("findings[0].line must be a positive integer", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "info", "message": "x", "line": "12"}]}
            """, CHANGED_FILES));
    }

    @Test
    void requiresFileAndLineForBlockingFindings() {
        assertMessage("findings[0].file is required unless severity is info", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "warning", "message": "x", "line": 4}]}
            """, CHANGED_FILES));
        assertMessage("findings[0].file is outside the diff", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "critical", "file": "backend/src/other.js",
                           "line": 4, "message": "x"}]}
            """, CHANGED_FILES));
        assertMessage("findings[0].line is required unless severity is info", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "warning", "file": "backend/src/filter.js",
                           "message": "x"}]}
            """, CHANGED_FILES));
    }

    @Test
    void allowsInfoOutsideTheDiff() {
        ReviewResultParser.Result result = parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "info", "file": "docs/other.md", "message": "x"}]}
            """, CHANGED_FILES);

        assertEquals(1, result.findings().size());
        assertEquals("docs/other.md", result.findings().get(0).file());
    }

    @Test
    void normalisesGitStyleAndRepeatedSlashPaths() {
        ReviewResultParser.Result result = parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [
               {"severity": "warning", "file": "b/backend/src/filter.js",
                "line": 4, "message": "one"},
               {"severity": "info", "file": "./backend//src/filter.js",
                "message": "two"}
             ]}
            """, CHANGED_FILES);

        assertEquals("backend/src/filter.js", result.findings().get(0).file());
        assertEquals("backend/src/filter.js", result.findings().get(1).file());
    }

    @Test
    void ignoresModelSuppliedVerification() {
        ReviewResultParser.Result result = parser.parse("""
            {
              "verdict": "approve",
              "summary": "All good",
              "findings": [],
              "verification": {"commands": [{"command": "npm test", "exitCode": 0}]}
            }
            """, CHANGED_FILES);

        assertEquals("approve", result.verdict());
        assertTrue(result.findings().isEmpty());
        assertFalse(result.toString().contains("verification"));
    }

    @Test
    void validatesStringArrays() {
        assertMessage("residual_risks must be an array", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": [],
             "residual_risks": "risk"}
            """, CHANGED_FILES));
        assertMessage("human_questions[0] must be a string", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": [],
             "human_questions": [42]}
            """, CHANGED_FILES));
        assertMessage("exceeds 2000 characters", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": [],
             "residual_risks": ["%s"]}
            """.formatted("x".repeat(2_001)), CHANGED_FILES));

        ReviewResultParser.Result result = parser.parse("""
            {"verdict": "comment", "summary": "ok", "findings": [],
             "residual_risks": ["risk", "   "],
             "human_questions": []}
            """, CHANGED_FILES);
        assertEquals(List.of("risk"), result.residualRisks());
    }

    @Test
    void reportsCriticalFindings() {
        ReviewResultParser.Result clean = parser.parse("""
            {"verdict": "approve", "summary": "ok",
             "findings": [{"severity": "warning", "file": "backend/src/filter.js",
                           "line": 4, "message": "x"}]}
            """, CHANGED_FILES);
        ReviewResultParser.Result blocking = parser.parse("""
            {"verdict": "request_changes", "summary": "ok",
             "findings": [{"severity": "critical", "file": "backend/src/filter.js",
                           "line": 4, "message": "x"}]}
            """, CHANGED_FILES);

        assertFalse(clean.hasCriticalFinding());
        assertTrue(blocking.hasCriticalFinding());
    }

    private static void assertMessage(String expected, Runnable action) {
        ReviewResultParser.InvalidReviewException error = assertThrows(
            ReviewResultParser.InvalidReviewException.class,
            action::run
        );
        assertTrue(
            error.getMessage().contains(expected),
            "expected message containing '" + expected + "' but was: " + error.getMessage()
        );
    }

    private static void assertRejected(Runnable action) {
        assertThrows(ReviewResultParser.InvalidReviewException.class, action::run);
    }
}
