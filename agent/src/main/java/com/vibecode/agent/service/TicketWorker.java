package com.vibecode.agent.service;

import com.vibecode.agent.model.Ticket;

/**
 * Common contract for legacy and harness ticket workers.
 */
public interface TicketWorker {
    void processTicket(Ticket ticket);

    String getCurrentTicketId();

    String getCurrentStep();
}
