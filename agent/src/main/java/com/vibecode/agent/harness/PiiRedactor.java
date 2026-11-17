package com.vibecode.agent.harness;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Conservative PII redaction for prompt and output text (fg-42 FR2/FR4).
 *
 * <p>This is a heuristic scanner, not a DLP product. It is deliberately limited
 * to high-confidence shapes (email, phone, SSN, Luhn-valid card numbers) to
 * avoid corrupting ordinary source code and identifiers.</p>
 */
public final class PiiRedactor {

    private PiiRedactor() {
    }

    public record Result(String text, int count) {
    }

    private static final Pattern EMAIL = Pattern.compile(
        "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}");
    private static final Pattern PHONE = Pattern.compile(
        "(?<!\\d)(?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(\\d{3}\\)[\\s.-]?|\\d{3}[\\s.-])\\d{3}[\\s.-]\\d{4}(?!\\d)");
    private static final Pattern SSN = Pattern.compile(
        "\\b\\d{3}-\\d{2}-\\d{4}\\b");
    private static final Pattern CARD = Pattern.compile(
        "\\b\\d(?:[ -]?\\d){12,18}\\b");

    public static Result redact(String value) {
        if (value == null || value.isEmpty()) {
            return new Result("", 0);
        }
        int[] count = {0};
        String redacted = EMAIL.matcher(value).replaceAll(match -> {
            count[0]++;
            return "[REDACTED_EMAIL]";
        });
        redacted = PHONE.matcher(redacted).replaceAll(match -> {
            count[0]++;
            return "[REDACTED_PHONE]";
        });
        redacted = SSN.matcher(redacted).replaceAll(match -> {
            count[0]++;
            return "[REDACTED_SSN]";
        });
        redacted = replaceCards(redacted, count);
        return new Result(redacted, count[0]);
    }

    public static boolean containsPii(String value) {
        return redact(value).count() > 0;
    }

    private static String replaceCards(String value, int[] count) {
        Matcher matcher = CARD.matcher(value);
        StringBuilder out = new StringBuilder(value.length());
        while (matcher.find()) {
            String candidate = matcher.group();
            String digits = candidate.replaceAll("[^0-9]", "");
            if (digits.length() >= 13 && digits.length() <= 19 && luhn(digits)) {
                count[0]++;
                matcher.appendReplacement(out, "[REDACTED_CARD]");
            } else {
                matcher.appendReplacement(out, Matcher.quoteReplacement(candidate));
            }
        }
        matcher.appendTail(out);
        return out.toString();
    }

    static boolean luhn(String digits) {
        int sum = 0;
        boolean doubleDigit = false;
        for (int i = digits.length() - 1; i >= 0; i--) {
            int digit = digits.charAt(i) - '0';
            if (doubleDigit) {
                digit *= 2;
                if (digit > 9) digit -= 9;
            }
            sum += digit;
            doubleDigit = !doubleDigit;
        }
        return sum % 10 == 0;
    }

    static List<String> patterns() {
        return List.of(EMAIL.pattern(), PHONE.pattern(), SSN.pattern(), CARD.pattern());
    }
}
