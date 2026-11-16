package com.vibecode.agent.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.Map;

/**
 * Wrapper for all backend API responses.
 * Format: { success: true, data: ... }
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ApiResponse<T> {
    private boolean success;
    private T data;
    private Error error;
    private Map<String, Object> budgetPolicy;

    public boolean isSuccess() { return success; }
    public void setSuccess(boolean success) { this.success = success; }

    public T getData() { return data; }
    public void setData(T data) { this.data = data; }

    public Error getError() { return error; }
    public void setError(Error error) { this.error = error; }

    public Map<String, Object> getBudgetPolicy() { return budgetPolicy; }
    public void setBudgetPolicy(Map<String, Object> budgetPolicy) { this.budgetPolicy = budgetPolicy; }

    public boolean hasError() { return !success || error != null; }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Error {
        private String code;
        private String message;

        public String getCode() { return code; }
        public void setCode(String code) { this.code = code; }

        public String getMessage() { return message; }
        public void setMessage(String message) { this.message = message; }

        @Override
        public String toString() {
            return code + ": " + message;
        }
    }
}
