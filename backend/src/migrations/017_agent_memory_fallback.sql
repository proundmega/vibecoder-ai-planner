-- Migration: 016_agent_memory_fallback.sql
-- Creates agent_memory table without pgvector dependency
-- This is a fallback for systems where pgvector extension is not available

DO $$
BEGIN
  -- Check if table already exists (from successful 015 migration)
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'agent_memory'
  ) THEN
    -- Table already exists, skip
    RAISE NOTICE 'agent_memory table already exists, skipping fallback migration';
  ELSE
    -- Create table without vector extension dependency
    CREATE TABLE agent_memory (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT REFERENCES projects(id) ON DELETE CASCADE,
      agent_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding JSONB, -- Store as JSONB instead of vector type
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes (without HNSW since we don't have vector extension)
    CREATE INDEX IF NOT EXISTS idx_agent_memory_project_id ON agent_memory(project_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_agent_id ON agent_memory(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at ON agent_memory(created_at);

    -- Function to update updated_at timestamp
    CREATE OR REPLACE FUNCTION update_agent_memory_updated_at()
    RETURNS TRIGGER AS $BODY$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $BODY$ LANGUAGE plpgsql;

    -- Trigger to auto-update updated_at
    CREATE TRIGGER update_agent_memory_updated_at_trigger
      BEFORE UPDATE ON agent_memory
      FOR EACH ROW
      EXECUTE FUNCTION update_agent_memory_updated_at();

    RAISE NOTICE 'agent_memory table created successfully (without pgvector)';
  END IF;
END $$;
