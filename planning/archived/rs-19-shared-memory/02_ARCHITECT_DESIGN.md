# 02_ARCHITECT_DESIGN.md — Shared Agent Memory

**Status**: planned
**Date created**: 2026-06-10
**Author**: AI Assistant

---

## Problem Statement

Agents working on the same repository need to share context: what files were changed, what decisions were made, what architecture patterns were chosen. This prevents duplicate work and context collisions. Per-repo scope since a project can have multiple repos.

---

## Current State

- No shared context between agents
- Each agent starts fresh with no knowledge of others' work
- No coordination beyond ticket status and messages

---

## Design

### Architecture

```
Agent Action (commit, message, status change)
        ↓
   MemoryIndexer → Vector DB (pgvector)
        ↓
   Query: "What changed in src/auth/?"
        ↓
   Top-k similar past changes → returned to agent
```

### Storage: pgvector (PostgreSQL)

Use pgvector since we already have PostgreSQL. No need for MongoDB — keeps infrastructure simple.

**Why pgvector over MongoDB:**
- Already have PostgreSQL — no new dependency
- Vector search in same DB as application data
- Simpler backup/restore
- ACID transactions for consistency

**Why not file-based:**
- No semantic search capability
- Hard to query "find similar changes"

### Database Schema

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_memory (
  id BIGSERIAL PRIMARY KEY,
  repo_id BIGINT REFERENCES project_repos(id) ON DELETE CASCADE,  -- per-repo scope
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id),
  memory_type VARCHAR(50) NOT NULL,           -- 'file_change'|'decision'|'context'|'pattern'
  content TEXT NOT NULL,
  embedding vector(1536),                      -- OpenAI embeddings (1536 dims)
  metadata JSONB DEFAULT '{}',                 -- file paths, diff stats, decision rationale
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_memory_repo_id ON agent_memory(repo_id);
CREATE INDEX idx_agent_memory_ticket_id ON agent_memory(ticket_id);
CREATE INDEX idx_agent_memory_type ON agent_memory(memory_type);
CREATE INDEX idx_agent_memory_created_at ON agent_memory(created_at);

-- HNSW index for fast vector search
CREATE INDEX idx_agent_memory_embedding ON agent_memory USING hnsw (embedding vector_cosine_ops);
```

### Memory Types

| Type | What it stores | Example |
|------|---------------|---------|
| `file_change` | What files were modified and how | "Modified src/auth/middleware.js: added JWT validation, removed session check" |
| `decision` | Architecture/tech decisions | "Chose JWT over sessions for stateless auth" |
| `context` | Project context discovered during work | "Project uses Express, pg, and Joi for validation" |
| `pattern` | Coding patterns observed | "Project uses IPEE pattern: Identify, Plan, Execute, Evaluate" |

### Embedding Generation

When an agent action occurs, generate embeddings:

```javascript
// backend/src/services/MemoryIndexer.js
const OpenAI = require('openai');

class MemoryIndexer {
  constructor() {
    this.client = new OpenAI({ apiKey: process.env.EMBEDDING_API_KEY });
  }

  async indexMemory(repoId, ticketId, userId, memoryType, content, metadata) {
    // Generate embedding
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: content,
    });
    
    const embedding = response.data[0].embedding;
    
    // Store in DB
    await pool.query(
      `INSERT INTO agent_memory (repo_id, ticket_id, user_id, memory_type, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [repoId, ticketId, userId, memoryType, content, embedding, JSON.stringify(metadata)]
    );
  }

  async searchSimilar(repoId, query, limit = 5) {
    // Generate embedding for query
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    });
    
    const queryEmbedding = response.data[0].embedding;
    
    // Vector search: find most similar memories
    const result = await pool.query(
      `SELECT id, memory_type, content, metadata, created_at,
              1 - (embedding <=> $1) as similarity
       FROM agent_memory
       WHERE repo_id = $2
       ORDER BY embedding <=> $1
       LIMIT $3`,
      [queryEmbedding, repoId, limit]
    );
    
    return result.rows;
  }
}
```

### When to Index

Index on these events:
1. **After agent commits code** — extract file changes, index as `file_change`
2. **After agent sends a message** — index significant messages as `decision` or `context`
3. **After ticket status changes** — index summary of work done as `pattern`
4. **On-demand** — agent can request indexing of specific content

### Agent Query Integration

When an agent starts working on a ticket, it receives relevant past context:

```javascript
// backend/src/services/AgentService.js
async function getAgentContext(ticketId) {
  const ticket = await Ticket.find(ticketId);
  const repo = await getProjectRepo(ticket.projectId);
  
  // Build query from ticket description and title
  const query = `${ticket.title}: ${ticket.description}`;
  
  // Find similar past work
  const memories = await MemoryIndexer.searchSimilar(repo.id, query, 5);
  
  // Format for agent prompt
  const context = memories.map(m => {
    return `[${m.memory_type}] ${m.content} (from ticket #${m.ticket_id || 'unknown'})`;
  }).join('\n\n');
  
  return context;
}
```

### System Prompt Enhancement

Agents receive relevant past work in their system prompt:

```
You are working on ticket #42: "Fix auth middleware"

Relevant past work:
[file_change] Modified src/auth/middleware.js: added JWT validation, removed session check (from ticket #38)
[decision] Chose JWT over sessions for stateless auth (from ticket #38)
[context] Project uses Express, pg, and Joi for validation (from ticket #35)

Use this context to avoid duplicating work.
```

---

## Dependencies

- **pgvector** — PostgreSQL extension for vector search
- **OpenAI embeddings API** — for generating embeddings (or use a local model)
- **project_repos table** — rs-13 (repo_id for scoping)

---

## Risks/Edge Cases

- **[Embedding cost]**: OpenAI embeddings cost money — batch indexing, cache embeddings
- **[Vector index size]**: High agent activity → large vector index — add TTL (keep 6 months)
- **[Query relevance]**: Poor similarity search — tune top-k, add metadata filters
- **[Local embeddings]**: If no OpenAI key, fall back to simple keyword search (TF-IDF)
- **[Cross-repo leakage]**: Memories scoped to repo_id — never leak across repos

---

## Migration Notes

```sql
-- Migration: 016_agent_memory.sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_memory (
  id BIGSERIAL PRIMARY KEY,
  repo_id BIGINT REFERENCES project_repos(id) ON DELETE CASCADE,
  ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
  user_id BIGINT REFERENCES users(id),
  memory_type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_agent_memory_repo_id ON agent_memory(repo_id);
CREATE INDEX idx_agent_memory_ticket_id ON agent_memory(ticket_id);
CREATE INDEX idx_agent_memory_type ON agent_memory(memory_type);
CREATE INDEX idx_agent_memory_created_at ON agent_memory(created_at);
CREATE INDEX idx_agent_memory_embedding ON agent_memory USING hnsw (embedding vector_cosine_ops);
```

---

*This document defines the design for shared agent memory. See `01_ARCHITECT_REQUIREMENT.md` for requirements and `03_ARCHITECT_IMPLEMENTATION.md` for implementation details.*
