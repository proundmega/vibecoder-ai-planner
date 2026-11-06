package com.vibecode.agent.harness;

import java.io.OutputStream;

/**
 * Fixed-size ring buffer for child-process output.
 *
 * <p>A noisy or hostile test must not grow the supervisor's heap without bound;
 * only the tail is retained because that is what failures need.</p>
 */
final class BoundedTailBuffer extends OutputStream {

    private final byte[] buffer;
    private int size;
    private int writePosition;
    private boolean truncated;

    BoundedTailBuffer(int capacity) {
        this.buffer = new byte[Math.max(1, capacity)];
    }

    @Override
    public synchronized void write(int value) {
        if (size == buffer.length) {
            truncated = true;
        }
        buffer[writePosition] = (byte) value;
        writePosition = (writePosition + 1) % buffer.length;
        if (size < buffer.length) {
            size++;
        }
    }

    @Override
    public synchronized void write(byte[] bytes, int offset, int length) {
        for (int i = 0; i < length; i++) {
            write(bytes[offset + i]);
        }
    }

    synchronized boolean truncated() {
        return truncated;
    }

    synchronized String text() {
        byte[] ordered = new byte[size];
        int start = (writePosition - size + buffer.length) % buffer.length;
        for (int i = 0; i < size; i++) {
            ordered[i] = buffer[(start + i) % buffer.length];
        }
        return new String(ordered, java.nio.charset.StandardCharsets.UTF_8);
    }
}
