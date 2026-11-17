package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EgressMtlsMaterialTest {

    private static String cert() throws Exception {
        return Files.readString(Path.of("src/test/resources/egress-client-cert.pem"));
    }

    private static String key() throws Exception {
        return Files.readString(Path.of("src/test/resources/egress-client-key.pem"));
    }

    @Test
    void normalizesHostsAndRedactsTheKey() throws Exception {
        EgressMtlsMaterial material = new EgressMtlsMaterial(
            List.of("Registry.Example.com.", "registry.example.com"), cert(), key());

        assertEquals(List.of("registry.example.com"), material.hosts());
        assertTrue(material.certSha256().matches("[a-f0-9]{64}"));
        assertTrue(material.toString().contains(material.certSha256()));
        assertFalse(material.toString().contains("PRIVATE KEY"));
        assertFalse(material.toString().contains(key().trim()));
    }

    @Test
    void fingerprintsTheCertPemBytes() throws Exception {
        EgressMtlsMaterial material = new EgressMtlsMaterial(
            List.of("registry.example.com"), cert(), key());
        String expected = HexFormat.of().formatHex(
            MessageDigest.getInstance("SHA-256").digest(cert().getBytes(StandardCharsets.UTF_8)));

        assertEquals(expected, material.certSha256());
    }

    @Test
    void rejectsCaCertificates() throws Exception {
        String ca = Files.readString(
            Path.of("src/test/resources/egress-client-ca.pem"));
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> new EgressMtlsMaterial(List.of("registry.example.com"), ca, key()));
        assertTrue(error.getMessage().contains("CA"));
    }

    @Test
    void rejectsWildcardIpAndInternalHosts() throws Exception {
        for (String host : new String[]{
            "*.example.com", "10.0.0.1", "localhost", "metadata.google.internal"
        }) {
            assertThrows(IllegalArgumentException.class,
                () -> new EgressMtlsMaterial(List.of(host), cert(), key()), host);
        }
    }

    @Test
    void rejectsPrivateMaterialInTheWrongFields() throws Exception {
        assertThrows(IllegalArgumentException.class,
            () -> new EgressMtlsMaterial(List.of("registry.example.com"), key(), key()));
        assertThrows(IllegalArgumentException.class,
            () -> new EgressMtlsMaterial(List.of("registry.example.com"), cert(), cert()));
    }
}
