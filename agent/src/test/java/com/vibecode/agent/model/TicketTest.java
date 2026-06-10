package com.vibecode.agent.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for Ticket model.
 */
class TicketTest {

    @Test
    void testIsAvailableBacklog() {
        Ticket ticket = new Ticket();
        ticket.setStatus("backlog");
        ticket.setAssignedAgentId(null);
        assertTrue(ticket.isAvailable());
    }

    @Test
    void testIsAvailableInProgress() {
        Ticket ticket = new Ticket();
        ticket.setStatus("in_progress");
        ticket.setAssignedAgentId(null);
        assertFalse(ticket.isAvailable());
    }

    @Test
    void testIsAvailableAssigned() {
        Ticket ticket = new Ticket();
        ticket.setStatus("backlog");
        ticket.setAssignedAgentId(123L);
        assertFalse(ticket.isAvailable());
    }

    @Test
    void testIsLocked() {
        Ticket ticket = new Ticket();
        ticket.setAssignedAgentId(123L);
        assertTrue(ticket.isLocked());

        ticket.setAssignedAgentId(null);
        assertFalse(ticket.isLocked());
    }

    @Test
    void testInProgress() {
        Ticket ticket = new Ticket();
        ticket.setStatus("in_progress");
        assertTrue(ticket.isInProgress());

        ticket.setStatus("backlog");
        assertFalse(ticket.isInProgress());
    }

    @Test
    void testToString() {
        Ticket ticket = new Ticket();
        ticket.setId(42L);
        ticket.setTitle("Test ticket");
        ticket.setStatus("backlog");
        
        String str = ticket.toString();
        assertTrue(str.contains("id=42"));
        assertTrue(str.contains("Test ticket"));
        assertTrue(str.contains("backlog"));
    }
}
