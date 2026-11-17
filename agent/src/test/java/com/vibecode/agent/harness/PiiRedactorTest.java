package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PiiRedactorTest {

    @Test
    void redactsEmailAddresses() {
        PiiRedactor.Result result = PiiRedactor.redact(
            "contact alice.smith+harness@example.com for details");

        assertEquals("contact [REDACTED_EMAIL] for details", result.text());
        assertEquals(1, result.count());
    }

    @Test
    void redactsUsPhoneNumbers() {
        PiiRedactor.Result result = PiiRedactor.redact(
            "call (415) 555-2671 now");

        assertEquals("call [REDACTED_PHONE] now", result.text());
        assertEquals(1, result.count());
    }

    @Test
    void redactsSocialSecurityNumbers() {
        PiiRedactor.Result result = PiiRedactor.redact("ssn 123-45-6789");

        assertEquals("ssn [REDACTED_SSN]", result.text());
        assertEquals(1, result.count());
    }

    @Test
    void redactsOnlyLuhnValidCardNumbers() {
        PiiRedactor.Result result = PiiRedactor.redact(
            "card 4111111111111111 and order 1234567890123456");

        assertEquals("card [REDACTED_CARD] and order 1234567890123456", result.text());
        assertEquals(1, result.count());
    }

    @Test
    void leavesOrdinarySourceCodeAlone() {
        String source = "int ticketId = 42; String branch = 'feat/fg-42';";

        PiiRedactor.Result result = PiiRedactor.redact(source);

        assertEquals(source, result.text());
        assertEquals(0, result.count());
    }

    @Test
    void containsPiiIsFalseForSafeTextAndTrueForMatches() {
        assertFalse(PiiRedactor.containsPii("nothing sensitive here"));
        assertTrue(PiiRedactor.containsPii("alice@example.com"));
    }

    @Test
    void detectsLuhnValidNumbers() {
        assertTrue(PiiRedactor.luhn("4111111111111111"));
        assertFalse(PiiRedactor.luhn("1234567890123456"));
    }

    @Test
    void handlesNullAndEmptyInput() {
        PiiRedactor.Result result = PiiRedactor.redact(null);

        assertEquals("", result.text());
        assertEquals(0, result.count());
    }
}
