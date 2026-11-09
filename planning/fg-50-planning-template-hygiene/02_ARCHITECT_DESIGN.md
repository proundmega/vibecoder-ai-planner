# 02 — Design (fg-50)

> **Owns:** current-state audit, chosen design, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), status (`00`).

## Current state

| Area | Exists? | Where | Gap |
|---|---|---|---|
| Canonical planning templates | yes | `planning/00`–`05` | Product copies separately |
| Product template service | yes | `backend/src/services/TemplateService.js` | Duplicates the `04` content |
| Frontend template labels | yes | `PhasePlanning.vue`, `TicketDetail.vue` | Duplicate the description |
| Active suite checker | yes | `planning/check-planning.js` | Skips legacy suites; no done-outside-DONE rule; new scans must be scoped to migrated suites |
| Template exemptions | yes | `SKIP = new Set(['DONE', 'archived', 'lightweight'])` | `lightweight` is already added in this PR; verify with a test |
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
  `planning/00`–`04` (including the `01` assumptions/change-impact sections,
  the `02` failure-mode/security sections and the lightweight `00`
  assumptions/change-impact sections);
- assert the `TemplateService` string and frontend labels contain the same
  required headings and wording;
- compare required headings, required phrases and banned phrases, not whole
  prose;
- if generation is chosen later, make the repo Markdown the source and
  generate the product strings at build time.

The test should fail if one copy is edited alone.

### Wording and frontmatter checks

Add a `check-planning.js` pass for **migrated** active suites and the root
templates:

- scan suites whose `00` status is `in_progress`, `in_review` or `done`;
- skip `planned`, `deferred` and `cancelled` suites, which may still contain
  template text until work starts;
- skip fenced code blocks and inline code spans, consistent with `fg-49`, so a
  ticket can quote the retired terms or placeholder syntax;
- reject retired terms in active migrated suites and root `planning/0*.md`
  templates;
- reject `**Status**` in planned/in-progress suites;
- allow historical `DONE/` and `archived/` content;
- keep `planning/lightweight/` exempt;
- report suites without YAML frontmatter as legacy, not as retired-wording
  failures, until they are migrated in `D1`.

### Indexes and `04`

Either generate `PENDING.txt`/`HARNESS_ROADMAP.md` rows from frontmatter or
validate every active suite has a matching row and label. Document `04` as an
execution aid: after implementation, `03` Results and the code/tests are
authoritative; do not keep editing the spec to match the code.

## Failure modes and recovery

| Failure mode | Trigger | Detection | Mitigation / test | Operator action |
|---|---|---|---|---|
| Check flags its own new suite | Scan includes planned suites, fenced examples or Results | Checker self-check test fails | Scope to `in_progress`/`in_review`/`done`; ignore fences and Results; FR7 self-check | Fix scope or move the example into a fence |
| Legacy suite blocks the tree | No frontmatter but active content | Legacy report count | Report, do not scan; migrate in staged `D1` batches | Migrate or defer the suite |
| Template drift test is too brittle | Whole-prose comparison | Frequent false failures | Compare required headings/phrases only | Narrow the comparison |
| Directory move breaks links | `DONE/` move | Link check / reviewer | Dedicated move commit; `check-planning.js` after the move | Repair links |
| Status index diverges | Manual edit | `FR5` mismatch check | Generate or strictly validate rows | Regenerate from frontmatter |
| Retired-word false positive | Ordinary prose contains a banned term | Fixture test | Use a bounded term list and fenced-example escape | Reword or extend exemption |

## Security considerations

- Authentication: no new endpoint or runtime authentication; the checker is
  local/CI only.
- Authorization: no permission changes; authoring remains behind existing
  ticket/planning permissions.
- Input validation: read only known planning files; cap file size; do not
  execute repository code or parse untrusted markup as code.
- Secrets: the checks read markdown; they must not print file contents beyond
  the matched line and must not read `.env` or credential files.
- Audit: checker output is CI evidence; no user data is written to a database.
- Rate limiting / abuse: N/A (offline, deterministic).
- Data exposure: failure messages include suite/file/line and the matched
  term; do not dump the whole document.
- Supply chain: no new dependency; use the Node standard library only.

## Risks and rollout

- Moving directories can break relative links; do it in a dedicated commit and
  run `check-planning.js` after the move.
- Legacy suites may contain retired wording; exempt and report them until the
  staged migration (`D1`) moves or rewrites them.
- A drift test can be brittle if it compares entire prose; compare required
  headings, required phrases and banned phrases instead.
- Ship in slices: move/validate, template drift, wording/frontmatter, indexes,
  `04` lifecycle. Each slice should leave the checker green, including the
  repository self-check (`FR7`).
