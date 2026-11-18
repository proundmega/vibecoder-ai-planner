package com.vibecode.agent;

import com.vibecode.agent.service.AgentAuthFatalException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;

class AgentAppExitTest {

    @AfterEach
    void restoreHook() {
        AgentApp.exitHook = System::exit;
    }

    @Test
    void fatalAuthFailureExitsNonZero() {
        AtomicInteger code = new AtomicInteger(-1);
        AgentApp.exitHook = code::set;
        AgentAuthFatalException error =
            new AgentAuthFatalException("credentials expired", new IOException("backend unavailable"));

        AgentApp.exitOnFatalAuth(error);

        assertEquals(1, code.get());
    }

    @Test
    void fatalAuthIsAnIoExceptionForTheRefreshPath() {
        AgentAuthFatalException error =
            new AgentAuthFatalException("credentials expired", new IOException("boom"));
        assertSame(IOException.class, error.getClass().getSuperclass());
    }
}
