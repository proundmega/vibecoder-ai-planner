const { pool } = require('../db');
const { NotFoundError, DependencyConflictError } = require('../errors/HttpError');

const COMPLETE_PHASES = new Set(['done', 'deployed']);
const REOPEN_SOURCE_PHASES = new Set(['done', 'deployed']);
const REOPEN_TARGET_PHASE = 'in_progress';

function normaliseDependsOn(value) {
  if (!value) return [];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))];
}

function projectIdOf(ticket) {
  return ticket.projectId ?? ticket.project_id;
}

function isComplete(dep) {
  return dep.status === 'done' || COMPLETE_PHASES.has(dep.phase);
}

function emptyReadiness() {
  return { ready: true, blockedBy: [] };
}

function unresolved(id, reason) {
  return { id: String(id), title: null, status: null, phase: null, reason };
}

/**
 * bp-134: dependency readiness and enforcement.
 *
 * The single-ticket readiness path can optionally lock the target and every
 * same-project dependency row. Start/transition writes must use `lock: true`
 * in the same transaction so a concurrent dependency reopen cannot slip
 * between the check and the write.
 */
class DependencyService {
  db(client) {
    return client || pool;
  }

  async target(ticketId, client, lock) {
    const db = this.db(client);
    const result = await db.query(
      `SELECT id, project_id, depends_on
       FROM tickets
       WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
      [ticketId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('Ticket not found');
    }
    return result.rows[0];
  }

  async startedAt(ticketId, client) {
    const db = this.db(client);
    const result = await db.query(
      `SELECT created_at
       FROM ticket_phases
       WHERE ticket_id = $1 AND to_phase = 'in_progress'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [ticketId]
    );
    return result.rows[0]?.created_at || null;
  }

  async startedAtForIds(ticketIds, client) {
    if (ticketIds.length === 0) return new Map();
    const db = this.db(client);
    const result = await db.query(
      `SELECT DISTINCT ON (ticket_id) ticket_id, created_at
       FROM ticket_phases
       WHERE ticket_id = ANY($1::bigint[]) AND to_phase = 'in_progress'
       ORDER BY ticket_id, created_at DESC, id DESC`,
      [ticketIds]
    );
    return new Map(result.rows.map(row => [String(row.ticket_id), row.created_at]));
  }

  async dependencyRows(ids, client) {
    if (ids.length === 0) return [];
    const db = this.db(client);
    const result = await db.query(
      `SELECT id, project_id, deleted_at, title, status, phase
       FROM tickets
       WHERE id = ANY($1::bigint[])`,
      [ids]
    );
    return result.rows;
  }

  async latestPhases(ids, client) {
    if (ids.length === 0) return new Map();
    const db = this.db(client);
    const result = await db.query(
      `SELECT DISTINCT ON (ticket_id) ticket_id, from_phase, to_phase, created_at
       FROM ticket_phases
       WHERE ticket_id = ANY($1::bigint[])
       ORDER BY ticket_id, created_at DESC, id DESC`,
      [ids]
    );
    return new Map(result.rows.map(row => [String(row.ticket_id), row]));
  }

  classify(target, ids, dependencyRows, phaseMap, startedAt) {
    const byId = new Map(dependencyRows.map(row => [String(row.id), row]));
    const start = startedAt ? new Date(startedAt).getTime() : null;
    const blockedBy = [];

    for (const id of ids) {
      if (String(id) === String(target.id)) {
        blockedBy.push(unresolved(id, 'self'));
        continue;
      }

      const dep = byId.get(String(id));
      if (!dep) {
        blockedBy.push(unresolved(id, 'missing'));
        continue;
      }
      if (dep.deleted_at) {
        blockedBy.push(unresolved(id, 'deleted'));
        continue;
      }
      if (String(dep.project_id) !== String(target.project_id)) {
        blockedBy.push(unresolved(id, 'cross_project'));
        continue;
      }
      if (isComplete(dep)) continue;

      const last = phaseMap.get(String(id));
      const reopened = Boolean(
        last
        && REOPEN_SOURCE_PHASES.has(last.from_phase)
        && last.to_phase === REOPEN_TARGET_PHASE
        && start !== null
        && new Date(last.created_at).getTime() > start
      );

      blockedBy.push({
        id: String(id),
        title: dep.title,
        status: dep.status,
        phase: dep.phase,
        reason: reopened ? 'dependency_reopened' : 'not_done',
      });
    }

    return blockedBy;
  }

  async readiness(ticketId, { client = null, lock = false } = {}) {
    const target = await this.target(ticketId, client, lock);
    const ids = normaliseDependsOn(target.depends_on);
    if (ids.length === 0) return emptyReadiness();

    const startedAt = await this.startedAt(ticketId, client);
    const phaseMap = await this.latestPhases(ids, client);
    let dependencies = await this.dependencyRows(ids, client);
    let blockedBy = this.classify(
      target,
      ids,
      dependencies,
      phaseMap,
      startedAt
    );

    // Fail closed before locking: cross-project, self, missing, deleted or
    // otherwise unresolved entries are never locked and never leak details.
    if (blockedBy.length > 0) {
      return { ready: false, blockedBy };
    }

    if (lock) {
      const db = this.db(client);
      const locked = await db.query(
        `SELECT id, project_id, deleted_at, title, status, phase
         FROM tickets
         WHERE id = ANY($1::bigint[])
           AND project_id = $2
           AND deleted_at IS NULL
         ORDER BY id
         FOR UPDATE`,
        [ids, target.project_id]
      );
      const lockedIds = new Set(locked.rows.map(row => String(row.id)));
      const vanished = ids.filter(id => !lockedIds.has(String(id)));
      if (vanished.length > 0) {
        return {
          ready: false,
          blockedBy: vanished.map(id => unresolved(id, 'missing')),
        };
      }

      dependencies = locked.rows;
      blockedBy = this.classify(
        target,
        ids,
        dependencies,
        phaseMap,
        startedAt
      );
    }

    return blockedBy.length > 0 ? { ready: false, blockedBy } : emptyReadiness();
  }

  /**
   * Read-only batch enrichment for ticket lists and detail. One dependency
   * query plus one phase query, not an N+1 per ticket.
   */
  async readinessForTickets(tickets, { client = null } = {}) {
    if (tickets.length === 0) return [];

    const allDependencyIds = [
      ...new Set(
        tickets.flatMap(ticket => normaliseDependsOn(ticket.dependsOn ?? ticket.depends_on))
      ),
    ];
    if (allDependencyIds.length === 0) {
      return tickets.map(() => emptyReadiness());
    }

    const dependencies = await this.dependencyRows(allDependencyIds, client);
    const phaseMap = await this.latestPhases(allDependencyIds, client);
    const starts = await this.startedAtForIds(
      tickets.map(ticket => String(ticket.id)),
      client
    );

    return tickets.map(ticket => {
      const target = {
        id: ticket.id,
        project_id: projectIdOf(ticket),
        depends_on: ticket.dependsOn ?? ticket.depends_on,
      };
      const ids = normaliseDependsOn(target.depends_on);
      if (ids.length === 0) return emptyReadiness();

      const blockedBy = this.classify(
        target,
        ids,
        dependencies,
        phaseMap,
        starts.get(String(ticket.id)) || null
      );
      return blockedBy.length > 0 ? { ready: false, blockedBy } : emptyReadiness();
    });
  }

  async enrich(tickets, options = {}) {
    const readiness = await this.readinessForTickets(tickets, options);
    return tickets.map((ticket, index) => Object.assign(ticket, readiness[index]));
  }

  async assertReady(ticketId, { client = null, lock = false } = {}) {
    const readiness = await this.readiness(ticketId, { client, lock });
    if (!readiness.ready) {
      const count = readiness.blockedBy.length;
      throw new DependencyConflictError(
        `Cannot start: ${count} dependenc${count === 1 ? 'y is' : 'ies are'} not done`,
        { ticketId: String(ticketId), blockedBy: readiness.blockedBy }
      );
    }
    return readiness;
  }
}

module.exports = new DependencyService();
