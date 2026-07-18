# Auth Profile Creation Command Forward-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay lần ghi profile không có command context trong `create-user` bằng RPC hẹp, đồng thời chặn `raw_user_meta_data` trở thành nguồn sửa role/quyền và hoàn tất lại canary Task 4.

**Architecture:** Auth trigger chỉ tạo/liên kết profile cơ bản từ field hiển thị an toàn. Một private `SECURITY DEFINER` command thực hiện `FINALIZE`/`ROLLBACK`; public RPC wrapper là `SECURITY INVOKER`, chỉ `service_role` có quyền gọi. Edge Function xác thực active Admin, chụp trạng thái profile có sẵn, tạo Auth user, gọi command và bù trừ trước khi xóa Auth user nếu có lỗi.

**Tech Stack:** Supabase Cloud Postgres, PL/pgSQL, Supabase Auth Admin API, Supabase Edge Functions/Deno, `@supabase/supabase-js`, Vitest, TypeScript, Supabase CLI `2.95.6`.

## Global Constraints

- Chỉ dùng Supabase Cloud; không dùng Docker, `supabase start`, `--local` hoặc local database reset.
- Không sửa migration đã apply `20260718012151_auth_profile_sync_guard_forward_fix.sql`.
- Tạo migration mới bằng `npx supabase migration new auth_profile_creation_command_forward_fix`; không tự đặt timestamp.
- Không apply/repair/deploy Cloud trước khi candidate repository và linked rollback-only gate PASS rồi operator duyệt đúng candidate SHA/version.
- Không đưa role, username, warehouse, legacy module/submodule, direct grant hoặc Business Role vào `user_metadata`/`raw_user_meta_data`.
- Không mở bypass rộng cho `service_role`; protected update chỉ chạy khi private command bật transaction-local `app.account_lifecycle_command = 'on'`.
- Private privileged implementation ở `app_private`; exposed `public` wrapper phải là `SECURITY INVOKER` và chỉ grant `EXECUTE` cho `service_role`.
- Password/token/service-role key/Auth ID/canary email không được ghi vào log, docs, test output hoặc chat.
- Không bật ba rollout flag; sensitive-null-expiry inventory phải giữ `467` trong toàn bộ forward-fix.
- Mọi production code phải có test RED được quan sát trước khi viết GREEN implementation.
- Giữ nguyên thay đổi dirty có sẵn trong `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md` và không stage nó cho đến Task cuối yêu cầu cập nhật evidence.

---

### Task 1: RED contract cho migration command và Auth-trigger hardening

**Files:**

- Create: `lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts`
- Verify: `supabase/migrations/20260716100323_harden_auth_user_profile_sync.sql`

**Interfaces:**

- Consumes: approved design `docs/superpowers/specs/2026-07-18-vioo-auth-profile-creation-command-forward-fix-design.md`.
- Produces: contract fail-first cho migration suffix `_auth_profile_creation_command_forward_fix.sql`, function signatures và ACL mà Task 2 phải đáp ứng.

- [ ] **Step 1: Xác nhận baseline và không stage tài liệu dirty của operator**

Run:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
npm test -- \
  lib/__tests__/authUserProfileSyncMigration.test.ts \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts \
  lib/__tests__/createUserEdgeFunctionContract.test.ts \
  lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts
npm run lint
```

Expected: focused baseline và TypeScript PASS; working tree chỉ có thay đổi tài liệu đã biết. Nếu baseline fail, dừng và điều tra trước TDD.

- [ ] **Step 2: Viết migration contract test trước khi tạo migration**

Create `lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_auth_profile_creation_command_forward_fix.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();
const syncStart = normalized.indexOf(
  'create or replace function public.sync_auth_user_profile()',
);
const privateCommandStart = normalized.indexOf(
  'create or replace function app_private.apply_created_user_profile_command',
);
const syncDefinition = syncStart >= 0 && privateCommandStart > syncStart
  ? normalized.slice(syncStart, privateCommandStart)
  : '';

describe('auth profile creation command forward-fix migration', () => {
  it('adds exactly one forward migration without an external transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
  });

  it('keeps user-editable metadata out of protected profile fields', () => {
    expect(syncDefinition).toContain('new.raw_user_meta_data ->> \'name\'');
    expect(syncDefinition).toContain('new.raw_user_meta_data ->> \'phone\'');
    expect(syncDefinition).toContain('new.raw_user_meta_data ->> \'avatar\'');
    for (const protectedKey of [
      'role',
      'username',
      'assignedWarehouseId',
      'allowedModules',
      'adminModules',
      'allowedSubModules',
      'adminSubModules',
      'isActive',
      'accountStatus',
    ]) {
      expect(syncDefinition).not.toContain(`raw_user_meta_data ->> '${protectedKey}'`);
      expect(syncDefinition).not.toContain(`raw_user_meta_data -> '${protectedKey}'`);
      expect(syncDefinition).not.toContain(`raw_user_meta_data ? '${protectedKey}'`);
    }
    expect(syncDefinition).toMatch(/'EMPLOYEE'::public\.user_role/i);
    expect(syncDefinition).toMatch(/'\{\}'::text\[\]/i);
    expect(syncDefinition).toMatch(/'\{\}'::jsonb/i);
  });

  it('creates a private definer command and public invoker wrapper', () => {
    expect(normalized).toMatch(
      /create or replace function app_private\.apply_created_user_profile_command\(\s*p_actor_user_id uuid,\s*p_auth_user_id uuid,\s*p_action text,\s*p_profile jsonb,\s*p_before_state jsonb default '\{\}'::jsonb\s*\) returns jsonb language plpgsql security definer set search_path = ''/i,
    );
    expect(normalized).toMatch(
      /create or replace function public\.apply_created_user_profile_command\(\s*p_actor_user_id uuid,\s*p_auth_user_id uuid,\s*p_action text,\s*p_profile jsonb,\s*p_before_state jsonb default '\{\}'::jsonb\s*\) returns jsonb language sql security invoker set search_path = ''/i,
    );
    expect(normalized).toContain("auth.role() is distinct from 'service_role'");
    expect(normalized).toContain('app_private.assert_legacy_system_admin(p_actor_user_id)');
    expect(normalized).toContain("set_config('app.account_lifecycle_command', 'on', true)");
  });

  it('contains finalize, rollback, target binding and safe audit events', () => {
    expect(normalized).toContain("v_action not in ('FINALIZE', 'ROLLBACK')");
    expect(normalized).toMatch(/select count\(\*\)[\s\S]*where auth_id = p_auth_user_id[\s\S]*<> 1/i);
    expect(normalized).toMatch(/where u\.auth_id = p_auth_user_id[\s\S]*for update/i);
    expect(normalized).toContain("'account_created_profile_finalized'");
    expect(normalized).toContain("'account_creation_profile_rolled_back'");
    expect(normalized).toMatch(/where id = v_target\.id\s+and auth_id = p_auth_user_id/i);
    expect(normalized).not.toMatch(/password|bearer|service_role_key/i);
  });

  it('exposes only an invoker wrapper with service-role-only execute ACLs', () => {
    expect(normalized).toMatch(
      /revoke all on function app_private\.apply_created_user_profile_command\(uuid, uuid, text, jsonb, jsonb\) from public, anon, authenticated/i,
    );
    expect(normalized).toMatch(
      /grant execute on function app_private\.apply_created_user_profile_command\(uuid, uuid, text, jsonb, jsonb\) to service_role/i,
    );
    expect(normalized).toMatch(
      /revoke all on function public\.apply_created_user_profile_command\(uuid, uuid, text, jsonb, jsonb\) from public, anon, authenticated/i,
    );
    expect(normalized).toMatch(
      /grant execute on function public\.apply_created_user_profile_command\(uuid, uuid, text, jsonb, jsonb\) to service_role/i,
    );
  });
});
```

- [ ] **Step 3: Chạy RED và xác nhận đúng nguyên nhân**

Run:

```bash
npm test -- lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts
```

Expected: FAIL tại `expect(migrationFiles).toHaveLength(1)` vì migration forward mới chưa tồn tại. Nếu test pass hoặc fail do syntax/import, sửa test và chạy lại cho tới khi RED đúng nguyên nhân.

- [ ] **Step 4: Commit riêng RED contract**

Run:

```bash
git add lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts
git diff --cached --check
git commit -m "test(auth): define profile creation command contract"
```

Expected: commit chỉ chứa một test file và suite mới vẫn RED cho tới Task 2.

---

### Task 2: GREEN migration command, safe Auth trigger và SQL smoke

**Files:**

- Create: the single CLI-generated path matching `supabase/migrations/*_auth_profile_creation_command_forward_fix.sql`
- Create: `supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql`
- Verify: `lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts`

**Interfaces:**

- Consumes: exact function signatures asserted by Task 1.
- Produces: `public.apply_created_user_profile_command(uuid, uuid, text, jsonb, jsonb) -> jsonb`, private command implementation, safe final definition of `public.sync_auth_user_profile()` and rollback-only smoke used by Task 5/6.

- [ ] **Step 1: Tạo đúng một migration bằng CLI**

Run:

```bash
npx supabase migration new auth_profile_creation_command_forward_fix
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
test "$(printf '%s\n' "$FIX_MIGRATION" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
```

Expected: CLI tạo đúng một file timestamped và không tạo migration-history row.

- [ ] **Step 2: Viết safe replacement cho Auth profile sync**

At the top of `$FIX_MIGRATION`, add:

```sql
-- Auth metadata is user-editable. Keep the Auth trigger limited to profile
-- display fields and move every protected profile field to the governed
-- creation command below.
create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_requested_username text := coalesce(
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    new.id::text
  );
  v_safe_username text := v_requested_username;
  v_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'name', ''),
    v_requested_username
  );
  v_phone text := nullif(new.raw_user_meta_data ->> 'phone', '');
  v_avatar text := coalesce(
    nullif(new.raw_user_meta_data ->> 'avatar', ''),
    'https://i.pravatar.cc/150?u=' || coalesce(new.email, new.id::text)
  );
  v_existing_profile_id uuid;
begin
  select u.id
    into v_existing_profile_id
  from public.users u
  where u.auth_id = new.id
     or (
       new.email is not null
       and lower(u.email) = lower(new.email)
     )
  order by
    case
      when u.auth_id = new.id then 0
      when new.email is not null and lower(u.email) = lower(new.email) then 1
      else 2
    end,
    u.created_at nulls last,
    u.id
  limit 1
  for update;

  if v_existing_profile_id is not null then
    update public.users
    set auth_id = case
          when public.users.auth_id is null or public.users.auth_id = new.id
            then new.id
          else public.users.auth_id
        end,
        name = coalesce(nullif(v_name, ''), public.users.name),
        email = coalesce(new.email, public.users.email),
        phone = coalesce(v_phone, public.users.phone),
        avatar = coalesce(v_avatar, public.users.avatar),
        updated_at = now()
    where id = v_existing_profile_id;

    return new;
  end if;

  if exists (
    select 1
    from public.users
    where lower(username) = lower(v_safe_username)
      and email is distinct from new.email
  ) then
    v_safe_username := v_safe_username || '-' || left(new.id::text, 8);
  end if;

  insert into public.users (
    id,
    auth_id,
    name,
    email,
    username,
    phone,
    role,
    avatar,
    assigned_warehouse_id,
    allowed_modules,
    admin_modules,
    allowed_sub_modules,
    admin_sub_modules,
    is_active,
    account_status
  )
  values (
    new.id,
    new.id,
    v_name,
    new.email,
    v_safe_username,
    v_phone,
    'EMPLOYEE'::public.user_role,
    v_avatar,
    null,
    '{}'::text[],
    '{}'::text[],
    '{}'::jsonb,
    '{}'::jsonb,
    true,
    'ACTIVE'
  )
  on conflict (id) do update
  set auth_id = coalesce(public.users.auth_id, excluded.auth_id),
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      avatar = excluded.avatar,
      updated_at = now();

  return new;
end;
$function$;
```

- [ ] **Step 3: Viết private command và public invoker wrapper**

Append to `$FIX_MIGRATION`:

```sql
create or replace function app_private.apply_created_user_profile_command(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_action text,
  p_profile jsonb,
  p_before_state jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := upper(trim(coalesce(p_action, '')));
  v_target public.users%rowtype;
  v_auth_email text;
  v_role public.user_role;
  v_allowed_modules text[] := '{}'::text[];
  v_admin_modules text[] := '{}'::text[];
  v_allowed_sub_modules jsonb := '{}'::jsonb;
  v_admin_sub_modules jsonb := '{}'::jsonb;
  v_unknown_key text;
  v_profile_existed boolean;
  v_before_profile_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Trusted profile creation command required'
      using errcode = '42501';
  end if;

  perform app_private.assert_legacy_system_admin(p_actor_user_id);

  if v_action not in ('FINALIZE', 'ROLLBACK') then
    raise exception 'Unsupported profile creation command action'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.users
    where auth_id = p_auth_user_id
  ) <> 1 then
    raise exception 'Linked application profile must be unique'
      using errcode = 'P0002';
  end if;

  select u.*
    into v_target
  from public.users u
  where u.auth_id = p_auth_user_id
  order by u.created_at, u.id
  limit 1
  for update;

  if v_target.id is null then
    raise exception 'Linked application profile does not exist'
      using errcode = 'P0002';
  end if;

  if v_action = 'FINALIZE' then
    if jsonb_typeof(coalesce(p_profile, 'null'::jsonb)) <> 'object' then
      raise exception 'Invalid created profile payload'
        using errcode = '22023';
    end if;

    select key
      into v_unknown_key
    from jsonb_object_keys(p_profile) as profile_key(key)
    where key <> all (array[
      'name',
      'username',
      'phone',
      'role',
      'avatar',
      'assignedWarehouseId',
      'allowedModules',
      'adminModules',
      'allowedSubModules',
      'adminSubModules',
      'isActive'
    ]::text[])
    limit 1;

    if v_unknown_key is not null then
      raise exception 'Invalid created profile payload'
        using errcode = '22023';
    end if;

    if nullif(trim(p_profile ->> 'name'), '') is null
      or nullif(trim(p_profile ->> 'username'), '') is null
      or nullif(trim(p_profile ->> 'role'), '') is null
      or jsonb_typeof(coalesce(p_profile -> 'allowedModules', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(p_profile -> 'adminModules', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(p_profile -> 'allowedSubModules', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(p_profile -> 'adminSubModules', '{}'::jsonb)) <> 'object'
      or (
        p_profile ? 'isActive'
        and jsonb_typeof(p_profile -> 'isActive') <> 'boolean'
      )
    then
      raise exception 'Invalid created profile payload'
        using errcode = '22023';
    end if;

    if p_profile ? 'isActive'
      and (p_profile ->> 'isActive')::boolean is distinct from true
    then
      raise exception 'Invalid created profile payload'
        using errcode = '22023';
    end if;

    select enum_row.enumlabel::public.user_role
      into v_role
    from pg_catalog.pg_enum enum_row
    join pg_catalog.pg_type type_row
      on type_row.oid = enum_row.enumtypid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = type_row.typnamespace
    where namespace_row.nspname = 'public'
      and type_row.typname = 'user_role'
      and enum_row.enumlabel = p_profile ->> 'role';

    if v_role is null then
      raise exception 'Invalid created profile role'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_allowed_modules
    from jsonb_array_elements_text(
      coalesce(p_profile -> 'allowedModules', '[]'::jsonb)
    ) with ordinality module_row(value, ordinality);

    select coalesce(array_agg(value order by ordinality), '{}'::text[])
      into v_admin_modules
    from jsonb_array_elements_text(
      coalesce(p_profile -> 'adminModules', '[]'::jsonb)
    ) with ordinality module_row(value, ordinality);

    v_allowed_sub_modules := coalesce(
      p_profile -> 'allowedSubModules',
      '{}'::jsonb
    );
    v_admin_sub_modules := coalesce(
      p_profile -> 'adminSubModules',
      '{}'::jsonb
    );

    select lower(auth_user.email)
      into v_auth_email
    from auth.users auth_user
    where auth_user.id = p_auth_user_id;

    if v_auth_email is null then
      raise exception 'Supabase Auth user does not exist'
        using errcode = 'P0002';
    end if;

    perform set_config('app.account_lifecycle_command', 'on', true);

    update public.users
    set name = trim(p_profile ->> 'name'),
        email = v_auth_email,
        username = trim(p_profile ->> 'username'),
        phone = nullif(trim(p_profile ->> 'phone'), ''),
        role = v_role,
        avatar = nullif(trim(p_profile ->> 'avatar'), ''),
        assigned_warehouse_id = nullif(
          trim(p_profile ->> 'assignedWarehouseId'),
          ''
        ),
        allowed_modules = v_allowed_modules,
        admin_modules = v_admin_modules,
        allowed_sub_modules = v_allowed_sub_modules,
        admin_sub_modules = v_admin_sub_modules,
        is_active = true,
        account_status = 'ACTIVE',
        updated_at = now()
    where id = v_target.id
      and auth_id = p_auth_user_id;

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
      v_target.id,
      'account_created_profile_finalized',
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_object(
        'role', v_role,
        'allowedModuleCount', cardinality(v_allowed_modules),
        'adminModuleCount', cardinality(v_admin_modules),
        'allowedSubModuleGroupCount', jsonb_object_length(v_allowed_sub_modules),
        'adminSubModuleGroupCount', jsonb_object_length(v_admin_sub_modules),
        'accountStatus', 'ACTIVE'
      )
    );

    return jsonb_build_object(
      'profileId', v_target.id,
      'action', v_action,
      'status', 'COMPLETED'
    );
  end if;

  if jsonb_typeof(coalesce(p_before_state, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_before_state -> 'existed', 'null'::jsonb)) <> 'boolean'
  then
    raise exception 'Invalid profile rollback state'
      using errcode = '22023';
  end if;

  v_profile_existed := (p_before_state ->> 'existed')::boolean;
  perform set_config('app.account_lifecycle_command', 'on', true);

  if v_profile_existed then
    begin
      v_before_profile_id := (p_before_state ->> 'profileId')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Invalid profile rollback state'
          using errcode = '22023';
    end;

    if v_before_profile_id is distinct from v_target.id
      or nullif(p_before_state ->> 'authId', '') is not null
    then
      raise exception 'Profile rollback target mismatch'
        using errcode = '42501';
    end if;

    update public.users
    set auth_id = null,
        name = p_before_state ->> 'name',
        email = p_before_state ->> 'email',
        username = p_before_state ->> 'username',
        phone = nullif(p_before_state ->> 'phone', ''),
        avatar = nullif(p_before_state ->> 'avatar', ''),
        updated_at = (p_before_state ->> 'updatedAt')::timestamptz
    where id = v_target.id
      and auth_id = p_auth_user_id;

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
      v_target.id,
      'account_creation_profile_rolled_back',
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_object('profileWasExisting', true)
    );
  else
    if v_target.id is distinct from p_auth_user_id then
      raise exception 'Profile rollback target mismatch'
        using errcode = '42501';
    end if;

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
      v_target.id,
      'account_creation_profile_rolled_back',
      '[]'::jsonb,
      '[]'::jsonb,
      jsonb_build_object('profileWasExisting', false)
    );

    delete from public.users
    where id = v_target.id
      and auth_id = p_auth_user_id;
  end if;

  return jsonb_build_object(
    'profileId', v_target.id,
    'action', v_action,
    'status', 'ROLLED_BACK'
  );
end;
$$;

revoke all on function app_private.apply_created_user_profile_command(
  uuid, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.apply_created_user_profile_command(
  uuid, uuid, text, jsonb, jsonb
) to service_role;

create or replace function public.apply_created_user_profile_command(
  p_actor_user_id uuid,
  p_auth_user_id uuid,
  p_action text,
  p_profile jsonb,
  p_before_state jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_created_user_profile_command(
    p_actor_user_id,
    p_auth_user_id,
    p_action,
    p_profile,
    p_before_state
  );
$$;

revoke all on function public.apply_created_user_profile_command(
  uuid, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_created_user_profile_command(
  uuid, uuid, text, jsonb, jsonb
) to service_role;
```

- [ ] **Step 4: Viết rollback-only SQL smoke**

Create `supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql`:

```sql
do $$
declare
  v_sync_definition text;
  v_command_definition text;
begin
  select lower(regexp_replace(pg_get_functiondef(
    'public.sync_auth_user_profile()'::regprocedure
  ), '\s+', ' ', 'g'))
  into v_sync_definition;

  if v_sync_definition ~
    'raw_user_meta_data[^;]*(role|username|assignedwarehouseid|allowedmodules|adminmodules|allowedsubmodules|adminsubmodules|isactive|accountstatus)'
  then
    raise exception 'Auth profile trigger still trusts protected user metadata';
  end if;

  select lower(regexp_replace(pg_get_functiondef(
    'app_private.apply_created_user_profile_command(uuid,uuid,text,jsonb,jsonb)'::regprocedure
  ), '\s+', ' ', 'g'))
  into v_command_definition;

  if position('security definer' in v_command_definition) = 0
    or position(
      'auth.role() is distinct from ''service_role'''
      in v_command_definition
    ) = 0
    or position(
      'set_config(''app.account_lifecycle_command'', ''on'', true)'
      in v_command_definition
    ) = 0
  then
    raise exception 'Profile creation command boundary is incomplete';
  end if;

  if has_function_privilege(
    'anon',
    'public.apply_created_user_profile_command(uuid,uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.apply_created_user_profile_command(uuid,uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.apply_created_user_profile_command(uuid,uuid,text,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Profile creation command ACL mismatch';
  end if;
end;
$$;

create temp table auth_profile_creation_command_context on commit drop as
select
  (
    select u.id
    from public.users u
    where u.role = 'ADMIN'
      and u.is_active
      and u.account_status = 'ACTIVE'
    order by u.created_at, u.id
    limit 1
  ) as actor_id,
  (
    select u.id
    from public.users u
    where u.auth_id is not null
      and u.id <> u.auth_id
      and u.is_active
      and u.account_status = 'ACTIVE'
      and not exists (
        select 1
        from public.users id_owner
        where id_owner.id = u.auth_id
      )
    order by u.created_at, u.id
    limit 1
  ) as target_id;

do $$
begin
  if exists (
    select 1
    from auth_profile_creation_command_context
    where actor_id is null or target_id is null
  ) then
    raise exception 'Profile creation command smoke requires active Admin and linked profile';
  end if;
end;
$$;

grant select on auth_profile_creation_command_context to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select public.apply_created_user_profile_command(
  context.actor_id,
  target.auth_id,
  'FINALIZE',
  jsonb_build_object(
    'name', target.name,
    'username', target.username,
    'phone', target.phone,
    'role', target.role,
    'avatar', target.avatar,
    'assignedWarehouseId', target.assigned_warehouse_id,
    'allowedModules', to_jsonb(coalesce(target.allowed_modules, '{}'::text[])),
    'adminModules', to_jsonb(coalesce(target.admin_modules, '{}'::text[])),
    'allowedSubModules', coalesce(target.allowed_sub_modules, '{}'::jsonb),
    'adminSubModules', coalesce(target.admin_sub_modules, '{}'::jsonb),
    'isActive', true
  ),
  '{}'::jsonb
)
from auth_profile_creation_command_context context
join public.users target on target.id = context.target_id;

reset role;

do $$
declare
  v_actor_id uuid;
  v_original public.users%rowtype;
  v_fixture_email text;
  v_fixture_username text;
begin
  select actor_id into v_actor_id
  from auth_profile_creation_command_context;

  select target.* into v_original
  from auth_profile_creation_command_context context
  join public.users target on target.id = context.target_id;

  v_fixture_username := 'auth-command-' || replace(v_original.auth_id::text, '-', '');
  v_fixture_email := v_fixture_username || '@example.invalid';

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('app.account_lifecycle_command', 'on', true);
  set local role service_role;
  update public.users
  set auth_id = null
  where id = v_original.id
    and auth_id = v_original.auth_id;
  reset role;

  insert into public.users (
    id, auth_id, name, email, username, role, is_active, account_status
  ) values (
    v_original.auth_id,
    v_original.auth_id,
    'Auth command rollback fixture',
    v_fixture_email,
    v_fixture_username,
    'EMPLOYEE',
    true,
    'ACTIVE'
  );

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.apply_created_user_profile_command(
    v_actor_id,
    v_original.auth_id,
    'ROLLBACK',
    '{}'::jsonb,
    jsonb_build_object('existed', false)
  );
  reset role;

  if exists (select 1 from public.users where id = v_original.auth_id) then
    raise exception 'New profile rollback did not delete the fixture';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('app.account_lifecycle_command', 'on', true);
  set local role service_role;
  update public.users
  set auth_id = v_original.auth_id,
      name = 'Mutated smoke fixture',
      phone = '0900000000',
      avatar = 'https://example.invalid/mutated.png',
      updated_at = now()
  where id = v_original.id
    and auth_id is null;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  perform public.apply_created_user_profile_command(
    v_actor_id,
    v_original.auth_id,
    'ROLLBACK',
    '{}'::jsonb,
    jsonb_build_object(
      'existed', true,
      'profileId', v_original.id,
      'authId', null,
      'name', v_original.name,
      'email', v_original.email,
      'username', v_original.username,
      'phone', v_original.phone,
      'avatar', v_original.avatar,
      'updatedAt', v_original.updated_at
    )
  );
  reset role;

  if not exists (
    select 1
    from public.users
    where id = v_original.id
      and auth_id is null
      and name = v_original.name
      and email = v_original.email
      and username = v_original.username
      and phone is not distinct from v_original.phone
      and avatar is not distinct from v_original.avatar
      and updated_at = v_original.updated_at
  ) then
    raise exception 'Existing profile rollback did not restore the fixture';
  end if;
end;
$$;

create temp table auth_profile_command_guard_fixture on commit drop as
select * from public.users limit 1;

create trigger trg_auth_profile_command_guard_fixture
before update on auth_profile_command_guard_fixture
for each row execute function app_private.prevent_users_privilege_self_update();

grant select, update on auth_profile_command_guard_fixture to service_role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('app.account_lifecycle_command', '', true);

do $$
begin
  begin
    update auth_profile_command_guard_fixture set name = name;
    raise exception 'service_role bypassed the guard outside the command';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

reset role;

select 'auth_profile_creation_command_forward_fix_smoke_passed' as checkpoint;
```

- [ ] **Step 5: Chạy GREEN repository contract**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
npm test -- \
  lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts \
  lib/__tests__/authUserProfileSyncMigration.test.ts \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts
npm run lint
git diff --check -- \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql \
  lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts
```

Expected: tests và TypeScript PASS; không chạy SQL smoke trực tiếp trên committed Cloud ở Task này.

- [ ] **Step 6: Commit migration candidate phần database**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
git add \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql
git diff --cached --check
git commit -m "fix(auth): add governed profile creation command"
```

Expected: database candidate commit chứa đúng migration và SQL smoke; RED contract test đã ở commit Task 1.

---

### Task 3: RED contract cho Edge orchestration và compensation

**Files:**

- Modify: `lib/__tests__/createUserEdgeFunctionContract.test.ts`
- Verify: `supabase/functions/create-user/index.ts`

**Interfaces:**

- Consumes: RPC `public.apply_created_user_profile_command` từ Task 2.
- Produces: fail-first contract yêu cầu `create-user` gọi `FINALIZE`, gọi `ROLLBACK` trước `deleteUser`, không direct-upsert và không đưa protected field vào Auth metadata.

- [ ] **Step 1: Thay contract cũ bằng contract orchestration mới**

Replace `lib/__tests__/createUserEdgeFunctionContract.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'supabase', 'functions', 'create-user', 'index.ts'),
  'utf8',
);
const normalized = source.replace(/\s+/g, ' ').trim();

describe('create-user Edge Function contract', () => {
  it('keeps the verified active Admin actor for governed profile commands', () => {
    expect(normalized).toContain('const caller = await requireActiveAdmin(req, admin)');
    expect(normalized).toContain('p_actor_user_id: caller.appUser.id');
  });

  it('captures at most two existing profiles before Auth mutation', () => {
    const preflightIndex = normalized.indexOf(".from('users').select('id, auth_id, name, email, username, phone, avatar, updated_at')");
    const createAuthIndex = normalized.indexOf('admin.auth.admin.createUser');
    expect(preflightIndex).toBeGreaterThanOrEqual(0);
    expect(normalized).toContain(".ilike('email', escapedEmailPattern).limit(2)");
    expect(preflightIndex).toBeLessThan(createAuthIndex);
    expect(normalized).toContain('Ambiguous application profile');
    expect(normalized).toContain('Application profile already has an Auth identity');
  });

  it('does not put protected profile fields in editable Auth metadata', () => {
    const createStart = source.indexOf('admin.auth.admin.createUser');
    const createEnd = source.indexOf('});', createStart);
    const createUserCall = source.slice(createStart, createEnd);

    for (const protectedKey of [
      'role',
      'username',
      'assignedWarehouseId',
      'allowedModules',
      'adminModules',
      'allowedSubModules',
      'adminSubModules',
      'isActive',
    ]) {
      expect(createUserCall).not.toContain(protectedKey);
    }
  });

  it('finalizes through the governed RPC and never directly upserts users', () => {
    expect(normalized).toContain("admin.rpc('apply_created_user_profile_command'");
    expect(normalized).toContain("p_action: 'FINALIZE'");
    expect(normalized).toContain('p_profile: profile');
    expect(normalized).not.toMatch(/from\('users'\)\.upsert/);
  });

  it('runs profile compensation before deleting the Auth user', () => {
    const rollbackIndex = normalized.indexOf("p_action: 'ROLLBACK'");
    const deleteAuthIndex = normalized.indexOf(
      'admin.auth.admin.deleteUser(createdAuthUserId)',
      rollbackIndex,
    );
    expect(rollbackIndex).toBeGreaterThanOrEqual(0);
    expect(deleteAuthIndex).toBeGreaterThan(rollbackIndex);
    expect(normalized).toContain('p_before_state: beforeState');
    expect(normalized).toContain('admin.auth.admin.updateUserById');
    expect(normalized).toContain("ban_duration: '876000h'");
  });

  it('returns only a safe public error for internal failures', () => {
    expect(normalized).toContain("'Không thể xử lý yêu cầu tài khoản.'");
    expect(normalized).not.toMatch(/return json\(\{ error: internalMessage/);
  });
});
```

- [ ] **Step 2: Chạy RED và xác nhận code cũ bị bắt đúng lỗi**

Run:

```bash
npm test -- lib/__tests__/createUserEdgeFunctionContract.test.ts
```

Expected: FAIL vì code cũ không giữ `caller`, không preflight snapshot, còn direct `users.upsert` và chưa gọi command RPC.

- [ ] **Step 3: Commit riêng RED Edge contract**

Run:

```bash
git add lib/__tests__/createUserEdgeFunctionContract.test.ts
git diff --cached --check
git commit -m "test(auth): define governed create-user orchestration"
```

Expected: commit chỉ chứa Edge contract test và test vẫn RED cho tới Task 4.

---

### Task 4: GREEN Edge Function orchestration

**Files:**

- Modify: `supabase/functions/create-user/index.ts`
- Verify: `lib/__tests__/createUserEdgeFunctionContract.test.ts`
- Verify: `lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts`
- Verify: `lib/__tests__/userAccountCreation.test.ts`

**Interfaces:**

- Consumes: service-role-only RPC từ Task 2 và `requireActiveAdmin(req, admin)` từ `_shared/adminAuthorization.ts`.
- Produces: `create-user` flow trả `{ userId, profileId, user }`, không direct protected update, và compensation `ROLLBACK` → Auth delete.

- [ ] **Step 1: Thay Edge Function bằng orchestration command**

Replace `supabase/functions/create-user/index.ts` with:

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

class RequestError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'RequestError';
  }
}

type ExistingProfile = {
  id: string;
  auth_id: string | null;
  name: string;
  email: string;
  username: string;
  phone: string | null;
  avatar: string | null;
  updated_at: string;
};

type BeforeState = {
  existed: boolean;
  profileId?: string;
  authId?: string | null;
  name?: string;
  email?: string;
  username?: string;
  phone?: string | null;
  avatar?: string | null;
  updatedAt?: string;
};

const escapeIlikePattern = (value: string) => value.replace(/[\\%_]/g, '\\$&');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let admin: ReturnType<typeof getAdminClient> | null = null;
  let createdAuthUserId: string | null = null;
  let actorUserId: string | null = null;
  let beforeState: BeforeState = { existed: false };

  try {
    admin = getAdminClient();
    const caller = await requireActiveAdmin(req, admin);
    actorUserId = caller.appUser.id;

    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email) throw new RequestError('Email is required');
    if (password.length < 6) {
      throw new RequestError('Password must be at least 6 characters');
    }

    const profile = body.profile || {};
    const escapedEmailPattern = escapeIlikePattern(email);
    const { data: existingProfiles, error: existingProfileError } = await admin
      .from('users')
      .select('id, auth_id, name, email, username, phone, avatar, updated_at')
      .ilike('email', escapedEmailPattern)
      .limit(2);
    if (existingProfileError) throw existingProfileError;
    if ((existingProfiles || []).length > 1) {
      throw new RequestError('Ambiguous application profile', 409);
    }

    const existingProfile = (existingProfiles?.[0] || null) as ExistingProfile | null;
    if (existingProfile?.auth_id) {
      throw new RequestError('Application profile already has an Auth identity', 409);
    }
    if (existingProfile) {
      beforeState = {
        existed: true,
        profileId: existingProfile.id,
        authId: existingProfile.auth_id,
        name: existingProfile.name,
        email: existingProfile.email,
        username: existingProfile.username,
        phone: existingProfile.phone,
        avatar: existingProfile.avatar,
        updatedAt: existingProfile.updated_at,
      };
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name: profile.name,
        phone: profile.phone,
        avatar: profile.avatar,
      },
    });
    if (error) throw error;
    if (!data.user) throw new Error('Supabase Auth did not return a user');
    createdAuthUserId = data.user.id;

    const { data: linkedProfile, error: linkedProfileError } = await admin
      .from('users')
      .select('id')
      .eq('auth_id', data.user.id)
      .maybeSingle();
    if (linkedProfileError) throw linkedProfileError;
    if (!linkedProfile?.id) throw new Error('Auth trigger returned no linked profile');

    const { data: finalized, error: finalizeError } = await admin.rpc(
      'apply_created_user_profile_command',
      {
        p_actor_user_id: caller.appUser.id,
        p_auth_user_id: data.user.id,
        p_action: 'FINALIZE',
        p_profile: profile,
        p_before_state: beforeState,
      },
    );
    if (finalizeError) throw finalizeError;

    const profileId = finalized?.profileId || linkedProfile.id;
    return json({
      userId: data.user.id,
      profileId,
      user: { id: data.user.id, email: data.user.email },
    });
  } catch (error) {
    if (admin && createdAuthUserId && actorUserId) {
      const { error: rollbackError } = await admin.rpc(
        'apply_created_user_profile_command',
        {
          p_actor_user_id: actorUserId,
          p_auth_user_id: createdAuthUserId,
          p_action: 'ROLLBACK',
          p_profile: {},
          p_before_state: beforeState,
        },
      );
      let authDeleteError = null;
      let authContainmentError = null;
      if (rollbackError) {
        const { error } = await admin.auth.admin.updateUserById(
          createdAuthUserId,
          { ban_duration: '876000h' },
        );
        authContainmentError = error;
      } else {
        const { error } = await admin.auth.admin.deleteUser(createdAuthUserId);
        authDeleteError = error;
      }
      if (rollbackError || authDeleteError || authContainmentError) {
        console.error('create-user compensation failed', {
          profileRollbackFailed: Boolean(rollbackError),
          authDeleteFailed: Boolean(authDeleteError),
          authContainmentFailed: Boolean(authContainmentError),
        });
      }
    }

    const status = error instanceof EdgeAuthorizationError || error instanceof RequestError
      ? error.status
      : 400;
    const publicMessage = error instanceof EdgeAuthorizationError || error instanceof RequestError
      ? error.message
      : 'Không thể xử lý yêu cầu tài khoản.';
    return json({ error: publicMessage }, status);
  }
});
```

- [ ] **Step 2: Chạy GREEN Edge contracts**

Run:

```bash
npm test -- \
  lib/__tests__/createUserEdgeFunctionContract.test.ts \
  lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts \
  lib/__tests__/userAccountCreation.test.ts
npm run lint
git diff --check -- \
  supabase/functions/create-user/index.ts \
  lib/__tests__/createUserEdgeFunctionContract.test.ts
```

Expected: cả ba test files và TypeScript PASS; source không còn `from('users').upsert`.

- [ ] **Step 3: Commit Edge implementation**

Run:

```bash
git add supabase/functions/create-user/index.ts
git diff --cached --check
git commit -m "fix(auth): finalize created profiles through command"
```

Expected: commit chỉ chứa Edge Function implementation; RED test đã ở commit Task 3.

---

### Task 5: Candidate verification và linked-Cloud rollback-only gate

**Files:**

- Verify: generated migration `_auth_profile_creation_command_forward_fix.sql`
- Verify: `supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql`
- Verify: `supabase/functions/create-user/index.ts`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

**Interfaces:**

- Consumes: final repository candidate từ Tasks 1–4.
- Produces: immutable candidate SHA/version, full repository PASS, Cloud GREEN trong transaction rollback và explicit approval checkpoint trước apply/deploy.

- [ ] **Step 1: Chạy full repository verification**

Run:

```bash
npm test
npm run lint
npm run build
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
git diff --check -- \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql \
  supabase/functions/create-user/index.ts \
  lib/__tests__/authProfileCreationCommandForwardFixMigration.test.ts \
  lib/__tests__/createUserEdgeFunctionContract.test.ts
git status --short
```

Expected: full tests, TypeScript và build exit `0`; chỉ parent plan dirty đã biết còn unstaged.

- [ ] **Step 2: Capture immutable candidate và preflight Cloud**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
CANDIDATE_SHA="$(git rev-parse HEAD)"
test "${#FIX_VERSION}" = "14"
shasum -a 256 "$FIX_MIGRATION"
npx supabase migration list --linked | rg "$FIX_VERSION"
npx supabase db query --linked --agent=no "
select
  md5(pg_get_functiondef('public.sync_auth_user_profile()'::regprocedure)) as sync_hash,
  to_regprocedure('public.apply_created_user_profile_command(uuid,uuid,text,jsonb,jsonb)') is not null as command_present,
  (
    select jsonb_object_agg(s.key, s.value order by s.key)
    from app_private.permission_hardening_settings s
    where s.key in (
      'business_role_resolver_enabled',
      'legacy_governance_fallback_disabled',
      'system_admin_business_approval_bypass_disabled'
    )
  ) as rollout_flags,
  (
    select count(*)
    from public.user_permission_grants g
    join public.permission_actions p
      on p.permission_code = g.permission_code
    where g.is_active
      and g.expires_at is null
      and p.risk_level = 'sensitive'
  ) as sensitive_null_expiry_grants;
"
```

Expected: version chỉ local/pending; `command_present = false`; flags đều `false`; inventory `467`. Chỉ log aggregate/hash, không identity.

- [ ] **Step 3: Chạy migration + smoke trong một linked transaction rollback**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
BUNDLE="$(mktemp /tmp/auth-profile-command-rollback.XXXXXX)"
trap 'rm -f "$BUNDLE"' EXIT
node -e "const fs=require('fs'); const out=process.argv[1]; const files=process.argv.slice(2); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join('\n'); fs.writeFileSync(out, \"begin; set local lock_timeout='5s'; set local statement_timeout='120s';\\n\"+sql+\"\\nselect 'auth_profile_creation_command_forward_fix_rollback_passed' as checkpoint; rollback;\\n\", {mode:0o600});" \
  "$BUNDLE" \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: checkpoint `auth_profile_creation_command_forward_fix_rollback_passed`, explicit rollback và exit `0`.

- [ ] **Step 4: Prove rollback restored definition/history/inventory**

Run lại Step 2 Cloud query và:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
npx supabase migration list --linked | rg "$FIX_VERSION"
```

Expected: `sync_hash` khớp preflight, `command_present = false`, version vẫn pending, flags `false`, inventory `467`.

- [ ] **Step 5: Ghi rollback evidence và commit documentation**

Append a subsection to `docs/security/phase02-business-role-sod-live-apply-log.md` recording only:

```markdown
### Auth profile creation command forward-fix rollback gate

- Candidate commit and one generated migration version were verified without exposing credentials or identities.
- Repository full tests, TypeScript and build: PASS.
- The migration plus command/ACL/trigger smoke reached the rollback checkpoint on linked Cloud.
- Post-rollback sync hash and migration history matched preflight; the command remained absent from committed Cloud.
- All three rollout flags remained false and sensitive-null-expiry inventory remained 467.
- Status: waiting for explicit approval to apply exactly one migration and deploy exactly `create-user`.
```

Run:

```bash
git add docs/security/phase02-business-role-sod-live-apply-log.md
git diff --cached --check
git commit -m "docs(auth): record profile creation command rollback gate"
git rev-parse HEAD
shasum -a 256 "$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
```

Expected: documentation-only evidence commit. The resulting HEAD is the exact
candidate SHA presented for approval; migration/Edge implementation is unchanged
from the verified tree. Stop and request approval for Task 6; do not apply,
repair or deploy in the same approval window.

---

### Task 6: Apply one migration, deploy one Edge Function và close Task 4 canary

**Prerequisite:** Operator explicitly approves the exact candidate SHA, migration version/hash and rollback-only evidence from Task 5.

**Files:**

- Verify: generated migration `_auth_profile_creation_command_forward_fix.sql`
- Verify: `supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql`
- Deploy: `supabase/functions/create-user/index.ts`
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Modify: `docs/superpowers/plans/2026-07-17-vioo-auth-profile-sync-guard-forward-fix.md`
- Modify: `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`

**Interfaces:**

- Consumes: operator-approved immutable candidate and authenticated Admin browser session.
- Produces: committed command + hardened trigger, exactly one repaired version, deployed `create-user`, successful zero-right user, unauthorized `42501` canary, disabled canary and updated Phase 2 evidence.

- [ ] **Step 1: Reconfirm candidate and preflight immediately before mutation**

Run `git rev-parse HEAD` and require exact equality with the SHA approved after
Task 5 Step 5. Then repeat Task 5 Steps 1–2, using that approved HEAD as
`CANDIDATE_SHA`.

Expected: no SHA/hash/history/inventory drift. Stop on any difference.

- [ ] **Step 2: Apply exactly one migration in explicit transaction**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write(\"begin; set local lock_timeout='5s'; set local statement_timeout='120s'; \"+sql+\" select 'auth_profile_creation_command_forward_fix_applied' as checkpoint; commit;\");" "$FIX_MIGRATION")"
```

Expected: checkpoint, commit và exit `0`; không apply migration khác.

- [ ] **Step 3: Run committed smoke before repair**

Run:

```bash
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write(\"begin; set local lock_timeout='5s'; set local statement_timeout='120s'; \"+sql+\" select 'auth_profile_creation_command_forward_fix_committed_smoke_passed' as checkpoint; rollback;\");" supabase/tests/auth_profile_creation_command_forward_fix_smoke.sql)"
```

Expected: committed smoke PASS; command present, trigger hardened, flags `false`, inventory `467`.

- [ ] **Step 4: Repair exactly one verified version**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
npx supabase migration repair "$FIX_VERSION" \
  --status applied \
  --linked \
  --workdir . \
  --yes
npx supabase migration list --linked | rg "$FIX_VERSION"
```

Expected: đúng version mới aligned local/remote.

- [ ] **Step 5: Deploy exactly `create-user` through Cloud API bundling**

Run:

```bash
npx supabase functions list --output json > /tmp/functions-before-profile-command.json
npx supabase functions deploy create-user \
  --use-api \
  --workdir . \
  --yes
npx supabase functions list --output json > /tmp/functions-after-profile-command.json
node -e "const fs=require('fs'); for (const file of process.argv.slice(1)) { const rows=JSON.parse(fs.readFileSync(file,'utf8')); const fn=rows.find(row=>row.slug==='create-user'||row.name==='create-user'); console.log(JSON.stringify(fn ? {name:fn.name||fn.slug,version:fn.version,status:fn.status} : {found:false})); }" \
  /tmp/functions-before-profile-command.json \
  /tmp/functions-after-profile-command.json
```

Expected: only `create-user` gets a new deployed version; JWT verification remains enabled because `--no-verify-jwt` is not used. Không deploy function khác.

- [ ] **Step 6: Create zero-right disposable user through application UI**

In the authenticated Admin session:

1. Open Settings → Người dùng → Thêm tài khoản.
2. Use name `Auth Profile Command Canary 20260718`; keep random email/username/password only in browser runtime.
3. Select `Tài khoản thường`/`EMPLOYEE`; leave legacy module/submodule, Business Role and direct grants empty.
4. Submit once.
5. Keep only returned app profile ID in browser runtime.
6. Verify UI success and linked aggregate:

```sql
select
  count(*) filter (
    where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
  ) as active_linked_profiles,
  count(distinct g.id) filter (where g.is_active) as active_direct_grants,
  count(distinct a.id) filter (
    where a.status = 'ACTIVE'
      and a.starts_at <= now()
      and (a.expires_at is null or a.expires_at > now())
  ) as active_business_roles
from public.users u
left join public.user_permission_grants g on g.user_id = u.id
left join public.principal_role_assignments a
  on a.principal_type = 'user'
 and a.principal_id = u.id
where u.name = 'Auth Profile Command Canary 20260718';
```

Expected: `1, 0, 0`; public error `Không thể xử lý yêu cầu tài khoản.` does not appear.

- [ ] **Step 7: Run unauthorized Data API canary as disposable user**

Use an isolated browser storage context so the Admin session remains available. Sign in as canary, confirm profile loads and governance UI is unavailable, then call from the authenticated canary session:

```ts
const { error } = await supabase.rpc('preview_direct_grant_replacement', {
  p_user_id: canaryProfileId,
  p_grants: [],
});
```

Expected: `error.code === '42501'`, message `Authorization administration permission required`, safe/null details and hint. Linked before/after aggregate remains zero grants and zero matching mutation audit events.

- [ ] **Step 8: Disable canary through normal lifecycle**

Return to preserved Admin session. Open the canary, lifecycle preview, use reason `Auth profile creation command forward-fix canary cleanup`, and disable through UI/`manage-user-account`.

Verify aggregate:

```sql
select
  count(*) filter (
    where u.account_status = 'DISABLED' and not u.is_active
  ) as disabled_profiles,
  count(distinct g.id) filter (where g.is_active) as active_direct_grants,
  count(distinct a.id) filter (
    where a.status = 'ACTIVE'
      and a.starts_at <= now()
      and (a.expires_at is null or a.expires_at > now())
  ) as active_business_roles,
  count(distinct s.id) filter (
    where s.status = 'active'
      and s.starts_at <= now()
      and (s.expires_at is null or s.expires_at > now())
  ) as active_responsibility_slots,
  count(distinct assignment.id) filter (
    where assignment.status = 'active'
      and assignment.starts_at <= now()
      and (assignment.expires_at is null or assignment.expires_at > now())
  ) as active_assignments
from public.users u
left join public.user_permission_grants g on g.user_id = u.id
left join public.principal_role_assignments a
  on a.principal_type = 'user'
 and a.principal_id = u.id
left join public.app_responsibility_slots s on s.assignee_user_id = u.id
left join public.app_assignments assignment
  on assignment.principal_type = 'user'
 and assignment.principal_id = u.id
where u.name = 'Auth Profile Command Canary 20260718';
```

Expected: `1, 0, 0, 0, 0`; Auth login is blocked. Do not delete Auth/public rows directly.

- [ ] **Step 9: Final repository and Cloud verification**

Run:

```bash
npm test
npm run lint
npm run build
npx supabase db advisors --linked --level warn --type security
npx supabase db advisors --linked --level warn --type performance
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_creation_command_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
npx supabase migration list --linked | rg "$FIX_VERSION"
git diff --check
```

Run committed smoke and inventory again. Expected: full PASS, one version aligned, command/trigger advisors have no new targeted warning, flags `false`, inventory `467`, canary disabled.

- [ ] **Step 10: Record evidence and close only the authenticated negative-actor blocker**

Update:

- `docs/security/phase02-business-role-sod-live-apply-log.md`: candidate/apply SHA, migration version/hash, committed smoke, one-version repair, Edge deployment version, creation PASS, unauthorized `42501`, cleanup and unchanged flags/inventory.
- `docs/superpowers/plans/2026-07-17-vioo-auth-profile-sync-guard-forward-fix.md`: mark Steps 6–10 complete.
- `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`: mark only authenticated negative-actor evidence complete inside Task 13 Step 5; keep Task 13 Step 5 unchecked because 467 sensitive grants remain unresolved. Do not mark Vercel, resolver cutover, compatibility cutoffs or 24-hour observation.

Run:

```bash
git add \
  docs/security/phase02-business-role-sod-live-apply-log.md \
  docs/superpowers/plans/2026-07-17-vioo-auth-profile-sync-guard-forward-fix.md \
  docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
git diff --cached --check
git commit -m "docs(auth): close profile creation command canary"
```

Expected: Task 4 forward-fix closes; parent Phase 2 remains at Task 13 Step 5 with the remaining 467 sensitive-expiry remediation and later rollout gates still open.
