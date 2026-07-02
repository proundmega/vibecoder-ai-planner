const { pool } = require('../db');
const { NotFoundError, ServiceUnavailableError } = require('../errors/HttpError');

class MemoryService {
  static _memoryTableAvailable = null;

  static async _checkTableAvailable() {
    if (MemoryService._memoryTableAvailable !== null) {
      return MemoryService._memoryTableAvailable;
    }

    try {
      const result = await pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = 'agent_memory'
        )`
      );
      MemoryService._memoryTableAvailable = result.rows[0].exists;
    } catch (error) {
      MemoryService._memoryTableAvailable = false;
    }

    return MemoryService._memoryTableAvailable;
  }

  static async addMemory(projectId, agentId, content, metadata = {}) {
    const available = await this._checkTableAvailable();
    if (!available) {
      throw new ServiceUnavailableError('Agent memory feature is not available. pgvector extension required.');
    }

    const { OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL } = process.env;
    const embeddingModel = OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

    let embedding = null;

    if (OPENAI_API_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            input: content,
            model: embeddingModel,
            dimensions: 1536,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          embedding = data.data[0].embedding;
        }
      } catch (error) {
        console.error('Failed to generate embedding:', error.message);
      }
    }

    const result = await pool.query(
      `INSERT INTO agent_memory (project_id, agent_id, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [projectId, agentId, content, embedding, JSON.stringify(metadata)]
    );

    return this._formatResult(result.rows[0]);
  }

  static async getMemory(id) {
    const available = await this._checkTableAvailable();
    if (!available) {
      return null;
    }

    try {
      const result = await pool.query(
        'SELECT * FROM agent_memory WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this._formatResult(result.rows[0]);
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return null;
      }
      throw error;
    }
  }

  static async getProjectMemory(projectId, limit = 50, offset = 0) {
    try {
      const result = await pool.query(
        `SELECT am.*, u.name as agent_name, u.email as agent_email
         FROM agent_memory am
         LEFT JOIN users u ON am.agent_id = u.id
         WHERE am.project_id = $1
         ORDER BY am.created_at DESC
         LIMIT $2 OFFSET $3`,
        [projectId, limit, offset]
      );

      return result.rows.map(row => this._formatResultWithUserInfo(row));
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return [];
      }
      throw error;
    }
  }

  static async getAgentMemory(agentId, limit = 50, offset = 0) {
    try {
      const result = await pool.query(
        `SELECT am.*, u.name as agent_name, u.email as agent_email
         FROM agent_memory am
         LEFT JOIN users u ON am.agent_id = u.id
         WHERE am.agent_id = $1
         ORDER BY am.created_at DESC
         LIMIT $2 OFFSET $3`,
        [agentId, limit, offset]
      );

      return result.rows.map(row => this._formatResultWithUserInfo(row));
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return [];
      }
      throw error;
    }
  }

  static async searchSimilar(projectId, queryContent, limit = 10, threshold = 0.3) {
    const { OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL } = process.env;
    const embeddingModel = OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

    let queryEmbedding = null;

    if (OPENAI_API_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            input: queryContent,
            model: embeddingModel,
            dimensions: 1536,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          queryEmbedding = data.data[0].embedding;
        }
      } catch (error) {
        console.error('Failed to generate query embedding:', error.message);
      }
    }

    if (!queryEmbedding) {
      return [];
    }

    try {
      const result = await pool.query(
        `SELECT am.*, u.name as agent_name, u.email as agent_email,
                1 - (am.embedding <=> $4) as similarity
         FROM agent_memory am
         LEFT JOIN users u ON am.agent_id = u.id
         WHERE am.project_id = $1
         AND am.embedding IS NOT NULL
         ORDER BY am.embedding <=> $4
         LIMIT $2`,
        [projectId, limit, queryEmbedding]
      );

      const memories = result.rows.map(row => this._formatResultWithUserInfo(row));
      return memories.filter(m => m.similarity >= threshold);
    } catch (error) {
      if (error.message.includes('does not exist')) {
        return [];
      }
      throw error;
    }
  }

  static async updateMemory(id, content, metadata) {
    const available = await this._checkTableAvailable();
    if (!available) {
      throw new ServiceUnavailableError('Agent memory feature is not available. pgvector extension required.');
    }

    const existing = await this.getMemory(id);
    if (!existing) {
      throw new NotFoundError('Memory not found');
    }

    const { OPENAI_API_KEY, OPENAI_EMBEDDING_MODEL } = process.env;
    const embeddingModel = OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

    let embedding = existing.embedding;

    if (content && OPENAI_API_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            input: content,
            model: embeddingModel,
            dimensions: 1536,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          embedding = data.data[0].embedding;
        }
      } catch (error) {
        console.error('Failed to generate embedding:', error.message);
      }
    }

    const result = await pool.query(
      `UPDATE agent_memory
       SET content = COALESCE($2, content),
           embedding = COALESCE($4, embedding),
           metadata = COALESCE($3, metadata)
       WHERE id = $1
       RETURNING *`,
      [id, content, JSON.stringify(metadata), embedding]
    );

    return this._formatResult(result.rows[0]);
  }

  static async deleteMemory(id) {
    const available = await this._checkTableAvailable();
    if (!available) {
      throw new ServiceUnavailableError('Agent memory feature is not available. pgvector extension required.');
    }

    const result = await pool.query(
      'DELETE FROM agent_memory WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Memory not found');
    }

    return this._formatResult(result.rows[0]);
  }

  static async deleteProjectMemory(projectId) {
    try {
      await pool.query(
        'DELETE FROM agent_memory WHERE project_id = $1',
        [projectId]
      );
    } catch (error) {
      if (!error.message.includes('does not exist')) {
        throw error;
      }
    }
  }

  static _formatResult(row) {
    let metadata = row.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        metadata = {};
      }
    }

    return {
      id: row.id,
      projectId: row.project_id,
      agentId: row.agent_id,
      content: row.content,
      embedding: row.embedding,
      metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static _formatResultWithUserInfo(row) {
    const memory = this._formatResult(row);
    memory.agentName = row.agent_name;
    memory.agentEmail = row.agent_email;
    return memory;
  }
}

module.exports = MemoryService;
