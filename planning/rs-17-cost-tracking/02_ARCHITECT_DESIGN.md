# 02_ARCHITECT_DESIGN.md — Cost Tracking & Usage Logging

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

Users need visibility into AI usage costs. How many tokens did each agent use? Which provider was most expensive? We need usage tracking per project and per user.

---

## Current State

- No usage tracking
- No cost visibility
- Agents make API calls without logging

---

## Design

### Architecture

```
Agent → Provider → API Call → UsageLogger → DB (usage_logs)
                                              ↓
                                         Dashboard (per project/user)
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  agent_id BIGINT REFERENCES users(id),
  provider_type VARCHAR(50) NOT NULL,       -- 'claude', 'openai', 'generic'
  model VARCHAR(100) NOT NULL,              -- e.g., 'claude-sonnet-4-20250514'
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ticket_id BIGINT REFERENCES tickets(id),
  request_type VARCHAR(50) NOT NULL DEFAULT 'chat',  -- 'chat'|'embed'|'complete'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_logs_project_id ON usage_logs(project_id);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX idx_usage_logs_model ON usage_logs(model);
```

### Pricing Configuration

```javascript
// backend/src/utils/pricing.js
const MODEL_PRICING = {
  // Anthropic
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-haiku-3-5': { input: 0.0008, output: 0.004 },
  
  // OpenAI
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  
  // Generic (per-token pricing, adjustable)
  'default': { input: 0.001, output: 0.003 },
};

function calculateCost(model, tokensIn, tokensOut) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const costIn = (tokensIn / 1_000_000) * pricing.input;
  const costOut = (tokensOut / 1_000_000) * pricing.output;
  return costIn + costOut;
}

module.exports = { MODEL_PRICING, calculateCost };
```

### Usage Logging

```javascript
// backend/src/services/UsageLogger.js
class UsageLogger {
  static async log(projectId, userId, agentId, providerType, model, usage, durationMs, ticketId = null) {
    const cost = calculateCost(model, usage.input_tokens || 0, usage.output_tokens || 0);
    
    await pool.query(
      `INSERT INTO usage_logs 
       (project_id, user_id, agent_id, provider_type, model, tokens_in, tokens_out, cost_usd, duration_ms, ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [projectId, userId, agentId, providerType, model, usage.input_tokens || 0, usage.output_tokens || 0, cost, durationMs, ticketId]
    );
  }
  
  static async getProjectUsage(projectId, since, until) {
    const result = await pool.query(
      `SELECT 
         provider_type, model, 
         SUM(tokens_in) as total_in, 
         SUM(tokens_out) as total_out,
         SUM(cost_usd) as total_cost,
         COUNT(*) as total_calls
       FROM usage_logs 
       WHERE project_id = $1 AND created_at BETWEEN $2 AND $3
       GROUP BY provider_type, model
       ORDER BY total_cost DESC`,
      [projectId, since, until]
    );
    return result.rows;
  }
  
  static async getUserUsage(userId, since, until) {
    const result = await pool.query(
      `SELECT 
         p.name as project_name,
         provider_type, model,
         SUM(cost_usd) as total_cost,
         COUNT(*) as total_calls
       FROM usage_logs ul
       JOIN projects p ON ul.project_id = p.id
       WHERE ul.user_id = $1 AND ul.created_at BETWEEN $2 AND $3
       GROUP BY p.name, provider_type, model
       ORDER BY total_cost DESC`,
      [userId, since, until]
    );
    return result.rows;
  }
}
```

### Provider Integration

Wrap each provider's `chat()` method to log usage:

```javascript
// backend/src/providers/base/ProviderInterface.js (enhanced)
class ProviderInterface {
  async chat(messages, options = {}) {
    const startTime = Date.now();
    const response = await this._chatImpl(messages, options);
    const duration = Date.now() - startTime;
    
    // Log usage (non-blocking)
    UsageLogger.log(
      this.projectId,
      this.userId,
      this.agentId,
      this.providerType,
      this.model,
      response.usage,
      duration,
      this.ticketId
    ).catch(err => console.error('Usage logging failed:', err));
    
    return response;
  }
  
  // Actual implementation in subclass
  async _chatImpl(messages, options) {
    throw new Error('Not implemented');
  }
}
```

### Dashboard API

```javascript
// backend/src/controllers/usageController.js
async function getProjectUsage(req, res, next) {
  const { since, until } = req.query;
  const usage = await UsageLogger.getProjectUsage(req.projectId, since, until);
  res.json({ success: true, data: usage });
}

async function getUserUsage(req, res, next) {
  const { since, until } = req.query;
  const usage = await UsageLogger.getUserUsage(req.user.userId, since, until);
  res.json({ success: true, data: usage });
}
```

### Plan-Based Approach (Future)

When ready to add plan limits:
```sql
CREATE TABLE IF NOT EXISTS project_plans (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  plan_name VARCHAR(50) NOT NULL,           -- 'free', 'pro', 'enterprise'
  monthly_token_limit BIGINT,               -- null = unlimited
  monthly_cost_limit DECIMAL(12,2),         -- null = unlimited
  current_month_tokens BIGINT DEFAULT 0,
  current_month_cost DECIMAL(12,2) DEFAULT 0,
  billing_period_start DATE DEFAULT CURRENT_DATE,
  billing_period_end DATE DEFAULT CURRENT_DATE + INTERVAL '1 month',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## Dependencies

- **pricing.js** — model pricing configuration
- **usage_logs table** — new table for usage data

---

## Risks/Edge Cases

- **[Pricing accuracy]**: Model pricing changes — pricing.js needs updates, or fetch from provider API
- **[Cost calculation]**: Different providers have different pricing structures — normalize to USD
- **[Data volume]**: High agent activity → many usage rows — add TTL policy (keep 90 days)
- **[Missing usage]**: If usage logging fails, don't block the agent call — log error, continue
- **[Custom models]**: Generic provider may use custom models — allow manual pricing override

---

## Migration Notes

```sql
-- Migration: 013_usage_logs.sql
CREATE TABLE IF NOT EXISTS usage_logs (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id),
  agent_id BIGINT REFERENCES users(id),
  provider_type VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  ticket_id BIGINT REFERENCES tickets(id),
  request_type VARCHAR(50) NOT NULL DEFAULT 'chat',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_usage_logs_project_id ON usage_logs(project_id);
CREATE INDEX idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX idx_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX idx_usage_logs_model ON usage_logs(model);

-- Optional: Auto-delete old usage data (90 days)
-- CREATE OR REPLACE FUNCTION cleanup_old_usage()
-- RETURNS VOID AS $$
-- BEGIN
--   DELETE FROM usage_logs WHERE created_at < NOW() - INTERVAL '90 days';
-- END;
-- $$ LANGUAGE plpgsql;
```

---

*This document defines the design for cost tracking. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
