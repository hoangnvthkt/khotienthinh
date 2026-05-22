# Database Baseline Capture - 2026-05-21

Project ref: `ftciqmqhmfvjtwoycswe`

## Captured Files

- `schema_inventory.sql`: metadata query used to capture the current `public` schema.
- `cloud_public_schema_inventory.json`: raw Supabase CLI JSON output from the metadata capture.
- `cloud_public_schema_inventory.pretty.json`: extracted schema inventory JSON for review/diffing.
- `migration_list_linked.txt`: Supabase local/remote migration history snapshot.
- `db_dump_dry_run.txt`: Supabase-generated `pg_dump` script with temporary credentials.

## Capture Summary

- Captured at: `2026-05-21T15:51:07.583322+00:00`
- Schema: `public`
- Tables: 147
- Columns: 1,901
- Functions/procedures: 154
- Policies: 438
- Triggers: 17
- Indexes: 514
- Types/enums/domains: 15

## Migration History Snapshot

From `supabase migration list --linked`:

- Local-only migrations: 30
- Remote-only migrations: 140
- Matching migrations: 17

This confirms that `supabase db push` is currently unsafe/unusable without a controlled baseline/repair process.

## Current Blocker

`supabase db dump --linked --schema public` cannot complete on this machine because Supabase CLI needs Docker/pg_dump for the actual dump step, and Docker is not installed/running.

The only local `pg_dump` found is PostgreSQL 13.4 from DaVinci Resolve, while the cloud database is PostgreSQL 17.6. That client is not compatible for a reliable production schema dump.

## Safe Next Step

Before migration history repair, generate a true restore-grade baseline SQL using one of:

1. Docker Desktop + `supabase db dump --linked --schema public --file ...`
2. PostgreSQL 17 `pg_dump` binary using the dry-run script in this folder
3. Supabase Dashboard/database backup export

Only after a restore-grade baseline is validated should migration history be repaired.
