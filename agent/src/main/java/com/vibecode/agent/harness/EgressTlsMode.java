package com.vibecode.agent.harness;

import java.util.Locale;

/**
 * How the egress proxy handles CONNECT tunnels.
 *
 * <p>{@link #SNI_ONLY} keeps the slice-2 behaviour: only the first
 * ClientHello SNI is validated. {@link #TERMINATE} terminates TLS at the
 * proxy, enforces {@code Host == SNI} on parsed HTTP/1.1 requests, and
 * re-originates with a verified TLS connection. Termination is opt-in until
 * the default flip is verified (D16 / D25).</p>
 */
public enum EgressTlsMode {
    SNI_ONLY("sni-only"),
    TERMINATE("terminate");

    private final String value;

    EgressTlsMode(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public static EgressTlsMode from(String configured) {
        String value = configured == null ? "" : configured.trim().toLowerCase(Locale.ROOT);
        if (value.isEmpty()) {
            return SNI_ONLY;
        }
        for (EgressTlsMode mode : values()) {
            if (mode.value.equals(value)) {
                return mode;
            }
        }
        throw new IllegalStateException(
            "SANDBOX_EGRESS_TLS_MODE must be one of: sni-only, terminate (got: "
                + configured + ")");
    }
}
