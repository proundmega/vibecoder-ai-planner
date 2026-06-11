-- Migration: 015_shared_agent_memory.sql
-- Shared agent memory with pgvector for semantic search

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Agent memory storage table
CREATE TABLE IF NOT EXISTS agent_memory (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
  agent_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1536), -- OpenAI embeddings (1536 dimensions)
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for semantic search using HNSW (Hierarchical Navigable Small World)
CREATE INDEX IF NOT EXISTS idx_agent_memory_embedding ON agent_memory USING hnsw (embedding vector_cosine_ops);

-- Index for project and agent lookups
CREATE INDEX IF NOT EXISTS idx_agent_memory_project_id ON agent_memory(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at ON agent_memory(created_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_agent_memory_updated_at_trigger
  BEFORE UPDATE ON agent_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_memory_updated_at();
