# Engineering Standards

Single home for repo-wide rules. Planning templates link here; do not copy
these lists into tickets.

## Layout

```
backend/src/          Node 24 · Express · CommonJS
  api/                routers (v1/index.js mounts feature routers)
  controllers/        request/response handlers
  services/           business logic, no req/res
  models/             SQL and row mapping
  validators/         Joi schemas
  middleware/         auth, permissions, validate, cors, errorHandler
  migrations/         NNN_*.sql + NNN_*_rollback.sql
frontend/src/         Vue 3 · Vite · Pinia · TypeScript
  api/                one module per domain, native fetch via client.ts
  views/ components/  UI
  router/index.ts     routes
  api/generated/      generated OpenAPI types
agent/                Java 17 · Maven · harness supervisor
planning/             these templates and ticket suites
```

## API conventions

- Success: `{ success: true, data: ... }`; error: `{ success: false, error: { code, message } }`.
- Backend returns `snake_case`; frontend API clients convert to `camelCase`.
- User auth is JWT; agents authenticate with the `X-API-Key` header.
- Permissions live in `backend/src/middleware/permissions.js` (26 permissions,
  4 roles). Route-level checks use `requirePermission` / `requireAnyPermission`.
- Every route needs JSDoc OpenAPI annotations when its contract changes.
- Validate input with a Joi schema in `backend/src/validators/`, applied with
  `validate(schema)`.

## Migrations

- Files live in `backend/src/migrations/`, applied by `src/migrations/apply.js`
  in **array order — not numeric order**.
- Every migration has a `_rollback.sql` counterpart.
- Preview with `cd backend && npm run db:migrate:dry-run`.
- Additive changes first; backfills must be idempotent. No destructive change
  without a data path.

## Test layers

| Layer | Command (from the stated dir) | Use for |
|---|---|---|
| Backend unit | `cd backend && npm test` | controllers, services, middleware, validators |
| Backend coverage | `cd backend && npm run test:coverage` | 60% minimum |
| Backend integration | `cd backend && npm run test:integration` | real PostgreSQL, HTTP→DB lifecycle |
| Bash integration | `cd backend && bash integration-test/run.sh --only` | real API against Docker, auth/permission/flow |
| Frontend unit | `cd frontend && npm test -- --run` | API clients, components, stores |
| Frontend coverage | `cd frontend && npm run test:coverage` | 60% minimum |
| Contract | `cd frontend && npx vitest run src/__tests__/api-contract.test.ts` | response shapes vs `validator.ts` |
| Frontend build | `cd frontend && npm run typecheck && npm run build` | types and bundle |
| Agent | `cd agent && mvn test` | Java harness, client, config |

Rules:

- New or changed code needs new or changed tests. Verifying that old tests
  still pass is not enough.
- Every bug fix includes a regression test that reproduces the original failure.
- When `04_SPECIFICATION.md` exists, create empty test stubs before production
  code.
- Test the error path, the empty state, and the permission boundary — not only
  the happy path.

## Generated artifacts

```bash
cd frontend && npm run generate:spec   # backend JSDoc → openapi-generated.json
cd frontend && npm run generate:api    # spec → src/api/generated
cd frontend && npm run typecheck       # generated types must compile
```

Update `frontend/src/api/validator.ts` and
`frontend/src/__tests__/api-contract.test.ts` whenever a response shape
changes.

## Definition of done

Run the layers you changed, then the neighbours, then integration:

```bash
cd backend  && npm test && npm run lint
cd frontend && npm test -- --run && npm run lint && npm run typecheck && npm run build
cd agent    && mvn test
```

Plus, when applicable:

```bash
cd backend && npm run test:coverage
cd backend && npm run test:integration
cd backend && bash integration-test/run.sh --only
```

CI enforces a **60% minimum** on lines, functions, branches and statements for
backend and frontend.

## Anti-patterns

- ❌ Creating a new file when an existing one can be extended.
- ❌ Duplicating an existing API client or UI pattern instead of following it.
- ❌ Adding a new page when the feature belongs in an existing tab/section.
- ❌ Hardcoding API paths instead of using the existing client helpers.
- ❌ `snake_case` leaking into frontend types.
- ❌ Skipping error handling or testing only the happy path.
- ❌ Merging without new or updated tests.
- ❌ Changing a backend response shape without updating `validator.ts`, the
  contract test, and regenerating types.
- ❌ Shipping a migration without a rollback.
- ❌ Copying a fact from another planning document instead of linking to it.
