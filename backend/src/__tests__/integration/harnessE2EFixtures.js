const { Pool } = require('pg');
const AgentNodeService = require('../../services/AgentNodeService');

/**
 * Disposable fixtures for the bt-60 durable-harness HTTP/Postgres e2e.
 *
 * Every row is created through the real node enrollment path
 * (`mint -> enroll -> createGrant -> declareRuntimes`) and carries a unique
 * suffix. No product user, project, node, runtime or ticket is ever reused.
 *
 * All cleanup is scoped to the ids/suffix created here. Harness events are
 * removed with the retainable `harness.allow_event_purge` opt-in, so the test
 * leaves no residual rows behind.
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function uniqueSuffix() {
  return `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

async function createUser(emailPrefix, role, suffix) {
  const result = await pool.query(
    `INSERT INTO users (email, name, password_hash, role)
     VALUES ($1, $2, 'x', $3)
     RETURNING id, email, role`,
    [`${emailPrefix}_${suffix}@bt60.test`, `bt60 ${emailPrefix} ${suffix}`, role]
  );
  return result.rows[0];
}

async function createProvider(ownerId, projectId, label, suffix) {
  const credentialName = `bt60-cred-${label}-${suffix}`;
  const modelName = `bt60-model-${label}-${suffix}`;

  const credential = await pool.query(
    `INSERT INTO provider_credentials
       (owner_id, project_id, name, provider_type, api_key_encrypted)
     VALUES ($1, $2, $3, 'openai', 'x')
     RETURNING id, name`,
    [ownerId, projectId, credentialName]
  );

  const model = await pool.query(
    `INSERT INTO provider_models
       (credential_id, model, display_name, source, status, roles)
     VALUES ($1, $2, $2, 'manual', 'verified', ARRAY['worker'])
     RETURNING id, model`,
    [credential.rows[0].id, modelName]
  );

  return {
    credentialId: credential.rows[0].id,
    modelId: model.rows[0].id,
    modelRef: `${credentialName}/${modelName}`,
  };
}

async function provisionNode({ ownerId, projectId, label, suffix, modelRef, runtimeCount = 1 }) {
  const minted = await AgentNodeService.mint({
    ownerId,
    name: `bt60-enrollment-${label}-${suffix}`,
    createdBy: ownerId,
  });

  const enrolled = await AgentNodeService.enroll({
    token: minted.token,
    name: `bt60-node-${label}-${suffix}`,
    hostname: `bt60-${label}.test`,
  });

  await AgentNodeService.createGrant(enrolled.node.id, projectId, 'worker', {
    actorId: ownerId,
  });

  const declared = await AgentNodeService.declareRuntimes(enrolled.node, [{
    role: 'worker',
    projectId,
    modelRef,
    name: `bt60-worker-${label}`,
    count: runtimeCount,
  }]);

  const runtimes = [];
  for (const runtime of declared) {
    const running = await AgentNodeService.heartbeat(enrolled.node, runtime.id, {
      status: 'running',
      currentProjectId: projectId,
    });
    runtimes.push(running);
  }

  return {
    nodeId: enrolled.node.id,
    nodeToken: enrolled.access_token,
    enrollmentTokenId: minted.id,
    runtimes,
  };
}

async function createTicket({ projectId, ownerId, runtimeId, title, status }) {
  const result = await pool.query(
    `INSERT INTO tickets (project_id, title, status, owner_id, assigned_runtime_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, status, assigned_runtime_id`,
    [projectId, title, status, ownerId, runtimeId]
  );
  return result.rows[0];
}

async function createMembership(projectId, userId) {
  await pool.query(
    `INSERT INTO project_memberships (project_id, user_id, role)
     VALUES ($1, $2, 'member')`,
    [projectId, userId]
  );
}

/**
 * Create the primary tenant plus the cross-tenant/revoked fixtures used by the
 * HTTP e2e. The returned object also carries the cleanup closure and the ids
 * needed to prove that nothing residual remains.
 */
async function createHarnessFixture() {
  const suffix = uniqueSuffix();
  const state = {
    suffix,
    userIds: [],
    projectIds: [],
    nodeIds: [],
    runtimeIds: [],
    ticketIds: [],
    credentialIds: [],
    modelIds: [],
    enrollmentTokenIds: [],
  };

  try {
    const owner = await createUser('bt60_owner', 'project_admin', suffix);
    state.userIds.push(owner.id);
    const member = await createUser('bt60_member', 'member', suffix);
    state.userIds.push(member.id);
    const plainUser = await createUser('bt60_user', 'user', suffix);
    state.userIds.push(plainUser.id);
    const superAdmin = await createUser('bt60_super', 'super_admin', suffix);
    state.userIds.push(superAdmin.id);
    const otherOwner = await createUser('bt60_other', 'project_admin', suffix);
    state.userIds.push(otherOwner.id);

    const project = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`bt60-project-${suffix}`, owner.id]
    );
    state.projectIds.push(project.rows[0].id);
    const otherProject = await pool.query(
      `INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id`,
      [`bt60-other-project-${suffix}`, otherOwner.id]
    );
    state.projectIds.push(otherProject.rows[0].id);
    await createMembership(project.rows[0].id, member.id);

    const provider = await createProvider(owner.id, project.rows[0].id, 'primary', suffix);
    state.credentialIds.push(provider.credentialId);
    state.modelIds.push(provider.modelId);
    const otherProvider = await createProvider(
      otherOwner.id,
      otherProject.rows[0].id,
      'other',
      suffix
    );
    state.credentialIds.push(otherProvider.credentialId);
    state.modelIds.push(otherProvider.modelId);

    const primary = await provisionNode({
      ownerId: owner.id,
      projectId: project.rows[0].id,
      label: 'primary',
      suffix,
      modelRef: provider.modelRef,
      runtimeCount: 2,
    });
    const other = await provisionNode({
      ownerId: otherOwner.id,
      projectId: otherProject.rows[0].id,
      label: 'other',
      suffix,
      modelRef: otherProvider.modelRef,
    });
    const revoked = await provisionNode({
      ownerId: owner.id,
      projectId: project.rows[0].id,
      label: 'revoked',
      suffix,
      modelRef: provider.modelRef,
    });
    await AgentNodeService.revoke(revoked.nodeId, { actorId: owner.id });

    state.nodeIds.push(primary.nodeId, other.nodeId, revoked.nodeId);
    state.enrollmentTokenIds.push(
      primary.enrollmentTokenId,
      other.enrollmentTokenId,
      revoked.enrollmentTokenId
    );
    state.runtimeIds.push(
      ...primary.runtimes.map((runtime) => runtime.id),
      ...other.runtimes.map((runtime) => runtime.id),
      ...revoked.runtimes.map((runtime) => runtime.id)
    );

    const ticket = await createTicket({
      projectId: project.rows[0].id,
      ownerId: owner.id,
      runtimeId: primary.runtimes[0].id,
      title: `bt60 happy ticket ${suffix}`,
      status: 'in_progress',
    });
    const backlogTicket = await createTicket({
      projectId: project.rows[0].id,
      ownerId: owner.id,
      runtimeId: primary.runtimes[0].id,
      title: `bt60 backlog ticket ${suffix}`,
      status: 'backlog',
    });
    const otherTicket = await createTicket({
      projectId: otherProject.rows[0].id,
      ownerId: otherOwner.id,
      runtimeId: other.runtimes[0].id,
      title: `bt60 other ticket ${suffix}`,
      status: 'in_progress',
    });
    state.ticketIds.push(ticket.id, backlogTicket.id, otherTicket.id);

    return {
      ...state,
      ownerId: owner.id,
      memberId: member.id,
      plainUserId: plainUser.id,
      superAdminId: superAdmin.id,
      outsideUserId: otherOwner.id,
      projectId: project.rows[0].id,
      otherProjectId: otherProject.rows[0].id,
      nodeId: primary.nodeId,
      nodeToken: primary.nodeToken,
      runtimeId: primary.runtimes[0].id,
      secondRuntimeId: primary.runtimes[1].id,
      ticketId: ticket.id,
      backlogTicketId: backlogTicket.id,
      otherOwnerId: otherOwner.id,
      otherNodeId: other.nodeId,
      otherNodeToken: other.nodeToken,
      otherRuntimeId: other.runtimes[0].id,
      otherTicketId: otherTicket.id,
      revokedNodeId: revoked.nodeId,
      revokedNodeToken: revoked.nodeToken,
      revokedRuntimeId: revoked.runtimes[0].id,
    };
  } catch (error) {
    // A half-built fixture must not leak rows into the disposable database.
    await cleanupHarnessFixture(state).catch(() => {});
    throw error;
  }
}

/**
 * Remove every row owned by a fixture. Idempotent: safe after a partial build
 * and safe to call twice.
 */
async function cleanupHarnessFixture(fixture) {
  if (!fixture) return;

  const userIds = fixture.userIds || [];
  const projectIds = fixture.projectIds || [];
  const nodeIds = fixture.nodeIds || [];
  const runtimeIds = fixture.runtimeIds || [];
  const ticketIds = fixture.ticketIds || [];
  const credentialIds = fixture.credentialIds || [];
  const modelIds = fixture.modelIds || [];
  const enrollmentTokenIds = fixture.enrollmentTokenIds || [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL harness.allow_event_purge = 'on'");

    const runs = ticketIds.length > 0
      ? await client.query(
        'SELECT id FROM harness_runs WHERE ticket_id = ANY($1::bigint[])',
        [ticketIds]
      )
      : { rows: [] };
    const runIds = runs.rows.map((row) => row.id);

    if (projectIds.length > 0 || ticketIds.length > 0 || runIds.length > 0) {
      await client.query(
        `DELETE FROM harness_events
         WHERE project_id = ANY($1::bigint[])
            OR ticket_id = ANY($1::bigint[])
            OR run_id = ANY($2::uuid[])`,
        [projectIds, runIds]
      );
      await client.query(
        `DELETE FROM harness_usage
         WHERE project_id = ANY($1::bigint[])
            OR ticket_id = ANY($2::bigint[])
            OR run_id = ANY($3::uuid[])`,
        [projectIds, ticketIds, runIds]
      );
      await client.query(
        `DELETE FROM usage_logs
         WHERE project_id = ANY($1::bigint[])
            OR ticket_id = ANY($2::bigint[])`,
        [projectIds, ticketIds]
      );
    }

    if (ticketIds.length > 0) {
      await client.query(
        'DELETE FROM harness_runs WHERE ticket_id = ANY($1::bigint[])',
        [ticketIds]
      );
    }

    if (nodeIds.length > 0 || projectIds.length > 0 || enrollmentTokenIds.length > 0) {
      // Enrollment-token mint audits have no node/project id, so match them by
      // the token ids created for this fixture.
      await client.query(
        `DELETE FROM agent_node_auth_events
         WHERE node_id = ANY($1::bigint[])
            OR project_id = ANY($2::bigint[])
            OR metadata->>'enrollment_token_id' = ANY($3::text[])`,
        [nodeIds, projectIds, enrollmentTokenIds.map(String)]
      );
    }

    if (nodeIds.length > 0) {
      await client.query('DELETE FROM agent_nodes WHERE id = ANY($1::bigint[])', [nodeIds]);
    }

    if (modelIds.length > 0 || credentialIds.length > 0) {
      await client.query(
        `DELETE FROM provider_models
         WHERE id = ANY($1::bigint[])
            OR credential_id = ANY($2::bigint[])`,
        [modelIds, credentialIds]
      );
      await client.query(
        'DELETE FROM provider_credentials WHERE id = ANY($1::bigint[])',
        [credentialIds]
      );
    }

    if (projectIds.length > 0 || userIds.length > 0) {
      await client.query(
        `DELETE FROM project_memberships
         WHERE project_id = ANY($1::bigint[])
            OR user_id = ANY($2::bigint[])`,
        [projectIds, userIds]
      );
    }

    if (ticketIds.length > 0) {
      await client.query('DELETE FROM tickets WHERE id = ANY($1::bigint[])', [ticketIds]);
    }

    if (projectIds.length > 0) {
      await client.query('DELETE FROM projects WHERE id = ANY($1::bigint[])', [projectIds]);
    }

    if (userIds.length > 0) {
      await client.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [userIds]);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Count any residual rows for a fixture across every table it touched. Used by
 * afterAll and by the E23 cleanup test.
 */
async function residualRows(fixture) {
  const userIds = fixture.userIds || [];
  const projectIds = fixture.projectIds || [];
  const nodeIds = fixture.nodeIds || [];
  const runtimeIds = fixture.runtimeIds || [];
  const ticketIds = fixture.ticketIds || [];
  const credentialIds = fixture.credentialIds || [];
  const modelIds = fixture.modelIds || [];
  const enrollmentTokenIds = (fixture.enrollmentTokenIds || []).map(String);

  const result = await pool.query(
    `SELECT
       (SELECT count(*) FROM users WHERE id = ANY($1::bigint[])) AS users,
       (SELECT count(*) FROM projects WHERE id = ANY($2::bigint[])) AS projects,
       (SELECT count(*) FROM agent_nodes WHERE id = ANY($3::bigint[])) AS nodes,
       (SELECT count(*) FROM agent_node_grants WHERE node_id = ANY($3::bigint[])) AS grants,
       (SELECT count(*) FROM agent_node_access_tokens
         WHERE node_id = ANY($3::bigint[])) AS access_tokens,
       (SELECT count(*) FROM agent_node_refresh_tokens
         WHERE node_id = ANY($3::bigint[])) AS refresh_tokens,
       (SELECT count(*) FROM agent_node_enrollment_tokens
         WHERE owner_id = ANY($1::bigint[])) AS enrollment_tokens,
       (SELECT count(*) FROM agent_runtimes WHERE id = ANY($4::bigint[])) AS runtimes,
       (SELECT count(*) FROM tickets WHERE id = ANY($5::bigint[])) AS tickets,
       (SELECT count(*) FROM harness_runs WHERE ticket_id = ANY($5::bigint[])) AS runs,
       (SELECT count(*) FROM harness_leases WHERE ticket_id = ANY($5::bigint[])) AS leases,
       (SELECT count(*) FROM harness_checkpoints hc
          JOIN harness_runs r ON r.id = hc.run_id
         WHERE r.ticket_id = ANY($5::bigint[])) AS checkpoints,
       (SELECT count(*) FROM harness_events WHERE project_id = ANY($2::bigint[])) AS events,
       (SELECT count(*) FROM harness_usage WHERE project_id = ANY($2::bigint[])) AS usage,
       (SELECT count(*) FROM usage_logs WHERE project_id = ANY($2::bigint[])) AS usage_logs,
       (SELECT count(*) FROM notifications WHERE ticket_id = ANY($5::bigint[])) AS notifications,
       (SELECT count(*) FROM agent_node_auth_events
         WHERE node_id = ANY($3::bigint[])
            OR project_id = ANY($2::bigint[])
            OR metadata->>'enrollment_token_id' = ANY($8::text[])) AS auth_events,
       (SELECT count(*) FROM provider_models
         WHERE id = ANY($6::bigint[]) OR credential_id = ANY($7::bigint[])) AS models,
       (SELECT count(*) FROM provider_credentials WHERE id = ANY($7::bigint[])) AS credentials,
       (SELECT count(*) FROM project_memberships
         WHERE project_id = ANY($2::bigint[]) OR user_id = ANY($1::bigint[])) AS memberships`,
    [
      userIds,
      projectIds,
      nodeIds,
      runtimeIds,
      ticketIds,
      modelIds,
      credentialIds,
      enrollmentTokenIds,
    ]
  );

  return Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])
  );
}

async function closeHarnessFixturePool() {
  await pool.end();
}

module.exports = {
  pool,
  createHarnessFixture,
  cleanupHarnessFixture,
  residualRows,
  closeHarnessFixturePool,
  uniqueSuffix,
};
