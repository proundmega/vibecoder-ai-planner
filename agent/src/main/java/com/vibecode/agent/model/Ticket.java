package com.vibecode.agent.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Represents a ticket from the backend API.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class Ticket {
    private Long id;
    private String title;
    private String description;
    private String status;
    private String priority;
    private Long projectId;
    private Long ownerId;
    @JsonProperty("assigned_agent_id")
    private Long assignedAgentId;
    @JsonProperty("locked_at")
    private String lockedAt;
    private String createdAt;
    private String updatedAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    public String getPriority() { return priority; }
    public void setPriority(String priority) { this.priority = priority; }

    public Long getProjectId() { return projectId; }
    public void setProjectId(Long projectId) { this.projectId = projectId; }

    public Long getOwnerId() { return ownerId; }
    public void setOwnerId(Long ownerId) { this.ownerId = ownerId; }

    public Long getAssignedAgentId() { return assignedAgentId; }
    public void setAssignedAgentId(Long assignedAgentId) { this.assignedAgentId = assignedAgentId; }

    public String getLockedAt() { return lockedAt; }
    public void setLockedAt(String lockedAt) { this.lockedAt = lockedAt; }

    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }

    public String getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(String updatedAt) { this.updatedAt = updatedAt; }

    public boolean isAvailable() {
        return "backlog".equals(status) && assignedAgentId == null;
    }

    public boolean isLocked() {
        return assignedAgentId != null;
    }

    public boolean isInProgress() {
        return "in_progress".equals(status);
    }

    @Override
    public String toString() {
        return "Ticket{id=" + id + ", title='" + title + "', status='" + status + 
            "', assignedAgentId=" + assignedAgentId + '}';
    }
}
