package com.vibecode.agent.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for Ticket model.
 */
class TicketTest {

    @Test
    void fillMissingFromKeepsPickupFieldsAndRestoresDescription() {
        Ticket pickup = new Ticket();
        pickup.setId(7L);
        pickup.setTitle("Picked title");
        pickup.setStatus("in_progress");

        Ticket listed = new Ticket();
        listed.setId(7L);
        listed.setTitle("Listed title");
        listed.setDescription("Full description");
        listed.setProjectId(3L);
        listed.setStatus("backlog");

        pickup.fillMissingFrom(listed);

        assertEquals("in_progress", pickup.getStatus());
        assertEquals("Picked title", pickup.getTitle());
        assertEquals("Full description", pickup.getDescription());
        assertEquals(3L, pickup.getProjectId());
    }

    @Test
    void fillMissingFromIgnoresAListedTicketThatIsMissing() {
        Ticket pickup = new Ticket();
        pickup.setId(7L);

        pickup.fillMissingFrom(null);

        assertNull(pickup.getDescription());
    }

    @Test
    void testIsAvailableBacklog() {
        Ticket ticket = new Ticket();
        ticket.setStatus("backlog");
        ticket.setAssignedRuntimeId(null);
        assertTrue(ticket.isAvailable());
    }

    @Test
    void testIsNotAvailableWhenPublishedPrExists() {
        Ticket ticket = new Ticket();
        ticket.setStatus("backlog");
        ticket.setAssignedRuntimeId(null);
        ticket.setPrUrl("https://github.com/owner/repo/pull/9");

        assertFalse(ticket.isAvailable());
    }

    @Test
    void testIsAvailableInProgress() {
        Ticket ticket = new Ticket();
        ticket.setStatus("in_progress");
        ticket.setAssignedRuntimeId(null);
        assertFalse(ticket.isAvailable());
    }

    @Test
    void testIsAvailableAssigned() {
        Ticket ticket = new Ticket();
        ticket.setStatus("backlog");
        ticket.setAssignedRuntimeId(123L);
        assertFalse(ticket.isAvailable());
    }

    @Test
    void testIsNotAvailableWhenDependenciesBlockIt() {
        Ticket ticket = new Ticket();
        ticket.setStatus("backlog");
        ticket.setAssignedRuntimeId(null);
        ticket.setReady(false);

        assertFalse(ticket.isAvailable());
    }

    @Test
    void testIsLocked() {
        Ticket ticket = new Ticket();
        ticket.setAssignedRuntimeId(123L);
        assertTrue(ticket.isLocked());

        ticket.setAssignedRuntimeId(null);
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
