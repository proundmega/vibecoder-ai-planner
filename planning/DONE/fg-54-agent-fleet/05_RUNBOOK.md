# 05 — Pilot Runbook (fg-54)

Operational procedure for the first real single-node run. Test-only: use a
disposable project, repository, PR and database. Never use production data.

This runbook replaces the pre-fg-54 `agents` flow. A node is enrolled once,
declares one or more runtimes, and the backend authorizes each runtime through
a `(node, project, role)` grant. The legacy `agents` table, static agent keys,
`AGENT_ID`/`AGENT_API_KEY` and `HARNESS_MODE` no longer exist.

## Preconditions

- Disposable GitHub repository and a GitHub App installation scoped to it.
- Dedicated, spend-capped provider key; a verified model tagged `worker`.
- Disposable database with migrations applied; confirm the host/database name
  before any cleanup SQL.
- Node host with Docker and a writable `repos` directory owned by uid 100,
  gid 101.
- Backend with `AGENT_ENROLLMENT_ENABLED=1` and the fleet routes mounted.
- The project repository configured and its installation mapped.
- `SANDBOX_MODE=docker` and `SANDBOX_REQUIRE=true` for an isolated run. Host
  mode is for a trusted repo only.

## 1. Apply the clean cut

```bash
cd backend
npm run db:migrate
psql "$DATABASE_URL" -c "SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT to_regclass('agents');"   # must be null
```

`057_agent_fleet_clean_cut.sql` drops `agents` and the fg-53 token tables and
repoints `agent_heartbeats`, `harness_runs`, `harness_leases` and
`harness_usage` to `runtime_id`.

## 2. Create the disposable fixtures

1. Create the project and attach the disposable repository.
2. Map the GitHub App installation to the project.
3. Create the ticket with a one-file, one-line change and clear acceptance
   criteria. Leave it in `backlog`.

Record `project_id`, `ticket_id` and the repository URL.

## 3. Register the model

In the provider registry:

1. Create a credential for the disposable provider key (project-scoped).
2. Add the model, verify it, and tag it `worker`.
3. Set `effort` (start with `low` or `medium` to bound cost).

The supervisor resolves `<credential-name>/<model>` inside the node owner and
project scope. It never guesses an ambiguous ref.

## 4. Enroll the node

1. Mint a one-time enrollment token (Fleet → Mint token). It is shown once and
   expires quickly.
2. Copy `agent/agent.ini.example` and declare one runtime:

```ini
[runtime "workers"]
role = worker
model = acme/claude-sonnet
count = 1
effort = low
project = <project_id>
```

3. Start the supervisor with the node settings:

```bash
BACKEND_URL='https://planner.example.com' \
ENROLLMENT_TOKEN='enr_...' \
AGENT_CREDENTIALS_FILE='/credentials/node.json' \
SUPERVISOR_CONFIG='/config/agent.ini' \
SANDBOX_MODE='docker' \
SANDBOX_REQUIRE='true' \
HARNESS_DURABILITY_REQUIRED='true' \
HARNESS_LEASE_SECONDS='60' \
HARNESS_HEARTBEAT_SECONDS='10' \
HARNESS_MAX_DURATION_MINUTES='10' \
HARNESS_VERIFY_COMMANDS='<fast, safe command for the repo>' \
java -jar agent.jar
```

`AGENT_CREDENTIALS_FILE` is required; enrollment fails without it. The
supervisor injects `AGENT_RUNTIME_ID`, `AGENT_ROLE`, `AGENT_LLM_MODEL` and
`AGENT_EFFORT` per runtime. `PROJECT_ID`/`AGENT_PROJECT_ID` remain an optional
hint; the runtime declaration is authoritative.

## 5. Confirm the runtime

```sql
SELECT r.id, r.name, r.role, r.status, r.current_project_id, n.status AS node_status
FROM agent_runtimes r JOIN agent_nodes n ON n.id = r.node_id
WHERE r.name = 'workers';
```

Expected: node `active`, runtime `running`, `current_project_id` set to the
test project. The worker grant must be active in `agent_node_grants`.

## 6. Run the ticket

The worker polls the declared project's backlog and picks up the ticket
(`POST /tickets/:id/pickup`, which sets `assigned_runtime_id`). Watch:

```sql
SELECT id, ticket_id, runtime_id, status, step, attempt, head_sha, pr_url
FROM harness_runs WHERE ticket_id = :ticket_id ORDER BY started_at DESC;

SELECT step, created_at FROM harness_checkpoints
WHERE run_id = :run_id ORDER BY created_at;

SELECT * FROM harness_leases WHERE ticket_id = :ticket_id;
```

## Pass criteria

- One run, `status=succeeded`, `step=done`, `finished_at` set, `head_sha` and
  `pr_url` populated.
- Checkpoints reach `cloned → session_ready → prompting → verifying →
  publishing → done`.
- No lease row after finish.
- Ticket is `review` with `pr_url`.
- Exactly one branch and one PR in the disposable repo.
- Budget usage is recorded in `harness_usage` and attributed to `runtime_id`.

## Failure drills

- **Budget breach**: rerun with `HARNESS_MAX_DURATION_MINUTES=2` or a very low
  cost cap. Expect `budget_exceeded`, no publish and a released ticket.
- **Lease loss**: delete the lease row while the run is active
  (`DELETE FROM harness_leases WHERE ticket_id = :ticket_id;`). Expect no
  push/PR; the ticket is left for recovery.
- **Restart**: kill the supervisor mid-run and restart it. Startup recovery
  skips a fresh run, fails/releases a stale run without publish evidence, and
  adopts a run that already published.
- **Revoked node**: revoke the node or runtime while a run is active. The
  runtime loses access, the supervisor releases the claim, and the reaper owns
  the final cleanup.

## Cleanup

Close/delete the test PR and branch first. Then, with the test IDs:

```sql
DELETE FROM harness_checkpoints WHERE run_id IN
  (SELECT id FROM harness_runs WHERE ticket_id = :ticket_id);
DELETE FROM harness_leases WHERE ticket_id = :ticket_id;
DELETE FROM harness_runs WHERE ticket_id = :ticket_id;
DELETE FROM tickets WHERE id = :ticket_id;
DELETE FROM projects WHERE id = :project_id;   -- cascades grants/credentials/tickets
DELETE FROM provider_models WHERE credential_id = :credential_id;
DELETE FROM provider_credentials WHERE id = :credential_id;
DELETE FROM agent_runtimes WHERE node_id = :node_id;
DELETE FROM agent_nodes WHERE id = :node_id;
```

Deleting the project cascades `agent_node_grants`, provider credentials and
tickets; delete models before credentials because `provider_models` is
`ON DELETE RESTRICT`. Revoke the provider key and the GitHub App installation
if they are disposable.

## Do not

- Use a product project, repository, PR or database.
- Run an untrusted repository without the Docker sandbox and the D14 gate.
- Treat the egress allowlist as a hard host boundary while D16 is open
  (`sni-only` default; `terminate` is opt-in).
- Leave a test PR, branch, node, runtime, credential or lease behind.
- Expect the agent to ask questions until `fg-55` lands; Phase 1 denies
  `question` and `doom_loop`, so the agent must decide or fail.
