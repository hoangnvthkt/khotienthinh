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
