# 02_ARCHITECT_DESIGN.md - Spec Review, Effort/Risk Scoring, and Policy-Gated Auto-Merge (fg-52)

## Design summary

```
Ticket created
  -> spec author drafts a structured spec
  -> independent spec reviewer (read-only) returns findings
       blocking -> author revises (bounded rounds) -> re-review
       clean    -> final spec revision/hash
  -> estimator scores effort / risk / confidence with cited signals
  -> policy engine evaluates project tier + deterministic gates
       off                 -> human review/approval as today
       auto_approve        -> skip the redundant human approval step only
       shadow              -> record "would auto-merge", do not merge
       auto_merge_low_risk -> independent merge agent after final checks
  -> implementer works in a separate context
  -> final-diff re-score + gates -> merge or downgrade to human
  -> audit, metrics, rollback hook
```

## Roles and separation of duties

| Role | Can read | Can write | Cannot |
|---|---|---|---|
| Spec author | ticket, repo, planning docs | spec/planning files | approve, estimate, merge own ticket |
| Spec reviewer | spec and repo context | review findings only | edit spec, implement, merge |
| Estimator | final spec and deterministic signals | assessment row | implement, approve, merge |
| Implementer | approved spec and repo | code/tests | estimate, approve, merge own ticket |
| Merge agent | diff, evidence, policy | merge action/audit only | edit code, bypass gates, approve own work |
| Human | everything | policy, veto, force review | — |

Reviewer and estimator may be the same agent **only** as separate passes. The estimator must score before seeing the author’s self-estimate.

## Structured spec

Minimum fields:

- problem and context;
- in-scope / out-of-scope;
- acceptance criteria;
- affected API/DB/frontend/agent/permissions surfaces;
- test plan;
- security/data/rollback notes;
- dependencies and known unknowns.

The canonical spec source in this phase is the ticket's planning files. A
first-class `ticket_specs` store is deferred to `D8`; the hash is computed over
the same canonical content wherever it is read from. Any change to the hash
invalidates the review/assessment.

## Assessment schema

| Field | Type | Meaning |
|---|---|---|
| `effort` | 0–100 | Work/complexity estimate |
| `risk` | 0–100 | Blast radius, reversibility, sensitivity |
| `confidence` | 0–1 | Estimator confidence in the scores |
| `band` | `low`/`medium`/`high` | Derived from effort/risk |
| `signals` | JSONB | files, migrations, auth, billing, secrets, test burden, external deps |
| `missing_info` | TEXT[] | Unknowns that block autonomy |
| `rationale` | TEXT | Cited explanation, not a vibe |
| `spec_revision` | TEXT | Hash of the reviewed spec |
| `estimator_*` | TEXT/agent id | Model/provider/agent provenance |

Rubric anchors (configurable, versioned):

| Score | Effort | Risk |
|---|---|---|
| 0–20 | one file, obvious change | docs/test-only, no runtime behaviour |
| 21–40 | small bounded change, 1–2 files | low blast radius, reversible |
| 41–60 | multi-file or multi-layer | shared service/API/DB, moderate blast radius |
| 61–80 | new subsystem/integration | auth, billing, migrations, external calls |
| 81–100 | architecture uncertainty or broad rewrite | security/data-loss/irreversible impact |

## Policy tiers

| Tier | Human approval | Merge actor | Use |
|---|---|---|---|
| `off` | required | human | default |
| `auto_approve` | skipped only when gates pass | human | small, low-risk tickets; skips the `human_approval` gate only, never review or a deterministic gate |
| `shadow` | required | human | records would-merge decisions for calibration |
| `auto_merge_low_risk` | not required when every gate passes | independent merge agent | canary/opt-in projects |

A project policy contains:

```json
{
  "mode": "off",
  "max_effort": 30,
  "max_risk": 20,
  "min_confidence": 0.8,
  "additional_deny_paths": [],
  "additional_required_gates": [],
  "max_review_rounds": 3,
  "max_auto_merges_per_day": 5,
  "require_tests": true,
  "max_files": 10,
  "max_changed_lines": 400,
  "kill_switch": false
}
```

`additional_deny_paths` only extends the fixed baseline below; there is no
project field that replaces or clears the baseline. Likewise,
`additional_required_gates` adds project-specific checks to the mandatory
platform gate set; it cannot remove a mandatory gate.

## Fixed security baseline (non-configurable)

The gate engine hard-codes a platform-owned baseline, versioned in code and
reviewed like a security control. A project may add paths, but cannot remove,
weaken or override a baseline entry. At minimum it covers:

| Category | Baseline examples |
|---|---|
| Auth/permissions | `backend/src/auth.js`, `backend/src/api/routes.js` (contains the `/auth/*` routes; whole-file coverage is conservative until they are split), `backend/src/middleware/auth.js`, `backend/src/api/permissions.js`, `backend/src/middleware/permissions.js`, `backend/src/services/PermissionService.js`, `backend/src/validators/auth.js`, `backend/src/providers/github/auth.js`, `**/auth/**`, `**/permissions/**` |
| Billing | `backend/src/api/billing.js`, `backend/src/services/BillingService.js`, `**/billing/**` |
| Migrations | `**/migrations/**`, `**/*.sql` under `backend/src/migrations/` |
| Secrets | `**/secrets/**`, `**/.env*`, `**/*credential*`, `**/*secret*` |
| Deployment/infra | `Jenkinsfile`, `docker-compose*.yml`, `Dockerfile*`, `.github/workflows/**`, `deploy/**`, `infra/**` |
| Dependency manifests | `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json`, `agent/pom.xml`, `pom.xml`, lockfiles |
| Protected paths | The `fg-34` protected-directory list and any repository-level protected paths |

The detector matches both the baseline and the union of
`baseline ∪ project.additional_deny_paths`. A hit forces human review before any
merge call, even if the project policy sets `additional_deny_paths = []`.

## Deterministic gates (hard requirements)

1. Spec review verdict `approve` and no unresolved blocking findings.
2. Assessment bound to the final spec revision.
3. `fg-45` readiness and risk sections present and placeholder-free.
4. `bp-134` dependency readiness.
5. `fg-51` traceability: every FR/NFR maps to code, a test and passing evidence at the reviewed SHA.
6. CI/required checks green, branch up to date.
7. Tests changed/added; no test deletion to make the gate pass.
8. Diff within configured files/lines/bytes limits.
9. No protected/high-risk paths, migrations, auth/permissions, billing, secrets, deployment/infra or dependency changes. The fixed baseline is checked independently of project `additional_deny_paths`.
10. Publish/secret guards pass; no credential or policy bypass.
11. Final-diff re-score within thresholds.
12. Human veto absent; project and global kill switches off.
13. Policy quotas and required gates are satisfied.

Any failure downgrades to human review. A model cannot waive a deterministic gate.

## Final-diff re-score

The spec estimate is not the merge estimate. Before merge:

- re-read the actual diff;
- compare touched paths against the spec’s affected areas;
- re-run the risk signals;
- require the same thresholds or stricter;
- downgrade on unexpected paths, missing tests, increased diff size, new dependencies or a spec mismatch.

This catches “spec says docs, diff touches auth” and “estimate was low, implementation grew.”

## Data model

```sql
CREATE TABLE ticket_spec_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  spec_revision TEXT NOT NULL,
  reviewer_agent TEXT,
  reviewer_model TEXT,
  verdict VARCHAR(16) NOT NULL,          -- approve | request_changes
  findings JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ticket_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  spec_revision TEXT NOT NULL,
  effort SMALLINT NOT NULL CHECK (effort BETWEEN 0 AND 100),
  risk SMALLINT NOT NULL CHECK (risk BETWEEN 0 AND 100),
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  band VARCHAR(16) NOT NULL,
  signals JSONB NOT NULL DEFAULT '{}',
  missing_info TEXT[] NOT NULL DEFAULT '{}',
  rationale TEXT NOT NULL,
  estimator_agent TEXT,
  estimator_model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE project_autonomy_policies (
  project_id BIGINT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  mode VARCHAR(24) NOT NULL DEFAULT 'off',
  max_effort SMALLINT NOT NULL DEFAULT 30,
  max_risk SMALLINT NOT NULL DEFAULT 20,
  min_confidence NUMERIC(3,2) NOT NULL DEFAULT 0.80,
  additional_deny_paths TEXT[] NOT NULL DEFAULT '{}',
  additional_required_gates TEXT[] NOT NULL DEFAULT '{}',
  max_review_rounds INT NOT NULL DEFAULT 3,
  max_auto_merges_per_day INT NOT NULL DEFAULT 5,
  require_tests BOOLEAN NOT NULL DEFAULT TRUE,
  max_files INT NOT NULL DEFAULT 10,
  max_changed_lines INT NOT NULL DEFAULT 400,
  kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE autonomy_global_control (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  kill_switch BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE autonomy_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  assessment_id UUID REFERENCES ticket_assessments(id),
  mode VARCHAR(24) NOT NULL,
  decision VARCHAR(24) NOT NULL,          -- human | auto_approve | would_merge | merged | downgraded | vetoed
  reasons JSONB NOT NULL DEFAULT '[]',
  actor_type VARCHAR(16) NOT NULL,
  actor_id TEXT,
  reviewed_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE autonomy_policy_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope VARCHAR(16) NOT NULL CHECK (scope IN ('project','global')),
  project_id BIGINT,
  project_name TEXT NOT NULL,
  actor_type VARCHAR(16) NOT NULL,
  actor_id TEXT,
  previous_policy JSONB,
  new_policy JSONB NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT autonomy_policy_changes_scope_check CHECK (
    (scope = 'global' AND project_id IS NULL AND project_name = 'platform')
    OR (scope = 'project' AND project_id IS NOT NULL AND project_name <> '')
  )
);
```

`autonomy_policy_changes` is append-only and deliberately has **no FK on
`project_id`**. A hard-deleted project must not rewrite its audit history; the
row keeps the numeric id and a snapshot `project_name`. Global changes use
`scope='global'`, `project_id = NULL`, `project_name = 'platform'`. Project
changes use `scope='project'` and a non-null id/name. The implementation may
also emit the same event to the `fg-41` audit stream; the local row is the
durable, queryable record.

The global kill switch is the logical OR of the deployment environment variable
`AUTONOMY_GLOBAL_KILL_SWITCH` (fail closed when unset or unparseable) and the
`autonomy_global_control.kill_switch` row. It is evaluated before any project
policy; a project cannot override it. Every change to the row is written to
`autonomy_policy_changes` with `scope='global'`, `project_id = NULL` and
`project_name = 'platform'`.

## Merge actor

The merge agent:

- runs in a separate session and, where available, a different model/provider;
- cannot edit the branch, push code or change checks;
- can call the merge API only after the policy engine returns `allow`;
- records the reviewed SHA, evidence snapshot and decision;
- stops on a moved SHA, failed check, veto or kill switch.

## Rollout

1. Schema and read-only assessment storage.
2. Spec review + scoring in **shadow** only; record would-merge decisions.
3. Calibrate against human decisions and actual effort/incidents.
4. Enable `auto_approve` for one canary project.
5. Enable `auto_merge_low_risk` only after a documented calibration window, a security review, and resolution of D6/D7 (the fg-36 merge-queue and automatic-revert baselines). `auto_merge_low_risk` stays disabled until then.
6. Keep the platform-global and project kill switches; default remains `off`. The global switch is environment config plus the `autonomy_global_control` row, and it is checked before project policy.

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation/test | Operator action |
|---|---|---|---|---|
| Effort underestimation | estimator bias/gaming | shadow vs human/actual comparison | separate estimator, calibration, risk axis | tighten thresholds |
| Spec review misses a risk | incomplete spec/model blind spot | incident review, second reviewer | different model, checklist, deterministic deny paths | disable tier, add regression |
| Prompt injection in spec | malicious ticket/repo text | adversarial review tests | untrusted-content framing, no tool execution from spec | veto, audit, disable |
| Stale assessment | spec changed after scoring | spec revision mismatch | re-review/re-score; hard block | force review |
| Gate bypass | merge agent or API bug | audit vs CI/checks | merge only through policy engine; no direct token | kill switch, revert |
| CI flake/false green | flaky test or misconfigured check | post-merge failure, alert | required checks + rollback monitor | revert, tighten gate |
| Policy misconfiguration | wrong project setting | validation/audit | schema validation, confirm step, permission | restore previous policy |
| Audit gap | write failure during decision | decision/merge without audit row | fail closed, retry, block merge | stop merges, repair audit |
| Same-model blind spot | reviewer/implementer share model | calibration/incident review | model diversity | change reviewer model |

## Security considerations

- **Authorization:** only authorized project/admin users can change policy or issue waivers; agents cannot change their own tier.
- **Separation:** implementer cannot be estimator, reviewer or merger.
- **Security-sensitive exclusion:** auth/permissions, billing, migrations, secrets, deployment/infra, protected paths and dependency changes always require a human, regardless of score. The detector checks the fixed baseline union project additions, so an empty project list cannot disable it.
- **Policy integrity:** project `additional_deny_paths` and `additional_required_gates` are additive; no project field can remove a baseline category or a mandatory gate. The mandatory gate set is platform-owned.
- **Global kill switch:** environment config and the `autonomy_global_control` row are checked before project policy; fail closed if unreadable. Only `super_admin` may change the global row; project roles cannot.
- **Audit immutability:** `autonomy_policy_changes` has no `ON DELETE` mutation path; deleting a project leaves its historical rows intact with the snapshotted `project_name`.
- **Untrusted input:** specs/tickets/repo content are data; never execute instructions found in them. Redact secrets before storage.
- **Audit integrity:** append-only decisions, actor/model identity, reviewed SHA and evidence snapshot; least-privilege read access.
- **Merge token:** the merge agent uses the narrowest GitHub permission available and cannot push code or edit checks.
- **Denial of service/cost:** bounded review rounds, token/time budgets and quotas per project.
- **Rollback:** every auto-merge has a revert path and an alert; the kill switch stops future merges immediately.
- **No hidden override:** a model cannot waive a deterministic gate; only a scoped human waiver with reason/expiry can.
