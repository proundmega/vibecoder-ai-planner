# 01 — Requirement (fg-47)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

## Problem

The primary reviewer (`fg-31`) is the only review pass. It can be useful even
when it uses the same model as the author — a fresh context and a different
task catch consistency and traceability defects — but it shares the author's
model family, prompt style and blind spots. For changes where a missed defect
is expensive (auth, migrations, contracts, security, cross-ticket integration)
one pass is not enough evidence.

The fixer loop (`fg-32`) addresses findings, but it does not add an independent
opinion. We need a second pass that is actually independent: different
model/provider where possible, separate context, read-only, evidence-driven,
and triaged against the primary pass.

## Goals

1. Add an independent second reviewer pass for configured high-risk changes.
2. Use a different model family/provider where available and fall back safely.
3. Keep the second reviewer read-only and isolated from the author.
4. Merge primary and second-pass findings without duplicate noise.
5. Gate only on blocking findings; escalate real disagreement to a human.
6. Bound cost/latency and record enough evidence to tune the trigger policy.

## Non-goals

- Replacing the primary reviewer, fixer or human approval.
- Reviewing every trivial/docs-only PR by default.
- A third reviewer or a reviewer fine-tuning program.
- Letting a reviewer merge, approve or self-approve.
- Understanding design intent better than a human; the second pass is
  evidence-driven, not an oracle.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Configurable second pass: `SECOND_REVIEW_MODE=off|advisory|blocking`, model, provider and prompt version. | With `off` no second pass is created; with `advisory` findings are recorded but do not gate; with `blocking` blocking findings create or extend a fix request. |
| FR2 | Independence: the second reviewer runs as a separate session/agent, read-only, with no access to the author's chain-of-thought or the primary reviewer's scratchpad. | The second attempt records a distinct reviewer identity/pass and cannot write code, merge or approve. |
| FR3 | Model diversity: the second pass uses a different model family/provider when configured; if unavailable it falls back to a recorded advisory pass or skips with a reason. | Attempt metadata records model/provider/pass; an unavailable model produces a recorded fallback, not a silent pass. |
| FR4 | Structured findings: the second pass emits the same finding schema as `fg-31`, tagged with pass, model, provider, prompt version and evidence. | Findings persist with `review_pass=second`, a stable `finding_key`, file/line and evidence; they are queryable per attempt. |
| FR5 | Aggregation: primary and second findings are deduplicated by stable key/file/line; the highest severity wins and both evidence sets are preserved. | The aggregate contains one finding per key, max severity, and references both attempt IDs/evidence where both passes found it. |
| FR6 | Blocking policy: only blocking findings gate; advisory findings go to the deferred register/backlog; disagreement on blocking is escalated, not auto-resolved. | A blocking finding from either pass blocks the fix loop until resolved; advisory findings do not block. |
| FR7 | Re-review: after a fix, the second pass reviews the new SHA and the incremental diff plus its prior findings; the primary pass re-reviews the same SHA; rounds are bounded by `fg-32`. | A fixed SHA gets a second-pass re-review; no duplicate fix request is created; the round count stays within `FIX_MAX_ROUNDS`. |
| FR8 | Trigger and cost: `SECOND_REVIEW_TRIGGER=always|high_risk|disagreement|off`, with per-PR token/time caps and a skip reason for docs-only/trivial changes. | High-risk/disagreement triggers create a second pass; a capped PR records `cost_capped` and does not start another pass. |
| FR9 | Observability: record pass, model, provider, prompt version, tokens, duration, findings, false positives and escaped defects for tuning. | A review-pass event/row exposes the fields; `fg-41` can correlate them to the ticket/run. |
| FR10 | Human escalation: disagreement, security-sensitive findings, model unavailability and cap exhaustion escalate with both evidence sets. | The escalation payload includes both passes' findings and a reason; the ticket does not advance automatically. |

## Non-functional / safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR1 | Read-only and no self-approval: the second reviewer cannot write, push, merge or approve. | Permissions/tests prove the second pass has no write/merge capability. |
| NFR2 | No secret leakage: tokens, provider keys and credentials are absent from prompts, findings, logs and stored evidence. | Secret scans/redaction tests pass on capture and storage. |
| NFR3 | Reproducible: prompt/version, model, provider, rubric and trigger decision are recorded with the attempt. | Re-running the same input/config uses the recorded version and produces an auditable attempt. |
| NFR4 | Bounded: no unbounded retries; token/time caps and a fallback/skip path are enforced. | A cap-exceeded run terminates with a recorded reason and no extra provider call. |

## In scope

- Second-pass configuration, trigger policy and reviewer identity.
- Reuse of the `fg-31` finding/attempt schema with a pass discriminator.
- Aggregation/dedupe, blocking policy and human escalation.
- Fix-loop re-review integration.
- Observability, cost caps and tests.
- Documentation and rollout flags.

## Out of scope

Summarise only. The authoritative list is `00` → Deferred register.

- Third reviewer and cross-provider calibration — see `00` D1-D2.
- Per-project policy and overrides — see `00` D3.
- Cost dashboards and hard budgets — see `00` D4.
- Auto-tuning the trigger from escaped defects — see `00` D5.

## Dependencies

- Depends on: `fg-31` (primary reviewer + findings schema), `fg-32` (fix loop
  and bounded rounds), `fg-37` (calibration corpus), `fg-41` (observability).
- Consumes: `fg-34` (sandbox) for running the reviewer safely; `fg-38` for
  cost caps when implemented.
- Blocks: no other ticket; improves review confidence for all harness work.
