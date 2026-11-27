# 02_ARCHITECT_DESIGN.md - Repository Onboarding and Environment Profiles (fg-39)

## Design summary

A repo profile is a versioned, admin-approved description of how to prepare and verify a repository. The supervisor loads it before cloning/sandboxing and uses it to build the sandbox and run commands.

```
Project -> RepoProfile (versioned)
  -> SandboxImage + toolchains
  -> setup commands + caches
  -> services (postgres/redis)
  -> verify commands + timeouts
  -> flaky tests
```

## Profile schema

```json
{
  "version": 1,
  "repo_url": "https://github.com/org/repo",
  "base_branch": "master",
  "languages": ["node", "java"],
  "image": "vibecode/node24-java17:1",
  "setup": [
    "npm ci",
    "cd backend && npm ci",
    "cd frontend && npm ci"
  ],
  "verify": [
    "cd backend && npm test",
    "cd frontend && npm test -- --run",
    "cd agent && mvn test -q"
  ],
  "services": [
    { "name": "postgres", "image": "postgres:16-alpine", "env": "DATABASE_URL" }
  ],
  "env": { "NODE_ENV": "test", "INTEGRATION_TESTS": "1" },
  "caches": ["~/.npm", "~/.m2", "frontend/node_modules"],
  "timeouts": { "setup_minutes": 15, "verify_minutes": 20 },
  "flaky_tests": ["test/known-flake.test.js"],
  "max_round_minutes": 45
}
```

Profiles are validated against a JSON schema; unknown fields are rejected or warned.

## Onboarding flow

1. Admin adds a repo URL.
2. Detector reads manifests (`package.json`, `pom.xml`, `pyproject.toml`, `go.mod`, `docker-compose.yml`) and proposes a profile.
3. Admin edits/approves; a dry run clones the repo and runs setup/verify in the sandbox.
4. Profile is versioned; every harness run records the profile version used.

## Images and caches

- Ship one pinned stage per stack in `agent/sandbox-stacks.Dockerfile`: Node 24,
  Python 3.12, Java 21 + Maven 3.9.11, Go 1.23 and a monorepo image assembled
  from those same pinned stages. `agent/scripts/build-sandbox-images.sh` builds
  every target and `agent/scripts/smoke-sandbox-stacks.sh` checks the default
  commands under the supervisor's sanitized PATH.
- Pin base images by digest; rebuild on a schedule (fg-34 supply chain). The
  pin check covers the stack Dockerfile.
- The supervisor replaces PATH with `/usr/local/sbin:/usr/local/bin:...`, so
  every stack tool that lives elsewhere is exposed through `/usr/local/bin`.
  Python stages use a uid-1000-owned `/opt/venv` with `pip` and `pytest`
  symlinked into `/usr/local/bin`; this also avoids Debian's PEP 668
  `externally-managed-environment` failure.
- The Java image carries Maven, not Gradle. A Gradle project without `./gradlew`
  gets a detection warning; use the wrapper or a custom pinned image with
  Gradle. `agent/scripts/smoke-sandbox-caches.sh` covers real npm/Maven/Go
  cache reuse; the full profile dry-run e2e remains D11.
- Detection maps one detected language to its stack and multiple languages to
  the monorepo image. It proposes only digest-pinned references configured in
  `REPO_PROFILE_STACK_IMAGES`; it never guesses a tag. Without a configured
  image it warns and leaves the field for an admin-supplied pinned image.
- Registry publishing, signing and the rebuild cadence remain part of the
  fg-34 supply chain (D1).
- Cache directories live under the runtime cache root, scoped by a hash of the
  project id and a generation key (normalized repo + profile version + lockfile
  hash). Each supported kind mounts at `/cache/<kind>` with the matching tool
  environment (`NPM_CONFIG_CACHE`, `PIP_CACHE_DIR`, `MAVEN_OPTS`,
  `GRADLE_USER_HOME`, `GOMODCACHE`/`GOCACHE`, `CARGO_HOME`).
- Caches are writable during a run because package managers must populate
  them. Before reuse, `CachePlan` removes symlinks, non-regular files and
  credential-shaped artifacts (including Gradle `gradle.properties`/`init.d`/
  `init.gradle`, Cargo `config.toml`/`credentials.toml`, `.env.*`, `.yarnrc*`,
  `.pypirc`, `.git-credentials`, `.docker/` and the common cloud/SSH/GPG config
  directories); it never follows links. `.config/` is removed wholesale because
  a dependency cache is disposable and may hold tool config. Only
  Gradle `caches`/`wrapper` and Cargo `registry`/`git` subdirectories are
  mounted, so their home config/init files stay ephemeral. Writes are never
  shared across projects.
- `SANDBOX_CACHE_MAX_MB` bounds the project cache; `SANDBOX_CACHE_RETENTION_DAYS`
  expires old generations (0 is treated as 1 day, not disabled). Eviction is
  LRU/age based and skips the cache mount (rather than failing the run) if the
  current generation is over quota. The fg-44 storage watchdog continues to
  cover total disk pressure. The cache root is the runtime cache directory, so
  caches survive tickets but are removed when the runtime is recycled; the age
  retention applies within a runtime. Cross-runtime host-level persistence is
  not part of this slice.
- The cache directories are created by the supervisor. `SANDBOX_USER` defaults
  to the supervisor uid; if it is set to a different uid, the operator must
  make the runtime cache root writable by that uid (the workspace mount has the
  same constraint).
- Real package-manager command coverage (npm/mvn/go) is covered by
  `smoke-sandbox-caches.sh`; the profile dry-run e2e remains D11.

## Services

- Start service containers on an isolated network attached only to the sandbox.
- Health-check before running tests.
- Ephemeral data volumes; destroy after the run.
- Inject connection strings into the sandbox env (non-secret defaults or per-run generated credentials).
- If a service cannot start, fail fast with a clear profile error.

## Flaky tests

- Profile lists known-flaky tests.
- Verification retries only those tests (max 2) and records the flake.
- A consistent failure fails the run; flakes never hide a real regression.
- Emit a metric so the profile owner can fix or remove the test.

## Validation and dry run

`POST /projects/:id/repo-profile/validate` runs:
1. clone at base SHA;
2. create sandbox with the profile image;
3. run setup;
4. run verify;
5. return pass/fail, timings and logs.

This is an admin operation, not model-driven.

## Slice 1 schema (v1)

```json
{
  "schema_version": 1,
  "repo_url": "https://github.com/org/repo",
  "base_branch": "main",
  "languages": ["node", "java"],
  "image": "registry.example.com/node24-java17@sha256:...",
  "setup": ["npm ci", "cd backend && npm ci"],
  "verify": ["cd backend && npm test"],
  "caches": [],
  "env": { "NODE_ENV": "test" },
  "timeouts": { "setup_minutes": 15, "verify_minutes": 20 },
  "max_round_minutes": 45,
  "services": [],
  "flaky_tests": [],
  "egress": {
    "tls_mode": "terminate",
    "origin_ca_hosts": ["registry.example.com"],
    "origin_ca_b64": "<base64 PEM CA bundle>",
    "mtls": {
      "credential_id": 12,
      "hosts": ["registry.example.com"]
    }
  }
}
```

- `schema_version` must be `1`; unknown fields are rejected.
- `image` is optional; when present it must be digest-pinned (`@sha256:`) and
  match the strict stack-image shape: no userinfo and exactly one digest
  separator (registry ports and tags are allowed).
- `setup` and `verify` are bounded shell command lists. `verify` must contain
  at least one command.
- `env` keys must look like environment names and may not be secret-like
  (`*_TOKEN`, `*_KEY`, `PASSWORD`, `SECRET`, private-key material). Secret
  values are rejected by the same high-confidence checks as `SANDBOX_ENV`.
- `caches` must be empty in slice 1. Persistent cache volumes need a quota,
  watchdog and GC (D9/fg-44); accepting the field without those would let a
  repo fill the host disk across runs.
- `services` and `flaky_tests` must be empty in slice 1; non-empty values fail
  validation with an explicit "not implemented yet" error.
- `egress` is optional and only valid with `tls_mode: "terminate"`. Its exact
  hosts must already be covered by the agent's `SANDBOX_ALLOWED_HOSTS`; the
  backend validates the PEM bundle shape and CA constraints, and the agent
  re-validates before sandbox creation. `egress.mtls` references an active
  project mTLS credential (the certificate is public metadata; the key is
  encrypted) and lists the same exact host scope. The agent fetches the key
  material only through the owner-scoped agent endpoint and never puts it in
  profile JSON, ordinary profile responses or the sandbox.

## Profile API (slice 1)

| Method / path | Auth | Purpose |
|---|---|---|
| `GET /projects/:id/repo-profile` | project member | Active profile plus latest draft |
| `GET /projects/:id/repo-profile/versions` | project member | Version history |
| `POST /projects/:id/repo-profile` | owner/super admin | Create a draft version (retires the previous draft) |
| `PUT /projects/:id/repo-profile/:profileId` | owner/super admin | Edit a draft |
| `POST /projects/:id/repo-profile/:profileId/activate` | owner/super admin | Activate a draft or a previously active version (rollback) after a successful dry run of the exact `profile_hash` |
| `POST /projects/:id/repo-profile/detect` | owner/super admin | Propose a profile from GitHub manifests |
| `POST /projects/:id/repo-profile/:profileId/validate` | owner/super admin | Queue a dry run |
| `GET /projects/:id/repo-profile/validations` | project member | Dry-run history (`limit` 1-200, `offset`) |
| `GET /projects/:id/repo-profile/validations/:validationId` | project member | Dry-run status/result |
| `POST /projects/:id/repo-profile/credentials/mtls` | owner/super admin | Store a scoped mTLS client certificate/key |
| `GET /projects/:id/repo-profile/credentials/mtls` | project member | List mTLS credential metadata (no keys) |
| `DELETE /projects/:id/repo-profile/credentials/mtls/:credentialId` | owner/super admin | Deactivate a credential |
| `GET /projects/:id/repo-profile/agent` | agent API key | Active profile for the agent |
| `GET /projects/:id/repo-profile/agent/mtls` | agent API key | Scoped client certificate/key for the active profile |
| `POST /projects/:id/repo-profile/validations/claim` | agent API key | Claim the next queued dry run |
| `POST /projects/:id/repo-profile/validations/:validationId/finish` | agent API key | Report the dry-run result |

The project owner (or super admin) is the write boundary, matching project
update. The agent routes also require the owner relationship used by the
existing GitHub agent config route.

## Dry-run worker (slice 1)

1. An admin queues a validation; the backend snapshots the profile JSON and
   version so later edits cannot change a running validation.
2. Any agent serving the project claims it with `FOR UPDATE SKIP LOCKED`.
3. The agent clones `repo_url` at `base_branch` with an explicit clone timeout,
   creates the same sandbox the ticket path would use (image, env, egress CA),
   runs `setup` and then `verify`, and reports per-command exit code, duration
   and redacted output. Clone, sandbox setup and both phases share one overall
   deadline.
4. The agent applies an overall deadline of `profile.max_round_minutes` (the
   setup and verify caps are taken within that deadline, not added on top).
   A ticket run also passes `min(HARNESS_MAX_DURATION_MINUTES,
   profile.max_round_minutes)` to the OpenCode client, so the model session is
   bounded too, not only post-model verification.
5. The backend stores the result; a `running` validation is stale after
   `max(60, profile.max_round_minutes) + 5` minutes, so a valid long dry run is
   not reaped while it is still within its accepted budget.
6. The worker runs after the ticket loop, so a long dry run cannot starve the
   build queue in the same poll cycle.
7. The worker does not start a model session and does not publish anything.


## Slice 2 service schema (v1)

```json
{
  "services": [
    {
      "name": "postgres",
      "image": "postgres:16-alpine@sha256:...",
      "env": { "POSTGRES_USER": "vibecode", "POSTGRES_DB": "vibecode_test" },
      "password_env": "POSTGRES_PASSWORD",
      "connection_env": "DATABASE_URL",
      "connection_url": "postgresql://vibecode:${password}@${host}:5432/vibecode_test",
      "healthcheck": {
        "command": "pg_isready -U vibecode -d vibecode_test",
        "interval_seconds": 2,
        "timeout_seconds": 5,
        "retries": 30,
        "start_period_seconds": 0
      }
    }
  ]
}
```

- Maximum five services, unique DNS-safe names and digest-pinned images.
- `env` is non-secret service configuration. `password_env` is optional; when
  set, the agent generates a per-run password and puts it only in that service
  environment.
- `connection_url` must contain `${host}` and, when `password_env` is set,
  `${password}`. No other placeholders or literal credentials are accepted.
- `connection_env` is injected into the sandbox; it must not collide with the
  profile env or another service.
- `healthcheck` is required and bounded (1–60s interval/timeout, 1–120 retries,
  0–120s start period).
- Services require `SANDBOX_MODE=docker`; host mode fails closed.

### Service lifecycle

1. Create a per-run internal bridge network (`vibecode-services-<suffix>`).
2. Start each service container with its env file, healthcheck flags, bounded
   memory/PIDs/CPU, `no-new-privileges`, `NET_RAW` dropped, 1 MiB/1-file log
   rotation and an owner label.
3. Wait for Docker health `healthy`; fail fast on `unhealthy`, `exited`, `dead`
   or timeout.
4. Read each service IP and add an `/etc/hosts` entry to the sandbox. The
   sandbox uses the service network as its primary network; external DNS stays
   disabled and the egress network is attached afterwards when allowlist mode
   is enabled.
5. Generate connection URLs, pass them to the sandbox through a 0600 env-file
   (never argv or profile JSON), and remove the file after `docker run`.
6. Track each service container name before `docker run`; a failed or timed
   out start removes every tracked container and the network.
7. Destroy service containers with `-v` and the network after the sandbox. If
   removal fails, keep the runtime tracked and fail the destroy so a leak is
   visible instead of reporting a clean sandbox; the startup reaper is the last
   resort.
8. Cap the health wait at 180 seconds so a slow service cannot consume the
   profile's whole setup/round budget.

### Service trust decisions

- Service images are admin-approved, digest-pinned dependencies. They are not
  the sandbox boundary: they run as the image's user (often root) inside their
  own container with no host mounts, bounded resources, an internal-only
  network and no inbound sandbox access.
- Service disk quota is not implemented (D12). Logs are bounded, `NET_RAW` is
  dropped, and a noisy service can still write to its ephemeral container
  layer.
- Image pulls use the Docker daemon directly and are not governed by the
  sandbox egress allowlist (D12). Operator-approved digests are the trust
  decision.

## Slice 5 profile editor

- New `Repository Profile` tab in `ProjectDetail.vue` backed by
  `RepoProfileEditor.vue`.
- Shows the active/latest version, status, exact-content validation requirement
  and read-only state for non-owners.
- Supports detect, draft create/save, command/env/timeout/service/egress fields,
  dry-run polling, activation, paginated validation history and version history.
- Only the current draft is editable. Viewing any other version, including an
  older draft, is read-only, and Save/Validate/Activate always target the
  current draft. A partial unique index enforces one draft per project; creating
  a new draft retires the previous one as inactive, and retired drafts cannot
  queue new validation or be activated. A dry run already queued before
  retirement may finish but remains inert. Version-history rollback activation
  is D17. Detection asks before replacing unsaved form content.
- Does not expose deferred fields (`caches`, `flaky_tests`).

## Persistent caches (deferred)

Persistent cache mounts are **not** part of slice 1. A writable Docker volume
without a quota/GC lets a hostile repo fill the host disk across runs and
bypasses the workspace disk watchdog. The profile schema keeps the `caches`
field reserved but rejects non-empty values until D9/fg-44 adds a size limit,
watchdog, volume GC, lockfile-keyed generations and sanitized writes.
Verification still uses the existing ephemeral `/tmp` cache defaults.

## fg-34/D27 profile handoff (slice 1)

- Profile `egress.origin_ca_*` is applied only when the operator already chose
  `terminate` mode and every named host is in `SANDBOX_ALLOWED_HOSTS`.
- The effective `SandboxSpec` carries the profile's CA pair. The supervisor
  creation log and proxy `configured`/`used` audit lines remain unchanged.
- `sni-only` remains the default; a profile that requests `terminate` while the
  operator left the default fails closed with a clear error.

## Failure modes

| Failure | Behavior |
|---|---|
| No active profile | Warning; existing autodetection and verification path. |
| Profile fetch fails/transient backend error | Warning; existing path. Admin config errors are not hidden. |
| Invalid profile JSON | Run fails before clone with the validation message. |
| No active project repo, or profile `repo_url` differs from it | Create/update/activate/validate fail; the agent also rejects a profile that differs from `REPO_OWNER/REPO_NAME`. |
| Activation without a successful exact-content dry run | Activation fails; editing a draft changes `profile_hash` and invalidates older successes. |
| Profile verify list empty | Validation rejects the profile; no profile falls back to autodetection. |
| Profile image lacks a digest | Validation rejects the profile. |
| Origin CA host not allowlisted, or mode mismatch | Sandbox creation fails before the container starts. |
| Dry-run clone/setup/verify fails | Validation is `failed` with per-command output; no ticket/run is created. |
| Agent dies during a dry run | Validation remains `running` until the profile-budget stale reap. |
| Service start fails after `docker run` created the container | The tracked name is removed with `-v`; the network is removed. |
| Service container or network removal fails | `destroy()` fails closed and the runtime stays tracked for a retry; the startup reaper is the last resort. |
| Dry-run output contains a generated password or credential | The password is registered in `RedactionRegistry`; the agent and backend redact before storage. |
| Sandbox destroy fails after a dry run | The validation is reported `failed` with a cleanup error; it cannot be activated. |
| A project member reads a validation | Status/error are visible; command output is hidden unless the reader is the project owner or a super admin. |

## Security considerations

- Profiles are admin configuration, but their commands still run as untrusted
  repo code in the sandbox; host mode remains explicitly not a boundary.
- Profile env is validated against secret-like keys/values on both the backend
  and the agent, so a profile cannot smuggle credentials into the sandbox.
- A profile cannot widen `SANDBOX_ALLOWED_HOSTS`, change `sni-only` to
  `terminate`, bypass `Host == SNI`, or supply a private key instead of a CA.
- Persistent caches are deferred; slice 1 does not expose a writable host
  cache volume (D9/fg-44).
- The backend and agent share the same secret-key rules (including `PASS`,
  `PWD`, `PASSPHRASE` and embedded forms such as `PGPASS`/`DBPASS`). Service
  `connection_url` userinfo must be exactly the literal `${password}`; literal
  userinfo/query/path credentials, generated-password-shaped 32+ hex values in
  query/path/fragment positions, credential-shaped healthcheck/commands
  (including the lowercase `mysql/mariadb/mysqladmin/mysqldump -p` password
  flag, `redis-cli -a` and `REDISCLI_AUTH`; client names are matched
  case-insensitively while the flag stays case-sensitive, so uppercase `-P` is
  a port and `-p -h host` is a prompt),
  percent-encoded placeholders, newlines/NUL and reserved env names
  (`PATH`, `HOME`, `LD_PRELOAD`, `HTTP_PROXY`, ...) are rejected in profile and
  service env.
- The read-time scrub is owner-aware: the project owner/super admin receives the
  raw profile for the editable current draft and write responses, so a scrub
  can never be saved back over a real value; members and other read-only views
  receive the scrubbed profile. Legacy validation results are scrubbed for
  readers; a one-time storage scrub remains D15.
- The scrub uses the same `isSecretKey` rule as the validators (so
  `DB_PASS`, `PGPASS`, `DBPASS`, `PASS`, exact `AUTH`/`AUTHORIZATION`/
  `BASIC_AUTH`, `REDISCLI_AUTH`, ... are covered), preserves quoted or
  unquoted `$ENV` references and `${password}` placeholders, does not redact
  `AUTH_MODE`/`AUTH_TYPE`-style configuration keys, and does not redact
  `sha256:` image digests.
- Service `env`, `password_env` and `connection_env` are validated again in the
  agent, and the env-file writer rejects newline/NUL injection.
- Each generated service password is registered in `RedactionRegistry` before
  any setup/verify command runs. The agent redacts each command/output, and the
  backend re-redacts the result and error at ingest.
- Dry-run results include bounded, redacted output only; command output is
  restricted to the project owner or a super admin, and the profile snapshot is
  stored with the validation for audit.

## Data model

```sql
CREATE TABLE repo_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INT NOT NULL,
  profile JSONB NOT NULL,
  profile_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'inactive')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  UNIQUE (project_id, version)
);

CREATE UNIQUE INDEX uq_repo_profiles_active
  ON repo_profiles(project_id) WHERE status = 'active';

CREATE UNIQUE INDEX uq_repo_profiles_draft
  ON repo_profiles(project_id) WHERE status = 'draft';

CREATE TABLE repo_profile_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES repo_profiles(id) ON DELETE CASCADE,
  profile_version INT NOT NULL,
  profile JSONB NOT NULL,
  profile_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  agent_id BIGINT REFERENCES agents(id) ON DELETE SET NULL,
  result JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
```

`harness_runs` gains nullable `repo_profile_id UUID REFERENCES
repo_profiles(id) ON DELETE SET NULL` and `repo_profile_version INT` so each
run records the profile it used. `HarnessRunService.startRun` joins the profile
to the ticket's project and checks the revision, so an agent cannot record a
false profile revision. `profile_hash` is the SHA-256 of a canonicalized
profile JSON; activation requires a successful validation row with the same
hash. A legacy row with a null hash gets one persisted when validation is
requested (and again on activation), so existing profiles can be revalidated
without a manual re-save. The validation-request update is conditional on
`profile_hash IS NULL`; if a concurrent edit wins, the request fails with a
conflict instead of overwriting the newer hash or queuing a stale snapshot. `profile.base_branch` is the first source in
fg-36's shared resolver; slice 1 uses it directly for checkout and the PR base.

`profile.base_branch` is the most specific source. fg-36's `BaseBranchResolver` uses: active profile > project setting > GitHub repo default > `main`, then `master`. Do not duplicate this order elsewhere.

## Tests

- detect Node/Python/Java/Go/monorepo profiles;
- setup/verify success and failure;
- service startup/health/cleanup;
- flaky retry behavior;
- invalid profile validation;
- missing profile fallback warning.

## Rollout

1. Add the schema and a static profile for the planner repo.
2. Dry-run validation.
3. Use profiles for new tickets; fall back to autodetection for others.
4. Add cached dependencies and services after their quota/GC slices.
5. Onboard real projects one by one.

## Open questions

1. Do we use devcontainers or custom images?
2. How do we sanitize cache writes from untrusted scripts?
3. Who owns profile updates: project admin or platform?
4. How do we handle repos with multiple languages/services?
5. What is the fallback when a service image is unavailable?

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
