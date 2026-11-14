package com.vibecode.agent.harness;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Reads a single regular file from a bounded tar stream.
 *
 * <p>{@code docker cp -L CONTAINER:PATH -} emits a tar archive; the supervisor
 * must not trust the source container to keep a symlink, FIFO or oversized file
 * out of the archive. This reader accepts exactly one regular-file entry,
 * enforces a hard cap on the total bytes read and on the file size, and rejects
 * every other entry type.</p>
 */
final class BoundedTarFileReader {

    private static final int BLOCK = 512;

    private BoundedTarFileReader() {
    }

    /**
     * @param input        tar stream from {@code docker cp}
     * @param maxFileBytes maximum accepted file size
     * @param maxTarBytes  hard cap on the complete stream
     * @return the file bytes
     * @throws IOException on malformed, missing, non-regular or oversized input
     */
    static byte[] read(InputStream input, int maxFileBytes, int maxTarBytes)
        throws IOException {
        if (maxFileBytes <= 0 || maxTarBytes < maxFileBytes) {
            throw new IllegalArgumentException("invalid tar bounds");
        }
        CountingInputStream counting = new CountingInputStream(input, maxTarBytes);
        byte[] header = new byte[BLOCK];
        boolean found = false;
        byte[] content = null;

        while (true) {
            int read = readFully(counting, header);
            if (read == 0) {
                break;
            }
            if (read != BLOCK) {
                throw new IOException("truncated tar header");
            }
            if (isZeroBlock(header)) {
                break;
            }
            char type = (char) (header[156] & 0xFF);
            long size = parseOctal(header, 124, 12);
            if (size < 0 || size > Integer.MAX_VALUE) {
                throw new IOException("invalid tar entry size");
            }
            if (type == 'x' || type == 'g') {
                skip(counting, size);
                skip(counting, padding(size));
                continue;
            }
            if (type != '0' && type != 0) {
                throw new IOException("tar entry is not a regular file (type " + type + ")");
            }
            if (found) {
                throw new IOException("tar stream contains more than one file");
            }
            if (size > maxFileBytes) {
                throw new IOException("tar entry exceeds the size bound");
            }
            content = new byte[(int) size];
            int actual = readFully(counting, content);
            if (actual != content.length) {
                throw new EOFException("truncated tar entry");
            }
            skip(counting, padding(size));
            found = true;
        }

        if (!found || content == null) {
            throw new IOException("tar stream did not contain a regular file");
        }
        return content;
    }

    private static int readFully(InputStream input, byte[] target) throws IOException {
        int offset = 0;
        while (offset < target.length) {
            int read = input.read(target, offset, target.length - offset);
            if (read < 0) {
                break;
            }
            offset += read;
        }
        return offset;
    }

    private static void skip(InputStream input, long bytes) throws IOException {
        long remaining = bytes;
        byte[] scratch = new byte[BLOCK];
        while (remaining > 0) {
            int read = input.read(scratch, 0, (int) Math.min(scratch.length, remaining));
            if (read < 0) {
                throw new EOFException("truncated tar stream");
            }
            remaining -= read;
        }
    }

    private static int padding(long size) {
        int remainder = (int) (size % BLOCK);
        return remainder == 0 ? 0 : BLOCK - remainder;
    }

    private static long parseOctal(byte[] header, int offset, int length)
        throws IOException {
        String value = new String(header, offset, length, StandardCharsets.US_ASCII)
            .replace("\0", " ")
            .trim();
        if (value.isEmpty()) {
            return 0;
        }
        if (!value.matches("[0-7]+")) {
            throw new IOException("invalid tar size field");
        }
        try {
            return Long.parseLong(value, 8);
        } catch (NumberFormatException e) {
            throw new IOException("invalid tar size field", e);
        }
    }

    private static boolean isZeroBlock(byte[] block) {
        return Arrays.equals(block, new byte[BLOCK]);
    }

    private static final class CountingInputStream extends FilterInputStream {
        private final int limit;
        private int count;

        CountingInputStream(InputStream input, int limit) {
            super(input);
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int value = super.read();
            if (value >= 0) {
                count++;
                check();
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int read = super.read(buffer, offset, length);
            if (read > 0) {
                count += read;
                check();
            }
            return read;
        }

        private void check() throws IOException {
            if (count > limit) {
                throw new IOException("tar stream exceeds the size bound");
            }
        }
    }
}
