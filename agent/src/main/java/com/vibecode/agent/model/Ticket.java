package com.vibecode.agent.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

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
    @JsonProperty("assigned_runtime_id")
    private Long assignedRuntimeId;
    @JsonProperty("locked_at")
    private String lockedAt;
    @JsonProperty("pr_url")
    private String prUrl;
    private Boolean ready;
    private List<Map<String, Object>> blockedBy;
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

    public Long getAssignedRuntimeId() { return assignedRuntimeId; }
    public void setAssignedRuntimeId(Long assignedRuntimeId) { this.assignedRuntimeId = assignedRuntimeId; }

    public String getLockedAt() { return lockedAt; }
    public void setLockedAt(String lockedAt) { this.lockedAt = lockedAt; }

    public String getPrUrl() { return prUrl; }
    public void setPrUrl(String prUrl) { this.prUrl = prUrl; }

    public Boolean getReady() { return ready; }
    public void setReady(Boolean ready) { this.ready = ready; }

    public List<Map<String, Object>> getBlockedBy() { return blockedBy; }
    public void setBlockedBy(List<Map<String, Object>> blockedBy) { this.blockedBy = blockedBy; }

    public String getCreatedAt() { return createdAt; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }

    public String getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(String updatedAt) { this.updatedAt = updatedAt; }

    /**
     * Fill fields the pickup response does not echo (Track A returns only the
     * assignment fields) from the backlog listing the processor already has.
     * Pickup-owned fields are authoritative and are never overwritten.
     */
    public void fillMissingFrom(Ticket listed) {
        if (listed == null) return;
        if (description == null) description = listed.description;
        if (projectId == null) projectId = listed.projectId;
        if (priority == null) priority = listed.priority;
        if (ownerId == null) ownerId = listed.ownerId;
        if (ready == null) ready = listed.ready;
        if (createdAt == null) createdAt = listed.createdAt;
        if (updatedAt == null) updatedAt = listed.updatedAt;
    }

    public boolean isAvailable() {
        return "backlog".equals(status)
            && assignedRuntimeId == null
            && (prUrl == null || prUrl.isBlank())
            && !Boolean.FALSE.equals(ready);
    }

    public boolean isLocked() {
        return assignedRuntimeId != null;
    }

    public boolean isInProgress() {
        return "in_progress".equals(status);
    }

    @Override
    public String toString() {
        return "Ticket{id=" + id + ", title='" + title + "', status='" + status + 
            "', assignedRuntimeId=" + assignedRuntimeId + '}';
    }
}
