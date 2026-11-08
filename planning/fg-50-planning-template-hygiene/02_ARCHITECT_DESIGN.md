# 02 — Design (fg-50)

> **Owns:** current-state audit, chosen design, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), status (`00`).

## Current state

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Canonical planning templates | yes | `planning/00`–`05` | Product copies separately |
| Product template service | yes | `backend/src/services/TemplateService.js` | Duplicates the `04` content |
| Frontend template labels | yes | `PhasePlanning.vue`, `TicketDetail.vue` | Duplicate the description |
| Active suite checker | yes | `planning/check-planning.js` | Skips legacy suites; no done-outside-DONE rule |
| Status indexes | yes | `PENDING.txt`, `HARNESS_ROADMAP.md` | Manual and partially checked |
| `04` lifecycle | no | — | Optional but sometimes maintained post-merge |

## Design summary

### Lifecycle cleanup

Move suites whose `00` status is `done` into `planning/DONE/`, preserving their
contents. Update links in `PENDING.txt`, `HARNESS_ROADMAP.md` and any suite
references. Add a checker failure for a done suite outside `DONE/`.

### Template source

Start with a drift test rather than generation:

- extract required headings and a small set of banned/required phrases from
  `planning/04_SPECIFICATION.md`;
- assert the `TemplateService` string and frontend labels contain the same
  required headings and wording;
- if generation is chosen later, make the repo Markdown the source and
  generate the product strings at build time.

The test should fail if one copy is edited alone.

### Wording and frontmatter checks

Add a `check-planning.js` pass for active suites and the root templates:

- reject retired terms in active templates/suites;
- reject `**Status**` in planned/in-progress suites;
- allow historical `DONE/` and `archived/` content;
- keep `planning/lightweight/` exempt.

### Indexes and `04`

Either generate `PENDING.txt`/`HARNESS_ROADMAP.md` rows from frontmatter or
validate every active suite has a matching row and label. Document `04` as an
execution aid: after implementation, `03` Results and the code/tests are
authoritative; do not keep editing the spec to match the code.

## Risks and rollout

- Moving directories can break relative links; do it in a dedicated commit and
  run `check-planning.js` after the move.
- Legacy suites may contain retired wording; exempt `DONE/`/`archived/` so the
  cleanup does not rewrite history.
- A drift test can be brittle if it compares entire prose; compare required
  headings, required phrases and banned phrases instead.
- Ship in slices: move/validate, template drift, wording/frontmatter, indexes,
  `04` lifecycle. Each slice should leave the checker green.
