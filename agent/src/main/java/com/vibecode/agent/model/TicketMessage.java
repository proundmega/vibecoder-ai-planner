package com.vibecode.agent.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDateTime;

/**
 * A message posted on a ticket for agent coordination.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class TicketMessage {
    private Long id;
    private Long ticketId;
    private Long userId;
    @JsonProperty("user_name")
    private String userName;
    @JsonProperty("user_email")
    private String userEmail;
    private String messageType;
    private String content;
    private LocalDateTime createdAt;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getTicketId() { return ticketId; }
    public void setTicketId(Long ticketId) { this.ticketId = ticketId; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getUserName() { return userName; }
    public void setUserName(String userName) { this.userName = userName; }

    public String getUserEmail() { return userEmail; }
    public void setUserEmail(String userEmail) { this.userEmail = userEmail; }

    public String getMessageType() { return messageType; }
    public void setMessageType(String messageType) { this.messageType = messageType; }

    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    @Override
    public String toString() {
        return "TicketMessage{id=" + id + ", type='" + messageType + "', content='" + 
            content.substring(0, Math.min(content.length(), 100)) + "'...}";
    }
}
