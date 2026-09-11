# Tests

Phase 1 test harness: [Vitest](https://vitest.dev) for unit and data-layer tests.
Tests never call a live LLM; `tests/setup.ts` forces `LLM_PROVIDER=mock`.

## Running tests

```bash
npm test           # run once
npm run test:watch # watch mode
```

Database-backed tests (`tests/spine.test.ts`) need a Postgres with the
[pgvector](https://github.com/pgvector/pgvector) extension. Pure unit tests
(`tests/llm-mock.test.ts`) run without a database.

## Local test database

Start a throwaway pgvector Postgres on port **5433** (kept off the default 5432
so it cannot clash with a developer's primary database):

```bash
docker run --name assessment-test-db \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=assessment_test \
  -p 5433:5432 \
  -d pgvector/pgvector:pg16
```

Then point the tests at it and run them:

```bash
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/assessment_test"
npm test
```

`npm test` provisions the test database automatically in its global setup, then
runs the suite. When you are done:

```bash
docker rm -f assessment-test-db
```

## How the test database is provisioned

`tests/helpers/provision.ts` builds the schema by applying the committed
migration history with `prisma migrate deploy`:

1. `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` — an empty database on
   the test database only. Dropping the schema also drops the `vector`
   extension, so each run starts truly from scratch.
2. `prisma migrate deploy` — runs every directory under `prisma/migrations/`
   against the test database, exactly as a deployment would.

The single baseline migration (`20260911180000_baseline`) takes the empty
database straight to `prisma/schema.prisma`. It runs
`CREATE EXTENSION IF NOT EXISTS vector;` and creates the
`MaterialChunk_embedding_hnsw_idx` HNSW index, neither of which Prisma emits
for an `Unsupported("vector(1536)")` column.

Because the suite builds the schema through the migrations, CI fails if the
migration history stops reproducing `prisma/schema.prisma` from empty. The
datamodel is authoritative; when it changes, verify the migrations still build a
fresh database (a squash into a new baseline is the simplest way to do that
while the project has no production database).

## Safety rules

- Tests read `TEST_DATABASE_URL`, falling back to `DATABASE_URL`.
- The database name **must contain `test`** or the harness refuses to run. This
  is enforced in `tests/helpers/env.ts` and again before provisioning.
- Provisioning and `truncateAll()` only ever run against an explicit
  `TEST_DATABASE_URL`, never the ambient `DATABASE_URL`.
- `truncateAll()` empties application tables and is only reachable through the
  validated test client.
- No `prisma migrate reset` / `migrate dev` is ever executed by the harness, so
  a developer's primary database is never reset or dropped.
