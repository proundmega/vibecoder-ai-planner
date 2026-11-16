package com.vibecode.agent.harness;

import java.io.IOException;
import java.nio.file.Path;
import java.util.function.Consumer;

/**
 * Creates disposable sandboxes and runs repo-controlled commands in them.
 *
 * <p>Implementations must fail closed: a create/exec failure must throw rather
 * than silently running the command on the host.</p>
 */
public interface SandboxRunner extends AutoCloseable {

    SandboxHandle create(SandboxSpec spec) throws IOException;

    ExecResult exec(SandboxHandle handle, ExecRequest request) throws IOException;

    /**
     * Execute and emit output chunks as they arrive. Implementations that
     * cannot stream may fall back to one chunk after completion; host mode is
     * not a security boundary and is allowed to buffer.
     */
    default ExecResult execStreaming(
        SandboxHandle handle,
        ExecRequest request,
        Consumer<String> listener
    ) throws IOException {
        ExecResult result = exec(handle, request);
        if (listener != null && !result.output().isEmpty()) {
            listener.accept(result.output());
        }
        return result;
    }

    void putFile(SandboxHandle handle, Path local, String remote) throws IOException;

    void getFile(SandboxHandle handle, String remote, Path local) throws IOException;

    /** Kill the whole process tree, but keep the sandbox available for destroy. */
    void stop(SandboxHandle handle);

    /**
     * Destroy the sandbox and all of its state. Idempotent for a clean handle;
     * an implementation may throw when the sandbox was not verified so the
     * caller cannot treat it as publishable.
     */
    void destroy(SandboxHandle handle) throws IOException;

    @Override
    void close();
}
