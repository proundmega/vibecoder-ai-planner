package com.vibecode.agent.supervisor;

/** Test-only entry point so a subprocess can exercise SupervisorMain.run. */
public final class SupervisorMainHarness {

    private SupervisorMainHarness() {
    }

    public static void main(String[] args) throws Exception {
        SupervisorMain.run(args[0]);
    }
}
