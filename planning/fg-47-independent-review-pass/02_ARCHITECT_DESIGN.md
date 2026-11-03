# 02 — Design (fg-47)

> **Owns:** current-state audit, chosen design, data model, contracts, risks,
> rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), exact file
> operations (`04`), status and deferrals (`00`).

## Current state (the only infrastructure audit)

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Primary reviewer harness | planned | `fg-31` | One review pass per SHA |
| Review attempts/findings schema | planned | `fg-31` design | One completed attempt per `(ticket, sha)` |
| Fixer loop / rounds | planned | `fg-32` design | Adds fixes, not a second opinion |
| Reviewer identity / read-only | planned | `fg-31` design | No pass/model discriminator |
| Reviewer calibration | planned | `fg-37` design | No second-pass quality data |
| Review observability | planned | `fg-41` design | No per-pass metrics/events |

**Key insight:** the second pass is mostly a schema + orchestration change on
top of `fg-31`/`fg-32`; it is not a new reviewer implementation. The hard parts
are independence, dedupe and the disagreement policy.

## Design summary

Add a **review pass discriminator** and a second reviewer runner. The primary
pass stays `fg-31`. A trigger policy decides when to run the second pass. The
second pass uses a different model family/provider where configured, a separate
workspace/context, the same finding schema, and a different review focus
(adversarial correctness/security/integration rather than a repeat of the
primary checklist). Findings are aggregated and triaged; only blocking findings
enter the `fg-32` fix loop. Disagreement escalates to a human with both evidence
sets.

### Data model

Reuse `fg-31`'s `ticket_review_attempts` / `ticket_review_findings`; do not
fork them. Add:

```sql
ALTER TABLE ticket_review_attempts
  ADD COLUMN review_pass TEXT NOT NULL DEFAULT 'primary'
    CHECK (review_pass IN ('primary', 'second')),
  ADD COLUMN parent_attempt_id UUID REFERENCES ticket_review_attempts(id)
    ON DELETE SET NULL,
  ADD COLUMN trigger_reason TEXT,
  ADD COLUMN prompt_version TEXT;

-- fg-31's unique index must include the pass, or the second pass for the same
-- reviewed SHA will collide with the primary attempt.
DROP INDEX IF EXISTS uq_review_attempt_completed;
CREATE UNIQUE INDEX uq_review_attempt_completed
  ON ticket_review_attempts (ticket_id, reviewed_sha, review_pass)
  WHERE status = 'completed';
```

`parent_attempt_id` points the second pass at the primary attempt for the same
reviewed SHA. `ticket_review_findings` already has a per-attempt unique
`finding_key`, so both passes can persist findings independently. The aggregate
view/function is derived; it is not a second findings table.

### Flow

```
primary review (fg-31) completes
        │
        ▼
trigger policy ── off/skip ──► primary result only (record reason)
        │ run
        ▼
second reviewer (different model/provider, read-only, separate context)
        │
        ▼
aggregate/dedupe findings ──► blocking? ── no ──► record advisory findings
        │ yes
        ▼
fg-32 fix request ──► fix ──► re-review new SHA (primary + second)
        │
        └── disagreement / security / cap / model unavailable ──► human
```

### Trigger policy

`SECOND_REVIEW_TRIGGER`:

- `always` — every non-trivial PR (useful for calibration; costly).
- `high_risk` — changes touching auth, permissions, migrations, providers,
  billing, harness publish/recovery, contracts or protected paths.
- `disagreement` — only when the primary pass has no blocking findings but the
  change is high-risk, or when a previous round had a disagreement.
- `off` — never.

Default: `high_risk` when the mode is enabled; `off` while the rollout flag is
off. The trigger decision and reason are recorded on the attempt.

### Aggregation and blocking

- Match findings by stable `finding_key` (fallback: file + line + normalized
  message hash).
- If both passes find the same key, keep one aggregate finding with max
  severity and both evidence sets.
- If either pass marks a finding blocking, it is blocking, unless the other pass
  supplies evidence that it is a false positive; that disagreement escalates.
- Advisory findings do not create a fix request; they go to the deferred
  register or a follow-up ticket.
- The aggregate is computed for the review UI/API; it does not rewrite the
  per-pass rows.

### Configuration

| Env | Default | Purpose |
|---|---|---|
| `SECOND_REVIEW_MODE` | `off` | `off`, `advisory`, `blocking` |
| `SECOND_REVIEW_TRIGGER` | `high_risk` | `always`, `high_risk`, `disagreement`, `off` |
| `SECOND_REVIEW_MODEL` | unset | model id; must differ from the primary where possible |
| `SECOND_REVIEW_PROVIDER` | unset | provider; fallback if unavailable |
| `SECOND_REVIEW_PROMPT_VERSION` | `v1` | rubric/prompt version |
| `SECOND_REVIEW_MAX_TOKENS` | e.g. `120000` | per-pass cap |
| `SECOND_REVIEW_MAX_DURATION_MINUTES` | e.g. `15` | per-pass cap |

Per-project overrides belong to `fg-45`; do not add a second settings table here.

### Security

- Second reviewer is read-only: no write/push/merge/approve tools.
- Run in the `fg-34` sandbox when available; otherwise use the same disposable
  workspace policy as `fg-31`.
- No author chain-of-thought, no previous reviewer scratchpad, no secrets in
  prompts/findings/logs.
- A second reviewer cannot satisfy the human approval gate.

### Risks and edge cases

| Risk / edge case | Impact | Mitigation |
|---|---|---|
| Same-model blind spots remain | false confidence | prefer a different model family; record the pair |
| Unique index collision on `(ticket, sha)` | second pass cannot persist | migrate the index to include `review_pass` |
| Duplicate findings | noise, fix-loop churn | stable key + aggregate/dedupe |
| Cost/latency | slower review | trigger policy + token/time caps |
| Model unavailable | no second pass | recorded fallback/skip; advisory only |
| Reviewers disagree on blocking | endless loop | human escalation with both evidence sets |
| Second pass sees the first pass's conclusions | anchoring | separate context; no shared scratchpad |

## Alternatives considered

| Option | Pros | Cons | Decision |
|---|---|---|---|
| A · Same-model second pass | cheap, simple | correlated blind spots | rejected as the primary design; allowed as a fallback |
| B · Different-model second pass | decorrelated, cheap enough | config/cost | chosen |
| C · Three reviewers | strongest | cost, triage noise | deferred (`00` D1) |
| D · Human-only second review | best judgment | expensive/slow | keep for escalation only |

## Rollout

1. `SECOND_REVIEW_MODE=off`: no change.
2. `advisory` + `high_risk`: run the second pass, record findings, do not gate.
3. Calibrate false positives/escaped defects with `fg-37`/`fg-41`.
4. Move to `blocking` for high-risk changes once the false-positive rate is
   acceptable.
5. Keep human escalation for disagreement, security and cap exhaustion.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register.
