package com.vibecode.agent.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Represents a file operation to be performed in the agent's workspace.
 * Used to parse AI-generated output and execute file writes/creates/deletes.
 */
public class FileOperation {

    public enum Action {
        @JsonProperty("create")
        CREATE,
        
        @JsonProperty("modify")
        MODIFY,
        
        @JsonProperty("delete")
        DELETE
    }

    private String path;
    private String content;
    private Action action;
    private String search; // for MODIFY: substring to search and replace

    public FileOperation() {}

    public FileOperation(String path, String content, Action action) {
        this.path = path;
        this.content = content;
        this.action = action;
    }

    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }
    
    public String getContent() { return content; }
    public void setContent(String content) { this.content = content; }
    
    public Action getAction() { return action; }
    public void setAction(Action action) { this.action = action; }
    
    public String getSearch() { return search; }
    public void setSearch(String search) { this.search = search; }

    @Override
    public String toString() {
        return "FileOperation{path='" + path + "', action=" + action + "}";
    }
}
