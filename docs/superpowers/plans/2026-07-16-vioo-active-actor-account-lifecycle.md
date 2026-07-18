# VIOO Active Actor and Account Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thành phần active-actor còn lại của Phase 0 và toàn bộ Phase 1 bằng cách chặn mọi Data API/RPC/RLS access của tài khoản inactive, thay xóa user bằng disable/reactivate có audit, khóa Supabase Auth và bảo đảm reactivation không phục hồi quyền cũ.

**Architecture:** Postgres là điểm deny tức thời: `current_app_user_id()` chỉ resolve active profile, PostgREST pre-request chặn Data API/RPC, và restrictive RLS policy chặn Realtime/Storage paths không chạy pre-request. Một Edge Function tin cậy điều phối DB operation idempotent với Supabase Auth Admin API; disable đặt app account inactive trước, rotate password và ban Auth sau, còn reactivate mở Auth trước rồi mới đặt app account active.

**Tech Stack:** PostgreSQL 17/Supabase RLS và RPC, Supabase Auth Admin API, Supabase Edge Functions (Deno/TypeScript), React 18, TypeScript 5.8, Vitest 4, Vite 6.

**Approved Spec:** `docs/superpowers/specs/2026-07-16-vioo-authorization-governance-migration-design.md`, đặc biệt Sections 5, 12, 13.2, 14, 15 Phase 0-1 và 17.4-17.5.

## Global Constraints

- Thực hiện trên branch hiện tại `refactor/module-du-an-v1`; không tạo worktree mới.
- Không sửa hoặc revert thay đổi hiện có trong `HANDOFF_SUMMARY.md`.
- Không dùng `supabase db push`; Cloud migration phải dry-run bằng transaction rồi apply bằng `supabase db query --linked`.
- Tạo mọi migration bằng `npx supabase migration new <name>`; không tự đặt timestamp migration.
- Không mass-repair migration history; chỉ repair đúng version mới sau khi apply và verify.
- Không grant workflow/account-management RPC cho `anon` hoặc `authenticated` khi RPC chỉ dành cho service role.
- Không sửa trực tiếp bảng `auth.*`; dùng Supabase Auth Admin API.
- Không tạo lại hoặc grant `public.lookup_login_email(text)`; migration `20260715173948_revoke_legacy_login_lookup.sql` là security boundary đã được duyệt.
- Không xóa `public.users`, employee, authored record, audit record hoặc lịch sử nghiệp vụ khi disable account.
- Reactivation không tự phục hồi role, direct grant, legacy permission, project staff assignment, responsibility slot hoặc runtime assignment cũ.
- Backend là authority; frontend status và button chỉ hỗ trợ UX.
- Giữ `is_active` trong giai đoạn tương thích và đồng bộ nó với `account_status`.
- Mọi migration tương lai tạo table RLS mới trong `public` hoặc `storage` phải đồng thời thêm restrictive active-actor gate và mở rộng smoke inventory; migration Task 1 chỉ backfill các table đang tồn tại.
- Mọi nguồn role/grant/assignment bổ sung từ Phase 2 trở đi phải gọi cùng active-principal invariant; không được chỉ lọc disabled user ở frontend.
- Mỗi task đi theo TDD, kết thúc bằng targeted tests xanh và một commit riêng.

## Plan Boundary

Plan này chỉ triển khai Phase 0-1 của đặc tả đã duyệt. Các subsystem độc lập còn lại phải có execution plan riêng sau khi plan này hoàn tất:

- Phase 0 inventory/hardening còn tồn đọng ngoài active actor phải tiếp tục theo `docs/security/permission-audit.md`; plan này không tuyên bố hoàn tất mọi finding Phase 0.
- Phase 2: Business Role và Minimal SoD.
- Phase 3: Controlled Legacy Migration và atomic permission administration.
- Phase 4: Daily Log Golden Pilot.
- Phase 5-7: từng module rollout và legacy retirement.

Không viết chi tiết Phase 2-7 ngay trong plan này vì schema, helper và UI contract của chúng phụ thuộc trực tiếp vào kết quả Phase 0-1.

Task 2 vẫn ghi durable `needsReassignment` metadata và UI báo số trách nhiệm đã đóng. Việc route notification đến đúng `Business Scope Admin` được hoàn tất trong Phase 2, khi role/scope assignment đó tồn tại; Phase 1 không tự giao việc nghiệp vụ cho legacy System Admin.

## File Structure

### Database and verification

- Create via CLI: `supabase/migrations/*_active_actor_account_status.sql` — account metadata, active actor, PostgREST pre-request và restrictive RLS gate; `*` là timestamp duy nhất do CLI sinh.
- Create via CLI: `supabase/migrations/*_user_account_lifecycle_operations.sql` — idempotent DB lifecycle operations, active-principal guards, Auth retry state, revocation và audit; `*` là timestamp duy nhất do CLI sinh.
- Create: `supabase/tests/active_actor_account_status_smoke.sql` — runtime smoke cho active actor và account status.
- Create: `supabase/tests/user_account_lifecycle_smoke.sql` — runtime smoke cho disable/reactivate và no-restore invariant.
- Create: `supabase/tests/active_actor_surface_snapshot.sql` — metadata inventory trước/sau rollout.
- Create: `lib/__tests__/activeActorAccountStatusMigration.test.ts` — static migration contract.
- Create: `lib/__tests__/userAccountLifecycleMigration.test.ts` — static lifecycle migration contract.

Khi thực thi, `supabase migration new` tạo path chính xác; mọi step sau trong cùng task phải dùng path CLI vừa in ra và xác nhận chỉ có một file khớp suffix.

### Edge Functions

- Create: `supabase/functions/_shared/adminAuthorization.ts` — resolve caller và kiểm active legacy System Admin.
- Create: `supabase/functions/manage-user-account/index.ts` — trusted lifecycle orchestrator.
- Modify: `supabase/functions/create-user/index.ts` — dùng shared active-admin guard.
- Modify: `supabase/functions/reset-password/index.ts` — dùng shared active-caller/admin guard.
- Create: `lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts`.
- Create: `lib/__tests__/manageUserAccountEdgeFunctionContract.test.ts`.

### Frontend

- Modify: `types.ts` — account lifecycle fields và operation result types.
- Modify: `context/authState.ts` — map account lifecycle fields.
- Create: `lib/userAccountLifecycleService.ts` — invoke Edge Function và normalize errors.
- Create: `lib/__tests__/userAccountLifecycleService.test.ts`.
- Modify: `context/AppContext.tsx` — replace `removeUser` bằng disable/reactivate commands.
- Create: `components/UserAccountStatusModal.tsx`.
- Delete: `components/DeleteUserModal.tsx`.
- Modify: `pages/UserManagement.tsx`.
- Modify: `pages/Settings.tsx`.
- Modify: `pages/settings/SettingsUsers.tsx`.
- Create: `lib/__tests__/userAccountLifecycleUiContract.test.ts`.

### Operations

- Create: `docs/security/phase01-account-lifecycle-live-apply-log.md` — preflight, dry-run, apply, repair, deploy, canary và rollback evidence.

---

### Task 1: Add active-account metadata and enforce an active actor globally

**Files:**
- Create via CLI: `supabase/migrations/*_active_actor_account_status.sql`
- Create: `lib/__tests__/activeActorAccountStatusMigration.test.ts`
- Create: `supabase/tests/active_actor_account_status_smoke.sql`
- Create: `supabase/tests/active_actor_surface_snapshot.sql`

**Interfaces:**
- Consumes: `public.users`, `public.current_app_user_id()`, existing RLS policies and PostgREST role `authenticator`.
- Produces: `users.account_status`, lifecycle metadata columns, active-only `public.current_app_user_id()`, `public.enforce_active_app_actor()` and a table-specific restrictive active-actor policy.

- [ ] **Step 1: Write the failing migration contract**

Create `lib/__tests__/activeActorAccountStatusMigration.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_active_actor_account_status.sql'))
  .sort();
const migration = files.length === 1
  ? readFileSync(join(migrationsDir, files[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('active actor account status migration', () => {
  it('has exactly one generated migration and no external transaction wrapper', () => {
    expect(files).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
  });

  it('adds explicit account lifecycle metadata while retaining is_active', () => {
    expect(normalized).toMatch(/add column if not exists account_status text/i);
    expect(normalized).toMatch(/add column if not exists disabled_at timestamptz/i);
    expect(normalized).toMatch(/add column if not exists disabled_by uuid/i);
    expect(normalized).toMatch(/add column if not exists disabled_reason text/i);
    expect(normalized).toMatch(/add column if not exists reactivated_at timestamptz/i);
    expect(normalized).toMatch(/add column if not exists reactivated_by uuid/i);
    expect(normalized).toMatch(/disable trigger trg_users_prevent_privilege_self_update.*update public\.users.*enable trigger trg_users_prevent_privilege_self_update/is);
  });

  it('makes current_app_user_id active-only and preserves disabled profiles during Auth sync', () => {
    expect(normalized).toMatch(/create or replace function public\.current_app_user_id\(\)/i);
    expect(normalized).toMatch(/u\.is_active\s+and\s+u\.account_status = 'ACTIVE'/i);
    expect(normalized).toMatch(/session_user = 'supabase_auth_admin'/i);
    expect(normalized).toMatch(/new\.account_status := old\.account_status/i);
    expect(normalized).toMatch(/new\.role := old\.role/i);
    expect(normalized).toMatch(/new\.allowed_modules := old\.allowed_modules/i);
    expect(normalized).toMatch(/new\.admin_sub_modules := old\.admin_sub_modules/i);
    expect(normalized).toMatch(/guard_user_account_lifecycle_metadata/i);
    expect(normalized).toMatch(/auth\.role\(\) = 'service_role'.*app\.account_lifecycle_command/is);
  });

  it('does not reopen the retired anonymous username lookup', () => {
    expect(normalized).not.toMatch(/create or replace function public\.lookup_login_email/i);
    expect(normalized).not.toMatch(/grant execute on function public\.lookup_login_email/i);
  });

  it('gates PostgREST and all RLS-protected authenticated table access', () => {
    expect(normalized).toMatch(/create or replace function public\.enforce_active_app_actor\(\)/i);
    expect(normalized).toMatch(/alter role authenticator set pgrst\.db_pre_request = 'public\.enforce_active_app_actor'/i);
    expect(normalized).toMatch(/as restrictive for all to authenticated/i);
    expect(normalized).toMatch(/storage.*objects/i);
  });

  it('removes ordinary authenticated hard-delete access to public.users', () => {
    expect(normalized).toMatch(/drop policy if exists users_delete on public\.users/i);
    expect(normalized).toMatch(/revoke delete on public\.users from authenticated/i);
  });
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run:

```bash
npm test -- lib/__tests__/activeActorAccountStatusMigration.test.ts
```

Expected: FAIL because no migration ends with `_active_actor_account_status.sql`.

- [ ] **Step 3: Generate the migration using the Supabase CLI**

Run:

```bash
npx supabase migration new active_actor_account_status
```

Expected: one new path under `supabase/migrations/` ending in `_active_actor_account_status.sql`. Save that exact path in the shell variable used by later verification commands:

```bash
ACTIVE_ACTOR_MIGRATION="$(rg --files supabase/migrations | rg '_active_actor_account_status\.sql$')"
test -n "$ACTIVE_ACTOR_MIGRATION"
```

Expected: exit `0` and exactly one matching path.

- [ ] **Step 4: Implement the active-account migration**

Put the following complete SQL in the generated migration:

```sql
create schema if not exists app_private;

alter table public.users
  add column if not exists account_status text,
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_by uuid references public.users(id) on delete set null,
  add column if not exists disabled_reason text,
  add column if not exists reactivated_at timestamptz,
  add column if not exists reactivated_by uuid references public.users(id) on delete set null,
  add column if not exists reactivation_reason text;

-- The existing profile guard requires an app actor; this one-time owner backfill
-- has no JWT. The trigger state is transactional and is restored on any error.
alter table public.users
  disable trigger trg_users_prevent_privilege_self_update;

update public.users
set account_status = case when coalesce(is_active, true) then 'ACTIVE' else 'DISABLED' end
where account_status is null;

alter table public.users
  enable trigger trg_users_prevent_privilege_self_update;

alter table public.users
  alter column account_status set default 'ACTIVE',
  alter column account_status set not null;

alter table public.users
  drop constraint if exists users_account_status_check,
  drop constraint if exists users_account_status_consistency_check;

alter table public.users
  add constraint users_account_status_check
    check (account_status in ('ACTIVE', 'DISABLED')),
  add constraint users_account_status_consistency_check
    check (is_active = (account_status = 'ACTIVE'));

create or replace function app_private.sync_user_account_status_compat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if session_user = 'supabase_auth_admin' then
      -- Auth user metadata is identity/profile input, never authorization input.
      new.role := 'EMPLOYEE';
      new.assigned_warehouse_id := null;
      new.allowed_modules := '{}'::text[];
      new.admin_modules := '{}'::text[];
      new.allowed_sub_modules := '{}'::jsonb;
      new.admin_sub_modules := '{}'::jsonb;
    end if;

    -- During compatibility, either explicit disabled signal must win over defaults.
    if new.account_status = 'DISABLED' or new.is_active = false then
      new.account_status := 'DISABLED';
      new.is_active := false;
    else
      new.account_status := 'ACTIVE';
      new.is_active := true;
    end if;
    return new;
  end if;

  if session_user = 'supabase_auth_admin' then
    new.role := old.role;
    new.assigned_warehouse_id := old.assigned_warehouse_id;
    new.allowed_modules := old.allowed_modules;
    new.admin_modules := old.admin_modules;
    new.allowed_sub_modules := old.allowed_sub_modules;
    new.admin_sub_modules := old.admin_sub_modules;
    new.account_status := old.account_status;
    new.is_active := old.is_active;
    return new;
  end if;

  if old.account_status is distinct from new.account_status
    or old.is_active is distinct from new.is_active
  then
    if coalesce(current_setting('app.account_lifecycle_command', true), '') <> 'on' then
      raise exception 'Account status can only be changed by the account lifecycle command'
        using errcode = '42501';
    end if;

    if old.account_status is distinct from new.account_status then
      new.is_active := new.account_status = 'ACTIVE';
    else
      new.account_status := case when new.is_active then 'ACTIVE' else 'DISABLED' end;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app_private.sync_user_account_status_compat() from public, anon, authenticated;

drop trigger if exists trg_users_account_status_compat on public.users;
create trigger trg_users_account_status_compat
  before insert or update on public.users
  for each row
  execute function app_private.sync_user_account_status_compat();

create or replace function app_private.guard_user_account_lifecycle_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_status is distinct from new.account_status
    or old.disabled_at is distinct from new.disabled_at
    or old.disabled_by is distinct from new.disabled_by
    or old.disabled_reason is distinct from new.disabled_reason
    or old.reactivated_at is distinct from new.reactivated_at
    or old.reactivated_by is distinct from new.reactivated_by
    or old.reactivation_reason is distinct from new.reactivation_reason
  then
    if (select auth.role()) = 'service_role'
      and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
    then
      return new;
    end if;

    raise exception 'Account lifecycle metadata can only be changed by the trusted command'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_user_account_lifecycle_metadata()
  from public, anon, authenticated;

drop trigger if exists trg_users_guard_account_lifecycle_metadata on public.users;
create trigger trg_users_guard_account_lifecycle_metadata
  before update on public.users
  for each row
  execute function app_private.guard_user_account_lifecycle_metadata();

create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where (
      u.auth_id = (select auth.uid())
      or (
        u.auth_id is null
        and lower(u.email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
      )
    )
    and u.is_active
    and u.account_status = 'ACTIVE'
  order by case when u.auth_id = (select auth.uid()) then 0 else 1 end
  limit 1;
$$;

revoke all on function public.current_app_user_id() from public, anon;
grant execute on function public.current_app_user_id() to authenticated, service_role;

create or replace function public.enforce_active_app_actor()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and public.current_app_user_id() is null
  then
    raise exception 'Active application account required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.enforce_active_app_actor() from public;
grant execute on function public.enforce_active_app_actor() to anon, authenticated, service_role;

alter role authenticator
  set pgrst.db_pre_request = 'public.enforce_active_app_actor';

do $$
declare
  target record;
  policy_name text;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and c.relrowsecurity
      and n.nspname = 'public'
  loop
    policy_name := left(target.table_name || '_active_actor_gate', 63);
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_name,
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy %I on %I.%I as restrictive for all to authenticated using ((select public.current_app_user_id()) is not null) with check ((select public.current_app_user_id()) is not null)',
      policy_name,
      target.schema_name,
      target.table_name
    );
  end loop;

  if to_regclass('storage.objects') is not null then
    drop policy if exists storage_objects_active_actor_gate on storage.objects;
    create policy storage_objects_active_actor_gate
      on storage.objects
      as restrictive
      for all
      to authenticated
      using ((select public.current_app_user_id()) is not null)
      with check ((select public.current_app_user_id()) is not null);
  end if;
end;
$$;

drop policy if exists users_delete on public.users;
revoke delete on public.users from authenticated;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
```

- [ ] **Step 5: Add the runtime smoke test**

Create `supabase/tests/active_actor_account_status_smoke.sql`:

```sql
do $$
begin
  if to_regprocedure('public.current_app_user_id()') is null then
    raise exception 'Missing public.current_app_user_id()';
  end if;
  if to_regprocedure('public.enforce_active_app_actor()') is null then
    raise exception 'Missing public.enforce_active_app_actor()';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'users'
      and column_name = 'account_status'
  ) then
    raise exception 'Missing users.account_status';
  end if;
  if has_table_privilege('authenticated', 'public.users', 'DELETE') then
    raise exception 'authenticated still has DELETE on public.users';
  end if;
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'users_active_actor_gate'
      and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'Missing restrictive active actor gate on public.users';
  end if;
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = n.nspname
          and p.tablename = c.relname
          and p.policyname = left(c.relname || '_active_actor_gate', 63)
          and p.permissive = 'RESTRICTIVE'
          and 'authenticated' = any(p.roles)
      )
  ) then
    raise exception 'At least one RLS-enabled public table lacks the active actor gate';
  end if;
  if to_regclass('storage.objects') is not null and not exists (
    select 1
    from pg_policies p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname = 'storage_objects_active_actor_gate'
      and p.permissive = 'RESTRICTIVE'
  ) then
    raise exception 'storage.objects lacks the active actor gate';
  end if;
end;
$$;

create temp table active_actor_smoke_ids (
  active_id uuid not null,
  disabled_id uuid not null,
  active_email text not null,
  disabled_email text not null
) on commit drop;

insert into active_actor_smoke_ids
values (
  gen_random_uuid(),
  gen_random_uuid(),
  'active-actor-smoke@vioo.local',
  'disabled-actor-smoke@vioo.local'
);

grant select on active_actor_smoke_ids to authenticated;

delete from public.users
where email in (
  select active_email from active_actor_smoke_ids
  union all
  select disabled_email from active_actor_smoke_ids
);

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select active_id, 'Active Actor Smoke', active_email, 'active-actor-smoke',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from active_actor_smoke_ids
union all
select disabled_id, 'Disabled Actor Smoke', disabled_email, 'disabled-actor-smoke',
       'EMPLOYEE'::public.user_role, false, 'DISABLED', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from active_actor_smoke_ids;

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select active_email from active_actor_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  if public.current_app_user_id() is distinct from (select active_id from active_actor_smoke_ids) then
    raise exception 'Active profile did not resolve';
  end if;
  perform public.enforce_active_app_actor();
  begin
    update public.users
    set disabled_reason = 'client tamper attempt'
    where id = (select active_id from active_actor_smoke_ids);
    raise exception 'Active user changed protected lifecycle metadata';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select disabled_email from active_actor_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  if public.current_app_user_id() is not null then
    raise exception 'Disabled profile resolved as an active actor';
  end if;
  begin
    perform public.enforce_active_app_actor();
    raise exception 'Disabled actor passed the pre-request guard';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
delete from public.users
where id in (
  select active_id from active_actor_smoke_ids
  union all
  select disabled_id from active_actor_smoke_ids
);
```

- [ ] **Step 6: Add the metadata snapshot query**

Create `supabase/tests/active_actor_surface_snapshot.sql`:

```sql
with policy_rows as (
  select
    'policy'::text as section,
    format('%I.%I.%I', schemaname, tablename, policyname) as entity,
    jsonb_build_object(
      'command', cmd,
      'permissive', permissive,
      'roles', roles,
      'qual', qual,
      'with_check', with_check
    ) as metadata
  from pg_policies
  where schemaname in ('public', 'storage')
    and 'authenticated' = any(roles)
),
function_rows as (
  select
    'security_definer'::text as section,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as entity,
    jsonb_build_object(
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'active_chain', lower(pg_get_functiondef(p.oid)) ~
        'current_app_user_id|is_admin\\(|is_module_admin\\(|has_permission|can_access_module'
    ) as metadata
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private')
    and p.prosecdef
),
setting_row as (
  select
    'postgrest_setting'::text as section,
    'authenticator.pgrst.db_pre_request'::text as entity,
    jsonb_build_object(
      'settings', coalesce(array_to_json(s.setconfig)::jsonb, '[]'::jsonb)
    ) as metadata
  from pg_db_role_setting s
  join pg_roles r on r.oid = s.setrole
  where r.rolname = 'authenticator'
)
select section, entity, metadata from policy_rows
union all
select section, entity, metadata from function_rows
union all
select section, entity, metadata from setting_row
order by section, entity;
```

- [ ] **Step 7: Run targeted tests and a transaction-only Cloud dry-run**

Run:

```bash
npm test -- lib/__tests__/activeActorAccountStatusMigration.test.ts
```

Expected: PASS.

Run the migration and smoke in one rolled-back transaction without writing a temporary SQL file:

```bash
ACTIVE_ACTOR_MIGRATION="$(rg --files supabase/migrations | rg '_active_actor_account_status\.sql$')"
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const m=fs.readFileSync(process.argv[1],'utf8'); const s=fs.readFileSync('supabase/tests/active_actor_account_status_smoke.sql','utf8'); process.stdout.write('begin; set local lock_timeout=\\'5s\\'; '+m+' '+s+' rollback;')" "$ACTIVE_ACTOR_MIGRATION")"
```

Expected: exit `0`; all DDL and fixtures roll back.

- [ ] **Step 8: Commit Task 1**

```bash
git add "$ACTIVE_ACTOR_MIGRATION" lib/__tests__/activeActorAccountStatusMigration.test.ts supabase/tests/active_actor_account_status_smoke.sql supabase/tests/active_actor_surface_snapshot.sql
git commit -m "feat(auth): enforce active application actors"
```

---

### Task 2: Add idempotent lifecycle operations and active-principal invariants

**Files:**
- Create via CLI: `supabase/migrations/*_user_account_lifecycle_operations.sql`
- Create: `lib/__tests__/userAccountLifecycleMigration.test.ts`
- Create: `supabase/tests/user_account_lifecycle_smoke.sql`

**Interfaces:**
- Consumes: active-account metadata from Task 1, `user_permission_grants`, legacy user fields, Project staff permissions, responsibility slots and runtime assignments.
- Produces: active-principal triggers, `public.get_user_account_lifecycle_preview(uuid)` for active legacy admins, and prepare/complete/fail lifecycle RPCs executable only by `service_role`.

- [ ] **Step 1: Write the failing lifecycle migration contract**

Create `lib/__tests__/userAccountLifecycleMigration.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const files = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_user_account_lifecycle_operations.sql'))
  .sort();
const migration = files.length === 1
  ? readFileSync(join(migrationsDir, files[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('user account lifecycle operations migration', () => {
  it('has one migration and a private idempotent operation ledger', () => {
    expect(files).toHaveLength(1);
    expect(normalized).toMatch(/create table if not exists app_private\.user_account_operations/i);
    expect(normalized).toMatch(/idempotency_key uuid not null unique/i);
    expect(normalized).toMatch(/action text not null check \(action in \('DISABLE', 'REACTIVATE'\)\)/i);
    expect(normalized).toMatch(/account_operation_status text not null default 'IDLE'/i);
    expect(normalized).toMatch(/account_operation_action text/i);
  });

  it('revokes every current permission source without deleting history', () => {
    expect(normalized).toMatch(/update public\.user_permission_grants set is_active = false/i);
    expect(normalized).toMatch(/update public\.project_staff_permissions/i);
    expect(normalized).toMatch(/update public\.app_responsibility_slots/i);
    expect(normalized).toMatch(/update public\.app_assignments/i);
    expect(normalized).not.toMatch(/delete from public\.user_permission_grants/i);
    expect(normalized).toMatch(/revoke_user_access_sources/i);
  });

  it('rejects new active rights or assignments for inactive principals', () => {
    expect(normalized).toMatch(/assert_active_principal/i);
    expect(normalized).toMatch(/trg_user_permission_grants_active_principal/i);
    expect(normalized).toMatch(/trg_app_responsibility_slots_active_principal/i);
    expect(normalized).toMatch(/trg_app_assignments_active_principal/i);
    expect(normalized).toMatch(/trg_project_staff_active_principal/i);
  });

  it('enforces self-disable and last-admin guards', () => {
    expect(normalized).toMatch(/Cannot disable the current account/i);
    expect(normalized).toMatch(/Cannot disable the last active System Admin/i);
  });

  it('keeps lifecycle commands service-role only', () => {
    expect(normalized).toMatch(/revoke all on function public\.prepare_user_account_lifecycle\(uuid, uuid, text, text, uuid\) from public, anon, authenticated/i);
    expect(normalized).toMatch(/grant execute on function public\.prepare_user_account_lifecycle\(uuid, uuid, text, text, uuid\) to service_role/i);
  });

  it('reactivates the profile without restoring old rights', () => {
    expect(normalized).toMatch(/account_status = 'ACTIVE'/i);
    expect(normalized).toMatch(/role = 'EMPLOYEE'/i);
    expect(normalized).toMatch(/allowed_modules = '\{\}'::text\[\]/i);
    expect(normalized.match(/revoke_user_access_sources/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('supports persistent Auth retry status and an admin preview', () => {
    expect(normalized).toMatch(/create or replace function public\.get_user_account_lifecycle_preview\(p_target_user_id uuid\)/i);
    expect(normalized).toMatch(/account_operation_status = 'AUTH_RETRY'/i);
    expect(normalized).toMatch(/status <> 'COMPLETED'/i);
    expect(normalized).toMatch(/old\.account_operation_status is distinct from new\.account_operation_status/i);
  });
});
```

- [ ] **Step 2: Run the contract and verify it fails**

```bash
npm test -- lib/__tests__/userAccountLifecycleMigration.test.ts
```

Expected: FAIL because the lifecycle operation migration does not exist.

- [ ] **Step 3: Generate the lifecycle migration**

```bash
npx supabase migration new user_account_lifecycle_operations
ACCOUNT_LIFECYCLE_MIGRATION="$(rg --files supabase/migrations | rg '_user_account_lifecycle_operations\.sql$')"
test -n "$ACCOUNT_LIFECYCLE_MIGRATION"
```

Expected: exit `0` and exactly one matching migration.

- [ ] **Step 4: Implement the operation ledger and lifecycle RPCs**

Put the following complete SQL in the generated migration:

```sql
alter table public.user_permission_grants
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.users(id) on delete set null,
  add column if not exists revoked_reason text;

create table if not exists app_private.user_account_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  target_user_id uuid not null references public.users(id) on delete restrict,
  requested_by uuid not null references public.users(id) on delete restrict,
  action text not null check (action in ('DISABLE', 'REACTIVATE')),
  status text not null default 'PREPARED'
    check (status in ('PREPARED', 'DB_APPLIED', 'AUTH_RETRY', 'COMPLETED')),
  reason text not null,
  auth_id uuid,
  before_state jsonb not null default '{}'::jsonb,
  auth_result jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

revoke all on table app_private.user_account_operations from public, anon, authenticated;

create unique index if not exists ux_user_account_operations_unfinished
  on app_private.user_account_operations (target_user_id, action)
  where status <> 'COMPLETED';

alter table public.users
  add column if not exists account_operation_status text not null default 'IDLE',
  add column if not exists account_operation_action text;

alter table public.users
  drop constraint if exists users_account_operation_status_check,
  drop constraint if exists users_account_operation_consistency_check;

alter table public.users
  add constraint users_account_operation_status_check
    check (account_operation_status in ('IDLE', 'PENDING', 'AUTH_RETRY')),
  add constraint users_account_operation_consistency_check
    check (
      (account_operation_status = 'IDLE' and account_operation_action is null)
      or (
        account_operation_status in ('PENDING', 'AUTH_RETRY')
        and account_operation_action in ('DISABLE', 'REACTIVATE')
      )
    );

create or replace function app_private.guard_user_account_lifecycle_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_status is distinct from new.account_status
    or old.disabled_at is distinct from new.disabled_at
    or old.disabled_by is distinct from new.disabled_by
    or old.disabled_reason is distinct from new.disabled_reason
    or old.reactivated_at is distinct from new.reactivated_at
    or old.reactivated_by is distinct from new.reactivated_by
    or old.reactivation_reason is distinct from new.reactivation_reason
    or old.account_operation_status is distinct from new.account_operation_status
    or old.account_operation_action is distinct from new.account_operation_action
  then
    if (select auth.role()) = 'service_role'
      and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
    then
      return new;
    end if;

    raise exception 'Account lifecycle metadata can only be changed by the trusted command'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_user_account_lifecycle_metadata()
  from public, anon, authenticated;

create or replace function app_private.assert_active_principal(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and u.is_active
      and u.account_status = 'ACTIVE'
  ) then
    raise exception 'Active application principal required'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function app_private.assert_active_principal(uuid) from public, anon, authenticated;

create or replace function app_private.guard_user_permission_grant_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active then
    perform app_private.assert_active_principal(new.user_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_responsibility_slot_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform app_private.assert_active_principal(new.assignee_user_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_assignment_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform app_private.assert_active_principal(new.principal_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_project_staff_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if new.end_date is null then
    select u.id into v_user_id
    from public.users u
    where u.id::text = new.user_id
    limit 1;
    perform app_private.assert_active_principal(v_user_id);
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_project_staff_permission_principal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if coalesce(new.is_active, true) then
    select u.id into v_user_id
    from public.project_staff ps
    join public.users u on u.id::text = ps.user_id
    where ps.id = new.staff_id
    limit 1;
    perform app_private.assert_active_principal(v_user_id);
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_user_permission_grant_principal() from public, anon, authenticated;
revoke all on function app_private.guard_responsibility_slot_principal() from public, anon, authenticated;
revoke all on function app_private.guard_assignment_principal() from public, anon, authenticated;
revoke all on function app_private.guard_project_staff_principal() from public, anon, authenticated;
revoke all on function app_private.guard_project_staff_permission_principal() from public, anon, authenticated;

drop trigger if exists trg_user_permission_grants_active_principal on public.user_permission_grants;
create trigger trg_user_permission_grants_active_principal
  before insert or update of user_id, is_active on public.user_permission_grants
  for each row execute function app_private.guard_user_permission_grant_principal();

drop trigger if exists trg_app_responsibility_slots_active_principal on public.app_responsibility_slots;
create trigger trg_app_responsibility_slots_active_principal
  before insert or update of assignee_user_id, status on public.app_responsibility_slots
  for each row execute function app_private.guard_responsibility_slot_principal();

drop trigger if exists trg_app_assignments_active_principal on public.app_assignments;
create trigger trg_app_assignments_active_principal
  before insert or update of principal_id, status on public.app_assignments
  for each row execute function app_private.guard_assignment_principal();

drop trigger if exists trg_project_staff_active_principal on public.project_staff;
create trigger trg_project_staff_active_principal
  before insert or update of user_id, end_date on public.project_staff
  for each row execute function app_private.guard_project_staff_principal();

drop trigger if exists trg_project_staff_permissions_active_principal on public.project_staff_permissions;
create trigger trg_project_staff_permissions_active_principal
  before insert or update of staff_id, is_active on public.project_staff_permissions
  for each row execute function app_private.guard_project_staff_permission_principal();

create or replace function app_private.assert_legacy_system_admin(p_actor_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.users u
    where u.id = p_actor_user_id
      and u.role = 'ADMIN'
      and u.is_active
      and u.account_status = 'ACTIVE'
  ) then
    raise exception 'Active System Admin required'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function app_private.assert_legacy_system_admin(uuid) from public, anon, authenticated;

create or replace function app_private.revoke_user_access_sources(
  p_target_user_id uuid,
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot public.app_responsibility_slots%rowtype;
  v_assignment public.app_assignments%rowtype;
  v_direct_grants integer := 0;
  v_project_permissions integer := 0;
  v_project_staff integer := 0;
  v_slots integer := 0;
  v_assignments integer := 0;
begin
  update public.user_permission_grants
  set is_active = false,
      revoked_at = coalesce(revoked_at, now()),
      revoked_by = coalesce(revoked_by, p_actor_user_id),
      revoked_reason = coalesce(revoked_reason, p_reason),
      updated_at = now()
  where user_id = p_target_user_id
    and is_active;
  get diagnostics v_direct_grants = row_count;

  update public.project_staff_permissions psp
  set is_active = false
  from public.project_staff ps
  where psp.staff_id = ps.id
    and ps.user_id = p_target_user_id::text
    and coalesce(psp.is_active, true);
  get diagnostics v_project_permissions = row_count;

  update public.project_staff
  set end_date = current_date,
      updated_at = now()
  where user_id = p_target_user_id::text
    and end_date is null;
  get diagnostics v_project_staff = row_count;

  for v_slot in
    select *
    from public.app_responsibility_slots
    where assignee_user_id = p_target_user_id
      and status = 'active'
    for update
  loop
    update public.app_responsibility_slots
    set status = 'inactive',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'needsReassignment', true,
          'accountOperationId', p_operation_id
        ),
        updated_at = now()
    where id = v_slot.id;

    insert into public.app_responsibility_slot_events (
      responsibility_slot_id,
      event_type,
      actor_user_id,
      before_data,
      after_data
    )
    select
      v_slot.id,
      'updated',
      p_actor_user_id,
      to_jsonb(v_slot),
      to_jsonb(updated_slot)
    from public.app_responsibility_slots updated_slot
    where updated_slot.id = v_slot.id;

    v_slots := v_slots + 1;
  end loop;

  for v_assignment in
    select *
    from public.app_assignments
    where principal_id = p_target_user_id
      and status = 'active'
    for update
  loop
    update public.app_assignments
    set status = 'closed',
        closed_at = now(),
        closed_by = p_actor_user_id,
        close_reason = 'account_disabled',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'needsReassignment', true,
          'accountOperationId', p_operation_id
        ),
        updated_at = now()
    where id = v_assignment.id;

    insert into public.app_assignment_events (
      assignment_id,
      event_type,
      actor_user_id,
      metadata
    )
    values (
      v_assignment.id,
      'closed',
      p_actor_user_id,
      jsonb_build_object(
        'reason', 'account_disabled',
        'needsReassignment', true,
        'operationId', p_operation_id
      )
    );

    v_assignments := v_assignments + 1;
  end loop;

  return jsonb_build_object(
    'directGrants', v_direct_grants,
    'projectPermissions', v_project_permissions,
    'projectStaffAssignments', v_project_staff,
    'responsibilitySlots', v_slots,
    'runtimeAssignments', v_assignments,
    'needsReassignment', v_slots + v_assignments
  );
end;
$$;

revoke all on function app_private.revoke_user_access_sources(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function app_private.account_operation_response(
  p_operation app_private.user_account_operations
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'operationId', p_operation.id,
    'idempotencyKey', p_operation.idempotency_key,
    'targetUserId', p_operation.target_user_id,
    'requestedBy', p_operation.requested_by,
    'action', p_operation.action,
    'status', p_operation.status,
    'reason', p_operation.reason,
    'authId', p_operation.auth_id,
    'authResult', p_operation.auth_result,
    'revocationSummary', p_operation.before_state -> 'revocationSummary',
    'lastError', p_operation.last_error,
    'createdAt', p_operation.created_at,
    'updatedAt', p_operation.updated_at,
    'completedAt', p_operation.completed_at
  );
$$;

revoke all on function app_private.account_operation_response(app_private.user_account_operations) from public, anon, authenticated;

create or replace function public.get_user_account_lifecycle_preview(
  p_target_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_result jsonb;
begin
  perform app_private.assert_legacy_system_admin(v_actor_user_id);

  select jsonb_build_object(
    'targetUserId', u.id,
    'accountStatus', u.account_status,
    'operationStatus', u.account_operation_status,
    'operationAction', u.account_operation_action,
    'hasAuthIdentity', u.auth_id is not null,
    'directGrants', (
      select count(*) from public.user_permission_grants g
      where g.user_id = u.id and g.is_active
    ),
    'legacyModules', cardinality(coalesce(u.allowed_modules, '{}'::text[]))
      + cardinality(coalesce(u.admin_modules, '{}'::text[])),
    'projectStaffAssignments', (
      select count(*) from public.project_staff ps
      where ps.user_id = u.id::text and ps.end_date is null
    ),
    'responsibilitySlots', (
      select count(*) from public.app_responsibility_slots slot
      where slot.assignee_user_id = u.id and slot.status = 'active'
    ),
    'runtimeAssignments', (
      select count(*) from public.app_assignments assignment_row
      where assignment_row.principal_id = u.id and assignment_row.status = 'active'
    )
  )
  into v_result
  from public.users u
  where u.id = p_target_user_id;

  if v_result is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_user_account_lifecycle_preview(uuid) from public, anon;
grant execute on function public.get_user_account_lifecycle_preview(uuid) to authenticated;

create or replace function public.prepare_user_account_lifecycle(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_operation app_private.user_account_operations%rowtype;
  v_target public.users%rowtype;
  v_before_grants jsonb := '[]'::jsonb;
  v_revocation_summary jsonb := '{}'::jsonb;
begin
  perform app_private.assert_legacy_system_admin(p_actor_user_id);

  if v_action not in ('DISABLE', 'REACTIVATE') then
    raise exception 'Unsupported account lifecycle action'
      using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 then
    raise exception 'Account lifecycle reason must contain at least 5 characters'
      using errcode = '22023';
  end if;

  select * into v_target
  from public.users
  where id = p_target_user_id
  for update;

  if v_target.id is null then
    raise exception 'Target user does not exist'
      using errcode = 'P0002';
  end if;

  select * into v_operation
  from app_private.user_account_operations
  where idempotency_key = p_idempotency_key
  for update;

  if v_operation.id is not null then
    if v_operation.target_user_id <> p_target_user_id
      or v_operation.action <> v_action
      or v_operation.requested_by <> p_actor_user_id
      or v_operation.reason <> v_reason
    then
      raise exception 'Idempotency key is already used for another command'
        using errcode = '23505';
    end if;
    return app_private.account_operation_response(v_operation);
  end if;

  -- A fresh browser command may safely resume an unfinished Auth step.
  select * into v_operation
  from app_private.user_account_operations
  where target_user_id = p_target_user_id
    and action = v_action
    and status <> 'COMPLETED'
  order by created_at
  limit 1
  for update;

  if v_operation.id is not null then
    return app_private.account_operation_response(v_operation);
  end if;

  if v_action = 'DISABLE' then
    if p_actor_user_id = p_target_user_id then
      raise exception 'Cannot disable the current account'
        using errcode = '42501';
    end if;
    if v_target.is_active and v_target.role = 'ADMIN' and not exists (
      select 1
      from public.users other_admin
      where other_admin.id <> p_target_user_id
        and other_admin.role = 'ADMIN'
        and other_admin.is_active
        and other_admin.account_status = 'ACTIVE'
    ) then
      raise exception 'Cannot disable the last active System Admin'
        using errcode = '42501';
    end if;
  else
    if v_target.is_active or v_target.account_status = 'ACTIVE' then
      raise exception 'Target account is already active'
        using errcode = '22023';
    end if;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(g) order by g.permission_code, g.scope_type, g.scope_id),
    '[]'::jsonb
  )
  into v_before_grants
  from public.user_permission_grants g
  where g.user_id = p_target_user_id
    and g.is_active;

  insert into app_private.user_account_operations (
    idempotency_key,
    target_user_id,
    requested_by,
    action,
    status,
    reason,
    auth_id,
    before_state
  )
  values (
    p_idempotency_key,
    p_target_user_id,
    p_actor_user_id,
    v_action,
    'PREPARED',
    v_reason,
    v_target.auth_id,
    jsonb_build_object(
      'role', v_target.role,
      'assignedWarehouseId', v_target.assigned_warehouse_id,
      'allowedModules', v_target.allowed_modules,
      'adminModules', v_target.admin_modules,
      'allowedSubModules', v_target.allowed_sub_modules,
      'adminSubModules', v_target.admin_sub_modules,
      'permissionGrants', v_before_grants
    )
  )
  returning * into v_operation;

  perform set_config('app.account_lifecycle_command', 'on', true);

  if v_action = 'DISABLE' then
    update public.users
    set account_status = 'DISABLED',
        is_active = false,
        disabled_at = case when v_target.is_active then now() else disabled_at end,
        disabled_by = case when v_target.is_active then p_actor_user_id else disabled_by end,
        disabled_reason = case when v_target.is_active then v_reason else disabled_reason end,
        role = 'EMPLOYEE',
        assigned_warehouse_id = null,
        allowed_modules = '{}'::text[],
        admin_modules = '{}'::text[],
        allowed_sub_modules = '{}'::jsonb,
        admin_sub_modules = '{}'::jsonb,
        account_operation_status = 'PENDING',
        account_operation_action = 'DISABLE',
        updated_at = now()
    where id = p_target_user_id;
  else
    update public.users
    set account_operation_status = 'PENDING',
        account_operation_action = 'REACTIVATE',
        updated_at = now()
    where id = p_target_user_id;
  end if;

  v_revocation_summary := app_private.revoke_user_access_sources(
    p_target_user_id,
    p_actor_user_id,
    v_operation.id,
    case
      when v_action = 'DISABLE' then 'account_disabled: ' || v_reason
      else 'reactivation_zero_rights_guard: ' || v_reason
    end
  );

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    p_actor_user_id,
    p_target_user_id,
    case
      when v_action = 'DISABLE' then 'account_disabled_db_applied'
      else 'account_reactivation_prepared_zero_rights'
    end,
    v_before_grants,
    '[]'::jsonb,
    jsonb_build_object(
      'operationId', v_operation.id,
      'reason', v_reason,
      'revocationSummary', v_revocation_summary
    )
  );

  update app_private.user_account_operations
  set status = 'DB_APPLIED',
      before_state = before_state || jsonb_build_object(
        'revocationSummary', v_revocation_summary
      ),
      updated_at = now()
  where id = v_operation.id
  returning * into v_operation;

  return app_private.account_operation_response(v_operation);
end;
$$;

revoke all on function public.prepare_user_account_lifecycle(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.prepare_user_account_lifecycle(uuid, uuid, text, text, uuid) to service_role;

create or replace function public.complete_user_account_lifecycle(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_auth_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation app_private.user_account_operations%rowtype;
  v_final_revocation_summary jsonb := '{}'::jsonb;
begin
  perform app_private.assert_legacy_system_admin(p_actor_user_id);

  select * into v_operation
  from app_private.user_account_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception 'Account lifecycle operation does not exist'
      using errcode = 'P0002';
  end if;
  if v_operation.status = 'COMPLETED' then
    return app_private.account_operation_response(v_operation);
  end if;
  if v_operation.status not in ('DB_APPLIED', 'AUTH_RETRY') then
    raise exception 'Account lifecycle operation is not ready for completion'
      using errcode = '55000';
  end if;

  -- Close anything created between prepare and Auth completion before activation.
  v_final_revocation_summary := app_private.revoke_user_access_sources(
    v_operation.target_user_id,
    p_actor_user_id,
    v_operation.id,
    'account_lifecycle_final_sweep: ' || v_operation.reason
  );

  perform set_config('app.account_lifecycle_command', 'on', true);

  if v_operation.action = 'REACTIVATE' then
    update public.users
    set account_status = 'ACTIVE',
        is_active = true,
        role = 'EMPLOYEE',
        assigned_warehouse_id = null,
        allowed_modules = '{}'::text[],
        admin_modules = '{}'::text[],
        allowed_sub_modules = '{}'::jsonb,
        admin_sub_modules = '{}'::jsonb,
        reactivated_at = now(),
        reactivated_by = p_actor_user_id,
        reactivation_reason = v_operation.reason,
        account_operation_status = 'IDLE',
        account_operation_action = null,
        updated_at = now()
    where id = v_operation.target_user_id;
  else
    update public.users
    set account_operation_status = 'IDLE',
        account_operation_action = null,
        updated_at = now()
    where id = v_operation.target_user_id;
  end if;

  update app_private.user_account_operations
  set status = 'COMPLETED',
      auth_result = coalesce(p_auth_result, '{}'::jsonb),
      last_error = null,
      updated_at = now(),
      completed_at = now()
  where id = v_operation.id
  returning * into v_operation;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    p_actor_user_id,
    v_operation.target_user_id,
    case
      when v_operation.action = 'REACTIVATE' then 'account_reactivated_zero_rights'
      else 'account_disabled_auth_completed'
    end,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'operationId', v_operation.id,
      'reason', v_operation.reason,
      'authResult', coalesce(p_auth_result, '{}'::jsonb),
      'finalRevocationSummary', v_final_revocation_summary
    )
  );

  return app_private.account_operation_response(v_operation);
end;
$$;

revoke all on function public.complete_user_account_lifecycle(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_user_account_lifecycle(uuid, uuid, jsonb) to service_role;

create or replace function public.fail_user_account_lifecycle(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation app_private.user_account_operations%rowtype;
begin
  perform app_private.assert_legacy_system_admin(p_actor_user_id);

  select * into v_operation
  from app_private.user_account_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception 'Account lifecycle operation does not exist'
      using errcode = 'P0002';
  end if;

  if v_operation.status <> 'COMPLETED' then
    perform set_config('app.account_lifecycle_command', 'on', true);

    update app_private.user_account_operations
    set status = 'AUTH_RETRY',
        last_error = left(coalesce(p_error, 'Unknown Auth orchestration error'), 1000),
        updated_at = now()
    where id = p_operation_id
    returning * into v_operation;

    update public.users
    set account_operation_status = 'AUTH_RETRY',
        account_operation_action = v_operation.action,
        updated_at = now()
    where id = v_operation.target_user_id;

    insert into public.permission_audit_events (
      actor_user_id,
      target_user_id,
      event_type,
      before_grants,
      after_grants,
      metadata
    )
    values (
      p_actor_user_id,
      v_operation.target_user_id,
      'account_auth_retry_required',
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_object(
        'operationId', v_operation.id,
        'action', v_operation.action
      )
    );
  end if;

  return app_private.account_operation_response(v_operation);
end;
$$;

revoke all on function public.fail_user_account_lifecycle(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_user_account_lifecycle(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
```

- [ ] **Step 5: Add lifecycle runtime smoke coverage**

Create `supabase/tests/user_account_lifecycle_smoke.sql`:

```sql
do $$
begin
  if to_regprocedure('public.prepare_user_account_lifecycle(uuid,uuid,text,text,uuid)') is null then
    raise exception 'Missing prepare lifecycle RPC';
  end if;
  if has_function_privilege('authenticated', 'public.prepare_user_account_lifecycle(uuid,uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'authenticated can execute prepare lifecycle RPC';
  end if;
  if not has_function_privilege('authenticated', 'public.get_user_account_lifecycle_preview(uuid)', 'EXECUTE') then
    raise exception 'authenticated admin cannot execute lifecycle preview RPC';
  end if;
end;
$$;

create temp table account_lifecycle_smoke_ids (
  admin_id uuid not null,
  backup_admin_id uuid not null,
  target_id uuid not null,
  disable_key uuid not null,
  reactivate_key uuid not null,
  disable_operation_id uuid,
  reactivate_operation_id uuid
) on commit drop;

insert into account_lifecycle_smoke_ids
values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), null, null
);

grant select, update on account_lifecycle_smoke_ids to authenticated, service_role;

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select admin_id, 'Lifecycle Admin', 'lifecycle-admin@vioo.local', 'lifecycle-admin',
       'ADMIN'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from account_lifecycle_smoke_ids
union all
select backup_admin_id, 'Lifecycle Backup Admin', 'lifecycle-backup@vioo.local', 'lifecycle-backup',
       'ADMIN'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from account_lifecycle_smoke_ids
union all
select target_id, 'Lifecycle Target', 'lifecycle-target@vioo.local', 'lifecycle-target',
       'WAREHOUSE_KEEPER'::public.user_role, true, 'ACTIVE', array['WMS'], array['WMS'],
       '{"WMS":["/wms"]}'::jsonb, '{"WMS":["/wms"]}'::jsonb
from account_lifecycle_smoke_ids;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active
)
select target_id, 'system.wms.view', 'global', '*', true
from account_lifecycle_smoke_ids;

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', 'lifecycle-admin@vioo.local',
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  preview jsonb;
begin
  preview := public.get_user_account_lifecycle_preview(
    (select target_id from account_lifecycle_smoke_ids)
  );
  if (preview ->> 'directGrants')::integer <> 1 then
    raise exception 'Lifecycle preview did not count active grants';
  end if;
  begin
    update public.users
    set account_operation_status = 'PENDING',
        account_operation_action = 'DISABLE'
    where id = (select admin_id from account_lifecycle_smoke_ids);
    raise exception 'Authenticated admin changed lifecycle operation metadata directly';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set role service_role;

update account_lifecycle_smoke_ids
set disable_operation_id = (
  public.prepare_user_account_lifecycle(
    admin_id,
    target_id,
    'DISABLE',
    'Nhân viên nghỉ việc',
    disable_key
  ) ->> 'operationId'
)::uuid;

select public.fail_user_account_lifecycle(
  (select admin_id from account_lifecycle_smoke_ids),
  (select disable_operation_id from account_lifecycle_smoke_ids),
  'simulated Auth outage'
);

do $$
declare
  resumed jsonb;
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and u.account_operation_status = 'AUTH_RETRY'
      and u.account_operation_action = 'DISABLE'
  ) then
    raise exception 'Auth retry state was not persisted on the target profile';
  end if;

  resumed := public.prepare_user_account_lifecycle(
    (select admin_id from account_lifecycle_smoke_ids),
    (select target_id from account_lifecycle_smoke_ids),
    'DISABLE',
    'Thử lại khóa đăng nhập',
    gen_random_uuid()
  );
  if resumed ->> 'operationId' is distinct from (
    select disable_operation_id::text
    from account_lifecycle_smoke_ids
  ) then
    raise exception 'Fresh browser retry did not resume the unfinished operation';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and (u.is_active or u.account_status <> 'DISABLED')
  ) then
    raise exception 'Target account was not disabled';
  end if;
  if exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and (
        u.role <> 'EMPLOYEE'
        or cardinality(coalesce(u.allowed_modules, '{}'::text[])) <> 0
        or cardinality(coalesce(u.admin_modules, '{}'::text[])) <> 0
      )
  ) then
    raise exception 'Legacy rights were not cleared';
  end if;
  if exists (
    select 1 from public.user_permission_grants g
    where g.user_id = (select target_id from account_lifecycle_smoke_ids)
      and g.is_active
  ) then
    raise exception 'Direct grants remained active';
  end if;
  begin
    update public.user_permission_grants
    set is_active = true
    where user_id = (select target_id from account_lifecycle_smoke_ids);
    raise exception 'Disabled principal accepted a newly active grant';
  exception
    when check_violation then null;
  end;
end;
$$;

select public.complete_user_account_lifecycle(
  (select admin_id from account_lifecycle_smoke_ids),
  (select disable_operation_id from account_lifecycle_smoke_ids),
  '{"auth":"skipped_no_identity"}'::jsonb
);

update account_lifecycle_smoke_ids
set reactivate_operation_id = (
  public.prepare_user_account_lifecycle(
    admin_id,
    target_id,
    'REACTIVATE',
    'Nhân viên quay lại làm việc',
    reactivate_key
  ) ->> 'operationId'
)::uuid;

select public.complete_user_account_lifecycle(
  (select admin_id from account_lifecycle_smoke_ids),
  (select reactivate_operation_id from account_lifecycle_smoke_ids),
  '{"auth":"unbanned"}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = (select target_id from account_lifecycle_smoke_ids)
      and u.is_active
      and u.account_status = 'ACTIVE'
      and u.role = 'EMPLOYEE'
      and u.account_operation_status = 'IDLE'
      and u.account_operation_action is null
      and cardinality(coalesce(u.allowed_modules, '{}'::text[])) = 0
      and cardinality(coalesce(u.admin_modules, '{}'::text[])) = 0
  ) then
    raise exception 'Reactivated account did not start with zero legacy rights';
  end if;
  if exists (
    select 1 from public.user_permission_grants g
    where g.user_id = (select target_id from account_lifecycle_smoke_ids)
      and g.is_active
  ) then
    raise exception 'Reactivation restored direct grants';
  end if;
end;
$$;

reset role;
delete from public.permission_audit_events
where target_user_id in (select target_id from account_lifecycle_smoke_ids);
delete from public.user_permission_grants
where user_id in (select target_id from account_lifecycle_smoke_ids);
delete from app_private.user_account_operations
where target_user_id in (select target_id from account_lifecycle_smoke_ids);
delete from public.users
where id in (
  select admin_id from account_lifecycle_smoke_ids
  union all
  select backup_admin_id from account_lifecycle_smoke_ids
  union all
  select target_id from account_lifecycle_smoke_ids
);
```

- [ ] **Step 6: Run the migration contracts and transaction dry-run**

```bash
npm test -- lib/__tests__/activeActorAccountStatusMigration.test.ts lib/__tests__/userAccountLifecycleMigration.test.ts
```

Expected: PASS.

```bash
ACTIVE_ACTOR_MIGRATION="$(rg --files supabase/migrations | rg '_active_actor_account_status\.sql$')"
ACCOUNT_LIFECYCLE_MIGRATION="$(rg --files supabase/migrations | rg '_user_account_lifecycle_operations\.sql$')"
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const files=process.argv.slice(1); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join(' '); process.stdout.write('begin; set local lock_timeout=\\'5s\\'; '+sql+' rollback;')" "$ACTIVE_ACTOR_MIGRATION" "$ACCOUNT_LIFECYCLE_MIGRATION" supabase/tests/user_account_lifecycle_smoke.sql)"
```

Expected: exit `0`; Task 1 and Task 2 schemas plus lifecycle smoke run in dependency order, then the transaction rolls back.

- [ ] **Step 7: Commit Task 2**

```bash
git add "$ACCOUNT_LIFECYCLE_MIGRATION" lib/__tests__/userAccountLifecycleMigration.test.ts supabase/tests/user_account_lifecycle_smoke.sql
git commit -m "feat(auth): add account lifecycle operations"
```

---

### Task 3: Centralize active-admin authorization for Edge Functions

**Files:**
- Create: `supabase/functions/_shared/adminAuthorization.ts`
- Modify: `supabase/functions/create-user/index.ts`
- Modify: `supabase/functions/reset-password/index.ts`
- Create: `lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts`

**Interfaces:**
- Consumes: Supabase caller JWT and service-role client.
- Produces: `getAdminClient()`, `requireActiveCaller(req, admin)`, `requireActiveAdmin(req, admin)`.

- [ ] **Step 1: Write the failing Edge authorization contract**

Create `lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const shared = readFileSync(
  join(process.cwd(), 'supabase', 'functions', '_shared', 'adminAuthorization.ts'),
  'utf8',
);
const createUser = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'create-user', 'index.ts'),
  'utf8',
);
const resetPassword = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'reset-password', 'index.ts'),
  'utf8',
);

describe('shared Edge Function admin authorization', () => {
  it('requires an active app profile and never trusts user_metadata', () => {
    expect(shared).toContain(".select('id, role, email, auth_id, is_active, account_status')");
    expect(shared).toMatch(/appUser\?\.is_active !== true/);
    expect(shared).toMatch(/appUser\?\.account_status === 'DISABLED'/);
    expect(shared).not.toMatch(/user_metadata.*role|role.*user_metadata/);
    expect(shared).toContain(".eq('auth_id', authData.user.id)");
    expect(shared).toContain(".is('auth_id', null)");
    expect(shared).not.toMatch(/\.or\(filters\.join/);
  });

  it('is used by create-user and reset-password', () => {
    expect(createUser).toContain("../_shared/adminAuthorization.ts");
    expect(createUser).toContain('requireActiveAdmin');
    expect(resetPassword).toContain("../_shared/adminAuthorization.ts");
    expect(resetPassword).toContain('requireActiveCaller');
    expect(createUser).not.toMatch(/is_active:\s*profile\.isActive/);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts
```

Expected: FAIL because the shared module does not exist.

- [ ] **Step 3: Implement the shared authorization module**

Create `supabase/functions/_shared/adminAuthorization.ts`:

```ts
import { createClient, type SupabaseClient, type User as AuthUser } from '@supabase/supabase-js';

export class EdgeAuthorizationError extends Error {
  constructor(message: string, public readonly status = 403) {
    super(message);
    this.name = 'EdgeAuthorizationError';
  }
}

export type ActiveAppCaller = {
  authUser: AuthUser;
  appUser: {
    id: string;
    role: string;
    email: string | null;
    auth_id: string | null;
    is_active: boolean;
    account_status: 'ACTIVE' | 'DISABLED';
  };
  isAdmin: boolean;
};

export const getAdminClient = (): SupabaseClient => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
};

export const requireActiveCaller = async (
  req: Request,
  admin: SupabaseClient,
): Promise<ActiveAppCaller> => {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new EdgeAuthorizationError('Missing authorization token', 401);

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    throw new EdgeAuthorizationError('Invalid authorization token', 401);
  }

  const columns = 'id, role, email, auth_id, is_active, account_status';
  const { data: linkedProfile, error: linkedProfileError } = await admin
    .from('users')
    .select(columns)
    .eq('auth_id', authData.user.id)
    .maybeSingle();
  if (linkedProfileError) throw linkedProfileError;

  let appUser = linkedProfile;
  if (!appUser && authData.user.email) {
    const { data: unlinkedProfiles, error: unlinkedProfileError } = await admin
      .from('users')
      .select(columns)
      .is('auth_id', null)
      .eq('email', authData.user.email.toLowerCase())
      .limit(2);
    if (unlinkedProfileError) throw unlinkedProfileError;
    if ((unlinkedProfiles || []).length > 1) {
      throw new EdgeAuthorizationError('Ambiguous application profile');
    }
    appUser = unlinkedProfiles?.[0] || null;
  }

  if (!appUser) throw new EdgeAuthorizationError('Active application profile required');
  if (appUser.is_active !== true || appUser.account_status === 'DISABLED') {
    throw new EdgeAuthorizationError('Application account is disabled');
  }

  return {
    authUser: authData.user,
    appUser,
    isAdmin: appUser.role === 'ADMIN',
  };
};

export const requireActiveAdmin = async (
  req: Request,
  admin: SupabaseClient,
): Promise<ActiveAppCaller> => {
  const caller = await requireActiveCaller(req, admin);
  if (!caller.isAdmin) throw new EdgeAuthorizationError('Admin permission required');
  return caller;
};
```

- [ ] **Step 4: Replace duplicated guards in existing Edge Functions**

In `supabase/functions/create-user/index.ts`, replace the local client/admin resolver with:

```ts
import {
  EdgeAuthorizationError,
  getAdminClient,
  requireActiveAdmin,
} from '../_shared/adminAuthorization.ts';
```

Call:

```ts
const admin = getAdminClient();
await requireActiveAdmin(req, admin);
```

Remove `is_active: profile.isActive ?? true` from the `create-user` profile upsert. New profiles use the DB default; disabled profiles can only return to active through `manage-user-account`.

In `supabase/functions/reset-password/index.ts`, replace the local client/caller resolver with:

```ts
import {
  EdgeAuthorizationError,
  getAdminClient,
  requireActiveCaller,
} from '../_shared/adminAuthorization.ts';
```

Call:

```ts
const admin = getAdminClient();
const caller = await requireActiveCaller(req, admin);
```

Replace `caller.appUser?.role === 'ADMIN'` with `caller.isAdmin`.

In each catch block, derive status without exposing database/Auth internals:

```ts
const status = error instanceof EdgeAuthorizationError ? error.status : 400;
const publicMessage = error instanceof EdgeAuthorizationError
  ? error.message
  : 'Không thể xử lý yêu cầu tài khoản.';
return json({ error: publicMessage }, status);
```

- [ ] **Step 5: Run targeted Edge contracts**

```bash
npm test -- lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts lib/__tests__/createUserEdgeFunctionContract.test.ts
npm run lint
```

Expected: all targeted tests PASS and TypeScript exits `0`.

- [ ] **Step 6: Commit Task 3**

```bash
git add supabase/functions/_shared/adminAuthorization.ts supabase/functions/create-user/index.ts supabase/functions/reset-password/index.ts lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts
git commit -m "refactor(auth): share active admin edge guard"
```

---

### Task 4: Implement the trusted account lifecycle Edge orchestrator

**Files:**
- Create: `supabase/functions/manage-user-account/index.ts`
- Create: `lib/__tests__/manageUserAccountEdgeFunctionContract.test.ts`

**Interfaces:**
- Consumes: shared `requireActiveAdmin`, lifecycle RPCs from Task 2, Auth Admin `updateUserById`.
- Produces: POST body `{ action, targetUserId, reason, idempotencyKey, newPassword? }` and `UserAccountOperationResult` JSON.

- [ ] **Step 1: Write the failing orchestrator contract**

Create `lib/__tests__/manageUserAccountEdgeFunctionContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'manage-user-account', 'index.ts'),
  'utf8',
);

describe('manage-user-account Edge Function contract', () => {
  it('authorizes the caller and never accepts actor identity from the body', () => {
    expect(source).toContain('requireActiveAdmin');
    expect(source).toContain('caller.appUser.id');
    expect(source).not.toMatch(/body\.(actor|actorUserId|requestedBy)/);
  });

  it('prepares DB first for disable and completes DB last for reactivate', () => {
    const prepare = source.indexOf("admin.rpc('prepare_user_account_lifecycle'");
    const authUpdate = source.indexOf('admin.auth.admin.updateUserById');
    const complete = source.indexOf("admin.rpc('complete_user_account_lifecycle'");
    expect(prepare).toBeGreaterThanOrEqual(0);
    expect(authUpdate).toBeGreaterThan(prepare);
    expect(complete).toBeGreaterThan(authUpdate);
  });

  it('rotates the password while banning and requires a new password when reactivating', () => {
    expect(source).toContain("ban_duration: '876000h'");
    expect(source).toContain("ban_duration: 'none'");
    expect(source).toContain('buildRevocationPassword');
    expect(source).toMatch(/REACTIVATE.*newPassword/s);
  });

  it('records retryable Auth failures without re-enabling the app profile', () => {
    expect(source).toContain("admin.rpc('fail_user_account_lifecycle'");
    expect(source).toMatch(/status:.*'AUTH_RETRY'/s);
    expect(source).toContain('Không thể đồng bộ trạng thái đăng nhập');
    expect(source).not.toMatch(/from\('users'\).*update/s);
  });
});
```

- [ ] **Step 2: Run the contract and verify it fails**

```bash
npm test -- lib/__tests__/manageUserAccountEdgeFunctionContract.test.ts
```

Expected: FAIL because the Edge Function file does not exist.

- [ ] **Step 3: Implement the orchestrator**

Create `supabase/functions/manage-user-account/index.ts`:

```ts
import {
  EdgeAuthorizationError,
  getAdminClient,
  requireActiveAdmin,
} from '../_shared/adminAuthorization.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

class RequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'RequestError';
  }
}

type Action = 'DISABLE' | 'REACTIVATE';
type Operation = {
  operationId: string;
  targetUserId: string;
  action: Action;
  status: 'PREPARED' | 'DB_APPLIED' | 'AUTH_RETRY' | 'COMPLETED';
  authId?: string | null;
  lastError?: string | null;
};

const isUuid = (value: string) => (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
);

const buildRevocationPassword = () => (
  `${crypto.randomUUID()}-${crypto.randomUUID()}-Aa1!`
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let admin: ReturnType<typeof getAdminClient> | null = null;
  let operation: Operation | null = null;
  let actorUserId: string | null = null;

  try {
    admin = getAdminClient();
    const caller = await requireActiveAdmin(req, admin);
    actorUserId = caller.appUser.id;

    const body = await req.json();
    const action = String(body.action || '').trim().toUpperCase() as Action;
    const targetUserId = String(body.targetUserId || '').trim();
    const reason = String(body.reason || '').trim();
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    const newPassword = body.newPassword ? String(body.newPassword) : '';

    if (!['DISABLE', 'REACTIVATE'].includes(action)) {
      throw new RequestError('Unsupported account lifecycle action');
    }
    if (!isUuid(targetUserId) || !isUuid(idempotencyKey)) {
      throw new RequestError('Invalid target user or idempotency key');
    }
    if (reason.length < 5) {
      throw new RequestError('Reason must contain at least 5 characters');
    }
    if (action === 'REACTIVATE' && newPassword.length < 8) {
      throw new RequestError('A new password with at least 8 characters is required');
    }

    const { data: prepared, error: prepareError } = await admin.rpc(
      'prepare_user_account_lifecycle',
      {
        p_actor_user_id: caller.appUser.id,
        p_target_user_id: targetUserId,
        p_action: action,
        p_reason: reason,
        p_idempotency_key: idempotencyKey,
      },
    );
    if (prepareError) throw prepareError;
    operation = prepared as Operation;
    if (!operation?.operationId) {
      throw new Error('Lifecycle prepare RPC returned no operation');
    }
    if (operation.status === 'COMPLETED') return json(operation);

    if (!operation.authId) {
      if (action === 'REACTIVATE') {
        throw new RequestError('Target profile has no linked Supabase Auth identity', 409);
      }
    } else {
      const attributes = action === 'DISABLE'
        ? {
          ban_duration: '876000h',
          password: buildRevocationPassword(),
        }
        : {
          ban_duration: 'none',
          password: newPassword,
        };

      const { error: authError } = await admin.auth.admin.updateUserById(
        operation.authId,
        attributes,
      );
      if (authError) throw authError;
    }

    const { data: completed, error: completeError } = await admin.rpc(
      'complete_user_account_lifecycle',
      {
        p_actor_user_id: caller.appUser.id,
        p_operation_id: operation.operationId,
        p_auth_result: operation.authId
          ? { auth: action === 'DISABLE' ? 'banned_password_rotated' : 'unbanned_password_reset' }
          : { auth: 'skipped_no_identity' },
      },
    );
    if (completeError) throw completeError;

    return json(completed);
  } catch (error) {
    const internalMessage = error instanceof Error
      ? error.message
      : 'Unknown account lifecycle error';
    let retryOperation: Operation | null = null;

    if (admin && operation?.operationId && actorUserId) {
      const { data: failedOperation } = await admin.rpc('fail_user_account_lifecycle', {
        p_actor_user_id: actorUserId,
        p_operation_id: operation.operationId,
        p_error: internalMessage,
      });
      retryOperation = failedOperation as Operation | null;
    }

    const status = error instanceof EdgeAuthorizationError
      ? error.status
      : error instanceof RequestError
        ? error.status
        : operation
          ? 502
          : 400;
    const publicMessage = error instanceof EdgeAuthorizationError || error instanceof RequestError
      ? internalMessage
      : 'Không thể đồng bộ trạng thái đăng nhập. Vui lòng thử lại thao tác này.';
    return json({
      error: publicMessage,
      operationId: operation?.operationId || null,
      action: operation?.action || null,
      status: retryOperation?.status === 'AUTH_RETRY' ? 'AUTH_RETRY' : null,
    }, status);
  }
});
```

The password rotation is intentional: Supabase documents `ban_duration` for blocking sign-in, while the Auth server source logs out all sessions when an admin password update is applied. Never return or log `buildRevocationPassword()` output. Reference during implementation review:

- `https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid`
- `https://supabase.com/docs/guides/auth/sessions`
- `https://github.com/supabase/auth/blob/master/internal/models/user.go`

- [ ] **Step 4: Run targeted contracts and type-check**

```bash
npm test -- lib/__tests__/manageUserAccountEdgeFunctionContract.test.ts lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts
npm run lint
```

Expected: PASS and TypeScript exit `0`.

- [ ] **Step 5: Commit Task 4**

```bash
git add supabase/functions/manage-user-account/index.ts lib/__tests__/manageUserAccountEdgeFunctionContract.test.ts
git commit -m "feat(auth): orchestrate account suspension"
```

---

### Task 5: Add frontend account lifecycle types and service

**Files:**
- Modify: `types.ts:60-95`
- Modify: `context/authState.ts:270-300`
- Modify: `context/AppContext.tsx:60-85`
- Create: `lib/userAccountLifecycleService.ts`
- Create: `lib/__tests__/userAccountLifecycleService.test.ts`

**Interfaces:**
- Consumes: lifecycle preview RPC and `manage-user-account` Edge response.
- Produces: lifecycle status/preview/result types, `getUserAccountLifecyclePreview(target)` and `executeUserAccountLifecycle(command)`.

- [ ] **Step 1: Write failing service tests**

Create `lib/__tests__/userAccountLifecycleService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildUserAccountLifecyclePayload,
  normalizeUserAccountLifecyclePreview,
} from '../userAccountLifecycleService';

describe('buildUserAccountLifecyclePayload', () => {
  it('normalizes a disable command without a password', () => {
    expect(buildUserAccountLifecyclePayload({
      action: 'DISABLE',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      reason: '  Nhân viên nghỉ việc  ',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    })).toEqual({
      action: 'DISABLE',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      reason: 'Nhân viên nghỉ việc',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('keeps the new password only for reactivation', () => {
    expect(buildUserAccountLifecyclePayload({
      action: 'REACTIVATE',
      targetUserId: '11111111-1111-4111-8111-111111111111',
      reason: 'Nhân viên quay lại',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      newPassword: 'temporary-strong-password',
    })).toMatchObject({
      action: 'REACTIVATE',
      newPassword: 'temporary-strong-password',
    });
  });

  it('normalizes numeric preview counts and retry metadata', () => {
    expect(normalizeUserAccountLifecyclePreview({
      targetUserId: '11111111-1111-4111-8111-111111111111',
      accountStatus: 'DISABLED',
      operationStatus: 'AUTH_RETRY',
      operationAction: 'DISABLE',
      hasAuthIdentity: true,
      directGrants: '2',
      legacyModules: 1,
      projectStaffAssignments: 3,
      responsibilitySlots: 1,
      runtimeAssignments: 4,
    })).toMatchObject({
      operationStatus: 'AUTH_RETRY',
      operationAction: 'DISABLE',
      directGrants: 2,
      needsReassignment: 5,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- lib/__tests__/userAccountLifecycleService.test.ts
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Add lifecycle types to `types.ts`**

Insert before `User`:

```ts
export type UserAccountStatus = 'ACTIVE' | 'DISABLED';

export type UserAccountLifecycleAction = 'DISABLE' | 'REACTIVATE';

export type UserAccountOperationStatus = 'IDLE' | 'PENDING' | 'AUTH_RETRY';

export interface UserAccountLifecyclePreview {
  targetUserId: string;
  accountStatus: UserAccountStatus;
  operationStatus: UserAccountOperationStatus;
  operationAction?: UserAccountLifecycleAction | null;
  hasAuthIdentity: boolean;
  directGrants: number;
  legacyModules: number;
  projectStaffAssignments: number;
  responsibilitySlots: number;
  runtimeAssignments: number;
  needsReassignment: number;
}

export interface UserAccountRevocationSummary {
  directGrants: number;
  projectPermissions: number;
  projectStaffAssignments: number;
  responsibilitySlots: number;
  runtimeAssignments: number;
  needsReassignment: number;
}

export interface UserAccountOperationResult {
  operationId: string;
  idempotencyKey: string;
  targetUserId: string;
  requestedBy: string;
  action: UserAccountLifecycleAction;
  status: 'PREPARED' | 'DB_APPLIED' | 'AUTH_RETRY' | 'COMPLETED';
  reason: string;
  authId?: string | null;
  revocationSummary?: UserAccountRevocationSummary | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}
```

Add to `User` immediately after `isActive?: boolean`:

```ts
  accountStatus?: UserAccountStatus;
  accountOperationStatus?: UserAccountOperationStatus;
  accountOperationAction?: UserAccountLifecycleAction;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  reactivatedAt?: string;
  reactivatedBy?: string;
  reactivationReason?: string;
```

- [ ] **Step 4: Map lifecycle fields and stop ordinary profile writes from changing status**

Add these properties to `mapUserProfileRow()` in `context/authState.ts`:

```ts
  accountStatus: row.account_status ?? row.accountStatus ?? (row.is_active === false ? 'DISABLED' : 'ACTIVE'),
  accountOperationStatus: row.account_operation_status ?? row.accountOperationStatus ?? 'IDLE',
  accountOperationAction: row.account_operation_action ?? row.accountOperationAction ?? undefined,
  disabledAt: row.disabled_at ?? row.disabledAt ?? undefined,
  disabledBy: row.disabled_by ?? row.disabledBy ?? undefined,
  disabledReason: row.disabled_reason ?? row.disabledReason ?? undefined,
  reactivatedAt: row.reactivated_at ?? row.reactivatedAt ?? undefined,
  reactivatedBy: row.reactivated_by ?? row.reactivatedBy ?? undefined,
  reactivationReason: row.reactivation_reason ?? row.reactivationReason ?? undefined,
```

Remove this property from `userToDbPayload()` in `context/AppContext.tsx`:

```ts
is_active: data.isActive ?? true,
```

Ordinary profile updates must no longer control lifecycle status.

- [ ] **Step 5: Implement the lifecycle service**

Create `lib/userAccountLifecycleService.ts`:

```ts
import type {
  User,
  UserAccountLifecyclePreview,
  UserAccountLifecycleAction,
  UserAccountOperationResult,
} from '../types';
import { isSupabaseConfigured, supabase } from './supabase';
import { readFunctionInvokeErrorMessage } from './userAccountCreation';

export interface UserAccountLifecycleCommand {
  action: UserAccountLifecycleAction;
  targetUserId: string;
  reason: string;
  idempotencyKey: string;
  newPassword?: string;
}

export const buildUserAccountLifecyclePayload = (
  command: UserAccountLifecycleCommand,
) => ({
  action: command.action,
  targetUserId: command.targetUserId.trim(),
  reason: command.reason.trim(),
  idempotencyKey: command.idempotencyKey.trim(),
  ...(command.action === 'REACTIVATE'
    ? { newPassword: command.newPassword || '' }
    : {}),
});

const count = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const normalizeUserAccountLifecyclePreview = (
  value: Record<string, unknown>,
): UserAccountLifecyclePreview => ({
  targetUserId: String(value.targetUserId || ''),
  accountStatus: value.accountStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
  operationStatus: value.operationStatus === 'AUTH_RETRY'
    ? 'AUTH_RETRY'
    : value.operationStatus === 'PENDING'
      ? 'PENDING'
      : 'IDLE',
  operationAction: value.operationAction === 'DISABLE' || value.operationAction === 'REACTIVATE'
    ? value.operationAction
    : undefined,
  hasAuthIdentity: value.hasAuthIdentity === true,
  directGrants: count(value.directGrants),
  legacyModules: count(value.legacyModules),
  projectStaffAssignments: count(value.projectStaffAssignments),
  responsibilitySlots: count(value.responsibilitySlots),
  runtimeAssignments: count(value.runtimeAssignments),
  needsReassignment: count(value.responsibilitySlots) + count(value.runtimeAssignments),
});

export const getUserAccountLifecyclePreview = async (
  target: Pick<User, 'id' | 'authId' | 'permissionGrants' | 'allowedModules' | 'adminModules' | 'accountStatus' | 'accountOperationStatus' | 'accountOperationAction'>,
): Promise<UserAccountLifecyclePreview> => {
  if (!isSupabaseConfigured) {
    return normalizeUserAccountLifecyclePreview({
      targetUserId: target.id,
      accountStatus: target.accountStatus || 'ACTIVE',
      operationStatus: target.accountOperationStatus || 'IDLE',
      operationAction: target.accountOperationAction,
      hasAuthIdentity: true,
      directGrants: target.permissionGrants?.filter(grant => grant.isActive !== false).length || 0,
      legacyModules: (target.allowedModules?.length || 0) + (target.adminModules?.length || 0),
      projectStaffAssignments: 0,
      responsibilitySlots: 0,
      runtimeAssignments: 0,
    });
  }

  const { data, error } = await supabase.rpc('get_user_account_lifecycle_preview', {
    p_target_user_id: target.id,
  });
  if (error) throw error;
  return normalizeUserAccountLifecyclePreview(data || {});
};

export const executeUserAccountLifecycle = async (
  command: UserAccountLifecycleCommand,
): Promise<UserAccountOperationResult> => {
  if (!isSupabaseConfigured) {
    return {
      operationId: command.idempotencyKey,
      idempotencyKey: command.idempotencyKey,
      targetUserId: command.targetUserId,
      requestedBy: 'mock-admin',
      action: command.action,
      status: 'COMPLETED',
      reason: command.reason.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  const { data, error } = await supabase.functions.invoke('manage-user-account', {
    body: buildUserAccountLifecyclePayload(command),
  });
  if (error) {
    const message = await readFunctionInvokeErrorMessage(error);
    throw new Error(message || error.message || 'Không thể cập nhật trạng thái tài khoản.');
  }
  if (!data?.operationId || data?.status !== 'COMPLETED') {
    throw new Error(data?.lastError || 'Thao tác tài khoản chưa hoàn tất.');
  }
  return data as UserAccountOperationResult;
};
```

- [ ] **Step 6: Run service tests and type-check**

```bash
npm test -- lib/__tests__/userAccountLifecycleService.test.ts lib/__tests__/authBoundary.test.tsx
npm run lint
```

Expected: PASS and TypeScript exit `0`.

- [ ] **Step 7: Commit Task 5**

```bash
git add types.ts context/authState.ts context/AppContext.tsx lib/userAccountLifecycleService.ts lib/__tests__/userAccountLifecycleService.test.ts
git commit -m "feat(auth): add account lifecycle client"
```

---

### Task 6: Replace AppContext hard delete and every delete-oriented account UI

**Files:**
- Modify: `context/AppContext.tsx:95-115,1420-1455,3290-3305`
- Create: `lib/__tests__/userAccountLifecycleAppContext.test.ts`
- Create: `components/UserAccountStatusModal.tsx`
- Delete: `components/DeleteUserModal.tsx`
- Modify: `pages/UserManagement.tsx`
- Modify: `pages/Settings.tsx`
- Modify: `pages/settings/SettingsUsers.tsx`
- Create: `lib/__tests__/userAccountLifecycleUiContract.test.ts`

**Interfaces:**
- Consumes: `executeUserAccountLifecycle()` from Task 5.
- Produces: lifecycle commands returning `UserAccountOperationResult`, persistent retry UX, preview counts and no ordinary hard-delete action.

- [ ] **Step 1: Write the failing AppContext contract**

Create `lib/__tests__/userAccountLifecycleAppContext.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'context', 'AppContext.tsx'), 'utf8');

describe('AppContext account lifecycle contract', () => {
  it('exposes disable/reactivate commands and removes hard-delete user behavior', () => {
    expect(source).toContain('disableUserAccount:');
    expect(source).toContain('reactivateUserAccount:');
    expect(source).toContain('executeUserAccountLifecycle');
    expect(source).not.toContain('removeUser: (userId: string)');
    expect(source).not.toMatch(/from\('users'\)\.delete\(\)\.eq\('id', id\)/);
  });
});
```

- [ ] **Step 2: Run the contract and verify it fails**

```bash
npm test -- lib/__tests__/userAccountLifecycleAppContext.test.ts
```

Expected: FAIL because `removeUser` still exists.

- [ ] **Step 3: Change the AppContext interface and imports**

Import:

```ts
import {
  executeUserAccountLifecycle,
} from '../lib/userAccountLifecycleService';
```

Add `UserAccountOperationResult` to the existing import list from `../types`.

Replace the interface member:

```ts
removeUser: (userId: string) => Promise<void>;
```

with:

```ts
disableUserAccount: (userId: string, reason: string) => Promise<UserAccountOperationResult>;
reactivateUserAccount: (userId: string, reason: string, newPassword: string) => Promise<UserAccountOperationResult>;
```

- [ ] **Step 4: Replace the hard-delete implementation**

Replace `removeUser` with:

```ts
  const refreshManagedUser = async (id: string): Promise<User> => {
    if (!isSupabaseConfigured) {
      const local = users.find(candidate => candidate.id === id);
      if (!local) throw new Error('Không tìm thấy tài khoản.');
      return local;
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return mapUserFromDb(data);
  };

  const disableUserAccount = async (id: string, reason: string) => {
    const target = users.find(candidate => candidate.id === id);
    if (!target) throw new Error('Không tìm thấy tài khoản cần vô hiệu hóa.');

    try {
      const result = await executeUserAccountLifecycle({
        action: 'DISABLE',
        targetUserId: id,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
      logActivity('SYSTEM', 'Vô hiệu hóa tài khoản', `Đã vô hiệu hóa tài khoản: ${target.name}`, 'DANGER');
      return result;
    } finally {
      const refreshed = isSupabaseConfigured
        ? await refreshManagedUser(id)
        : {
          ...target,
          role: Role.EMPLOYEE,
          assignedWarehouseId: undefined,
          allowedModules: [],
          adminModules: [],
          allowedSubModules: {},
          adminSubModules: {},
          permissionGrants: [],
          isActive: false,
          accountStatus: 'DISABLED' as const,
          accountOperationStatus: 'IDLE' as const,
          accountOperationAction: undefined,
          disabledReason: reason.trim(),
          disabledAt: new Date().toISOString(),
        };
      setUsers(previous => previous.map(candidate => candidate.id === id ? refreshed : candidate));
    }
  };

  const reactivateUserAccount = async (id: string, reason: string, newPassword: string) => {
    const target = users.find(candidate => candidate.id === id);
    if (!target) throw new Error('Không tìm thấy tài khoản cần khôi phục.');

    try {
      const result = await executeUserAccountLifecycle({
        action: 'REACTIVATE',
        targetUserId: id,
        reason,
        newPassword,
        idempotencyKey: crypto.randomUUID(),
      });
      logActivity('SYSTEM', 'Khôi phục tài khoản', `Đã khôi phục tài khoản: ${target.name}`, 'SUCCESS');
      return result;
    } finally {
      const refreshed = isSupabaseConfigured
        ? await refreshManagedUser(id)
        : {
          ...target,
          role: Role.EMPLOYEE,
          assignedWarehouseId: undefined,
          allowedModules: [],
          adminModules: [],
          allowedSubModules: {},
          adminSubModules: {},
          permissionGrants: [],
          isActive: true,
          accountStatus: 'ACTIVE' as const,
          accountOperationStatus: 'IDLE' as const,
          accountOperationAction: undefined,
          reactivationReason: reason.trim(),
          reactivatedAt: new Date().toISOString(),
        };
      setUsers(previous => previous.map(candidate => candidate.id === id ? refreshed : candidate));
    }
  };
```

- [ ] **Step 5: Export the new commands from the provider**

Replace `removeUser` in the provider value with:

```ts
disableUserAccount, reactivateUserAccount
```

- [ ] **Step 6: Write the failing UI contract before changing any call site**

Create `lib/__tests__/userAccountLifecycleUiContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('user account lifecycle UI contract', () => {
  it('uses lifecycle copy and has no ordinary permanent-delete action', () => {
    const modal = read('components/UserAccountStatusModal.tsx');
    const management = read('pages/UserManagement.tsx');
    const settingsPage = read('pages/Settings.tsx');
    const settings = read('pages/settings/SettingsUsers.tsx');
    const combined = `${modal}\n${management}\n${settingsPage}\n${settings}`;

    expect(combined).toContain('Vô hiệu hóa tài khoản');
    expect(combined).toContain('Khôi phục tài khoản');
    expect(combined).toContain('Quyền cũ sẽ không được khôi phục');
    expect(combined).toContain('Cần thử lại đồng bộ đăng nhập');
    expect(modal).toContain('getUserAccountLifecyclePreview');
    expect(modal).toContain('Trách nhiệm cần phân công lại');
    expect(combined).toContain('AUTH_RETRY');
    expect(combined).not.toContain('Xoá vĩnh viễn');
    expect(combined).not.toContain('Xóa vĩnh viễn');
    expect(management).toContain('disableUserAccount');
    expect(management).toContain('reactivateUserAccount');
    expect(settingsPage).toContain('disableUserAccount');
    expect(settingsPage).toContain('reactivateUserAccount');
    expect(settings).toContain('accountFilter');
    expect(combined).not.toContain('DeleteUserModal');
  });
});
```

- [ ] **Step 7: Run the UI contract and verify it fails**

```bash
npm test -- lib/__tests__/userAccountLifecycleUiContract.test.ts
```

Expected: FAIL because the new modal does not exist.

- [ ] **Step 8: Create the status modal**

Create `components/UserAccountStatusModal.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, RotateCcw, UserX, X } from 'lucide-react';
import type {
  User,
  UserAccountLifecycleAction,
  UserAccountLifecyclePreview,
} from '../types';
import { getUserAccountLifecyclePreview } from '../lib/userAccountLifecycleService';

interface UserAccountStatusModalProps {
  isOpen: boolean;
  action: UserAccountLifecycleAction;
  targetUser: User | null;
  isSaving?: boolean;
  onClose: () => void;
  onConfirm: (input: { reason: string; newPassword?: string }) => void | Promise<void>;
}

const UserAccountStatusModal: React.FC<UserAccountStatusModalProps> = ({
  isOpen,
  action,
  targetUser,
  isSaving = false,
  onClose,
  onConfirm,
}) => {
  const [reason, setReason] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [preview, setPreview] = useState<UserAccountLifecyclePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const isDisable = action === 'DISABLE';
  const isRetry = targetUser?.accountOperationStatus === 'AUTH_RETRY'
    && targetUser.accountOperationAction === action;
  const canSubmit = reason.trim().length >= 5
    && (isDisable || newPassword.length >= 8)
    && Boolean(preview)
    && !previewError
    && (isDisable || preview?.hasAuthIdentity === true)
    && !isSaving;

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setNewPassword('');
    setPreview(null);
    setPreviewError('');
    if (!targetUser) return;

    let cancelled = false;
    setIsPreviewLoading(true);
    void getUserAccountLifecyclePreview(targetUser)
      .then(value => {
        if (!cancelled) setPreview(value);
      })
      .catch(() => {
        if (!cancelled) setPreviewError('Không tải được thông tin quyền và trách nhiệm hiện hành.');
      })
      .finally(() => {
        if (!cancelled) setIsPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [action, isOpen, targetUser?.id]);

  if (!isOpen || !targetUser) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isDisable ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
              {isDisable ? <UserX size={21} /> : <RotateCcw size={21} />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">
                {isRetry
                  ? 'Thử lại đồng bộ đăng nhập'
                  : isDisable
                    ? 'Vô hiệu hóa tài khoản'
                    : 'Khôi phục tài khoản'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">{targetUser.name}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label="Đóng">
            <X size={20} className="text-slate-400" />
          </button>
        </div>

        <form
          className="space-y-4 p-5"
          onSubmit={event => {
            event.preventDefault();
            if (!canSubmit) return;
            void onConfirm({
              reason: reason.trim(),
              ...(isDisable ? {} : { newPassword }),
            });
          }}
        >
          <p className="text-sm leading-6 text-slate-600">
            {isDisable
              ? 'Tài khoản sẽ ngừng đăng nhập và toàn bộ quyền hiện hành bị thu hồi. Hồ sơ HRM và lịch sử nghiệp vụ vẫn được giữ.'
              : 'Tài khoản được mở lại với quyền nghiệp vụ bằng 0. Quyền cũ sẽ không được khôi phục.'}
          </p>

          {isRetry && (
            <div className="flex gap-2 border-y border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <span>Cần thử lại đồng bộ đăng nhập. Backend vẫn đang khóa tài khoản an toàn.</span>
            </div>
          )}

          <div className="border-y border-slate-100 py-3 text-xs text-slate-600">
            {isPreviewLoading && <span>Đang tải quyền và trách nhiệm hiện hành...</span>}
            {previewError && <span className="text-red-600">{previewError}</span>}
            {preview && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><dt>Direct grant</dt><dd className="font-bold text-slate-800">{preview.directGrants}</dd></div>
                <div><dt>Legacy module</dt><dd className="font-bold text-slate-800">{preview.legacyModules}</dd></div>
                <div><dt>Phân công dự án</dt><dd className="font-bold text-slate-800">{preview.projectStaffAssignments}</dd></div>
                <div><dt>Trách nhiệm cần phân công lại</dt><dd className="font-bold text-amber-700">{preview.needsReassignment}</dd></div>
              </dl>
            )}
          </div>

          {!isDisable && preview && !preview.hasAuthIdentity && (
            <p className="text-sm text-red-600">Tài khoản chưa liên kết Supabase Auth nên chưa thể khôi phục.</p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-bold text-slate-700">Lý do</span>
            <textarea
              value={reason}
              onChange={event => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
              required
            />
          </label>

          {!isDisable && (
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
                <KeyRound size={14} /> Mật khẩu mới
              </span>
              <input
                type="password"
                value={newPassword}
                onChange={event => setNewPassword(event.target.value)}
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                required
              />
            </label>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`flex flex-1 items-center justify-center rounded-lg px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45 ${isDisable ? 'bg-red-600' : 'bg-emerald-600'}`}
            >
              {isSaving
                ? <Loader2 size={18} className="animate-spin" />
                : isDisable
                  ? <><UserX size={17} className="mr-2" /> {isRetry ? 'Thử lại' : 'Vô hiệu hóa'}</>
                  : <><RotateCcw size={17} className="mr-2" /> {isRetry ? 'Thử lại' : 'Khôi phục'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserAccountStatusModal;
```

- [ ] **Step 9: Replace account actions in `pages/UserManagement.tsx`**

Make these exact behavioral changes:

1. Replace `Trash2` with `RotateCcw` and `UserX` imports.
2. Replace `DeleteUserModal` import with `UserAccountStatusModal`.
3. Destructure `disableUserAccount` and `reactivateUserAccount` from `useApp()`.
4. Replace delete state with:

```ts
const [accountTargetId, setAccountTargetId] = useState<string | null>(null);
const [accountAction, setAccountAction] = useState<'DISABLE' | 'REACTIVATE'>('DISABLE');
const [accountFilter, setAccountFilter] = useState<'all' | 'active' | 'disabled'>('all');
const accountTarget = users.find(candidate => candidate.id === accountTargetId) || null;
```

5. Replace delete handlers with:

```ts
const openAccountAction = (target: User, action: 'DISABLE' | 'REACTIVATE') => {
  if (target.id === currentUser.id) {
    toast.warning('Không thể tự vô hiệu hóa', 'Bạn không thể thay đổi trạng thái tài khoản đang đăng nhập.');
    return;
  }
  setAccountTargetId(target.id);
  setAccountAction(
    target.accountOperationStatus !== 'IDLE' && target.accountOperationAction
      ? target.accountOperationAction
      : action,
  );
};

const handleAccountAction = async (input: { reason: string; newPassword?: string }) => {
  if (!accountTarget) return;
  const completed = await runAccountStatusUpdate(async () => {
    const result = accountAction === 'DISABLE'
      ? await disableUserAccount(accountTarget.id, input.reason)
      : await reactivateUserAccount(accountTarget.id, input.reason, input.newPassword || '');
    if ((result.revocationSummary?.needsReassignment || 0) > 0) {
      toast.warning(
        'Cần phân công lại trách nhiệm',
        `${result.revocationSummary?.needsReassignment} trách nhiệm đã được đóng an toàn.`,
      );
    }
    return true;
  });
  if (completed) setAccountTargetId(null);
};
```

6. Rename `runDeleteUser` to `runAccountStatusUpdate` and change the `useAsyncAction` titles to neutral account-status wording.
7. Add a compact segmented filter using `all`, `active`, `disabled` and render:

```ts
const visibleUsers = users.filter(candidate => {
  const disabled = candidate.accountStatus === 'DISABLED' || candidate.isActive === false;
  if (accountFilter === 'active') return !disabled;
  if (accountFilter === 'disabled') return disabled;
  return true;
});
```

8. Map over `visibleUsers` instead of `users`.
9. Render `Vô hiệu hóa` for active users and `Khôi phục` for disabled users. If `accountOperationStatus` is `PENDING` or `AUTH_RETRY`, show a visible `Đang đồng bộ Auth` or `Cần thử lại đồng bộ đăng nhập` badge and use `accountOperationAction` for the retry action.
10. Replace `DeleteUserModal` JSX with `UserAccountStatusModal` using `accountTarget`, `accountAction` and `handleAccountAction`.

- [ ] **Step 10: Apply the same lifecycle contract to Settings**

In `pages/Settings.tsx`:

- Replace `removeUser` with `disableUserAccount` and `reactivateUserAccount` from `useApp()`.
- Store the target user ID, derive `accountTarget` from the current `users` array on every render, and keep the account action state. This ensures an `AUTH_RETRY` realtime/refresh update is visible while the modal remains open.
- Replace `handleDeleteUserClick` and `handleConfirmDeleteUser` with the same `openAccountAction` and `handleAccountAction` behavior from Step 9.
- Pass `accountTarget`, `accountAction`, `handleAccountAction` and loading state to `SettingsUsers`.

In `pages/settings/SettingsUsers.tsx`:

- Import `UserAccountStatusModal`, `RotateCcw`, and `UserX`.
- Replace delete-oriented props with:

```ts
accountTarget: User | null;
accountAction: 'DISABLE' | 'REACTIVATE';
openAccountAction: (user: User, action: 'DISABLE' | 'REACTIVATE') => void;
handleAccountAction: (input: { reason: string; newPassword?: string }) => void | Promise<void>;
isSavingAccount?: boolean;
```

- Render status badge `Đang hoạt động` or `Đã vô hiệu hóa`.
- Add the same compact `all/active/disabled` segmented filter locally in `SettingsUsers` and render its derived `visibleUsers` list.
- Render the matching `Vô hiệu hóa` or `Khôi phục` action.
- Replace `DeleteUserModal` with `UserAccountStatusModal`.

Delete `components/DeleteUserModal.tsx` after both call sites compile.

- [ ] **Step 11: Run both context/UI contracts, all auth tests, lint and build**

```bash
npm test -- lib/__tests__/userAccountLifecycleUiContract.test.ts lib/__tests__/userAccountLifecycleAppContext.test.ts lib/__tests__/userAccountLifecycleService.test.ts lib/__tests__/authBoundary.test.tsx
npm run lint
npm run build
```

Expected: all tests PASS, TypeScript exits `0`, Vite build exits `0`.

- [ ] **Step 12: Commit the complete AppContext and UI replacement atomically**

```bash
git add -A context/AppContext.tsx components/UserAccountStatusModal.tsx components/DeleteUserModal.tsx pages/UserManagement.tsx pages/Settings.tsx pages/settings/SettingsUsers.tsx lib/__tests__/userAccountLifecycleAppContext.test.ts lib/__tests__/userAccountLifecycleUiContract.test.ts
git commit -m "feat(users): replace deletion with account lifecycle"
```

---

### Task 7: Verify, deploy and record active-actor/Phase 1 evidence

**Files:**
- Create: `docs/security/phase01-account-lifecycle-live-apply-log.md`
- Modify: `docs/superpowers/specs/2026-07-16-vioo-authorization-governance-migration-design.md` only if implementation evidence requires a factual clarification; do not change approved decisions.

**Interfaces:**
- Consumes: all Task 1-6 deliverables.
- Produces: atomically verified Cloud schema, deployed Edge Functions, Vercel preview/production evidence and a production canary record.

- [x] **Step 1: Run the complete local verification suite**

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all tests PASS; TypeScript and Vite exit `0`; `git diff --check` has no findings.

- [x] **Step 2: Capture the read-only Cloud baseline**

```bash
npx supabase --version
npx supabase migration list --linked
npx supabase db query --linked --agent=no -f supabase/tests/active_actor_surface_snapshot.sql
npx supabase db query --linked --agent=no "with function_row as (select p.oid, p.proacl, p.proowner from pg_proc p where p.oid = 'public.lookup_login_email(text)'::regprocedure) select exists (select 1 from function_row f cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_execute, has_function_privilege('anon', 'public.lookup_login_email(text)', 'EXECUTE') as anon_execute, has_function_privilege('authenticated', 'public.lookup_login_email(text)', 'EXECUTE') as authenticated_execute;"
```

Expected: commands succeed and all three legacy-login execute checks are `false`. Record CLI version and summary counts in `docs/security/phase01-account-lifecycle-live-apply-log.md`; do not paste secrets, JWTs, emails or full user rows.

- [x] **Step 3: Re-run both migrations and both smoke files in one rollback transaction**

```bash
ACTIVE_ACTOR_MIGRATION="$(rg --files supabase/migrations | rg '_active_actor_account_status\.sql$')"
ACCOUNT_LIFECYCLE_MIGRATION="$(rg --files supabase/migrations | rg '_user_account_lifecycle_operations\.sql$')"
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const files=process.argv.slice(1); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join(' '); process.stdout.write('begin; set local lock_timeout=\\'5s\\'; '+sql+' rollback;')" "$ACTIVE_ACTOR_MIGRATION" "$ACCOUNT_LIFECYCLE_MIGRATION" supabase/tests/active_actor_account_status_smoke.sql supabase/tests/user_account_lifecycle_smoke.sql)"
```

Expected: exit `0` and explicit rollback. Stop here if any statement fails.

- [x] **Step 4: Checkpoint before Cloud mutation**

Review together:

- Exact generated migration versions.
- Dry-run output.
- Current migration-history drift.
- Proof that `public.lookup_login_email(text)` remains revoked from `PUBLIC`, `anon` and `authenticated`.
- Rollback strategy: disable PostgREST pre-request only by a forward-fix migration, never by deleting account/history data.
- Edge Function deploy command discovered from `npx supabase functions deploy --help`.
- Exact frontend commit and confirmation that the repository uses Vercel Git integration; do not install or introduce a second hosting path.

Do not apply Cloud changes until this checkpoint is approved in the execution session.

- [x] **Step 5: Apply and verify the database migrations after checkpoint approval**

Apply both migrations in one database transaction so no partial Phase 1 schema can become visible:

```bash
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const files=process.argv.slice(1); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join(' '); process.stdout.write('begin; set local lock_timeout=\\'5s\\'; '+sql+' select \\'phase01_migrations_applied\\' as checkpoint; commit;')" "$ACTIVE_ACTOR_MIGRATION" "$ACCOUNT_LIFECYCLE_MIGRATION")"
```

Expected: exit `0`, checkpoint `phase01_migrations_applied`, and one commit. Any SQL failure rolls back both migrations.

Run both smoke files in a disposable transaction against the committed schema:

```bash
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const files=process.argv.slice(1); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join(' '); process.stdout.write('begin; set local lock_timeout=\\'5s\\'; '+sql+' select \\'phase01_smoke_passed\\' as checkpoint; rollback;')" supabase/tests/active_actor_account_status_smoke.sql supabase/tests/user_account_lifecycle_smoke.sql)"
```

Expected: exit `0`, checkpoint `phase01_smoke_passed`, and explicit rollback.

Repair only the two new versions printed in the migration filenames:

```bash
ACTIVE_ACTOR_VERSION="$(basename "$ACTIVE_ACTOR_MIGRATION" | cut -d_ -f1)"
ACCOUNT_LIFECYCLE_VERSION="$(basename "$ACCOUNT_LIFECYCLE_MIGRATION" | cut -d_ -f1)"
npx supabase migration repair "$ACTIVE_ACTOR_VERSION" --status applied --linked --workdir . --yes
npx supabase migration repair "$ACCOUNT_LIFECYCLE_VERSION" --status applied --linked --workdir . --yes
npx supabase migration list --linked
```

Expected: only those two versions are newly marked `applied`; unrelated drift remains untouched.

- [x] **Step 6: Deploy the affected Edge Functions**

First discover current CLI syntax:

```bash
npx supabase functions deploy --help
```

Then deploy only, in this order:

```bash
npx supabase functions deploy create-user --use-api
npx supabase functions deploy reset-password --use-api
npx supabase functions deploy manage-user-account --use-api
```

Expected: each deployment succeeds against the linked project. Do not deploy unrelated functions and do not pass the unsupported `--linked` flag to `functions deploy`.

- [x] **Step 7: Publish the verified frontend to a Vercel preview**

After the execution-session checkpoint explicitly approves a remote push:

```bash
git status --short
git rev-parse HEAD
git push origin refactor/module-du-an-v1
```

Expected: only intentional commits are pushed; the pre-existing local `HANDOFF_SUMMARY.md` modification is not committed. Use the repository's existing Vercel Git integration to wait for the branch preview, then record the commit SHA, preview URL and successful Vercel build in the apply log. Do not promote to production yet.

- [x] **Step 8: Run a disposable-account canary through the Vercel preview**

Use a newly created test employee account with no business records except its linked HRM fixture:

1. Sign in as the test employee and confirm ordinary app access works.
2. Keep the employee browser open so it still holds an access JWT.
3. As System Admin, disable the employee with a recorded reason.
4. In the still-open employee browser, call a normal table load and one protected RPC; both must return permission denial without waiting for JWT expiry.
5. Confirm password sign-in and refresh no longer work.
6. Confirm employee HRM row, authored fixtures and audit records still exist.
7. Confirm all direct grants are inactive, legacy arrays empty, role reset to `EMPLOYEE`, project staff ended, responsibility slots inactive and runtime assignments closed.
8. Reactivate with a new temporary password.
9. Sign in and confirm only the application shell/self-service baseline is available; no old module/business rights return.
10. Grant one new permission through the existing permission UI and confirm only that permission becomes effective.

11. Confirm the modal preview count matches active grants/responsibility rows before disable.
12. Review the automated SQL retry/resume smoke and UI `AUTH_RETRY` contract evidence; do not deliberately break Supabase Auth in the linked environment.

Expected: all twelve checks pass. Delete only disposable test fixtures that are explicitly safe to remove; do not use the ordinary account UI for permanent deletion.

- [x] **Step 9: Promote through the existing Vercel production workflow and observe**

At a second explicit checkpoint, review preview evidence and identify the configured Vercel production branch. Promote the exact canary commit through the existing Git/Vercel workflow; do not rebuild from a different tree.

For at least 24 hours after frontend rollout, record:

- `manage-user-account` invocations and failures.
- `AUTH_RETRY` operations.
- PostgREST `Active application account required` denials.
- Unexpected active-user denials.
- Orphan responsibility slots or assignments needing reassignment.

Update `docs/security/phase01-account-lifecycle-live-apply-log.md` with timestamps, commit SHA, Vercel deployment URLs, command summaries, canary results and any forward-fix migration. Never paste access tokens, passwords or service-role values.

> **Operator deferral — 2026-07-17:** Production deployment of the exact canary
> SHA succeeded, but the required 24-hour observation and Supabase Dashboard log
> review have not elapsed. The operator directed planning work for the next
> roadmap phase to proceed without representing this step as completed.

> **Operator closure — 2026-07-17:** The operator subsequently confirmed that
> Phase 1 was tested thoroughly, all Phase 1 behavior is currently OK, and the
> phase is accepted as PASS. This explicit acceptance waives the remaining
> elapsed-time/Dashboard-log collection and authorizes Phase 2 implementation;
> it does not claim that the full 24-hour evidence window was collected.

- [x] **Step 10: Final verification and commit**

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: all verification commands succeed; `HANDOFF_SUMMARY.md` remains an untouched pre-existing modification.

```bash
git add docs/security/phase01-account-lifecycle-live-apply-log.md
git commit -m "docs(auth): record account lifecycle rollout"
```

> **Operator deferral — 2026-07-17:** Final post-observation verification and
> the rollout-log commit remain outstanding. Phase 2 planning is explicitly
> authorized; this deferral is not evidence that Step 9 or Step 10 passed.

> **Operator closure — 2026-07-17:** The operator replaced the planning-only
> deferral with an explicit Phase 1 PASS acceptance after thorough manual
> testing. The current execution session reruns the repository verification
> commands before recording this closure commit.

## Active-Actor / Phase 1 Exit Gate

Do not start the Phase 2 Business Role/SoD plan until all statements below are true, except where the operator explicitly accepts equivalent evidence. On 2026-07-17 the operator accepted Phase 1 as PASS after thorough manual testing and authorized Phase 2 implementation while explicitly waiving only the unelapsed remainder of the 24-hour/Dashboard-log collection:

- Disabled account receives backend denial even with a previously issued JWT.
- Auth sign-in and token refresh are blocked after disable orchestration completes.
- HRM and business history remain unchanged.
- All direct/legacy/project responsibility sources are inactive or closed.
- Reactivation starts with zero previous business rights.
- Self-disable and last-active-admin guards are enforced in DB.
- Ordinary UI and authenticated Data API can no longer hard-delete `public.users`.
- Existing create-user and reset-password flows reject inactive callers and still pass their smoke tests.
- Full tests, lint and build pass.
- Cloud canary and 24-hour observation have evidence in the apply log.
