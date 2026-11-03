# 05 — Runbook ({{id}})

Optional. Operational procedures only — no requirements, design or status.

## Health signals

| Signal | Normal | Alert threshold |
|---|---|---|
| {{metric / log line}} | {{...}} | {{...}} |

## Inspect

```bash
{{command to list or inspect state}}
```

## Recover

1. {{precondition to check}}
2. {{command or action}}
3. {{expected state after recovery}}

## Dead-letter / escalate

1. {{when to stop retrying instead of recovering}}
2. {{command}}
3. {{what a human must verify before re-queueing}}

## Manual sweep

```bash
{{command}}
```

## Rollback

1. {{...}}
2. {{...}}

## Crash scenarios

| Crash point | Expected state | Recovery |
|---|---|---|
| {{...}} | {{...}} | {{...}} |

## Do not

- {{action that loses data or duplicates work}}
- {{action that bypasses the normal guard}}
