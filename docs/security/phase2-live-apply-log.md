# Phase 2 Live Apply Log

Phase: Project PBAC v2 Foundation

Rollout mode: direct query with `npx supabase db query --linked -f`, not `db push`.

Migration file: `supabase/migrations/20260712075649_phase2_project_pbac_v2_foundation.sql`

Smoke file: `supabase/tests/phase2_project_pbac_v2_smoke.sql`

Migration history note: Phase 0 and Phase 1 were applied by direct query, so linked migration history may remain unreconciled. Do not use `db push` unless history is reconciled first.

## Preflight

- Status: completed on 2026-07-12
- `npx supabase --version`: `2.109.0`
- `npx supabase migration list --linked`: succeeded. Phase 2 migration `20260712075649` remains local-only because rollout uses direct query. Existing migration history is still unreconciled.

## Transactional Dry Check

- Status: passed
- Command shape: `BEGIN; <phase2 migration>; <phase2 smoke>; ROLLBACK;`
- Result: `npx supabase db query --linked -f /tmp/vioo-phase2-project-pbac-v2-dry-run.sql` exited `0`.
- Notes:
  - First dry attempts caught smoke assumptions about `public.projects.id/source`; smoke was corrected to match live schema.
  - Final dry check ran migration plus smoke in one transaction and rolled back.

## Live Apply

- Status: applied
- Command shape: `npx supabase db query --linked -f supabase/migrations/20260712075649_phase2_project_pbac_v2_foundation.sql`
- Result: exited `0`, rows `[]`.
- Migration history note: direct-query apply does not create a Supabase migration history row.

## Post-Apply Smoke

- Status: passed
- Command shape: `npx supabase db query --linked -f supabase/tests/phase2_project_pbac_v2_smoke.sql`
- Result: exited `0`.
- Assertions covered:
  - Full Project PBAC v2 module/action seed exists.
  - `app_private.has_explicit_permission`, `app_private.project_has_permission_v2`, and `public.replace_project_staff_permission_grants` exist.
  - `anon` has no direct privileges on permission metadata/grant tables checked by smoke.
  - Project-scoped `daily_log.view` works only for matching project.
  - `daily_log.view/create` does not imply `daily_log.approve`.
  - Expired grant does not pass.
  - RPC syncs namespace grants back to legacy `project_staff_permissions`.
  - Non-admin RPC mutation and direct grant insert are rejected.

## App Verification

- Status: passed
- `npm test -- lib/__tests__/permissionRegistry.test.ts lib/__tests__/permissionService.test.ts lib/__tests__/projectPermissionService.test.ts lib/__tests__/permissionRouteRegistry.test.ts lib/__tests__/routeAccess.test.ts`: 5 files, 29 tests passed.
- `npm test`: 45 files, 256 tests passed.
- `npm run lint`: `tsc` exited `0`.
