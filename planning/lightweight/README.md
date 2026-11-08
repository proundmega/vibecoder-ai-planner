# Lightweight Planning Templates

Use these templates for a small, single-layer ticket where the full `00`–`03`
set would be mostly empty sections.

Copy both files into `planning/<id>-<slug>/`:

- `00_ARCHITECT_CHECKLIST.md`
- `03_ARCHITECT_IMPLEMENTATION.md`

Do **not** use the lightweight path when the change touches any of:

- an API contract or response shape;
- a database migration or backfill;
- authentication, permissions, or tenant isolation;
- an agent/harness boundary or a new background process;
- more than one layer (frontend + backend + agent), or an uncertain root cause.

Use the full `planning/00_ARCHITECT_CHECKLIST.md` through
`planning/03_ARCHITECT_IMPLEMENTATION.md` in those cases. `04` remains optional
for either path; use it only when an implementation agent needs exact file
operations.

The requirements live in the lightweight `00`; the verification matrix lives
in the lightweight `03`. `01` and `02` are intentionally omitted.
