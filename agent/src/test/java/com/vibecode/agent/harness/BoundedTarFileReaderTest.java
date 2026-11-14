package com.vibecode.agent.harness;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BoundedTarFileReaderTest {

    @Test
    void readsASingleRegularFile() throws IOException {
        byte[] file = "-----BEGIN CERTIFICATE-----".getBytes(StandardCharsets.US_ASCII);

        byte[] tar = tar(file, (byte) '0', "ca.crt");

        assertArrayEquals(file,
            BoundedTarFileReader.read(new ByteArrayInputStream(tar), 1024, 4096));
    }

    @Test
    void rejectsSymlinkEntries() {
        byte[] tar = tar(new byte[0], (byte) '2', "ca.crt");

        IOException error = assertThrows(IOException.class,
            () -> BoundedTarFileReader.read(new ByteArrayInputStream(tar), 1024, 4096));
        assertTrue(error.getMessage().contains("not a regular file"));
    }

    @Test
    void rejectsOversizedFilesBeforeReadingTheBody() {
        byte[] tar = header(2048, (byte) '0', "ca.crt");

        IOException error = assertThrows(IOException.class,
            () -> BoundedTarFileReader.read(new ByteArrayInputStream(tar), 1024, 8192));
        assertTrue(error.getMessage().contains("size bound"));
    }

    @Test
    void rejectsMultipleFiles() throws IOException {
        byte[] one = tarBody("a".getBytes(StandardCharsets.US_ASCII), (byte) '0', "a");
        byte[] two = tarBody("b".getBytes(StandardCharsets.US_ASCII), (byte) '0', "b");
        byte[] combined = new byte[one.length + two.length + 1024];
        System.arraycopy(one, 0, combined, 0, one.length);
        System.arraycopy(two, 0, combined, one.length, two.length);

        assertThrows(IOException.class,
            () -> BoundedTarFileReader.read(new ByteArrayInputStream(combined), 1024, 8192));
    }

    @Test
    void rejectsTruncatedContent() {
        byte[] tar = Arrays.copyOf(header(10, (byte) '0', "ca.crt"), 512 + 4);

        assertThrows(IOException.class,
            () -> BoundedTarFileReader.read(new ByteArrayInputStream(tar), 1024, 4096));
    }

    private static byte[] tar(byte[] content, byte type, String name) {
        byte[] body = tarBody(content, type, name);
        byte[] out = Arrays.copyOf(body, body.length + 1024);
        return out;
    }

    private static byte[] tarBody(byte[] content, byte type, String name) {
        byte[] header = header(content.length, type, name);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(header);
        out.writeBytes(content);
        int padding = (512 - (content.length % 512)) % 512;
        out.writeBytes(new byte[padding]);
        return out.toByteArray();
    }

    private static byte[] header(int size, byte type, String name) {
        byte[] header = new byte[512];
        byte[] nameBytes = name.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(nameBytes, 0, header, 0, Math.min(nameBytes.length, 99));
        byte[] sizeBytes = String.format("%011o", size).getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(sizeBytes, 0, header, 124, sizeBytes.length);
        header[156] = type;
        byte[] magic = "ustar\0".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(magic, 0, header, 257, magic.length);
        return header;
    }
}
