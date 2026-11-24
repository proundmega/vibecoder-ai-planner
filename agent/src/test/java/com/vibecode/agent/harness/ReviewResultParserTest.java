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
    void acceptsFencedJson() {
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
        assertMessage(
            "must be a JSON object",
            () -> parser.parse("[1, 2]", CHANGED_FILES)
        );
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
    void rejectsUnknownVerdict() {
        assertMessage(
            "verdict must be one of",
            () -> parser.parse("""
                {"verdict": "merge", "summary": "ok", "findings": []}
                """, CHANGED_FILES)
        );
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
    void requiresChangedFilesForBlockingFindings() {
        assertMessage("findings[0].file is required unless severity is info", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "warning", "message": "x"}]}
            """, CHANGED_FILES));
        assertMessage("findings[0].file is outside the diff", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "findings": [{"severity": "critical", "file": "backend/src/other.js", "message": "x"}]}
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
            {"verdict": "comment", "summary": "ok", "residual_risks": "risk"}
            """, CHANGED_FILES));
        assertMessage("human_questions[0] must be a string", () -> parser.parse("""
            {"verdict": "comment", "summary": "ok", "human_questions": [42]}
            """, CHANGED_FILES));

        ReviewResultParser.Result result = parser.parse("""
            {"verdict": "comment", "summary": "ok",
             "residual_risks": ["risk", "   "],
             "human_questions": []}
            """, CHANGED_FILES);
        assertEquals(List.of("risk"), result.residualRisks());
    }

    @Test
    void reportsCriticalFindings() {
        ReviewResultParser.Result clean = parser.parse("""
            {"verdict": "approve", "summary": "ok",
             "findings": [{"severity": "warning", "file": "backend/src/filter.js", "message": "x"}]}
            """, CHANGED_FILES);
        ReviewResultParser.Result blocking = parser.parse("""
            {"verdict": "request_changes", "summary": "ok",
             "findings": [{"severity": "critical", "file": "backend/src/filter.js", "message": "x"}]}
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
}
