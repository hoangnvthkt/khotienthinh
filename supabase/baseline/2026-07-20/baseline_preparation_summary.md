# Supabase Baseline Preparation Summary

Reference time: `2026-07-20 09:52:34 +07`

## What Was Captured

- `migration_list_linked_before.txt`: `supabase migration list --linked --agent=no`
- `schema_migration_versions_before.csv`: remote migration versions only
- `schema_migrations_before.csv`: raw remote migration rows with `version`, `statements`, `name`, `created_by`, `idempotency_key`, `rollback`
- `schema_migrations_columns.csv`: current columns in `supabase_migrations.schema_migrations`
- `schema_migration_count_before.csv`: remote applied migration count
- `migration_mismatch_summary.json`: local/remote mismatch counts
- `supabase_cli_version.txt`: CLI version used for this evidence
- `create_schema_dump_with_pg_dump.sh`: reproducible fallback dump script using local `pg_dump`
- `schema_dump_before.sql`: schema-only dump from linked cloud via local `pg_dump`
- `schema_dump_before_direct_pg_dump.log`: stderr from the direct `pg_dump` run
- `archived_migrations_manifest.sha256`: SHA-256 manifest for archived historical migrations
- `active_migrations_after_baseline.sha256`: SHA-256 manifest for active post-prep migrations
- `migration_list_linked_after_baseline_prep_before_repair.txt`: linked migration list after local baseline prep and before remote repair
- `migration_list_after_baseline_prep_summary.json`: parsed counts from the post-prep/pre-repair migration list
- `db_push_dry_run_after_baseline_prep_before_repair.txt`: expected failing dry-run proving remote repair is still required
- `repair_remote_to_baseline.sh`: guarded forward repair script
- `repair_rollback_commands.sh`: guarded rollback repair script

## Evidence

From `migration_mismatch_summary.json`:

- Local migration files: `263`
- Remote applied migration rows: `331`
- Remote-only versions: `146`
- Local-only versions: `78`
- Invalid/nonstandard local migration filenames: `9`

The invalid/nonstandard local filenames are:

- `20260429_fastcons_boq_payment.sql`
- `20260502_pbac_tab_decouple.sql`
- `20260504_gantt_actual_dates.sql`
- `20260531_ai_tool_rpc_functions.sql`
- `20260531_fix_quality_checklists_fkey.sql`
- `20260531_inspection_templates.sql`
- `20260531_quality_management.sql`
- `20260531_quality_refactor_v2.sql`
- `20260531_weekly_progress_snapshots.sql`

## Why Baseline Reset Is The Safer Direction

Supabase compares local migration files against `supabase_migrations.schema_migrations` when running `db push`. The current repo cannot pass that comparison because remote history contains migration versions that are missing locally, while local also contains many migration files absent from remote history.

Trying to reconstruct 146 historical remote-only migrations would create high-risk fake history. Taking the current cloud schema as a baseline is safer because it records the real production state first, then makes every future migration explicit after that baseline.

## Baseline Dump Result

PostgreSQL client tools were installed locally and verified:

```bash
pg_dump (PostgreSQL) 17.10
psql (PostgreSQL) 17.10
pg_restore (PostgreSQL) 17.10
```

Supabase CLI `db dump` was retried, but CLI v2.95.6 still selected the Docker image path for this linked project. The baseline schema was therefore generated with the reproducible local script:

```bash
bash supabase/baseline/2026-07-20/create_schema_dump_with_pg_dump.sh
```

Result:

- `schema_dump_before.sql`: `43321` lines
- SHA-256: `4371d2d6a6e70b94faff9b40907641caa7dbc623521b7055e7537e2e2f460ad9`
- `pg_dump` stderr: empty
- Static data-mutation scan: no `INSERT`, `COPY`, `UPDATE`, `DELETE`, or `TRUNCATE` statements

The active baseline migration is byte-identical to the captured schema dump:

```text
supabase/migrations/20260720095234_remote_schema_baseline.sql
```

## Local Migration Folder After Preparation

Historical migrations were archived, not deleted:

```text
supabase/migrations_archive/pre_baseline_20260720/
```

Archive count: `263` SQL files.

The previous local-only Asset permission migration was preserved in:

```text
supabase/migrations_pending/post_baseline_20260720/asset_action_operation_guards.sql
```

It was also re-created as a normal post-baseline active migration:

```text
supabase/migrations/20260720100000_asset_action_operation_guards.sql
```

Active migration folder now contains exactly:

```text
supabase/migrations/20260720095234_remote_schema_baseline.sql
supabase/migrations/20260720100000_asset_action_operation_guards.sql
```

Post-prep linked migration list summary, before any remote repair:

- Local-only: `2` (`20260720095234`, `20260720100000`)
- Remote-only: `331`
- Both local and remote: `0`

`supabase db push --linked --dry-run --agent=no` still fails at this point with remote-only history mismatch. That is expected and confirms remote migration history has not been repaired yet.

## Guardrails In The Repair Scripts

`repair_remote_to_baseline.sh` refuses to run unless this file exists and is non-empty:

```text
supabase/migrations/20260720095234_remote_schema_baseline.sql
```

That means the script cannot accidentally delete historical remote migration history before the baseline migration is present for review.

`repair_rollback_commands.sh` restores the exact pre-repair remote versions from:

```text
supabase/baseline/2026-07-20/remote_versions_before.txt
```

Both repair scripts pass `bash -n` syntax verification.

## Remote Repair And Dry-Run Result

Remote migration repair was approved and run with:

```bash
bash supabase/baseline/2026-07-20/repair_remote_to_baseline.sh
```

Output was captured in:

```text
supabase/baseline/2026-07-20/repair_remote_to_baseline_output.txt
```

The linked migration list after repair is:

```text
Local          | Remote         | Time (UTC)
---------------|----------------|---------------------
20260720095234 | 20260720095234 | 2026-07-20 09:52:34
20260720100000 |                | 2026-07-20 10:00:00
```

The dry-run command was run only, with no actual push:

```bash
node_modules/.bin/supabase db push --linked --dry-run --agent=no
```

Dry-run result:

```text
Would push these migrations:
 • 20260720100000_asset_action_operation_guards.sql
```

The linked migration list was captured again after dry-run and remained unchanged: baseline is both Local/Remote, Asset is Local-only.

No actual `db push` has been run.

## Actual Push And Smoke Test Result

Actual push was separately approved and run with Supabase CLI `2.95.6`:

```bash
node_modules/.bin/supabase db push --linked --agent=no
```

Output was captured in:

```text
supabase/baseline/2026-07-20/db_push_actual_20260720100000_output.txt
```

The push applied exactly:

```text
20260720100000_asset_action_operation_guards.sql
```

The Asset smoke test was run inside a rollback transaction with `psql`, and output was captured in:

```text
supabase/baseline/2026-07-20/asset_action_operation_guards_smoke_after_push.txt
```

Smoke result:

- exit code: `0`
- smoke output bytes: `0`
- no failed assertions or raised exceptions
- test-data counts before and after rollback were identical
- all checked smoke-data prefixes remained count `0`

Final linked migration list:

```text
Local          | Remote         | Time (UTC)
---------------|----------------|---------------------
20260720095234 | 20260720095234 | 2026-07-20 09:52:34
20260720100000 | 20260720100000 | 2026-07-20 10:00:00
```

A final dry-run after actual push reported:

```text
Remote database is up to date.
```

## Official Supabase References Used

- Database migrations: https://supabase.com/docs/guides/deployment/database-migrations
- CLI reference for `migration repair`, `db pull`, and migration tracking: https://supabase.com/docs/reference/cli/introduction
