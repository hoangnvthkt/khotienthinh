# Phase 0 Live Apply Log

Scope: repo + linked Supabase project.

Rules:

- Do not paste `.env` values, JWTs, passwords, or user data.
- Keep `/tmp/vioo-phase0-schema-before.sql` outside git until verification is complete.
- If live push fails, inspect and forward-fix by migration; do not manually patch live DB outside migration without approval.

## Command Log

### 2026-07-12 11:30 +07 - Preflight

- `git status --short`: working tree already had untracked `docs/security/` docs from the audit/roadmap work; no unrelated tracked file edits were present.
- `npx supabase --version`: `2.109.0`.
- `npx supabase migration list --linked`: succeeded, but linked history is not clean. There are many local-only and remote-only migrations, so live `db push` must stop unless dry-run proves only the new Phase 0 migration would be applied.
- `npx supabase db dump --linked --schema public,app_private --file /tmp/vioo-phase0-schema-before.sql`: failed before creating the schema dump because the CLI requires Docker Desktop for `db dump` and Docker is not available/running in this environment.
- Removed the empty `/tmp/vioo-phase0-schema-before.sql` file left by the failed dump attempt; no valid schema backup currently exists.
- `npx supabase db query --linked -f supabase/tests/phase0_permission_snapshot.sql`: succeeded after changing the snapshot to one result set. Snapshot shows the expected pre-containment exposure: broad project/workgroup policies using `auth.role()` with `anon`/`authenticated`, `quality_module_all` policies, `users_update`, and no Phase 0 private helper/trigger yet.
- `npx supabase db dump --linked --schema public,app_private --dry-run`: succeeded but printed connection details, so command output is intentionally not copied here. It confirms the CLI would use `pg_dump`, which is not installed locally and cannot be run through Docker in this environment.

### 2026-07-12 11:31 +07 - Red Checks

- `npm test -- lib/__tests__/routeAccess.test.ts`: failed as expected on three Phase 0 assertions: `/trace` missing `AUDIT_TRAIL` mapping, `/hd` missing `HD` mapping, and unknown protected route still allowed.
- `npx supabase db query --linked -f supabase/tests/phase0_permission_containment_smoke.sql`: failed as expected with `phase0 smoke failed: anon still has write grants on affected tables`.

### 2026-07-12 11:32 +07 - Route Guard Containment

- `npm test -- lib/__tests__/routeAccess.test.ts`: passed, 10 tests.
- `npm run lint`: passed (`tsc`).

### 2026-07-12 11:33 +07 - Migration Checks

- `npx supabase migration new phase0_permission_containment`: created `supabase/migrations/20260712043246_phase0_permission_containment.sql`.
- `npx supabase db push --linked --dry-run`: failed before SQL execution because remote migration versions are missing from the local migrations directory. Live push is blocked; applying now would require migration-history reconciliation first.
- `npx supabase db lint --linked --schema public,app_private --fail-on error`: failed on pre-existing live DB function errors unrelated to the Phase 0 migration, including AI/project/material-request helper functions referencing missing columns or mismatched uuid/text operators. These findings were present before Phase 0 SQL was applied.
- Transactional SQL syntax check with `BEGIN; <phase0 migration>; ROLLBACK;` through `npx supabase db query --linked`: passed with no committed changes.
- Transactional containment check with `BEGIN; <phase0 migration>; <phase0 smoke>; ROLLBACK;`: passed. This proves the migration makes the smoke checks pass without committing to live DB.
- Direct smoke re-check after rollback: still failed on `anon` write grants, confirming live DB was not changed.
- `npm run lint`: passed (`tsc`).

### 2026-07-12 11:36 +07 - Final Verification Before Hand-off

- `npm test -- lib/__tests__/routeAccess.test.ts`: passed, 10 tests.
- `npm run lint`: passed (`tsc`).
- Transactional containment check with `BEGIN; <phase0 migration>; <phase0 smoke>; ROLLBACK;`: passed again with no committed changes.
- `npx supabase db push --linked --dry-run`: still blocked on remote migration versions missing locally.

## Live Apply Status

Applied directly with `supabase db query --linked`, not `db push`.

### 2026-07-12 13:55 +07 - Direct Query Apply

- User explicitly requested applying Phase 0 to Supabase Cloud using query link and not `db push`.
- Pre-apply `npx supabase db query --linked -f supabase/tests/phase0_permission_containment_smoke.sql`: failed as expected on `anon` write grants.
- Apply command: `npx supabase db query --linked -f supabase/migrations/20260712043246_phase0_permission_containment.sql`: succeeded with exit code 0.
- Post-apply smoke: `npx supabase db query --linked -f supabase/tests/phase0_permission_containment_smoke.sql`: passed.
- Post-apply snapshot: `npx supabase db query --linked -f supabase/tests/phase0_permission_snapshot.sql`: succeeded. Snapshot shows Phase 0 helper functions, `users_update_admin`, `users_update_self_profile`, and `trg_users_prevent_privilege_self_update`.
- Summary verification query:
  - `anon_write_grants_affected = 0`
  - `broad_project_workgroup_policies = 0`
  - `quality_module_all_policies = 0`
  - `legacy_users_update_policies = 0`
  - `phase0_trigger_count = 1`
  - `can_access_module_count = 1`
  - `migration_history_count = 0`
- `migration_history_count = 0` is expected for this apply method: `db query` executes SQL directly and does not record `20260712043246` in `supabase_migrations.schema_migrations`.
- `npm test -- lib/__tests__/routeAccess.test.ts`: passed, 10 tests.
- `npm run lint`: passed (`tsc`).

Residual note:

- Required schema backup `/tmp/vioo-phase0-schema-before.sql` was still not created because Docker and local `pg_dump` are unavailable in this environment.
- Linked migration history remains out of sync for normal `db push`; future migration rollout should reconcile remote/local migration history before returning to `db push`.
