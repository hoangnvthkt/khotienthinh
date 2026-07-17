# VIOO Business Role and Minimal SoD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline and sequentially in the current session. Do not use subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable Business Role assignments, explainable effective permissions, separated administration duties, permission-risk metadata and a minimal fail-closed SoD/override foundation without prematurely performing the Phase 3 legacy cutover.

**Architecture:** Keep `role_permission_templates` as Business Role definitions and add temporal, scoped assignments to users. A private, authoritative resolver unions `ROLE`, `DIRECT` and `LEGACY` sources and becomes the single implementation behind `app_private.has_permission`; compatibility flags preserve current production behavior until explicit cutover checkpoints disable legacy `ADMIN` governance authority and automatic business approvals independently. Typed SoD rules, audited mutation commands and short-lived override evidence are additive contracts that Phase 3–7 consume rather than replace.

**Tech Stack:** PostgreSQL/Supabase migrations, RLS and RPC, Supabase JS 2.98, React 18, TypeScript 5.8, Vitest 4, Vite 6, existing notification and permission registries.

## Global Constraints

- Execute sequentially and inline in the current working session; do not use subagents.
- Use strict TDD for every behavior change: failing focused test, observed failure, minimal implementation, focused pass, wider regression pass, commit.
- **Operator-approved Cloud-only TDD override (2026-07-17):** this environment does not use Docker or local Supabase. Any later task text that says `--local`, `supabase start` or `supabase db reset` is replaced by the rollback-only linked-Cloud protocol in the preflight section below. No Phase 2 schema or migration-history change may persist before Task 13.
- Do not use `supabase db push`. Create every migration with `npx supabase migration new <descriptive-name>` and apply Cloud SQL only through explicit transactions after an operator checkpoint.
- Treat each fenced shell block as a fresh process: re-resolve migration paths in every block that uses them and never depend on an exported variable from an earlier step.
- Do not edit already-applied migration files. Every database correction is a new forward migration.
- Task 4 intentionally creates the still-local governance migration and Task 5 completes that same file before any linked apply; never apply or mark its intermediate Task 4 version as executed. Once Task 5 closes, treat it as immutable and use only forward migrations.
- Preserve the Phase 1 PASS closure recorded in commit `baa23ca`: the operator accepted thorough manual testing in lieu of the unelapsed remainder of the 24-hour/Dashboard-log collection and explicitly authorized Phase 2 implementation. Do not rewrite that waiver as if the full elapsed observation evidence had been collected.
- Derive the actor only from `public.current_app_user_id()` or the trusted server boundary. No browser payload may supply or impersonate the actor.
- Keep service-role/secret keys server-only. This phase requires no new Edge Function and no client secret.
- Enable RLS on every new `public` table, revoke `anon` and `PUBLIC`, grant only explicit read/execute privileges, and route all mutation through self-authorizing RPCs.
- Keep privileged helpers in `app_private`, use `security definer set search_path = ''`, schema-qualify every relation/function and revoke function execution from unintended roles.
- Do not use JWT `user_metadata` for authorization. The database app profile and governance tables remain authoritative.
- `Role.ADMIN` remains the compatibility identity/System Admin marker used by Phase 1 account lifecycle and last-admin protection. It must stop being a business-approval bypass, but it is not removed or expanded in this phase.
- `SYSTEM_ADMIN` assignment mirrors that compatibility identity; the generic role command cannot create or revoke the mirror independently of `users.role = 'ADMIN'`. Phase 3's atomic profile command owns future promotion/demotion synchronization.
- Treat `system.settings.manage` as identity-bound: it may exist only in the seed-controlled `SYSTEM_ADMIN` role and may be effective only for a `Role.ADMIN` profile. Custom roles and direct grants cannot mint System Admin identity.
- Preserve at least one durable rollout operator: an active legacy `Role.ADMIN` with an explicit, non-expiring Business Role source for `system.authorization.manage_roles`. This is the recoverability path for compatibility flags, not a business-approval bypass.
- Do not introduce role hierarchy, nested groups, multi-tenant policy, negative grants, free-form policy expressions or a general policy DSL.
- Do not add Phase 3 module lifecycle/source-mode tables in this plan. The resolver must expose a stable seam for Phase 3 to constrain only the `LEGACY` branch.
- A sensitive direct grant requires a future `expires_at`; every actual direct-grant change requires a recorded reason of at least ten characters.
- Phase 2 role assignments become effective immediately; preserve `starts_at` in the stable schema but reject a future start. Future scheduling is enabled only with Phase 3 interval-overlap SoD revalidation, so a latent role cannot become conflicting without a governed command.
- Hard SoD rules cannot be overridden. Only rules explicitly seeded as `REQUIRE_OVERRIDE` may create override evidence.
- A warning acceptance expiry is a mandatory control-review deadline, not an automatic permission-expiry engine. Rollout/operations must report expired acceptance plus still-live conflicting sources; Phase 3 atomic changes and Phase 7 periodic review consume that report and revoke/reissue deliberately.
- Frontend permission checks remain UX only. SQL/RLS/RPC is the enforcing boundary.
- Browser-visible database exceptions must contain only stable, generic domain messages and SQLSTATEs. Prevalidate foreign keys/constraints and translate unexpected constraint failures inside the private command; hiding `details`/`hint` in React is not the security boundary.
- Mutation retries are explicit: override replays by idempotency key, direct replacement and rollout changes return cleanly on exact no-op, revoke replays safely, and non-idempotent create/assign commands are never auto-retried by the client.
- Use one cross-command lock order: target `users` row, then role definition, then assignment/grant rows. Lifecycle already owns the user row before revoking access; role/direct commands must never lock an assignment/grant first and then wait on its user.
- Keep `HANDOFF_SUMMARY.md` untouched as a pre-existing user modification.
- Treat the committed Phase 1 lifecycle plan and `docs/security/phase01-account-lifecycle-live-apply-log.md` as immutable historical evidence during Phase 2; stage them only if an actual Phase 1 correction is independently reviewed and required.

Every browser-callable mutation's private implementation must end with the same safe exception policy after its domain validations:

```sql
exception
  when insufficient_privilege then
    raise exception 'Authorization command is not allowed' using errcode = '42501';
  when unique_violation then
    raise exception 'Authorization command conflicts with current state' using errcode = '23505';
  when foreign_key_violation or check_violation or invalid_text_representation then
    raise exception 'Authorization command payload is invalid' using errcode = '23514';
  when others then
    raise log 'Authorization command failed with SQLSTATE %', sqlstate;
    raise exception 'Authorization command failed' using errcode = 'P0001';
```

Where a documented command intentionally exposes `22023` or `55000`, add those named conditions before `when others` and rethrow a generic domain message with the same SQLSTATE. Never attach `DETAIL`/`HINT`, interpolate payload values, constraint names, SQL text, Auth IDs or secret material into the browser response.

---

## Approved Phase Boundary

Phase 2 delivers:

1. Temporal, scoped `principal_role_assignments` for `principal_type = 'user'` while leaving the schema extensible to future principal types.
2. A stable source-explanation contract for `ROLE`, `DIRECT` and `LEGACY`.
3. Separate `SYSTEM_ADMIN`, `PERMISSION_ADMIN`, `BUSINESS_SCOPE_ADMIN`, `BUSINESS_USER` and `AUDITOR` Business Role definitions.
4. Permission risk metadata and explicit business-approval classification.
5. Typed SoD decisions, warning acknowledgements and non-hard override evidence.
6. Account-disable integration so a newly introduced role assignment can never survive disable/reactivate.
7. Administration UI and auth hydration that consume the backend resolver.

Phase 2 deliberately does not deliver:

- Per-user/module/scope legacy source modes, module lifecycle states or projection guards; those are Phase 3.
- A combined profile + role + direct + source-mode atomic save; Phase 3 composes the Phase 2 commands into that transaction.
- Daily Log notification/assignment cutover; that is Phase 4.
- Maker-checker adoption across every Project/ERP module; Phase 5–6 consume the Phase 2 typed guards module by module.
- Wiring subject-relation SoD into the Daily Log and Payment transition RPCs. Phase 2 proves the typed private guard denies at the database boundary; Phase 4 wires and canaries Daily Log, and Phase 5 redesigns Payment approval/mark-paid and removes its caller-supplied actor parameter before claiming workflow-level enforcement.
- Replacing module-owned responsibility-slot authorization with `system.authorization.manage_scopes`. Phase 2 makes that permission scope-capable and seeds the `BUSINESS_SCOPE_ADMIN` role; Phase 4–6 bind each module's assignment commands to it without granting Business Scope Admin global role/grant administration.
- Legacy helper removal; that is Phase 7.

## Stable Inter-Phase Contracts

| Phase 2 contract | Phase 3–7 consumer | Compatibility rule |
| --- | --- | --- |
| `public.principal_role_assignments` | Phase 3 permission admin command; Phase 4–6 module onboarding; Phase 7 access review | Add columns only; do not rename assignment identity, scope, time or revoke fields. |
| `app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamptz)` | All backend authorization and source explanation | Phase 3 may filter the `LEGACY` CTE, but must not change the function signature or source labels. |
| `app_private.has_permission(uuid,text,text,text)` | Existing RLS/RPC plus all later module migrations | Remains the boolean facade; consumers do not query grant tables directly. |
| Resolver/governance/admin-approval rollout flags | Phase 2 staged cutover and Phase 3 source-mode rollout | Flags stay independently reversible; Phase 3 adds per-user/module/scope modes instead of overloading these global emergency controls. |
| Identity-bound `SYSTEM_ADMIN` mirror and `app_private.assert_rollout_operator_continuity(...)` | Phase 3 atomic profile command and operational rollback | Profile promotion/demotion must preserve mirror/audit and cannot remove the last durable explicit rollout operator. |
| `permission_actions.risk_level`, `is_business_action`, `is_business_approval`, `direct_grant_requires_expiry` | Phase 3 coverage UI; Phase 4–6 module gates | New permission seeds must set all four fields before a module reaches `NEW_ONLY`; module assignment commands consume scoped `system.authorization.manage_scopes` rather than `manage_roles`. |
| `authorization_sod_rules` and `app_private.assert_subject_sod(...)` | Daily Log, Payment, WMS, Payroll and later workflows | Registry stays typed/seed-controlled; no administrator-authored expression language. Phase 2 tests the guard directly; each module owns the forward migration that binds real creator/submitter/executor fields to it. |
| `authorization_sod_warning_acceptances` | Phase 3 atomic save and periodic review | Append-only; later commands reuse the same validation helper. |
| `authorization_override_events` and `app_private.has_valid_authorization_override(uuid,text,uuid,text,text,text,text,timestamptz)` | Explicitly overridable workflow exceptions | Validation binds rule, actor, subject and scope; hard-deny rules never consult override evidence. |
| `permission_audit_events.metadata` source/command identifiers | Phase 3–7 reporting | Append new metadata keys; do not rewrite historical events. |

## File Responsibility Map

**Database and smoke coverage**

- Create: `supabase/migrations/<generated>_authorization_business_role_foundation.sql` — risk metadata, Business Role assignments, governance permission seeds and RLS/ACL baseline.
- Create: `supabase/migrations/<generated>_authorization_effective_permission_resolver.sql` — source resolver, compatibility flags and boolean facade.
- Create: `supabase/migrations/<generated>_authorization_minimal_sod_registry.sql` — typed SoD registry, decisions and warning acknowledgements.
- Create: `supabase/migrations/<generated>_authorization_governance_commands.sql` — role definition/assignment and direct-grant commands.
- Create: `supabase/migrations/<generated>_authorization_account_lifecycle_integration.sql` — role revocation and lifecycle preview/summary integration.
- Create: `supabase/migrations/<generated>_authorization_override_evidence.sql` — idempotent override record, audit and control-owner notification.
- Create: `supabase/tests/business_role_effective_permission_smoke.sql` — resolver, scope, source and System Admin negative coverage.
- Create: `supabase/tests/authorization_sod_smoke.sql` — typed warning and hard subject-guard behavior before override evidence exists.
- Create: `supabase/tests/authorization_governance_commands_smoke.sql` — role/direct command, self-grant and warning coverage.
- Create: `supabase/tests/authorization_override_smoke.sql` — hard-deny non-overridability, idempotency, audit and notification coverage.
- Create: `lib/__tests__/authorizationBusinessRoleMigration.test.ts` — static migration security contract.
- Create: `lib/__tests__/authorizationSodMigration.test.ts` — static SoD/override contract.

**Frontend authorization core**

- Create: `lib/permissions/authorizationGovernanceTypes.ts` — Phase 2 domain types.
- Create: `lib/permissions/permissionRisk.ts` — deterministic client display classification matching seeded DB metadata.
- Create: `lib/permissions/authorizationGovernanceService.ts` — RPC mappings and safe error contract.
- Create: `lib/permissions/authorizationGovernanceViewModel.ts` — pure grouping/diff/warning helpers used by UI.
- Modify: `lib/permissions/permissionTypes.ts` — action risk/business metadata.
- Modify: `lib/permissions/permissionRegistry.ts` — governance permission module and metadata.
- Modify: `lib/permissions/projectPermissionRegistry.ts` — attach derived metadata to Project actions.
- Modify: `lib/permissions/erpPermissionRegistry.ts` — attach derived metadata to ERP actions.
- Modify: `lib/permissions/permissionService.ts` — prefer authoritative effective sources and remove client business-approval admin bypass.
- Modify: `lib/permissions/projectPermissionService.ts` — role/direct/legacy source-aware scoped checks.
- Modify: `lib/routeAccess.ts` — effective-source-aware navigation without granting business approval.
- Modify: `types.ts` — add effective-source hydration and lifecycle role counts.
- Modify: `context/authState.ts` and `context/AuthContext.tsx` — load effective sources from the RPC after active-profile verification.

**Administration UI**

- Create: `components/permissions/EffectivePermissionSourceList.tsx` — source/scope/time badges.
- Create: `components/permissions/BusinessRoleEditor.tsx` — controlled role definition editor and impact preview.
- Create: `components/permissions/PrincipalRoleAssignmentPanel.tsx` — assign/revoke temporal scoped roles.
- Create: `components/permissions/PrincipalDirectGrantPanel.tsx` — standalone governed direct-grant editor for Permission Admins without account-profile authority.
- Create: `components/permissions/SodWarningPanel.tsx` — required reason/owner/expiry/compensating-control capture.
- Create: `components/permissions/AuthorizationOverrideDialog.tsx` — explicit override evidence form.
- Create: `pages/settings/SettingsAuthorizationGovernance.tsx` — orchestration page for roles, principals, sources and audit controls.
- Modify: `components/permissions/PermissionMatrix.tsx` — risk and source badges without conflating inherited with checked direct state.
- Modify: `components/permissions/PermissionDiffPreview.tsx` — role/direct/source-aware preview.
- Modify: `components/UserModal.tsx` — reason/expiry/SoD preview for direct grants and effective-source display.
- Modify: `pages/Settings.tsx` — permission-gated Authorization tab.

**Tests and rollout evidence**

- Create: `lib/__tests__/permissionRisk.test.ts`.
- Create: `lib/__tests__/authorizationGovernanceService.test.ts`.
- Create: `lib/__tests__/authorizationGovernanceViewModel.test.ts`.
- Modify: `lib/__tests__/permissionService.test.ts`.
- Modify: `lib/__tests__/projectPermissionService.test.ts`.
- Modify: `lib/__tests__/routeAccess.test.ts`.
- Modify: `lib/__tests__/permissionRegistry.test.ts`.
- Modify: `lib/__tests__/authBoundary.test.tsx`.
- Modify: `lib/__tests__/userAccountLifecycleService.test.ts`.
- Create: `docs/security/phase02-business-role-sod-live-apply-log.md`.
- Modify: `docs/security/permission-refactor-roadmap.md` — align old phase labels with the Approved program roadmap and link this plan.

---

## Execution Handoff Precondition

After the operator reviews this plan and before Task 1 changes code, record the approved plan itself in a dedicated commit so the eventual canary SHA contains the exact reviewed instructions:

```bash
git add docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
git commit -m "docs(authz): plan business role and minimal sod"
```

Inspect the staged diff first. Do not include the committed Phase 1 plan/log or `HANDOFF_SUMMARY.md` in this commit. If the operator has not approved committing the plan, stop here; do not start implementation from an untracked or changing plan.

---

## One-Time Cloud Rollback-Only Database TDD Preflight

The operator explicitly requires Supabase Cloud and does not use Docker or a
local Supabase stack. Before Task 1, verify the existing linked project and
read-only baseline without printing `.env` values:

```bash
npx supabase --version
npx supabase db query --linked --agent=no \
  "select current_database() is not null as connected, current_setting('server_version_num')::integer >= 150000 as postgres_15_plus;"
```

Every database task must then follow RED/GREEN against linked Cloud without
persisting candidate schema changes before Task 13:

1. Write or extend the task's static contract and SQL smoke before
   creating/editing its migration.
2. For RED, run the smoke against the current committed Cloud schema inside
   `begin; set local lock_timeout='5s'; set local statement_timeout='120s'; ... rollback;`
   and observe the expected non-zero result caused by the missing feature.
3. Create migrations only through `npx supabase migration new <name>` and add
   the minimal implementation.
4. For GREEN, concatenate every Phase 2 migration through the current task and
   the same smoke into one temporary file wrapped by `begin; ... rollback;`,
   then execute it with `npx supabase db query --linked --agent=no --file`.
5. Require an explicit success checkpoint immediately before `rollback`; query
   the committed Cloud schema afterward to prove the candidate objects and
   migration-history versions did not persist.

Use the linked CLI authentication backed by `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD`; never print, interpolate into command output or commit
their values. Never use `VITE_SUPABASE_ANON_KEY` or a service-role key for
schema work. A disconnect after sending a rollback-only transaction requires a
read-only schema fingerprint before any retry. Do not weaken an assertion or
commit schema early merely to obtain GREEN.

---

### Task 1: Add the Business Role and permission-risk schema foundation

**Files:**

- Create: `lib/__tests__/authorizationBusinessRoleMigration.test.ts`
- Create: `supabase/migrations/<generated>_authorization_business_role_foundation.sql`
- Create: `supabase/tests/business_role_effective_permission_smoke.sql`

**Interfaces:**

- Consumes: existing `permission_actions`, `role_permission_templates`, `role_permission_template_items`, `users`, `permission_audit_events` and `app_private.assert_active_principal(uuid)`.
- Produces: `public.principal_role_assignments`; four risk columns on `permission_actions`; `is_system`/`version` on role templates; governance permission codes and five seeded Business Roles.

- [x] **Step 1: Write the failing migration contract test**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(dir)
  .filter(file => file.endsWith('_authorization_business_role_foundation.sql'))
  .sort();
const sql = files.length === 1 ? readFileSync(join(dir, files[0]), 'utf8') : '';
const normalized = sql.replace(/\s+/g, ' ').trim();

describe('authorization Business Role foundation migration', () => {
  it('has one forward migration with risk metadata', () => {
    expect(files).toHaveLength(1);
    expect(normalized).toMatch(/add column if not exists risk_level text/i);
    expect(normalized).toMatch(/add column if not exists is_business_action boolean/i);
    expect(normalized).toMatch(/add column if not exists is_business_approval boolean/i);
    expect(normalized).toMatch(/add column if not exists direct_grant_requires_expiry boolean/i);
  });

  it('creates temporal scoped role assignments without a polymorphic foreign key', () => {
    expect(normalized).toMatch(/create table public\.principal_role_assignments/i);
    expect(normalized).toMatch(/principal_type text not null/i);
    expect(normalized).toMatch(/principal_id uuid not null/i);
    expect(normalized).toMatch(/role_template_id uuid not null references public\.role_permission_templates/i);
    expect(normalized).toMatch(/status text not null default 'ACTIVE'/i);
    expect(normalized).toMatch(/assigned_reason text not null/i);
    expect(normalized).toMatch(/revoked_reason text/i);
    expect(normalized).not.toMatch(/principal_id uuid[^,]*references/i);
  });

  it('uses RLS, least privilege and no authenticated direct mutation', () => {
    expect(normalized).toMatch(/alter table public\.principal_role_assignments enable row level security/i);
    expect(normalized).toMatch(/revoke all privileges on table public\.principal_role_assignments from public, anon, authenticated/i);
    expect(normalized).toMatch(/grant select on table public\.principal_role_assignments to authenticated/i);
    expect(normalized).toMatch(/drop policy if exists permission_audit_events_insert/i);
    expect(normalized).toMatch(/drop policy if exists user_permission_grants_(insert|update|delete)/i);
    expect(normalized).not.toMatch(/grant (insert|update|delete).*principal_role_assignments.*authenticated/i);
  });

  it('seeds separated governance roles and permissions', () => {
    for (const code of ['SYSTEM_ADMIN', 'PERMISSION_ADMIN', 'BUSINESS_SCOPE_ADMIN', 'BUSINESS_USER', 'AUDITOR']) {
      expect(sql).toContain(`'${code}'`);
    }
    for (const code of [
      'system.authorization.view',
      'system.authorization.manage_roles',
      'system.authorization.manage_grants',
      'system.authorization.manage_scopes',
      'system.authorization.audit',
      'system.authorization.override',
    ]) {
      expect(sql).toContain(`'${code}'`);
    }
  });
});
```

Also create `business_role_effective_permission_smoke.sql` with foundation assertions for risk columns, five seed definitions, reserved-code/identity-bound preconditions, bootstrap assignment/audit parity, RLS/ACL denial, active-principal rejection, future-start rejection and assignment FK/index presence. Keep fixtures disposable; the caller supplies the transaction.

- [x] **Step 2: Run the focused test and observe the missing-migration failure**

Run:

```bash
npm test -- lib/__tests__/authorizationBusinessRoleMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/business_role_effective_permission_smoke.sql)"
```

Expected: both commands FAIL because the migration/schema does not exist. Record the failing assertion names before implementation.

- [x] **Step 3: Discover the CLI and create the migration through Supabase CLI**

```bash
npx supabase --version
npx supabase migration --help
npx supabase migration new authorization_business_role_foundation
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
test -n "$FOUNDATION_MIGRATION"
```

Expected: exactly one generated migration path; do not rename its timestamp.

- [x] **Step 4: Add risk metadata, assignment schema, indexes and active-principal guard**

The generated migration must contain these exact schema decisions:

```sql
alter table public.permission_actions
  add column if not exists risk_level text not null default 'normal',
  add column if not exists is_business_action boolean not null default false,
  add column if not exists is_business_approval boolean not null default false,
  add column if not exists direct_grant_requires_expiry boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'permission_actions_risk_level_check'
      and conrelid = 'public.permission_actions'::regclass
  ) then
    alter table public.permission_actions
      add constraint permission_actions_risk_level_check
      check (risk_level in ('normal', 'important', 'sensitive'));
  end if;
end;
$$;

alter table public.role_permission_templates
  add column if not exists is_system boolean not null default false,
  add column if not exists version integer not null default 1;

alter table public.user_permission_grants
  add column if not exists grant_reason text;

create table public.principal_role_assignments (
  id uuid primary key default gen_random_uuid(),
  principal_type text not null default 'user'
    check (principal_type ~ '^[a-z][a-z0-9_]*$'),
  principal_id uuid not null,
  role_template_id uuid not null
    references public.role_permission_templates(id) on delete restrict,
  scope_type text not null default 'global'
    check (scope_type in ('global','own','assigned','project','construction_site','warehouse','department')),
  scope_id text not null default '*',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE','REVOKED','EXPIRED')),
  assigned_by uuid references public.users(id) on delete set null,
  assigned_reason text not null check (char_length(btrim(assigned_reason)) >= 10),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at <= created_at),
  check (expires_at is null or expires_at > starts_at),
  check (
    (status = 'REVOKED' and revoked_at is not null and char_length(btrim(coalesce(revoked_reason, ''))) >= 10)
    or (status <> 'REVOKED')
  )
);

create unique index principal_role_assignments_one_active_idx
  on public.principal_role_assignments (
    principal_type, principal_id, role_template_id, scope_type, scope_id
  ) where status = 'ACTIVE';

create index principal_role_assignments_principal_effective_idx
  on public.principal_role_assignments (principal_type, principal_id, status, starts_at, expires_at);

create index principal_role_assignments_role_effective_idx
  on public.principal_role_assignments (role_template_id, status, starts_at, expires_at);

create index principal_role_assignments_scope_idx
  on public.principal_role_assignments (scope_type, scope_id, status);

create or replace function app_private.guard_principal_role_assignment_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.principal_type <> 'user' then
    raise exception 'Only user principals are supported in authorization Phase 2'
      using errcode = '22023';
  end if;
  if new.status = 'ACTIVE' then
    perform app_private.assert_active_principal(new.principal_id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_principal_role_assignment_principal()
  from public, anon, authenticated;

create trigger trg_principal_role_assignments_active_principal
  before insert or update of principal_type, principal_id, status
  on public.principal_role_assignments
  for each row execute function app_private.guard_principal_role_assignment_principal();
```

- [x] **Step 5: Seed explicit risk metadata and governance permissions**

Use `permission_modules.application_code` to classify business actions, and explicitly classify approvals rather than granting on action-name inference at runtime:

```sql
update public.permission_actions pa
set is_business_action = pm.application_code <> 'system',
    risk_level = case
      when pa.action in ('approve','confirm','verify','mark_paid','publish','complete','lock') then 'sensitive'
      when pa.action in ('manage','edit_all','delete_all','export','perform','assign_staff','grant_permissions') then 'important'
      else 'normal'
    end,
    is_business_approval = (
      pm.application_code <> 'system'
      and pa.action in ('approve','confirm','verify','mark_paid','publish','complete','lock')
    ),
    direct_grant_requires_expiry = (
      pa.action in ('approve','confirm','verify','mark_paid','publish','complete','lock')
    ),
    updated_at = now()
from public.permission_modules pm
where pm.code = pa.module_code;

insert into public.permission_modules (
  application_code, code, name, description, routes, legacy_module_key, sort_order, is_active
)
values (
  'system', 'system.authorization', 'Quản trị phân quyền',
  'Business Role, direct grant, SoD và audit phân quyền',
  array['/settings']::text[], 'SETTINGS', 135, true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code, action, permission_code, label, description, scope_modes,
  legacy_module_key, legacy_route, legacy_admin_only, sort_order,
  risk_level, is_business_action, is_business_approval,
  direct_grant_requires_expiry, is_active
)
values
  ('system.authorization','view','system.authorization.view','Xem quản trị phân quyền',null,array['global']::text[],'SETTINGS','/settings',true,10,'normal',false,false,false,true),
  ('system.authorization','manage_roles','system.authorization.manage_roles','Quản lý Business Role',null,array['global']::text[],'SETTINGS','/settings',true,20,'sensitive',false,false,true,true),
  ('system.authorization','manage_grants','system.authorization.manage_grants','Quản lý quyền trực tiếp',null,array['global']::text[],'SETTINGS','/settings',true,30,'sensitive',false,false,true,true),
  ('system.authorization','manage_scopes','system.authorization.manage_scopes','Quản lý phân công theo scope',null,array['global','project','construction_site','warehouse','department']::text[],'SETTINGS','/settings',true,40,'important',false,false,false,true),
  ('system.authorization','audit','system.authorization.audit','Xem audit phân quyền',null,array['global']::text[],'SETTINGS','/settings',true,50,'important',false,false,false,true),
  ('system.authorization','override','system.authorization.override','Ghi nhận override được phép',null,array['global']::text[],'SETTINGS','/settings',true,60,'sensitive',false,false,true,true)
on conflict (permission_code) do update
set label = excluded.label,
    scope_modes = excluded.scope_modes,
    risk_level = excluded.risk_level,
    is_business_action = excluded.is_business_action,
    is_business_approval = excluded.is_business_approval,
    direct_grant_requires_expiry = excluded.direct_grant_requires_expiry,
    is_active = true,
    updated_at = now();
```

- [x] **Step 6: Seed the five Business Roles and compatibility assignments**

Seed role definitions idempotently. Existing active legacy admins receive two separate assignments—`SYSTEM_ADMIN` and `PERMISSION_ADMIN`—so production administration remains available while the sources are independently auditable/revocable. Neither role contains a business approval permission.

```sql
do $$
begin
  if exists (
    select 1
    from public.role_permission_templates role_template
    where role_template.code in (
      'SYSTEM_ADMIN','PERMISSION_ADMIN','BUSINESS_SCOPE_ADMIN','BUSINESS_USER','AUDITOR'
    )
      and not role_template.is_system
  ) then
    raise exception 'Reserved Phase 2 Business Role code already exists'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.permission_code = 'system.settings.manage'
      and grant_row.is_active
  ) or exists (
    select 1
    from public.role_permission_template_items item
    join public.role_permission_templates role_template
      on role_template.id = item.template_id
    where item.permission_code = 'system.settings.manage'
      and role_template.code <> 'SYSTEM_ADMIN'
  ) then
    raise exception 'System identity permission requires operator remediation before Phase 2'
      using errcode = '55000';
  end if;
end;
$$;

insert into public.role_permission_templates (code, name, description, is_active, is_system)
values
  ('SYSTEM_ADMIN','System Admin','Tài khoản, cấu hình hệ thống và vận hành kỹ thuật',true,true),
  ('PERMISSION_ADMIN','Permission Admin','Business Role, grant và kiểm soát phân quyền',true,true),
  ('BUSINESS_SCOPE_ADMIN','Business Scope Admin','Phân công trách nhiệm trong scope được ủy quyền',true,true),
  ('BUSINESS_USER','Business User','Vai trò nền không tự cấp quyền nghiệp vụ',true,true),
  ('AUDITOR','Auditor','Đọc cấu hình và lịch sử kiểm soát, không sửa hoặc duyệt',true,true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    is_system = true,
    updated_at = now();

insert into public.role_permission_template_items (template_id, permission_code, scope_type, scope_id, sort_order)
select rt.id, item.permission_code, 'global', '*', item.sort_order
from public.role_permission_templates rt
join (values
  ('SYSTEM_ADMIN','system.settings.manage',10),
  ('SYSTEM_ADMIN','system.authorization.view',20),
  ('PERMISSION_ADMIN','system.authorization.view',10),
  ('PERMISSION_ADMIN','system.authorization.manage_roles',20),
  ('PERMISSION_ADMIN','system.authorization.manage_grants',30),
  ('PERMISSION_ADMIN','system.authorization.manage_scopes',40),
  ('PERMISSION_ADMIN','system.authorization.audit',50),
  ('BUSINESS_SCOPE_ADMIN','system.authorization.manage_scopes',10),
  ('AUDITOR','system.authorization.view',10),
  ('AUDITOR','system.authorization.audit',20)
) item(role_code, permission_code, sort_order)
  on item.role_code = rt.code
on conflict (template_id, permission_code, scope_type, scope_id) do update
set sort_order = excluded.sort_order;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_by, assigned_reason
)
select 'user', u.id, rt.id, 'global', '*', now(), 'ACTIVE', null,
       'Phase 2 bootstrap from active legacy System Admin'
from public.users u
cross join public.role_permission_templates rt
where u.role = 'ADMIN'
  and u.is_active
  and u.account_status = 'ACTIVE'
  and rt.code in ('SYSTEM_ADMIN','PERMISSION_ADMIN')
on conflict (principal_type, principal_id, role_template_id, scope_type, scope_id)
  where status = 'ACTIVE'
do nothing;

insert into public.permission_audit_events (
  actor_user_id, target_user_id, event_type,
  before_grants, after_grants, metadata
)
select
  null,
  assignment.principal_id,
  'business_role_bootstrapped',
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object(
    'assignmentId', assignment.id,
    'roleCode', role_template.code,
    'source', 'phase02_migration',
    'reason', assignment.assigned_reason
  )
from public.principal_role_assignments assignment
join public.role_permission_templates role_template
  on role_template.id = assignment.role_template_id
where assignment.status = 'ACTIVE'
  and role_template.code in ('SYSTEM_ADMIN','PERMISSION_ADMIN')
  and assignment.assigned_reason = 'Phase 2 bootstrap from active legacy System Admin'
  and not exists (
    select 1
    from public.permission_audit_events event_row
    where event_row.event_type = 'business_role_bootstrapped'
      and event_row.metadata ->> 'assignmentId' = assignment.id::text
  );
```

The precondition is deliberate and runs before any reserved-role seed. Task 12 inventories aggregate conflicts read-only; the operator must revoke/reissue an existing direct identity grant or rename/review a colliding template before Cloud apply. Never silently take over a pre-existing role code or convert a direct grant into System Admin identity.

Bootstrap audit uses the migration as source and a null human actor; it records application user/assignment identity only in the protected audit table, never an Auth ID or secret.

- [x] **Step 7: Apply RLS and least-privilege ACLs**

```sql
alter table public.principal_role_assignments enable row level security;

revoke all privileges on table public.principal_role_assignments from public, anon, authenticated;
grant select on table public.principal_role_assignments to authenticated;

create policy principal_role_assignments_self_select
on public.principal_role_assignments for select
to authenticated
using (
  principal_type = 'user'
  and principal_id = (select public.current_app_user_id())
);

revoke insert, update, delete on table public.role_permission_templates from authenticated;
revoke insert, update, delete on table public.role_permission_template_items from authenticated;
revoke insert, update, delete on table public.user_permission_grants from authenticated;
revoke insert, update, delete on table public.permission_audit_events from authenticated;

drop policy if exists role_permission_templates_insert on public.role_permission_templates;
drop policy if exists role_permission_templates_update on public.role_permission_templates;
drop policy if exists role_permission_templates_delete on public.role_permission_templates;
drop policy if exists role_permission_template_items_insert on public.role_permission_template_items;
drop policy if exists role_permission_template_items_update on public.role_permission_template_items;
drop policy if exists role_permission_template_items_delete on public.role_permission_template_items;
drop policy if exists user_permission_grants_insert on public.user_permission_grants;
drop policy if exists user_permission_grants_update on public.user_permission_grants;
drop policy if exists user_permission_grants_delete on public.user_permission_grants;
drop policy if exists permission_audit_events_insert on public.permission_audit_events;
```

Expected: authenticated clients can read their own assignment and approved catalogs, but cannot directly mutate grants, roles, assignments or audit rows. Defense does not depend on ACL alone: legacy authenticated mutation policies are removed as well.

- [x] **Step 8: Run the focused test and migration formatting checks**

```bash
npx supabase db reset --local --no-seed
npm test -- lib/__tests__/authorizationBusinessRoleMigration.test.ts
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
git diff --check -- "$FOUNDATION_MIGRATION" lib/__tests__/authorizationBusinessRoleMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/business_role_effective_permission_smoke.sql)"
```

Expected: static and SQL behavior tests PASS and no whitespace findings.

- [x] **Step 9: Commit Task 1**

```bash
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
git add "$FOUNDATION_MIGRATION" \
  supabase/tests/business_role_effective_permission_smoke.sql \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts
git commit -m "feat(authz): add business role foundation"
```

---

### Task 2: Add the authoritative effective-permission resolver

**Files:**

- Modify: `lib/__tests__/authorizationBusinessRoleMigration.test.ts`
- Create: `supabase/migrations/<generated>_authorization_effective_permission_resolver.sql`
- Modify: `supabase/tests/business_role_effective_permission_smoke.sql`

**Interfaces:**

- Consumes: Task 1 role assignments/risk metadata and existing `app_private.permission_hardening_settings`.
- Produces: `app_private.scope_covers(...)`, `app_private.resolve_effective_permission_sources(...)`, authoritative `app_private.has_permission(...)`, `public.get_effective_permission_sources(...)` and three rollout flags.

- [x] **Step 1: Extend the static contract with resolver and compatibility requirements**

Add a second suffix loader and these assertions:

```ts
const resolverFiles = readdirSync(dir)
  .filter(file => file.endsWith('_authorization_effective_permission_resolver.sql'))
  .sort();
const resolverSql = resolverFiles.length === 1
  ? readFileSync(join(dir, resolverFiles[0]), 'utf8')
  : '';
const resolverNormalized = resolverSql.replace(/\s+/g, ' ').trim();

it('adds one private source resolver behind the existing boolean facade', () => {
  expect(resolverFiles).toHaveLength(1);
  expect(resolverNormalized).toMatch(/create or replace function app_private\.resolve_effective_permission_sources\(/i);
  expect(resolverNormalized).toMatch(/source_type text/i);
  expect(resolverSql).toContain("'ROLE'");
  expect(resolverSql).toContain("'DIRECT'");
  expect(resolverSql).toContain("'LEGACY'");
  expect(resolverNormalized).toMatch(/create or replace function app_private\.has_permission\(/i);
  expect(resolverNormalized).not.toMatch(/where u\.role = 'ADMIN'\s*\)\s*or exists/i);
});

it('uses explicit rollout flags for resolver, governance separation and business approval', () => {
  expect(resolverSql).toContain("'business_role_resolver_enabled'");
  expect(resolverSql).toContain("'legacy_governance_fallback_disabled'");
  expect(resolverSql).toContain("'system_admin_business_approval_bypass_disabled'");
  expect(resolverNormalized).toMatch(/user_row\.role = 'ADMIN'.*system\.authorization.*legacy_governance_fallback_disabled/is);
  expect(resolverNormalized).toMatch(/user_row\.role = 'ADMIN'.*system_admin_business_approval_bypass_disabled/is);
  expect(resolverNormalized).toMatch(/user_row\.role = 'ADMIN'.*action_row\.is_business_approval/is);
});

it('keeps System Admin identity permission bound to its profile mirror', () => {
  expect(resolverNormalized).toMatch(/system\.settings\.manage.*role_template\.code = 'SYSTEM_ADMIN'.*user_row\.role = 'ADMIN'/is);
  expect(resolverNormalized).toMatch(/direct_sources.*grant_row\.permission_code <> 'system\.settings\.manage'/is);
});

it('keeps the public explanation RPC actor-derived and read-only', () => {
  expect(resolverNormalized).toMatch(/v_actor_user_id uuid := public\.current_app_user_id\(\)/i);
  expect(resolverNormalized).toMatch(/create or replace function app_private\.get_effective_permission_sources_authorized\(/i);
  expect(resolverNormalized).toMatch(/create or replace function public\.get_effective_permission_sources/i);
  expect(resolverNormalized).toMatch(/create or replace function public\.get_effective_permission_sources\(.*?security invoker/is);
  expect(resolverNormalized).toMatch(/revoke all on function app_private\.resolve_effective_permission_sources\(uuid,text,text,text,timestamptz\) from public, anon, authenticated/i);
  expect(resolverNormalized).not.toMatch(/get_effective_permission_sources\([^)]*p_actor/i);
});
```

Before creating the resolver migration, extend `business_role_effective_permission_smoke.sql` with the role/direct/legacy, scoped denial and three-flag cases specified in Step 8.

- [x] **Step 2: Run the test and observe the resolver-migration failure**

```bash
npm test -- lib/__tests__/authorizationBusinessRoleMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/business_role_effective_permission_smoke.sql)"
```

Expected: static and SQL smoke FAIL against the Task 1 schema because the resolver migration does not exist.

- [x] **Step 3: Create the resolver migration with the CLI**

```bash
npx supabase migration new authorization_effective_permission_resolver
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
test -n "$RESOLVER_MIGRATION"
```

- [x] **Step 4: Add rollout flags and exact scope semantics**

```sql
insert into app_private.permission_hardening_settings (key, value)
values
  ('business_role_resolver_enabled', 'false'::jsonb),
  ('legacy_governance_fallback_disabled', 'false'::jsonb),
  ('system_admin_business_approval_bypass_disabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function app_private.scope_covers(
  p_grant_scope_type text,
  p_grant_scope_id text,
  p_requested_scope_type text,
  p_requested_scope_id text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_grant_scope_type = 'global'
    or (
      p_grant_scope_type = coalesce(p_requested_scope_type, 'global')
      and (
        coalesce(nullif(p_grant_scope_id, ''), '*') = '*'
        or coalesce(nullif(p_grant_scope_id, ''), '*') = coalesce(nullif(p_requested_scope_id, ''), '*')
      )
    );
$$;

revoke all on function app_private.scope_covers(text,text,text,text)
  from public, anon;
grant execute on function app_private.scope_covers(text,text,text,text)
  to authenticated;
```

No generic project-to-construction-site inheritance is added here. A module subject resolver must supply the actual requested scope; later module plans may check both project and site explicitly.

- [x] **Step 5: Implement the private source resolver with a stable return contract**

```sql
create or replace function app_private.resolve_effective_permission_sources(
  p_user_id uuid,
  p_permission_code text default null,
  p_scope_type text default null,
  p_scope_id text default null,
  p_at timestamptz default now()
)
returns table (
  permission_code text,
  source_type text,
  source_id text,
  source_code text,
  source_label text,
  scope_type text,
  scope_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  risk_level text,
  is_business_approval boolean,
  metadata jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with active_user as (
    select u.*
    from public.users u
    where u.id = p_user_id
      and u.is_active
      and u.account_status = 'ACTIVE'
  ),
  active_actions as (
    select pa.*, pm.application_code, pm.legacy_module_key as module_legacy_key
    from public.permission_actions pa
    join public.permission_modules pm on pm.code = pa.module_code
    where pa.is_active
      and pm.is_active
      and (p_permission_code is null or pa.permission_code = p_permission_code)
  ),
  role_sources as (
    select
      item.permission_code,
      'ROLE'::text as source_type,
      assignment.id::text as source_id,
      role_template.code as source_code,
      role_template.name as source_label,
      case
        when assignment.scope_type = 'global' then item.scope_type
        else assignment.scope_type
      end as scope_type,
      case
        when assignment.scope_type = 'global' then item.scope_id
        when item.scope_type = 'global' then assignment.scope_id
        when assignment.scope_id = '*' then item.scope_id
        else assignment.scope_id
      end as scope_id,
      assignment.starts_at,
      assignment.expires_at,
      action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object(
        'roleTemplateId', role_template.id,
        'assignmentId', assignment.id,
        'assignmentScopeType', assignment.scope_type,
        'assignmentScopeId', assignment.scope_id
      ) as metadata
    from active_user user_row
    join public.principal_role_assignments assignment
      on assignment.principal_type = 'user'
     and assignment.principal_id = user_row.id
     and assignment.status = 'ACTIVE'
     and assignment.starts_at <= p_at
     and (assignment.expires_at is null or assignment.expires_at > p_at)
    join public.role_permission_templates role_template
      on role_template.id = assignment.role_template_id
     and role_template.is_active
    join public.role_permission_template_items item
      on item.template_id = role_template.id
    join active_actions action_row
      on action_row.permission_code = item.permission_code
    where app_private.permission_hardening_flag('business_role_resolver_enabled')
      and (
        item.permission_code <> 'system.settings.manage'
        or (role_template.code = 'SYSTEM_ADMIN' and user_row.role = 'ADMIN')
      )
      and (
        assignment.scope_type = 'global'
        or item.scope_type = 'global'
        or (
          assignment.scope_type = item.scope_type
          and (assignment.scope_id = '*' or item.scope_id = '*' or assignment.scope_id = item.scope_id)
        )
      )
      and (
        p_scope_type is null
        or (
          app_private.scope_covers(assignment.scope_type, assignment.scope_id, p_scope_type, p_scope_id)
          and app_private.scope_covers(item.scope_type, item.scope_id, p_scope_type, p_scope_id)
        )
      )
  ),
  direct_sources as (
    select
      grant_row.permission_code,
      'DIRECT'::text,
      grant_row.id::text,
      'DIRECT'::text,
      'Direct grant'::text,
      grant_row.scope_type,
      grant_row.scope_id,
      grant_row.granted_at,
      grant_row.expires_at,
      action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object('grantedBy', grant_row.granted_by, 'reason', grant_row.grant_reason)
    from active_user user_row
    join public.user_permission_grants grant_row
      on grant_row.user_id = user_row.id
     and grant_row.is_active
     and grant_row.granted_at <= p_at
     and (grant_row.expires_at is null or grant_row.expires_at > p_at)
    join active_actions action_row
      on action_row.permission_code = grant_row.permission_code
    where grant_row.permission_code <> 'system.settings.manage'
      and (
        p_scope_type is null
        or app_private.scope_covers(grant_row.scope_type, grant_row.scope_id, p_scope_type, p_scope_id)
      )
  ),
  legacy_sources as (
    select
      action_row.permission_code,
      'LEGACY'::text,
      coalesce(action_row.legacy_module_key, action_row.module_legacy_key, 'legacy')::text,
      coalesce(action_row.legacy_module_key, action_row.module_legacy_key, 'LEGACY')::text,
      'Legacy permission'::text,
      'global'::text,
      '*'::text,
      null::timestamptz,
      null::timestamptz,
      action_row.risk_level,
      action_row.is_business_approval,
      jsonb_build_object(
        'legacyModuleKey', coalesce(action_row.legacy_module_key, action_row.module_legacy_key),
        'legacyRoute', action_row.legacy_route,
        'legacyAdminCompatibility', user_row.role = 'ADMIN'
      )
    from active_user user_row
    join active_actions action_row on true
    where not app_private.permission_hardening_flag('legacy_fallback_disabled')
      and (
        (
          user_row.role = 'ADMIN'
          and (
            (
              action_row.is_business_approval
              and not app_private.permission_hardening_flag('system_admin_business_approval_bypass_disabled')
            )
            or (
              action_row.module_code = 'system.authorization'
              and not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
            )
            or (
              not action_row.is_business_approval
              and action_row.module_code <> 'system.authorization'
            )
          )
        )
        or (
          user_row.role <> 'ADMIN'
          and (
            action_row.module_code <> 'system.authorization'
            or not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
          )
          and coalesce(action_row.legacy_module_key, action_row.module_legacy_key) is not null
          and case
            when action_row.legacy_admin_only or action_row.action = 'manage' then
              coalesce(action_row.legacy_module_key, action_row.module_legacy_key) = any(coalesce(user_row.admin_modules, '{}'::text[]))
              or (
                action_row.legacy_route is null
                and coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? coalesce(action_row.legacy_module_key, action_row.module_legacy_key)
              )
              or (
                action_row.legacy_route is not null
                and coalesce(user_row.admin_sub_modules -> coalesce(action_row.legacy_module_key, action_row.module_legacy_key), '[]'::jsonb) ? action_row.legacy_route
              )
            else
              user_row.allowed_modules is null
              or coalesce(action_row.legacy_module_key, action_row.module_legacy_key) = any(coalesce(user_row.allowed_modules, '{}'::text[]))
              or coalesce(action_row.legacy_module_key, action_row.module_legacy_key) = any(coalesce(user_row.admin_modules, '{}'::text[]))
              or (
                action_row.legacy_route is null
                and (
                  coalesce(user_row.allowed_sub_modules, '{}'::jsonb) ? coalesce(action_row.legacy_module_key, action_row.module_legacy_key)
                  or coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? coalesce(action_row.legacy_module_key, action_row.module_legacy_key)
                )
              )
              or (
                action_row.legacy_route is not null
                and (
                  coalesce(user_row.allowed_sub_modules -> coalesce(action_row.legacy_module_key, action_row.module_legacy_key), '[]'::jsonb) ? action_row.legacy_route
                  or coalesce(user_row.admin_sub_modules -> coalesce(action_row.legacy_module_key, action_row.module_legacy_key), '[]'::jsonb) ? action_row.legacy_route
                )
              )
          end
        )
      )
  )
  select * from role_sources
  union all
  select * from direct_sources
  union all
  select * from legacy_sources;
$$;

revoke all on function app_private.resolve_effective_permission_sources(uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
```

The effective ROLE scope is the intersection, never the wider operand. In particular, assignment `project/*` plus item `project/project-1` resolves to `project/project-1`; the reverse combination also resolves to `project/project-1`.

- [x] **Step 6: Put the resolver behind the existing boolean helpers and permission-admin check**

```sql
create or replace function app_private.has_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id, p_permission_code, p_scope_type, p_scope_id, now()
    ) source_row
  );
$$;

create or replace function app_private.can_manage_permissions()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.has_permission(
    public.current_app_user_id(),
    'system.authorization.manage_grants',
    'global',
    '*'
  );
$$;

revoke all on function app_private.has_permission(uuid,text,text,text) from public, anon;
revoke all on function app_private.can_manage_permissions() from public, anon;
grant execute on function app_private.has_permission(uuid,text,text,text) to authenticated;
grant execute on function app_private.can_manage_permissions() to authenticated;
```

Keep the existing `app_private.has_any_permission(...)` signature unchanged; it automatically consumes the new facade.

- [x] **Step 7: Add the self-authorizing private read boundary, invoker wrapper and admin RLS read policy**

```sql
create or replace function app_private.get_effective_permission_sources_authorized(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table (
  permission_code text,
  source_type text,
  source_id text,
  source_code text,
  source_label text,
  scope_type text,
  scope_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  risk_level text,
  is_business_approval boolean,
  metadata jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;
  if p_target_user_id <> v_actor_user_id
    and not app_private.has_any_permission(
      v_actor_user_id,
      array['system.authorization.view','system.authorization.audit','system.authorization.manage_roles','system.authorization.manage_grants'],
      'global',
      '*'
    )
  then
    raise exception 'Not allowed to view authorization sources' using errcode = '42501';
  end if;

  return query
  select *
  from app_private.resolve_effective_permission_sources(
    p_target_user_id, null, null, null, now()
  );
end;
$$;

revoke all on function app_private.get_effective_permission_sources_authorized(uuid)
  from public, anon, authenticated;
grant execute on function app_private.get_effective_permission_sources_authorized(uuid)
  to authenticated;

create or replace function public.get_effective_permission_sources(
  p_target_user_id uuid default public.current_app_user_id()
)
returns table (
  permission_code text,
  source_type text,
  source_id text,
  source_code text,
  source_label text,
  scope_type text,
  scope_id text,
  starts_at timestamptz,
  expires_at timestamptz,
  risk_level text,
  is_business_approval boolean,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from app_private.get_effective_permission_sources_authorized(p_target_user_id);
$$;

revoke all on function public.get_effective_permission_sources(uuid) from public, anon;
grant execute on function public.get_effective_permission_sources(uuid) to authenticated;

drop policy if exists principal_role_assignments_self_select on public.principal_role_assignments;
create policy principal_role_assignments_authorized_select
on public.principal_role_assignments for select
to authenticated
using (
  (principal_type = 'user' and principal_id = (select public.current_app_user_id()))
  or (select app_private.has_any_permission(
    public.current_app_user_id(),
    array['system.authorization.audit','system.authorization.manage_roles','system.authorization.manage_grants'],
    'global',
    '*'
  ))
);

drop policy if exists permission_audit_events_select on public.permission_audit_events;
create policy permission_audit_events_select
on public.permission_audit_events for select
to authenticated
using (
  actor_user_id = (select public.current_app_user_id())
  or target_user_id = (select public.current_app_user_id())
  or (select app_private.has_permission(
    public.current_app_user_id(), 'system.authorization.audit', 'global', '*'
  ))
);

notify pgrst, 'reload schema';
```

- [x] **Step 8: Complete the prewritten SQL smoke coverage**

`supabase/tests/business_role_effective_permission_smoke.sql` must:

1. Assert the resolver and public RPC exist.
2. Assert `anon` cannot execute the public RPC.
3. Create disposable active admin and target users plus one project-scoped role assignment.
4. Set the resolver, legacy-governance cutoff and admin-business-approval cutoff flags to `true` inside the caller-owned rollback transaction.
5. Assert the target receives `project.daily_log.approve` with source `ROLE` only for the matching project; cover both `assignment project/* + item project/project-1` and the reverse combination so neither operand can widen the intersection.
6. Assert the target receives an adjacent direct permission only when a direct grant exists.
7. Assert an `ADMIN` with legacy `DA` arrays but no explicit business source is denied `project.daily_log.approve`.
8. Assert the same `ADMIN` still has `system.settings.manage`.
9. Assert a System Admin without an explicit `PERMISSION_ADMIN` source cannot manage roles/grants after the legacy-governance cutoff, while an explicitly assigned Permission Admin can.
10. With legacy fallback enabled, assert a target's global legacy source still covers a requested project/warehouse scope; Phase 2 must not break current scoped callers before Phase 3 source modes exist.
11. Assert an inactive target resolves zero sources.
12. Assert `system.settings.manage` resolves from the `SYSTEM_ADMIN` role only while the profile remains `Role.ADMIN`; demoting the profile suppresses that source even if a stale mirror row exists, and a direct source is never accepted.
13. Assert `authenticated` has no direct EXECUTE ACL on the raw resolver, while the public invoker wrapper authorizes self/Permission Admin/Auditor reads and denies an unrelated caller.
14. Delete disposable rows when the smoke is run outside its normal rollback wrapper.

Use explicit failure blocks:

```sql
do $$
begin
  if app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'project.daily_log.approve', 'project', 'project-1'
  ) then
    raise exception 'System Admin retained automatic business approval';
  end if;

  if not app_private.has_permission(
    (select admin_id from phase2_role_smoke_ids),
    'system.settings.manage', 'global', '*'
  ) then
    raise exception 'System Admin lost technical settings access';
  end if;
end;
$$;
```

- [x] **Step 9: Turn the same contracts GREEN through the approved Cloud rollback-only protocol**

```bash
npx supabase db reset --local --no-seed
npm test -- lib/__tests__/authorizationBusinessRoleMigration.test.ts
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
git diff --check -- "$RESOLVER_MIGRATION" supabase/tests/business_role_effective_permission_smoke.sql
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/business_role_effective_permission_smoke.sql)"
```

Expected: static and local SQL behavior tests PASS; no Cloud query occurs in this task.

- [x] **Step 10: Commit Task 2**

```bash
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
git add "$RESOLVER_MIGRATION" \
  supabase/tests/business_role_effective_permission_smoke.sql \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts
git commit -m "feat(authz): resolve effective permission sources"
```

---

## Mandatory Database-Security Review Checkpoint A

Stop after Tasks 1–2. Do not begin Task 3 until an independent database-security review has checked:

- new-table RLS/ACLs and `anon`/`PUBLIC` exposure;
- absence of authenticated direct mutation on roles, grants, assignments and audit;
- private function `search_path` and execute grants;
- active-principal enforcement and indexes on every FK/RLS lookup;
- source scope intersection and expiry behavior;
- recursion safety between resolver, `has_permission`, RLS and `can_manage_permissions`;
- exact compatibility behavior while all three rollout flags are `false`;
- fail-closed denial for implicit legacy governance authority and System Admin business approval when their independent cutoffs are `true`;
- absence of actor IDs in every browser-callable mutation/read authorization decision.

Record findings and required forward changes in the execution notes before proceeding.

> **Checkpoint A review — PASS (`2026-07-17`):** Tasks 1–2 passed 942
> repository tests and the linked-Cloud rollback smoke. The review found
> missing lookup indexes for assignment/revocation actors and audit-event actor
> RLS; commit `7e0b223` added all three and regression assertions. Candidate
> inventory then confirmed RLS enabled, seven required security indexes, five
> privileged functions with empty `search_path`, all three flags defaulting to
> `false`, no raw-resolver EXECUTE for `authenticated`, no public RPC EXECUTE
> for `anon`, no RLS recursion, correct scope intersection/expiry behavior and
> no persisted Cloud schema, flags or fixtures. No Critical or Important
> finding remains open.

---

### Task 3: Add the typed Minimal SoD registry and decision engine

**Files:**

- Create: `lib/__tests__/authorizationSodMigration.test.ts`
- Create: `supabase/migrations/<generated>_authorization_minimal_sod_registry.sql`
- Create: `supabase/tests/authorization_sod_smoke.sql`

**Interfaces:**

- Consumes: Task 2 resolver and governance permission codes.
- Produces: typed `authorization_sod_rules`, append-only `authorization_sod_warning_acceptances`, scalar `app_private.evaluate_authorization_change(...)`, multi-scope `app_private.evaluate_authorization_change_set(...)`, `public.preview_authorization_change(...)` and `app_private.assert_subject_sod(...)`.

- [x] **Step 1: Write the failing SoD migration contract**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'supabase', 'migrations');
const sodFiles = readdirSync(dir)
  .filter(file => file.endsWith('_authorization_minimal_sod_registry.sql'))
  .sort();
const sodSql = sodFiles.length === 1 ? readFileSync(join(dir, sodFiles[0]), 'utf8') : '';
const normalized = sodSql.replace(/\s+/g, ' ').trim();

describe('minimal SoD registry migration', () => {
  it('creates one typed, seed-controlled registry without a policy DSL', () => {
    expect(sodFiles).toHaveLength(1);
    expect(normalized).toMatch(/create table public\.authorization_sod_rules/i);
    expect(normalized).toMatch(/rule_type in \('SELF_GRANT','PERMISSION_PAIR','SUBJECT_RELATION'\)/i);
    expect(normalized).toMatch(/effect in \('DENY','WARN','REQUIRE_OVERRIDE'\)/i);
    expect(normalized).not.toMatch(/policy_expression|sql_expression|condition_expression/i);
  });

  it('keeps warning acceptance append-only and owner-controlled', () => {
    expect(normalized).toMatch(/create table public\.authorization_sod_warning_acceptances/i);
    expect(normalized).toMatch(/control_owner_user_id uuid not null references public\.users/i);
    expect(normalized).toMatch(/compensating_controls text not null/i);
    expect(normalized).toMatch(/expires_at timestamptz not null/i);
    expect(normalized).not.toMatch(/grant (insert|update|delete).*authorization_sod_warning_acceptances.*authenticated/i);
  });

  it('derives preview actor and exposes hard-deny subject guards', () => {
    expect(normalized).toMatch(/create or replace function app_private\.evaluate_authorization_change/i);
    expect(normalized).toMatch(/create or replace function app_private\.evaluate_authorization_change_set/i);
    expect(normalized).toMatch(/create or replace function public\.preview_authorization_change/i);
    expect(normalized).toMatch(/v_actor_user_id uuid := public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/p_actor_user_id is distinct from public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/create or replace function app_private\.assert_subject_sod/i);
  });
});
```

Create `authorization_sod_smoke.sql` before the migration. It must expect typed rule rows, reject forged actor IDs, deny same creator/submitter/executor subject relations, allow distinct actors and prove the hard guard has no override parameter/path.

- [x] **Step 2: Run the focused test and observe RED**

```bash
npm test -- lib/__tests__/authorizationSodMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_sod_smoke.sql)"
```

Expected: static and SQL smoke FAIL against the Task 2 schema because the SoD migration is absent.

- [x] **Step 3: Create the migration through the CLI**

```bash
npx supabase migration new authorization_minimal_sod_registry
SOD_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_minimal_sod_registry\.sql$')"
test -n "$SOD_MIGRATION"
```

- [x] **Step 4: Create the typed rule and warning-acceptance tables**

```sql
create table public.authorization_sod_rules (
  rule_code text primary key,
  name text not null,
  description text not null,
  rule_type text not null
    check (rule_type in ('SELF_GRANT','PERMISSION_PAIR','SUBJECT_RELATION')),
  effect text not null
    check (effect in ('DENY','WARN','REQUIRE_OVERRIDE')),
  left_permission_code text references public.permission_actions(permission_code) on update cascade on delete restrict,
  right_permission_code text references public.permission_actions(permission_code) on update cascade on delete restrict,
  operation_code text,
  subject_type text,
  overridable boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effect <> 'DENY' or not overridable),
  check (effect <> 'REQUIRE_OVERRIDE' or overridable),
  check (
    rule_type <> 'PERMISSION_PAIR'
    or (left_permission_code is not null and right_permission_code is not null)
  ),
  check (
    rule_type <> 'SUBJECT_RELATION'
    or (operation_code is not null and subject_type is not null)
  )
);

create table public.authorization_sod_warning_acceptances (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null references public.authorization_sod_rules(rule_code) on delete restrict,
  command_type text not null,
  command_id uuid not null,
  actor_user_id uuid references public.users(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  scope_type text not null,
  scope_id text not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  control_owner_user_id uuid not null references public.users(id) on delete restrict,
  compensating_controls text not null check (char_length(btrim(compensating_controls)) >= 10),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (rule_code, command_type, command_id, scope_type, scope_id)
);

create index authorization_sod_rules_active_effect_idx
  on public.authorization_sod_rules (effect, rule_type)
  where is_active;
create index authorization_sod_warning_target_idx
  on public.authorization_sod_warning_acceptances (target_user_id, created_at desc);
create index authorization_sod_warning_owner_expiry_idx
  on public.authorization_sod_warning_acceptances (control_owner_user_id, expires_at);

alter table public.authorization_sod_rules enable row level security;
alter table public.authorization_sod_warning_acceptances enable row level security;

revoke all privileges on table public.authorization_sod_rules from public, anon, authenticated;
revoke all privileges on table public.authorization_sod_warning_acceptances from public, anon, authenticated;
grant select on table public.authorization_sod_rules to authenticated;
grant select on table public.authorization_sod_warning_acceptances to authenticated;

create policy authorization_sod_rules_authorized_select
on public.authorization_sod_rules for select
to authenticated
using ((select app_private.has_permission(
  public.current_app_user_id(), 'system.authorization.view', 'global', '*'
)));

create policy authorization_sod_warning_authorized_select
on public.authorization_sod_warning_acceptances for select
to authenticated
using (
  actor_user_id = (select public.current_app_user_id())
  or target_user_id = (select public.current_app_user_id())
  or control_owner_user_id = (select public.current_app_user_id())
  or (select app_private.has_permission(
    public.current_app_user_id(), 'system.authorization.audit', 'global', '*'
  ))
);
```

- [x] **Step 5: Seed concrete rules only for permission namespaces that exist**

```sql
insert into public.authorization_sod_rules (
  rule_code, name, description, rule_type, effect,
  left_permission_code, right_permission_code,
  operation_code, subject_type, overridable, metadata
)
values
  ('AUTHZ_SENSITIVE_SELF_GRANT','Chặn tự cấp quyền nhạy cảm','Permission Admin không được tự cấp permission sensitive','SELF_GRANT','DENY',null,null,'grant_sensitive_permission','user',false,'{}'::jsonb),
  ('WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL','Maker-checker final approval','Creator hoặc submitter không được final-approve chính subject','SUBJECT_RELATION','DENY',null,null,'final_approve','workflow_subject',false,'{}'::jsonb),
  ('PAYMENT_EXECUTOR_FINAL_APPROVAL','Payment executor final approval','Người thực thi thanh toán không được final-approve cùng payment','SUBJECT_RELATION','DENY',null,null,'final_approve','project_payment',false,'{}'::jsonb),
  ('VENDOR_MAINTAIN_PAYMENT_APPROVE','Nhà cung cấp và duyệt thanh toán','Kết hợp cần biện pháp kiểm tra bù trừ','PERMISSION_PAIR','WARN','contract.supplier.manage','project.payment.approve',null,null,false,'{}'::jsonb),
  ('PO_CREATE_APPROVE','Tạo và duyệt PO','Kết hợp cần owner kiểm soát','PERMISSION_PAIR','WARN','project.material_po.create','project.material_po.approve',null,null,false,'{}'::jsonb),
  ('PO_RECEIVE_PAYMENT_APPROVE','Nhận hàng và duyệt thanh toán','Kết hợp cần đối soát độc lập','PERMISSION_PAIR','WARN','project.material_po.receive','project.payment.approve',null,null,false,'{}'::jsonb),
  ('WAREHOUSE_MANAGE_ADJUST_APPROVE','Quản lý kho và duyệt điều chỉnh','Kết hợp cần kiểm kê bù trừ','PERMISSION_PAIR','WARN','wms.master_data.manage','wms.transaction.approve',null,null,false,'{}'::jsonb),
  ('WORKFLOW_CONTROLLED_EXCEPTION','Ngoại lệ workflow được kiểm soát','Override chỉ tạo bằng permission và RPC riêng','SUBJECT_RELATION','REQUIRE_OVERRIDE',null,null,'controlled_exception','workflow_subject',true,'{}'::jsonb)
on conflict (rule_code) do update
set name = excluded.name,
    description = excluded.description,
    rule_type = excluded.rule_type,
    effect = excluded.effect,
    left_permission_code = excluded.left_permission_code,
    right_permission_code = excluded.right_permission_code,
    operation_code = excluded.operation_code,
    subject_type = excluded.subject_type,
    overridable = excluded.overridable,
    metadata = excluded.metadata,
    is_active = true,
    updated_at = now();
```

Payroll prepare/approve is not seeded under the existing single `hrm.payroll.manage` permission because that would create a false control. The HRM Phase 6 module plan must split and seed those permission codes before enabling that warning.

- [x] **Step 6: Implement deterministic permission-change evaluation**

```sql
create or replace function app_private.evaluate_authorization_change(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_proposed_permission_codes text[],
  p_scope_type text,
  p_scope_id text,
  p_change_mode text default 'ADD'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array['system.authorization.manage_roles','system.authorization.manage_grants'],
      'global', '*'
    )
  then
    raise exception 'Active authorization actor required' using errcode = '42501';
  end if;

  if p_change_mode not in ('ADD', 'REPLACE_DIRECT') then
    raise exception 'Unknown authorization change mode' using errcode = '22023';
  end if;

  return (
  with proposed as (
    select distinct code as permission_code
    from unnest(coalesce(p_proposed_permission_codes, '{}'::text[])) code
  ),
  current_codes as (
    select distinct source_row.permission_code
    from app_private.resolve_effective_permission_sources(
      p_target_user_id, null, p_scope_type, p_scope_id, now()
    ) source_row
    where p_change_mode <> 'REPLACE_DIRECT'
       or source_row.source_type <> 'DIRECT'
  ),
  resulting_codes as (
    select permission_code from current_codes
    union
    select permission_code from proposed
  ),
  self_grant_denies as (
    select jsonb_build_object(
      'ruleCode', rule_row.rule_code,
      'effect', rule_row.effect,
      'message', rule_row.description,
      'permissionCodes', jsonb_agg(action_row.permission_code order by action_row.permission_code),
      'scopeType', p_scope_type,
      'scopeId', p_scope_id
    ) finding
    from public.authorization_sod_rules rule_row
    join proposed proposed_row on true
    join public.permission_actions action_row
      on action_row.permission_code = proposed_row.permission_code
     and action_row.risk_level = 'sensitive'
    where rule_row.rule_code = 'AUTHZ_SENSITIVE_SELF_GRANT'
      and rule_row.is_active
      and p_actor_user_id = p_target_user_id
      and p_change_mode = 'ADD'
    group by rule_row.rule_code, rule_row.effect, rule_row.description
  ),
  pair_findings as (
    select
      rule_row.effect,
      jsonb_build_object(
        'ruleCode', rule_row.rule_code,
        'effect', rule_row.effect,
        'message', rule_row.description,
        'permissionCodes', jsonb_build_array(rule_row.left_permission_code, rule_row.right_permission_code),
        'scopeType', p_scope_type,
        'scopeId', p_scope_id
      ) finding
    from public.authorization_sod_rules rule_row
    where rule_row.is_active
      and rule_row.rule_type = 'PERMISSION_PAIR'
      and exists (select 1 from resulting_codes c where c.permission_code = rule_row.left_permission_code)
      and exists (select 1 from resulting_codes c where c.permission_code = rule_row.right_permission_code)
      and (
        exists (select 1 from proposed c where c.permission_code = rule_row.left_permission_code)
        or exists (select 1 from proposed c where c.permission_code = rule_row.right_permission_code)
      )
      and not (
        exists (select 1 from current_codes c where c.permission_code = rule_row.left_permission_code)
        and exists (select 1 from current_codes c where c.permission_code = rule_row.right_permission_code)
      )
  ),
  all_findings as (
    select 'DENY'::text as effect, finding from self_grant_denies
    union all
    select effect, finding from pair_findings
  )
  select jsonb_build_object(
    'hardDenies', coalesce(jsonb_agg(finding order by finding->>'ruleCode') filter (where effect = 'DENY'), '[]'::jsonb),
    'warnings', coalesce(jsonb_agg(finding order by finding->>'ruleCode') filter (where effect = 'WARN'), '[]'::jsonb)
  )
  from all_findings
  );
end;
$$;

revoke all on function app_private.evaluate_authorization_change(uuid,uuid,text[],text,text,text)
  from public, anon;
grant execute on function app_private.evaluate_authorization_change(uuid,uuid,text[],text,text,text)
  to authenticated;
```

In the same migration, add this shared multi-scope facade:

```sql
app_private.evaluate_authorization_change_set(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_proposed_grants jsonb,
  p_change_mode text
) returns jsonb
```

It self-authorizes the current actor exactly like the scalar evaluator, validates a normalized array of `{permissionCode,scopeType,scopeId}`, and evaluates every scope intersection rather than treating `*` as one concrete subject. Build candidate points from proposed grants plus current effective sources; retain only points covered by at least one proposed row; at each point collect every proposed permission whose scope covers it, call the scalar evaluator, then deduplicate findings by `(ruleCode,scopeType,scopeId)`. Always include each proposed wildcard/global key and every existing concrete scope it covers. For the same rule, suppress a narrower finding already covered by `global/*` or the same `scopeType/*`; one broad acknowledgement controls that whole covered set without duplicate forms. Return the same `hardDenies`/`warnings` shape with scope carried in each finding. Revoke its exact signature from `PUBLIC`/`anon`/`authenticated`; it is an owner-only seam reached through the dedicated self-authorizing role/direct preview implementations, and it keeps its own actor/permission check as defense in depth.

This helper is the single SoD set-evaluation seam for Task 4 role assignment and Task 5 direct replacement. Later phases must reuse it for governed permission-set changes instead of inventing module-specific pair logic.

- [x] **Step 7: Add an actor-derived preview RPC**

```sql
create or replace function public.preview_authorization_change(
  p_target_user_id uuid,
  p_proposed_permission_codes text[],
  p_scope_type text default 'global',
  p_scope_id text default '*',
  p_change_mode text default 'ADD'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not app_private.has_any_permission(
    v_actor_user_id,
    array['system.authorization.manage_roles','system.authorization.manage_grants'],
    'global', '*'
  ) then
    raise exception 'Not allowed to preview authorization changes' using errcode = '42501';
  end if;
  return app_private.evaluate_authorization_change(
    v_actor_user_id,
    p_target_user_id,
    p_proposed_permission_codes,
    coalesce(nullif(p_scope_type, ''), 'global'),
    coalesce(nullif(p_scope_id, ''), '*'),
    p_change_mode
  );
end;
$$;

revoke all on function public.preview_authorization_change(uuid,text[],text,text,text) from public, anon;
grant execute on function public.preview_authorization_change(uuid,text[],text,text,text) to authenticated;
```

`ADD` is used by Business Role assignment. `REPLACE_DIRECT` removes current `DIRECT` sources from the resulting-set baseline so a revoked direct permission cannot create a false warning, while the Task 5 key-level check remains responsible for sensitive self-grant detection. Unknown modes fail with SQLSTATE `22023` and cannot be used as a bypass.

- [x] **Step 8: Add typed hard subject-relation guards with no override branch**

```sql
create or replace function app_private.assert_subject_sod(
  p_rule_code text,
  p_actor_user_id uuid,
  p_creator_user_id uuid,
  p_submitter_user_id uuid,
  p_executor_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rule public.authorization_sod_rules%rowtype;
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
  then
    raise exception 'Active workflow actor required' using errcode = '42501';
  end if;

  select * into v_rule
  from public.authorization_sod_rules
  where rule_code = p_rule_code
    and is_active
    and effect = 'DENY'
    and rule_type = 'SUBJECT_RELATION';

  if v_rule.rule_code is null then
    raise exception 'Unknown hard SoD rule' using errcode = '22023';
  end if;

  if p_rule_code = 'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL'
    and p_actor_user_id is not null
    and p_actor_user_id in (p_creator_user_id, p_submitter_user_id)
  then
    raise exception 'Maker-checker separation required' using errcode = '42501';
  end if;

  if p_rule_code = 'PAYMENT_EXECUTOR_FINAL_APPROVAL'
    and p_actor_user_id is not null
    and p_actor_user_id = p_executor_user_id
  then
    raise exception 'Payment executor cannot final-approve the same payment' using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_subject_sod(text,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
```

The function intentionally has no override ID and never calls an override helper.

- [x] **Step 9: Run the focused tests and commit**

```bash
npx supabase db reset --local --no-seed
npm test -- lib/__tests__/authorizationSodMigration.test.ts
SOD_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_minimal_sod_registry\.sql$')"
git diff --check -- "$SOD_MIGRATION" lib/__tests__/authorizationSodMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_sod_smoke.sql)"
git add "$SOD_MIGRATION" \
  supabase/tests/authorization_sod_smoke.sql \
  lib/__tests__/authorizationSodMigration.test.ts
git commit -m "feat(authz): add minimal sod registry"
```

Expected: test PASS, clean diff and one Task 3 commit.

---

### Task 4: Add audited Business Role definition and assignment commands

**Files:**

- Modify: `lib/__tests__/authorizationBusinessRoleMigration.test.ts`
- Modify: `lib/__tests__/authorizationSodMigration.test.ts`
- Create: `supabase/migrations/<generated>_authorization_governance_commands.sql`
- Create: `supabase/tests/authorization_governance_commands_smoke.sql`

**Interfaces:**

- Consumes: Tasks 1–3 schema, resolver and SoD decisions.
- Produces: `public.preview_business_role_change`, `public.preview_business_role_assignment`, `public.save_business_role`, `public.assign_business_role`, `public.revoke_business_role_assignment`, `public.list_authorization_principals` and the shared warning-acceptance validator.

- [x] **Step 1: Add failing command security contracts**

Load exactly one file ending `_authorization_governance_commands.sql`, normalize it as `commandsNormalized`, and add:

```ts
expect(commandsFiles).toHaveLength(1);
expect(commandsNormalized).toMatch(/v_actor_user_id uuid := public\.current_app_user_id\(\)/i);
expect(commandsNormalized).toMatch(/create or replace function public\.assign_business_role/i);
expect(commandsNormalized).toMatch(/create or replace function public\.revoke_business_role_assignment/i);
expect(commandsNormalized).toMatch(/create or replace function app_private\.assert_rollout_operator_continuity/i);
expect(commandsNormalized).toMatch(/create trigger trg_users_guard_rollout_operator_transition/i);
expect(commandsNormalized).toMatch(/create or replace function public\.save_business_role/i);
expect(commandsNormalized).toMatch(/create or replace function public\.preview_business_role_change/i);
expect(commandsNormalized).toMatch(/create or replace function public\.preview_business_role_assignment/i);
expect(commandsNormalized).toMatch(/create or replace function app_private\.list_authorization_principals_impl/i);
expect(commandsNormalized).toMatch(/create or replace function app_private\.set_authorization_rollout_flags_impl/i);
expect(commandsNormalized).toMatch(/create or replace function public\.list_authorization_principals\(\).*?security invoker/is);
expect(commandsNormalized).toMatch(/create or replace function public\.set_authorization_rollout_flags\(.*?security invoker/is);
expect(commandsNormalized).toMatch(/for update/i);
expect(commandsNormalized).toMatch(/insert into public\.permission_audit_events/i);
expect(commandsNormalized).not.toMatch(/create or replace function public\.[^(]+\([^)]*p_actor_user_id/i);
```

Create `authorization_governance_commands_smoke.sql` now with the role definition/assignment, scope, self-grant, warning, audit and ACL cases listed in Step 8.

- [x] **Step 2: Run focused tests and observe RED**

```bash
npm test -- \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationSodMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_governance_commands_smoke.sql)"
```

Expected: static and SQL smoke FAIL against the Task 3 schema because the command migration is missing.

- [x] **Step 3: Create the command migration through the CLI**

```bash
npx supabase migration new authorization_governance_commands
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
test -n "$COMMANDS_MIGRATION"
```

- [x] **Step 4: Add shared permission and warning-acceptance guards**

```sql
create or replace function app_private.assert_authorization_permission(p_permission_code text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if v_actor_user_id is null
    or not app_private.has_permission(v_actor_user_id, p_permission_code, 'global', '*')
  then
    raise exception 'Authorization administration permission required' using errcode = '42501';
  end if;
  return v_actor_user_id;
end;
$$;

create or replace function app_private.assert_and_record_sod_warnings(
  p_decision jsonb,
  p_acceptances jsonb,
  p_command_type text,
  p_command_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hard_denies jsonb := coalesce(p_decision->'hardDenies', '[]'::jsonb);
  v_warnings jsonb := coalesce(p_decision->'warnings', '[]'::jsonb);
  v_acceptances jsonb := coalesce(p_acceptances, '[]'::jsonb);
  v_warning jsonb;
  v_acceptance jsonb;
  v_owner_id uuid;
  v_expires_at timestamptz;
begin
  if p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_any_permission(
      public.current_app_user_id(),
      array['system.authorization.manage_roles','system.authorization.manage_grants'],
      'global', '*'
    )
  then
    raise exception 'Authorization administration permission required' using errcode = '42501';
  end if;

  if jsonb_typeof(v_acceptances) <> 'array' then
    raise exception 'SoD warning acceptances must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(v_hard_denies) > 0 then
    raise exception 'Authorization change violates a hard SoD rule' using errcode = '42501';
  end if;

  for v_warning in select value from jsonb_array_elements(v_warnings)
  loop
    select value into v_acceptance
    from jsonb_array_elements(v_acceptances)
    where value->>'ruleCode' = v_warning->>'ruleCode'
      and value->>'scopeType' = v_warning->>'scopeType'
      and value->>'scopeId' = v_warning->>'scopeId'
    limit 1;

    if v_acceptance is null then
      raise exception 'SoD warning acknowledgement required' using errcode = '22023';
    end if;

    v_owner_id := nullif(v_acceptance->>'controlOwnerUserId', '')::uuid;
    v_expires_at := nullif(v_acceptance->>'expiresAt', '')::timestamptz;
    if char_length(btrim(coalesce(v_acceptance->>'reason', ''))) < 10
      or char_length(btrim(coalesce(v_acceptance->>'compensatingControls', ''))) < 10
      or v_expires_at is null
      or v_expires_at <= now()
      or v_owner_id is null
      or v_owner_id = p_actor_user_id
      or v_owner_id = p_target_user_id
      or not exists (
        select 1 from public.users owner_row
        where owner_row.id = v_owner_id
          and owner_row.is_active
          and owner_row.account_status = 'ACTIVE'
          and app_private.has_permission(owner_row.id, 'system.authorization.audit', 'global', '*')
      )
    then
      raise exception 'Invalid SoD warning control evidence' using errcode = '22023';
    end if;

    insert into public.authorization_sod_warning_acceptances (
      rule_code, command_type, command_id, actor_user_id, target_user_id,
      scope_type, scope_id, reason, control_owner_user_id,
      compensating_controls, expires_at
    ) values (
      v_warning->>'ruleCode', p_command_type, p_command_id,
      p_actor_user_id, p_target_user_id,
      v_warning->>'scopeType', v_warning->>'scopeId',
      btrim(v_acceptance->>'reason'), v_owner_id,
      btrim(v_acceptance->>'compensatingControls'), v_expires_at
    );
  end loop;

  if exists (
    select 1 from jsonb_array_elements(v_acceptances) supplied
    where not exists (
      select 1 from jsonb_array_elements(v_warnings) expected
      where expected->>'ruleCode' = supplied->>'ruleCode'
        and expected->>'scopeType' = supplied->>'scopeType'
        and expected->>'scopeId' = supplied->>'scopeId'
    )
  ) then
    raise exception 'Unexpected SoD warning acknowledgement' using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.assert_authorization_permission(text) from public, anon, authenticated;
revoke all on function app_private.assert_and_record_sod_warnings(jsonb,jsonb,text,uuid,uuid,uuid)
  from public, anon, authenticated;
```

These two helpers are owner-only internals called from self-authorizing private command implementations. Do not grant either helper to `authenticated`: otherwise a caller could submit fabricated decision JSON or a detached command ID and create warning evidence outside the governed mutation.

- [x] **Step 5: Implement role impact preview and controlled role save**

Use these exact interfaces:

```sql
app_private.preview_business_role_change_impl(p_role_template_id uuid, p_items jsonb) returns jsonb
public.preview_business_role_change(p_role_template_id uuid, p_items jsonb) returns jsonb

app_private.save_business_role_impl(
  p_role_template_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_items jsonb,
  p_reason text
) returns uuid

public.save_business_role(
  p_role_template_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_items jsonb,
  p_reason text
) returns uuid
```

The private implementation must execute these checks before writing:

```sql
v_actor_user_id := app_private.assert_authorization_permission('system.authorization.manage_roles');

if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
  or char_length(btrim(coalesce(p_name, ''))) < 3
  or char_length(btrim(coalesce(p_reason, ''))) < 10
then
  raise exception 'Invalid Business Role command' using errcode = '22023';
end if;

select * into v_role
from public.role_permission_templates
where id = p_role_template_id
for update;

if v_role.id is not null and v_role.is_system then
  raise exception 'System Business Roles are seed-controlled' using errcode = '42501';
end if;

if exists (
  select 1
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(
    permission_code text, scope_type text, scope_id text
  )
  left join public.permission_actions action_row
    on action_row.permission_code = item.permission_code and action_row.is_active
  where action_row.permission_code is null
     or not coalesce(nullif(item.scope_type, ''), 'global') = any(action_row.scope_modes)
) then
  raise exception 'Business Role contains an unknown permission or unsupported scope'
    using errcode = '23514';
end if;

if exists (
  select 1
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) item(permission_code text)
  where item.permission_code = 'system.settings.manage'
) then
  raise exception 'System identity permissions are seed-controlled'
    using errcode = '42501';
end if;
```

After normalizing `p_items`, capture the current and proposed item arrays and reject a permission-item change while any effective assignment exists:

```sql
if v_role.id is not null
  and v_before_items is distinct from v_after_items
  and exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.role_template_id = v_role.id
    for update
  )
then
  raise exception 'Assigned Business Role permissions are immutable; create a new role and reassign principals'
    using errcode = '55000';
end if;
```

Name and description edits remain allowed. Phase 2 deliberately forbids mutating the permission set of any role that has ever been assigned: changing it would bypass per-principal SoD for active users and rewrite the meaning of historical assignments for revoked/expired users. In the preview, `affectedPrincipalCount` and `affectedScopeCount` include every assignment-history row regardless of current status/time; zero therefore means no assignment history at all. The Permission Admin creates a new role and reassigns principals through the governed assignment command. Phase 3 may compose that sequence into an atomic bulk diff without weakening this command.

For create, normalize the role code to uppercase snake case and reject values outside `^[A-Z][A-Z0-9_]*$`. For update, keep the existing code immutable. Capture complete before/after item arrays, delete/reinsert definition items only inside this audited command, increment `version`, and append `business_role_created` or `business_role_permissions_changed` to `permission_audit_events`.

The preview returns this exact shape:

```sql
jsonb_build_object(
  'affectedPrincipalCount', v_affected_principal_count,
  'affectedScopeCount', v_affected_scope_count,
  'addedPermissionKeys', v_added_keys,
  'removedPermissionKeys', v_removed_keys
)
```

Public wrappers are `security invoker`, contain no actor parameter, and delegate once to the private self-authorizing function. Revoke both exact public/private signatures from `PUBLIC`/`anon`, then grant execute to `authenticated`; the private implementation must still derive/authorize the actor, because the invoker wrapper's execute grant is not itself an authorization decision.

- [x] **Step 6: Implement role assignment and revoke commands**

Use these browser-callable signatures:

```sql
public.preview_business_role_assignment(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text
) returns jsonb

public.assign_business_role(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_reason text,
  p_warning_acceptances jsonb
) returns uuid

public.revoke_business_role_assignment(
  p_assignment_id uuid,
  p_reason text
) returns void
```

Implement `app_private.evaluate_business_role_assignment_impl(actor,target,role,scope_type,scope_id)` once and have both preview and mutation call it. It locks nothing in preview but repeats under the target/role locks in mutation. Normalize every role item to its effective intersection with the assignment scope using the same rules as the resolver, emit `{permissionCode,scopeType,scopeId}` rows, and pass that set to `app_private.evaluate_authorization_change_set(..., 'ADD')`. The public preview is an actor-free `security invoker` wrapper; its private implementation requires `system.authorization.manage_roles`, validates active target/role and the exact same scope compatibility rules as assignment.

Do not flatten a role to one permission array at the assignment scope. `project/*` assignment plus a `project/project-1` role item evaluates at `project/project-1`, and a wildcard/global proposed permission must also be checked against every covered concrete source already held by the target.

Add owner-only `app_private.assert_rollout_operator_continuity(p_excluded_assignment_id uuid default null, p_excluded_user_id uuid default null)`. It queries role tables directly—never legacy arrays or rollout-flag-dependent resolver output—and requires at least one active `users.role='ADMIN'` principal with an effective, non-expiring role assignment whose active template contains the active global action `system.authorization.manage_roles`, excluding the supplied assignment/user. Revoke it from `PUBLIC`/`anon`/`authenticated`.

Add a `before update of role` trigger `trg_users_guard_rollout_operator_transition` whose owner-only function calls that continuity guard with `old.id` excluded whenever an active `Role.ADMIN` is demoted. A stale `SYSTEM_ADMIN` assignment is already suppressed by the resolver after demotion and can then be explicitly revoked; Phase 3 replaces this safe two-step path with one audited atomic profile command. Promotion remains a compatibility profile operation, but the rollout inventory must immediately flag a missing mirror.

The private assignment implementation locks target then role and evaluates SoD before insert:

```sql
v_actor_user_id := app_private.assert_authorization_permission('system.authorization.manage_roles');

select * into v_target
from public.users
where id = p_target_user_id
for update;

if v_target.id is null or not v_target.is_active or v_target.account_status <> 'ACTIVE' then
  raise exception 'Active target user required' using errcode = '23514';
end if;

select * into v_role
from public.role_permission_templates
where id = p_role_template_id and is_active
for update;

if v_role.id is null or char_length(btrim(coalesce(p_reason, ''))) < 10 then
  raise exception 'Valid Business Role and assignment reason required' using errcode = '22023';
end if;

if v_role.code = 'SYSTEM_ADMIN' and v_target.role <> 'ADMIN' then
  raise exception 'System Admin role assignment must follow the governed profile identity command'
    using errcode = '55000';
end if;

if v_role.code <> 'SYSTEM_ADMIN' and exists (
  select 1
  from public.role_permission_template_items item
  where item.template_id = v_role.id
    and item.permission_code = 'system.settings.manage'
) then
  raise exception 'System identity permissions are seed-controlled'
    using errcode = '42501';
end if;

v_scope_type := coalesce(nullif(p_scope_type, ''), 'global');
v_scope_id := coalesce(nullif(p_scope_id, ''), '*');
v_starts_at := coalesce(p_starts_at, now());

if v_starts_at > now() then
  raise exception 'Future Business Role scheduling is not enabled in Phase 2'
    using errcode = '22023';
end if;

if p_expires_at is not null and p_expires_at <= v_starts_at then
  raise exception 'Business Role assignment expiry must follow its start time'
    using errcode = '22023';
end if;

if v_scope_type not in ('global','own','assigned','project','construction_site','warehouse','department')
  or (v_scope_type = 'global' and v_scope_id <> '*')
  or (v_scope_type <> 'global' and btrim(v_scope_id) = '')
  or exists (
    select 1
    from public.role_permission_template_items item
    join public.permission_actions action_row
      on action_row.permission_code = item.permission_code
    where item.template_id = p_role_template_id
      and (
        (v_scope_type <> 'global' and item.scope_type <> 'global' and (
          item.scope_type <> v_scope_type
          or (v_scope_id <> '*' and item.scope_id <> '*' and item.scope_id <> v_scope_id)
        ))
        or not (
          case when v_scope_type <> 'global' then v_scope_type else item.scope_type end
          = any(action_row.scope_modes)
        )
      )
  )
then
  raise exception 'Business Role does not support the requested assignment scope'
    using errcode = '23514';
end if;

update public.principal_role_assignments
set status = 'EXPIRED', updated_at = now()
where principal_type = 'user'
  and principal_id = p_target_user_id
  and role_template_id = p_role_template_id
  and scope_type = coalesce(nullif(p_scope_type, ''), 'global')
  and scope_id = coalesce(nullif(p_scope_id, ''), '*')
  and status = 'ACTIVE'
  and expires_at is not null
  and expires_at <= now();

v_decision := app_private.evaluate_business_role_assignment_impl(
  v_actor_user_id,
  p_target_user_id,
  p_role_template_id,
  v_scope_type,
  v_scope_id
);

v_assignment_id := gen_random_uuid();
perform app_private.assert_and_record_sod_warnings(
  v_decision, p_warning_acceptances, 'ASSIGN_BUSINESS_ROLE', v_assignment_id,
  v_actor_user_id, p_target_user_id
);
```

The warning recorder consumes the complete aggregated decision once. Each acknowledgement key is exactly `(ruleCode,scopeType,scopeId)` from its matching finding, so an omitted or invented scope fails closed. Preview and mutation must return/use byte-equivalent normalized findings for the same locked state.

Insert `principal_type='user'`, append `business_role_assigned`, and return the generated ID. Revoke first reads the assignment identity without trusting it as final state, locks the target user, then role, then assignment, and revalidates all three; it never locks assignment before user. It requires `manage_roles` and a ten-character reason, rejects revoking `SYSTEM_ADMIN` while the target remains an active legacy `Role.ADMIN`, and calls the continuity guard with this assignment excluded before revoking any durable rollout source. Disable continues to revoke through Task 6, and Phase 3's atomic profile command handles demotion. Other revokes set `status='REVOKED'` and revoke metadata, then append `business_role_revoked`. Repeating revoke with the same reason succeeds without a second event; a different reason after revoke raises SQLSTATE `55000`.

- [x] **Step 7: Add a minimal principal directory for governance UI**

```sql
create or replace function app_private.list_authorization_principals_impl()
returns table (user_id uuid, name text, email text, account_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
begin
  if not app_private.has_permission(v_actor_user_id, 'system.authorization.view', 'global', '*') then
    raise exception 'Not allowed to view authorization principals' using errcode = '42501';
  end if;
  return query
  select u.id, u.name, u.email, u.account_status
  from public.users u
  order by u.name, u.email, u.id;
end;
$$;

create or replace function public.list_authorization_principals()
returns table (user_id uuid, name text, email text, account_status text)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app_private.list_authorization_principals_impl();
$$;

revoke all on function app_private.list_authorization_principals_impl() from public, anon;
grant execute on function app_private.list_authorization_principals_impl() to authenticated;
revoke all on function public.list_authorization_principals() from public, anon;
grant execute on function public.list_authorization_principals() to authenticated;
```

The RPC intentionally omits Auth IDs, password fields, legacy arrays and HRM/business data.

Add a separate rollout command requiring both compatibility System Admin identity and the `manage_roles` permission:

```sql
create or replace function app_private.set_authorization_rollout_flags_impl(
  p_business_role_resolver_enabled boolean,
  p_legacy_governance_fallback_disabled boolean,
  p_admin_business_approval_bypass_disabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_before jsonb;
  v_after jsonb;
begin
  if (p_legacy_governance_fallback_disabled or p_admin_business_approval_bypass_disabled)
    and not p_business_role_resolver_enabled
  then
    raise exception 'Business Role resolver must be enabled before disabling compatibility fallbacks'
      using errcode = '22023';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 10
    or not exists (
      select 1 from public.users actor_row
      where actor_row.id = v_actor_user_id
        and actor_row.role = 'ADMIN'
        and actor_row.is_active
        and actor_row.account_status = 'ACTIVE'
    )
    or not app_private.has_permission(
      v_actor_user_id, 'system.authorization.manage_roles', 'global', '*'
    )
  then
    raise exception 'System Admin and role-management permission required'
      using errcode = '42501';
  end if;

  if p_legacy_governance_fallback_disabled
    or p_admin_business_approval_bypass_disabled
  then
    perform app_private.assert_rollout_operator_continuity(null, null);
  end if;

  perform 1
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  )
  order by setting_row.key
  for update;

  select jsonb_object_agg(setting_row.key, setting_row.value)
  into v_before
  from app_private.permission_hardening_settings setting_row
  where setting_row.key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  update app_private.permission_hardening_settings
  set value = case key
        when 'business_role_resolver_enabled' then to_jsonb(p_business_role_resolver_enabled)
        when 'legacy_governance_fallback_disabled' then to_jsonb(p_legacy_governance_fallback_disabled)
        else to_jsonb(p_admin_business_approval_bypass_disabled)
      end,
      updated_at = now()
  where key in (
    'business_role_resolver_enabled',
    'legacy_governance_fallback_disabled',
    'system_admin_business_approval_bypass_disabled'
  );

  v_after := jsonb_build_object(
    'business_role_resolver_enabled', p_business_role_resolver_enabled,
    'legacy_governance_fallback_disabled', p_legacy_governance_fallback_disabled,
    'system_admin_business_approval_bypass_disabled', p_admin_business_approval_bypass_disabled
  );

  if v_before is distinct from v_after then
    insert into public.permission_audit_events (
      actor_user_id, target_user_id, event_type,
      before_grants, after_grants, metadata
    ) values (
      v_actor_user_id, v_actor_user_id, 'authorization_rollout_flags_changed',
      coalesce(v_before, '{}'::jsonb), v_after,
      jsonb_build_object('reason', btrim(p_reason))
    );
  end if;
  return v_after;
end;
$$;

create or replace function public.set_authorization_rollout_flags(
  p_business_role_resolver_enabled boolean,
  p_legacy_governance_fallback_disabled boolean,
  p_admin_business_approval_bypass_disabled boolean,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.set_authorization_rollout_flags_impl(
    p_business_role_resolver_enabled,
    p_legacy_governance_fallback_disabled,
    p_admin_business_approval_bypass_disabled,
    p_reason
  );
$$;

revoke all on function app_private.set_authorization_rollout_flags_impl(boolean,boolean,boolean,text)
  from public, anon;
grant execute on function app_private.set_authorization_rollout_flags_impl(boolean,boolean,boolean,text)
  to authenticated;
revoke all on function public.set_authorization_rollout_flags(boolean,boolean,boolean,text)
  from public, anon;
grant execute on function public.set_authorization_rollout_flags(boolean,boolean,boolean,text)
  to authenticated;
```

Add static/smoke assertions that a Permission Admin without legacy `Role.ADMIN`, or a System Admin without explicit `manage_roles`, cannot toggle rollout flags. Also assert either disabled fallback with `resolver=false` returns `22023`, and a cutoff cannot be enabled without a durable rollout operator; restoring both fallbacks remains allowed for any currently authorized intersection operator. Rollback may keep the resolver enabled while restoring both compatibility fallbacks, but the command can never create a state where explicit Business Role sources are disabled while a legacy fallback is also disabled.

- [x] **Step 8: Complete the prewritten role-command SQL smoke coverage**

Start `supabase/tests/authorization_governance_commands_smoke.sql` with disposable Permission Admin, Auditor and target users. Cover:

- direct table insert/update/delete denied to `authenticated`;
- direct EXECUTE on the internal permission/warning recorder helpers denied to `authenticated`;
- custom role create and impact preview;
- custom role containing `system.settings.manage` denied;
- permission-item edits on any role with current or historical assignments return `55000`, while name/description-only edits remain allowed;
- scoped role assignment produces `ROLE` source;
- role-assignment preview and mutation return identical findings across multiple item scopes; wildcard/item intersections never widen, a proposed wildcard is checked against covered existing concrete sources, and a broader finding suppresses duplicate narrower findings for the same rule;
- an incompatible role/assignment scope is denied before insert and exposes no constraint detail;
- future `starts_at` is denied so no scheduled Role can activate after the SoD snapshot;
- `SYSTEM_ADMIN` cannot be assigned to a non-`ADMIN` profile or revoked independently from an active `ADMIN` identity;
- revoking the last durable rollout-operator assignment returns `55000`, while revocation succeeds after another active Admin receives a non-expiring role source for `manage_roles`;
- direct profile demotion of the last durable rollout operator returns `55000`; demotion succeeds once another durable operator exists, and the stale System Admin mirror grants nothing after the role change;
- duplicate active assignment is rejected;
- sensitive self-role assignment is denied;
- a warning pair requires complete acknowledgement;
- acceptance owner is active, has Auditor permission and differs from both actor and target;
- Auditor can select resulting audit events but cannot insert/update/delete them;
- revoke removes the effective source without deleting the assignment;
- audit rows exist for create, assign and revoke.

Use a SQLSTATE-specific self-grant assertion:

```sql
begin
  perform public.assign_business_role(
    (select permission_admin_id from phase2_governance_smoke_ids),
    (select sensitive_role_id from phase2_governance_smoke_ids),
    'global', '*', now(), now() + interval '7 days',
    'Tự cấp quyền nhạy cảm không được phép', '[]'::jsonb
  );
  raise exception 'Sensitive self-role assignment unexpectedly succeeded';
exception
  when insufficient_privilege then null;
end;
```

- [x] **Step 9: Run focused tests and commit**

```bash
npx supabase db reset --local --no-seed
npm test -- \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationSodMigration.test.ts
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
git diff --check -- "$COMMANDS_MIGRATION" supabase/tests/authorization_governance_commands_smoke.sql
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_governance_commands_smoke.sql)"
git add "$COMMANDS_MIGRATION" \
  supabase/tests/authorization_governance_commands_smoke.sql \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationSodMigration.test.ts
git commit -m "feat(authz): add governed business role commands"
```

Expected: focused tests PASS and one Task 4 commit.

---

### Task 5: Replace direct-grant deletion with governed revoke/upsert semantics

**Files:**

- Modify: `lib/__tests__/authorizationBusinessRoleMigration.test.ts`
- Modify: `supabase/migrations/<generated>_authorization_governance_commands.sql`
- Modify: `supabase/tests/authorization_governance_commands_smoke.sql`

**Interfaces:**

- Consumes: Task 4 permission and warning helpers.
- Produces: `public.preview_direct_grant_replacement(uuid,jsonb)` and `public.replace_user_permission_grants_v2(uuid,jsonb,text,jsonb)` over one shared private evaluator; compatibility wrapper for the existing two-argument RPC; no delete/reinsert of grant rows.

- [x] **Step 1: Add a failing static direct-grant contract**

```ts
it('governs direct grants without delete/reinsert history loss', () => {
  expect(commandsNormalized).toMatch(/create or replace function public\.replace_user_permission_grants_v2/i);
  expect(commandsNormalized).toMatch(/create or replace function public\.preview_direct_grant_replacement/i);
  expect(commandsNormalized).toMatch(/set is_active = false.*revoked_at.*revoked_reason/is);
  expect(commandsNormalized).not.toMatch(/delete from public\.user_permission_grants/i);
  expect(commandsNormalized).toMatch(/direct_grant_requires_expiry/i);
  expect(commandsNormalized).toMatch(/app_private\.assert_and_record_sod_warnings/i);
});
```

Before editing the shared commands migration, extend `authorization_governance_commands_smoke.sql` with the V2 preview/mutation, multi-scope parity, reason, expiry, revoke-history, self-grant and warning cases listed in Step 6.

- [x] **Step 2: Run the focused test and observe RED**

```bash
npm test -- lib/__tests__/authorizationBusinessRoleMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_governance_commands_smoke.sql)"
```

Expected: static and SQL smoke FAIL against the Task 4 schema because the V2 preview/mutation is absent.

- [x] **Step 3: Add the private governed direct-grant implementation**

Use this exact public contract:

```sql
public.replace_user_permission_grants_v2(
  p_user_id uuid,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
) returns jsonb

public.preview_direct_grant_replacement(
  p_user_id uuid,
  p_grants jsonb
) returns jsonb
```

The private implementation derives the actor and validates the entire payload before mutation:

```sql
v_actor_user_id := app_private.assert_authorization_permission('system.authorization.manage_grants');
v_grants := coalesce(p_grants, '[]'::jsonb);
v_reason := btrim(coalesce(p_reason, ''));

if jsonb_typeof(v_grants) <> 'array' then
  raise exception 'Permission grants payload must be an array' using errcode = '22023';
end if;

select * into v_target
from public.users
where id = p_user_id
for update;

if v_target.id is null or not v_target.is_active or v_target.account_status <> 'ACTIVE' then
  raise exception 'Active target user required' using errcode = '23514';
end if;

if exists (
  select 1
  from (
    select
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id,
      count(*) as row_count
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text, scope_type text, scope_id text,
      is_active boolean, expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
    group by 1, 2, 3
    having count(*) > 1
  ) duplicate_row
) then
  raise exception 'Duplicate direct permission grant key' using errcode = '23505';
end if;

if exists (
  select 1
  from jsonb_to_recordset(v_grants) grant_row(
    permission_code text, scope_type text, scope_id text,
    is_active boolean, expires_at timestamptz
  )
  left join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code and action_row.is_active
  where coalesce(grant_row.is_active, true)
    and (
      action_row.permission_code is null
      or not coalesce(nullif(grant_row.scope_type, ''), 'global') = any(action_row.scope_modes)
      or (action_row.direct_grant_requires_expiry and (grant_row.expires_at is null or grant_row.expires_at <= now()))
      or (action_row.risk_level in ('important','sensitive') and char_length(v_reason) < 10)
    )
) then
  raise exception 'Invalid direct permission grant' using errcode = '23514';
end if;

if exists (
  select 1
  from jsonb_to_recordset(v_grants) grant_row(permission_code text, is_active boolean)
  where coalesce(grant_row.is_active, true)
    and grant_row.permission_code = 'system.settings.manage'
) then
  raise exception 'System identity permissions cannot be granted directly'
    using errcode = '42501';
end if;

if exists (
  select 1
  from jsonb_to_recordset(v_grants) grant_row(
    permission_code text, scope_type text, scope_id text,
    is_active boolean, expires_at timestamptz
  )
  join public.permission_actions action_row
    on action_row.permission_code = grant_row.permission_code
  where p_user_id = v_actor_user_id
    and coalesce(grant_row.is_active, true)
    and action_row.risk_level = 'sensitive'
    and not exists (
      select 1
      from public.user_permission_grants existing
      where existing.user_id = p_user_id
        and existing.permission_code = grant_row.permission_code
        and existing.scope_type = coalesce(nullif(grant_row.scope_type, ''), 'global')
        and existing.scope_id = coalesce(nullif(grant_row.scope_id, ''), '*')
        and existing.is_active
        and existing.expires_at is not distinct from grant_row.expires_at
    )
) then
  raise exception 'Sensitive self-grant is not allowed' using errcode = '42501';
end if;
```

Put normalization, duplicate/action/scope/expiry validation and sensitive self-grant detection in `app_private.evaluate_direct_grant_replacement_impl(actor,target,grants)`. Both the preview RPC and mutation must call this exact helper; the preview is not a client-side approximation. After normalization, the helper passes desired `{permissionCode,scopeType,scopeId}` rows to the Task 3 `app_private.evaluate_authorization_change_set(..., 'REPLACE_DIRECT')` seam instead of implementing a second scope loop.

The shared set evaluator catches a global desired direct permission conflicting with an existing project-scoped role, while avoiding false warnings from direct permissions being removed. The warning-acceptance uniqueness key includes scope, so the mutation can record the same typed rule for multiple affected scopes under one command ID.

Capture complete active `v_before` and a fully normalized desired snapshot. If those snapshots differ, require `char_length(v_reason) >= 10` for every direct-grant change, including revoke-only changes; an exact no-op may return the current snapshot without a new audit row. Recompute the shared decision under the target row lock, generate `v_command_id`, and call `assert_and_record_sod_warnings` exactly once with the complete multi-scope decision before changing any grant row; it rejects any supplied `(ruleCode,scopeType,scopeId)` not present in that decision. The explicit key-level check above rejects a new, reactivated or expiry-modified sensitive self-grant while allowing an unchanged sensitive row to survive a safe retry.

- [x] **Step 4: Revoke omitted rows and upsert desired rows without DELETE**

```sql
update public.user_permission_grants existing
set is_active = false,
    revoked_at = coalesce(existing.revoked_at, now()),
    revoked_by = coalesce(existing.revoked_by, v_actor_user_id),
    revoked_reason = coalesce(existing.revoked_reason, v_reason),
    updated_at = now()
where existing.user_id = p_user_id
  and existing.is_active
  and not exists (
    select 1
    from jsonb_to_recordset(v_grants) desired(
      permission_code text, scope_type text, scope_id text,
      is_active boolean, expires_at timestamptz
    )
    where coalesce(desired.is_active, true)
      and desired.permission_code = existing.permission_code
      and coalesce(nullif(desired.scope_type, ''), 'global') = existing.scope_type
      and coalesce(nullif(desired.scope_id, ''), '*') = existing.scope_id
  );

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active,
  granted_by, granted_at, expires_at, grant_reason,
  revoked_at, revoked_by, revoked_reason
)
select
  p_user_id,
  desired.permission_code,
  coalesce(nullif(desired.scope_type, ''), 'global'),
  coalesce(nullif(desired.scope_id, ''), '*'),
  true,
  v_actor_user_id,
  now(),
  desired.expires_at,
  nullif(v_reason, ''),
  null, null, null
from jsonb_to_recordset(v_grants) desired(
  permission_code text, scope_type text, scope_id text,
  is_active boolean, expires_at timestamptz
)
where coalesce(desired.is_active, true)
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true,
    granted_by = excluded.granted_by,
    granted_at = excluded.granted_at,
    expires_at = excluded.expires_at,
    grant_reason = excluded.grant_reason,
    revoked_at = null,
    revoked_by = null,
    revoked_reason = null,
    updated_at = now();
```

Append one `direct_permission_grants_changed` audit event containing `commandId`, reason, decision, before and after snapshots. If `legacy_projection_enabled` is true, call `app_private.sync_legacy_permission_projection(p_user_id)` after the new grant state is complete and inside the same transaction.

- [x] **Step 5: Keep the old RPC safe during frontend rollout**

```sql
create or replace function public.replace_user_permission_grants(
  p_user_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.replace_user_permission_grants_v2(
    p_user_id,
    p_grants,
    'Compatibility permission update',
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.replace_user_permission_grants_v2(uuid,jsonb,text,jsonb) from public, anon;
grant execute on function public.replace_user_permission_grants_v2(uuid,jsonb,text,jsonb) to authenticated;
revoke all on function public.preview_direct_grant_replacement(uuid,jsonb) from public, anon;
grant execute on function public.preview_direct_grant_replacement(uuid,jsonb) to authenticated;
```

Both new public functions are `security invoker` wrappers with no actor parameter. Revoke their private definer implementations from `PUBLIC`/`anon`, grant the exact signatures to `authenticated` only so the wrappers can enter them, and derive/validate the current actor again inside each private implementation; the preview requires `manage_grants` exactly like the mutation. The compatibility wrapper cannot bypass hard SoD, sensitive expiry or warnings; warning combinations fail closed because the acknowledgement array is empty.

- [x] **Step 6: Expand SQL smoke coverage**

Add checks for:

- unknown permission and unsupported scope denied;
- direct `system.settings.manage` denied even for a Permission Admin;
- important grant without a ten-character reason denied;
- revoke-only direct change without a ten-character reason denied;
- sensitive grant without future expiry denied;
- Permission Admin sensitive self-grant denied;
- unchanged sensitive self-row is an idempotent no-op, but reactivation or expiry extension by the same actor is denied;
- omitted grant becomes inactive with revoke metadata and still exists;
- reactivation of the same key clears revoke metadata and creates audit history;
- warning pair without acceptance denied atomically;
- valid warning acceptance succeeds and is append-only;
- legacy two-argument wrapper fails closed for warning/sensitive cases.

After revoke, assert retained history:

```sql
if not exists (
  select 1
  from public.user_permission_grants grant_row
  where grant_row.user_id = (select target_id from phase2_governance_smoke_ids)
    and grant_row.permission_code = 'project.material_po.create'
    and not grant_row.is_active
    and grant_row.revoked_at is not null
    and grant_row.revoked_reason is not null
) then
  raise exception 'Direct grant revoke history was not retained';
end if;
```

- [x] **Step 7: Run focused and adjacent regression tests**

```bash
npx supabase db reset --local --no-seed
npm test -- \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/authorizationSodMigration.test.ts \
  lib/__tests__/permissionService.test.ts
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
git diff --check -- "$COMMANDS_MIGRATION" supabase/tests/authorization_governance_commands_smoke.sql
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_governance_commands_smoke.sql)"
```

Expected: PASS; frontend behavior has not changed yet.

- [x] **Step 8: Commit Task 5 separately**

```bash
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
git add "$COMMANDS_MIGRATION" \
  supabase/tests/authorization_governance_commands_smoke.sql \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts
git commit -m "feat(authz): govern direct permission grants"
```

Expected: role commands and direct grants remain independently reviewable.

---

### Task 6: Integrate Business Roles with the Phase 1 account lifecycle

**Files:**

- Modify: `lib/__tests__/authorizationBusinessRoleMigration.test.ts`
- Modify: `lib/__tests__/userAccountLifecycleMigration.test.ts`
- Create: `supabase/migrations/<generated>_authorization_account_lifecycle_integration.sql`
- Modify: `supabase/tests/user_account_lifecycle_smoke.sql`

**Interfaces:**

- Consumes: `principal_role_assignments` and Phase 1 `user_account_operations`/preview/response functions.
- Produces: atomic role revocation on account disable, lifecycle preview count `businessRoleAssignments`, and lifecycle result summary count without restoring roles on reactivation.

- [x] **Step 1: Add failing cross-phase lifecycle contracts**

Load one migration ending `_authorization_account_lifecycle_integration.sql` and assert:

```ts
expect(lifecycleIntegrationFiles).toHaveLength(1);
expect(lifecycleIntegrationNormalized).toMatch(/create trigger trg_users_revoke_business_roles_on_disable/i);
expect(lifecycleIntegrationNormalized).toMatch(/update public\.principal_role_assignments.*status = 'REVOKED'/is);
expect(lifecycleIntegrationNormalized).toMatch(/businessRoleAssignments/i);
expect(lifecycleIntegrationNormalized).not.toMatch(/status = 'ACTIVE'.*principal_role_assignments/is);
```

Extend `userAccountLifecycleMigration.test.ts` to concatenate the original lifecycle migration with the forward integration migration for this one assertion:

```ts
expect(combinedLifecycleSql).toMatch(/principal_role_assignments/i);
expect(combinedLifecycleSql).toMatch(/businessRoleAssignments/i);
```

Before creating the integration migration, extend `user_account_lifecycle_smoke.sql` with the role preview/disable/reactivate assertions specified in Step 6.

- [x] **Step 2: Run focused tests and observe RED**

```bash
npm test -- \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/userAccountLifecycleMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/user_account_lifecycle_smoke.sql)"
```

Expected: static and SQL smoke FAIL against the Task 5 schema because the lifecycle integration is absent.

- [x] **Step 3: Create a forward-only lifecycle integration migration**

```bash
npx supabase migration new authorization_account_lifecycle_integration
LIFECYCLE_INTEGRATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_account_lifecycle_integration\.sql$')"
test -n "$LIFECYCLE_INTEGRATION_MIGRATION"
```

- [x] **Step 4: Revoke active role assignments inside the disable transaction**

```sql
create or replace function app_private.revoke_business_roles_on_account_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revoked_count integer := 0;
  v_operation_id uuid;
begin
  if old.account_status = 'ACTIVE' and new.account_status = 'DISABLED' then
    if old.role = 'ADMIN' then
      perform app_private.assert_rollout_operator_continuity(null, new.id);
    end if;

    select operation_row.id into v_operation_id
    from app_private.user_account_operations operation_row
    where operation_row.target_user_id = new.id
      and operation_row.status = 'PREPARED'
      and operation_row.action = 'DISABLE'
    order by operation_row.created_at
    limit 1
    for update;

    update public.principal_role_assignments assignment_row
    set status = 'REVOKED',
        revoked_at = coalesce(assignment_row.revoked_at, now()),
        revoked_by = coalesce(assignment_row.revoked_by, new.disabled_by),
        revoked_reason = coalesce(
          assignment_row.revoked_reason,
          'account_disabled: ' || coalesce(new.disabled_reason, 'Account disabled')
        ),
        updated_at = now()
    where assignment_row.principal_type = 'user'
      and assignment_row.principal_id = new.id
      and assignment_row.status = 'ACTIVE';
    get diagnostics v_revoked_count = row_count;

    if v_operation_id is not null then
      update app_private.user_account_operations
      set before_state = before_state || jsonb_build_object(
            'businessRoleAssignmentsRevoked', v_revoked_count
          ),
          updated_at = now()
      where id = v_operation_id;
    end if;

    if v_revoked_count > 0 then
      insert into public.permission_audit_events (
        actor_user_id, target_user_id, event_type,
        before_grants, after_grants, metadata
      ) values (
        new.disabled_by,
        new.id,
        'business_roles_revoked_on_account_disable',
        '[]'::jsonb,
        '[]'::jsonb,
        jsonb_build_object(
          'operationId', v_operation_id,
          'revokedCount', v_revoked_count,
          'reason', new.disabled_reason
        )
      );
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.revoke_business_roles_on_account_disable()
  from public, anon, authenticated;

create trigger trg_users_revoke_business_roles_on_disable
  after update of account_status on public.users
  for each row execute function app_private.revoke_business_roles_on_account_disable();
```

This trigger runs in the same transaction as `prepare_user_account_lifecycle`; an error rolls back both account disable and role revocation. The lifecycle transaction already locks/updates the target user before this trigger locks assignment rows, matching the global lock order used by role commands.

- [x] **Step 5: Extend lifecycle preview and response without rewriting the orchestrator**

Replace `public.get_user_account_lifecycle_preview(uuid)` with its existing authorization and counts plus:

```sql
'businessRoleAssignments', (
  select count(*)
  from public.principal_role_assignments assignment_row
  where assignment_row.principal_type = 'user'
    and assignment_row.principal_id = u.id
    and assignment_row.status = 'ACTIVE'
),
```

Count every row whose stored status is `ACTIVE`, including future-scheduled or time-expired rows not yet normalized, because the disable trigger revokes that same set. The modal preview count must equal the actual revocation summary rather than only the currently effective resolver subset.

Replace `app_private.account_operation_response(app_private.user_account_operations)` with the same response fields and this merged summary:

```sql
'revocationSummary',
  coalesce(p_operation.before_state -> 'revocationSummary', '{}'::jsonb)
  || jsonb_build_object(
    'businessRoleAssignments',
    coalesce((p_operation.before_state ->> 'businessRoleAssignmentsRevoked')::integer, 0)
  ),
```

Keep all existing revocation summary keys unchanged so the deployed Edge Function remains backward compatible.

- [x] **Step 6: Expand the lifecycle SQL smoke**

Before disable, assign the target one active Business Role and assert preview count `1`. After disable, assert the row remains but has `status='REVOKED'`, revoke metadata and the lifecycle result summary count `1`. After reactivate, assert there is still no active role assignment. Add a separate Admin fixture proving disable of the last durable rollout operator rolls back, then assign another active Admin a non-expiring `manage_roles` role and prove disable can proceed.

```sql
if exists (
  select 1
  from public.principal_role_assignments assignment_row
  where assignment_row.principal_id = (select target_id from account_lifecycle_smoke_ids)
    and assignment_row.status = 'ACTIVE'
) then
  raise exception 'Account lifecycle left or restored an active Business Role';
end if;
```

Clean the disposable role assignment before deleting its user fixture.

- [x] **Step 7: Run focused database contracts and commit Task 6**

```bash
npx supabase db reset --local --no-seed
npm test -- \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/userAccountLifecycleMigration.test.ts
LIFECYCLE_INTEGRATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_account_lifecycle_integration\.sql$')"
git diff --check -- "$LIFECYCLE_INTEGRATION_MIGRATION" \
  supabase/tests/user_account_lifecycle_smoke.sql \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/userAccountLifecycleMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/user_account_lifecycle_smoke.sql)"
git add "$LIFECYCLE_INTEGRATION_MIGRATION" \
  supabase/tests/user_account_lifecycle_smoke.sql \
  lib/__tests__/authorizationBusinessRoleMigration.test.ts \
  lib/__tests__/userAccountLifecycleMigration.test.ts
git commit -m "feat(authz): revoke business roles on account disable"
```

Expected: database contracts PASS and the commit remains green. Task 8 introduces the frontend lifecycle normalization test and implementation together in its own red-green cycle.

---

### Task 7: Add idempotent override evidence, audit and control-owner notification

**Files:**

- Modify: `lib/__tests__/authorizationSodMigration.test.ts`
- Create: `supabase/migrations/<generated>_authorization_override_evidence.sql`
- Create: `supabase/tests/authorization_override_smoke.sql`

**Interfaces:**

- Consumes: `REQUIRE_OVERRIDE` rules, `system.authorization.override`, Auditor resolution and existing `notifications` table.
- Produces: append-only `authorization_override_events`, `public.record_authorization_override(...)`, `app_private.has_valid_authorization_override(...)`, one audit and one notification per idempotency key.

- [x] **Step 1: Add failing override security contracts**

```ts
expect(overrideFiles).toHaveLength(1);
expect(overrideNormalized).toMatch(/create table public\.authorization_override_events/i);
expect(overrideNormalized).toMatch(/idempotency_key uuid not null unique/i);
expect(overrideNormalized).toMatch(/pg_advisory_xact_lock/i);
expect(overrideNormalized).toMatch(/create or replace function app_private\.record_authorization_override_impl/i);
expect(overrideNormalized).toMatch(/create or replace function public\.record_authorization_override/i);
expect(overrideNormalized).toMatch(/create or replace function public\.record_authorization_override\(.*?security invoker/is);
expect(overrideNormalized).toMatch(/system\.authorization\.override/i);
expect(overrideNormalized).toMatch(/insert into public\.permission_audit_events/i);
expect(overrideNormalized).toMatch(/insert into public\.notifications/i);
expect(overrideNormalized).toMatch(/effect = 'REQUIRE_OVERRIDE'.*overridable/is);
expect(overrideNormalized).not.toMatch(/effect = 'DENY'.*record_authorization_override/is);
```

Create `authorization_override_smoke.sql` now with the permission, non-overridable hard-rule, concurrent-safe idempotency, audit, notification, validity and sanitized-error cases listed in Step 7.

- [x] **Step 2: Run the focused test and observe RED**

```bash
npm test -- lib/__tests__/authorizationSodMigration.test.ts
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_override_smoke.sql)"
```

Expected: static and SQL smoke FAIL against the Task 6 schema because the override migration is absent.

- [x] **Step 3: Create the migration through the CLI**

```bash
npx supabase migration new authorization_override_evidence
OVERRIDE_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_override_evidence\.sql$')"
test -n "$OVERRIDE_MIGRATION"
```

- [x] **Step 4: Create the append-only override evidence table**

```sql
create table public.authorization_override_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  rule_code text not null references public.authorization_sod_rules(rule_code) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_]*$'),
  subject_id text not null,
  scope_type text not null
    check (scope_type in ('global','own','assigned','project','construction_site','warehouse','department')),
  scope_id text not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  control_owner_user_id uuid not null references public.users(id) on delete restrict,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  revoked_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index authorization_override_subject_effective_idx
  on public.authorization_override_events (
    rule_code, subject_type, subject_id, actor_user_id, starts_at, expires_at
  ) where revoked_at is null;
create index authorization_override_owner_idx
  on public.authorization_override_events (control_owner_user_id, created_at desc);

alter table public.authorization_override_events enable row level security;
revoke all privileges on table public.authorization_override_events from public, anon, authenticated;
grant select on table public.authorization_override_events to authenticated;

create policy authorization_override_authorized_select
on public.authorization_override_events for select
to authenticated
using (
  actor_user_id = (select public.current_app_user_id())
  or control_owner_user_id = (select public.current_app_user_id())
  or (select app_private.has_permission(
    public.current_app_user_id(), 'system.authorization.audit', 'global', '*'
  ))
);
```

- [x] **Step 5: Implement the idempotent recording command**

Use the exact public signature with no actor parameter:

```sql
public.record_authorization_override(
  p_rule_code text,
  p_subject_type text,
  p_subject_id text,
  p_scope_type text,
  p_scope_id text,
  p_reason text,
  p_control_owner_user_id uuid,
  p_expires_at timestamptz,
  p_idempotency_key uuid
) returns uuid
```

The private implementation must lock/replay safely:

```sql
v_actor_user_id := app_private.assert_authorization_permission('system.authorization.override');
v_subject_type := btrim(coalesce(p_subject_type, ''));
v_subject_id := btrim(coalesce(p_subject_id, ''));
v_scope_type := coalesce(nullif(btrim(coalesce(p_scope_type, '')), ''), 'global');
v_scope_id := coalesce(nullif(btrim(coalesce(p_scope_id, '')), ''), '*');
v_reason := btrim(coalesce(p_reason, ''));

if p_idempotency_key is null then
  raise exception 'Override idempotency key is required' using errcode = '22023';
end if;

perform pg_advisory_xact_lock(
  hashtextextended('authorization_override:' || p_idempotency_key::text, 0)
);

select * into v_existing
from public.authorization_override_events
where idempotency_key = p_idempotency_key
for update;

if v_existing.id is not null then
  if v_existing.actor_user_id <> v_actor_user_id
    or v_existing.rule_code <> p_rule_code
    or v_existing.subject_type <> v_subject_type
    or v_existing.subject_id <> v_subject_id
    or v_existing.scope_type <> v_scope_type
    or v_existing.scope_id <> v_scope_id
    or v_existing.reason <> v_reason
    or v_existing.control_owner_user_id <> p_control_owner_user_id
    or v_existing.expires_at <> p_expires_at
  then
    raise exception 'Idempotency key is already used for another override command'
      using errcode = '23505';
  end if;
  return v_existing.id;
end if;

select * into v_rule
from public.authorization_sod_rules
where rule_code = p_rule_code
  and is_active
  and effect = 'REQUIRE_OVERRIDE'
  and overridable
for share;

if v_rule.rule_code is null then
  raise exception 'Rule cannot be overridden' using errcode = '42501';
end if;

if v_subject_type !~ '^[a-z][a-z0-9_]*$'
  or v_rule.subject_type is distinct from v_subject_type
  or v_subject_id = ''
  or v_scope_type not in (
    'global','own','assigned','project','construction_site','warehouse','department'
  )
  or (v_scope_type = 'global' and v_scope_id <> '*')
  or char_length(v_reason) < 10
  or p_expires_at is null
  or p_expires_at <= now()
  or p_control_owner_user_id = v_actor_user_id
  or not exists (
    select 1 from public.users owner_row
    where owner_row.id = p_control_owner_user_id
      and owner_row.is_active
      and owner_row.account_status = 'ACTIVE'
      and app_private.has_permission(owner_row.id, 'system.authorization.audit', 'global', '*')
  )
then
  raise exception 'Invalid override control evidence' using errcode = '22023';
end if;
```

Insert the event, then exactly one audit and notification in the same transaction:

Use `v_subject_type`, `v_subject_id`, `v_scope_type`, `v_scope_id` and `v_reason` for the event insert and every replay comparison. Do not store the untrimmed payload; semantically identical retry whitespace must resolve to the same canonical command.

```sql
insert into public.permission_audit_events (
  actor_user_id, target_user_id, event_type,
  before_grants, after_grants, metadata
) values (
  v_actor_user_id, v_actor_user_id, 'authorization_override_recorded',
  '[]'::jsonb, '[]'::jsonb,
  jsonb_build_object(
    'overrideId', v_override_id,
    'ruleCode', p_rule_code,
    'subjectType', v_subject_type,
    'scopeType', v_scope_type,
    'scopeId', v_scope_id,
    'controlOwnerUserId', p_control_owner_user_id,
    'expiresAt', p_expires_at,
    'reason', v_reason
  )
);

insert into public.notifications (
  user_id, type, category, title, message, icon, link,
  severity, source_type, source_id, priority, push_enabled,
  action_url, entity_type, entity_id, metadata
) values (
  p_control_owner_user_id,
  'warning',
  'authorization',
  'Có override phân quyền cần giám sát',
  'Một ngoại lệ được kiểm soát vừa được ghi nhận. Mở quản trị phân quyền để xem chi tiết.',
  'shield-alert',
  '/settings',
  'warning',
  'authorization_override',
  v_override_id::text,
  'high',
  true,
  '/#/settings',
  'authorization_override',
  v_override_id,
  jsonb_build_object('ruleCode', p_rule_code, 'subjectType', v_subject_type)
);
```

The user-facing notification does not contain an Auth ID, SQL text, secret, raw exception or service-role information.

Implement the mutation body as `app_private.record_authorization_override_impl(...)`, `security definer set search_path = ''`, with the actor/permission validation above. Expose `public.record_authorization_override(...)` only as a `security invoker` wrapper that delegates once, accepts no actor parameter, and returns the private result. Revoke both functions from `PUBLIC`/`anon`; grant their exact signatures to `authenticated` so the invoker wrapper can enter the self-authorizing private boundary. Do not introduce a new public `security definer` function.

- [x] **Step 6: Add the private validity helper for future workflow RPCs**

```sql
create or replace function app_private.has_valid_authorization_override(
  p_override_id uuid,
  p_rule_code text,
  p_actor_user_id uuid,
  p_subject_type text,
  p_subject_id text,
  p_scope_type text,
  p_scope_id text,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.authorization_override_events override_row
    join public.authorization_sod_rules rule_row
      on rule_row.rule_code = override_row.rule_code
     and rule_row.effect = 'REQUIRE_OVERRIDE'
     and rule_row.overridable
     and rule_row.is_active
    where override_row.id = p_override_id
      and p_actor_user_id = public.current_app_user_id()
      and override_row.rule_code = p_rule_code
      and override_row.actor_user_id = p_actor_user_id
      and override_row.subject_type = p_subject_type
      and override_row.subject_id = p_subject_id
      and override_row.scope_type = coalesce(nullif(p_scope_type, ''), 'global')
      and override_row.scope_id = coalesce(nullif(p_scope_id, ''), '*')
      and override_row.revoked_at is null
      and override_row.starts_at <= p_at
      and override_row.expires_at > p_at
  );
$$;

revoke all on function app_private.has_valid_authorization_override(uuid,text,uuid,text,text,text,text,timestamptz)
  from public, anon, authenticated;
```

- [x] **Step 7: Write override SQL smoke coverage**

Cover:

- no override permission denied;
- Permission Admin does not imply override permission;
- sensitive direct self-grant of override denied;
- a separately authorized operator can record `WORKFLOW_CONTROLLED_EXCEPTION`;
- override subject type must exactly match the seeded rule subject type;
- `WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL` and `PAYMENT_EXECUTOR_FINAL_APPROVAL` reject override recording;
- direct database calls to `app_private.assert_subject_sod` reject same-actor maker/checker and payment executor/final-approver combinations, allow distinct actors, and never consult override evidence;
- retry with the same idempotency key/payload returns the same ID and creates one audit/notification;
- same key with changed payload returns `23505`;
- wrong actor/subject/scope or expired evidence fails `has_valid_authorization_override`;
- response/error messages contain no Auth ID, SQL or secret text;
- all disposable notifications, grants, events and users are cleaned up.

- [x] **Step 8: Run focused tests and commit**

```bash
npx supabase db reset --local --no-seed
npm test -- lib/__tests__/authorizationSodMigration.test.ts
OVERRIDE_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_override_evidence\.sql$')"
git diff --check -- "$OVERRIDE_MIGRATION" supabase/tests/authorization_override_smoke.sql
npx supabase db query --local --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write('begin; '+sql+' rollback;')" supabase/tests/authorization_override_smoke.sql)"
git add "$OVERRIDE_MIGRATION" \
  supabase/tests/authorization_override_smoke.sql \
  lib/__tests__/authorizationSodMigration.test.ts
git commit -m "feat(authz): add controlled override evidence"
```

Expected: PASS and one Task 7 commit.

---

## Mandatory Authorization Review Checkpoint B

**Checkpoint B completed 2026-07-17 (Cloud rollback-only):** all backend security
contracts passed in one linked transaction containing the seven candidate migrations
and six SQL smoke suites. The post-rollback fingerprint was zero for candidate
schema objects, migration history, fixtures and notifications. Review found one
expired-active direct-grant snapshot edge case; it is locked by
`authorization_backend_checkpoint_smoke.sql` and fixed forward-only by
`authorization_backend_checkpoint_hardening.sql`. Full verification passed:
164 test files / 952 tests, TypeScript lint and production build.

Stop after Tasks 3–7 and review the complete database boundary before frontend work:

- a sensitive direct or role self-grant fails at the backend;
- warnings cannot be accepted without reason, independent control owner, expiry and compensating controls;
- typed hard subject SoD rejects at the private database guard and has no override path; module transition wiring remains owned by Phase 4/5;
- only `REQUIRE_OVERRIDE` rules generate evidence;
- override retry is idempotent and emits one audit/notification;
- Auditor can read governed configuration/audit rows but has no mutation path;
- role/direct revoke retains history;
- account disable revokes role assignments in the same transaction and reactivation does not restore them;
- revoke/disable/cutoff cannot remove the last durable rollout operator;
- every public RPC derives the actor and returns sanitized errors;
- no authenticated direct mutation or forged audit event is possible.

---

### Task 8: Add frontend governance types and deterministic risk metadata

**Files:**

- Create: `lib/permissions/authorizationGovernanceTypes.ts`
- Create: `lib/permissions/permissionRisk.ts`
- Create: `lib/__tests__/permissionRisk.test.ts`
- Modify: `lib/permissions/permissionTypes.ts`
- Modify: `lib/permissions/permissionRegistry.ts`
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Modify: `lib/permissions/erpPermissionRegistry.ts`
- Modify: `lib/__tests__/permissionRegistry.test.ts`
- Modify: `types.ts`
- Modify: `lib/userAccountLifecycleService.ts`
- Modify: `lib/__tests__/userAccountLifecycleService.test.ts`

**Interfaces:**

- Consumes: DB return fields and risk classification from Tasks 1–7.
- Produces: stable TypeScript types, registry metadata and `User.effectivePermissions` hydration target.

- [x] **Step 1: Write failing risk/type tests**

```ts
import { describe, expect, it } from 'vitest';
import { classifyPermissionAction, isIdentityBoundPermission } from '../permissions/permissionRisk';

describe('permission risk classification', () => {
  it.each([
    ['project.daily_log', 'view', 'normal', true, false, false],
    ['project.daily_log', 'edit_all', 'important', true, false, false],
    ['project.daily_log', 'approve', 'sensitive', true, true, true],
    ['project.payment', 'mark_paid', 'sensitive', true, true, true],
    ['system.authorization', 'manage_grants', 'sensitive', false, false, true],
    ['system.settings', 'manage', 'important', false, false, false],
  ] as const)(
    '%s.%s has stable metadata',
    (moduleCode, action, riskLevel, isBusinessAction, isBusinessApproval, directGrantRequiresExpiry) => {
      expect(classifyPermissionAction(moduleCode, action)).toEqual({
        riskLevel,
        isBusinessAction,
        isBusinessApproval,
        directGrantRequiresExpiry,
      });
    },
  );

  it('keeps System Admin identity permission out of custom role/direct editors', () => {
    expect(isIdentityBoundPermission('system.settings.manage')).toBe(true);
    expect(isIdentityBoundPermission('system.authorization.manage_roles')).toBe(false);
  });
});
```

Extend registry tests:

```ts
expect(actionByCode['project.daily_log.approve']).toMatchObject({
  riskLevel: 'sensitive',
  isBusinessAction: true,
  isBusinessApproval: true,
  directGrantRequiresExpiry: true,
});
expect(actionByCode['system.authorization.manage_grants']).toMatchObject({
  riskLevel: 'sensitive',
  isBusinessAction: false,
  isBusinessApproval: false,
});
```

For the current registry, iterate every action and assert its four metadata fields are defined and equal the Phase 2 default classifier. Keep a separate factory test proving an explicit module-owned metadata override wins; future Phase 3–6 modules must declare all four fields and may deliberately override the heuristic when their subject/state semantics justify a different risk.

In `userAccountLifecycleService.test.ts`, import a new `normalizeUserAccountOperationResult`, add `businessRoleAssignments: '2'` to both the raw preview and raw result `revocationSummary` fixtures, and expect normalized numeric value `2`. This is the first task that stages that frontend assertion, so the task begins RED and ends green without committing a deliberately failing test.

- [x] **Step 2: Run focused tests and observe RED**

```bash
npm test -- \
  lib/__tests__/permissionRisk.test.ts \
  lib/__tests__/permissionRegistry.test.ts \
  lib/__tests__/userAccountLifecycleService.test.ts
```

Expected: FAIL because the classifier/types and lifecycle role count are absent.

- [x] **Step 3: Add the governance domain types**

```ts
import type { PermissionRiskLevel, PermissionScopeType } from './permissionTypes';

export type EffectivePermissionSourceType = 'ROLE' | 'DIRECT' | 'LEGACY';
export type AuthorizationChangeMode = 'ADD' | 'REPLACE_DIRECT';

export interface EffectivePermissionSource {
  permissionCode: string;
  sourceType: EffectivePermissionSourceType;
  sourceId: string;
  sourceCode: string;
  sourceLabel: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  riskLevel: PermissionRiskLevel;
  isBusinessApproval: boolean;
  metadata: Record<string, unknown>;
}

export interface BusinessRoleItem {
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  sortOrder?: number;
}

export interface BusinessRole {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  isSystem: boolean;
  version: number;
  items: BusinessRoleItem[];
}

export interface PrincipalRoleAssignment {
  id: string;
  principalType: 'user';
  principalId: string;
  roleTemplateId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  startsAt: string;
  expiresAt?: string | null;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  assignedBy?: string | null;
  assignedReason: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
  revokedReason?: string | null;
}

export interface AuthorizationPrincipal {
  userId: string;
  name: string;
  email: string;
  accountStatus: 'ACTIVE' | 'DISABLED';
}

export interface AuthorizationAuditEvent {
  id: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  eventType: string;
  beforeGrants: unknown[] | Record<string, unknown>;
  afterGrants: unknown[] | Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuthorizationSodRule {
  ruleCode: string;
  name: string;
  description: string;
  ruleType: 'SELF_GRANT' | 'PERMISSION_PAIR' | 'SUBJECT_RELATION';
  effect: 'DENY' | 'WARN' | 'REQUIRE_OVERRIDE';
  operationCode?: string | null;
  subjectType?: string | null;
  overridable: boolean;
}

export interface SodFinding {
  ruleCode: string;
  effect: 'DENY' | 'WARN';
  message: string;
  permissionCodes: string[];
  scopeType: PermissionScopeType;
  scopeId: string;
}

export interface AuthorizationDecision {
  hardDenies: SodFinding[];
  warnings: SodFinding[];
}

export interface PreviewAuthorizationChangeInput {
  targetUserId: string;
  proposedPermissionCodes: string[];
  scopeType: PermissionScopeType;
  scopeId: string;
  changeMode: AuthorizationChangeMode;
}

export interface PreviewBusinessRoleAssignmentInput {
  targetUserId: string;
  roleTemplateId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
}

export interface AssignBusinessRoleInput extends PreviewBusinessRoleAssignmentInput {
  startsAt?: string | null;
  expiresAt?: string | null;
  reason: string;
  warningAcceptances: SodWarningAcceptanceInput[];
}

export interface SaveBusinessRoleInput {
  roleTemplateId?: string | null;
  code: string;
  name: string;
  description?: string;
  items: BusinessRoleItem[];
  reason: string;
}

export interface SodWarningAcceptanceInput {
  ruleCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  reason: string;
  controlOwnerUserId: string;
  compensatingControls: string;
  expiresAt: string;
}

export interface BusinessRoleImpactPreview {
  affectedPrincipalCount: number;
  affectedScopeCount: number;
  addedPermissionKeys: string[];
  removedPermissionKeys: string[];
}

export interface AuthorizationOverrideInput {
  ruleCode: string;
  subjectType: string;
  subjectId: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  reason: string;
  controlOwnerUserId: string;
  expiresAt: string;
  idempotencyKey: string;
}
```

- [x] **Step 4: Add deterministic risk classification matching the migration**

```ts
import type { PermissionRiskLevel } from './permissionTypes';

const SENSITIVE_ACTIONS = new Set([
  'approve', 'confirm', 'verify', 'mark_paid', 'publish', 'complete', 'lock',
  'manage_roles', 'manage_grants', 'override',
]);
const IMPORTANT_ACTIONS = new Set([
  'manage', 'manage_scopes', 'audit', 'edit_all', 'delete_all', 'export',
  'perform', 'assign_staff', 'grant_permissions',
]);
const BUSINESS_APPROVAL_ACTIONS = new Set([
  'approve', 'confirm', 'verify', 'mark_paid', 'publish', 'complete', 'lock',
]);

export const IDENTITY_BOUND_PERMISSION_CODES = new Set(['system.settings.manage']);

export const isIdentityBoundPermission = (permissionCode: string): boolean =>
  IDENTITY_BOUND_PERMISSION_CODES.has(permissionCode);

export interface PermissionRiskMetadata {
  riskLevel: PermissionRiskLevel;
  isBusinessAction: boolean;
  isBusinessApproval: boolean;
  directGrantRequiresExpiry: boolean;
}

export const classifyPermissionAction = (
  moduleCode: string,
  action: string,
): PermissionRiskMetadata => {
  const isBusinessAction = !moduleCode.startsWith('system.');
  const isBusinessApproval = isBusinessAction && BUSINESS_APPROVAL_ACTIONS.has(action);
  const riskLevel: PermissionRiskLevel = SENSITIVE_ACTIONS.has(action)
    ? 'sensitive'
    : IMPORTANT_ACTIONS.has(action)
      ? 'important'
      : 'normal';
  return {
    riskLevel,
    isBusinessAction,
    isBusinessApproval,
    directGrantRequiresExpiry: riskLevel === 'sensitive',
  };
};
```

In `permissionTypes.ts`, extend `PermissionActionDefinition`:

```ts
export type PermissionRiskLevel = 'normal' | 'important' | 'sensitive';

riskLevel?: PermissionRiskLevel;
isBusinessAction?: boolean;
isBusinessApproval?: boolean;
directGrantRequiresExpiry?: boolean;
```

`PermissionRiskLevel` lives in the foundational permission-types module, so governance types import it one way and no circular type dependency is introduced.

- [x] **Step 5: Attach metadata at registry construction points**

In each action factory, spread the classifier result:

```ts
return {
  action,
  label,
  permissionCode: `${prefix}.${action}`,
  ...classifyPermissionAction(prefix, action),
  legacyModuleKey,
  legacyRoute,
  scopeTypes,
  sortOrder,
};
```

Accept an optional complete `riskMetadata` argument and spread it after the classifier defaults. Reject/flag partial overrides in TypeScript/tests; a later module may replace the whole four-field classification deliberately, but cannot silently override only one related control.

Export/test `isIdentityBoundPermission(code)` from the same module. Governance role/direct editors filter or disable those codes for custom changes; system-role read views may still display them. This is UX guidance only—the Task 4/5 backend checks remain authoritative.

Add `system.authorization` to the static registry with the six permission codes seeded in Task 1. Do not derive governance actions from `ROUTE_TO_MODULE`; define them explicitly so they remain present even if the Settings route map changes.

- [x] **Step 6: Add effective sources and role counts to root user/lifecycle types**

At the top of `types.ts`:

```ts
import type { EffectivePermissionSource } from './lib/permissions/authorizationGovernanceTypes';
```

Extend `User` and lifecycle types:

```ts
effectivePermissions?: EffectivePermissionSource[];

// UserAccountLifecyclePreview
businessRoleAssignments: number;

// UserAccountRevocationSummary
businessRoleAssignments: number;
```

Normalize the preview field with the existing safe numeric `count(...)` helper. Add `normalizeUserAccountOperationResult(...)` so `executeUserAccountLifecycle` normalizes every revocation-summary count—including `businessRoleAssignments`—before returning instead of casting the Edge Function JSON directly. The offline fallback preview must return `businessRoleAssignments: 0`; never infer an assignment count from legacy `role` or from the number of effective permission-source rows.

- [x] **Step 7: Run focused tests and commit**

```bash
npm test -- \
  lib/__tests__/permissionRisk.test.ts \
  lib/__tests__/permissionRegistry.test.ts \
  lib/__tests__/userAccountLifecycleService.test.ts
npm run lint
git diff --check
git add \
  lib/permissions/authorizationGovernanceTypes.ts \
  lib/permissions/permissionRisk.ts \
  lib/permissions/permissionTypes.ts \
  lib/permissions/permissionRegistry.ts \
  lib/permissions/projectPermissionRegistry.ts \
  lib/permissions/erpPermissionRegistry.ts \
  lib/__tests__/permissionRisk.test.ts \
  lib/__tests__/permissionRegistry.test.ts \
  lib/userAccountLifecycleService.ts \
  lib/__tests__/userAccountLifecycleService.test.ts \
  types.ts
git commit -m "feat(authz): add governance types and risk metadata"
```

Expected: focused tests and TypeScript PASS.

---

### Task 9: Hydrate effective sources and remove frontend business-approval bypass

**Files:**

- Create: `lib/permissions/authorizationGovernanceService.ts`
- Create: `lib/__tests__/authorizationGovernanceService.test.ts`
- Modify: `lib/permissions/permissionAdminService.ts`
- Modify: `context/authState.ts`
- Modify: `context/AuthContext.tsx`
- Modify: `lib/__tests__/authBoundary.test.tsx`
- Modify: `lib/permissions/permissionService.ts`
- Modify: `lib/permissions/projectPermissionService.ts`
- Modify: `lib/routeAccess.ts`
- Modify: `lib/__tests__/routeAccess.test.ts`
- Modify: `lib/__tests__/permissionService.test.ts`
- Modify: `lib/__tests__/projectPermissionService.test.ts`

**Interfaces:**

- Consumes: Task 8 domain types and public Phase 2 RPCs.
- Produces: actor-free RPC payload builders, current-user source hydration and source-authoritative client UX checks.

- [x] **Step 1: Write failing service payload and mapping tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAssignBusinessRoleRpcArgs,
  buildOverrideRpcArgs,
  buildPreviewAuthorizationChangeRpcArgs,
  buildPreviewBusinessRoleAssignmentRpcArgs,
  mapEffectivePermissionSource,
} from '../permissions/authorizationGovernanceService';

describe('authorization governance service contracts', () => {
  it('maps source explanation rows without losing scope/time/risk', () => {
    expect(mapEffectivePermissionSource({
      permission_code: 'project.daily_log.approve',
      source_type: 'ROLE',
      source_id: 'assignment-1',
      source_code: 'PROJECT_APPROVER',
      source_label: 'Project Approver',
      scope_type: 'project',
      scope_id: 'project-1',
      starts_at: '2026-07-17T00:00:00Z',
      expires_at: null,
      risk_level: 'sensitive',
      is_business_approval: true,
      metadata: { roleTemplateId: 'role-1' },
    })).toMatchObject({
      permissionCode: 'project.daily_log.approve',
      sourceType: 'ROLE',
      sourceCode: 'PROJECT_APPROVER',
      scopeType: 'project',
      scopeId: 'project-1',
      riskLevel: 'sensitive',
      isBusinessApproval: true,
    });
  });

  it('never sends an actor field in browser RPC payloads', () => {
    const assignmentArgs = buildAssignBusinessRoleRpcArgs({
      targetUserId: 'user-1', roleTemplateId: 'role-1',
      scopeType: 'project', scopeId: 'project-1',
      startsAt: '2026-07-17T00:00:00Z', expiresAt: null,
      reason: 'Phân công vai trò dự án', warningAcceptances: [],
    });
    const overrideArgs = buildOverrideRpcArgs({
      ruleCode: 'WORKFLOW_CONTROLLED_EXCEPTION',
      subjectType: 'workflow_subject', subjectId: 'subject-1',
      scopeType: 'project', scopeId: 'project-1',
      reason: 'Xử lý ngoại lệ có owner giám sát',
      controlOwnerUserId: 'auditor-1',
      expiresAt: '2026-07-18T00:00:00Z',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    const previewArgs = buildPreviewAuthorizationChangeRpcArgs({
      targetUserId: 'user-1',
      proposedPermissionCodes: ['project.daily_log.approve'],
      scopeType: 'project', scopeId: 'project-1',
      changeMode: 'ADD',
    });
    const rolePreviewArgs = buildPreviewBusinessRoleAssignmentRpcArgs({
      targetUserId: 'user-1', roleTemplateId: 'role-1',
      scopeType: 'project', scopeId: 'project-1',
    });
    expect(Object.keys(assignmentArgs).some(key => /actor/i.test(key))).toBe(false);
    expect(Object.keys(overrideArgs).some(key => /actor/i.test(key))).toBe(false);
    expect(previewArgs.p_change_mode).toBe('ADD');
    expect(Object.keys(previewArgs).some(key => /actor/i.test(key))).toBe(false);
    expect(Object.keys(rolePreviewArgs).some(key => /actor/i.test(key))).toBe(false);
  });
});
```

Mock Supabase and add one service assertion that `previewDirectGrantReplacement` makes exactly one `preview_direct_grant_replacement` RPC with the same normalized active multi-scope payload builder used by the mutation and no actor field; omitted/inactive drafts mean revoke in both calls.

- [x] **Step 2: Add failing permission semantics tests**

Add fixtures with `effectivePermissions` in `permissionService.test.ts`; import `canViewRoute` alongside the existing permission helpers and assert:

```ts
it('denies System Admin automatic business approval when effective sources are authoritative', () => {
  expect(canPerform(user({
    role: Role.ADMIN,
    allowedModules: ['DA'],
    effectivePermissions: [],
  }), 'project.daily_log.approve', {
    scopeType: 'project', scopeId: 'project-1',
  })).toBe(false);
});

it('allows a scoped Business Role source and denies the adjacent scope', () => {
  const roleUser = user({
    effectivePermissions: [{
      permissionCode: 'project.daily_log.approve',
      sourceType: 'ROLE', sourceId: 'assignment-1',
      sourceCode: 'PROJECT_APPROVER', sourceLabel: 'Project Approver',
      scopeType: 'project', scopeId: 'project-1',
      riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
    }],
  });
  expect(canPerform(roleUser, 'project.daily_log.approve', {
    scopeType: 'project', scopeId: 'project-1',
  })).toBe(true);
  expect(canPerform(roleUser, 'project.daily_log.approve', {
    scopeType: 'project', scopeId: 'project-2',
  })).toBe(false);
});

it('uses a direct view source without requiring legacy module arrays', () => {
  expect(canViewModule(user({
    allowedModules: [],
    effectivePermissions: [{
      permissionCode: 'wms.inventory.view',
      sourceType: 'DIRECT', sourceId: 'grant-1',
      sourceCode: 'DIRECT', sourceLabel: 'Direct grant',
      scopeType: 'warehouse', scopeId: 'warehouse-1',
      riskLevel: 'normal', isBusinessApproval: false, metadata: {},
    }],
  }), 'wms.inventory', {
    scopeType: 'warehouse', scopeId: 'warehouse-1',
})).toBe(true);
});

it('fails closed for a malformed effective-source time', () => {
  expect(canPerform(user({
    effectivePermissions: [{
      permissionCode: 'project.daily_log.approve',
      sourceType: 'ROLE', sourceId: 'bad-time',
      sourceCode: 'APPROVER', sourceLabel: 'Approver',
      scopeType: 'project', scopeId: 'project-1',
      startsAt: 'not-a-time', expiresAt: null,
      riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
    }],
  }), 'project.daily_log.approve', {
    scopeType: 'project', scopeId: 'project-1',
  })).toBe(false);
});

it('opens the registered module route for an exact action source without granting adjacent actions', () => {
  const approver = user({
    allowedModules: [], allowedSubModules: {},
    effectivePermissions: [{
      permissionCode: 'project.daily_log.approve',
      sourceType: 'DIRECT', sourceId: 'grant-approve',
      sourceCode: 'DIRECT', sourceLabel: 'Direct grant',
      scopeType: 'project', scopeId: 'project-1',
      riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
    }],
  });
  expect(canViewRoute(approver, '/da/tabs/dailylog')).toBe(true);
  expect(canPerform(approver, 'project.daily_log.verify', {
    scopeType: 'project', scopeId: 'project-1',
  })).toBe(false);
});

it('does not reveal a sibling route from another permission module', () => {
  const poApprover = user({
    effectivePermissions: [{
      permissionCode: 'project.material_po.approve',
      sourceType: 'ROLE', sourceId: 'assignment-po',
      sourceCode: 'PO_APPROVER', sourceLabel: 'PO Approver',
      scopeType: 'project', scopeId: 'project-1',
      riskLevel: 'sensitive', isBusinessApproval: true, metadata: {},
    }],
  });
  expect(canViewRoute(poApprover, '/da/tabs/material/po')).toBe(true);
  expect(canViewRoute(poApprover, '/da/tabs/material/planning')).toBe(false);
});
```

In `routeAccess.test.ts`, extend the user fixture to accept `effectivePermissions` and prove the same fixture passes the actual top-level route gate:

```ts
expect(canAccessRoute(approver, '/da/tabs/dailylog')).toBe(true);
```

Add equivalent `canPerformProjectAction` role-source and System Admin negative cases.

- [x] **Step 3: Run focused tests and observe RED**

```bash
npm test -- \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/permissionService.test.ts \
  lib/__tests__/projectPermissionService.test.ts \
  lib/__tests__/authBoundary.test.tsx
```

Expected: FAIL because service, hydration and effective-source semantics are absent.

- [x] **Step 4: Implement source mapping and actor-free payload builders**

`authorizationGovernanceService.ts` must export:

```ts
export const mapEffectivePermissionSource = (row: any): EffectivePermissionSource => ({
  permissionCode: row.permission_code,
  sourceType: row.source_type,
  sourceId: row.source_id,
  sourceCode: row.source_code,
  sourceLabel: row.source_label,
  scopeType: row.scope_type,
  scopeId: row.scope_id,
  startsAt: row.starts_at,
  expiresAt: row.expires_at,
  riskLevel: row.risk_level,
  isBusinessApproval: Boolean(row.is_business_approval),
  metadata: row.metadata || {},
});

export const buildAssignBusinessRoleRpcArgs = (input: AssignBusinessRoleInput) => ({
  p_target_user_id: input.targetUserId,
  p_role_template_id: input.roleTemplateId,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
  p_starts_at: input.startsAt || null,
  p_expires_at: input.expiresAt || null,
  p_reason: input.reason.trim(),
  p_warning_acceptances: input.warningAcceptances,
});

export const buildPreviewAuthorizationChangeRpcArgs = (
  input: PreviewAuthorizationChangeInput,
) => ({
  p_target_user_id: input.targetUserId,
  p_proposed_permission_codes: input.proposedPermissionCodes,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
  p_change_mode: input.changeMode,
});

export const buildPreviewBusinessRoleAssignmentRpcArgs = (
  input: PreviewBusinessRoleAssignmentInput,
) => ({
  p_target_user_id: input.targetUserId,
  p_role_template_id: input.roleTemplateId,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
});

export const buildOverrideRpcArgs = (input: AuthorizationOverrideInput) => ({
  p_rule_code: input.ruleCode,
  p_subject_type: input.subjectType,
  p_subject_id: input.subjectId,
  p_scope_type: input.scopeType,
  p_scope_id: input.scopeId,
  p_reason: input.reason.trim(),
  p_control_owner_user_id: input.controlOwnerUserId,
  p_expires_at: input.expiresAt,
  p_idempotency_key: input.idempotencyKey,
});
```

Add service methods:

```ts
listAuthorizationPrincipals(): Promise<AuthorizationPrincipal[]>
listPermissionAuditEvents(limit?: number): Promise<AuthorizationAuditEvent[]>
listOverridableSodRules(): Promise<AuthorizationSodRule[]>
listBusinessRoles(): Promise<BusinessRole[]>
listPrincipalRoleAssignments(targetUserId: string): Promise<PrincipalRoleAssignment[]>
listEffectivePermissionSources(targetUserId: string): Promise<EffectivePermissionSource[]>
previewAuthorizationChange(input: PreviewAuthorizationChangeInput): Promise<AuthorizationDecision>
previewBusinessRoleAssignment(input: PreviewBusinessRoleAssignmentInput): Promise<AuthorizationDecision>
previewDirectGrantReplacement(targetUserId: string, grants: readonly UserPermissionGrant[]): Promise<AuthorizationDecision>
previewBusinessRoleChange(roleTemplateId: string | null, items: BusinessRoleItem[]): Promise<BusinessRoleImpactPreview>
saveBusinessRole(input: SaveBusinessRoleInput): Promise<string>
assignBusinessRole(input: AssignBusinessRoleInput): Promise<string>
revokeBusinessRoleAssignment(assignmentId: string, reason: string): Promise<void>
recordAuthorizationOverride(input: AuthorizationOverrideInput): Promise<string>
```

Each mutation method calls exactly one RPC, throws on Supabase error, and never retries internally. `listPermissionAuditEvents` performs a bounded, newest-first read (default/max `100`) from `permission_audit_events`; RLS—not a client filter—decides visibility. `listOverridableSodRules` selects only active `REQUIRE_OVERRIDE` + `overridable=true` rows and maps a safe typed subset; table RLS still authorizes the read. `previewBusinessRoleAssignment` delegates role-item scope intersection to the dedicated backend RPC; the client never flattens a role to permission codes. `previewDirectGrantReplacement` sends the complete normalized grant draft to its dedicated backend preview RPC, which may evaluate multiple scopes internally but remains one browser request. Idempotency retry remains an explicit caller action using the same key.

- [x] **Step 5: Upgrade the direct-grant admin service to the V2 RPC**

```ts
export interface ReplaceDirectGrantsOptions {
  reason: string;
  warningAcceptances: SodWarningAcceptanceInput[];
}

export const buildDirectGrantReplacementPayload = (
  grants: readonly UserPermissionGrant[],
) => grants.filter(grant => grant.isActive !== false).map(grant => ({
  permission_code: grant.permissionCode,
  scope_type: grant.scopeType || 'global',
  scope_id: grant.scopeId || '*',
  is_active: true,
  expires_at: grant.expiresAt || null,
}));

export const replaceUserPermissionGrants = async (
  userId: string,
  grants: readonly UserPermissionGrant[],
  options: ReplaceDirectGrantsOptions,
): Promise<void> => {
  if (!isSupabaseConfigured || !userId) return;
  const payload = buildDirectGrantReplacementPayload(grants);
  const { error } = await supabase.rpc('replace_user_permission_grants_v2', {
    p_user_id: userId,
    p_grants: payload,
    p_reason: options.reason.trim(),
    p_warning_acceptances: options.warningAcceptances,
  });
  if (error) throw error;
};
```

- [x] **Step 6: Hydrate effective sources after verified active-profile resolution**

Extend `AuthProfileGateway`:

```ts
loadEffectivePermissionSources(userId: string): Promise<EffectivePermissionSource[]>;
```

In `resolveCandidateSession`, load direct grants, effective sources and signature concurrently only after exact active profile verification:

```ts
const [permissionGrants, effectivePermissions, signatureUrl] = await Promise.all([
  gateway.loadPermissionGrants(mappedUser.id),
  gateway.loadEffectivePermissionSources(mappedUser.id),
  gateway.loadSignatureUrl(mappedUser.id),
]);
return { ...mappedUser, permissionGrants, effectivePermissions, signatureUrl };
```

In `AuthContext.tsx`, implement the gateway through `public.get_effective_permission_sources` and `mapEffectivePermissionSource`. Any RPC failure remains `profile_load_failed`; do not fall back to role or legacy arrays because that would hide a backend authorization failure.

Update `authBoundary.test.tsx` so the gateway returns a source fixture and the resolved user includes it. Add a failure case where `loadEffectivePermissionSources` rejects and authentication fails closed.

- [x] **Step 7: Make effective sources authoritative in client checks**

Add these helpers in `permissionService.ts`:

```ts
const effectiveSourceMatches = (
  source: EffectivePermissionSource,
  permissionCode: string,
  scope?: PermissionScope,
  now = new Date(),
): boolean => {
  if (source.permissionCode !== permissionCode) return false;
  const startsAt = source.startsAt ? new Date(source.startsAt).getTime() : null;
  const expiresAt = source.expiresAt ? new Date(source.expiresAt).getTime() : null;
  if (startsAt !== null && (!Number.isFinite(startsAt) || startsAt > now.getTime())) return false;
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())) return false;
  return scopeMatches({
    userId: '', permissionCode: source.permissionCode,
    scopeType: source.scopeType, scopeId: source.scopeId, isActive: true,
  }, scope);
};

export const userHasEffectivePermission = (
  user: Pick<User, 'effectivePermissions'> | null | undefined,
  permissionCode: string,
  scope?: PermissionScope,
): boolean => Boolean(user?.effectivePermissions?.some(source =>
  effectiveSourceMatches(source, permissionCode, scope)
));
```

`canPerform` uses this order:

1. If `effectivePermissions !== undefined`, return only the authoritative source match.
2. For mock/offline users without authoritative sources, allow an active direct grant.
3. For mock/offline `Role.ADMIN`, allow only a registered action whose metadata is not `isBusinessApproval`; unknown permission codes remain denied.
4. Apply existing legacy fallback.

Apply the same authoritative-first rule to `canViewModule`, `canViewRoute`, `canManageRoute`, `canAccessRoute` and Project action helpers. Include `effectivePermissions` in the `canAccessRoute` input type. Keep route visibility separate from action approval: a System Admin may open a module route while a sensitive backend action remains denied.

For route/module visibility, use the permission registry's action-to-route/module mapping: a currently valid effective source may reveal its action's matching `legacyRoute`/registered route and the minimum parent shell needed to reach it, but never a sibling permission module's route. Fall back to module-wide visibility only when the module has one route or the action has no finer route mapping. When navigation asks without a concrete business scope, visibility may match a source in any scope; when a scope is supplied it must match normally. Backend action checks always require the exact requested scope. Never require `allowedModules`/`allowedSubModules` when authoritative sources are present, and never treat route visibility as backend action permission. This directly closes the known “new permission works only when legacy module is also checked” dependency without performing Phase 3 legacy cutover.

- [x] **Step 8: Run focused and route regression tests**

```bash
npm test -- \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/authBoundary.test.tsx \
  lib/__tests__/routeAccess.test.ts \
  lib/__tests__/permissionService.test.ts \
  lib/__tests__/projectPermissionService.test.ts \
  lib/__tests__/permissionRouteRegistry.test.ts \
  lib/__tests__/globalModulePermissions.phase4.test.ts \
  lib/__tests__/wmsPermissions.phase4.test.ts
npm run lint
```

Expected: all focused tests and TypeScript PASS. Update existing admin test expectations only for business approvals; do not broadly weaken non-approval compatibility tests.

- [x] **Step 9: Commit Task 9**

```bash
git add \
  lib/permissions/authorizationGovernanceService.ts \
  lib/permissions/permissionAdminService.ts \
  context/authState.ts context/AuthContext.tsx \
  lib/permissions/permissionService.ts \
  lib/permissions/projectPermissionService.ts \
  lib/routeAccess.ts \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/authBoundary.test.tsx \
  lib/__tests__/routeAccess.test.ts \
  lib/__tests__/permissionService.test.ts \
  lib/__tests__/projectPermissionService.test.ts
git commit -m "feat(authz): hydrate effective permission sources"
```

---

### Task 10: Build source-aware governance view models and UI components

**Files:**

- Create: `lib/permissions/authorizationGovernanceViewModel.ts`
- Create: `lib/__tests__/authorizationGovernanceViewModel.test.ts`
- Create: `components/permissions/EffectivePermissionSourceList.tsx`
- Create: `components/permissions/BusinessRoleEditor.tsx`
- Create: `components/permissions/PrincipalRoleAssignmentPanel.tsx`
- Create: `components/permissions/PrincipalDirectGrantPanel.tsx`
- Create: `components/permissions/SodWarningPanel.tsx`
- Create: `components/permissions/AuthorizationOverrideDialog.tsx`
- Modify: `components/permissions/PermissionMatrix.tsx`
- Modify: `components/permissions/PermissionDiffPreview.tsx`

**Interfaces:**

- Consumes: Task 9 service/domain types.
- Produces: presentational components with direct-grant checkbox state separated from effective-source state.

- [ ] **Step 1: Write failing view-model tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildEffectivePermissionRows,
  buildPermissionSourceBadges,
  validateDirectGrantDrafts,
  validateSodWarningAcceptances,
} from '../permissions/authorizationGovernanceViewModel';

const roleSource = {
  permissionCode: 'project.daily_log.approve',
  sourceType: 'ROLE' as const,
  sourceId: 'assignment-1',
  sourceCode: 'PROJECT_APPROVER',
  sourceLabel: 'Project Approver',
  scopeType: 'project' as const,
  scopeId: 'project-1',
  riskLevel: 'sensitive' as const,
  isBusinessApproval: true,
  metadata: {},
};

describe('authorization governance view model', () => {
  it('keeps multiple effective sources visible for one permission', () => {
    expect(buildPermissionSourceBadges([
      roleSource,
      { ...roleSource, sourceType: 'LEGACY', sourceId: 'DA', sourceCode: 'DA', sourceLabel: 'Legacy permission' },
    ])).toEqual([
      { key: 'project.daily_log.approve::project::project-1::ROLE::assignment-1', kind: 'ROLE', label: 'Business Role · Project Approver' },
      { key: 'project.daily_log.approve::project::project-1::LEGACY::DA', kind: 'LEGACY', label: 'Legacy · DA' },
    ]);
  });

  it('does not turn an inherited source into a direct checkbox', () => {
    expect(buildEffectivePermissionRows([], [roleSource])[0]).toMatchObject({
      permissionCode: 'project.daily_log.approve',
      hasDirectGrant: false,
      isEffective: true,
    });
  });

  it('requires future expiry for a sensitive direct grant', () => {
    expect(validateDirectGrantDrafts([], [{
      userId: 'user-1', permissionCode: 'project.daily_log.approve',
      scopeType: 'project', scopeId: 'project-1', isActive: true,
    }], new Map([['project.daily_log.approve', 'sensitive']]), new Date('2026-07-17T00:00:00Z'), 'Cấp quyền duyệt có thời hạn'))
      .toContain('project.daily_log.approve cần ngày hết hạn trong tương lai.');
  });

  it('requires exactly one complete acceptance per warning scope key', () => {
    const decision = {
      hardDenies: [],
      warnings: [{
        ruleCode: 'PO_CREATE_APPROVE', effect: 'WARN' as const,
        message: 'Cần kiểm soát', permissionCodes: ['a', 'b'],
        scopeType: 'project' as const, scopeId: 'project-1',
      }],
    };
    expect(validateSodWarningAcceptances(decision, [], new Date('2026-07-17T00:00:00Z')))
      .toContain('Thiếu xác nhận SoD cho PO_CREATE_APPROVE tại project/project-1.');
  });
});
```

- [ ] **Step 2: Run the view-model test and observe RED**

```bash
npm test -- lib/__tests__/authorizationGovernanceViewModel.test.ts
```

Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement pure grouping, badge and validation helpers**

```ts
export const sourceKey = (source: EffectivePermissionSource): string =>
  `${source.permissionCode}::${source.scopeType}::${source.scopeId}::${source.sourceType}::${source.sourceId}`;

const SOURCE_BADGE_ORDER: Record<EffectivePermissionSourceType, number> = {
  ROLE: 0,
  DIRECT: 1,
  LEGACY: 2,
};

export const buildPermissionSourceBadges = (sources: EffectivePermissionSource[]) =>
  [...sources]
    .sort((a, b) =>
      SOURCE_BADGE_ORDER[a.sourceType] - SOURCE_BADGE_ORDER[b.sourceType]
      || `${a.sourceCode}:${a.sourceId}`.localeCompare(`${b.sourceCode}:${b.sourceId}`)
    )
    .map(source => ({
      key: sourceKey(source),
      kind: source.sourceType,
      label: source.sourceType === 'ROLE'
        ? `Business Role · ${source.sourceLabel}`
        : source.sourceType === 'DIRECT'
          ? 'Direct'
          : `Legacy · ${source.sourceCode}`,
    }));

export const buildEffectivePermissionRows = (
  directGrants: readonly UserPermissionGrant[],
  effectiveSources: readonly EffectivePermissionSource[],
) => {
  const codes = new Set([
    ...directGrants.map(grant => grant.permissionCode),
    ...effectiveSources.map(source => source.permissionCode),
  ]);
  return [...codes].sort().map(permissionCode => ({
    permissionCode,
    hasDirectGrant: directGrants.some(grant => grant.permissionCode === permissionCode && grant.isActive !== false),
    isEffective: effectiveSources.some(source => source.permissionCode === permissionCode),
    sources: effectiveSources.filter(source => source.permissionCode === permissionCode),
  }));
};
```

`validateDirectGrantDrafts(before, after, riskMap, now, reason)` rejects missing/expired sensitive expiry, unsupported scope and a reason shorter than ten characters for any actual add/change/revoke. Exact no-op needs no reason. It returns Vietnamese messages, never SQL or raw backend errors.

`validateSodWarningAcceptances(decision, acceptances, now)` keys both sides by `(ruleCode,scopeType,scopeId)`, requires exactly one acceptance per warning, rejects missing/duplicate/invented keys, short reason/controls, empty owner and non-future expiry, and returns only generic Vietnamese validation messages. Actor/target independence remains backend-enforced; the UI additionally excludes those known IDs from choices.

- [ ] **Step 4: Make PermissionMatrix direct-state and source-state distinct**

Change props to:

```ts
interface PermissionMatrixProps {
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  applicationCodes?: readonly string[];
  targetUserId?: string;
  scope: PermissionScope;
  disabled?: boolean;
  onChange: (grants: UserPermissionGrant[]) => void;
}
```

For each action:

```tsx
const explicit = explicitGrantKeys.has(currentKey);
const sources = effectiveSources.filter(source =>
  source.permissionCode === action.permissionCode &&
  (source.scopeType === 'global' || (
    source.scopeType === (scope.scopeType || 'global') &&
    (source.scopeId === '*' || source.scopeId === (scope.scopeId || '*'))
  ))
);
const effective = sources.length > 0;

<input
  type="checkbox"
  checked={explicit}
  disabled={disabled || !scopeAllowed || isIdentityBoundPermission(action.permissionCode)}
  onChange={event => toggleGrant(action.permissionCode, event.target.checked)}
/>
<span>{action.label}</span>
{effective && buildPermissionSourceBadges(sources).map(badge => (
  <span key={badge.key}>{badge.label}</span>
))}
<span>{action.riskLevel === 'sensitive' ? 'Nhạy cảm' : action.riskLevel === 'important' ? 'Quan trọng' : ''}</span>
```

Unchecking a direct checkbox removes only the direct draft. Role/Legacy badges remain visible, so the UI never implies that inherited permission disappeared.

- [ ] **Step 5: Implement EffectivePermissionSourceList**

Props:

```ts
interface EffectivePermissionSourceListProps {
  sources: readonly EffectivePermissionSource[];
  emptyLabel?: string;
}
```

Group by permission code and render permission label/code, source badge, scope, effective start and expiry. Render `Không có quyền hiệu lực` for an empty list. Expired sources should not normally be returned, but if supplied by a test/admin history view label them `Đã hết hạn` rather than effective.

- [ ] **Step 6: Implement BusinessRoleEditor and assignment panel**

`BusinessRoleEditor` props:

```ts
interface BusinessRoleEditorProps {
  role: BusinessRole | null;
  permissionActions: readonly PermissionActionDefinition[];
  preview: BusinessRoleImpactPreview | null;
  disabled: boolean;
  onPreview: (items: BusinessRoleItem[]) => Promise<void>;
  onSave: (input: SaveBusinessRoleInput) => Promise<void>;
}
```

It requires role name, immutable code on edit, reason of at least ten characters, excludes identity-bound permissions from custom-role choices, and displays affected principal/scope history counts before enabling Save. If an item diff has `affectedPrincipalCount > 0`, disable the permission-item Save path and direct the admin to clone/create a new role and reassign; revoked/expired history still blocks mutation. Name/description-only edits remain available. Disable all editing for `isSystem` roles.

`PrincipalRoleAssignmentPanel` props:

```ts
interface PrincipalRoleAssignmentPanelProps {
  principal: AuthorizationPrincipal;
  roles: readonly BusinessRole[];
  assignments: readonly PrincipalRoleAssignment[];
  decision: AuthorizationDecision | null;
  disabled: boolean;
  onPreview: (roleId: string, scope: PermissionScope) => Promise<void>;
  onAssign: (input: AssignBusinessRoleInput) => Promise<void>;
  onRevoke: (assignmentId: string, reason: string) => Promise<void>;
}
```

It displays effective/expiry time and reason, but Phase 2 offers no future-start scheduler and submits `startsAt: null` so the server chooses transaction time. It never offers an active assignment to a disabled principal and sends no actor ID. `onPreview` must call the dedicated role-assignment preview RPC. Bind the returned decision to a deterministic `(principalId,roleId,scopeType,scopeId)` draft key; any field change invalidates it and disables Assign until re-previewed, preventing warning evidence from one scope being submitted for another.

`PrincipalDirectGrantPanel` props:

```ts
interface PrincipalDirectGrantPanelProps {
  principal: AuthorizationPrincipal;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  permissionActions: readonly PermissionActionDefinition[];
  disabled: boolean;
  onPreview: (grants: readonly UserPermissionGrant[]) => Promise<AuthorizationDecision>;
  onSave: (
    grants: readonly UserPermissionGrant[],
    reason: string,
    acceptances: readonly SodWarningAcceptanceInput[],
  ) => Promise<void>;
}
```

It owns scope selection, sensitive expiry, reason, full-draft backend preview and `SodWarningPanel`, but contains no profile/role/email/password fields. Bind preview/acceptances to a canonical full-draft hash (sorted permission/scope/expiry keys plus target); any draft change clears both and disables Save until a new preview and complete `validateSodWarningAcceptances` pass. It is the primary direct-grant UI for a non-`ADMIN` Permission Admin; `UserModal` reuses the same view-model/service contract only for actors who also have account-profile access.

- [ ] **Step 7: Implement SoDWarningPanel and override dialog**

`SodWarningPanel` renders one form per backend warning and requires:

- the exact backend `scopeType`/`scopeId`, carried read-only into the acknowledgement key;
- reason with ten characters;
- active control owner different from current actor and affected principal;
- future expiry;
- compensating controls with ten characters.

It cannot dismiss a warning locally; the parent command remains disabled until all backend-returned `ruleCode` values have valid evidence.

`AuthorizationOverrideDialog` receives `rules: readonly AuthorizationSodRule[]`, `controlOwners`, immutable affected subject/scope supplied by a module integration, and an `onSubmit` callback; it never renders a free-form subject-type/subject-ID field. It renders only the already-filtered active `REQUIRE_OVERRIDE` rules and owns one idempotency key created when opened:

```ts
const [idempotencyKey] = useState(() => crypto.randomUUID());
```

Retry retains that key. Closing must unmount the dialog (or explicitly regenerate on the next open), so reopening creates a new command. The dialog only lists `REQUIRE_OVERRIDE` rules and displays a generic safe failure through `getApiErrorMessage`; it never renders raw `details`, `hint`, SQL or Auth identifiers. Task 10 builds the reusable component, but Phase 4 is the first phase allowed to mount it from a real locked workflow subject.

- [ ] **Step 8: Make PermissionDiffPreview source-aware**

Keep added/removed counts limited to direct grants and add a separate line:

```tsx
<span>{inheritedEffectiveCount} quyền vẫn hiệu lực từ Business Role/Legacy</span>
```

Do not include inherited sources in direct `+/-` totals.

- [ ] **Step 9: Run focused tests, lint and build**

```bash
npm test -- lib/__tests__/authorizationGovernanceViewModel.test.ts
npm run lint
npm run build
```

Expected: PASS; Vite may emit the already-known chunk-size warning but exits `0`.

- [ ] **Step 10: Commit Task 10**

```bash
git add \
  lib/permissions/authorizationGovernanceViewModel.ts \
  lib/__tests__/authorizationGovernanceViewModel.test.ts \
  components/permissions/EffectivePermissionSourceList.tsx \
  components/permissions/BusinessRoleEditor.tsx \
  components/permissions/PrincipalRoleAssignmentPanel.tsx \
  components/permissions/PrincipalDirectGrantPanel.tsx \
  components/permissions/SodWarningPanel.tsx \
  components/permissions/AuthorizationOverrideDialog.tsx \
  components/permissions/PermissionMatrix.tsx \
  components/permissions/PermissionDiffPreview.tsx
git commit -m "feat(authz): add source-aware governance controls"
```

---

### Task 11: Integrate governance administration and split profile save from permission save

**Files:**

- Create: `pages/settings/SettingsAuthorizationGovernance.tsx`
- Create: `lib/__tests__/authorizationAdminUiContract.test.ts`
- Modify: `pages/Settings.tsx`
- Modify: `components/UserModal.tsx`
- Modify: `pages/settings/SettingsUsers.tsx`

**Interfaces:**

- Consumes: Tasks 9–10 service/components.
- Produces: a permission-gated governance tab; source-aware user direct-grant editing; no misleading combined profile/permission save before Phase 3.

- [ ] **Step 1: Write the failing UI integration contract**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('authorization admin UI contract', () => {
  it('gates the governance tab with the new permission', () => {
    const settings = read('pages/Settings.tsx');
    expect(settings).toContain("system.authorization.view");
    expect(settings).toContain('SettingsAuthorizationGovernance');
  });

  it('uses source explanation and the governed V2 direct-grant service', () => {
    const modal = read('components/UserModal.tsx');
    expect(modal).toContain('listEffectivePermissionSources');
    expect(modal).toContain('replaceUserPermissionGrants');
    expect(modal).toContain('previewDirectGrantReplacement');
    expect(modal).toContain('isIdentityBoundPermission');
    expect(modal).toContain('canManageDirectGrants');
    expect(modal).not.toMatch(/formData\.role !== Role\.ADMIN\s*&&\s*\([\s\S]*PermissionMatrix/);
    expect(modal).toContain('permissionChangeReason');
    expect(modal).toContain('warningAcceptances');
    expect(modal).toContain('Lưu phân quyền');
  });

  it('does not pretend profile and permissions save atomically in Phase 2', () => {
    const modal = read('components/UserModal.tsx');
    expect(modal).toContain('handleSaveDirectPermissions');
    expect(modal).not.toMatch(/await onSave\(finalUser\);\s*if \(isSupabaseConfigured\) \{\s*await replaceUserPermissionGrants/s);
  });

  it('contains no browser actor payload', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    expect(page).toContain('PrincipalDirectGrantPanel');
    expect(page).toContain('previewBusinessRoleAssignment');
    expect(page).not.toMatch(/p_actor|actorUserId|requestedBy/);
  });
});
```

- [ ] **Step 2: Run the contract and observe RED**

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because the page/integration is absent.

- [ ] **Step 3: Build the governance settings page**

`SettingsAuthorizationGovernance.tsx` must:

1. Load principals, roles and the selected principal's effective sources through `authorizationGovernanceService`; load raw assignment rows only for `canManageRoles || canAudit`, because view-only System Admin access uses the sanitized source RPC rather than broader assignment-table RLS.
2. Derive capabilities from current user effective permissions:

```ts
const canManageRoles = canPerform(currentUser, 'system.authorization.manage_roles');
const canManageGrants = canPerform(currentUser, 'system.authorization.manage_grants');
const canAudit = canPerform(currentUser, 'system.authorization.audit');
const canOverride = canPerform(currentUser, 'system.authorization.override');
```

3. Render role editor only when `canManageRoles`; render read-only roles otherwise.
4. Render assignment actions only when `canManageRoles`; render effective sources for view/audit users.
5. Render `PrincipalDirectGrantPanel` when `canManageGrants`, including for a non-`ADMIN` Permission Admin; it must not depend on access to the Users/profile tab.
6. Do not render a generic “create override” action in Settings: this page has no real workflow subject to bind. When `canOverride`, it may load/read the overridable rule catalog and audit evidence, and must explain that override starts from a supported workflow subject; Permission Admin alone sees neither capability. Phase 4 mounts `AuthorizationOverrideDialog` with immutable Daily Log subject/scope context.
7. When `canAudit`, load and render the bounded recent authorization event list; never render raw JSON blindly, and let the backend RLS policy determine rows.
8. Before role assignment, call `previewBusinessRoleAssignment` with target, role and assignment scope; pass the returned exact multi-scope warning evidence into `assignBusinessRole`. Never flatten selected role items into the generic single-scope preview.
9. Reload assignments, direct grants, sources and audit events after each successful command.
10. Use generic Vietnamese errors through `getApiErrorMessage`, log structured errors with `logApiError`, and never display raw database details/hints.

Use an explicit loading state and fail closed:

```tsx
if (!canPerform(currentUser, 'system.authorization.view')) {
  return <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">Bạn không có quyền xem quản trị phân quyền.</div>;
}
```

- [ ] **Step 4: Add the permission-gated Settings tab**

In `Settings.tsx`:

```ts
const canViewAuthorizationGovernance = canPerform(currentUser, 'system.authorization.view');
```

Add a tab filtered by this boolean, not `Role.ADMIN`:

```ts
{ id: 'authorization', label: 'Phân quyền', icon: ShieldCheck, authorizationOnly: true }
```

Render:

```tsx
{activeSettingsTab === 'authorization' && (
  <SettingsAuthorizationGovernance currentUser={currentUser} />
)}
```

Update the filter so `authorizationOnly` uses `canViewAuthorizationGovernance`. Do not load the broad `admin` module merely to populate this page; its principal directory comes from the minimal RPC.

- [ ] **Step 5: Load target effective sources in UserModal**

Add state:

```ts
const [effectiveSources, setEffectiveSources] = useState<EffectivePermissionSource[]>([]);
const [permissionChangeReason, setPermissionChangeReason] = useState('');
const [authorizationDecision, setAuthorizationDecision] = useState<AuthorizationDecision | null>(null);
const [warningAcceptances, setWarningAcceptances] = useState<SodWarningAcceptanceInput[]>([]);
const [savingPermissions, setSavingPermissions] = useState(false);
```

When an existing target opens and `canManageDirectGrants` is true, load direct grants and effective sources concurrently. A System Admin without explicit Permission Admin authority performs profile/account lifecycle work without issuing those governance reads or rendering direct controls. A source-load error disables direct permission save and shows a safe toast; it must not silently use legacy arrays as source explanation.

Pass `effectiveSources` to `PermissionMatrix` and `PermissionDiffPreview`. Remove the old blanket `inheritedPermissionCodes` badge path.

Remove target-role shortcuts around the new permission UI: do not hide the matrix merely because `formData.role === Role.ADMIN`, and do not coerce an Admin target's direct draft to `[]`. `Role.ADMIN` remains identity/compatibility metadata; an Admin receives business authority only from an explicit governed `ROLE`/`DIRECT` source after cutover.

- [ ] **Step 6: Add expiry, reason and backend SoD preview for direct changes**

For active direct grants classified sensitive, render a `datetime-local` expiry input and write ISO time to `grant.expiresAt`. Render one shared reason textarea. On every explicit Preview click send the complete draft to the shared backend evaluator:

```ts
const decision = await authorizationGovernanceService.previewDirectGrantReplacement(
  userToEdit.id,
  permissionGrants,
);
setAuthorizationDecision(decision);
```

If `hardDenies.length > 0`, disable Save. If warnings exist, render `SodWarningPanel` and require acknowledgements for the exact returned codes.

- [ ] **Step 7: Split profile save and direct permission save**

Remove the direct-grant RPC call from `handleSubmit`. Profile save continues to update identity/profile only.

Add:

```ts
const handleSaveDirectPermissions = async () => {
  if (!userToEdit?.id) {
    toast.warning('Hãy tạo tài khoản trước', 'Phân quyền chỉ được lưu sau khi tài khoản ứng dụng tồn tại.');
    return;
  }
  const validationErrors = validateDirectGrantDrafts(
    originalPermissionGrants,
    permissionGrants,
    riskByPermissionCode,
    new Date(),
    permissionChangeReason,
  );
  if (validationErrors.length > 0) {
    toast.warning('Chưa thể lưu phân quyền', validationErrors[0]);
    return;
  }
  setSavingPermissions(true);
  try {
    const decision = await authorizationGovernanceService.previewDirectGrantReplacement(
      userToEdit.id,
      permissionGrants,
    );
    if (decision.hardDenies.length > 0) throw new Error('Thay đổi vi phạm quy tắc SoD bắt buộc.');
    const acceptanceErrors = validateSodWarningAcceptances(
      decision,
      warningAcceptances,
      new Date(),
    );
    if (acceptanceErrors.length > 0) {
      toast.warning('Thiếu kiểm soát SoD', acceptanceErrors[0]);
      return;
    }
    await replaceUserPermissionGrants(userToEdit.id, permissionGrants, {
      reason: permissionChangeReason,
      warningAcceptances,
    });
    const [direct, sources] = await Promise.all([
      listUserPermissionGrants(userToEdit.id),
      authorizationGovernanceService.listEffectivePermissionSources(userToEdit.id),
    ]);
    setPermissionGrants(direct);
    setOriginalPermissionGrants(direct);
    setEffectiveSources(sources);
    setAuthorizationDecision(null);
    setWarningAcceptances([]);
    setPermissionChangeReason('');
    toast.success('Đã lưu phân quyền', 'Nguồn quyền hiệu lực đã được tải lại từ backend.');
  } catch (error) {
    logApiError('userModal.saveDirectPermissions', error);
    toast.error('Không thể lưu phân quyền', getApiErrorMessage(error, 'Backend đã từ chối thay đổi phân quyền.'));
  } finally {
    setSavingPermissions(false);
  }
};
```

Render a distinct `Lưu phân quyền` button. For new users, disable the matrix/save and explain that the account must be created first. This consciously avoids claiming combined atomic save before Phase 3.

- [ ] **Step 8: Pass current user identity only for UI validation, never RPC actor**

Add `currentUserId` and `canManageDirectGrants` to `UserModal` props through `SettingsUsers`. Derive the latter with `canPerform(currentUser, 'system.authorization.manage_grants')`; use `currentUserId` only to remove the current user from control-owner choices and show a self-grant warning. Hide/disable direct preview/save unless `canManageDirectGrants`; do not include either UI prop in any RPC payload, because the backend still derives and authorizes the actor.

- [ ] **Step 9: Run UI contracts and full frontend verification**

```bash
npm test -- \
  lib/__tests__/authorizationAdminUiContract.test.ts \
  lib/__tests__/authorizationGovernanceViewModel.test.ts \
  lib/__tests__/authorizationGovernanceService.test.ts \
  lib/__tests__/permissionService.test.ts \
  lib/__tests__/projectPermissionService.test.ts \
  lib/__tests__/authBoundary.test.tsx
npm run lint
npm run build
git diff --check
```

Expected: tests, TypeScript and build PASS; no combined-save contract remains.

- [ ] **Step 10: Commit Task 11**

```bash
git add \
  pages/settings/SettingsAuthorizationGovernance.tsx \
  pages/Settings.tsx \
  components/UserModal.tsx \
  pages/settings/SettingsUsers.tsx \
  lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): add business role administration UI"
```

---

## Mandatory Integrated Review Checkpoint C

Before any Cloud mutation, review the Phase 2 tree end to end:

- a role/direct permission works without selecting legacy module/submodule when the resolver returns it;
- an adjacent permission and wrong scope remain denied;
- inherited `ROLE`/`LEGACY` sources never appear as removable direct checkboxes;
- Permission Admin, Auditor and System Admin controls are independently gated; scoped `manage_scopes` is effective only in its assigned scope and exposes no global role/grant control before module-owned Phase 4–6 integration;
- frontend never sends actor identity;
- profile save and permission save are visibly separate until Phase 3 atomic composition;
- sensitive expiry and warning evidence are validated both client-side and backend;
- disabling an account revokes Business Roles and reactivation restores none;
- current production behavior remains unchanged while all three rollout flags are false.

---

### Task 12: Align the program roadmap and run complete local/rollback verification

**Files:**

- Modify: `docs/security/permission-refactor-roadmap.md`
- Create: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Modify: all Task 1–11 files only if verification exposes a defect

**Interfaces:**

- Consumes: complete Phase 2 implementation tree.
- Produces: unambiguous roadmap numbering, clean local evidence, rollback-only linked database evidence and an explicit Cloud mutation checkpoint package.

- [ ] **Step 1: Align the old permission roadmap without erasing history**

At the top of `docs/security/permission-refactor-roadmap.md`, add a supersession note:

```markdown
> **Program phase alignment — 2026-07-17:** The Approved source of truth for
> program phases and exit gates is
> `docs/superpowers/specs/2026-07-16-vioo-authorization-governance-migration-design.md`.
> Historical headings such as “Phase 2 Project PBAC” in this document describe
> already-delivered technical waves; they are not the current program Phase 2.
> Current program Phase 2 is Business Role + Minimal SoD and is implemented by
> `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.
```

Add a compact mapping table from historical implementation waves to program Phase 0–7. Do not rewrite old completed evidence or migration names.

- [ ] **Step 2: Create the live-apply log skeleton**

Create `docs/security/phase02-business-role-sod-live-apply-log.md` with sections:

```markdown
# Phase 02 Business Role and Minimal SoD — Live Apply Log

## Current status

- Status: **Local verification only; Cloud mutation not approved**
- Branch:
- Candidate commit:
- Database migration versions:
- Rollout flags:

## Phase 1 closure carried forward

- Phase 1 status: PASS by explicit operator acceptance in commit `baa23ca`.
- Evidence boundary: the operator waived the unelapsed remainder of the 24-hour/Dashboard-log collection after thorough manual testing; do not represent the waived evidence as collected.

## Local verification

## Rollback-only linked database verification

## Independent security review findings

## Cloud apply and migration-history repair

## Resolver enablement canary

## System Admin governance/business-authority cutover

## Vercel preview and production

## 24-hour observation

## Forward fixes
```

Never put emails, passwords, access/refresh tokens, Auth IDs, database URLs or service-role values in this log.

- [ ] **Step 3: Resolve all generated migration paths and verify uniqueness**

```bash
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
SOD_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_minimal_sod_registry\.sql$')"
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
LIFECYCLE_INTEGRATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_account_lifecycle_integration\.sql$')"
OVERRIDE_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_override_evidence\.sql$')"
CHECKPOINT_HARDENING_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_backend_checkpoint_hardening\.sql$')"
test "$(printf '%s\n' "$FOUNDATION_MIGRATION" "$RESOLVER_MIGRATION" "$SOD_MIGRATION" "$COMMANDS_MIGRATION" "$LIFECYCLE_INTEGRATION_MIGRATION" "$OVERRIDE_MIGRATION" "$CHECKPOINT_HARDENING_MIGRATION" | rg -c '^supabase/migrations/[0-9]{14}_authorization_.*\.sql$')" -eq 7
```

Expected: exactly seven paths, each created by the CLI and carrying a unique generated version.

- [ ] **Step 4: Run the complete local suite**

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: every test passes, TypeScript/build exit `0`, no whitespace findings, and any pre-existing non-Phase-2 working-tree entries remain untouched and unstaged rather than being mistaken for Phase 2 defects.

- [ ] **Step 5: Discover current Supabase CLI syntax**

```bash
npx supabase --version
npx supabase db --help
npx supabase db query --help
npx supabase db advisors --help
npx supabase migration repair --help
npx supabase migration list --linked
```

Expected: record the CLI version and only the seven pending Phase 2 versions. Do not repair or apply anything here.

- [ ] **Step 6: Run all Phase 2 migrations and smokes in one rollback-only linked transaction**

```bash
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
SOD_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_minimal_sod_registry\.sql$')"
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
LIFECYCLE_INTEGRATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_account_lifecycle_integration\.sql$')"
OVERRIDE_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_override_evidence\.sql$')"
CHECKPOINT_HARDENING_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_backend_checkpoint_hardening\.sql$')"
BUNDLE="$(mktemp /tmp/phase02-rollback.XXXXXX)"
trap 'rm -f "$BUNDLE"' EXIT
node -e "const fs=require('fs'); const out=process.argv[1]; const files=process.argv.slice(2); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join('\n'); fs.writeFileSync(out, 'begin; set local lock_timeout=\'5s\'; set local statement_timeout=\'120s\';\n'+sql+'\nselect \'phase02_rollback_smoke_passed\' as checkpoint; rollback;\n', {mode:0o600});" \
  "$BUNDLE" \
  "$FOUNDATION_MIGRATION" \
  "$RESOLVER_MIGRATION" \
  "$SOD_MIGRATION" \
  "$COMMANDS_MIGRATION" \
  "$LIFECYCLE_INTEGRATION_MIGRATION" \
  "$OVERRIDE_MIGRATION" \
  "$CHECKPOINT_HARDENING_MIGRATION" \
  supabase/tests/business_role_effective_permission_smoke.sql \
  supabase/tests/authorization_sod_smoke.sql \
  supabase/tests/authorization_governance_commands_smoke.sql \
  supabase/tests/authorization_override_smoke.sql \
  supabase/tests/user_account_lifecycle_smoke.sql \
  supabase/tests/authorization_backend_checkpoint_smoke.sql
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: exit `0`, checkpoint `phase02_rollback_smoke_passed`, then explicit rollback. Any failure leaves Cloud unchanged.

- [ ] **Step 7: Run linked database advisors read-only**

```bash
npx supabase db advisors --linked
```

Expected: review security/performance findings. Fix new Phase 2 findings with forward migration edits before Cloud apply; document unrelated pre-existing findings without broadening scope.

- [ ] **Step 8: Run explicit ACL/RLS/static security inventory inside rollback**

Append a diagnostic query to the rollback wrapper that asserts:

```sql
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'principal_role_assignments',
    'authorization_sod_rules',
    'authorization_sod_warning_acceptances',
    'authorization_override_events'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table and c.relrowsecurity
    ) then
      raise exception 'RLS missing on public.%', v_table;
    end if;
    if exists (
      select 1 from information_schema.role_table_grants grant_row
      where grant_row.table_schema = 'public'
        and grant_row.table_name = v_table
        and grant_row.grantee in ('anon','PUBLIC')
    ) then
      raise exception 'Unexpected public/anon table privilege on %', v_table;
    end if;
  end loop;
end;
$$;
```

Also assert browser-callable governance RPC identity arguments contain no actor parameter, every private definer uses empty `search_path`, and `authenticated` has no direct `INSERT/UPDATE/DELETE` on governance tables.

Exercise one unauthorized call, one invalid foreign key/scope payload and one duplicate command through the authenticated Data API. Inspect the raw PostgREST JSON—not only the toast—and assert `message`, `details` and `hint` contain no SQL text, constraint/table names, Auth IDs, service-role text, keys or submitted identifiers.

- [ ] **Step 9: Review inter-phase contract compatibility**

Confirm by code search:

```bash
rg -n "from\('principal_role_assignments'\).*(insert|update|delete)|from\('authorization_.*'\).*(insert|update|delete)" --glob '*.ts' --glob '*.tsx'
rg -n "Role\.ADMIN.*approve|role === Role\.ADMIN.*return true|u\.role = 'ADMIN'" lib context components pages supabase/migrations
rg -n "post_supplier_payment_batch|reverse_supplier_payment_batch|p_actor_id" lib supabase/migrations/20260707071817_supplier_ap_payment_site_cash_qr_v1.sql
rg -n "resolve_effective_permission_sources|assert_subject_sod|has_valid_authorization_override" supabase/migrations docs/superpowers/plans
```

Expected:

- no frontend direct mutation of governance tables;
- remaining admin compatibility paths are inventoried with a Phase 4–6 owner; every resolver-aware Phase 2 path denies implicit business approval after cutoff, without falsely claiming unmigrated module transitions are already converted;
- Payment caller-supplied actor paths are recorded as a Phase 5 fail-closed prerequisite and are not mistaken for trusted actor evidence in Phase 2;
- Phase 3–7 seams match the stable contract table at the top of this plan.

- [ ] **Step 10: Prepare and stop at the Cloud checkpoint**

Record in the apply log:

- seven generated migration versions and candidate commit;
- full local command summaries;
- rollback-only checkpoint and advisor summary;
- independent review findings and resolutions;
- current linked migration drift without changing unrelated rows;
- rollback controls: `set_authorization_rollout_flags(true,false,false,reason)` first, forward-fix migration second; never delete governance/audit data.

Do not execute Task 13 until the operator explicitly approves Cloud mutation.

- [ ] **Step 11: Commit Task 12 documentation**

```bash
git add \
  docs/security/permission-refactor-roadmap.md \
  docs/security/phase02-business-role-sod-live-apply-log.md
git commit -m "docs(authz): align business role rollout roadmap"
```

---

### Task 13: Apply Cloud migrations, canary the three-stage cutover and promote

**Files:**

- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Modify: implementation files only through a new forward-fix migration/commit if canary evidence requires it

**Interfaces:**

- Consumes: verified Task 12 candidate and explicit operator approvals.
- Produces: applied Cloud schema/history, enabled resolver/admin separation, preview and production evidence, 24-hour observation and final Phase 2 exit-gate record.

After Step 2 commits schema, any defect uses a new CLI-generated forward migration and a new commit, then returns through Task 12 local/rollback verification and a new exact preview SHA. Never edit one of the seven applied files or hot-patch production outside the recorded workflow.

- [ ] **Step 1: Reconfirm exact candidate and Cloud checkpoint approval**

```bash
git status --short
git rev-parse HEAD
git branch --show-current
git fetch origin
npx supabase migration list --linked
```

Expected: candidate tree equals the reviewed tree, only the seven intended versions are pending, and no unrelated local modification is staged. Stop without approval.

Before approval, run read-only aggregate preflight on the pre-Phase-2 schema: reserved role-code collisions, active direct `system.settings.manage` grants and any existing template item containing that permission must each be `0`. Do not log user/template IDs. A non-zero result is a remediation checkpoint, not permission to let the migration take over or auto-promote anyone.

- [ ] **Step 2: Apply all seven migrations atomically without db push**

```bash
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
SOD_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_minimal_sod_registry\.sql$')"
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
LIFECYCLE_INTEGRATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_account_lifecycle_integration\.sql$')"
OVERRIDE_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_override_evidence\.sql$')"
CHECKPOINT_HARDENING_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_backend_checkpoint_hardening\.sql$')"
BUNDLE="$(mktemp /tmp/phase02-apply.XXXXXX)"
trap 'rm -f "$BUNDLE"' EXIT
node -e "const fs=require('fs'); const out=process.argv[1]; const files=process.argv.slice(2); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join('\n'); fs.writeFileSync(out, 'begin; set local lock_timeout=\'5s\'; set local statement_timeout=\'120s\';\n'+sql+'\nselect \'phase02_migrations_applied\' as checkpoint; commit;\n', {mode:0o600});" \
  "$BUNDLE" \
  "$FOUNDATION_MIGRATION" \
  "$RESOLVER_MIGRATION" \
  "$SOD_MIGRATION" \
  "$COMMANDS_MIGRATION" \
  "$LIFECYCLE_INTEGRATION_MIGRATION" \
  "$OVERRIDE_MIGRATION" \
  "$CHECKPOINT_HARDENING_MIGRATION"
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: exit `0`, checkpoint `phase02_migrations_applied`, one commit. SQL failure rolls back all seven.

If the client disconnects after sending the transaction, first query the seven schema fingerprints and the checkpoint-side effects read-only; do not blindly resend the migration SQL. Once the schema commit is proven, resume only migration-history repair. Flags default off, so the schema/history repair window does not activate the new resolver or admin cutover.

- [ ] **Step 3: Run smokes against committed schema in a disposable transaction**

```bash
BUNDLE="$(mktemp /tmp/phase02-smoke.XXXXXX)"
trap 'rm -f "$BUNDLE"' EXIT
node -e "const fs=require('fs'); const out=process.argv[1]; const files=process.argv.slice(2); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join('\n'); fs.writeFileSync(out, 'begin; set local lock_timeout=\'5s\'; set local statement_timeout=\'120s\';\n'+sql+'\nselect \'phase02_committed_schema_smoke_passed\' as checkpoint; rollback;\n', {mode:0o600});" \
  "$BUNDLE" \
  supabase/tests/business_role_effective_permission_smoke.sql \
  supabase/tests/authorization_sod_smoke.sql \
  supabase/tests/authorization_governance_commands_smoke.sql \
  supabase/tests/authorization_override_smoke.sql \
  supabase/tests/user_account_lifecycle_smoke.sql \
  supabase/tests/authorization_backend_checkpoint_smoke.sql
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: exit `0`, checkpoint, rollback. All three rollout flags remain `false` after the transaction.

- [ ] **Step 4: Repair exactly the seven migration-history versions**

```bash
FOUNDATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_business_role_foundation\.sql$')"
RESOLVER_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_effective_permission_resolver\.sql$')"
SOD_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_minimal_sod_registry\.sql$')"
COMMANDS_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_governance_commands\.sql$')"
LIFECYCLE_INTEGRATION_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_account_lifecycle_integration\.sql$')"
OVERRIDE_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_override_evidence\.sql$')"
CHECKPOINT_HARDENING_MIGRATION="$(rg --files supabase/migrations | rg '_authorization_backend_checkpoint_hardening\.sql$')"
for migration in \
  "$FOUNDATION_MIGRATION" \
  "$RESOLVER_MIGRATION" \
  "$SOD_MIGRATION" \
  "$COMMANDS_MIGRATION" \
  "$LIFECYCLE_INTEGRATION_MIGRATION" \
  "$OVERRIDE_MIGRATION" \
  "$CHECKPOINT_HARDENING_MIGRATION"; do
  version="$(basename "$migration" | cut -d_ -f1)"
  npx supabase migration repair "$version" --status applied --linked --workdir . --yes
done
npx supabase migration list --linked
```

Expected: only those seven versions become applied; pre-existing migration-history drift is untouched.

Repair is resumable version by version: re-run `migration list --linked`, repair only Phase 2 versions still shown pending, and never mark a version applied until its schema fingerprint has been verified on Cloud.

- [ ] **Step 5: Verify additive schema with flags still off**

Run read-only queries proving:

- every active legacy `ADMIN` has distinct active `SYSTEM_ADMIN` and `PERMISSION_ADMIN` bootstrap assignments;
- no seeded Business Role contains a business approval permission;
- `system.settings.manage` exists only in `SYSTEM_ADMIN` role items and never as an active direct grant;
- all Phase 2 database permission actions match the deterministic backfill/explicit-governance classification; expected mismatch count `0` (later module-owned explicit overrides are compared to their seed manifest, not blindly to this heuristic);
- active direct grants now classified sensitive with null/past expiry are inventoried and explicitly revoked or reissued with reason/future expiry before cutoff; expected unresolved count `0`;
- RLS/ACL checks remain clean;
- current `app_private.has_permission` outcomes match pre-cutover behavior while all three flags are false;
- active disabled accounts have zero active role assignments;
- durable rollout-operator count is at least `1` before either compatibility cutoff;
- no audit/notification row contains secrets or Auth IDs.

Record aggregate counts only.

- [ ] **Step 6: Publish the exact candidate to the existing Vercel preview**

After explicit push approval:

```bash
BRANCH="$(git branch --show-current)"
CANDIDATE_SHA="$(git rev-parse HEAD)"
git push origin "$BRANCH"
```

Wait for the existing Vercel Git deployment to report success for `CANDIDATE_SHA`. Record SHA and preview URL; do not deploy an Edge Function or introduce another hosting path.

- [ ] **Step 7: Canary resolver enablement before changing admin approval behavior**

Through an authenticated System Admin that also has `PERMISSION_ADMIN`, call:

```ts
await supabase.rpc('set_authorization_rollout_flags', {
  p_business_role_resolver_enabled: true,
  p_legacy_governance_fallback_disabled: false,
  p_admin_business_approval_bypass_disabled: false,
  p_reason: 'Enable additive Business Role resolver canary',
});
```

Using disposable users, verify:

1. Business Role source appears with correct role/scope/time.
2. Direct source still works without legacy module/submodule selection.
3. Legacy source remains effective while enabled.
4. Wrong scope and adjacent permission are denied.
5. Expired/revoked roles and direct grants disappear.
6. Inactive user resolves zero sources.
7. Source badges do not change direct checkbox state.
8. Existing non-approval application navigation remains stable.

- [ ] **Step 8: Run rollback-only impact inventory for governance/approval cutover**

In one linked transaction:

1. Temporarily set both `legacy_governance_fallback_disabled=true` and `system_admin_business_approval_bypass_disabled=true` directly in `app_private.permission_hardening_settings`.
2. Count active `ADMIN` users whose governance mutation permissions disappear and business-approval permission/scope rows that disappear.
3. Count explicit `ROLE`/`DIRECT` governance and business-approval sources that remain.
4. Prove a disposable System Admin with no `PERMISSION_ADMIN` assignment keeps technical settings/account lifecycle access but loses role/grant mutation authority.
5. List affected app user IDs only in ephemeral command output; write aggregate counts to the log.
6. Roll back.

Review the inventory with the operator. Do not auto-create replacement business approvals. Required business rights must be deliberately assigned by a separate Permission Admin with scope, reason, expiry/SoD evidence.

- [ ] **Step 9: Explicit checkpoint before disabling legacy governance and System Admin approval bypasses**

Review:

- affected-admin aggregate, governance mutation namespaces and business-approval namespaces;
- explicit replacement assignments, if business owners approved any;
- tested rollback command that keeps resolver enabled but restores both compatibility fallbacks;
- preview canary evidence and no unexpected denial.

Do not flip either cutoff flag until approved.

- [ ] **Step 10: Promote the exact preview commit through existing production workflow with compatibility still on**

At a second explicit checkpoint, identify the configured production branch and fast-forward/promote the exact preview SHA through the existing Git/Vercel workflow. Do not rebuild from another tree, force-push or create a second deployment path.

Expected: Vercel Production succeeds for the exact canary SHA while the resolver is enabled and both compatibility fallbacks remain on.

- [ ] **Step 11: Verify production frontend readiness before backend cutoff**

On the exact production deployment, confirm source hydration, direct-grant full-draft preview, role/source badges, separated profile/permission Save, Permission Admin/Auditor UI gates and safe error rendering. Verify the current production user can reload and reauthenticate successfully. Do not disable either compatibility fallback until this passes; rollback the frontend through the existing Vercel/Git workflow if the candidate UI is unhealthy.

- [ ] **Step 12: Enable fail-closed governance and business-approval separation**

First disable only legacy governance fallback:

```ts
await supabase.rpc('set_authorization_rollout_flags', {
  p_business_role_resolver_enabled: true,
  p_legacy_governance_fallback_disabled: true,
  p_admin_business_approval_bypass_disabled: false,
  p_reason: 'Disable legacy governance fallback after production readiness',
});
```

Force a fresh effective-source hydration, then verify that a System Admin without an explicit `PERMISSION_ADMIN` source cannot manage roles, direct grants, scopes, audit or overrides through legacy SETTINGS arrays; the same actor keeps technical settings/account lifecycle access; explicit Permission Admin and Auditor paths still work. A stale tab may briefly show old controls, but every backend mutation must already deny. If this stage fails, restore `(true,false,false)` before continuing.

Then disable only the remaining System Admin business-approval bypass:

```ts
await supabase.rpc('set_authorization_rollout_flags', {
  p_business_role_resolver_enabled: true,
  p_legacy_governance_fallback_disabled: true,
  p_admin_business_approval_bypass_disabled: true,
  p_reason: 'Disable System Admin business approval bypass after governance canary',
});
```

Immediately verify the complete cutover:

- System Admin without an explicit source resolves `false` for Daily Log/payment approval permissions; do not represent this Phase 2 permission check as an end-to-end workflow SoD canary;
- the same actor retains system settings/account lifecycle access;
- explicit scoped Business Role approval works only in scope;
- Permission Admin cannot sensitive-self-grant;
- Auditor reads sources/audit but cannot mutate;
- warning combination requires and records compensation evidence;
- direct rollback-smoke calls to the typed maker-checker/payment guards reject even when override permission exists; Daily Log binds real subject fields in Phase 4 and Payment binds them after its actor-safe approve/mark-paid split in Phase 5;
- controlled override retry is idempotent and notifies exactly one control owner;
- account disable revokes role/direct sources and reactivation restores none.

If only business-approval cutover causes unexpected denials, restore `(true,true,false)` so governance separation remains. If governance/source behavior is implicated, restore `(true,false,false)`. Record every flag transition in audit/log evidence and prepare a forward-fix migration; do not delete assignments, grants or audit rows.

- [ ] **Step 13: Observe production for at least 24 hours**

Record:

- source resolver RPC invocation/failure counts;
- `42501` authorization denials by permission code, with no PII;
- unexpected active-user denials;
- legacy governance fallback denials and unexpected Permission Admin denials;
- System Admin business approval denials;
- role/direct command failures and retries;
- SoD hard-deny and warning-acceptance counts;
- expired warning acceptances whose conflicting permission sources remain live, expected `0`;
- override events, failures and duplicate-notification anomalies;
- active role assignments on disabled accounts, expected `0`;
- active legacy `ADMIN` profiles missing an active `SYSTEM_ADMIN` mirror, expected `0`; durable rollout-operator count remains at least `1`, while additional Permission Admin assignments follow explicit separation decisions;
- expired grants/roles still appearing effective, expected `0`;
- frontend errors loading effective sources.

Do not infer missing dashboard logs from database counters. Record unavailable evidence explicitly.

- [ ] **Step 14: Final verification and rollout-log commit**

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: all commands pass; any pre-existing non-Phase-2 working-tree entries remain untouched and unstaged.

Update the apply log with timestamps, commit SHA, deployment URLs, migration versions, flag events, canary results, observation and forward fixes, then:

```bash
git add docs/security/phase02-business-role-sod-live-apply-log.md
git commit -m "docs(authz): record business role rollout"
```

---

## Phase 2 Exit Gate

Do not begin Phase 3 Controlled Legacy Migration implementation until all statements are evidenced:

- Every active effective permission is explainable as `ROLE`, `DIRECT` or `LEGACY` with scope and time.
- Business Role assignments are stateful, scoped, audited and revoked rather than deleted.
- Direct grants are stateful, sensitive grants expire, and changes are audited.
- The Phase 2 resolver returns no automatic System Admin business approval after cutoff, and no new Phase 2 consumer bypasses it; legacy module transition handlers remain explicitly inventoried debt whose end-to-end removal is a Phase 4–6 exit gate.
- Legacy SETTINGS arrays no longer confer governance mutation/audit/override authority after the independent governance cutoff; those capabilities require explicit Permission Admin/Auditor/override sources.
- Permission Admin sensitive self-grant is denied by the backend.
- Typed hard maker-checker/payment guards deny at the database boundary and cannot be overridden; end-to-end Daily Log and Payment workflow enforcement remains an explicit Phase 4/5 exit gate, not a Phase 2 claim.
- Warning acceptance records reason, independent owner, expiry and compensating controls.
- Override requires its own permission, typed overridable rule, reason, audit and one control-owner notification.
- Disabled accounts have zero active role/direct sources even with an old JWT; reactivation restores none.
- Frontend consumes backend effective sources and direct grants work without legacy module/submodule selection.
- No browser payload supplies actor identity and no client can directly mutate governance/audit tables.
- At least one active System Admin retains a durable explicit `manage_roles` source, and guards prevent rollout/revoke/disable from removing the last recovery path.
- Full tests, lint, build, rollback smoke, Cloud canary and 24-hour production observation pass.
- Phase 1 PASS acceptance and its explicit observation-evidence waiver remain honestly preserved in the committed Phase 1 rollout log.

## Phase 3–7 Sequencing After This Plan

1. **Phase 3 — Controlled Legacy Migration:** add module states and per-user/module/scope source modes; change only the resolver's `LEGACY` branch; compose profile/role/direct/source-mode diffs into one atomic command; add coverage preview and projection guard.
2. **Phase 4 — Daily Log Golden Pilot:** consume `has_permission`, bind `daily_logs.created_by_id`/`submitted_by_id` into `assert_subject_sod` inside `transition_daily_log_status`, and consume override evidence only for typed overridable rules; require assignment-first action/notification; canary `NEW_ONLY` for a cohort.
3. **Phase 5 — Project High-Risk Modules:** migrate Project Core/Org, Material/WMS routing, Payment/Quantity Acceptance, then Quality. Before Payment SoD cutover, replace browser-supplied `p_actor_id` in `post_supplier_payment_batch`/related transitions with `current_app_user_id()`, split approve from mark-paid, persist creator/approver/executor identities, then bind those columns to the Phase 2 typed guard. Seed module-specific risk/SoD rules without changing the typed engine.
4. **Phase 6 — ERP Rollout Waves:** WMS; Contract/Request/Expense; HRM/Payroll; remaining modules. Split missing namespaces such as payroll prepare/approve before activating their SoD warning.
5. **Phase 7 — Legacy Retirement and Operations:** stop projection/writes, remove runtime legacy sources/helpers after telemetry reaches zero, retain role/direct/SoD/audit contracts for operations and access review.

Each phase gets its own detailed executable plan only after the previous phase's interface and production evidence are reviewed. Inventory/test preparation may overlap; state-changing implementation and cutover remain sequential.
