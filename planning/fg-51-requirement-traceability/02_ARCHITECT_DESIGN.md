# 02 — Design (fg-51)

> **Owns:** current-state audit, chosen design, data model, contracts, risks,
> rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), exact file
> operations (`04`), status (`00`).

## Current state audit

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Requirement IDs | yes | `planning/*/01_ARCHITECT_REQUIREMENT.md` | No runtime registry or stable export |
| Planned test matrix | yes | `planning/*/03_ARCHITECT_IMPLEMENTATION.md` | Declared only; not linked to executed tests |
| Planning claim checker | yes | `planning/check-planning.js`, `fg-48` (planned) | Checks documents, not code/test evidence |
| Review harness | planned | `fg-31` | Runs verification, but does not map results to requirements |
| Fixer loop | planned | `fg-32` | Fixes findings; no requirement-level gap list |
| Merge lifecycle | planned | `fg-36` | CI/merge gate; no traceability snapshot |
| Test reports | partial | backend/frontend/agent suites | Formats vary; no requirement tags |

**Key insight:** the missing link is not another detector. It is a small,
deterministic join between three things that already exist: requirement IDs,
test/verification results, and the reviewed SHA.

## Design summary

```text
01 FR/NFR IDs + acceptance
        |
        v
requirement registry ──> mapping sources ──> trace service ──> gap report
                              |                    |                |
                    traceability.json        test reports      fg-31 review
                    @req annotations         verification      fg-32 fixer
                    test names [FR1]         CI results        fg-36 merge gate
                                                                    |
                                                              human approval
```

No new phase. The trace service computes a snapshot at these points:

1. **Review completion** — after `fg-31` runs verification and before
   `review -> human_approval`.
2. **Fix push** — after `fg-32` pushes a new SHA and re-review starts.
3. **On demand** — `GET /tickets/:id/traceability` for the UI and humans.
4. **Merge check** — `fg-36` reads the latest snapshot and rejects a stale SHA.

The service is deterministic and read-only with respect to the repository and
approval state. It never runs tests itself; it consumes results produced by the
supervisor/CI. It writes only its own trace snapshot and event rows.

## Requirement registry

- Source of truth: `01_ARCHITECT_REQUIREMENT.md` at the reviewed SHA.
- Parse `FR*`/`NFR*` IDs from the tables and acceptance statements. Reject
  duplicates and rows with no acceptance.
- `fg-45` owns validation and export of the same IDs. `fg-51` consumes that
  read-only export when available and falls back to parsing the file.
- IDs are immutable after plan approval; a rename/removal requires `replan`
  (`fg-45` FR16/FR21).

## Mapping format

Prefer explicit annotations; allow a manifest for generated/legacy code.

### Annotations

```java
// @req FR1
public void resetPassword() { ... }
```

```ts
// @req FR1, NFR2
it('FR1 resets the password and invalidates old tokens', async () => { ... });
```

- A code annotation attaches the enclosing symbol/file to the requirement.
- A test-name/annotation attaches the test case to the requirement.
- Supported comment syntaxes: `//`, `#`, `/* ... */`, and test-framework tags
  (`@Tag("FR1")` for JUnit, `[FR1]` in the test name elsewhere).

### Manifest

`planning/<ticket>/traceability.json` (or a repo-root equivalent for generated
code):

```json
{
  "requirements": {
    "FR1": {
      "code": ["backend/src/services/PasswordService.js"],
      "tests": ["backend/src/__tests__/password.test.js::resets the password"]
    },
    "NFR2": {
      "code": ["agent/src/main/java/com/vibecode/agent/harness/SecretRedactor.java"],
      "tests": ["agent/src/test/java/com/vibecode/agent/harness/SecretRedactorTest.java"]
    }
  }
}
```

Rules:

- Manifest entries are declarations, not proof; the test must still run and
  pass.
- Unknown IDs in the manifest are a failure (`UNKNOWN_REQUIREMENT_ID`), so a
  typo cannot silently attach evidence.
- An annotation and a manifest entry for the same ID are merged; duplicates are
  deduped by file/symbol/test name.

## Test and verification evidence

| Source | Format | Use |
|---|---|---|
| JUnit | XML (`TEST-*.xml`) | Java/agent tests; match class/method name |
| Jest | JSON (`--json --outputFile`) | backend tests; match full test name |
| Vitest | JSON | frontend tests; match full test name |
| pytest | JSON (`--json-report`) | any Python suites; match node id |
| CI | job/step result + artifact URL | fallback when a framework report is unavailable |
| Supervisor | `fg-31` `VerificationRunner` result | authoritative for the reviewed SHA |

Evidence is accepted only for the reviewed SHA. A report from a different
commit is stale and cannot mark a requirement `verified`.

## Status rules

| Status | Meaning |
|---|---|
| `verified` | Code ref + test ref + passing test or verification evidence at the reviewed SHA |
| `partial` | Some evidence exists (code or test or suite-level verification) but not the full chain |
| `missing` | No code ref or no test ref |
| `waived` | Non-expired scoped waiver with reason and audit |

A requirement with a passing suite-level verification but no mapped test is
`partial`, not `verified`. Code coverage alone never changes the status.

## Data model

```sql
CREATE TABLE ticket_requirement_trace (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified','partial','missing','waived')),
  code_refs JSONB NOT NULL DEFAULT '[]',
  test_refs JSONB NOT NULL DEFAULT '[]',
  verification_refs JSONB NOT NULL DEFAULT '[]',
  evidence_sha TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  waiver_reason TEXT,
  waiver_expires_at TIMESTAMPTZ,
  waiver_by BIGINT REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_requirement_trace_head
  ON ticket_requirement_trace(ticket_id, requirement_id, evidence_sha);
CREATE INDEX idx_requirement_trace_ticket
  ON ticket_requirement_trace(ticket_id, computed_at DESC);

CREATE TABLE ticket_requirement_trace_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,          -- computed|waived|waiver_revoked|gate_blocked|report_capped
  run_id TEXT,                          -- supervisor/CI run correlation
  evidence_sha TEXT,
  actor_type VARCHAR(16) NOT NULL CHECK (actor_type IN ('user','agent','system')),
  actor_user_id BIGINT REFERENCES users(id),
  actor_agent_id BIGINT REFERENCES agents(id),
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_requirement_trace_events_ticket
  ON ticket_requirement_trace_events(ticket_id, created_at DESC);
CREATE INDEX idx_requirement_trace_events_run
  ON ticket_requirement_trace_events(run_id);
```

Why a separate table from `fg-45` readiness: readiness is about the plan before
work starts; traceability is about evidence after work is built. They have
different lifecycles, waiver scopes and permissions.

## API

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/tickets/:id/traceability` | Latest snapshot + gap report | `TICKET_READ` |
| GET | `/tickets/:id/traceability/events?runId=` | Event rows for the ticket, filterable by `run_id` | `TICKET_READ` |
| POST | `/tickets/:id/traceability/recompute` | Recompute for the current PR head | `TICKET_UPDATE` (agent or human) |
| POST | `/tickets/:id/traceability/waive` | Waive named requirement IDs with reason/expiry | `TICKET_TRACEABILITY_WAIVE` + project membership |
| DELETE | `/tickets/:id/traceability/waive/:requirementId` | Revoke a waiver | `TICKET_TRACEABILITY_WAIVE` |

Report shape:

```json
{
  "success": true,
  "data": {
    "ticketId": 42,
    "evidenceSha": "abc123",
    "computedAt": "2026-11-08T10:00:00Z",
    "counts": { "verified": 9, "partial": 2, "missing": 1, "waived": 0 },
    "requirements": [
      {
        "id": "FR1",
        "status": "verified",
        "codeRefs": ["backend/src/services/PasswordService.js"],
        "testRefs": ["backend/src/__tests__/password.test.js::resets the password"],
        "verificationRefs": ["npm test -- password (exit 0)"]
      }
    ]
  }
}
```

No `readiness: 87%` field. Counts and rows only.

## Gate integration

| Point | Behaviour |
|---|---|
| `fg-31` review | Include the gap report in the review context; post the counts in the PR summary. |
| `fg-32` fixer | Fix request lists missing/partial requirement IDs; after the push, recompute. |
| `review -> human_approval` | In `enforce`, block when non-waived `missing`/`partial` > 0; in `warn`, record and allow. |
| `fg-36` merge | Read the latest snapshot; reject a snapshot whose SHA is not the current head. |
| `fg-47` second reviewer | Receives the gap report as evidence; can challenge a `verified` status. |
| `fg-41` | Emits `computed`/`gate_blocked`/`waived` events with ticket/`run_id`. |
| `fg-37` | Uses escaped defects and waiver frequency to calibrate the gate. |

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation / test | Operator action |
|---|---|---|---|---|
| Missing/stale PR head | Head moves during review | SHA mismatch | Recompute; merge gate rejects stale snapshot | Re-run review |
| Test report absent | Framework not configured | No report artifact | Mark `partial`; `enforce` blocks until a report exists | Add report output or waive |
| Malformed report | Parser error | `report_parse_failed` | Record event; do not mark verified | Fix report/CI |
| Report too large | Huge test suite | Size/time cap | `report_capped`; partial evidence | Narrow report scope |
| Annotation typo | `@req FR99` | Unknown ID | `UNKNOWN_REQUIREMENT_ID` failure | Fix annotation |
| Waiver expires | Time passes | Expiry check | Recompute; gap returns | Renew or fix |
| Secret in report | Log/test output leaks | Redaction scan | Reject evidence; redact event | Rotate/fix source |

## Security considerations

- Authentication: user JWT or agent `X-API-Key` for recompute; read uses
  `TICKET_READ`.
- Authorization: waivers require `TICKET_TRACEABILITY_WAIVE` and project
  membership; agents cannot waive their own gaps.
- Input validation: JSON schema for manifest/report input; cap file size and
  parse depth.
- Secrets: reports and prompts are redacted; the trace row stores file/test
  names, not command output bodies. Never store tokens or env values.
- Audit: every waiver/revocation/gate block writes an event with actor identity.
- Data exposure: the gap report is ticket-visible to project members; it must
  not include full test output or PII.
- Rate limiting: recompute is idempotent per SHA and should be debounced per
  ticket.

## Risks and edge cases

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| Annotations drift from code | False confidence | Prefer test mapping; reviewer spot-checks; manifest for generated code |
| Test exists but asserts nothing | False `verified` | Reviewer checks the test; `fg-37` tracks escaped defects |
| Multi-PR requirements | Partial evidence | Phase 1 scopes to the ticket/PR head; cross-PR deferred |
| Monorepo report collisions | Wrong mapping | Package-scoped report paths; deferred D6 |
| Gate too strict on legacy tickets | Freeze | `warn` default; grandfather existing tickets |
| Duplicate IDs across suites | Ambiguous mapping | Registry is per ticket; duplicates fail |

## Rollout

1. Migration + service + read endpoint behind `TRACEABILITY_GATE_MODE=off`.
2. Pilot one migrated suite: add annotations/manifest, run in `warn`, compare
   the report with the reviewer’s findings.
3. Enable `warn` for new tickets; keep `off` for grandfathered work.
4. After `fg-37` shows the report is accurate and the false-gap rate is low,
   switch new projects to `enforce`.
5. `fg-36` reads the snapshot only after the pilot; rollback is the flag plus
   the migration rollback (the table can remain unused).

## Open questions

| # | Question | Resolution |
|---|---|---|
| 1 | Annotation syntax per language | Start with `@req` comments and test-name `[FR1]`; extend adapters later |
| 2 | Where the manifest lives | `planning/<ticket>/traceability.json` first; repo-root for generated code |
| 3 | Whether suite-level verification can mark `verified` | No; it is `partial` until a test is mapped |
| 4 | Who can waive | `project_admin`/`super_admin` plus project membership; agents cannot |
