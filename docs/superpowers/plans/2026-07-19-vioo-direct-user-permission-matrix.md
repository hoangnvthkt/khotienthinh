# VIOO Direct User Permission Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a compact direct user permission administration page with per-project scope, quick checkbox templates, direct-grant copy/paste, governed Preview/Save, and legacy parallel visibility.

**Architecture:** Keep authorization enforcement in the existing governed Direct Grant commands. Add quick-template storage as administration data only, never as an effective permission source. Build the UI around a left user list and a collapsed parent-child permission tree that edits only Direct Grants while showing Role/Legacy sources as read-only evidence.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Supabase Postgres migrations/RPC, `@supabase/supabase-js` v2.98.0, existing permission registry/view-model/services, `lucide-react`.

## Global Constraints

- Work only in `/Users/admin/khotienthinh/.worktrees/material-request-readiness-tranche-b`.
- Do not edit root checkout files.
- Do not edit dirty roadmap files.
- Do not edit applied migrations.
- Do not change the Save 12 principals.
- No Supabase Cloud mutation before an explicit operator checkpoint approval.
- Use aggregate-only read-only evidence for Cloud checks; do not print identity, raw grants, tokens, or URLs.
- No direct SQL mutation of grant tables.
- No `supabase db push`.
- No local Supabase/Docker requirement.
- Stop fail-closed at any hard deny, warning, or invariant drift.
- Quick templates are UI presets only; they are not Business Role assignments and are not resolver sources.
- No `all projects` scope.
- Project permissions in this UX use `scopeType: 'project'` with a concrete project id.
- No negative grants, deny overrides, inheritance exceptions, or automatic legacy migration.
- Legacy permissions remain parallel and visibly labeled.
- Declared or legacy-only actions may be shown but must not be newly grantable.

---

## File Structure

- Create `lib/permissions/directUserPermissionMatrixViewModel.ts`: pure draft operations for applying templates, copying Direct Grant drafts, pasting Direct Grant drafts, clearing stale previews, and keeping project scope exact.
- Create `lib/__tests__/directUserPermissionMatrixViewModel.test.ts`: TDD coverage for parent/View behavior, template apply, paste replacement, project isolation, and readiness gating.
- Create `lib/permissions/permissionQuickTemplateService.ts`: browser service for quick-template list/save/deactivate RPCs.
- Create `lib/__tests__/permissionQuickTemplateService.test.ts`: contract tests for RPC names, payload mapping, no actor payload, and no Business Role assignment calls.
- Create a generated migration from `npx supabase migration new permission_quick_templates`: tables, RLS, private implementation functions, public RPC wrappers, grants, and audit.
- Create `lib/__tests__/permissionQuickTemplateMigration.test.ts`: source-level migration contract tests that locate the generated migration by suffix.
- Create `supabase/tests/permission_quick_templates_smoke.sql`: rollback-only smoke script for manual Cloud checkpoint, not run without approval.
- Create `components/permissions/CompactDirectPermissionTree.tsx`: compact parent-child permission tree grouped by application/module, collapsed by default, editing Direct Grants only.
- Create `lib/__tests__/compactDirectPermissionTree.test.tsx`: source contract tests for collapsed tree behavior, direct-only editing, and badge visibility.
- Create `components/permissions/DirectUserPermissionWorkspace.tsx`: user-left / matrix-right workspace with project selector, template apply, copy, paste, Preview, Save, reason, SoD warnings, and legacy/source evidence.
- Create `components/permissions/PermissionQuickTemplateEditor.tsx`: settings tab for creating/updating/deactivating quick templates with the same compact tree.
- Modify `pages/settings/SettingsAuthorizationGovernance.tsx`: make `Phân quyền user` primary, add `Mẫu quyền`, keep existing Business Role controls in an advanced section instead of the primary workflow.
- Modify `lib/__tests__/authorizationAdminUiContract.test.ts`: enforce the new page contract and the absence of direct table writes/actor payload/source-mode mutation.

---

### Task 1: Pure Direct Draft Operations

**Files:**
- Create: `lib/permissions/directUserPermissionMatrixViewModel.ts`
- Test: `lib/__tests__/directUserPermissionMatrixViewModel.test.ts`

**Interfaces:**
- Consumes:
  - `UserPermissionGrant` from `types.ts`
  - `PermissionModuleDefinition`, `PermissionScope`, `PermissionScopeType` from `lib/permissions/permissionTypes.ts`
  - `toggleUnifiedDirectGrant()` from `lib/permissions/unifiedPermissionViewModel.ts`
  - `canAddDirectGrant()` from `lib/permissions/permissionReadiness.ts`
- Produces:
  - `PermissionQuickTemplateDraft`
  - `DirectPermissionClipboardGrant`
  - `DirectPermissionClipboard`
  - `dedupeDirectGrantDrafts(grants: readonly UserPermissionGrant[]): UserPermissionGrant[]`
  - `applyPermissionQuickTemplateToDraft(input: ApplyPermissionQuickTemplateInput): UserPermissionGrant[]`
  - `copyDirectPermissionDraft(grants: readonly UserPermissionGrant[]): DirectPermissionClipboard`
  - `pasteDirectPermissionClipboard(targetUserId: string, clipboard: DirectPermissionClipboard): UserPermissionGrant[]`

- [ ] **Step 1: Write failing tests**

Add this test file:

```ts
import { describe, expect, it } from 'vitest';
import type { UserPermissionGrant } from '../../types';
import { getPermissionModuleByCode } from '../permissions/permissionRegistry';
import {
  applyPermissionQuickTemplateToDraft,
  copyDirectPermissionDraft,
  dedupeDirectGrantDrafts,
  pasteDirectPermissionClipboard,
} from '../permissions/directUserPermissionMatrixViewModel';

const dailyLog = getPermissionModuleByCode('project.daily_log');
const payment = getPermissionModuleByCode('project.payment');
if (!dailyLog || !payment) throw new Error('Missing project permission fixtures');

const grant = (
  userId: string,
  permissionCode: string,
  scopeId: string,
  overrides: Partial<UserPermissionGrant> = {},
): UserPermissionGrant => ({
  userId,
  permissionCode,
  scopeType: 'project',
  scopeId,
  ...overrides,
});

describe('direct user permission matrix view model', () => {
  it('dedupes active grants by user, code, scope, and expiry without carrying ids', () => {
    const next = dedupeDirectGrantDrafts([
      { id: 'db-1', grantedBy: 'actor-1', grantedAt: '2026-07-18T00:00:00.000Z', ...grant('user-1', 'project.daily_log.view', 'project-1') },
      grant('user-1', 'project.daily_log.view', 'project-1'),
      { ...grant('user-1', 'project.daily_log.view', 'project-1'), expiresAt: '2026-08-01T00:00:00.000Z' },
      { ...grant('user-1', 'project.daily_log.create', 'project-1'), isActive: false },
    ]);

    expect(next).toEqual([
      grant('user-1', 'project.daily_log.view', 'project-1'),
      { ...grant('user-1', 'project.daily_log.view', 'project-1'), expiresAt: '2026-08-01T00:00:00.000Z' },
    ]);
  });

  it('applies a quick template only to the selected module group and selected project scope', () => {
    const next = applyPermissionQuickTemplateToDraft({
      targetUserId: 'user-1',
      drafts: [
        grant('user-1', 'project.daily_log.edit_own', 'project-1'),
        grant('user-1', 'project.daily_log.view', 'project-2'),
        grant('user-1', 'project.payment.view', 'project-1'),
      ],
      template: {
        code: 'field_engineer',
        name: 'Kỹ sư',
        permissionCodes: ['project.daily_log.create', 'project.daily_log.edit_own', 'project.daily_log.confirm'],
      },
      modules: [dailyLog],
      scope: { scopeType: 'project', scopeId: 'project-1' },
    });

    expect(next.map(item => `${item.permissionCode}:${item.scopeId}`).sort()).toEqual([
      'project.daily_log.create:project-1',
      'project.daily_log.edit_own:project-1',
      'project.daily_log.view:project-1',
      'project.daily_log.view:project-2',
      'project.payment.view:project-1',
    ]);
  });

  it('refuses template codes that are not newly grantable by readiness', () => {
    const next = applyPermissionQuickTemplateToDraft({
      targetUserId: 'user-1',
      drafts: [],
      template: {
        code: 'unsafe',
        name: 'Unsafe',
        permissionCodes: ['project.daily_log.confirm'],
      },
      modules: [dailyLog],
      scope: { scopeType: 'project', scopeId: 'project-1' },
    });

    expect(next).toEqual([]);
  });

  it('copies active Direct drafts without database/audit/source fields and paste replaces the receiving draft', () => {
    const clipboard = copyDirectPermissionDraft([
      { id: 'db-1', grantedBy: 'actor-1', grantedAt: '2026-07-18T00:00:00.000Z', ...grant('user-a', 'project.daily_log.view', 'project-1') },
      { ...grant('user-a', 'project.payment.view', 'project-1'), isActive: false },
      { ...grant('user-a', 'project.payment.verify', 'project-2'), expiresAt: '2026-08-01T00:00:00.000Z' },
    ]);

    expect(clipboard.grants).toEqual([
      { permissionCode: 'project.daily_log.view', scopeType: 'project', scopeId: 'project-1', expiresAt: undefined },
      { permissionCode: 'project.payment.verify', scopeType: 'project', scopeId: 'project-2', expiresAt: '2026-08-01T00:00:00.000Z' },
    ]);

    expect(pasteDirectPermissionClipboard('user-b', clipboard)).toEqual([
      grant('user-b', 'project.daily_log.view', 'project-1'),
      { ...grant('user-b', 'project.payment.verify', 'project-2'), expiresAt: '2026-08-01T00:00:00.000Z' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- lib/__tests__/directUserPermissionMatrixViewModel.test.ts
```

Expected: FAIL because `directUserPermissionMatrixViewModel.ts` does not exist.

- [ ] **Step 3: Implement the pure view model**

Create `lib/permissions/directUserPermissionMatrixViewModel.ts`:

```ts
import type { UserPermissionGrant } from '../../types';
import { canAddDirectGrant } from './permissionReadiness';
import type {
  PermissionModuleDefinition,
  PermissionScope,
  PermissionScopeType,
} from './permissionTypes';
import { toggleUnifiedDirectGrant } from './unifiedPermissionViewModel';

export interface PermissionQuickTemplateDraft {
  id?: string;
  code: string;
  name: string;
  description?: string;
  permissionCodes: readonly string[];
  isActive?: boolean;
}

export interface DirectPermissionClipboardGrant {
  permissionCode: string;
  scopeType: PermissionScopeType;
  scopeId: string;
  expiresAt?: string;
}

export interface DirectPermissionClipboard {
  copiedAt: string;
  grants: DirectPermissionClipboardGrant[];
}

export interface ApplyPermissionQuickTemplateInput {
  targetUserId: string;
  drafts: readonly UserPermissionGrant[];
  template: PermissionQuickTemplateDraft;
  modules: readonly PermissionModuleDefinition[];
  scope: PermissionScope;
}

const normalizeScope = (scope: PermissionScope): { scopeType: PermissionScopeType; scopeId: string } => ({
  scopeType: (scope.scopeType || 'global') as PermissionScopeType,
  scopeId: scope.scopeId || '*',
});

const draftKey = (grant: Pick<UserPermissionGrant, 'userId' | 'permissionCode' | 'scopeType' | 'scopeId' | 'expiresAt'>): string =>
  [
    grant.userId,
    grant.permissionCode,
    grant.scopeType || 'global',
    grant.scopeId || '*',
    grant.expiresAt || '',
  ].join('\u001f');

export const dedupeDirectGrantDrafts = (
  grants: readonly UserPermissionGrant[],
): UserPermissionGrant[] => {
  const byKey = new Map<string, UserPermissionGrant>();
  for (const grant of grants) {
    if (grant.isActive === false) continue;
    const normalized: UserPermissionGrant = {
      userId: grant.userId,
      permissionCode: grant.permissionCode,
      scopeType: (grant.scopeType || 'global') as PermissionScopeType,
      scopeId: grant.scopeId || '*',
      expiresAt: grant.expiresAt,
    };
    byKey.set(draftKey(normalized), normalized);
  }
  return [...byKey.values()].sort((left, right) =>
    `${left.permissionCode}:${left.scopeType}:${left.scopeId}:${left.expiresAt || ''}`
      .localeCompare(`${right.permissionCode}:${right.scopeType}:${right.scopeId}:${right.expiresAt || ''}`));
};

export const applyPermissionQuickTemplateToDraft = (
  input: ApplyPermissionQuickTemplateInput,
): UserPermissionGrant[] => {
  const scope = normalizeScope(input.scope);
  const moduleCodes = new Set(input.modules.flatMap(module => module.actions.map(action => action.permissionCode)));
  const grantableTemplateCodes = new Set(
    input.modules
      .flatMap(module => module.actions)
      .filter(action => input.template.permissionCodes.includes(action.permissionCode))
      .filter(canAddDirectGrant)
      .map(action => action.permissionCode),
  );
  let next = input.drafts.filter(grant => !(
    grant.userId === input.targetUserId
    && moduleCodes.has(grant.permissionCode)
    && (grant.scopeType || 'global') === scope.scopeType
    && (grant.scopeId || '*') === scope.scopeId
  ));

  for (const module of input.modules) {
    for (const action of module.actions) {
      if (!grantableTemplateCodes.has(action.permissionCode)) continue;
      next = toggleUnifiedDirectGrant({
        module,
        grants: next,
        targetUserId: input.targetUserId,
        permissionCode: action.permissionCode,
        checked: true,
        scope,
      });
    }
  }

  return dedupeDirectGrantDrafts(next);
};

export const copyDirectPermissionDraft = (
  grants: readonly UserPermissionGrant[],
): DirectPermissionClipboard => ({
  copiedAt: new Date().toISOString(),
  grants: dedupeDirectGrantDrafts(grants).map(grant => ({
    permissionCode: grant.permissionCode,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    expiresAt: grant.expiresAt,
  })),
});

export const pasteDirectPermissionClipboard = (
  targetUserId: string,
  clipboard: DirectPermissionClipboard,
): UserPermissionGrant[] => dedupeDirectGrantDrafts(
  clipboard.grants.map(grant => ({
    userId: targetUserId,
    permissionCode: grant.permissionCode,
    scopeType: grant.scopeType,
    scopeId: grant.scopeId,
    expiresAt: grant.expiresAt,
  })),
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- lib/__tests__/directUserPermissionMatrixViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions/directUserPermissionMatrixViewModel.ts lib/__tests__/directUserPermissionMatrixViewModel.test.ts
git commit -m "feat(authz): add direct permission draft helpers"
```

---

### Task 2: Quick Template Migration and SQL Contract

**Files:**
- Create by command: `supabase/migrations/<generated_timestamp>_permission_quick_templates.sql`
- Create: `lib/__tests__/permissionQuickTemplateMigration.test.ts`
- Create: `supabase/tests/permission_quick_templates_smoke.sql`

**Interfaces:**
- Consumes:
  - Existing `app_private.assert_authorization_permission(text)`
  - Existing `permission_actions(permission_code, grant_readiness, is_active)`
  - Existing `permission_audit_events`
- Produces:
  - `public.permission_quick_templates`
  - `public.permission_quick_template_items`
  - `public.list_permission_quick_templates() returns jsonb`
  - `public.save_permission_quick_template(p_template_id uuid, p_code text, p_name text, p_description text, p_permission_codes jsonb, p_reason text) returns uuid`
  - `public.deactivate_permission_quick_template(p_template_id uuid, p_reason text) returns void`

- [ ] **Step 1: Write failing migration contract tests**

Create `lib/__tests__/permissionQuickTemplateMigration.test.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const readMigration = () => {
  const migrationDir = join(process.cwd(), 'supabase/migrations');
  const file = readdirSync(migrationDir)
    .filter(name => name.endsWith('_permission_quick_templates.sql'))
    .sort()
    .at(-1);
  if (!file) throw new Error('Missing permission_quick_templates migration');
  return readFileSync(join(migrationDir, file), 'utf8');
};

describe('permission quick templates migration', () => {
  it('creates isolated quick-template tables and RPCs', () => {
    const sql = readMigration();

    expect(sql).toContain('create table public.permission_quick_templates');
    expect(sql).toContain('create table public.permission_quick_template_items');
    expect(sql).toContain('alter table public.permission_quick_templates enable row level security');
    expect(sql).toContain('alter table public.permission_quick_template_items enable row level security');
    expect(sql).toContain('create or replace function public.list_permission_quick_templates()');
    expect(sql).toContain('create or replace function public.save_permission_quick_template(');
    expect(sql).toContain('create or replace function public.deactivate_permission_quick_template(');
  });

  it('keeps templates out of Business Role assignments and resolver sources', () => {
    const sql = readMigration();

    expect(sql).not.toContain('principal_role_assignments');
    expect(sql).not.toContain('role_permission_templates');
    expect(sql).not.toContain('get_effective_permission_sources');
    expect(sql).not.toContain('replace_user_permission_grants');
    expect(sql).not.toContain('user_permission_grants');
  });

  it('uses governed authorization, readiness gating, and audit', () => {
    const sql = readMigration();

    expect(sql).toContain("app_private.assert_authorization_permission('system.authorization.view')");
    expect(sql).toContain("app_private.assert_authorization_permission('system.authorization.manage_grants')");
    expect(sql).toContain("grant_readiness in ('enforced', 'verified')");
    expect(sql).toContain('permission_quick_template_saved');
    expect(sql).toContain('permission_quick_template_deactivated');
    expect(sql).toContain('set search_path =');
  });

  it('adds a rollback-only smoke script for manual Cloud checkpoint', () => {
    const smokePath = join(process.cwd(), 'supabase/tests/permission_quick_templates_smoke.sql');
    expect(existsSync(smokePath)).toBe(true);
    const smoke = readFileSync(smokePath, 'utf8');
    expect(smoke).toContain('begin;');
    expect(smoke).toContain('rollback;');
    expect(smoke).toContain('list_permission_quick_templates');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- lib/__tests__/permissionQuickTemplateMigration.test.ts
```

Expected: FAIL because the migration and smoke script do not exist.

- [ ] **Step 3: Generate the migration file with Supabase CLI**

Run:

```bash
npx supabase migration new permission_quick_templates
```

Expected: Supabase prints one generated migration path ending in `_permission_quick_templates.sql`. Use that generated path for the next step. Do not invent or rename the timestamp.

- [ ] **Step 4: Add SQL to the generated migration**

Add SQL with these exact behaviors to the generated migration:

```sql
create table public.permission_quick_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permission_quick_templates_code_format
    check (code ~ '^[a-z0-9][a-z0-9_]{1,62}[a-z0-9]$'),
  constraint permission_quick_templates_name_not_blank
    check (char_length(btrim(name)) >= 2)
);

create table public.permission_quick_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.permission_quick_templates(id) on delete cascade,
  permission_code text not null references public.permission_actions(permission_code),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (template_id, permission_code)
);

alter table public.permission_quick_templates enable row level security;
alter table public.permission_quick_template_items enable row level security;

create policy permission_quick_templates_select on public.permission_quick_templates
  for select to authenticated
  using (app_private.has_permission(public.current_app_user_id(), 'system.authorization.view', 'global', '*'));

create policy permission_quick_template_items_select on public.permission_quick_template_items
  for select to authenticated
  using (
    exists (
      select 1
      from public.permission_quick_templates template
      where template.id = permission_quick_template_items.template_id
        and app_private.has_permission(public.current_app_user_id(), 'system.authorization.view', 'global', '*')
    )
  );

revoke all on public.permission_quick_templates from public, anon, authenticated;
revoke all on public.permission_quick_template_items from public, anon, authenticated;
grant select on public.permission_quick_templates to authenticated;
grant select on public.permission_quick_template_items to authenticated;
```

Add private helper and RPC wrappers with the following rules:

```sql
create or replace function app_private.normalize_permission_quick_template_codes(
  p_permission_codes jsonb
)
returns table(permission_code text, sort_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  with raw_items as (
    select
      btrim(value #>> '{}') as permission_code,
      row_number() over ()::integer as sort_order
    from jsonb_array_elements(coalesce(p_permission_codes, '[]'::jsonb))
  )
  select raw_items.permission_code, min(raw_items.sort_order)::integer
  from raw_items
  where raw_items.permission_code <> ''
  group by raw_items.permission_code
  order by min(raw_items.sort_order), raw_items.permission_code
$$;

create or replace function app_private.list_permission_quick_templates_impl()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
begin
  v_actor_user_id := app_private.assert_authorization_permission('system.authorization.view');

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', template.id,
        'code', template.code,
        'name', template.name,
        'description', template.description,
        'isActive', template.is_active,
        'permissionCodes', coalesce(items.permission_codes, '[]'::jsonb),
        'updatedAt', template.updated_at
      )
      order by template.name, template.code
    )
    from public.permission_quick_templates template
    left join lateral (
      select jsonb_agg(item.permission_code order by item.sort_order, item.permission_code) as permission_codes
      from public.permission_quick_template_items item
      join public.permission_actions action
        on action.permission_code = item.permission_code
      where item.template_id = template.id
        and action.is_active
        and action.grant_readiness in ('enforced', 'verified')
    ) items on true
    where template.is_active
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_permission_quick_templates()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.list_permission_quick_templates_impl();
$$;
```

Add save/deactivate implementations that:

- call `app_private.assert_authorization_permission('system.authorization.manage_grants')`;
- reject blank `code`, blank `name`, blank `reason`, non-array `p_permission_codes`, empty normalized permission list, unknown permission codes, inactive permission codes, and permission codes whose `grant_readiness` is not `enforced` or `verified`;
- upsert `permission_quick_templates` by `p_template_id` or `code`;
- replace `permission_quick_template_items` for the template;
- write `permission_audit_events` with event types `permission_quick_template_saved` and `permission_quick_template_deactivated`;
- revoke private helper execution from `public`, `anon`, and `authenticated`;
- grant execute on public wrappers to `authenticated`.

The SQL must not reference `principal_role_assignments`, `role_permission_templates`, `get_effective_permission_sources`, `replace_user_permission_grants`, or `user_permission_grants`.

- [ ] **Step 5: Add rollback-only smoke script**

Create `supabase/tests/permission_quick_templates_smoke.sql`:

```sql
begin;

select jsonb_typeof(public.list_permission_quick_templates()) = 'array' as templates_are_listed_as_json_array;

rollback;
```

- [ ] **Step 6: Run migration contract tests**

Run:

```bash
npm test -- lib/__tests__/permissionQuickTemplateMigration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/*_permission_quick_templates.sql supabase/tests/permission_quick_templates_smoke.sql lib/__tests__/permissionQuickTemplateMigration.test.ts
git commit -m "feat(authz): add permission quick template storage"
```

---

### Task 3: Quick Template Browser Service

**Files:**
- Create: `lib/permissions/permissionQuickTemplateService.ts`
- Test: `lib/__tests__/permissionQuickTemplateService.test.ts`

**Interfaces:**
- Consumes:
  - `isSupabaseConfigured`, `supabase` from `lib/supabase.ts`
  - RPCs from Task 2
- Produces:
  - `PermissionQuickTemplate`
  - `SavePermissionQuickTemplateInput`
  - `permissionQuickTemplateService.list(): Promise<PermissionQuickTemplate[]>`
  - `permissionQuickTemplateService.save(input: SavePermissionQuickTemplateInput): Promise<string>`
  - `permissionQuickTemplateService.deactivate(templateId: string, reason: string): Promise<void>`

- [ ] **Step 1: Write failing service contract tests**

Create `lib/__tests__/permissionQuickTemplateService.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('../supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

const importService = async () => import('../permissions/permissionQuickTemplateService');

describe('permissionQuickTemplateService', () => {
  beforeEach(() => {
    vi.resetModules();
    rpc.mockReset();
  });

  it('lists templates from the governed RPC and maps permissionCodes', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: 'template-1',
        code: 'field_engineer',
        name: 'Kỹ sư',
        description: null,
        isActive: true,
        permissionCodes: ['project.daily_log.view'],
        updatedAt: '2026-07-19T00:00:00.000Z',
      }],
      error: null,
    });

    const { permissionQuickTemplateService } = await importService();
    await expect(permissionQuickTemplateService.list()).resolves.toEqual([{
      id: 'template-1',
      code: 'field_engineer',
      name: 'Kỹ sư',
      description: undefined,
      isActive: true,
      permissionCodes: ['project.daily_log.view'],
      updatedAt: '2026-07-19T00:00:00.000Z',
    }]);
    expect(rpc).toHaveBeenCalledWith('list_permission_quick_templates');
  });

  it('saves through the governed RPC without actor payload or role assignment fields', async () => {
    rpc.mockResolvedValue({ data: 'template-1', error: null });
    const { permissionQuickTemplateService } = await importService();

    await expect(permissionQuickTemplateService.save({
      templateId: null,
      code: 'field_engineer',
      name: 'Kỹ sư',
      description: 'Preset dự án',
      permissionCodes: ['project.daily_log.view', 'project.daily_log.create'],
      reason: 'Tạo mẫu kỹ sư dự án',
    })).resolves.toBe('template-1');

    expect(rpc).toHaveBeenCalledWith('save_permission_quick_template', {
      p_template_id: null,
      p_code: 'field_engineer',
      p_name: 'Kỹ sư',
      p_description: 'Preset dự án',
      p_permission_codes: ['project.daily_log.view', 'project.daily_log.create'],
      p_reason: 'Tạo mẫu kỹ sư dự án',
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/actor|principal_role_assignments|role_template_id/);
  });

  it('deactivates through the governed RPC', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const { permissionQuickTemplateService } = await importService();

    await expect(permissionQuickTemplateService.deactivate('template-1', 'Ngưng dùng mẫu cũ')).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledWith('deactivate_permission_quick_template', {
      p_template_id: 'template-1',
      p_reason: 'Ngưng dùng mẫu cũ',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- lib/__tests__/permissionQuickTemplateService.test.ts
```

Expected: FAIL because `permissionQuickTemplateService.ts` does not exist.

- [ ] **Step 3: Implement service**

Create `lib/permissions/permissionQuickTemplateService.ts`:

```ts
import { isSupabaseConfigured, supabase } from '../supabase';

export interface PermissionQuickTemplate {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  permissionCodes: string[];
  updatedAt?: string;
}

export interface SavePermissionQuickTemplateInput {
  templateId: string | null;
  code: string;
  name: string;
  description?: string;
  permissionCodes: readonly string[];
  reason: string;
}

const throwIfError = (error: unknown): void => {
  if (error) throw error;
};

const mapTemplate = (row: any): PermissionQuickTemplate => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  description: row.description || undefined,
  isActive: Boolean(row.is_active ?? row.isActive),
  permissionCodes: Array.isArray(row.permission_codes)
    ? row.permission_codes.map(String)
    : Array.isArray(row.permissionCodes)
      ? row.permissionCodes.map(String)
      : [],
  updatedAt: row.updated_at ?? row.updatedAt,
});

export const permissionQuickTemplateService = {
  async list(): Promise<PermissionQuickTemplate[]> {
    if (!isSupabaseConfigured) return [];
    const { data, error } = await supabase.rpc('list_permission_quick_templates');
    throwIfError(error);
    return (Array.isArray(data) ? data : []).map(mapTemplate);
  },

  async save(input: SavePermissionQuickTemplateInput): Promise<string> {
    if (!isSupabaseConfigured) return '';
    const { data, error } = await supabase.rpc('save_permission_quick_template', {
      p_template_id: input.templateId || null,
      p_code: input.code.trim(),
      p_name: input.name.trim(),
      p_description: input.description?.trim() || null,
      p_permission_codes: [...new Set(input.permissionCodes.map(code => code.trim()).filter(Boolean))],
      p_reason: input.reason.trim(),
    });
    throwIfError(error);
    return String(data);
  },

  async deactivate(templateId: string, reason: string): Promise<void> {
    if (!isSupabaseConfigured || !templateId) return;
    const { error } = await supabase.rpc('deactivate_permission_quick_template', {
      p_template_id: templateId,
      p_reason: reason.trim(),
    });
    throwIfError(error);
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- lib/__tests__/permissionQuickTemplateService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permissions/permissionQuickTemplateService.ts lib/__tests__/permissionQuickTemplateService.test.ts
git commit -m "feat(authz): add quick template service"
```

---

### Task 4: Compact Direct Permission Tree

**Files:**
- Create: `components/permissions/CompactDirectPermissionTree.tsx`
- Test: `lib/__tests__/compactDirectPermissionTree.test.tsx`

**Interfaces:**
- Consumes:
  - `permissionRegistry`, `getPermissionModuleByCode()` from `lib/permissions/permissionRegistry.ts`
  - `buildUnifiedPermissionRows()`, `toggleUnifiedDirectGrant()` from `lib/permissions/unifiedPermissionViewModel.ts`
  - `isPermissionActionScopeAllowed()` from `lib/permissions/permissionService.ts`
- Produces:
  - `CompactDirectPermissionTreeProps`
  - React component `CompactDirectPermissionTree`

- [ ] **Step 1: Write failing source-contract tests**

Create `lib/__tests__/compactDirectPermissionTree.test.tsx`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('CompactDirectPermissionTree source contract', () => {
  it('starts module children collapsed and reveals actions through expanded state', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain("useState<Set<string>>(new Set())");
    expect(source).toContain('toggleExpanded');
    expect(source).toContain('expandedModules.has(module.code)');
    expect(source).toContain('ChevronRight');
    expect(source).toContain('ChevronDown');
  });

  it('edits only Direct Grants through the unified draft toggle', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain('toggleUnifiedDirectGrant');
    expect(source).toContain('onGrantsChange');
    expect(source).not.toContain('onLegacyStateChange');
    expect(source).not.toContain('toggleLegacy');
    expect(source).not.toContain('principal_role_assignments');
  });

  it('keeps Role and Legacy evidence read-only through badges', () => {
    const source = read('components/permissions/CompactDirectPermissionTree.tsx');

    expect(source).toContain('row.sourceBadges.map');
    expect(source).toContain('Nguồn quyền');
    expect(source).toContain('hasDirectGrant');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- lib/__tests__/compactDirectPermissionTree.test.tsx
```

Expected: FAIL because `CompactDirectPermissionTree.tsx` does not exist.

- [ ] **Step 3: Implement compact tree**

Create `components/permissions/CompactDirectPermissionTree.tsx` with these behaviors:

```ts
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info, ShieldCheck } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import type { EffectivePermissionSource } from '../../lib/permissions/authorizationGovernanceTypes';
import { permissionRegistry } from '../../lib/permissions/permissionRegistry';
import { isPermissionActionScopeAllowed } from '../../lib/permissions/permissionService';
import type { PermissionModuleDefinition, PermissionScope } from '../../lib/permissions/permissionTypes';
import {
  buildUnifiedPermissionRows,
  toggleUnifiedDirectGrant,
} from '../../lib/permissions/unifiedPermissionViewModel';

export interface CompactDirectPermissionTreeProps {
  targetUserId: string;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  scope: PermissionScope;
  disabled?: boolean;
  applicationFilter?: string;
  moduleFilter?: string;
  onGrantsChange: (grants: UserPermissionGrant[]) => void;
}

const READINESS_LABELS = {
  legacy: 'Legacy',
  declared: 'Chưa xác minh',
  enforced: 'Đã thực thi',
  verified: 'Đã xác minh',
} as const;

const RISK_LABELS = {
  normal: 'Thường',
  important: 'Quan trọng',
  sensitive: 'Nhạy cảm',
} as const;

const sortModules = (modules: readonly PermissionModuleDefinition[]) =>
  [...modules].sort((left, right) =>
    (left.sortOrder || 0) - (right.sortOrder || 0) || left.label.localeCompare(right.label));

const CompactDirectPermissionTree: React.FC<CompactDirectPermissionTreeProps> = ({
  targetUserId,
  grants,
  effectiveSources,
  scope,
  disabled = false,
  applicationFilter,
  moduleFilter,
  onGrantsChange,
}) => {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const applications = useMemo(() => permissionRegistry
    .filter(application => !applicationFilter || application.code === applicationFilter)
    .map(application => ({
      ...application,
      modules: sortModules(application.modules)
        .filter(module => !moduleFilter || module.code === moduleFilter),
    }))
    .filter(application => application.modules.length > 0), [applicationFilter, moduleFilter]);

  const toggleExpanded = (moduleCode: string) => {
    setExpandedModules(previous => {
      const next = new Set(previous);
      if (next.has(moduleCode)) next.delete(moduleCode);
      else next.add(moduleCode);
      return next;
    });
  };

  const renderModule = (module: PermissionModuleDefinition) => {
    const rows = buildUnifiedPermissionRows({ module, grants, effectiveSources, scope });
    const viewRow = rows.find(row => row.action === 'view') || rows[0];
    const childRows = rows.filter(row => row.permissionCode !== viewRow?.permissionCode);
    const expanded = expandedModules.has(module.code);
    const checkedCount = rows.filter(row => row.hasDirectGrant).length;
    const effectiveCount = rows.filter(row => row.isEffective).length;

    if (!viewRow) return null;

    const scopeAllowed = isPermissionActionScopeAllowed(viewRow.permissionCode, scope);
    const viewAdditionBlocked = !viewRow.hasDirectGrant && (!viewRow.canAdd || !scopeAllowed);
    const viewDisabled = disabled || (viewRow.hasDirectGrant ? !viewRow.canRemove : viewAdditionBlocked);

    return (
      <section key={module.code} className="rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 px-3 py-2">
          <button type="button" onClick={() => toggleExpanded(module.code)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label={expanded ? 'Thu gọn quyền con' : 'Mở quyền con'}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-800">{module.label}</div>
            <div className="mt-0.5 text-[10px] font-bold text-slate-400">
              Direct {checkedCount}/{rows.length} · Nguồn quyền {effectiveCount}/{rows.length}
            </div>
          </div>
          <div className="hidden flex-wrap justify-end gap-1 md:flex">
            {viewRow.sourceBadges.map(badge => (
              <span key={badge.key} className="rounded-md bg-violet-100 px-2 py-1 text-[10px] font-black text-violet-700">{badge.label}</span>
            ))}
          </div>
          <input
            type="checkbox"
            checked={viewRow.hasDirectGrant}
            disabled={viewDisabled}
            onChange={event => onGrantsChange(toggleUnifiedDirectGrant({
              module,
              grants,
              targetUserId,
              permissionCode: viewRow.permissionCode,
              checked: event.target.checked,
              scope,
            }))}
            className="h-4 w-4 rounded accent-blue-600"
          />
        </div>

        {expanded && (
          <div className="space-y-1 border-t border-slate-100 p-2">
            {childRows.map(row => {
              const childScopeAllowed = isPermissionActionScopeAllowed(row.permissionCode, scope);
              const additionBlocked = !row.hasDirectGrant && (!row.canAdd || !childScopeAllowed);
              const inputDisabled = disabled || (row.hasDirectGrant ? !row.canRemove : additionBlocked);
              const disabledReason = !childScopeAllowed
                ? 'Scope này không hỗ trợ tác vụ.'
                : row.readiness === 'declared'
                  ? 'Chưa đủ bằng chứng để cấp mới.'
                  : row.readiness === 'legacy'
                    ? 'Legacy chỉ hiển thị tương thích.'
                    : '';

              return (
                <label key={row.permissionCode} className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-md px-3 py-2 hover:bg-slate-50">
                  <span className="min-w-0">
                    <span className="block text-xs font-black text-slate-700">{row.label}</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-slate-400">
                      {READINESS_LABELS[row.readiness]} · {RISK_LABELS[row.riskLevel]} · {row.permissionCode}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {row.hasDirectGrant && <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">Direct</span>}
                      {row.sourceBadges.map(badge => (
                        <span key={badge.key} className="rounded-md bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700">{badge.label}</span>
                      ))}
                    </span>
                    {disabledReason && !row.hasDirectGrant && (
                      <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-slate-400"><Info size={11} />{disabledReason}</span>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={row.hasDirectGrant}
                    disabled={inputDisabled}
                    onChange={event => onGrantsChange(toggleUnifiedDirectGrant({
                      module,
                      grants,
                      targetUserId,
                      permissionCode: row.permissionCode,
                      checked: event.target.checked,
                      scope,
                    }))}
                    className="mt-1 h-4 w-4 rounded accent-blue-600"
                  />
                </label>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-black text-slate-800">
        <ShieldCheck size={16} className="text-blue-600" />
        Ma trận quyền trực tiếp
      </div>
      {applications.map(application => (
        <div key={application.code} className="space-y-2">
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{application.label}</div>
          {application.modules.map(renderModule)}
        </div>
      ))}
    </section>
  );
};

export default CompactDirectPermissionTree;
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- lib/__tests__/compactDirectPermissionTree.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add components/permissions/CompactDirectPermissionTree.tsx lib/__tests__/compactDirectPermissionTree.test.tsx
git commit -m "feat(authz): add compact direct permission tree"
```

---

### Task 5: Direct User Permission Workspace

**Files:**
- Create: `components/permissions/DirectUserPermissionWorkspace.tsx`
- Modify: `pages/settings/SettingsAuthorizationGovernance.tsx`
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`

**Interfaces:**
- Consumes:
  - `AuthorizationPrincipal`, `EffectivePermissionSource`, `SodWarningAcceptanceInput`, `UnifiedPermissionPreview`
  - `listUserPermissionGrants()`, `previewUserPermissionChange()`, `applyUserPermissionChange()`
  - `projectMasterService.list()`
  - `permissionQuickTemplateService.list()`
  - `applyPermissionQuickTemplateToDraft()`, `copyDirectPermissionDraft()`, `pasteDirectPermissionClipboard()`
  - `CompactDirectPermissionTree`
- Produces:
  - `DirectUserPermissionWorkspaceProps`
  - Primary tab `Phân quyền user`

- [ ] **Step 1: Extend UI contract tests**

Add these cases to `lib/__tests__/authorizationAdminUiContract.test.ts`:

```ts
  it('makes direct user permission matrix the primary governance workflow', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(page).toContain('Phân quyền user');
    expect(page).toContain('Mẫu quyền');
    expect(page).toContain('DirectUserPermissionWorkspace');
    expect(workspace).toContain('Copy quyền');
    expect(workspace).toContain('Dán quyền');
    expect(workspace).toContain('Preview backend');
    expect(workspace).toContain('Lưu phân quyền');
    expect(workspace).toContain('projectMasterService.list');
    expect(workspace).not.toContain('Tất cả dự án');
  });

  it('keeps direct save governed and does not mutate identity, role assignment, or source mode from the browser', () => {
    const workspace = read('components/permissions/DirectUserPermissionWorkspace.tsx');

    expect(workspace).toContain('previewUserPermissionChange');
    expect(workspace).toContain('applyUserPermissionChange');
    expect(workspace).not.toContain(".from('user_permission_grants')");
    expect(workspace).not.toContain('principal_role_assignments');
    expect(workspace).not.toContain('source_mode');
    expect(workspace).not.toMatch(/actorUserId|requestedBy|p_actor/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because the new workspace and page tabs do not exist.

- [ ] **Step 3: Implement workspace**

Create `components/permissions/DirectUserPermissionWorkspace.tsx` with:

```ts
import React, { useEffect, useMemo, useState } from 'react';
import { Clipboard, ClipboardPaste, Eye, Loader2, Save } from 'lucide-react';
import type { Project, UserPermissionGrant } from '../../types';
import { projectMasterService } from '../../lib/projectMasterService';
import type {
  AuthorizationPrincipal,
  EffectivePermissionSource,
  SodWarningAcceptanceInput,
  UnifiedPermissionPreview,
} from '../../lib/permissions/authorizationGovernanceTypes';
import {
  validateDirectGrantDrafts,
  validateSodWarningAcceptances,
} from '../../lib/permissions/authorizationGovernanceViewModel';
import {
  applyUserPermissionChange,
  previewUserPermissionChange,
} from '../../lib/permissions/permissionAdminService';
import { getAllPermissionActions } from '../../lib/permissions/permissionRegistry';
import { permissionQuickTemplateService, type PermissionQuickTemplate } from '../../lib/permissions/permissionQuickTemplateService';
import {
  applyPermissionQuickTemplateToDraft,
  copyDirectPermissionDraft,
  pasteDirectPermissionClipboard,
  type DirectPermissionClipboard,
} from '../../lib/permissions/directUserPermissionMatrixViewModel';
import { buildUnifiedPermissionDraftKey } from '../../lib/permissions/unifiedPermissionViewModel';
import CompactDirectPermissionTree from './CompactDirectPermissionTree';
import PermissionChangeSummary from './PermissionChangeSummary';
import SodWarningPanel from './SodWarningPanel';

export interface DirectUserPermissionWorkspaceProps {
  principal: AuthorizationPrincipal;
  grants: readonly UserPermissionGrant[];
  effectiveSources: readonly EffectivePermissionSource[];
  principals: readonly AuthorizationPrincipal[];
  currentUserId: string;
  disabled: boolean;
  clipboard: DirectPermissionClipboard | null;
  onClipboardChange: (clipboard: DirectPermissionClipboard | null) => void;
  onSaved: () => Promise<void>;
}
```

Implement behavior:

- initialize `drafts` from `grants` whenever `principal.userId` or `grants` changes;
- load `projectMasterService.list()` and `permissionQuickTemplateService.list()` on mount;
- default selected project to the first active/non-hidden project;
- set `scope` to `{ scopeType: 'project', scopeId: selectedProjectId }`;
- apply templates to project modules only with `applicationFilter="project"`;
- copy current `drafts` through `copyDirectPermissionDraft(drafts)`;
- paste through `pasteDirectPermissionClipboard(principal.userId, clipboard)`;
- every draft-changing operation clears `preview`, `previewedDraftKey`, `acceptances`, and message;
- preview calls `previewUserPermissionChange(principal.userId, null, drafts)`;
- save calls `applyUserPermissionChange(principal.userId, preview.beforeFingerprint, null, drafts, { reason, warningAcceptances: acceptances })`;
- save is disabled if there is no matching preview, any hard deny, inactive account, missing reason for changed draft, or pending request;
- warnings must be acknowledged through `SodWarningPanel`;
- show source evidence as badges/details only; do not provide Legacy edit controls here.

Use this layout:

```tsx
<section className="grid min-h-[680px] gap-4 xl:grid-cols-[300px_1fr]">
  <aside className="rounded-lg border border-slate-200 bg-white p-3">
    {/* selected user summary, source summary, project select, template select */}
  </aside>
  <main className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
    {/* toolbar: Copy quyền, Dán quyền, Preview backend, Lưu phân quyền */}
    {/* CompactDirectPermissionTree */}
    {/* reason, preview summary, warnings */}
  </main>
</section>
```

- [ ] **Step 4: Modify SettingsAuthorizationGovernance page**

Modify `pages/settings/SettingsAuthorizationGovernance.tsx`:

- import `DirectUserPermissionWorkspace`;
- import `PermissionQuickTemplateEditor` from Task 6 only after Task 6 exists; until then keep the `Mẫu quyền` tab content as a disabled placeholder button-free panel;
- add state `activeTab: 'users' | 'templates' | 'advanced'`;
- add state `directClipboard: DirectPermissionClipboard | null`;
- keep the existing principal loading logic exactly as guarded by `selectedPrincipalIdRef`;
- render tabs with text `Phân quyền user`, `Mẫu quyền`, and `Nguồn nâng cao`;
- put `DirectUserPermissionWorkspace` in `Phân quyền user`;
- put the existing `BusinessRoleEditor`, `EffectivePermissionSourceList`, `PrincipalRoleAssignmentPanel`, `PrincipalDirectGrantPanel`, and audit list behind `Nguồn nâng cao`;
- do not remove the existing direct grant panel yet, because it still owns retired Material Request direct grant removal behavior until the new workspace covers that path.

- [ ] **Step 5: Run focused UI contract tests**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts lib/__tests__/compactDirectPermissionTree.test.tsx lib/__tests__/directUserPermissionMatrixViewModel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/permissions/DirectUserPermissionWorkspace.tsx pages/settings/SettingsAuthorizationGovernance.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): make direct user permission matrix primary"
```

---

### Task 6: Quick Template Settings UI

**Files:**
- Create: `components/permissions/PermissionQuickTemplateEditor.tsx`
- Modify: `pages/settings/SettingsAuthorizationGovernance.tsx`
- Modify: `lib/__tests__/authorizationAdminUiContract.test.ts`

**Interfaces:**
- Consumes:
  - `permissionQuickTemplateService`
  - `CompactDirectPermissionTree`
  - `applyPermissionQuickTemplateToDraft()`
  - `getAllPermissionActions()`, `permissionRegistry`
- Produces:
  - `PermissionQuickTemplateEditorProps`
  - Active tab `Mẫu quyền` where Admin edits preset checkboxes and saves/deactivates templates.

- [ ] **Step 1: Extend UI contract tests**

Add this test:

```ts
  it('edits quick templates as presets, not live Business Role assignments', () => {
    const page = read('pages/settings/SettingsAuthorizationGovernance.tsx');
    const editor = read('components/permissions/PermissionQuickTemplateEditor.tsx');

    expect(page).toContain('PermissionQuickTemplateEditor');
    expect(editor).toContain('permissionQuickTemplateService.save');
    expect(editor).toContain('permissionQuickTemplateService.deactivate');
    expect(editor).toContain('CompactDirectPermissionTree');
    expect(editor).toContain('Mẫu quyền');
    expect(editor).not.toContain('assignBusinessRole');
    expect(editor).not.toContain('principal_role_assignments');
    expect(editor).not.toContain('role_permission_templates');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts
```

Expected: FAIL because `PermissionQuickTemplateEditor.tsx` is not wired.

- [ ] **Step 3: Implement template editor**

Create `components/permissions/PermissionQuickTemplateEditor.tsx` with:

```ts
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import type { UserPermissionGrant } from '../../types';
import { permissionRegistry } from '../../lib/permissions/permissionRegistry';
import {
  permissionQuickTemplateService,
  type PermissionQuickTemplate,
} from '../../lib/permissions/permissionQuickTemplateService';
import CompactDirectPermissionTree from './CompactDirectPermissionTree';

export interface PermissionQuickTemplateEditorProps {
  disabled: boolean;
}
```

Implement behavior:

- load `permissionQuickTemplateService.list()` on mount;
- keep local selected template id;
- use a synthetic user id `template-draft` for the compact tree draft;
- convert `permissionCodes` into draft grants with `scopeType: 'project'`, `scopeId: 'template-scope'`;
- render code, name, description, reason inputs;
- save through `permissionQuickTemplateService.save({ templateId, code, name, description, permissionCodes, reason })`;
- deactivate through `permissionQuickTemplateService.deactivate(templateId, reason)`;
- do not call Business Role services;
- after save/deactivate, reload list and keep the saved template selected.

The editor must treat scope only as a template editing carrier. Saved template data stores permission codes only, not project ids.

- [ ] **Step 4: Wire template tab**

Modify `pages/settings/SettingsAuthorizationGovernance.tsx`:

- import `PermissionQuickTemplateEditor`;
- replace the temporary `Mẫu quyền` placeholder with `<PermissionQuickTemplateEditor disabled={!canManageGrants} />`;
- keep `BusinessRoleEditor` in `Nguồn nâng cao`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- lib/__tests__/authorizationAdminUiContract.test.ts lib/__tests__/permissionQuickTemplateService.test.ts lib/__tests__/compactDirectPermissionTree.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add components/permissions/PermissionQuickTemplateEditor.tsx pages/settings/SettingsAuthorizationGovernance.tsx lib/__tests__/authorizationAdminUiContract.test.ts
git commit -m "feat(authz): add quick template settings tab"
```

---

### Task 7: Local Verification and Gated Cloud Checkpoint

**Files:**
- Verify only; no source creation required.

**Interfaces:**
- Consumes all previous task outputs.
- Produces operator checkpoint evidence without identities, raw grants, tokens, or URLs.

- [ ] **Step 1: Run focused Vitest suites**

Run:

```bash
npm test -- \
  lib/__tests__/directUserPermissionMatrixViewModel.test.ts \
  lib/__tests__/permissionQuickTemplateMigration.test.ts \
  lib/__tests__/permissionQuickTemplateService.test.ts \
  lib/__tests__/compactDirectPermissionTree.test.tsx \
  lib/__tests__/authorizationAdminUiContract.test.ts \
  lib/__tests__/unifiedPermissionViewModel.test.ts \
  lib/__tests__/projectPermissionTemplates.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run TypeScript check**

Run:

```bash
npm run lint
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS and Vite writes a `dist/` build.

- [ ] **Step 4: Run whitespace diff check**

Run:

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 5: Confirm no forbidden source changes**

Run:

```bash
git diff --name-only HEAD
```

Expected changed files are limited to:

```text
components/permissions/CompactDirectPermissionTree.tsx
components/permissions/DirectUserPermissionWorkspace.tsx
components/permissions/PermissionQuickTemplateEditor.tsx
docs/superpowers/plans/2026-07-19-vioo-direct-user-permission-matrix.md
lib/__tests__/authorizationAdminUiContract.test.ts
lib/__tests__/compactDirectPermissionTree.test.tsx
lib/__tests__/directUserPermissionMatrixViewModel.test.ts
lib/__tests__/permissionQuickTemplateMigration.test.ts
lib/__tests__/permissionQuickTemplateService.test.ts
lib/permissions/directUserPermissionMatrixViewModel.ts
lib/permissions/permissionQuickTemplateService.ts
pages/settings/SettingsAuthorizationGovernance.tsx
supabase/migrations/<generated_timestamp>_permission_quick_templates.sql
supabase/tests/permission_quick_templates_smoke.sql
```

If the output contains dirty roadmap files, applied migration edits outside the generated migration, Save 12 principal files, source-mode files, or Remediation C implementation files, stop fail-closed and ask the operator.

- [ ] **Step 6: Stop for Cloud migration approval**

Report aggregate evidence only:

```text
Local evidence:
- Focused tests: PASS, suites 7
- TypeScript: PASS
- Build: PASS
- Diff check: PASS
- Cloud mutation: none
- Direct grant table mutation outside governed commands: none
- Legacy/source-mode mutation: none
Next checkpoint: ask approval to run rollback-only Cloud smoke for permission_quick_templates.
```

Do not run the Cloud smoke script without explicit approval.

- [ ] **Step 7: If the operator approves rollback-only Cloud smoke, run read-only/rollback evidence**

Use a command that runs `supabase/tests/permission_quick_templates_smoke.sql` against the linked project without printing tokens, URLs, identities, or raw grants.

Expected aggregate evidence:

```text
Cloud rollback-only smoke:
- transaction: rolled back
- list_permission_quick_templates shape: json array
- Cloud mutation: none committed
```

If any warning, hard deny, invariant drift, missing RPC, or permission error appears, stop fail-closed and do not proceed to migration apply.

- [ ] **Step 8: Commit final verification adjustments only if files changed**

```bash
git status --short
git add components/permissions/CompactDirectPermissionTree.tsx components/permissions/DirectUserPermissionWorkspace.tsx components/permissions/PermissionQuickTemplateEditor.tsx pages/settings/SettingsAuthorizationGovernance.tsx lib/permissions/directUserPermissionMatrixViewModel.ts lib/permissions/permissionQuickTemplateService.ts lib/__tests__/authorizationAdminUiContract.test.ts lib/__tests__/compactDirectPermissionTree.test.tsx lib/__tests__/directUserPermissionMatrixViewModel.test.ts lib/__tests__/permissionQuickTemplateMigration.test.ts lib/__tests__/permissionQuickTemplateService.test.ts supabase/migrations/*_permission_quick_templates.sql supabase/tests/permission_quick_templates_smoke.sql
git commit -m "feat(authz): complete direct user permission matrix"
```

Expected: commit includes only this plan's implementation files.

---

## Self-Review

Spec coverage:

- Dedicated page with left user list: Task 5.
- Compact parent-child matrix: Task 4.
- Parent/View wraps children while children remain independent: Tasks 1 and 4 reuse `toggleUnifiedDirectGrant`.
- Project-only scope, no all-projects: Tasks 1, 5, and Global Constraints.
- Quick templates as presets only: Tasks 2, 3, 6.
- Apply template into draft, then Admin edits checkbox: Tasks 1, 5, 6.
- Copy/paste replaces receiving Direct Grant draft and does not auto-save: Tasks 1 and 5.
- Legacy runs parallel and visible: Tasks 4 and 5.
- Governed backend Preview/Save only: Tasks 5 and 7.
- Readiness gating: Tasks 1, 2, and 4.
- Cloud safety: Task 7.
- Remediation C kept separate: Global Constraints and Task 7 forbidden-file check.

Placeholder scan:

- The plan intentionally uses `<generated_timestamp>` only where Supabase CLI must generate the migration timestamp. The executor must use `npx supabase migration new permission_quick_templates` and then the generated path.
- No task asks for automatic legacy inference, all-project grants, source-mode mutation, direct grant table writes, or Cloud mutation before approval.

Type consistency:

- `PermissionQuickTemplateDraft.permissionCodes` in Task 1 matches `PermissionQuickTemplate.permissionCodes` in Task 3.
- `DirectPermissionClipboard` is produced by Task 1 and consumed by Task 5.
- `CompactDirectPermissionTreeProps` from Task 4 is consumed by Tasks 5 and 6.
- `permissionQuickTemplateService` from Task 3 is consumed by Tasks 5 and 6.
