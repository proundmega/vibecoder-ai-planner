package com.vibecode.agent.service;

import com.vibecode.agent.model.ApiResponse;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ApiServiceClassificationTest {

    private static ApiResponse<Object> error(String code) {
        ApiResponse<Object> response = new ApiResponse<>();
        response.setSuccess(false);
        ApiResponse.Error error = new ApiResponse.Error();
        error.setCode(code);
        error.setMessage(code);
        response.setError(error);
        return response;
    }

    @Test
    void authorizationAndConflictDecisionsAreFatal() {
        assertTrue(ApiService.isFatalRunError(error("CONFLICT")));
        assertTrue(ApiService.isFatalRunError(error("FORBIDDEN")));
        assertTrue(ApiService.isFatalRunError(error("VALIDATION_ERROR")));
        assertTrue(ApiService.isFatalRunError(error("UNAUTHORIZED")));
        assertTrue(ApiService.isFatalRunError(error("KEY_EXPIRED")));
    }

    @Test
    void transportAndMissingEndpointErrorsRemainBestEffort() {
        assertFalse(ApiService.isFatalRunError(error("NOT_FOUND")));
        assertFalse(ApiService.isFatalRunError(error("INTERNAL_ERROR")));
        assertFalse(ApiService.isFatalRunError(null));
    }
}
