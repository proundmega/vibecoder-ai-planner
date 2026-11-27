package com.vibecode.agent.service;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BackendReviewClientTest {

    @Test
    void returnsTheBackendReviewUrl() throws IOException {
        ApiService api = mock(ApiService.class);
        when(api.createReviewRequest(42, "body", "vibecode/ticket-42", "main", "forgejo"))
            .thenReturn(Map.of(
                "url", "https://git.example.com/group/repo/pulls/7",
                "state", "open"));

        BackendReviewClient client = new BackendReviewClient(api, "forgejo");

        assertEquals("https://git.example.com/group/repo/pulls/7",
            client.createReviewRequest(42, "title", "body", "vibecode/ticket-42", "main"));
        verify(api).createReviewRequest(42, "body", "vibecode/ticket-42", "main", "forgejo");
    }

    @Test
    void branchOnlyResponsesReturnNull() throws IOException {
        ApiService api = mock(ApiService.class);
        when(api.createReviewRequest(42, "body", "vibecode/ticket-42", "main", "local"))
            .thenReturn(Map.of("ticketId", 42, "branchName", "vibecode/ticket-42"));

        BackendReviewClient client = new BackendReviewClient(api, "local");

        assertNull(client.createReviewRequest(
            42, "title", "body", "vibecode/ticket-42", "main"));
    }

    @Test
    void backendFailuresPropagate() throws IOException {
        ApiService api = mock(ApiService.class);
        when(api.createReviewRequest(42, "body", "vibecode/ticket-42", "main", "forgejo"))
            .thenThrow(new IOException("review failed"));

        BackendReviewClient client = new BackendReviewClient(api, "forgejo");

        assertThrows(IOException.class, () -> client.createReviewRequest(
            42, "title", "body", "vibecode/ticket-42", "main"));
    }
}
