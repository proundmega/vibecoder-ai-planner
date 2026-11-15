package com.vibecode.agent.config;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.vibecode.agent.harness.RedactionRegistry;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RedactingPatternLayoutEncoderTest {

    @Test
    void redactsCredentialsBeforeALogLineLeavesTheProcess() {
        LoggerContext context = new LoggerContext();
        Logger logger = context.getLogger("redaction-test");
        RedactingPatternLayoutEncoder encoder = new RedactingPatternLayoutEncoder();
        encoder.setContext(context);
        encoder.setPattern("%msg");
        encoder.start();
        try {
            String token = "custom-provider-key-123456";
            RedactionRegistry.register(token);
            LoggingEvent event = new LoggingEvent(
                "test", logger, Level.INFO, "token=" + token, null, null);

            String output = new String(encoder.encode(event), StandardCharsets.UTF_8);

            assertFalse(output.contains(token), output);
            assertTrue(output.contains("[REDACTED]"), output);
        } finally {
            encoder.stop();
            RedactionRegistry.reset();
        }
    }
}
