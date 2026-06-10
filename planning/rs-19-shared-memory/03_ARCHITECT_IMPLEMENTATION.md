# 03_ARCHITECT_IMPLEMENTATION.md — Shared Agent Memory

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-10
**Date completed**: TBD
**PR**: TBD
**Branch**: rs-19-shared-memory

**Dependencies**: rs-13-repo-integration (repo_id for scoping), rs-14-openai-endpoints (embedding API)

---

### a) Purpose

Agents working on the same repository share context so they don't duplicate work. When Agent B starts after Agent A modified `src/auth/`, Agent B sees what was changed and why. Prevents context collisions and redundant effort.

**Value delivered**: Multi-agent projects actually work — agents build on each other's work instead of stepping on toes.

---

### b) Actions

1. **Create migration** — `backend/src/migrations/016_agent_memory.sql`
   - Enable pgvector extension
   - `agent_memory` table with vector(1536) embedding column
   - HNSW index for fast vector search

2. **Create MemoryIndexer** — `backend/src/services/MemoryIndexer.js`
   - `indexMemory(repoId, ticketId, userId, type, content, metadata)` — generates embedding, stores in DB
   - `searchSimilar(repoId, query, limit)` — vector search, returns top-k similar memories
   - `generateEmbedding(text)` — calls OpenAI embeddings API

3. **Update AgentService** — `backend/src/services/AgentService.js`
   - `getAgentContext(ticketId)` — fetches relevant past memories for ticket
   - `buildSystemPrompt(ticketId)` — injects relevant memories into system prompt

4. **Create MemoryController** — `backend/src/controllers/memoryController.js`
   - `getMemory(req, res, next)` → GET `/api/repos/:repoId/memory`
   - `searchMemory(req, res, next)` → POST `/api/repos/:repoId/memory/search`

5. **Create routes** — `backend/src/api/memory.js`
   - `GET /api/repos/:repoId/memory` — list memories for repo
   - `POST /api/repos/:repoId/memory/search` — semantic search

6. **Trigger indexing on events**:
   - After agent commits: extract file changes → index as `file_change`
   - After agent message: index significant messages → `decision`/`context`
   - After ticket status change: index summary → `pattern`

7. **Create tests**
   - `backend/src/__tests__/memoryIndexer.test.js` — indexing and search tests
   - `backend/src/__tests__/memoryController.test.js` — controller tests

---

### c) Dependencies

- **rs-13-repo-integration** — repo_id for scoping memories per repo
- **rs-14-openai-endpoints** — OpenAI embeddings API for generating vectors
- **pgvector** — PostgreSQL extension for vector search

---

### d) Risks/Edge Cases

- **[Embedding cost]**: OpenAI embeddings cost money — batch indexing, cache embeddings
- **[Vector index size]**: High agent activity → large vector index — add TTL (keep 6 months)
- **[Query relevance]**: Poor similarity search — tune top-k, add metadata filters
- **[Local embeddings]**: If no OpenAI key, fall back to simple keyword search (TF-IDF)
- **[Cross-repo leakage]**: Memories scoped to repo_id — never leak across repos

---

### e) Testing

#### Unit Tests
- [ ] MemoryIndexer.indexMemory() — generates embedding, stores in DB
- [ ] MemoryIndexer.searchSimilar() — returns top-k similar memories
- [ ] MemoryIndexer.searchSimilar() — scoped to repo_id only
- [ ] AgentService.getAgentContext() — returns relevant memories for ticket
- [ ] Embedding generation — correct vector dimensions

#### Integration Tests
- [ ] Full lifecycle: agent action → memory indexed → agent query → relevant results
- [ ] Cross-repo isolation: query repo A doesn't return repo B memories

---

### f) Migration Notes

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

### g) Notes

- Embeddings: 1536 dimensions (OpenAI text-embedding-3-small)
- HNSW index for O(log n) vector search
- Memory types: file_change, decision, context, pattern
- TTL: memories older than 6 months auto-archived (cron job)
- Fallback: if no embedding API, use simple keyword search (LIKE %query%)

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Design spec, pgvector, memory types, agent query integration*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
