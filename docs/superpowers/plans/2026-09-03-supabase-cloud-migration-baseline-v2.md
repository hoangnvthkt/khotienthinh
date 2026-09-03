# Supabase Cloud Migration Baseline V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the divergent active migration history with a reproducible baseline of the current Supabase Cloud schema, validate it on an empty Cloud preview branch, merge it into `origin/main`, and repair production migration metadata without changing production schema or business data.

**Architecture:** PostgreSQL 17 `pg_dump` captures application-owned schemas from the healthy production database. Repository scripts generate evidence, validate the archive boundary, and protect CI; supplemental SQL captures application-owned objects on managed schemas and allowlisted configuration rows. The baseline is applied to an empty preview branch, merged into main, and only then recorded in the production migration ledger using supported Supabase CLI repair commands.

**Tech Stack:** Supabase Cloud, Supabase CLI 2.95.6, PostgreSQL 17.6, `pg_dump`/`psql` 17.10, Node.js 24, TypeScript, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-supabase-cloud-migration-baseline-v2-design.md`

## Global Constraints

- The current production Cloud schema is authoritative.
- The canonical Git base is `origin/main` commit `c44dc85` until the freeze recheck records a newer reviewed commit.
- Do not use Supabase local or Docker.
- Do not run `db push --include-all` or `migration up --include-all`.
- Do not execute the baseline against production.
- Do not write production migration history before the empty-Cloud rebuild, tests, checksums, and merge gate pass.
- Never print or commit passwords, access tokens, API keys, JWT secrets, Vault values, or connection strings.
- Keep PERF02 as the only known post-baseline migration; generate its filename with `supabase migration new` after the baseline.
- Preserve all historical migration SQL under `supabase/migrations_archive/pre_baseline_20260903/`.
- Execute inline in `/Users/admin/khotienthinh/.worktrees/supabase-cloud-baseline-20260903`; no sub-agents.

---

## File Structure

- Create: `scripts/supabase-baseline/migration-inventory.mjs`
- Create: `scripts/supabase-baseline/schema-fingerprint.sql`
- Create: `scripts/supabase-baseline/configuration-inventory.sql`
- Create: `scripts/supabase-baseline/render-managed-ddl.sql`
- Create: `scripts/supabase-baseline/render-bootstrap-data.sql`
- Create: `scripts/check-supabase-migration-baseline.mjs`
- Create: `lib/__tests__/supabaseBaselineTooling.test.ts`
- Create: `lib/__tests__/supabaseCloudBaselineMigration.test.ts`
- Create: `lib/__tests__/setupMigrationArchive.ts`
- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `supabase/baseline/2026-09-03/`
- Create: `supabase/migrations_archive/pre_baseline_20260903/`
- Replace active migrations with one CLI-generated baseline and one later CLI-generated PERF02 migration.

---

### Task 1: Add Deterministic Migration Inventory And CI Guard

**Files:**
- Create: `scripts/supabase-baseline/migration-inventory.mjs`
- Create: `scripts/check-supabase-migration-baseline.mjs`
- Create: `lib/__tests__/supabaseBaselineTooling.test.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: migration directory paths, optional newline-delimited remote versions, and `supabase/baseline/current.json` after cutover.
- Produces: `buildMigrationInventory({ activeDir, archiveDir, remoteVersions })` and a CLI exit status of zero only for a valid active set.

- [x] **Step 1: Write failing tooling tests**

Create fixtures in an OS temporary directory and assert:

```ts
expect(buildMigrationInventory({ activeDir, archiveDir, remoteVersions })).toEqual({
  activeSqlCount: 3,
  validUniqueActiveVersions: ['20260903090000', '20260903090100'],
  invalidActiveFiles: ['20260903_bad.sql'],
  duplicateActiveVersions: ['20260903090000'],
  localOnlyVersions: ['20260903090100'],
  remoteOnlyVersions: [],
});
```

Also spawn the guard with a fixture root and assert nonzero status for invalid names, duplicate versions, a version at or below the recorded boundary, and command text containing `--include-all`.

- [x] **Step 2: Run the focused test and confirm RED**

```bash
npm test -- --run lib/__tests__/supabaseBaselineTooling.test.ts
```

Expected: FAIL because the modules do not exist.

- [x] **Step 3: Implement inventory and guard**

Implement pure parsing functions. The guard reads the current baseline marker when present; before cutover it reports legacy filename violations as warnings. It never reads `.env` or connects to Cloud.

Add to `package.json`:

```json
"check:supabase-migrations": "node scripts/check-supabase-migration-baseline.mjs"
```

Add to CI after `npm ci`:

```yaml
- run: npm run check:supabase-migrations
```

- [x] **Step 4: Run focused verification**

```bash
npm test -- --run lib/__tests__/supabaseBaselineTooling.test.ts
npm run check:supabase-migrations
```

Expected: PASS; pre-cut legacy violations are warnings because no current baseline marker exists.

- [x] **Step 5: Commit tooling**

```bash
git add scripts/supabase-baseline/migration-inventory.mjs scripts/check-supabase-migration-baseline.mjs lib/__tests__/supabaseBaselineTooling.test.ts package.json .github/workflows/ci.yml
git commit -m "build(db): guard Supabase migration baseline"
```

---

### Task 2: Add Read-Only Cloud Evidence Queries

**Files:**
- Create: `scripts/supabase-baseline/schema-fingerprint.sql`
- Create: `scripts/supabase-baseline/configuration-inventory.sql`
- Create: `scripts/supabase-baseline/render-managed-ddl.sql`
- Create: `scripts/supabase-baseline/render-bootstrap-data.sql`
- Modify: `lib/__tests__/supabaseBaselineTooling.test.ts`

**Interfaces:**
- Consumes: a PostgreSQL connection supplied only through process environment.
- Produces: stable ordered JSON/SQL output without credentials or production business rows.

- [x] **Step 1: Create read-only evidence query drafts**

Fingerprint queries cover `public`, `app_private`, and `private`; managed DDL reads catalog metadata for `auth` and `storage`; bootstrap extraction is limited to the reviewed allowlist; no query selects from `auth.users`, `storage.objects`, Vault decrypted secrets, or business transaction tables; and outputs are deterministically ordered.

- [x] **Step 2: Run the query drafts against Cloud and capture failures**

The first live execution correctly exposed two SQL defects before evidence capture: `pg_get_functiondef` cannot render aggregates, and the renderer unions did not expose their sort key.

- [x] **Step 3: Correct the query boundaries and implement the allowlist**

The configuration allowlist is exactly:

```text
storage.buckets
public.permission_applications
public.permission_modules
public.permission_actions
app_private.permission_hardening_settings
app_private.hrm_manager_scope_settings
public.fleet_system_settings
cron.job metadata without secret values
```

Generate `CREATE POLICY` using `pg_policies`, non-internal `CREATE TRIGGER` using `pg_get_triggerdef`, and matching grants only for application-managed `auth`/`storage` objects. Generate idempotent inserts keyed by primary keys. Render cron jobs disabled for preview validation and document production activation separately.

- [x] **Step 4: Run focused tests, read-only SQL checks, and secret scan**

```bash
npm test -- --run lib/__tests__/supabaseBaselineTooling.test.ts
psql "$PRODUCTION_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/supabase-baseline/schema-fingerprint.sql >/dev/null
psql "$PRODUCTION_DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/supabase-baseline/configuration-inventory.sql >/dev/null
```

Expected: tests and read-only queries succeed.

- [x] **Step 5: Commit evidence tooling**

```bash
git add scripts/supabase-baseline lib/__tests__/supabaseBaselineTooling.test.ts
git commit -m "build(db): add Cloud baseline evidence tooling"
```

---

### Task 3: Capture Production Evidence And Diagnose `baseline-vioo`

**Files:**
- Create: `supabase/baseline/2026-09-03/README.md`
- Create: `supabase/baseline/2026-09-03/migration_history_before.csv`
- Create: `supabase/baseline/2026-09-03/remote_versions_before.txt`
- Create: `supabase/baseline/2026-09-03/schema_fingerprint_before.json`
- Create: `supabase/baseline/2026-09-03/cloud_configuration_inventory.json`
- Create: `supabase/baseline/2026-09-03/preview_branch_failure.json`
- Create: `supabase/baseline/2026-09-03/active_migrations_before.sha256`
- Create: `supabase/baseline/2026-09-03/preflight_summary.json`

**Interfaces:**
- Consumes: root `.env`, production pooler URL, and preview credentials held only in process memory.
- Produces: immutable non-secret evidence used by later gates.

- [x] **Step 1: Recheck freeze invariants**

Record UTC capture time, `origin/main` SHA, worktree heads, CLI/client/server versions, production history checksum, and schema fingerprint checksum. Abort if production history differs from 151 rows or a migration appears after `20260830081946` without explicit classification.

- [x] **Step 2: Export production evidence**

Use `psql` with `ON_ERROR_STOP=1` and deterministic CSV/JSON output. Export the full six-column migration history, remote versions, fingerprints, and configuration inventory. Never write a connection URL or credential to disk.

- [x] **Step 3: Diagnose the existing preview branch**

Record only sanitized metadata:

```json
{
  "name": "baseline-vioo",
  "status": "MIGRATIONS_FAILED",
  "preview_project_status": "ACTIVE_HEALTHY",
  "with_data": false,
  "applied_migration_count": 0,
  "application_schemas": ["public"]
}
```

Confirm the first active migration alters `public.asset_location_stocks` before any active migration creates that table. This identifies an incomplete bootstrap chain rather than a failed preview database.

- [x] **Step 4: Generate migration checksums and summary**

Generate a sorted SHA-256 manifest for all 402 active SQL files and JSON recording 393 valid unique versions, 9 invalid filenames, 151 common versions, 242 local-only versions, and 0 remote-only versions.

- [x] **Step 5: Secret scan and commit evidence**

```bash
rg -n -i 'postgres(ql)?://|eyJ[A-Za-z0-9_-]{20,}|jwt_secret|password=' supabase/baseline/2026-09-03
git diff --check
git add supabase/baseline/2026-09-03
git commit -m "chore(db): capture baseline preflight evidence"
```

Expected: the scan exposes no credentials; evidence is committed before migration files move.

---

### Task 4: Generate The Baseline And Archive History

**Files:**
- Create: `supabase/baseline/2026-09-03/cloud_schema_before.sql`
- Create: `supabase/baseline/2026-09-03/managed_schema_application_ddl.sql`
- Create: `supabase/baseline/2026-09-03/bootstrap_configuration.sql`
- Create: `supabase/baseline/2026-09-03/archived_migrations.sha256`
- Create: `supabase/baseline/current.json`
- Create: `supabase/migrations_archive/pre_baseline_20260903/*.sql`
- Create: `supabase/migrations/YYYYMMDDHHMMSS_cloud_schema_baseline_v2.sql`
- Create: `supabase/migrations/YYYYMMDDHHMMSS_perf02_query_indexes.sql`
- Create: `lib/__tests__/supabaseCloudBaselineMigration.test.ts`
- Create: `lib/__tests__/setupMigrationArchive.ts`
- Create: `vitest.config.ts`
- Modify: `lib/__tests__/perf02QueryIndexMigration.test.ts`

**Interfaces:**
- Consumes: frozen production schema, Task 3 evidence, and PERF02 SQL from commit `4f154ef`.
- Produces: one production-equivalent baseline and one known pending migration.

- [x] **Step 1: Write failing baseline contract test**

Assert exactly one `_cloud_schema_baseline_v2.sql` exists and it creates `public`, `app_private`, and `private`; does not create managed schemas; contains RLS, grants, managed-schema application DDL, and bootstrap markers; contains no production business inserts or secrets; and sorts before exactly one PERF02 migration.

- [x] **Step 2: Run focused test and confirm RED**

```bash
npm test -- --run lib/__tests__/supabaseCloudBaselineMigration.test.ts lib/__tests__/perf02QueryIndexMigration.test.ts
```

Expected: FAIL because the V2 baseline is absent.

- [x] **Step 3: Dump application-owned schemas**

```bash
pg_dump "$PRODUCTION_DB_URL" \
  --schema-only --no-owner --no-subscriptions \
  --schema=public --schema=app_private --schema=private \
  --file=supabase/baseline/2026-09-03/cloud_schema_before.sql
```

Render managed-schema application DDL and bootstrap configuration into separate evidence files. Scan all generated files for secrets and forbidden business-data statements.

- [x] **Step 4: Archive the active migration set**

Move every active SQL file to `supabase/migrations_archive/pre_baseline_20260903/` without deleting it. Confirm its path-normalized SHA-256 manifest matches `active_migrations_before.sha256`.

- [x] **Step 5: Preserve legacy migration contract tests**

Add a Vitest setup file based on the proven July archive resolver, extended to resolve string and file-URL reads and existence checks. It must redirect a missing path under `supabase/migrations` to the same basename under `supabase/migrations_archive/pre_baseline_20260903`, and merge archived names into string-mode `readdirSync` results. Add `vitest.config.ts` with:

```ts
test: {
  setupFiles: ['./lib/__tests__/setupMigrationArchive.ts'],
}
```

Run the full suite immediately after the archive move; failures caused by missing archived paths block baseline generation.

- [x] **Step 6: Create the baseline using Supabase CLI**

```bash
npx supabase migration new cloud_schema_baseline_v2
```

Populate the generated file in this order: transaction/session settings, application schema dump, managed-schema application DDL, bootstrap configuration, final marker comment. Do not copy the July baseline.

- [x] **Step 7: Recreate PERF02 after the baseline**

```bash
npx supabase migration new perf02_query_indexes
```

Copy the three reviewed concurrent index statements from commit `4f154ef`. Confirm the PERF02 version sorts after the baseline and remains non-transactional.

- [x] **Step 8: Write baseline marker**

Create `supabase/baseline/current.json` containing the generated baseline version/filename, archive path, archive manifest SHA-256, allowed post-baseline filename, and the prohibition of `--include-all`.

- [x] **Step 9: Verify candidate**

```bash
npm run check:supabase-migrations
npm test -- --run lib/__tests__/supabaseBaselineTooling.test.ts lib/__tests__/supabaseCloudBaselineMigration.test.ts lib/__tests__/perf02QueryIndexMigration.test.ts
npm run lint
npm test -- --run
npm run build
```

- [x] **Step 10: Commit candidate baseline**

```bash
git add supabase/migrations supabase/migrations_archive supabase/baseline lib/__tests__ scripts package.json .github/workflows/ci.yml
git commit -m "chore(db): establish Supabase Cloud baseline v2"
```

---

### Task 5: Validate On The Existing Empty Preview Database

**Files:**
- Create: `supabase/baseline/2026-09-03/preview_apply_output.txt`
- Create: `supabase/baseline/2026-09-03/schema_fingerprint_preview.json`
- Create: `supabase/baseline/2026-09-03/preview_validation_summary.json`

**Interfaces:**
- Consumes: candidate baseline and the in-memory `baseline-vioo` pooler connection.
- Produces: clean rebuild proof or an evidence-backed decision to replace the branch.

- [x] **Step 1: Confirm the preview is disposable and empty**

Recheck `with_data=false`, zero migration rows, and absence of `app_private`/`private`. Abort rather than cleaning a branch that contains application data.

- [x] **Step 2: Apply only baseline in one transaction**

```bash
psql "$PREVIEW_DB_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
  --file "supabase/migrations/$BASELINE_FILE"
```

Capture sanitized output. On failure, record the first SQLSTATE/object, fix the generator or supplemental SQL, and retry only after proving the failed transaction left no application schemas.

- [x] **Step 3: Compare structural fingerprints**

Compare normalized application objects, functions, policies, triggers, grants, and required configuration. Managed internals and environment-specific identifiers are excluded. Any application-owned mismatch blocks progress.

- [x] **Step 4: Run verification**

```bash
npm run check:supabase-migrations
npm run lint
npm test -- --run
npm run build
```

- [x] **Step 5: Decide branch reuse**

If the baseline applies and fingerprints match, retain `baseline-vioo` as manual candidate validation evidence. If it is not clean or cannot be trusted, delete only branch ID `057503dd-ee69-4ae8-aa0c-40b2b1a5019d` after rechecking its name/project/data flags, then create a new no-data branch.

- [x] **Step 6: Commit validation evidence**

```bash
git add supabase/baseline/2026-09-03
git commit -m "test(db): validate Cloud baseline rebuild"
```

---

### Task 6: Push Candidate And Validate Git/Cloud Integration

**Files:**
- Create: `supabase/baseline/2026-09-03/validation_summary.json`

**Interfaces:**
- Consumes: fully passing candidate commit.
- Produces: remote feature branch and preview deployment evidence for the exact Git commit.

- [x] **Step 1: Push only the baseline feature branch**

```bash
git push -u origin chore/supabase-cloud-baseline-20260903
```

- [x] **Step 2: Create or update a no-data preview branch tied to the pushed Git branch**

Use the Management API/CLI workflow discovered through `--help`. Confirm metadata reports `with_data=false` and the expected Git branch before waiting for migration completion.

- [x] **Step 3: Poll status safely**

Poll at intervals shorter than 60 seconds. Success requires a healthy preview project and successful migrations. On failure, capture sanitized evidence and do not merge.

- [x] **Step 4: Re-run fingerprints and tests**

Confirm the integration-created branch matches production application objects and records only the baseline. PERF02 remains pending during baseline validation.

- [x] **Step 5: Commit validation summary**

```bash
git add supabase/baseline/2026-09-03/validation_summary.json
git commit -m "docs(db): record baseline integration validation"
git push
```

---

### Task 7: Merge Gate Into `origin/main`

**Files:**
- Use: all committed baseline artifacts.

**Interfaces:**
- Consumes: validated feature branch head.
- Produces: canonical main commit containing the archive and baseline before production repair.

- [x] **Step 1: Reconfirm freeze and fast-forward condition**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
```

Expected: exit zero. If main advanced, integrate it, rerun repository checks and preview validation, and never force-push main.

- [x] **Step 2: Push validated commit to main**

```bash
git push origin HEAD:main
```

Expected: fast-forward only.

- [x] **Step 3: Prove merge completeness**

Fetch main and verify it contains the candidate commit, exactly two active migrations, the archive manifest, evidence, rollback preparation, and CI guard. Run the guard against the exact `origin/main` tree.

---

### Task 8: Repair Production Migration History

**Files:**
- Create: `supabase/baseline/2026-09-03/repair_remote_to_baseline.sh`
- Create: `supabase/baseline/2026-09-03/rollback_history.sh`
- Create: `supabase/baseline/2026-09-03/migration_list_after_repair.txt`
- Create: `supabase/baseline/2026-09-03/db_push_dry_run_after_repair.txt`
- Create: `supabase/baseline/2026-09-03/schema_fingerprint_after.json`
- Create: `supabase/baseline/2026-09-03/production_cutover_summary.json`

**Interfaces:**
- Consumes: captured 151 versions, baseline on `origin/main`, and unchanged production fingerprint.
- Produces: production ledger containing only the new baseline with an unchanged production schema.

- [x] **Step 1: Generate guarded forward and rollback scripts**

Both scripts assert project ref `ftciqmqhmfvjtwoycswe`, expected pre-cut history checksum, expected baseline filename, and containment of the baseline commit in `origin/main`. Forward repair marks exactly the captured versions reverted and the baseline applied. Rollback removes the baseline metadata and restores exactly the captured versions.

- [x] **Step 2: Run final read-only production gate**

Recompute history and schema fingerprints. Abort if either differs from Task 3 evidence. Confirm no migration deployment is active.

- [x] **Step 3: Execute supported migration repair**

Run the guarded forward script with Supabase CLI. Do not execute baseline SQL against production and do not use `--include-all`.

- [x] **Step 4: Verify immediately**

```bash
npx supabase migration list --linked --agent=no
npx supabase db push --linked --dry-run --agent=no
```

Expected: baseline appears on both sides and only PERF02 is pending. If anything differs, run `rollback_history.sh` while the freeze remains active.

- [x] **Step 5: Prove production schema did not change**

Recompute normalized schema fingerprint and configuration counts. They must match the pre-cut evidence exactly.

- [x] **Step 6: Commit and push cutover evidence**

```bash
git add supabase/baseline/2026-09-03
git commit -m "docs(db): record production baseline cutover"
git push origin HEAD:main
```

---

### Task 9: Final Verification And Handoff

**Files:**
- Modify: `supabase/baseline/2026-09-03/README.md`
- Modify: `docs/superpowers/plans/2026-09-03-supabase-cloud-migration-baseline-v2.md`

**Interfaces:**
- Consumes: repaired production history and unchanged production schema.
- Produces: operational handoff for future migrations.

- [x] **Step 1: Run full verification from current main**

```bash
git fetch origin main
git merge-base --is-ancestor HEAD origin/main
npm run check:supabase-migrations
npm run lint
npm test -- --run
npm run build
```

- [x] **Step 2: Run final Cloud checks**

Confirm production is healthy, migration list is aligned at the baseline, dry-run lists only PERF02, advisors contain no newly introduced finding, and preview validation is recorded.

- [x] **Step 3: Document operating rule**

Record that every future Cloud schema change must be a CLI-generated migration merged to main before one designated writer deploys it. Direct Dashboard SQL must be followed immediately by a captured migration and narrow history repair.

- [x] **Step 4: Mark completed steps and commit handoff**

```bash
git add docs/superpowers/plans/2026-09-03-supabase-cloud-migration-baseline-v2.md supabase/baseline/2026-09-03/README.md
git commit -m "docs(db): complete migration baseline handoff"
git push origin HEAD:main
```

---

### Task 10: Complete PERF02 And Stabilize The Git Runner

**Files:**
- Create: `supabase/baseline/2026-09-03/perf02_production_completion_output.txt`
- Create: `supabase/baseline/2026-09-03/perf02_production_completion_summary.json`
- Create: `supabase/baseline/2026-09-03/migration_list_after_perf02.txt`
- Create: `supabase/baseline/2026-09-03/db_push_dry_run_after_perf02.txt`
- Create: `supabase/baseline/2026-09-03/schema_fingerprint_after_perf02.json`
- Create: `supabase/baseline/2026-09-03/cloud_configuration_after_perf02.json`
- Modify: `supabase/baseline/2026-09-03/README.md`

**Reason:** Later pushes to `main` caused the Git-linked Cloud runner to retry
the deliberately pending non-transactional PERF02 migration. It partially
created the indexes but could not complete the migration or ledger update.
Leaving that state pending would make every later `main` push unsafe.

- [x] **Step 1: Inspect production before recovery**

Confirm the ledger still contains only the baseline, no long transaction is
active, and identify the exact validity/readiness of all three PERF02 indexes.

- [x] **Step 2: Complete only the reviewed PERF02 indexes**

Run the reviewed migration in standalone `psql`. Because `IF NOT EXISTS`
correctly avoids duplicate names but cannot repair invalid indexes, rebuild the
two invalid indexes individually with `REINDEX INDEX CONCURRENTLY`.

- [x] **Step 3: Verify objects before repairing history**

Require all three expected definitions to exist with `indisvalid=true` and
`indisready=true`. Do not repair history if any check fails.

- [x] **Step 4: Repair only PERF02 and compare state**

Mark only `20260903063821` applied. Require local/remote migration alignment,
an empty dry run, exactly three added fingerprint objects, zero removed
objects, unchanged configuration, and five active Cron jobs.

- [ ] **Step 5: Commit, push, and verify the final Cloud runner state**

Push the evidence to the feature branch and then fast-forward `main`. Confirm
the latest Git-linked migration action no longer retries PERF02 and finish the
full repository and Cloud verification suite.

## Stop Conditions

Stop without production repair when any of these occurs:

- Production history or schema changes after evidence capture.
- Any pending migration other than PERF02 cannot be classified.
- The baseline cannot build an empty Cloud database in one transaction.
- Application-owned fingerprints differ between production and preview.
- Secrets or production business rows appear in generated artifacts.
- The validated commit is not contained in `origin/main`.
- Dry-run after repair lists a historical migration or requires `--include-all`.
- The rollback script cannot restore the exact pre-cut history set.
