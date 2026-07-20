# VIOO Account and Application Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement two operator-facing account roles and governed per-user application membership/Application Administrator access without granting unassigned business data or sensitive actions.

**Architecture:** Add a canonical application-access catalog and an audited `user_application_memberships` relation. Public Preview/Apply RPC wrappers call private authorization helpers. The effective resolver emits `APP_MEMBER` and `APP_ADMIN` sources, where `APP_ADMIN` expands only permission actions explicitly tagged `app_admin`. React consumes the governed service and renders a Base-style account/application workflow.

**Tech Stack:** TypeScript, React 18, Vitest, Supabase/Postgres, RLS, PL/pgSQL, existing permission registry, authorization governance service, account lifecycle commands, realtime refresh.

## Global Constraints

- Follow the program constraints in `docs/superpowers/plans/2026-07-20-vioo-pilot-hard-cutover-program.md`.
- Legacy arrays remain unchanged and read-only during this plan; do not clear them and do not disable fallback here.
- Preserve stored role values initially: map `ADMIN -> SUPER_ADMIN` behavior and `EMPLOYEE -> MEMBER` behavior through an adapter. Existing `WAREHOUSE_KEEPER` rows remain readable until the enforcement plan migrates them.
- Do not add Application Administrator behavior to vague Legacy `manage` permissions. Every app customization action must be explicitly classified.
- Membership removal must atomically revoke active Direct Grants for the same canonical application and emit audit/refresh evidence.
- High-level Administrator gets effective App Admin for all active catalog applications without duplicate membership rows.
- Sensitive and business-action permission codes are never emitted from App Admin expansion.
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
  | 'project' | 'wms' | 'hrm' | 'workflow' | 'request'
  | 'expense' | 'asset' | 'contract' | 'chat' | 'ai'
  | 'storage' | 'kb' | 'analytics' | 'settings';

export interface ApplicationAccessDefinition {
  code: ApplicationCode;
  label: string;
  legacyModuleKeys: readonly string[];
  permissionApplicationCodes: readonly string[];
  rootRoutes: readonly string[];
  sortOrder: number;
}
```

- [ ] **Step 1: Write the failing catalog contract test**

Assert unique app codes, unique normalized Legacy-module ownership, nonempty route ownership, and the exact active-pilot mapping:

```ts
const expectedLegacyOwners = {
  DA: 'project', WMS: 'wms', HRM: 'hrm', EP: 'hrm', WF: 'workflow',
  RQ: 'request', EX: 'expense', TS: 'asset', HD: 'contract', CHAT: 'chat',
  AI: 'ai', TENDER_AI: 'ai', STORAGE: 'storage', KB: 'kb',
  ANALYTICS: 'analytics', CUSTOM_DASHBOARD: 'analytics',
  SETTINGS: 'settings', AUDIT_TRAIL: 'settings',
} as const;
```

`PROCUREMENT` must be resolved explicitly before the test passes: assign it to `wms` if its routes are company purchasing/warehouse operations, or to `project` if they are project procurement. Record the chosen owner in the catalog and a one-line rationale in the test. Do not create a duplicate app merely to preserve a Legacy key.

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

### Task 2: Classify Application Customization Permissions Explicitly

**Files:**
- Modify: `lib/permissions/permissionTypes.ts`
- Modify: `lib/permissions/erpPermissionRegistry.ts`
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Test: `lib/__tests__/applicationPermissionRegistryContract.test.ts`

**Interfaces:**

```ts
export type PermissionActionGroup = 'access' | 'action' | 'app_admin';
```

- [ ] **Step 1: Replace the existing broad grouping test with security contracts**

The test must prove:

- every module has exactly one `view` gateway classified `access`;
- sensitive or `isBusinessApproval` actions are never `app_admin`;
- `edit`, `delete`, `approve`, `confirm`, `receive`, `export`, and workflow actions default to `action`;
- `app_admin` appears only on a reviewed allowlist;
- a vague Legacy-labelled `manage` action is not automatically `app_admin`.

- [ ] **Step 2: Run the test and observe failure**

```bash
npm test -- lib/__tests__/applicationPermissionRegistryContract.test.ts
```

- [ ] **Step 3: Remove action-name inference for App Admin**

Change the resolver to:

```ts
export const resolvePermissionActionGroup = (action: string): PermissionActionGroup =>
  action === 'view' ? 'access' : 'action';
```

Allow registry entries to pass `permissionGroup: 'app_admin'` only through explicit metadata.

- [ ] **Step 4: Add explicit customization codes**

Use concrete operations, not umbrella data access. Minimum catalog:

```text
project.master.create
project.master.manage_categories
project.settings.manage
project.template.manage
project.workflow.configure
wms.master_data.manage
wms.settings.manage
wms.warehouse.create
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

Before adding a new code, identify its real route, mutation entry point, and backend guard. If the operation does not yet exist, keep it `declared` in the DB but do not make App Admin resolve it until Plan B enforces it.

- [ ] **Step 5: Verify no business action leaked into App Admin**

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
- `APP_ADMIN` implies app use;
- revoke metadata is mandatory;
- audit events and refresh events are written by commands.

- [ ] **Step 3: Create the relation**

```sql
create table public.user_application_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  application_code text not null references public.permission_applications(code) on update cascade,
  access_level text not null check (access_level in ('MEMBER', 'APP_ADMIN')),
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

Enable RLS. Allow a user to select only their own active memberships; allow High-level Administrators to list all through an authorized RPC. Revoke direct DML from `anon` and `authenticated`. The public schema exposes only wrappers; mutation helpers live in `app_private` with an empty `search_path`.

- [ ] **Step 5: Add application code integrity**

Seed/reconcile `permission_applications` from the canonical catalog in the migration. Add `permission_actions.access_application_code` as a canonical product-app foreign key and backfill every action from the reviewed catalog, including synthetic `system.*` actions. Reject unknown or inactive application codes. Do not delete historical catalog rows; mark them inactive.

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
[{"applicationCode":"project","accessLevel":"MEMBER"}]
```

- [ ] **Step 1: Add failing command smoke cases**

Cover invalid app, duplicate app, inactive target, unauthorized actor, stale fingerprint, idempotent retry, membership add, upgrade/downgrade, removal, and atomic grant revocation.

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
  "upgraded": [],
  "downgraded": [],
  "removed": [],
  "revokedGrantCount": 0,
  "hardDenies": [],
  "warnings": []
}
```

Hard-deny self-escalation, inactive target, unknown app, last-admin violation, and actor without `system.authorization.manage_grants` or canonical High-level Administrator authority.

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

### Task 5: Extend Effective Sources Without Granting Business Data

**Files:**
- Modify via new CLI migration named `application_membership_effective_sources`
- Modify: `lib/permissions/authorizationGovernanceTypes.ts`
- Test: `lib/__tests__/authorizationGovernanceService.test.ts`
- Modify: `supabase/tests/application_membership_foundation_smoke.sql`

**Interfaces:**

```ts
export type EffectivePermissionSourceType =
  | 'ROLE' | 'DIRECT' | 'LEGACY' | 'APP_MEMBER' | 'APP_ADMIN';
```

- [ ] **Step 1: Add failing mapping and SQL smoke assertions**

Assert a Member receives app shell evidence but no action permission, an App Admin receives only `permission_group='app_admin'`, and an ADMIN receives the same App Admin expansion for every active app without membership rows.

- [ ] **Step 2: Add `permission_group` to `permission_actions`**

Use values `access`, `action`, `app_admin`; backfill from the reviewed registry seed. `manage` is not automatically `app_admin`.

- [ ] **Step 3: Extend the private effective resolver**

Emit:

- one `APP_MEMBER` source describing active membership and application code;
- `APP_ADMIN` permission sources only for active `app_admin` actions belonging to that application;
- effective `APP_ADMIN` for active High-level Administrators across every active app;
- no source for inactive accounts.

The resolver must use `permission_actions.access_application_code` for membership and App Admin expansion, and keep Legacy behavior unchanged until cutover.

- [ ] **Step 4: Add application membership prerequisite helper**

```sql
app_private.user_has_application_access(p_user_id uuid, p_application_code text) returns boolean
```

It returns true for active membership or active High-level Administrator, false for inactive users. It does not check action/scope/assignment.

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
export type ApplicationAccessLevel = 'NONE' | 'MEMBER' | 'APP_ADMIN';

export interface UserApplicationAccess {
  applicationCode: ApplicationCode;
  accessLevel: Exclude<ApplicationAccessLevel, 'NONE'>;
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

Cover searchable add list, selected app chips/cards, `Use application`, `Application Administrator`, App Admin implying use, membership removal preview, reason requirement, stale preview recovery, success only after Apply, and disabled controls for the current actor where required.

- [ ] **Step 2: Implement the panel**

Props:

```ts
interface UserApplicationAccessPanelProps {
  targetUserId: string;
  targetIsHighLevelAdministrator: boolean;
  onApplied?: () => Promise<void> | void;
}
```

Use a two-step Preview -> Apply interaction. Show the grant-revocation count before removal. For High-level Administrators, render all apps as effective App Admin and explain that sensitive/scoped business permissions remain separate.

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
- Test: `lib/__tests__/userModalAccountRoles.test.tsx`
- Test: `lib/__tests__/authBoundary.test.tsx`
- Test: `lib/__tests__/createUserEdgeFunctionContract.test.ts`

- [ ] **Step 1: Add the behavior adapter**

```ts
export type AccountRole = 'SUPER_ADMIN' | 'MEMBER';
export const toAccountRole = (role: Role): AccountRole =>
  role === Role.ADMIN ? 'SUPER_ADMIN' : 'MEMBER';
```

Do not rename stored values yet; that would unnecessarily combine schema migration with behavior migration.

- [ ] **Step 2: Write failing UI and payload tests**

The select shows only `Thành viên` and `Quản trị cấp cao`. New Member payload persists `EMPLOYEE`; High-level persists `ADMIN`. It never creates a new `WAREHOUSE_KEEPER`, never sends Legacy arrays as entitlements, and never grants app memberships through profile-table writes.

- [ ] **Step 3: Refactor UserModal**

Remove the warehouse-role selector and `Kho phụ trách` from account identity. Warehouse assignment moves to the WMS owning UI in Plan B. Keep a read-only compatibility message for an existing keeper until migrated.

- [ ] **Step 4: Enforce last-admin and self-demotion server-side**

Extend governed account update/lifecycle RPCs; UI checks are not sufficient. High-level Administrators may be demoted only when another active High-level Administrator remains.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- lib/__tests__/userModalAccountRoles.test.tsx lib/__tests__/authBoundary.test.tsx lib/__tests__/createUserEdgeFunctionContract.test.ts
git add types.ts components/UserModal.tsx pages/UserManagement.tsx context/authState.ts supabase/functions/create-user/index.ts lib/__tests__/userModalAccountRoles.test.tsx lib/__tests__/authBoundary.test.tsx lib/__tests__/createUserEdgeFunctionContract.test.ts
git commit -m "feat: present member and high-level admin roles"
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
- App Admin sources contain only explicit customization actions;
- sensitive and scoped business actions remain denied without explicit grants and assignments;
- Legacy fields and fallback are still unchanged/read-only;
- only intended files are staged/committed.

## Foundation Exit Evidence

Record in a short implementation report:

- migration filenames and SHA-256 hashes;
- app catalog codes and Legacy ownership mapping;
- counts of test fixtures by `MEMBER`/`APP_ADMIN` (no PII);
- membership removal/re-add proof;
- last-admin and inactive-account denial proof;
- realtime refresh proof;
- explicit statement that no Cloud mutation occurred, or exact approved Cloud operation if one occurred.
