# Supabase Cloud Baseline V2 Evidence

Capture time: `2026-09-03T06:30:08Z`

## Source Of Truth

- Production project: `ftciqmqhmfvjtwoycswe`
- Canonical Git base: `origin/main` at
  `c44dc85b8580f2bdbd354bd52234135827bc0f3f`
- Production PostgreSQL: `17.6`
- Capture client: `pg_dump 17.10`
- Supabase CLI: `2.95.6`

## Frozen Starting State

- Production migration rows: `151`
- First remote version: `20260428090000`
- Last remote version: `20260830081946`
- Active local SQL files: `402`
- Valid unique active versions: `393`
- Invalid legacy filenames: `9`
- Common local/remote versions: `151`
- Local-only valid versions: `242`
- Remote-only versions: `0`
- Known intentional pending work: PERF02 query indexes from commit `4f154ef`

## Preview Branch Diagnosis

The user-created `baseline-vioo` branch is a healthy, disposable, no-data
preview database, but its migration deployment status is `MIGRATIONS_FAILED`.
The database has zero applied migration rows and only the default `public`,
`auth`, and `storage` schemas.

The active repository history starts with
`20260428090000_harden_workflows_assets_wms.sql`. That file alters
`public.asset_location_stocks` before any active migration creates the base
table. The relation is absent on the preview database. The failure is therefore
caused by the repository's non-bootstrap historical chain, not by preview
database health. The branch is suitable for a transactional manual validation
of the new baseline after the candidate is generated.

## Integrity

- Migration history CSV SHA-256:
  `87fdac4f9126c04e298185ff4da353aae17e4816bba357934c9103e754077902`
- Schema fingerprint SHA-256:
  `fba1645de106bfeb879669a7ee945991bd6a941cbc05c909538e3165b1124541`
- Active migration manifest SHA-256:
  `c4b344c05053fb0259b7f16f93dc6fa3f59473834694133b0dd06d882cef62f4`

No production schema, data, or migration history was changed during this
capture. Connection strings and credentials are not stored in this directory.

## Cutover Result

The validated baseline was merged to `origin/main` and the production ledger
was repaired at `2026-09-03T08:13:32Z`. The baseline SQL was not executed on
production. The 151 captured history rows were marked reverted and
`20260903063714_cloud_schema_baseline_v2.sql` was marked applied.

Post-cutover checks proved:

- Production schema fingerprint before/after: identical (`fba1645d...4541`).
- Production configuration inventory before/after: no differences.
- Production Cron jobs: all five remain active.
- Migration list: baseline aligned locally/remotely.
- Dry run: only `20260903063821_perf02_query_indexes.sql` is pending.
- Git-linked no-data preview: healthy, baseline-only ledger, fingerprint and
  configuration differences both zero.

PERF02 was subsequently completed on production at
`2026-09-03T08:21:51Z`. The final migration list contains both the baseline and
PERF02, and `db push --dry-run` reports that the remote database is up to date.
The post-PERF02 fingerprint contains exactly three additional objects—the
three reviewed PERF02 indexes—with zero removed objects. Configuration remains
byte-for-byte identical and all five Cron jobs remain active.

See `production_cutover_summary.json`, `validation_summary.json`, and the
captured command outputs in this directory for machine-readable evidence.

## Operating Rules After Baseline

1. Treat `supabase/migrations/20260903063714_cloud_schema_baseline_v2.sql` as
   the immutable migration boundary. Historical files remain immutable under
   `supabase/migrations_archive/pre_baseline_20260903/`.
2. Generate every future schema change with Supabase CLI, merge it to `main`,
   and use one designated writer to deploy it. Never use `--include-all`.
3. If emergency SQL is run in the Dashboard, capture the exact change in a
   narrow migration immediately and repair only that migration's ledger entry.
4. Run `npm run check:supabase-migrations` in CI and before every deployment.
5. Preview bootstraps keep captured Cron jobs disabled. Production Cron state
   must not be copied from preview.

## PERF02 Deployment Note

PERF02 remains ordered after the baseline and is now applied on production. Its
three indexes use `CREATE INDEX CONCURRENTLY` to avoid blocking live writes.
The Cloud migration runner could not execute that migration through its
pipeline and retried it on later `main` pushes, leaving two same-named indexes
invalid. A standalone `psql` execution correctly created the third index but
skipped the invalid names because the migration uses `IF NOT EXISTS`.

Recovery was deliberately narrow: the two invalid indexes were rebuilt with
`REINDEX INDEX CONCURRENTLY`, all three definitions were verified as both
`indisvalid` and `indisready`, and only version `20260903063821` was then marked
applied using `supabase migration repair`. No baseline SQL was rerun. See
`perf02_production_completion_summary.json`,
`migration_list_after_perf02.txt`, and `db_push_dry_run_after_perf02.txt`.

The next Git-linked `main` action completed at `2026-09-03T08:23:34Z` with the
`migrate` step `EXITED`; all runnable steps exited successfully. This proves
the runner now sees the repaired two-version ledger and no longer retries
PERF02.

The retained no-data preview is `baseline-vioo-git`; redundant manual preview
branches were deleted after their evidence was recorded.
