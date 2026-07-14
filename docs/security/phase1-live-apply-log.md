# Phase 1 Permission Framework Apply Log

Date: 2026-07-12

## Status

- Repo implementation: prepared.
- Live apply: applied directly with `db query --linked -f`.
- Migration history: not reconciled. Phase 0 and Phase 1 were applied by direct query, so `db push` must still be avoided until history is reconciled.

## Verification Completed

### Frontend tests

- Command: `npm test -- lib/__tests__/permissionRegistry.test.ts lib/__tests__/permissionService.test.ts lib/__tests__/permissionRouteRegistry.test.ts lib/__tests__/routeAccess.test.ts`
- Result: passed, 4 files / 21 tests.

### Typecheck

- Command: `npm run lint`
- Result: passed (`tsc`).

### Transactional Supabase dry check

- Command summary: built `/tmp/vioo-phase1-permission-framework-transaction.sql` with `BEGIN;`, the Phase 1 migration, the Phase 1 smoke SQL, then `ROLLBACK;`, and executed it with `npx supabase db query --linked -f`.
- Result: passed.
- Live DB change: none expected because the transaction ended with `ROLLBACK`.

## Live Apply

### Direct apply

- Command: `npx supabase db query --linked -f supabase/migrations/20260712071535_phase1_permission_framework.sql`
- Result: passed, exit 0.
- Output summary: query returned no rows and no SQL error.

### Post-apply smoke

- Command: `npx supabase db query --linked -f supabase/tests/phase1_permission_framework_smoke.sql`
- Result: passed, exit 0.
- Verified:
  - permission framework tables exist,
  - RLS is enabled on new permission tables,
  - `anon` has no privileges on the new permission tables,
  - `app_private.has_permission`, `app_private.has_any_permission`, `app_private.can_manage_permissions`, and `public.replace_user_permission_grants` exist,
  - active scoped grant works,
  - wrong-scope, expired, and inactive grants do not work,
  - non-admin RPC/direct grant mutation is rejected.

### Migration history check

- Command: `npx supabase migration list --linked`
- Result: command passed.
- Important observation: `20260712071535` appears as local-only because direct `db query` does not write Supabase migration history. This is expected for this rollout path.
