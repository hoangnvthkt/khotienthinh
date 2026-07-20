# Supabase Migration Baseline Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reset Supabase migration history so the linked cloud database and `/Users/admin/khotienthinh/supabase/migrations` share one clean baseline from `2026-07-20 09:52:34 +07`, then future `supabase db push` can deploy only new post-baseline changes.

**Architecture:** Treat the current linked cloud database schema as the canonical baseline. Archive every pre-baseline migration file out of the active migration folder, generate one baseline migration from the linked schema, repair remote migration history so only the baseline is considered applied, then re-create selected pending work as post-baseline migrations.

**Tech Stack:** Supabase CLI v2.95.6, Postgres, `supabase_migrations.schema_migrations`, shell scripts under `supabase/baseline/2026-07-20/`, SQL smoke tests.

## Global Constraints

- Work only in `/Users/admin/khotienthinh` on branch `refactor/module-du-an-v1`.
- Do not delete historical migration files; move them to an archive folder first.
- Do not change production schema while creating the baseline snapshot.
- Do not run `supabase migration repair` until the archive, schema dump, migration list, and rollback command file are committed or explicitly approved.
- Treat linked cloud schema at `2026-07-20 09:52:34 +07` as the canonical state.
- Any current feature migration not yet applied to cloud, including Asset action permissions, must become a new post-baseline migration.

---

## Current Findings

- `supabase migration list --linked` shows many `Remote`-only versions from `20260304041720` through `20260705164502`.
- The active local folder also contains many `Local`-only versions, plus invalid/nonstandard versions such as `20260429`, `20260502`, and repeated `20260531`.
- `supabase db push --linked --dry-run --agent=no` fails because remote migration versions are not present locally.
- The current Asset permission migration `20260720093000_asset_action_operation_guards.sql` is local-only and should not be hidden inside the baseline unless it is applied to cloud before the baseline cut. Preferred: re-create it after the baseline with a new post-baseline timestamp.

## Execution Status 2026-07-20

- Evidence captured under `supabase/baseline/2026-07-20/`.
- Clean mismatch count from `schema_migration_versions_before.csv`: local files `263`, remote applied rows `331`, remote-only `146`, local-only `78`.
- Forward and rollback repair scripts created with guards:
  - `supabase/baseline/2026-07-20/repair_remote_to_baseline.sh`
  - `supabase/baseline/2026-07-20/repair_rollback_commands.sh`
- PostgreSQL client tools are now installed locally and verified: `pg_dump`, `psql`, and `pg_restore` all report PostgreSQL `17.10`.
- Supabase CLI `db dump` was retried but still selected the Docker image path, so the baseline dump was generated with `supabase/baseline/2026-07-20/create_schema_dump_with_pg_dump.sh`.
- Baseline dump result:
  - `supabase/baseline/2026-07-20/schema_dump_before.sql`
  - `43321` lines
  - SHA-256 `4371d2d6a6e70b94faff9b40907641caa7dbc623521b7055e7537e2e2f460ad9`
  - `pg_dump` stderr empty
  - static scan found no `INSERT`, `COPY`, `UPDATE`, `DELETE`, or `TRUNCATE` statements.
- Historical active migrations were archived, not deleted:
  - `supabase/migrations_archive/pre_baseline_20260720/`
  - archive count: `263` SQL files.
- Active migration folder now contains exactly:
  - `supabase/migrations/20260720095234_remote_schema_baseline.sql`
  - `supabase/migrations/20260720100000_asset_action_operation_guards.sql`
- The post-baseline Asset migration is byte-identical to the previous local-only migration and also preserved in `supabase/migrations_pending/post_baseline_20260720/asset_action_operation_guards.sql`.
- Post-prep/pre-repair linked migration list is captured in `migration_list_linked_after_baseline_prep_before_repair.txt`: remote-only `331`, local-only `2`, both `0`.
- `supabase db push --linked --dry-run --agent=no` still fails before repair with the expected remote-only history mismatch. Remote repair and push have **not** been run.
- Remote repair was approved and run:
  - `20260720095234` now appears on both Local and Remote.
  - `20260720100000` remains Local-only.
  - repair output: `supabase/baseline/2026-07-20/repair_remote_to_baseline_output.txt`
  - linked list after repair: `supabase/baseline/2026-07-20/migration_list_linked_after_repair.txt`
- Post-repair `supabase db push --linked --dry-run --agent=no` was run only. It would push exactly:
  - `20260720100000_asset_action_operation_guards.sql`
- The linked migration list was captured again after dry-run and remained unchanged.
- Actual `supabase db push --linked --agent=no` was separately approved and run with CLI `2.95.6`.
- The push applied exactly `20260720100000_asset_action_operation_guards.sql`.
- Asset smoke test was run inside a rollback transaction with `psql`; exit code `0`, no output, no failed assertions.
- Smoke test data counts before and after rollback were identical and all checked smoke prefixes remained count `0`.
- Final linked migration list shows both `20260720095234` and `20260720100000` on both Local and Remote.
- Final post-push dry-run reports `Remote database is up to date.`

## File Structure

- Create: `supabase/baseline/2026-07-20/migration_list_linked_before.txt`
  Stores pre-repair linked migration list.
- Create: `supabase/baseline/2026-07-20/schema_migrations_before.csv`
  Stores raw migration history rows from cloud.
- Create: `supabase/baseline/2026-07-20/schema_dump_before.sql`
  Stores schema-only dump from cloud before any repair.
- Create: `supabase/baseline/2026-07-20/repair_rollback_commands.sh`
  Stores exact commands to restore old migration history if needed.
- Create: `supabase/migrations_archive/pre_baseline_20260720/`
  Stores old active migration SQL files.
- Create: `supabase/migrations/20260720095234_remote_schema_baseline.sql`
  New canonical baseline migration.
- Create: `supabase/migrations/20260720100000_asset_action_operation_guards.sql`
  Re-created post-baseline Asset permission migration, copied from current pending work after baseline reset.
- Modify: `docs/superpowers/plans/2026-07-20-supabase-migration-baseline-reset.md`
  Track execution results and exact version lists.

---

### Task 1: Capture Pre-Repair Evidence

**Files:**
- Create: `supabase/baseline/2026-07-20/migration_list_linked_before.txt`
- Create: `supabase/baseline/2026-07-20/schema_migrations_before.csv`
- Create: `supabase/baseline/2026-07-20/schema_dump_before.sql`

**Interfaces:**
- Consumes: linked Supabase project credentials already configured in the repo.
- Produces: immutable audit evidence for rollback and review.

- [ ] **Step 1: Create baseline evidence directory**

Run:

```bash
mkdir -p supabase/baseline/2026-07-20
```

Expected: directory exists.

- [ ] **Step 2: Save linked migration list**

Run:

```bash
node_modules/.bin/supabase migration list --linked --agent=no > supabase/baseline/2026-07-20/migration_list_linked_before.txt
```

Expected: file contains the same Local/Remote mismatch currently blocking `db push`.

- [ ] **Step 3: Save raw remote migration history**

Run:

```bash
node_modules/.bin/supabase db query --linked --agent=no --output csv "select version, name, statements from supabase_migrations.schema_migrations order by version;" > supabase/baseline/2026-07-20/schema_migrations_before.csv
```

Expected: CSV contains every remote-applied version before repair.

- [ ] **Step 4: Save schema-only cloud dump**

Run:

```bash
node_modules/.bin/supabase db dump --linked --schema public,storage,auth --file supabase/baseline/2026-07-20/schema_dump_before.sql --agent=no
```

Expected: dump completes without changing cloud schema.

- [ ] **Step 5: Verify evidence files are non-empty**

Run:

```bash
wc -l supabase/baseline/2026-07-20/migration_list_linked_before.txt supabase/baseline/2026-07-20/schema_migrations_before.csv supabase/baseline/2026-07-20/schema_dump_before.sql
```

Expected: all three files have more than zero lines.

---

### Task 2: Isolate Historical Migrations

**Files:**
- Create: `supabase/migrations_archive/pre_baseline_20260720/`
- Modify: `supabase/migrations/`

**Interfaces:**
- Consumes: current migration SQL files.
- Produces: active migration folder ready for a single baseline migration.

- [ ] **Step 1: Create migration archive directory**

Run:

```bash
mkdir -p supabase/migrations_archive/pre_baseline_20260720
```

Expected: archive directory exists.

- [ ] **Step 2: Move every active migration into archive**

Run:

```bash
find supabase/migrations -maxdepth 1 -type f -name '*.sql' -print0 | xargs -0 -I {} mv {} supabase/migrations_archive/pre_baseline_20260720/
```

Expected: `supabase/migrations` has no `.sql` files; archive contains the old files.

- [ ] **Step 3: Restore pending feature migrations to a pending folder**

Run:

```bash
mkdir -p supabase/migrations_pending/post_baseline_20260720
cp supabase/migrations_archive/pre_baseline_20260720/20260720093000_asset_action_operation_guards.sql supabase/migrations_pending/post_baseline_20260720/asset_action_operation_guards.sql
```

Expected: Asset permission migration is preserved as pending post-baseline work.

---

### Task 3: Generate Baseline Migration From Cloud

**Files:**
- Create: `supabase/migrations/20260720095234_remote_schema_baseline.sql`

**Interfaces:**
- Consumes: current linked cloud schema.
- Produces: one canonical baseline migration file.

- [ ] **Step 1: Generate baseline schema migration**

Run:

```bash
node_modules/.bin/supabase db dump --linked --schema public,storage,auth --file supabase/migrations/20260720095234_remote_schema_baseline.sql --agent=no
```

Expected: baseline SQL file is created.

- [ ] **Step 2: Review baseline for unsafe data statements**

Run:

```bash
rg -n "^(INSERT|COPY|UPDATE|DELETE|TRUNCATE)\\b" supabase/migrations/20260720095234_remote_schema_baseline.sql
```

Expected: no data mutation statements except safe schema-owned metadata required by Supabase. If data statements appear, review them manually before continuing.

- [ ] **Step 3: Validate baseline SQL parses in rollback transaction against linked DB**

Run:

```bash
node_modules/.bin/supabase db query --linked --agent=no "begin; $(cat supabase/migrations/20260720095234_remote_schema_baseline.sql); rollback;"
```

Expected: command succeeds or fails only on existing-object errors caused by applying a full schema dump to the already-existing cloud schema. If existing-object errors appear, verify fresh-local reset in Task 4 instead; do not apply baseline to cloud.

---

### Task 4: Verify Fresh Local Reset From Baseline

**Files:**
- Use: `supabase/migrations/20260720095234_remote_schema_baseline.sql`

**Interfaces:**
- Consumes: baseline migration.
- Produces: proof a new developer can build the schema from the baseline.

- [ ] **Step 1: Start local Supabase if needed**

Run:

```bash
node_modules/.bin/supabase start
```

Expected: local Supabase services are running.

- [ ] **Step 2: Reset local database from the single baseline migration**

Run:

```bash
node_modules/.bin/supabase db reset --local
```

Expected: reset completes with only `20260720095234_remote_schema_baseline.sql` applied.

- [ ] **Step 3: Confirm local migration list is clean**

Run:

```bash
node_modules/.bin/supabase migration list --local
```

Expected: only `20260720095234` appears as applied locally.

---

### Task 5: Prepare Remote Migration Repair Commands

**Files:**
- Create: `supabase/baseline/2026-07-20/repair_remote_to_baseline.sh`
- Create: `supabase/baseline/2026-07-20/repair_rollback_commands.sh`

**Interfaces:**
- Consumes: `schema_migrations_before.csv`.
- Produces: exact scripts for forward repair and rollback.

- [ ] **Step 1: Build version list from pre-repair CSV**

Run:

```bash
tail -n +2 supabase/baseline/2026-07-20/schema_migrations_before.csv | cut -d, -f1 | tr '\n' ' ' > supabase/baseline/2026-07-20/remote_versions_before.txt
```

Expected: file contains all historical remote versions separated by spaces.

- [ ] **Step 2: Create forward repair script**

Create `supabase/baseline/2026-07-20/repair_remote_to_baseline.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSIONS="$(cat supabase/baseline/2026-07-20/remote_versions_before.txt)"
node_modules/.bin/supabase migration repair --linked --status reverted $VERSIONS
node_modules/.bin/supabase migration repair --linked --status applied 20260720095234
node_modules/.bin/supabase migration list --linked --agent=no
```

Expected: script exists but is not run yet.

- [ ] **Step 3: Create rollback repair script**

Create `supabase/baseline/2026-07-20/repair_rollback_commands.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

VERSIONS="$(cat supabase/baseline/2026-07-20/remote_versions_before.txt)"
node_modules/.bin/supabase migration repair --linked --status reverted 20260720095234
node_modules/.bin/supabase migration repair --linked --status applied $VERSIONS
node_modules/.bin/supabase migration list --linked --agent=no
```

Expected: rollback command can restore the pre-baseline migration history if repair verification fails.

---

### Task 6: Repair Remote History To Baseline

**Files:**
- Use: `supabase/baseline/2026-07-20/repair_remote_to_baseline.sh`
- Use: `supabase/baseline/2026-07-20/repair_rollback_commands.sh`

**Interfaces:**
- Consumes: reviewed baseline files and explicit approval.
- Produces: cloud migration history aligned to the new baseline.

- [ ] **Step 1: Require explicit approval**

Before running this task, confirm with the project owner:

```text
Approve repairing linked Supabase migration history to baseline 20260720095234?
```

Expected: written approval in the thread.

- [ ] **Step 2: Run forward repair**

Run:

```bash
bash supabase/baseline/2026-07-20/repair_remote_to_baseline.sh
```

Expected: linked migration list shows `20260720095234` as both Local and Remote, and historical versions no longer block `db push`.

- [ ] **Step 3: Dry-run push immediately**

Run:

```bash
node_modules/.bin/supabase db push --linked --dry-run --agent=no
```

Expected: no "Remote migration versions not found in local migrations directory" error.

- [ ] **Step 4: If dry-run fails, rollback repair**

Run:

```bash
bash supabase/baseline/2026-07-20/repair_rollback_commands.sh
```

Expected: linked migration list returns to the pre-repair state captured in Task 1.

---

### Task 7: Recreate Pending Post-Baseline Migrations

**Files:**
- Create: `supabase/migrations/20260720100000_asset_action_operation_guards.sql`
- Use: `supabase/migrations_pending/post_baseline_20260720/asset_action_operation_guards.sql`

**Interfaces:**
- Consumes: pending feature SQL.
- Produces: normal post-baseline migration ready for `db push`.

- [ ] **Step 1: Create post-baseline migration file**

Run:

```bash
cp supabase/migrations_pending/post_baseline_20260720/asset_action_operation_guards.sql supabase/migrations/20260720100000_asset_action_operation_guards.sql
```

Expected: Asset permission migration now sorts after baseline.

- [ ] **Step 2: Run rollback smoke for post-baseline migration**

Run:

```bash
node_modules/.bin/supabase db query --linked --agent=no "begin; $(cat supabase/migrations/20260720100000_asset_action_operation_guards.sql); rollback;"
```

Expected: migration SQL executes in a transaction and rolls back cleanly.

- [ ] **Step 3: Dry-run deployment**

Run:

```bash
node_modules/.bin/supabase db push --linked --dry-run --agent=no
```

Expected: dry run shows only post-baseline migrations that should be applied.

---

### Task 8: Apply Post-Baseline Migration And Verify

**Files:**
- Use: `supabase/migrations/20260720100000_asset_action_operation_guards.sql`
- Use: `supabase/tests/asset_action_operation_guards_smoke.sql`

**Interfaces:**
- Consumes: clean migration history.
- Produces: cloud database with Asset permission enforcement applied.

- [ ] **Step 1: Apply migrations normally**

Run:

```bash
node_modules/.bin/supabase db push --linked --agent=no
```

Expected: migration applies without history mismatch.

- [ ] **Step 2: Run Asset permission smoke test in rollback transaction**

Run:

```bash
node_modules/.bin/supabase db query --linked --agent=no "begin; $(cat supabase/tests/asset_action_operation_guards_smoke.sql); rollback;"
```

Expected: smoke test passes and leaves no test data.

- [ ] **Step 3: Verify linked migration list**

Run:

```bash
node_modules/.bin/supabase migration list --linked --agent=no
```

Expected: `20260720095234` and `20260720100000` appear on both Local and Remote.

---

## Decision

Recommended path: **Baseline Reset**.

Rejected alternatives:

- Reconstruct every missing March-April migration file: too much archaeology, high chance of creating fake history that does not match current schema.
- Directly apply new SQL and ignore migration history: fast today, worse tomorrow.
- Mark all current local-only migrations as applied without schema proof: unsafe because some may never have run in cloud.

## Self-Review

- Spec coverage: uses current time as canonical reference, preserves rollback, avoids direct destructive cleanup, and reintroduces pending Asset work after baseline.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: baseline version is consistently `20260720095234`; post-baseline Asset migration is consistently `20260720100000`.
