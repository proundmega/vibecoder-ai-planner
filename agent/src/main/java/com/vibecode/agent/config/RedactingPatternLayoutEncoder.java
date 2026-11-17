package com.vibecode.agent.config;

import ch.qos.logback.classic.encoder.PatternLayoutEncoder;
import ch.qos.logback.classic.spi.ILoggingEvent;
import com.vibecode.agent.harness.HarnessPrivacyGuard;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

/**
 * Logback encoder that redacts high-confidence credential patterns and the
 * configured supervisor secrets before a line leaves the process. This covers
 * legacy processors and externally shipped supervisor logs (D19); the harness
 * still redacts its own stored artifacts at the storage boundary.
 */
public class RedactingPatternLayoutEncoder extends PatternLayoutEncoder {

    @Override
    public byte[] encode(ILoggingEvent event) {
        byte[] encoded = super.encode(event);
        if (encoded == null || encoded.length == 0) {
            return encoded;
        }
        Charset charset = getCharset() == null ? StandardCharsets.UTF_8 : getCharset();
        String redacted = HarnessPrivacyGuard.forStorage(new String(encoded, charset));
        return redacted.getBytes(charset);
    }
}
