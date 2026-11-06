# 01 — Requirements (bp-133)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** status/deferred scope (`00`), design (`02`), matrix (`03`).

## Problem

bp-124 fixed the audited defects but deliberately left four follow-ups. Two
are contract drift (generated types and OpenAPI id formats); one is a data
correctness bug (soft-deleted users still listed); one is an authorization gap
(ticket writes are not scoped to project membership).

## Goals

1. Make the frontend generated client match the API contracts.
2. Remove the remaining BIGSERIAL-as-UUID documentation.
3. Stop listing deleted users.
4. Close the project-membership authorization gap for ticket writes.

## Non-goals

- Reworking the agent/harness roadmap (bp-124 D11).
- Changing the role/permission matrix beyond what FR4 requires.
- New UI features.

## Functional requirements

- **FR1 — D12:** regenerate `frontend/src/api/generated/**` from
  `backend/src/api/openapi-generated.json` so `Ticket`, `Project` and `Agent`
  use the current camelCase/string-id contracts. Fix any import breakage and
  commit the generated diff.
- **FR2 — D13:** replace the remaining `format: uuid` declarations on
  BIGSERIAL route path/body ids with the numeric-string contract (or document
  each deliberate exception). Regenerate `openapi-generated.json`.
- **FR3 — D14:** both `UserService.listUsers()` (project admin) and
  `listAllUsers()` (super-admin) exclude rows with `deleted_at IS NOT NULL`;
  add regression tests proving a deleted user is absent from both lists while
  a live user remains.
- **FR4 — D16:** ticket update/delete/release/pickup verify that the actor can
  act on the ticket's project (owner, project member, or an explicit admin
  bypass). Add positive and negative route tests.

## Acceptance criteria

- FR1: `npm run generate:api` produces no further diff; typecheck/build pass.
- FR2: `npm run generate:spec` produces no further diff; no BIGSERIAL id is
  documented as `uuid`.
- FR3: a soft-deleted user cannot appear in `GET /api/v1/users` or
  `GET /api/v1/users/super-admin`; tests cover both deleted and live users.
- FR4: a non-member with `TICKET_UPDATE`/`TICKET_DELETE` is rejected on
  another project's ticket; owners/admins still succeed. Tests cover both.

## Safety requirements

- FR4 must preserve the existing super_admin/project_admin bypass semantics.
- No secrets or unrelated files may be touched.
- Each fix ships with its own regression test (repo bug-fix protocol).
