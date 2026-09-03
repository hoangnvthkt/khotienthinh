# Supabase Cloud Migration Baseline V2 Design

**Status:** Implemented on 2026-09-03; production baseline and PERF02 ledger are aligned.

## Objective

Make the current Supabase Cloud database the authoritative schema baseline, align
the active Git migration set and `supabase_migrations.schema_migrations`, and
restore a safe `db push` workflow without replaying historical migrations.

The baseline cut is taken at the actual frozen Cloud cutover time. The exact
14-digit version is generated once with `supabase migration new` after the
freeze check; it is not preassigned from a planning timestamp.

## Confirmed Decisions

- The current Cloud database is the schema source of truth.
- `origin/main` is the canonical Git branch.
- PERF02 remains a post-baseline migration and must sort after the new baseline.
- Supabase local and Docker are not used. Rebuild validation runs on a disposable
  Supabase Cloud preview branch without production data.
- Production migration history is repaired only after all preflight gates pass.
- The baseline is never executed against the existing production schema. It is
  applied only to an empty validation database and marked applied in production.

## Verified Starting State

At the start of preparation on 2026-09-03:

- Production project `ftciqmqhmfvjtwoycswe` is `ACTIVE_HEALTHY`.
- The refreshed access token can read the project through the Management API.
- PostgreSQL server is 17.6 and the available `pg_dump` client is 17.10.
- `origin/main` points to commit `c44dc85`.
- `supabase/migrations` contains 402 SQL files:
  - 393 unique valid 14-digit versions;
  - 9 nonstandard filenames;
  - 151 versions present both locally and remotely;
  - 242 valid versions present only locally;
  - 0 versions present only remotely.
- Production history contains 151 rows: 9 before the July baseline, the July
  baseline itself, and 141 after it.
- Existing preview branch `baseline-vioo` is `MIGRATIONS_FAILED`; it is retained
  unchanged until its failure evidence is collected or it is deliberately
  replaced during implementation.
- Tests on the exact `origin/main` worktree pass: 319 files and 1,552 tests.

## Lessons From The July Baseline

The July procedure successfully reduced remote history to
`20260720095234_remote_schema_baseline` and then deployed the first
post-baseline migration. It did not remain authoritative for two reasons:

1. Commit `316be574`, which archived the historical migrations and contained
   the audit/rollback package, was never merged into main.
2. The generated baseline included `auth`, `public`, and `storage`, but omitted
   definitions for `app_private` and `private`. It contains hundreds of
   references to `app_private`, so it is not a valid clean rebuild artifact.

The V2 cut therefore adds both a merge gate and a clean-Cloud rebuild gate.

## Baseline Package

The baseline commit contains these components:

```text
supabase/
  baseline/2026-09-03/
    README.md
    cloud_schema_before.sql
    migration_history_before.csv
    schema_fingerprint_before.json
    cloud_configuration_inventory.json
    active_migrations_before.sha256
    archived_migrations.sha256
    rollback_history.sh
    preflight_summary.json
    validation_summary.json
  migrations_archive/pre_baseline_20260903/
    YYYYMMDDHHMMSS_historical_name.sql
  migrations/
    YYYYMMDDHHMMSS_cloud_schema_baseline_v2.sql
    YYYYMMDDHHMMSS_perf02_query_indexes.sql
```

Only the baseline is marked applied during the ledger cut. PERF02 remains
pending until the normal post-baseline deployment gate.

Implementation note: the Cloud runner could not execute PERF02's concurrent
index statements and repeated attempts left two invalid indexes. The approved
post-baseline work was completed with standalone concurrent index operations,
object-level verification, and a narrow repair of only the PERF02 ledger row.

## Schema Capture Rules

The schema baseline is generated from Cloud with PostgreSQL 17 tooling and
reviewed as code. It contains no production business rows.

It includes:

- Application-owned schemas `public`, `app_private`, and `private`.
- Tables, sequences, types, constraints, indexes, views, materialized views,
  functions, triggers, RLS enablement, policies, grants, comments, and default
  privileges owned by the application.
- Required extension declarations that are supported by a fresh Supabase
  project.
- Application-owned triggers on managed tables such as `auth.users`.
- Application-owned policies and grants on `storage.objects` and
  `storage.buckets`.

It excludes:

- Supabase-managed table/type/function definitions in `auth`, `storage`,
  `realtime`, `extensions`, `graphql`, `vault`, `cron`, and
  `supabase_migrations`.
- Production users, files, transactions, documents, and other business data.
- Vault secret values, JWT secrets, database passwords, API keys, and connection
  strings.

Because managed-schema application objects are not safely captured by dumping
the whole managed schema, they are generated as a reviewed supplemental section
inside the same baseline migration.

## Configuration Bootstrap

Schema-only dumps omit operational configuration stored as rows. A strict
allowlist appends idempotent bootstrap statements for configuration required by
a fresh environment, including:

- Storage bucket definitions without stored objects.
- Permission applications, modules, actions, and hardening settings.
- Singleton application settings required for function execution.
- Required cron schedules expressed through supported `cron.schedule` calls.

Environment-specific endpoints and secrets are not committed. The validation
branch uses non-production placeholders where a job cannot be disabled. The
production values remain untouched by the ledger-only cutover.

Every allowlisted table is documented with its key, row count, extraction query,
and reason for inclusion. Any table not on the allowlist is excluded.

## Pending Migration Reconciliation

Before the cut, every worktree and unmerged branch containing migration SQL is
classified as one of:

- **Already represented in Cloud:** absorbed into the baseline and archived.
- **Intentionally pending:** regenerated after the baseline with a new version.
- **Abandoned or superseded:** archived with an explicit reason.
- **Unknown:** blocks cutover until resolved.

PERF02 is already classified as intentionally pending. No historical local-only
file is marked applied merely because it exists in Git.

## Execution Flow And Gates

### Gate 1: Freeze and immutable evidence

- Disable automated migration deployment.
- Confirm no operator is running SQL, `db push`, or `migration repair`.
- Record `origin/main` commit and all worktree/branch heads.
- Export the full production migration rows and schema/configuration evidence.
- Generate checksums and a rollback script before changing active migrations.

If Cloud migration history or the schema fingerprint changes after capture, the
run is aborted and evidence is regenerated.

### Gate 2: Candidate baseline in Git

- Move every active historical migration into the archive without deleting it.
- Generate the baseline filename with `supabase migration new`.
- Populate it from the reviewed Cloud dump, managed-schema supplemental DDL, and
  allowlisted configuration bootstrap.
- Recreate PERF02 after the baseline with a new CLI-generated timestamp.
- Add CI checks for migration filename validity, unique versions, archive
  boundary, and unexpected pre-baseline files.

### Gate 3: Empty Cloud rebuild

- Create a disposable preview branch without `--with-data`.
- Apply the exact candidate migration set from the candidate commit.
- Compare structural fingerprints for application objects, functions, RLS,
  policies, triggers, grants, and required configuration.
- Run SQL smoke tests and the application test/build suite.
- Treat warnings or missing application-owned objects as failures.

The existing failed `baseline-vioo` branch is not treated as proof. It may be
inspected and then replaced only after the candidate migration set is ready.

### Gate 4: Merge gate

- Merge the exact validated baseline commit into main while migration deployment
  remains disabled.
- Fetch `origin/main` and prove it contains the baseline commit, archive,
  manifests, rollback script, and CI guard.
- Re-run migration inventory against the exact `origin/main` tree.

Production history is not repaired from an unmerged feature branch.

### Gate 5: Production ledger cutover

- Recheck the production fingerprint and migration-history checksum.
- Use supported `supabase migration repair` operations to mark the captured 151
  historical versions reverted and the new baseline version applied.
- Do not execute baseline SQL against production.
- Immediately run `supabase migration list` and `db push --dry-run`.

Success requires the new baseline on both sides and only explicitly declared
post-baseline migrations, including PERF02, listed as pending.

### Gate 6: Resume normal deployment

- Apply post-baseline migrations separately after their own preflight.
- Run database advisors and targeted smoke tests.
- Re-enable the single-writer deployment pipeline only after all checks pass.

## Rollback

The ledger cut does not alter application schema or business data. If any
post-repair check fails:

1. Keep migration deployment frozen.
2. Mark the new baseline reverted.
3. Restore the exact captured 151 historical versions from the generated
   rollback script.
4. Verify the restored history checksum and schema fingerprint.
5. Revert the baseline Git commit or reset deployment to the pre-cut recovery
   tag; do not delete the archive or evidence.

If a post-baseline migration has already changed schema, its migration-specific
rollback procedure applies before restoring history metadata.

## Permanent Controls

CI fails when:

- An active migration filename lacks one unique 14-digit version.
- A migration at or before the baseline boundary reappears in the active folder.
- The baseline/archive manifest is missing or unexpectedly changes.
- A deployment command contains `--include-all`.
- A Cloud deployment originates from a commit not contained in `origin/main`.

Operationally, only one automation identity or designated operator may write
migration history.

## Acceptance Criteria

- A fresh no-data Cloud preview branch builds successfully from the baseline.
- Application schema fingerprints match production for all in-scope objects.
- Required storage buckets, permissions, settings, policies, and cron schedules
  are present without copying production business data or secrets.
- `origin/main` contains the complete archive, evidence, rollback, baseline, and
  CI guard before production repair.
- Production schema fingerprint is identical before and after ledger repair.
- Local and remote migration lists contain the same baseline version.
- Dry-run lists only deliberately pending post-baseline migrations.
- Test, build, database advisor, and targeted SQL smoke checks pass.

## Explicitly Prohibited

- `supabase db push --include-all` or `migration up --include-all`.
- Executing the full baseline against the existing production database.
- Marking all 242 local-only versions applied without object-level proof.
- Dumping or committing secrets or production business data.
- Repairing production history before the validated commit is in main.
- Reusing the incomplete July baseline as the new clean-build artifact.
