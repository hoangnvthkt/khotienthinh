# VIOO Unified Permission Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the fragmented legacy visibility, legacy administration, and Direct Grant editors with one source-aware permission workflow whose View master control, preview, and save behavior are explicit and atomic.

**Architecture:** A pure TypeScript view model owns readiness, effective-source presentation, Legacy visibility state, and View/action draft transitions. A reusable React editor consumes that model in both user administration and authorization governance. A governed Supabase command previews and atomically applies Legacy permission fields plus Direct Grants with a stale-state fingerprint; it reuses the existing Phase 2 Direct Grant/SoD implementation and never changes rollout flags.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase/Postgres PL/pgSQL, existing Tailwind utility classes, Supabase CLI 2.95.6.

## Global Constraints

- The approved design is docs/superpowers/specs/2026-07-18-vioo-unified-permission-matrix-design.md.
- Do not use --linked; do not run supabase db push, deploy an Edge Function, mutate Cloud data, or change migration history.
- Do not call set_authorization_rollout_flags; all authorization rollout flags remain unchanged.
- Do not resume or alter the paused sensitive Direct Grant regrant Task 4.
- Preserve the user-owned unstaged changes in docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md.
- Route visibility never substitutes for an exact backend action check.
- Adding an action may add compatible View; removing View removes editable Direct actions in that permission module and scope, but never pretends to remove Role-derived access.
- New generic Legacy administration cannot be granted from the unified editor; an existing Legacy umbrella may only be retained or revoked.
- Only Enforced or Verified actions may be newly granted. Existing Direct Grants with lower readiness remain visible and revocable.
- The first Verified pilot is Project Daily Log. Other action families remain Declared until bounded enforcement plans record their evidence.
- The browser never supplies actor identity. The database resolves the actor from the authenticated session.
- Every security-definer function uses an empty search path, schema-qualified relations, least-privilege grants, short row-lock transactions, and deterministic lock ordering.
- Preview is read-only. Save revalidates the same proposal in one transaction and rejects stale state.
- Follow the official Supabase function and local-test guidance:
  - https://supabase.com/docs/guides/database/functions
  - https://supabase.com/docs/guides/local-development/testing/overview

## Scope Split

This plan delivers the first locally testable increment and its migration artifact. It does not apply that migration to Cloud and does not declare every registry action production-ready.

Separate follow-on plans are required for:

1. bounded enforcement/readiness waves for ERP and remaining Project modules;
2. per-user/module/scope Legacy source-mode cutover;
3. Cloud migration application, canaries, rollback evidence, and production rollout.

## File Structure

**Create**

- lib/permissions/permissionReadiness.ts — explicit action readiness and grantability.
- lib/permissions/unifiedPermissionViewModel.ts — source rows, reducers, Legacy draft, diff, and preview key.
- components/permissions/UnifiedPermissionMatrix.tsx — reusable application/module/action editor.
- components/permissions/PermissionChangeSummary.tsx — human-readable Direct and Legacy diff.
- lib/__tests__/permissionReadiness.test.ts — readiness contracts.
- lib/__tests__/unifiedPermissionViewModel.test.ts — View, scope, source, Legacy, and stale-key tests.
- lib/__tests__/unifiedPermissionMatrix.test.tsx — server-rendered UI contracts.
- supabase/tests/unified_permission_change_command_smoke.sql — local privilege, atomicity, stale-write, and SoD smoke.
- docs/security/unified-permission-matrix-manual-checklist.md — bounded manual verification sheet.
- The migration path captured in the MIGRATION_FILE shell variable by Task 4 Step 1 — created by the required CLI command, never invented or renamed.

**Modify**

- lib/permissions/permissionTypes.ts
- lib/permissions/authorizationGovernanceTypes.ts
- lib/permissions/permissionAdminService.ts
- components/permissions/PrincipalDirectGrantPanel.tsx
- components/permissions/SodWarningPanel.tsx
- components/UserModal.tsx
- context/AppContext.tsx
- pages/UserManagement.tsx
- pages/Settings.tsx
- pages/settings/SettingsUsers.tsx
- lib/__tests__/authorizationGovernanceService.test.ts
- lib/__tests__/authorizationAdminUiContract.test.ts
- lib/__tests__/permissionRegistry.test.ts

**Delete after import search is empty**

- components/permissions/PermissionMatrix.tsx
- components/permissions/PermissionDiffPreview.tsx

---

### Task 1: Add explicit action-readiness evidence

**Files:**

- Create: lib/permissions/permissionReadiness.ts
- Create: lib/__tests__/permissionReadiness.test.ts
- Modify: lib/permissions/permissionTypes.ts:15
- Modify: lib/__tests__/permissionRegistry.test.ts:33

**Interfaces:**

- Produces: PermissionActionReadiness, resolvePermissionActionReadiness(action), canAddDirectGrant(action), and canRemoveDirectGrant(hasDirectGrant).
- Consumes: PermissionActionDefinition from the current registry.

- [ ] **Step 1: Write the failing readiness tests**

Create lib/__tests__/permissionReadiness.test.ts:

~~~ts
import { describe, expect, it } from 'vitest';
import { getPermissionActionByCode } from '../permissions/permissionRegistry';
import {
  canAddDirectGrant,
  canRemoveDirectGrant,
  resolvePermissionActionReadiness,
} from '../permissions/permissionReadiness';

const action = (code: string) => {
  const found = getPermissionActionByCode(code);
  if (!found) throw new Error('Missing fixture ' + code);
  return found;
};

describe('permission readiness', () => {
  it('marks only the bounded Daily Log evidence set as verified', () => {
    expect(resolvePermissionActionReadiness(action('project.daily_log.view'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.edit_own'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.submit'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.verify'))).toBe('verified');
    expect(resolvePermissionActionReadiness(action('project.daily_log.approve'))).toBe('verified');
  });

  it('does not promote unproven or umbrella actions from their names', () => {
    expect(resolvePermissionActionReadiness(action('project.daily_log.confirm'))).toBe('declared');
    expect(resolvePermissionActionReadiness(action('project.daily_log.manage'))).toBe('legacy');
    expect(resolvePermissionActionReadiness(action('system.wms.manage'))).toBe('legacy');
  });

  it('adds only verified/enforced grants but permits existing Direct revocation', () => {
    expect(canAddDirectGrant(action('project.daily_log.edit_own'))).toBe(true);
    expect(canAddDirectGrant(action('project.daily_log.confirm'))).toBe(false);
    expect(canRemoveDirectGrant(true)).toBe(true);
    expect(canRemoveDirectGrant(false)).toBe(false);
  });
});
~~~

- [ ] **Step 2: Run the test and verify the missing-module failure**

~~~bash
npm test -- lib/__tests__/permissionReadiness.test.ts
~~~

Expected: FAIL because the readiness module/type does not exist.

- [ ] **Step 3: Add the readiness type and evidence registry**

Add to permissionTypes.ts:

~~~ts
export type PermissionActionReadiness = 'legacy' | 'declared' | 'enforced' | 'verified';
~~~

Create permissionReadiness.ts:

~~~ts
import type { PermissionActionDefinition, PermissionActionReadiness } from './permissionTypes';

const VERIFIED_PERMISSION_CODES = new Set([
  'project.daily_log.view',
  'project.daily_log.create',
  'project.daily_log.edit_own',
  'project.daily_log.edit_all',
  'project.daily_log.delete_own',
  'project.daily_log.delete_all',
  'project.daily_log.submit',
  'project.daily_log.return',
  'project.daily_log.verify',
  'project.daily_log.approve',
  'project.daily_log.summarize',
]);

const ENFORCED_PERMISSION_CODES = new Set<string>();

export const resolvePermissionActionReadiness = (
  action: PermissionActionDefinition,
): PermissionActionReadiness => {
  if (VERIFIED_PERMISSION_CODES.has(action.permissionCode)) return 'verified';
  if (ENFORCED_PERMISSION_CODES.has(action.permissionCode)) return 'enforced';
  if (action.action === 'manage' && action.legacyAdminOnly !== false) return 'legacy';
  return 'declared';
};

export const canAddDirectGrant = (action: PermissionActionDefinition): boolean =>
  ['enforced', 'verified'].includes(resolvePermissionActionReadiness(action));

export const canRemoveDirectGrant = (hasDirectGrant: boolean): boolean => hasDirectGrant;
~~~

Add a registry test that loops over getAllPermissionActions() and asserts one of the four readiness values.

- [ ] **Step 4: Run focused tests**

~~~bash
npm test -- lib/__tests__/permissionReadiness.test.ts lib/__tests__/permissionRegistry.test.ts lib/__tests__/dailyLogPermissions.phase3.test.ts lib/__tests__/projectPermissionService.test.ts
npx supabase test db supabase/tests/phase3_daily_log_permissions_smoke.sql --local
~~~

Expected: TypeScript/Vitest evidence and the existing Daily Log positive/adjacent-negative SQL smoke all PASS before the codes are accepted as Verified.

- [ ] **Step 5: Commit**

~~~bash
git add lib/permissions/permissionTypes.ts lib/permissions/permissionReadiness.ts lib/__tests__/permissionReadiness.test.ts lib/__tests__/permissionRegistry.test.ts
git commit -m "feat(authz): classify permission action readiness"
~~~

---

### Task 2: Build the source-aware View-master reducer

**Files:**

- Create: lib/permissions/unifiedPermissionViewModel.ts
- Create: lib/__tests__/unifiedPermissionViewModel.test.ts
- Modify: lib/permissions/permissionTypes.ts

**Interfaces:**

- Consumes: PermissionModuleDefinition, PermissionScope, UserPermissionGrant, EffectivePermissionSource, and Task 1 helpers.
- Produces: LegacyPermissionState in permissionTypes.ts plus UnifiedPermissionActionRow, buildUnifiedPermissionRows, toggleUnifiedDirectGrant, and buildUnifiedPermissionDraftKey in the view model.

- [ ] **Step 1: Write failing reducer tests**

Create fixtures for project.daily_log and project-1, then assert:

~~~ts
it('adds View in the same scope when Edit is granted', () => {
  const next = toggleUnifiedDirectGrant({
    module: dailyLog,
    grants: [],
    targetUserId: 'user-1',
    permissionCode: 'project.daily_log.edit_own',
    checked: true,
    scope: { scopeType: 'project', scopeId: 'project-1' },
  });
  expect(next.map(item => item.permissionCode).sort()).toEqual([
    'project.daily_log.edit_own',
    'project.daily_log.view',
  ]);
  expect(next.every(item => item.scopeType === 'project' && item.scopeId === 'project-1')).toBe(true);
});

it('clearing View removes only same-module same-scope Direct actions', () => {
  const next = toggleUnifiedDirectGrant({
    module: dailyLog,
    grants: [
      { userId: 'user-1', permissionCode: 'project.daily_log.view', scopeType: 'project', scopeId: 'project-1' },
      { userId: 'user-1', permissionCode: 'project.daily_log.edit_own', scopeType: 'project', scopeId: 'project-1' },
      { userId: 'user-1', permissionCode: 'project.daily_log.edit_own', scopeType: 'project', scopeId: 'project-2' },
      { userId: 'user-1', permissionCode: 'project.material_request.view', scopeType: 'project', scopeId: 'project-1' },
    ],
    targetUserId: 'user-1',
    permissionCode: 'project.daily_log.view',
    checked: false,
    scope: { scopeType: 'project', scopeId: 'project-1' },
  });
  expect(next.map(item => item.permissionCode + ':' + item.scopeId).sort()).toEqual([
    'project.daily_log.edit_own:project-2',
    'project.material_request.view:project-1',
  ]);
});

it('refuses a new Declared action but permits removing an existing one', () => {
  const existing = {
    userId: 'user-1',
    permissionCode: 'project.daily_log.confirm',
    scopeType: 'project' as const,
    scopeId: 'project-1',
  };
  expect(toggleUnifiedDirectGrant({
    module: dailyLog, grants: [], targetUserId: 'user-1',
    permissionCode: existing.permissionCode, checked: true, scope,
  })).toEqual([]);
  expect(toggleUnifiedDirectGrant({
    module: dailyLog, grants: [existing], targetUserId: 'user-1',
    permissionCode: existing.permissionCode, checked: false, scope,
  })).toEqual([]);
});
~~~

Also test:

- inherited Role and Legacy set effective/source badges but not Direct;
- a global source covers a project navigation scope;
- the preview key changes with principal, nested Legacy route map, grant scope, and expiry.

- [ ] **Step 2: Run and verify missing exports**

~~~bash
npm test -- lib/__tests__/unifiedPermissionViewModel.test.ts
~~~

Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement exact view-model contracts**

Add LegacyPermissionState to permissionTypes.ts and define the row type in the view model:

~~~ts
export interface LegacyPermissionState {
  allowedModules: string[];
  allowedSubModules: Record<string, string[]>;
  adminModules: string[];
  adminSubModules: Record<string, string[]>;
}

export interface UnifiedPermissionActionRow {
  permissionCode: string;
  action: string;
  label: string;
  readiness: PermissionActionReadiness;
  hasDirectGrant: boolean;
  isEffective: boolean;
  sourceKinds: EffectivePermissionSourceType[];
  sourceBadges: ReturnType<typeof buildPermissionSourceBadges>;
  canAdd: boolean;
  canRemove: boolean;
  riskLevel: PermissionRiskLevel;
}
~~~

Implement exact-scope Direct matching, global-or-matching effective-source coverage, readiness-aware add, existing-Direct removal, View auto-add, and View removal across only the selected module/scope.

The reducer signature is:

~~~ts
export const toggleUnifiedDirectGrant = (input: {
  module: PermissionModuleDefinition;
  grants: readonly UserPermissionGrant[];
  targetUserId: string;
  permissionCode: string;
  checked: boolean;
  scope: PermissionScope;
}): UserPermissionGrant[];
~~~

Use a recursive, key-sorted JSON canonicalizer for buildUnifiedPermissionDraftKey; shallow JSON.stringify on nested route maps is not accepted.

- [ ] **Step 4: Run tests and commit**

~~~bash
npm test -- lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/permissionReadiness.test.ts
git add lib/permissions/unifiedPermissionViewModel.ts lib/__tests__/unifiedPermissionViewModel.test.ts
git commit -m "feat(authz): add view master permission reducer"
~~~

Expected: tests PASS and commit succeeds.

---

### Task 3: Add deterministic Legacy visibility and umbrella reducers

**Files:**

- Modify: lib/permissions/unifiedPermissionViewModel.ts
- Modify: lib/__tests__/unifiedPermissionViewModel.test.ts

**Interfaces:**

- Produces: LegacyPermissionCatalogEntry, buildLegacyPermissionCatalog, isLegacyRouteVisible, toggleLegacyModuleView, toggleLegacyRouteView, and revokeLegacyUmbrella.
- Consumes: permission registry routes, ROUTE_TO_MODULE, Project tab routes, and Settings feature tokens.

- [ ] **Step 1: Add failing Legacy reducer tests**

~~~ts
it('treats a missing allowedSubModules key as all known routes', () => {
  const state = { allowedModules: ['WMS'], allowedSubModules: {}, adminModules: [], adminSubModules: {} };
  expect(isLegacyRouteVisible(state, 'WMS', '/requests')).toBe(true);
});

it('removes one route by materializing the remaining known routes', () => {
  const state = { allowedModules: ['WMS'], allowedSubModules: {}, adminModules: [], adminSubModules: {} };
  expect(toggleLegacyRouteView(state, 'WMS', '/requests', false, ['/requests', '/inventory'])).toEqual({
    ...state,
    allowedSubModules: { WMS: ['/inventory'] },
  });
});

it('clearing module View also revokes its Legacy administration umbrella', () => {
  const state = {
    allowedModules: ['WMS'],
    allowedSubModules: {},
    adminModules: ['WMS'],
    adminSubModules: { WMS: ['/requests'] },
  };
  expect(toggleLegacyModuleView(state, 'WMS', false)).toEqual({
    allowedModules: [],
    allowedSubModules: {},
    adminModules: [],
    adminSubModules: {},
  });
});
~~~

- [ ] **Step 2: Run and verify missing functions**

~~~bash
npm test -- lib/__tests__/unifiedPermissionViewModel.test.ts
~~~

Expected: FAIL on the Legacy exports.

- [ ] **Step 3: Implement Legacy semantics**

Implement these rules exactly:

- missing allowedSubModules[module] means all known routes;
- explicit empty array means none;
- selecting every route deletes the map key to preserve the existing all-routes encoding;
- clearing module View removes allowed module, route restrictions, admin module, and admin routes;
- revokeLegacyUmbrella only removes current admin entries; there is no add function;
- arrays and route keys are deduplicated and sorted.

Build LegacyPermissionCatalogEntry values from getPermissionModules(), each module routes array, each action legacyRoute, and ROUTE_TO_MODULE fallbacks. Deduplicate by legacy module key plus route. Import Project tab and Settings feature labels without importing React icons.

- [ ] **Step 4: Run tests and commit**

~~~bash
npm test -- lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/permissionRegistry.test.ts
git add lib/permissions/unifiedPermissionViewModel.ts lib/__tests__/unifiedPermissionViewModel.test.ts
git commit -m "feat(authz): model legacy visibility in unified drafts"
~~~

Expected: PASS.

---

### Task 4: Add the transactional Supabase Preview/Apply command locally

**Files:**

- Create via CLI: the exact path printed into MIGRATION_FILE by Step 1
- Create: supabase/tests/unified_permission_change_command_smoke.sql
- Modify through the migration: latest definition of app_private.prevent_users_privilege_self_update()

**Interfaces:**

- Produces private security-definer implementation app_private.preview_user_permission_change_impl(uuid,jsonb,jsonb) and public security-invoker RPC public.preview_user_permission_change(uuid,jsonb,jsonb).
- Produces private security-definer implementation app_private.apply_user_permission_change_impl(uuid,text,jsonb,jsonb,text,jsonb) and public security-invoker RPC public.apply_user_permission_change(uuid,text,jsonb,jsonb,text,jsonb).
- Reuses app_private.evaluate_direct_grant_replacement_impl and app_private.replace_user_permission_grants_v2_impl.
- Returns JSON fields beforeFingerprint, afterFingerprint, decision, legacyBefore, legacyAfter, and directAfter.

- [ ] **Step 1: Generate the migration with the installed CLI**

~~~bash
npx supabase migration new unified_permission_change_command
MIGRATION_FILE="$(ls -1t supabase/migrations/*_unified_permission_change_command.sql | head -n 1)"
test -n "$MIGRATION_FILE"
echo "$MIGRATION_FILE"
~~~

Expected: one new path. Use it for every remaining Task 4 edit. Do not rename or apply it remotely.

- [ ] **Step 2: Write the failing SQL smoke**

Create a BEGIN/ROLLBACK smoke using randomized Permission Admin, Auditor, and target fixtures. Assert:

1. both public functions exist;
2. anon cannot execute Save and authenticated cannot execute private helpers;
3. Preview is read-only and returns a non-empty fingerprint;
4. Apply changes WMS visibility and Daily Log View/Edit in one transaction;
   the applied Legacy state equals Preview legacyAfter and the returned afterFingerprint differs from beforeFingerprint;
5. reuse of an old fingerprint raises SQLSTATE 40001;
6. adding Legacy adminModules/adminSubModules raises SQLSTATE 42501;
7. self-directed Legacy change is denied;
8. invalid Direct code rolls back the Legacy update;
9. warning/hard-deny behavior still comes from the existing typed SoD engine;
10. a new Declared grant is denied, while an already-active Declared grant may be retained or revoked;
11. legacy_projection_enabled and all Phase 2 flags remain unchanged.

- [ ] **Step 3: Run and confirm missing functions**

~~~bash
npx supabase test db supabase/tests/unified_permission_change_command_smoke.sql --local
~~~

Expected: FAIL because the functions do not exist.

- [ ] **Step 4: Add server readiness metadata and private normalization/fingerprint helpers**

Add permission_actions.grant_readiness as text NOT NULL DEFAULT 'declared', with an idempotently-created check constraint limiting values to legacy, declared, enforced, and verified. Set generic legacy-admin-only manage actions to legacy. Set exactly the Task 1 Daily Log evidence codes to verified. Do not mark confirm or manage verified.

~~~sql
alter table public.permission_actions
  add column if not exists grant_readiness text not null default 'declared';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'permission_actions_grant_readiness_check'
      and conrelid = 'public.permission_actions'::regclass
  ) then
    alter table public.permission_actions
      add constraint permission_actions_grant_readiness_check
      check (grant_readiness in ('legacy','declared','enforced','verified'));
  end if;
end;
$$;

update public.permission_actions
set grant_readiness = 'legacy', updated_at = now()
where action = 'manage' and legacy_admin_only;

update public.permission_actions
set grant_readiness = 'verified', updated_at = now()
where permission_code = any(array[
  'project.daily_log.view',
  'project.daily_log.create',
  'project.daily_log.edit_own',
  'project.daily_log.edit_all',
  'project.daily_log.delete_own',
  'project.daily_log.delete_all',
  'project.daily_log.submit',
  'project.daily_log.return',
  'project.daily_log.verify',
  'project.daily_log.approve',
  'project.daily_log.summarize'
]::text[]);
~~~

The new unified Preview and Apply functions reject a proposed Direct key that is not already active when its server readiness is not enforced/verified. They still allow an existing Declared/Legacy Direct key to remain or be revoked. Do not add this restriction to replace_user_permission_grants_v2_impl in this increment, because the paused approved regrant workflow still uses that compatibility command.

Create exact signatures:

~~~sql
create or replace function app_private.normalize_legacy_permission_state(p_state jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = '';

create or replace function app_private.user_permission_state_fingerprint(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = '';
~~~

Normalization must:

- require allowedModules/adminModules arrays of strings;
- require allowedSubModules/adminSubModules objects with string-array values;
- trim, deduplicate, and sort all arrays;
- preserve absent-key versus explicit-empty-array semantics;
- reject more than 100 modules or 1,000 routes with SQLSTATE 22023.

Fingerprint must use canonical Legacy state plus active, non-expired Direct Grants ordered by permission code, scope type, scope ID, and expiry. Use md5 only as a concurrency token. Revoke all private-helper execution from public, anon, and authenticated.

- [ ] **Step 5: Implement read-only Preview**

Create the private implementation:

~~~sql
create or replace function app_private.preview_user_permission_change_impl(
  p_user_id uuid,
  p_legacy_state jsonb,
  p_grants jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = '';
~~~

Mandatory order:

1. assert system.authorization.manage_grants;
2. require active non-Admin target;
3. normalize proposal;
   when p_legacy_state is SQL null, use the target's current normalized Legacy state so a Direct-only caller preserves Legacy fields;
4. reject admin module/route additions not present in current state;
5. reject self-directed Legacy change;
6. call evaluate_direct_grant_replacement_impl;
7. reject newly-added Direct keys whose permission_actions.grant_readiness is not enforced/verified;
8. return fingerprint, decision, normalized before, and normalized after;
9. perform no writes.

Revoke the private implementation from public, anon, and authenticated. Add this public wrapper and grant only it to authenticated:

~~~sql
create or replace function public.preview_user_permission_change(
  p_user_id uuid,
  p_legacy_state jsonb,
  p_grants jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_user_permission_change_impl(
    p_user_id,
    p_legacy_state,
    p_grants
  );
$$;
~~~

- [ ] **Step 6: Extend the protected-user trigger narrowly**

Preserve current Supabase Auth Admin, lifecycle service-role, legacy Admin, and protected-field branches. After resolving current_user_id, add:

~~~sql
if coalesce(current_setting('app.authorization_permission_command', true), '') = 'on'
  and current_user_id is not null
  and app_private.has_permission(
    current_user_id,
    'system.authorization.manage_grants',
    'global',
    '*'
  )
then
  return new;
end if;
~~~

No public helper may set this context.

- [ ] **Step 7: Implement atomic Apply**

Create the private implementation:

~~~sql
create or replace function app_private.apply_user_permission_change_impl(
  p_user_id uuid,
  p_expected_fingerprint text,
  p_legacy_state jsonb,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = '';
~~~

Mandatory order:

1. authorize manage_grants;
2. lock target FOR UPDATE;
3. validate active non-Admin target;
4. compare current fingerprint and raise 40001 on mismatch;
5. require a trimmed reason of at least 10 characters for any change;
6. normalize Legacy state; reject new umbrellas and self Legacy mutation;
   when p_legacy_state is SQL null, preserve the locked current Legacy state;
7. reject newly-added Direct keys whose server readiness is not enforced/verified;
8. require legacy_projection_enabled=false or raise 55000;
9. call replace_user_permission_grants_v2_impl so existing SoD and audit run in the same transaction;
10. set transaction-local authorization_permission_command, update only four Legacy fields, restore prior context;
11. append unified_legacy_permissions_changed audit only if Legacy changed;
12. return new fingerprint, decision, Legacy after, and Direct after.

Any exception aborts the function; do not return partial success. Revoke the private implementation from browser roles. Add this public wrapper and grant only it to authenticated:

~~~sql
create or replace function public.apply_user_permission_change(
  p_user_id uuid,
  p_expected_fingerprint text,
  p_legacy_state jsonb,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_user_permission_change_impl(
    p_user_id,
    p_expected_fingerprint,
    p_legacy_state,
    p_grants,
    p_reason,
    p_warning_acceptances
  );
$$;
~~~

- [ ] **Step 8: Run local SQL regression**

~~~bash
npx supabase test db supabase/tests/unified_permission_change_command_smoke.sql supabase/tests/authorization_governance_commands_smoke.sql --local
~~~

Expected: both PASS.

- [ ] **Step 9: Commit locally**

~~~bash
git add "$MIGRATION_FILE" supabase/tests/unified_permission_change_command_smoke.sql
git commit -m "feat(authz): add unified permission change command"
~~~

Do not apply or repair Cloud migration history.

---

### Task 5: Add typed browser service contracts

**Files:**

- Modify: lib/permissions/permissionTypes.ts
- Modify: lib/permissions/authorizationGovernanceTypes.ts
- Modify: lib/permissions/permissionAdminService.ts
- Modify: lib/__tests__/authorizationGovernanceService.test.ts

**Interfaces:**

- Produces UnifiedPermissionPreview, UnifiedPermissionApplyResult, previewUserPermissionChange, and applyUserPermissionChange.
- Consumes LegacyPermissionState and existing Direct Grant payload mapping.

- [ ] **Step 1: Write failing exact-RPC tests**

Assert calls exactly match:

~~~ts
expect(supabaseMock.rpc.mock.calls[0]).toEqual([
  'preview_user_permission_change',
  {
    p_user_id: 'user-1',
    p_legacy_state: legacyState,
    p_grants: buildDirectGrantReplacementPayload(grants),
  },
]);

expect(supabaseMock.rpc.mock.calls[1]).toEqual([
  'apply_user_permission_change',
  {
    p_user_id: 'user-1',
    p_expected_fingerprint: 'before-1',
    p_legacy_state: legacyState,
    p_grants: buildDirectGrantReplacementPayload(grants),
    p_reason: 'Cập nhật quyền nhật ký dự án',
    p_warning_acceptances: [],
  },
]);
~~~

Also assert no RPC argument name contains actor.

- [ ] **Step 2: Run and confirm missing exports**

~~~bash
npm test -- lib/__tests__/authorizationGovernanceService.test.ts
~~~

Expected: FAIL.

- [ ] **Step 3: Add shared types and service methods**

Consume LegacyPermissionState from permissionTypes.ts so services never import a view-model type.

~~~ts
export interface UnifiedPermissionPreview {
  beforeFingerprint: string;
  decision: AuthorizationDecision;
  legacyBefore: LegacyPermissionState;
  legacyAfter: LegacyPermissionState;
}

export interface UnifiedPermissionApplyResult extends UnifiedPermissionPreview {
  afterFingerprint: string;
  directAfter: UserPermissionGrant[];
}
~~~

Implement:

~~~ts
export const previewUserPermissionChange = async (
  userId: string,
  legacyState: LegacyPermissionState | null,
  grants: readonly UserPermissionGrant[],
): Promise<UnifiedPermissionPreview> => {
  if (!isSupabaseConfigured || !userId) {
    throw new Error('Unified permission preview requires Supabase.');
  }
  const { data, error } = await supabase.rpc('preview_user_permission_change', {
    p_user_id: userId,
    p_legacy_state: legacyState,
    p_grants: buildDirectGrantReplacementPayload(grants),
  });
  if (error) throw error;
  return data as UnifiedPermissionPreview;
};

export const applyUserPermissionChange = async (
  userId: string,
  fingerprint: string,
  legacyState: LegacyPermissionState | null,
  grants: readonly UserPermissionGrant[],
  options: ReplaceDirectGrantsOptions,
): Promise<UnifiedPermissionApplyResult> => {
  if (!isSupabaseConfigured || !userId) {
    throw new Error('Unified permission save requires Supabase.');
  }
  const { data, error } = await supabase.rpc('apply_user_permission_change', {
    p_user_id: userId,
    p_expected_fingerprint: fingerprint,
    p_legacy_state: legacyState,
    p_grants: buildDirectGrantReplacementPayload(grants),
    p_reason: options.reason.trim(),
    p_warning_acceptances: options.warningAcceptances,
  });
  if (error) throw error;
  return data as UnifiedPermissionApplyResult;
};
~~~

- [ ] **Step 4: Verify and commit**

~~~bash
npm test -- lib/__tests__/authorizationGovernanceService.test.ts
npm run lint
git add lib/permissions/permissionTypes.ts lib/permissions/authorizationGovernanceTypes.ts lib/permissions/permissionAdminService.ts lib/permissions/unifiedPermissionViewModel.ts lib/__tests__/authorizationGovernanceService.test.ts
git commit -m "feat(authz): add unified permission rpc client"
~~~

Expected: test and TypeScript PASS.

---

### Task 6: Build the reusable unified editor

**Files:**

- Create: components/permissions/UnifiedPermissionMatrix.tsx
- Create: components/permissions/PermissionChangeSummary.tsx
- Create: lib/__tests__/unifiedPermissionMatrix.test.tsx

**Interfaces:**

- Consumes Task 2/3 model, PermissionScopePicker, Direct grants, effective sources, and optional editable Legacy state.
- Produces UnifiedPermissionMatrixProps and PermissionChangeSummaryProps.

- [ ] **Step 1: Write failing server-rendered tests**

Use renderToStaticMarkup from react-dom/server. Assert:

1. View renders before action keys;
2. Role/Legacy render as effective sources, not Direct check state;
3. Declared addition is disabled with Chưa xác minh;
4. existing Declared Direct still exposes revoke;
5. raw codes appear only inside the Advanced details;
6. selected application/module labels render;
7. summary explains auto-View and retained Role/Legacy access.

- [ ] **Step 2: Run and confirm missing components**

~~~bash
npm test -- lib/__tests__/unifiedPermissionMatrix.test.tsx
~~~

Expected: FAIL.

- [ ] **Step 3: Implement the component contract**

~~~ts
interface UnifiedPermissionMatrixProps {
  targetUserId: string;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  scope: PermissionScope;
  legacyState?: LegacyPermissionState;
  disabled?: boolean;
  onGrantsChange: (grants: UserPermissionGrant[]) => void;
  onLegacyStateChange?: (state: LegacyPermissionState) => void;
}
~~~

Component-owned state is limited to selected application/module and Advanced open state. Parent owns all permission drafts.

Render:

- application and module selectors;
- detailed permission modules, hiding duplicate route-derived system shells when a detailed module exists for the same Legacy key;
- View first;
- only registered actions for the selected module;
- separate Direct and effective state;
- readiness/risk labels;
- disabled reason for Declared/Legacy additions;
- source badges and raw codes in Advanced details;
- global-only Legacy View controls when editable Legacy props exist;
- revoke-only Legacy umbrella controls.

All Direct changes call toggleUnifiedDirectGrant. Legacy changes call Task 3 reducers.

- [ ] **Step 4: Implement the summary contract**

~~~ts
interface PermissionChangeSummaryProps {
  beforeGrants: readonly UserPermissionGrant[];
  afterGrants: readonly UserPermissionGrant[];
  beforeLegacy: LegacyPermissionState;
  afterLegacy: LegacyPermissionState;
  effectiveSources: readonly EffectivePermissionSource[];
}
~~~

Group by business labels and scope. Keep raw codes in Advanced details. Say when View was auto-included and when removed Direct access remains through Role/Legacy.

- [ ] **Step 5: Verify and commit**

~~~bash
npm test -- lib/__tests__/unifiedPermissionMatrix.test.tsx lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/permissionReadiness.test.ts
git add components/permissions/UnifiedPermissionMatrix.tsx components/permissions/PermissionChangeSummary.tsx lib/__tests__/unifiedPermissionMatrix.test.tsx
git commit -m "feat(authz): build unified permission editor"
~~~

Expected: PASS.

---

### Task 7: Integrate governance and UserModal

**Files:**

- Modify: components/permissions/PrincipalDirectGrantPanel.tsx
- Modify: components/UserModal.tsx
- Modify: context/AppContext.tsx
- Modify: pages/UserManagement.tsx
- Modify: pages/Settings.tsx
- Modify: pages/settings/SettingsUsers.tsx
- Modify: lib/__tests__/authorizationAdminUiContract.test.ts
- Delete: components/permissions/PermissionMatrix.tsx
- Delete: components/permissions/PermissionDiffPreview.tsx

**Interfaces:**

- Produces AppContext reloadManagedUser(userId): Promise<User>.
- Adds UserModal prop onPermissionsSaved(userId): Promise<User>.
- Consumes Tasks 5/6 Preview, Apply, matrix, and summary.

- [ ] **Step 1: Tighten failing UI contracts**

~~~ts
it('uses one unified source-aware editor and governed permission save', () => {
  const modal = read('components/UserModal.tsx');
  const panel = read('components/permissions/PrincipalDirectGrantPanel.tsx');
  expect(modal).toContain('UnifiedPermissionMatrix');
  expect(modal).toContain('previewUserPermissionChange');
  expect(modal).toContain('applyUserPermissionChange');
  expect(modal).not.toContain('Quản trị Sub-module');
  expect(modal).not.toContain('Phân quyền module');
  expect(panel).toContain('UnifiedPermissionMatrix');
  expect(panel).toContain('buildUnifiedPermissionDraftKey');
});

it('keeps profile save separate from protected permission drafts', () => {
  const modal = read('components/UserModal.tsx');
  expect(modal).toContain('persistedLegacyState');
  expect(modal).not.toMatch(/await onSave\([^)]*legacyDraft/);
});
~~~

Run the contract and expect FAIL.

- [ ] **Step 2: Expose authoritative managed-user reload**

Add:

~~~ts
reloadManagedUser: (userId: string) => Promise<User>;
~~~

Implement:

~~~ts
const reloadManagedUser = async (id: string): Promise<User> => {
  const refreshed = await refreshManagedUser(id);
  setUsers(previous => previous.map(candidate => candidate.id === id ? refreshed : candidate));
  if (user.id === id) await refreshProfile();
  return refreshed;
};
~~~

Expose it from AppContext and pass it to both UserModal call sites.

- [ ] **Step 3: Replace the governance panel matrix and direct-only stale guard**

Use UnifiedPermissionMatrix without editable Legacy state. Replace the old direct-only RPC callbacks with previewUserPermissionChange(principalId,null,drafts) and applyUserPermissionChange(principalId,beforeFingerprint,null,drafts,options). A null Legacy payload means preserve the locked current Legacy fields, while the returned fingerprint still covers both Legacy and Direct state. This closes the external-admin stale overwrite gap without exposing Legacy mutation controls in Settings.

Keep expiry, reason, target-disabled, principal-remount, preview-key, and SoD gates. Store the complete UnifiedPermissionPreview rather than only AuthorizationDecision. Use the preview's legacyBefore value in the draft key so a principal refresh invalidates the old Preview.

- [ ] **Step 4: Replace UserModal's three blocks**

Add local original/draft Legacy state, unified Preview, and previewed draft key. Seed them only from the current userToEdit. Render one permission editor, scope, expiry, reason, summary, SoD, Preview, and Save.

Preview:

~~~ts
const preview = await previewUserPermissionChange(
  userToEdit.id,
  legacyDraft,
  permissionGrants,
);
setUnifiedPreview(preview);
setAuthorizationDecision(preview.decision);
setPreviewedDraftKey(
  buildUnifiedPermissionDraftKey(userToEdit.id, legacyDraft, permissionGrants),
);
~~~

Save requires matching key, validation, no hard deny, and complete warning acceptance:

~~~ts
await applyUserPermissionChange(
  userToEdit.id,
  unifiedPreview.beforeFingerprint,
  legacyDraft,
  permissionGrants,
  { reason: permissionChangeReason, warningAcceptances },
);
const refreshed = await onPermissionsSaved(userToEdit.id);
~~~

Reseed all originals/drafts/sources from refreshed. Map SQLSTATE 40001 to: Dữ liệu quyền đã thay đổi; tải lại và Preview trước khi lưu.

- [ ] **Step 5: Prevent profile save bypass**

For existing users, baseUser uses persistedLegacyState from userToEdit, never legacyDraft. New non-Admin accounts start with empty permission fields and show: Hãy tạo tài khoản trước, sau đó cấp quyền. Preserve the compatibility Admin profile behavior without claiming granular business approval.

Do not call onSave after successful permission Apply; reloadManagedUser refreshes local state without a second DB write.

Remove the existing Legacy-only permission clipboard type, localStorage key, copy/paste handlers, and UI. It cannot safely clone scoped Direct Grants, expiry, Role sources, or SoD evidence, so retaining it would recreate a second incomplete permission workflow. A future clone workflow requires its own governed Preview design.

- [ ] **Step 6: Remove obsolete components safely**

~~~bash
rg -n "PermissionMatrix|PermissionDiffPreview" components pages lib --glob "*.ts" --glob "*.tsx"
~~~

Delete the two old definitions only after no imports/usages remain.

- [ ] **Step 7: Verify and commit**

~~~bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts lib/__tests__/unifiedPermissionMatrix.test.tsx lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/authorizationGovernanceService.test.ts
npm run lint
git add components/UserModal.tsx components/permissions/PrincipalDirectGrantPanel.tsx components/permissions/PermissionMatrix.tsx components/permissions/PermissionDiffPreview.tsx context/AppContext.tsx pages/UserManagement.tsx pages/Settings.tsx pages/settings/SettingsUsers.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): unify user permission administration"
~~~

Expected: tests/TypeScript PASS and deleted paths are recorded.

---

### Task 8: Make Preview and SoD blockers understandable

**Files:**

- Modify: components/permissions/SodWarningPanel.tsx
- Modify: components/permissions/PermissionChangeSummary.tsx
- Modify: lib/__tests__/unifiedPermissionMatrix.test.tsx

**Interfaces:**

- Consumes filtered independent owners and retained effective sources.
- Produces explicit information, warning, and blocker copy.

- [ ] **Step 1: Add failing copy assertions**

Assert exact Vietnamese text:

- Chưa có người kiểm soát độc lập đủ điều kiện; không thể lưu thay đổi quyền nhạy cảm này.
- Gỡ Direct Grant không làm mất quyền thực tế vì Business Role vẫn còn hiệu lực.

- [ ] **Step 2: Verify failure**

~~~bash
npm test -- lib/__tests__/unifiedPermissionMatrix.test.tsx
~~~

Expected: FAIL because copy is absent.

- [ ] **Step 3: Implement blocker behavior**

When availableOwners is empty and warnings exist, render a rose blocker and disable acceptance fields. Keep server validation authoritative.

PermissionChangeSummary distinguishes:

- information: auto-View and unchanged effective access;
- warning: Role/Legacy retains access and expiry risk;
- blocking input from parent: stale draft, hard SoD, invalid scope/readiness, or no independent owner.

Do not expose raw emails in summary text.

- [ ] **Step 4: Verify and commit**

~~~bash
npm test -- lib/__tests__/unifiedPermissionMatrix.test.tsx lib/__tests__/authorizationGovernanceViewModel.test.ts
npm run lint
git add components/permissions/SodWarningPanel.tsx components/permissions/PermissionChangeSummary.tsx lib/__tests__/unifiedPermissionMatrix.test.tsx
git commit -m "fix(authz): clarify permission preview blockers"
~~~

Expected: PASS.

---

### Task 9: Record the bounded manual checklist

**Files:**

- Create: docs/security/unified-permission-matrix-manual-checklist.md

**Interfaces:**

- Consumes the Verified Daily Log set.
- Produces a Pass/Fail sheet only; it performs no mutation.

- [ ] **Step 1: Write exact cases**

| Granted Direct permissions | Must allow | Must deny | Scope check | Result |
|---|---|---|---|---|
| View | Open/read Daily Log | Create, Edit, Submit, Verify, Approve | Project B denied | Not run |
| View + Create | Create eligible draft | Submit, Verify, Approve | Project B denied | Not run |
| View + Edit own | Edit own eligible draft | Edit another user's draft, Submit, Verify, Approve | Project B denied | Not run |
| View + Edit all | Edit eligible project draft | Submit, Verify, Approve | Project B denied | Not run |
| View + Submit | Submit eligible draft | Verify, Approve | Project B denied | Not run |
| View + Verify | Verify assigned eligible record | Approve | Project B denied | Not run |
| View + Approve | Approve eligible record | Arbitrary edit or Verify | Project B denied | Not run |

Prerequisites:

- active non-Admin test account;
- no Role/Legacy umbrella masking negative evidence;
- record source badges;
- verify trusted backend response, not only button visibility;
- stop at first unexpected allow;
- no Cloud execution without a separate approved test-account/mutation checkpoint.

- [ ] **Step 2: Verify and commit**

~~~bash
git diff --check -- docs/security/unified-permission-matrix-manual-checklist.md
git add docs/security/unified-permission-matrix-manual-checklist.md
git commit -m "docs(authz): add unified permission verification checklist"
~~~

Expected: diff check exits 0.

---

### Task 10: Run the complete local gate

**Files:**

- Verify only; modify files only for evidence-backed failures.

**Interfaces:**

- Consumes all prior tasks.
- Produces fresh TypeScript, unit, SQL, build, Git-scope, and Cloud non-mutation evidence.

- [ ] **Step 1: Run focused authorization tests**

~~~bash
npm test -- lib/__tests__/permissionReadiness.test.ts lib/__tests__/unifiedPermissionViewModel.test.ts lib/__tests__/unifiedPermissionMatrix.test.tsx lib/__tests__/authorizationGovernanceViewModel.test.ts lib/__tests__/authorizationGovernanceService.test.ts lib/__tests__/authorizationAdminUiContract.test.ts lib/__tests__/permissionRegistry.test.ts lib/__tests__/permissionService.test.ts lib/__tests__/routeAccess.test.ts
~~~

Expected: zero failures.

- [ ] **Step 2: Run full frontend verification**

~~~bash
npm run lint
npm test
npm run build
~~~

Expected: TypeScript exit 0, full Vitest zero failures, Vite build exit 0.

- [ ] **Step 3: Run local SQL verification**

~~~bash
npx supabase test db supabase/tests/unified_permission_change_command_smoke.sql supabase/tests/authorization_governance_commands_smoke.sql supabase/tests/authorization_sod_smoke.sql --local
~~~

Expected: all PASS. Never substitute --linked.

- [ ] **Step 4: Verify Git scope**

~~~bash
git diff --check
git status --short
git log --oneline --decorate -10
~~~

Expected:

- no whitespace errors;
- the user-owned plan remains unstaged and unmodified by this work;
- no unrelated staged files;
- commits correspond to Tasks 1-9;
- no Cloud apply, rollout flag, migration repair, or Task 4 mutation occurred.

- [ ] **Step 5: Stop at the Cloud checkpoint**

Report local evidence and the generated migration filename. Do not apply it. A separate written Cloud plan and explicit approval are required before migration application, production canaries, rollout flags, or permission mutations.
