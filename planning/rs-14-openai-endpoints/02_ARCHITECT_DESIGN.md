# 02_ARCHITECT_DESIGN.md — OpenAI-Compatible Endpoint Support

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

Currently the system only supports Anthropic's Claude API. Users want to use any OpenAI-compatible endpoint (OpenAI, LM Studio, vLLM, Ollama, Together.ai) and assign different providers to different agent roles within a project.

---

## Current State

- Agent creation accepts Anthropic API key
- No provider abstraction — Anthropic-specific code scattered
- Single provider per agent
- No role-based provider selection

---

## Design

### Architecture

```
Agent → ProviderRouter → [ClaudeProvider, OpenAIProvider, GenericProvider]
                              ↓              ↓               ↓
                         Anthropic API    OpenAI API     Any OpenAI-compatible
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS project_providers (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,                  -- e.g., 'claude-pro', 'openai-worker'
  provider_type VARCHAR(50) NOT NULL,           -- 'claude', 'openai', 'generic'
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,                                -- null for official APIs, custom for others
  model VARCHAR(100) NOT NULL,                  -- e.g., 'claude-sonnet-4-20250514', 'gpt-4o'
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'], -- 'planner'|'worker'|'reviewer'|'approver'
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider_type CHECK (provider_type IN ('claude', 'openai', 'generic')),
  CONSTRAINT valid_roles CHECK (array_length(roles, 1) > 0)
);

CREATE INDEX idx_project_providers_project_id ON project_providers(project_id);
CREATE INDEX idx_project_providers_is_active ON project_providers(is_active);
CREATE INDEX idx_project_providers_roles ON project_providers USING GIN(roles);
```

### Provider Interface

All providers implement a common interface:

```javascript
// backend/src/providers/base/ProviderInterface.js
class ProviderInterface {
  /**
   * Send a chat request and return the response
   * @param {Object} messages - Array of {role, content}
   * @param {Object} options - { max_tokens, temperature, stream }
   * @returns {Object} - { content, usage, stop_reason }
   */
  async chat(messages, options = {}) {
    throw new Error('Not implemented');
  }

  /**
   * Validate the provider connection
   * @returns {Promise<boolean>}
   */
  async validate() {
    throw new Error('Not implemented');
  }

  /**
   * Get provider-specific system prompt formatting
   * @param {string} systemPrompt
   * @returns {Object} - { role: 'system', content: formattedPrompt }
   */
  formatSystemPrompt(systemPrompt) {
    return { role: 'system', content: systemPrompt };
  }
}
```

### Provider Folder Structure

```
backend/src/providers/
  base/
    ProviderInterface.js   → abstract interface all providers must implement
  claude/
    index.js               → ClaudeProvider class
    api.js                 → Anthropic API client
    prompts.js             → Claude-specific prompt formatting
  openai/
    index.js               → OpenAIProvider class
    api.js                 → OpenAI API client
    prompts.js             → OpenAI-specific prompt formatting
  generic/
    index.js               → GenericProvider class (any OpenAI-compatible)
    api.js                 → Generic HTTP client
    prompts.js             → Standard OpenAI format
```

### Provider Router

```javascript
// backend/src/services/ProviderRouter.js
class ProviderRouter {
  constructor(projectId) {
    this.projectId = projectId;
    this.providers = new Map();
  }

  async loadProviders() {
    const rows = await pool.query(
      `SELECT * FROM project_providers WHERE project_id = $1 AND is_active = true`,
      [this.projectId]
    );
    for (const row of rows.rows) {
      const provider = this.createProvider(row);
      for (const role of row.roles) {
        this.providers.set(`${row.project_id}:${role}`, provider);
      }
    }
  }

  getForRole(role) {
    const key = `${this.projectId}:${role}`;
    const provider = this.providers.get(key);
    if (!provider) {
      throw new Error(`No provider configured for role: ${role}`);
    }
    return provider;
  }

  createProvider(row) {
    switch (row.provider_type) {
      case 'claude':
        return new ClaudeProvider(row);
      case 'openai':
        return new OpenAIProvider(row);
      case 'generic':
        return new GenericProvider(row);
      default:
        throw new Error(`Unknown provider type: ${row.provider_type}`);
    }
  }
}
```

### Provider Implementations

**ClaudeProvider:**
```javascript
// backend/src/providers/claude/index.js
const Anthropic = require('@anthropic-ai/sdk');
const ProviderInterface = require('../base/ProviderInterface');

class ClaudeProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model || 'claude-sonnet-4-20250514';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
  }

  async chat(messages, options = {}) {
    const { content, system } = this.formatMessages(messages);
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      system,
      messages: content,
    });
    return {
      content: response.content[0].text,
      usage: response.usage,
      stop_reason: response.stop_reason,
    };
  }
}
```

**OpenAIProvider:**
```javascript
// backend/src/providers/openai/index.js
const OpenAI = require('openai');
const ProviderInterface = require('../base/ProviderInterface');

class OpenAIProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
  }

  async chat(messages, options = {}) {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options.maxTokens || this.maxTokens,
      temperature: options.temperature ?? this.temperature,
      messages,
    });
    const choice = response.choices[0];
    return {
      content: choice.message.content,
      usage: response.usage,
      stop_reason: choice.finish_reason,
    };
  }
}
```

**GenericProvider (any OpenAI-compatible):**
```javascript
// backend/src/providers/generic/index.js
const axios = require('axios');
const ProviderInterface = require('../base/ProviderInterface');

class GenericProvider extends ProviderInterface {
  constructor(config) {
    super();
    this.baseURL = config.baseUrl;
    this.model = config.model || 'gpt-4o';
    this.maxTokens = config.maxTokens || 4096;
    this.temperature = config.temperature || 0.1;
  }

  async chat(messages, options = {}) {
    const response = await axios.post(
      `${this.baseURL}/chat/completions`,
      {
        model: this.model,
        max_tokens: options.maxTokens || this.maxTokens,
        temperature: options.temperature ?? this.temperature,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    const choice = response.data.choices[0];
    return {
      content: choice.message.content,
      usage: response.data.usage,
      stop_reason: choice.finish_reason,
    };
  }
}
```

### Usage in Agent Service

```javascript
// backend/src/services/AgentService.js
async function executeAgent(ticketId, role) {
  const ticket = await Ticket.find(ticketId);
  const router = new ProviderRouter(ticket.projectId);
  await router.loadProviders();
  
  const provider = router.getForRole(role);  // 'planner', 'worker', etc.
  const response = await provider.chat(messages, { maxTokens: 4096 });
  
  return response;
}
```

### Encryption

Same approach as GitHub PATs (AES-256-GCM):
```javascript
// Shared encryption utility
const { encrypt, decrypt } = require('../utils/crypto');
```

---

## Dependencies

- **@anthropic-ai/sdk** — Anthropic API client
- **openai** — OpenAI API client
- **axios** — Generic HTTP client for custom endpoints
- **crypto** — Node.js built-in for key encryption
- **process.env.PROVIDER_ENCRYPTION_KEY** — 32-byte hex master key

---

## Risks/Edge Cases

- **[Provider downtime]**: One provider down doesn't block the project — fallback to another
- **[Rate limits]**: Each provider has different rate limits — track per-provider
- **[Key rotation]**: Update provider config without downtime
- **[Model versioning]**: Models change names — allow easy model updates
- **[Custom endpoints]**: Generic provider must handle auth headers correctly (some use `api-key` header)
- **[Response format]**: Different providers may return different usage/stop_reason formats — normalize in interface

---

## Migration Notes

```sql
-- Migration: 009_project_providers.sql
CREATE TABLE IF NOT EXISTS project_providers (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  provider_type VARCHAR(50) NOT NULL DEFAULT 'claude',
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  model VARCHAR(100) NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['worker'],
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3,2) DEFAULT 0.1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_provider_type CHECK (provider_type IN ('claude', 'openai', 'generic')),
  CONSTRAINT valid_roles CHECK (array_length(roles, 1) > 0)
);
CREATE INDEX idx_project_providers_project_id ON project_providers(project_id);
CREATE INDEX idx_project_providers_is_active ON project_providers(is_active);
CREATE INDEX idx_project_providers_roles ON project_providers USING GIN(roles);
```

---

*This document defines the design for OpenAI-compatible endpoint support. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
