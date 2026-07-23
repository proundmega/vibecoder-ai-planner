
const { pool } = require('../db');
const Ticket = require('../models/ticket');
const TemplateService = require('./TemplateService');
const { NotFoundError } = require('../errors/HttpError');

class TicketPlanningService {
  async list(ticketId, _userId) {
    const result = await pool.query(
      `SELECT tp.*, u.name as created_by_name, t.title as ticket_title,
              tp.last_tokens_in, tp.last_tokens_out, tp.last_cost_usd,
              tp.last_duration_ms, tp.last_provider_type, tp.last_model,
              tp.last_planning_stage, tp.last_ai_call_at
       FROM ticket_planning tp
       LEFT JOIN users u ON tp.created_by = u.id
       JOIN tickets t ON tp.ticket_id = t.id
       WHERE tp.ticket_id = $1
       ORDER BY tp.file_key ASC, tp.version DESC`,
      [ticketId]
    );
    const latestFiles = {};
    for (const row of result.rows) {
      const key = row.file_key;
      if (!latestFiles[key] || row.version > latestFiles[key].version) {
        latestFiles[key] = row;
      }
    }
    return Object.values(latestFiles).map(f => ({
      key: f.file_key,
      content: f.content,
      version: f.version,
      updated_at: f.updated_at,
      created_by_name: f.created_by_name || null,
      ticket_title: f.ticket_title || null,
      last_tokens_in: f.last_tokens_in || 0,
      last_tokens_out: f.last_tokens_out || 0,
      last_cost_usd: parseFloat(f.last_cost_usd || 0),
      last_duration_ms: f.last_duration_ms || 0,
      last_provider_type: f.last_provider_type || null,
      last_model: f.last_model || null,
      last_planning_stage: f.last_planning_stage || null,
      last_ai_call_at: f.last_ai_call_at || null,
    }));
  }

  async get(ticketId, fileKey, _userId) {
    const result = await pool.query(
      `SELECT tp.*, u.name as created_by_name, t.title as ticket_title,
              tp.last_tokens_in, tp.last_tokens_out, tp.last_cost_usd,
              tp.last_duration_ms, tp.last_provider_type, tp.last_model,
              tp.last_planning_stage, tp.last_ai_call_at
       FROM ticket_planning tp
       LEFT JOIN users u ON tp.created_by = u.id
       JOIN tickets t ON tp.ticket_id = t.id
       WHERE tp.ticket_id = $1 AND tp.file_key = $2
       ORDER BY tp.version DESC
       LIMIT 1`,
      [ticketId, fileKey]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      key: row.file_key,
      content: row.content,
      version: row.version,
      updated_at: row.updated_at,
      created_by_name: row.created_by_name || null,
      ticket_title: row.ticket_title || null,
      last_tokens_in: row.last_tokens_in || 0,
      last_tokens_out: row.last_tokens_out || 0,
      last_cost_usd: parseFloat(row.last_cost_usd || 0),
      last_duration_ms: row.last_duration_ms || 0,
      last_provider_type: row.last_provider_type || null,
      last_model: row.last_model || null,
      last_planning_stage: row.last_planning_stage || null,
      last_ai_call_at: row.last_ai_call_at || null,
    };
  }

  async upsert(ticketId, fileKey, content, userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const latestResult = await client.query(
        `SELECT version FROM ticket_planning 
         WHERE ticket_id = $1 AND file_key = $2 
         ORDER BY version DESC LIMIT 1`,
        [ticketId, fileKey]
      );

      const newVersion = latestResult.rows.length > 0
        ? latestResult.rows[0].version + 1
        : 1;

      await client.query(
        `INSERT INTO ticket_planning (ticket_id, file_key, content, version, created_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (ticket_id, file_key, version) DO NOTHING`,
        [ticketId, fileKey, content, newVersion, userId]
      );

      await client.query(
        'UPDATE tickets SET planning_status = \'in_progress\', updated_at = NOW() WHERE id = $1',
        [ticketId]
      );

      await client.query('COMMIT');

      return await this.get(ticketId, fileKey, userId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async applyTemplate(ticketId, templateName, userId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let templateFiles;
      let getContent;

      if (templateName === 'architecture') {
        templateFiles = TemplateService.getArchitectTemplate();
        getContent = TemplateService.getArchitectTemplateContent;
      } else if (templateName === 'technical') {
        templateFiles = TemplateService.getTechnicalTemplate();
        getContent = TemplateService.getTechnicalTemplateContent;
      } else if (templateName === 'simple') {
        templateFiles = TemplateService.getSimpleTemplate();
        getContent = TemplateService.getSimpleTemplateContent;
      } else if (templateName === 'specification') {
        templateFiles = TemplateService.getSpecificationTemplate();
        getContent = TemplateService.getSpecificationTemplateContent;
      } else {
        templateFiles = await this._getCustomTemplate(ticketId, templateName);
        getContent = (key) => {
          const fileDef = templateFiles.find(f => f.key === key);
          return fileDef?.content || '';
        };
      }

      for (const fileDef of templateFiles) {
        const content = getContent(fileDef.key);

        await client.query(
          `INSERT INTO ticket_planning (ticket_id, file_key, content, version, created_by)
           VALUES ($1, $2, $3, 1, $4)`,
          [ticketId, fileDef.key, content, userId]
        );
      }

      await client.query(
        'UPDATE tickets SET planning_status = \'template_selected\', template_schema = $1 WHERE id = $2',
        [templateName, ticketId]
      );

      await client.query('COMMIT');
      return templateFiles;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateStatus(ticketId, status, _userId) {
    const validStatuses = ['not_started', 'template_selected', 'in_progress', 'review', 'completed'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid planning status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }

    await pool.query(
      'UPDATE tickets SET planning_status = $1, updated_at = NOW() WHERE id = $2',
      [status, ticketId]
    );
  }

  async getPlanningForTicket(ticket, userId) {
    const files = await this.list(ticket.id, userId);

    const latestFiles = {};
    for (const file of files) {
      if (!latestFiles[file.key] || file.version > latestFiles[file.key].version) {
        latestFiles[file.key] = file;
      }
    }

    return {
      status: ticket.planningStatus || 'not_started',
      templateSchema: ticket.templateSchema || null,
      files: Object.values(latestFiles).map(f => ({
        fileKey: f.key,
        content: f.content,
        version: f.version,
        updatedAt: f.updated_at,
        createdBy: f.created_by_name || null,
        last_tokens_in: f.last_tokens_in || 0,
        last_tokens_out: f.last_tokens_out || 0,
        last_cost_usd: f.last_cost_usd || 0,
        last_duration_ms: f.last_duration_ms || 0,
        last_provider_type: f.last_provider_type || null,
        last_model: f.last_model || null,
        last_planning_stage: f.last_planning_stage || null,
        last_ai_call_at: f.last_ai_call_at || null,
      })),
    };
  }

  async _getCustomTemplate(ticketId, templateName) {
    
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) throw new Error('Ticket not found');

    const result = await pool.query(
      'SELECT * FROM project_templates WHERE project_id = $1 AND name = $2',
      [ticket.projectId, templateName]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError(`Custom template not found: ${templateName}`);
    }

    return JSON.parse(result.rows[0].file_definitions);
  }
}

module.exports = new TicketPlanningService();
