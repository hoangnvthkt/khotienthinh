# VIOO Account and Application Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement exactly one System Admin, ordinary Members, governed Member application membership, global read-only System Admin oversight, and explicit configuration authority without implicit business mutations.

**Architecture:** Add a canonical application-access catalog and an audited Member-only `user_application_memberships` relation. Public Preview/Apply RPC wrappers call private authorization helpers. The effective resolver emits `SYSTEM_ADMIN_VIEW` for reviewed read operations and `SYSTEM_ADMIN_CONFIGURATION` only for permissions tagged `system_admin`; ordinary business mutations still require explicit grants. React consumes governed services and renders a Base-style account/application workflow without an App Admin control.

**Tech Stack:** TypeScript, React 18, Vitest, Supabase/Postgres, RLS, PL/pgSQL, existing permission registry, authorization governance service, account lifecycle commands, realtime refresh.

## Global Constraints

- Follow the program constraints in `docs/superpowers/plans/2026-07-20-vioo-pilot-hard-cutover-program.md`.
- Legacy arrays remain unchanged and read-only during this plan; do not clear them and do not disable fallback here.
- Preserve stored role values initially: map `ADMIN -> SYSTEM_ADMIN` behavior and `EMPLOYEE -> MEMBER` behavior through an adapter. Existing `WAREHOUSE_KEEPER` rows remain readable until the enforcement plan migrates them.
- Do not add an Application Administrator access level, assignment, source, or UI toggle.
- Classify System Admin configuration operations explicitly; vague Legacy `manage` actions are ordinary actions until reviewed.
- Membership removal must atomically revoke active Direct Grants for the same canonical application and emit audit/refresh evidence.
- The sole active System Admin gets all-application access and global read-only visibility without membership rows.
- `SYSTEM_ADMIN_CONFIGURATION` contains only permissions in the reviewed `system_admin` allowlist.
- Sensitive and business-mutation permission codes are never emitted from System Admin role expansion.
- Create migrations with the Supabase CLI; all SQL snippets belong in the CLI-generated file.
- Do not deploy to Cloud as part of this plan without a separate exact approval.

---

## File Structure

**Create:**

- `lib/permissions/applicationAccessCatalog.ts` — canonical product-app codes and Legacy/module mappings.
- `lib/permissions/applicationMembershipTypes.ts` — membership/access command contracts.
- `lib/permissions/applicationMembershipService.ts` — governed RPC client and row mapping.
- `components/permissions/UserApplicationAccessPanel.tsx` — Base-style application chips/cards and toggles.
- `lib/__tests__/applicationAccessCatalog.test.ts`
- `lib/__tests__/applicationMembershipService.test.ts`
- `lib/__tests__/userApplicationAccessPanel.test.tsx`
- `supabase/tests/single_system_admin_recovery_smoke.sql`
- `supabase/tests/application_membership_foundation_smoke.sql`

**Modify:**

- `lib/permissions/permissionTypes.ts`
- `lib/permissions/permissionRegistry.ts`
- `lib/permissions/erpPermissionRegistry.ts`
- `lib/permissions/projectPermissionRegistry.ts`
- `lib/permissions/authorizationGovernanceTypes.ts`
- `lib/permissions/authorizationGovernanceService.ts`
- `lib/permissions/permissionService.ts`
- `types.ts`
- `components/UserModal.tsx`
- `pages/UserManagement.tsx`
- `pages/settings/SettingsAuthorizationGovernance.tsx`
- `context/AuthContext.tsx`
- `context/authState.ts`
- `supabase/functions/create-user/index.ts`
- account lifecycle SQL through a new migration

---

### Task 1: Freeze the Canonical Product Application Catalog

**Files:**
- Create: `lib/permissions/applicationAccessCatalog.ts`
- Test: `lib/__tests__/applicationAccessCatalog.test.ts`
- Modify: `lib/permissions/permissionRegistry.ts`

**Interfaces:**

```ts
export type ApplicationCode =
  | 'project' | 'procurement' | 'wms' | 'hrm' | 'workflow' | 'request'
  | 'expense' | 'asset' | 'contract' | 'chat' | 'ai'
  | 'storage' | 'kb' | 'analytics' | 'settings';

export interface ApplicationAccessDefinition {
  code: ApplicationCode;
  label: string;
  legacyModuleKeys: readonly string[];
  permissionApplicationCodes: readonly string[];
  rootRoutes: readonly string[];
  memberAssignable: boolean;
  sortOrder: number;
}
```

- [ ] **Step 1: Write the failing catalog contract test**

Assert unique app codes, unique normalized Legacy-module ownership, nonempty route ownership, and the exact active-pilot mapping:

```ts
const expectedLegacyOwners = {
  DA: 'project', PROCUREMENT: 'procurement', WMS: 'wms', HRM: 'hrm', EP: 'hrm', WF: 'workflow',
  RQ: 'request', EX: 'expense', TS: 'asset', HD: 'contract', CHAT: 'chat',
  AI: 'ai', TENDER_AI: 'ai', STORAGE: 'storage', KB: 'kb',
  ANALYTICS: 'analytics', CUSTOM_DASHBOARD: 'analytics',
  SETTINGS: 'settings', AUDIT_TRAIL: 'settings',
} as const;
```

Mark `settings.memberAssignable = false`; every ordinary product app is `true`. The membership command rejects Member assignment to `settings`, while System Admin receives settings access implicitly.

- [ ] **Step 2: Run the failing test**

```bash
npm test -- lib/__tests__/applicationAccessCatalog.test.ts
```

Expected: FAIL because the access catalog does not exist.

- [ ] **Step 3: Implement and deep-freeze the catalog**

Add selectors:

```ts
export const getApplicationAccessDefinitions = (): readonly ApplicationAccessDefinition[];
export const getApplicationAccessDefinition = (code: ApplicationCode): ApplicationAccessDefinition | undefined;
export const getApplicationCodeForPermission = (permissionCode: string): ApplicationCode | undefined;
export const getApplicationCodeForLegacyModule = (legacyKey: string): ApplicationCode | undefined;
export const getApplicationCodeForRoute = (route: string): ApplicationCode | undefined;
```

Route lookup must reuse the same `matchPath` behavior as permission routing and must reject ambiguous matches in tests.

- [ ] **Step 4: Make permission registry applications map to the product catalog**

Do not use synthetic `system` as a user-selectable business app. Keep its permission modules, but map each `system.<legacy_key>` action to the owning product application via `getApplicationCodeForPermission`. Map `system.authorization.*` to `settings`.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- lib/__tests__/applicationAccessCatalog.test.ts lib/__tests__/permissionRegistry.test.ts lib/__tests__/permissionRouteRegistry.test.ts
git add lib/permissions/applicationAccessCatalog.ts lib/permissions/permissionRegistry.ts lib/__tests__/applicationAccessCatalog.test.ts
git commit -m "feat: define canonical application access catalog"
```

---

### Task 2: Classify System Admin Configuration Permissions Explicitly

**Files:**
- Modify: `lib/permissions/permissionTypes.ts`
- Modify: `lib/permissions/erpPermissionRegistry.ts`
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Test: `lib/__tests__/applicationPermissionRegistryContract.test.ts`

**Interfaces:**

```ts
export type PermissionActionGroup = 'access' | 'action' | 'system_admin';
```

- [ ] **Step 1: Replace the existing broad grouping test with security contracts**

The test must prove:

- every module has exactly one `view` gateway classified `access`;
- sensitive or `isBusinessApproval` actions are never `system_admin`;
- `edit`, `delete`, `approve`, `confirm`, `receive`, `export`, and workflow actions default to `action`;
- `system_admin` appears only on a reviewed configuration allowlist;
- a vague Legacy-labelled `manage` action is not automatically `system_admin`;
- root business-object creation such as project/warehouse creation remains `action`.

- [ ] **Step 2: Run the test and observe failure**

```bash
npm test -- lib/__tests__/applicationPermissionRegistryContract.test.ts
```

- [ ] **Step 3: Remove action-name inference for System Admin configuration**

Change the resolver to:

```ts
export const resolvePermissionActionGroup = (action: string): PermissionActionGroup =>
  action === 'view' ? 'access' : 'action';
```

Allow registry entries to pass `permissionGroup: 'system_admin'` only through explicit metadata.

- [ ] **Step 4: Add explicit customization codes**

Use concrete operations, not umbrella data access. Minimum catalog:

```text
project.master.manage_categories
project.settings.manage
project.template.manage
project.workflow.configure
wms.master_data.manage
wms.settings.manage
hrm.master_data.manage
hrm.settings.manage
workflow.template.create
workflow.template.edit
workflow.template.publish
request.category.manage
request.template.manage
asset.settings.manage
contract.template.manage
expense.master_data.manage
system.authorization.manage_grants
system.authorization.audit
```

Before adding a new code, identify its real route, mutation entry point, and backend guard. If the operation changes business records rather than shared configuration, keep it in `action` and require an explicit grant. If the operation does not yet exist, keep it `declared` and do not include it in System Admin configuration expansion until Plan B enforces it.

- [ ] **Step 5: Verify no business mutation leaked into System Admin configuration**

```bash
npm test -- lib/__tests__/applicationPermissionRegistryContract.test.ts lib/__tests__/permissionRisk.test.ts
git add lib/permissions/permissionTypes.ts lib/permissions/erpPermissionRegistry.ts lib/permissions/projectPermissionRegistry.ts lib/__tests__/applicationPermissionRegistryContract.test.ts
git commit -m "refactor: classify application customization permissions"
```

---

### Task 3: Add the Membership Schema, Audit Model, and RLS

**Files:**
- Create via CLI: migration named `application_membership_foundation`
- Create: `supabase/tests/application_membership_foundation_smoke.sql`

- [ ] **Step 1: Inspect CLI usage, then create the migration**

```bash
npx supabase migration new --help
npx supabase migration new application_membership_foundation
rg --files supabase/migrations | rg '/[0-9]+_application_membership_foundation\.sql$'
```

Use the returned path for all migration edits.

- [ ] **Step 2: Write a failing SQL smoke first**

The smoke must assert absence before migration implementation, then after implementation assert:

- table/check/unique indexes exist;
- RLS is enabled;
- authenticated users cannot insert/update/delete directly;
- inactive target users cannot receive effective membership;
- one active row per user/application;
- membership rows belong only to Members;
- revoke metadata is mandatory;
- audit events and refresh events are written by commands.

- [ ] **Step 3: Create the relation**

```sql
create table public.user_application_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  application_code text not null references public.permission_applications(code) on update cascade,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  granted_by uuid not null references public.users(id),
  granted_reason text not null check (char_length(btrim(granted_reason)) >= 5),
  granted_at timestamptz not null default now(),
  revoked_by uuid references public.users(id),
  revoked_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index user_application_memberships_one_active
  on public.user_application_memberships(user_id, application_code)
  where status = 'ACTIVE';
```

Use a constraint trigger to require all three revoke fields together when status is `REVOKED`.

- [ ] **Step 4: Add RLS and privileges**

Enable RLS. Allow a Member to select only their own active memberships; allow the sole System Admin to list all through an authorized RPC. Reject membership rows for the System Admin account. Revoke direct DML from `anon` and `authenticated`. The public schema exposes only wrappers; mutation helpers live in `app_private` with an empty `search_path`.

- [ ] **Step 5: Add application code integrity**

Seed/reconcile `permission_applications` from the canonical catalog and add `member_assignable boolean not null default true`; set `settings=false`. Add `permission_actions.access_application_code` as a canonical product-app foreign key and backfill every action from the reviewed catalog, including synthetic `system.*` actions. Reject unknown, inactive, or non-member-assignable application codes in Member commands. Do not delete historical catalog rows; mark them inactive.

- [ ] **Step 6: Reset and run SQL smoke**

```bash
npx supabase db reset
npx supabase test db supabase/tests/application_membership_foundation_smoke.sql
```

Expected: PASS with a final deterministic marker `application_membership_foundation_smoke_passed`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/*_application_membership_foundation.sql supabase/tests/application_membership_foundation_smoke.sql
git commit -m "feat: add governed application memberships"
```

---

### Task 4: Implement Membership Preview and Atomic Apply Commands

**Files:**
- Modify via a new CLI migration named `application_membership_commands`
- Modify: `supabase/tests/application_membership_foundation_smoke.sql`

**Public RPCs:**

```sql
public.list_user_application_memberships(p_target_user_id uuid default public.current_app_user_id())
public.preview_user_application_access_change(
  p_target_user_id uuid,
  p_desired_access jsonb
) returns jsonb
public.apply_user_application_access_change(
  p_target_user_id uuid,
  p_expected_fingerprint text,
  p_desired_access jsonb,
  p_reason text,
  p_idempotency_key uuid
) returns jsonb
```

Desired-access JSON is an array of unique rows:

```json
["project"]
```

- [ ] **Step 1: Add failing command smoke cases**

Cover invalid app, non-member-assignable settings app, duplicate app, inactive target, System Admin target, unauthorized actor, stale fingerprint, idempotent retry, membership add, removal, and atomic grant revocation.

- [ ] **Step 2: Implement private normalization and fingerprint helpers**

Fingerprint sorted current membership rows plus active grants whose `permission_actions.access_application_code` belongs to those applications. Use `digest(..., 'sha256')`, not unordered JSON text.

- [ ] **Step 3: Implement Preview**

Return:

```json
{
  "beforeFingerprint": "...",
  "before": [],
  "after": [],
  "added": [],
  "removed": [],
  "revokedGrantCount": 0,
  "hardDenies": [],
  "warnings": []
}
```

Hard-deny inactive target, System Admin as membership target, unknown app, exactly-one-admin violation, and any actor other than the canonical System Admin.

- [ ] **Step 4: Implement Apply under one transaction**

Lock the target user and active membership rows, compare fingerprint, upsert/revoke memberships, revoke active Direct Grants for removed apps, append `permission_audit_events`, and emit a user authorization refresh event. Never delete history rows.

- [ ] **Step 5: Prove re-add does not restore grants**

The smoke removes an app with one active grant, re-adds membership, and asserts the old grant remains revoked.

- [ ] **Step 6: Verify and commit**

```bash
npx supabase db reset
npx supabase test db supabase/tests/application_membership_foundation_smoke.sql
git add supabase/migrations/*_application_membership_commands.sql supabase/tests/application_membership_foundation_smoke.sql
git commit -m "feat: govern application access changes"
```

---

### Task 5: Add System Admin Global View and Configuration Sources

**Files:**
- Modify via new CLI migration named `application_membership_effective_sources`
- Modify: `lib/permissions/authorizationGovernanceTypes.ts`
- Test: `lib/__tests__/authorizationGovernanceService.test.ts`
- Modify: `supabase/tests/application_membership_foundation_smoke.sql`

**Interfaces:**

```ts
export type EffectivePermissionSourceType =
  | 'ROLE' | 'DIRECT' | 'LEGACY'
  | 'SYSTEM_ADMIN_VIEW' | 'SYSTEM_ADMIN_CONFIGURATION';
```

- [ ] **Step 1: Add failing mapping and SQL smoke assertions**

Assert a Member membership opens only the application shell, while ADMIN receives every active app plus global read sources and only `permission_group='system_admin'` configuration sources without membership rows. Assert ADMIN receives no create/edit/delete/approve/export source by role alone.

- [ ] **Step 2: Add `permission_group` to `permission_actions`**

Use values `access`, `action`, `system_admin`; backfill from the reviewed registry seed. `manage` is not automatically `system_admin`.

- [ ] **Step 3: Extend the private effective resolver**

Emit:

- `SYSTEM_ADMIN_VIEW` permission sources for reviewed read-only actions across every active application and scope;
- `SYSTEM_ADMIN_CONFIGURATION` sources only for active `system_admin` actions;
- no implicit source for create/edit/delete/submit/confirm/approve/pay/close/adjust/receive/issue/import/export/bulk business operations;
- no source for inactive accounts.

The resolver must use `permission_actions.access_application_code` for app ownership, require read-only classification before emitting global view, and keep Legacy behavior unchanged until cutover.

- [ ] **Step 4: Add application membership prerequisite helper**

```sql
app_private.user_has_application_access(p_user_id uuid, p_application_code text) returns boolean
```

It returns true for active Member membership or the sole active System Admin, false for inactive users. It does not check action/scope/assignment.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- lib/__tests__/authorizationGovernanceService.test.ts lib/__tests__/permissionService.test.ts
npx supabase db reset
npx supabase test db supabase/tests/application_membership_foundation_smoke.sql
git add lib/permissions/authorizationGovernanceTypes.ts lib/__tests__/authorizationGovernanceService.test.ts supabase/migrations/*_application_membership_effective_sources.sql supabase/tests/application_membership_foundation_smoke.sql
git commit -m "feat: resolve application membership sources"
```

---

### Task 6: Add TypeScript Contracts and Governed Client Service

**Files:**
- Create: `lib/permissions/applicationMembershipTypes.ts`
- Create: `lib/permissions/applicationMembershipService.ts`
- Test: `lib/__tests__/applicationMembershipService.test.ts`

**Interfaces:**

```ts
export interface UserApplicationAccess {
  applicationCode: ApplicationCode;
  status: 'ACTIVE';
  grantedAt: string;
  grantedBy: string;
}

export interface ApplicationAccessPreview {
  beforeFingerprint: string;
  before: UserApplicationAccess[];
  after: UserApplicationAccess[];
  revokedGrantCount: number;
  hardDenies: SodFinding[];
  warnings: SodFinding[];
}
```

- [ ] **Step 1:** Write failing mapper, RPC-argument, stale-preview, and error-propagation tests.
- [ ] **Step 2:** Implement `list`, `preview`, and `apply` methods; do not call `.from(...).insert/update/delete`.
- [ ] **Step 3:** Normalize/sort rows before UI consumption.
- [ ] **Step 4:** Run tests and commit.

```bash
npm test -- lib/__tests__/applicationMembershipService.test.ts lib/__tests__/authorizationGovernanceService.test.ts
git add lib/permissions/applicationMembershipTypes.ts lib/permissions/applicationMembershipService.ts lib/__tests__/applicationMembershipService.test.ts
git commit -m "feat: add application membership client"
```

---

### Task 7: Build the Base-style Application Access Panel

**Files:**
- Create: `components/permissions/UserApplicationAccessPanel.tsx`
- Test: `lib/__tests__/userApplicationAccessPanel.test.tsx`
- Modify: `pages/settings/SettingsAuthorizationGovernance.tsx`

- [ ] **Step 1: Write failing UI behavior tests**

Cover searchable add list, selected app chips/cards, the single `Use application` toggle, membership removal preview, reason requirement, stale preview recovery, success only after Apply, and read-only all-app messaging for the System Admin. Assert no App Admin label, toggle, badge, access level, or payload exists.

- [ ] **Step 2: Implement the panel**

Props:

```ts
interface UserApplicationAccessPanelProps {
  targetUserId: string;
  targetIsSystemAdmin: boolean;
  onApplied?: () => Promise<void> | void;
}
```

Use a two-step Preview -> Apply interaction. Show the grant-revocation count before removal. For System Admin, render every app as implicitly available and explain: all-data view plus configuration allowlist are automatic, while business mutations remain explicit.

- [ ] **Step 3: Mount it in the existing governance page**

Do not create a second Settings route. Keep detailed Direct Grants in a separate section/action.

- [ ] **Step 4: Verify accessible interactions and commit**

```bash
npm test -- lib/__tests__/userApplicationAccessPanel.test.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git add components/permissions/UserApplicationAccessPanel.tsx pages/settings/SettingsAuthorizationGovernance.tsx lib/__tests__/userApplicationAccessPanel.test.tsx
git commit -m "feat: add Base-style application access panel"
```

---

### Task 8: Present Exactly Two Account Roles

**Files:**
- Modify: `types.ts`
- Modify: `components/UserModal.tsx`
- Modify: `pages/UserManagement.tsx`
- Modify: `context/authState.ts`
- Modify: `supabase/functions/create-user/index.ts`
- Create via CLI: migration named `single_system_admin_invariant`
- Test: `lib/__tests__/userModalAccountRoles.test.tsx`
- Test: `lib/__tests__/authBoundary.test.tsx`
- Test: `lib/__tests__/createUserEdgeFunctionContract.test.ts`
- Test: `supabase/tests/single_system_admin_recovery_smoke.sql`

- [ ] **Step 1: Add the behavior adapter**

```ts
export type AccountRole = 'SYSTEM_ADMIN' | 'MEMBER';
export const toAccountRole = (role: Role): AccountRole =>
  role === Role.ADMIN ? 'SYSTEM_ADMIN' : 'MEMBER';
```

Do not rename stored values yet; that would unnecessarily combine schema migration with behavior migration.

- [ ] **Step 2: Write failing UI and payload tests**

The select shows only `Thành viên` and `System Admin`. New Member payload persists `EMPLOYEE`. The existing sole System Admin displays as `ADMIN`; ordinary UI rejects promotion of another account to `ADMIN`. It never creates a new `WAREHOUSE_KEEPER`, never sends Legacy arrays as entitlements, and never grants app memberships through profile-table writes.

- [ ] **Step 3: Refactor UserModal**

Remove the warehouse-role selector and `Kho phụ trách` from account identity. Warehouse assignment moves to the WMS owning UI in Plan B. Keep a read-only compatibility message for an existing keeper until migrated.

- [ ] **Step 4: Enforce exactly one System Admin server-side**

Extend governed account update/lifecycle RPCs; UI checks are not sufficient. Reject demotion/disablement of the sole System Admin and reject ordinary promotion while an active System Admin exists.

- [ ] **Step 5: Add the service-role-only recovery command**

Create and revoke public browser access to:

```sql
public.recover_single_system_admin(
  p_target_user_id uuid,
  p_expected_fingerprint text,
  p_reason text,
  p_change_reference text
) returns jsonb
```

The command requires service-role execution, serializes on an advisory lock, snapshots every active ADMIN row, restores exactly one active ADMIN, demotes any other ADMIN to EMPLOYEE, grants no memberships or business permissions, writes `permission_audit_events`, and returns before/after fingerprints.

- [ ] **Step 6: Prove recovery and ordinary-command denials**

`single_system_admin_recovery_smoke.sql` must prove zero-admin recovery, two-admin reconciliation, stale-fingerprint denial, authenticated-call denial, no business grant creation, audit evidence, and final active ADMIN count exactly one.

- [ ] **Step 7: Verify and commit**

```bash
npm test -- lib/__tests__/userModalAccountRoles.test.tsx lib/__tests__/authBoundary.test.tsx lib/__tests__/createUserEdgeFunctionContract.test.ts
npx supabase test db supabase/tests/single_system_admin_recovery_smoke.sql --local
git add types.ts components/UserModal.tsx pages/UserManagement.tsx context/authState.ts supabase/functions/create-user/index.ts lib/__tests__/userModalAccountRoles.test.tsx lib/__tests__/authBoundary.test.tsx lib/__tests__/createUserEdgeFunctionContract.test.ts supabase/migrations/*_single_system_admin_invariant.sql supabase/tests/single_system_admin_recovery_smoke.sql
git commit -m "feat: present system admin and member roles"
```

---

### Task 9: Integrate Account Disablement and Authorization Refresh

**Files:**
- Modify via new CLI migration named `application_membership_account_lifecycle`
- Modify: `context/AuthContext.tsx`
- Test: `lib/__tests__/authBoundary.test.tsx`
- Modify: `supabase/tests/application_membership_foundation_smoke.sql`

- [ ] **Step 1:** Add failing SQL assertions that disabling an account revokes memberships and grants, and reactivation starts with zero access.
- [ ] **Step 2:** Extend `app_private.revoke_user_access_sources` to revoke active memberships with reason/audit metadata.
- [ ] **Step 3:** Ensure lifecycle snapshots include application membership rows.
- [ ] **Step 4:** Subscribe the active user session to authorization refresh events and reload membership/effective sources after Apply.
- [ ] **Step 5:** Prove removal takes effect without logout and stale events do not overwrite newer state.
- [ ] **Step 6:** Verify and commit.

```bash
npm test -- lib/__tests__/authBoundary.test.tsx lib/__tests__/applicationMembershipService.test.ts
npx supabase db reset
npx supabase test db supabase/tests/application_membership_foundation_smoke.sql
git add context/AuthContext.tsx lib/__tests__/authBoundary.test.tsx supabase/migrations/*_application_membership_account_lifecycle.sql supabase/tests/application_membership_foundation_smoke.sql
git commit -m "feat: refresh and revoke application access lifecycle"
```

---

## Foundation Final Verification

```bash
npm test -- \
  lib/__tests__/applicationAccessCatalog.test.ts \
  lib/__tests__/applicationPermissionRegistryContract.test.ts \
  lib/__tests__/applicationMembershipService.test.ts \
  lib/__tests__/userApplicationAccessPanel.test.tsx \
  lib/__tests__/userModalAccountRoles.test.tsx \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/authBoundary.test.tsx \
  lib/__tests__/permissionRouteRegistry.test.ts
npm run lint
npm run build
npx supabase db reset
npx supabase test db supabase/tests/application_membership_foundation_smoke.sql
git status --short
```

Expected:

- all targeted tests, typecheck, build, reset, and SQL smoke pass;
- no new account can be created as `WAREHOUSE_KEEPER`;
- direct membership DML is denied;
- System Admin view sources contain only reviewed read operations;
- System Admin configuration sources contain only the explicit `system_admin` allowlist;
- System Admin role produces no business mutation source;
- business mutations remain denied without explicit grants and required assignments, including for System Admin;
- System Admin global view succeeds without project/warehouse/department assignment;
- Legacy fields and fallback are still unchanged/read-only;
- only intended files are staged/committed.

## Foundation Exit Evidence

Record in a short implementation report:

- migration filenames and SHA-256 hashes;
- app catalog codes and Legacy ownership mapping;
- counts of test fixtures by Member membership and System Admin implicit access (no PII);
- membership removal/re-add proof;
- last-admin and inactive-account denial proof;
- realtime refresh proof;
- explicit statement that no Cloud mutation occurred, or exact approved Cloud operation if one occurred.
