# VIOO Auth Profile Sync Guard Forward-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khôi phục việc tạo Supabase Auth user qua luồng ứng dụng bằng bypass hẹp cho `supabase_auth_admin`, trong khi giữ nguyên guard của actor thường và lifecycle gate của `service_role`.

**Architecture:** Một migration forward-only sẽ thay đúng function trigger `app_private.prevent_users_privilege_self_update()` bằng định nghĩa hợp nhất từ hai migration trước. Static contract và SQL smoke kiểm tra cả ba nhánh: Auth nội bộ được phép, `service_role` chỉ được phép khi lifecycle GUC bật, actor thường vẫn bị từ chối. Supabase Cloud được kiểm tra rollback-only trước; apply và repair đúng một version chỉ diễn ra sau checkpoint phê duyệt riêng.

**Tech Stack:** PostgreSQL/PLpgSQL, Supabase Auth và linked Cloud CLI `2.95.6`, Vitest `4.1.8`, TypeScript, Chrome/in-app browser cho authenticated canary.

## Global Constraints

- Chỉ dùng Supabase Cloud; không dùng Docker, `supabase start`, `db reset --local` hoặc bất kỳ local Supabase runtime nào.
- Tạo migration bằng `npx supabase migration new auth_profile_sync_guard_forward_fix`; không tự đặt timestamp.
- Không sửa hai migration đã apply: `20260716103946_allow_auth_profile_sync_guard_bypass.sql` và `20260716170745_user_account_lifecycle_operations.sql`.
- Không dùng `supabase db push`; apply bằng explicit linked-Cloud transaction rồi repair đúng version sau khi fingerprint committed schema đã pass.
- Không apply Cloud, repair history, bật rollout flag hoặc đổi grant trước checkpoint phê duyệt riêng sau rollback-only verification.
- `session_user = 'supabase_auth_admin'` là bypass độc lập; không ghép thành điều kiện rộng với `auth.role() = 'service_role'`.
- `service_role` chỉ được bypass khi `coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'`.
- Linked SQL session hiện là role `postgres` với `rolsuper = false`; không dùng `SET SESSION AUTHORIZATION` để giả lập `supabase_auth_admin`. Rollback gate kiểm tra branch bằng definition, còn behavior thật được chứng minh bằng `auth.admin.createUser` canary sau apply.
- Function vẫn là `security definer`, `set search_path = ''` và không executable bởi `PUBLIC`, `anon`, `authenticated`.
- Không ghi email, mật khẩu, access/refresh token, Auth ID, database URL, API key hoặc service-role value vào tài liệu, chat hay output được commit.
- Ba rollout flag phải giữ `false`; 467 sensitive direct grants thiếu expiry không thuộc phạm vi forward-fix này.
- Tất cả lỗi sau apply dùng forward migration; không chỉnh migration history bằng cách đánh dấu trạng thái không khớp schema thực tế.

---

### Task 1: Viết contract RED và migration forward-fix tối thiểu

**Files:**

- Create: `lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts`
- Create: the single path resolved by `rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$'` after CLI generation
- Do not modify: `supabase/migrations/20260716103946_allow_auth_profile_sync_guard_bypass.sql`
- Do not modify: `supabase/migrations/20260716170745_user_account_lifecycle_operations.sql`

**Interfaces:**

- Consumes: trigger `app_private.prevent_users_privilege_self_update()` đã gắn với `public.users`, `public.is_admin()`, `public.current_app_user_id()` và lifecycle GUC hiện có.
- Produces: đúng một migration suffix `_auth_profile_sync_guard_forward_fix.sql`, định nghĩa hiệu lực mới của `app_private.prevent_users_privilege_self_update()`.

- [x] **Step 1: Tạo static contract trước migration**

Tạo `lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts` với toàn bộ nội dung:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir)
  .filter(file => file.endsWith('_auth_profile_sync_guard_forward_fix.sql'))
  .sort();
const migration = migrationFiles.length === 1
  ? readFileSync(join(migrationsDir, migrationFiles[0]), 'utf8')
  : '';
const normalized = migration.replace(/\s+/g, ' ').trim();

describe('auth profile sync guard forward-fix migration', () => {
  it('adds exactly one forward migration without an external transaction', () => {
    expect(migrationFiles).toHaveLength(1);
    expect(migration).not.toMatch(/^\s*begin\s*;/i);
    expect(migration).not.toMatch(/commit\s*;\s*$/i);
    expect(normalized).toMatch(
      /create or replace function app_private\.prevent_users_privilege_self_update\(\)/i,
    );
    expect(normalized).toMatch(/returns trigger/i);
    expect(normalized).toMatch(/security definer set search_path = ''/i);
  });

  it('keeps the Auth and lifecycle bypasses separate and narrow', () => {
    expect(normalized).toMatch(
      /if session_user = 'supabase_auth_admin' then return new; end if; if auth\.role\(\) = 'service_role' and coalesce\(current_setting\('app\.account_lifecycle_command', true\), ''\) = 'on' then return new; end if;/i,
    );
    expect(normalized).not.toMatch(
      /session_user = 'supabase_auth_admin'\s+or\s+auth\.role\(\) = 'service_role'/i,
    );
  });

  it('preserves normal actor and protected-field containment', () => {
    expect(normalized).toMatch(/if public\.is_admin\(\) then return new; end if;/i);
    expect(normalized).toMatch(/current_user_id := public\.current_app_user_id\(\)/i);
    expect(normalized).toContain('Only admins can update other user rows');
    expect(normalized).toContain('Self profile updates cannot change protected permission fields');
    for (const field of [
      'role',
      'auth_id',
      'email',
      'username',
      'assigned_warehouse_id',
      'allowed_modules',
      'admin_modules',
      'allowed_sub_modules',
      'admin_sub_modules',
      'is_active',
    ]) {
      expect(normalized).toMatch(
        new RegExp(`old\\.${field} is distinct from new\\.${field}`, 'i'),
      );
    }
  });

  it('retains least-privilege execute ACLs', () => {
    expect(normalized).toMatch(
      /revoke all on function app_private\.prevent_users_privilege_self_update\(\) from public, anon, authenticated/i,
    );
  });
});
```

- [x] **Step 2: Chạy test để xác nhận RED đúng nguyên nhân**

Run:

```bash
npm test -- lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts
```

Expected: FAIL tại `expect(migrationFiles).toHaveLength(1)` với received length `0`. Nếu lỗi vì TypeScript, import hoặc regex thì sửa test trước; không tạo migration để che lỗi test.

- [x] **Step 3: Tạo migration rỗng bằng CLI**

Run:

```bash
npx supabase migration new auth_profile_sync_guard_forward_fix
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
test "$(printf '%s\n' "$FIX_MIGRATION" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
printf '%s\n' "$FIX_MIGRATION"
```

Expected: CLI tạo đúng một file timestamped; biến `FIX_MIGRATION` chứa đúng một path. Không chạy tiếp nếu có zero hoặc nhiều hơn một match.

- [x] **Step 4: Thêm định nghĩa function hợp nhất tối thiểu**

Ghi đúng nội dung sau vào file do CLI tạo:

```sql
-- Restore the trusted Supabase Auth profile-sync path without broadening the
-- service-role exception introduced by the account lifecycle command.
create or replace function app_private.prevent_users_privilege_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  if session_user = 'supabase_auth_admin' then
    return new;
  end if;

  if auth.role() = 'service_role'
    and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
  then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  current_user_id := public.current_app_user_id();

  if current_user_id is null
    or old.id is distinct from current_user_id
    or new.id is distinct from current_user_id
  then
    raise exception 'Only admins can update other user rows'
      using errcode = '42501';
  end if;

  if old.role is distinct from new.role
    or old.auth_id is distinct from new.auth_id
    or old.email is distinct from new.email
    or old.username is distinct from new.username
    or old.assigned_warehouse_id is distinct from new.assigned_warehouse_id
    or old.allowed_modules is distinct from new.allowed_modules
    or old.admin_modules is distinct from new.admin_modules
    or old.allowed_sub_modules is distinct from new.allowed_sub_modules
    or old.admin_sub_modules is distinct from new.admin_sub_modules
    or old.is_active is distinct from new.is_active
  then
    raise exception 'Self profile updates cannot change protected permission fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.prevent_users_privilege_self_update()
  from public, anon, authenticated;
```

- [x] **Step 5: Chạy focused GREEN và regression contracts liền kề**

Run:

```bash
npm test -- \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts \
  lib/__tests__/userPrivilegeGuardMigration.test.ts \
  lib/__tests__/userAccountLifecycleMigration.test.ts \
  lib/__tests__/authUserProfileSyncMigration.test.ts \
  lib/__tests__/createUserEdgeFunctionContract.test.ts \
  lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts
```

Expected: sáu test files PASS. Test lịch sử `userPrivilegeGuardMigration.test.ts` vẫn mô tả migration cũ; test forward-fix mới là contract của định nghĩa hiệu lực cuối cùng.

---

### Task 2: Thêm SQL behavior smoke và khóa candidate commit

**Files:**

- Create: `supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql`
- Verify: `lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts`
- Verify: the single generated migration path ending `_auth_profile_sync_guard_forward_fix.sql`

**Interfaces:**

- Consumes: migration Task 1 và các database roles `authenticated`, `service_role` trên linked Cloud; nhánh `session_user = 'supabase_auth_admin'` được kiểm tra bằng function definition tại rollback gate và bằng Auth canary thật sau apply.
- Produces: smoke có checkpoint `auth_profile_sync_guard_forward_fix_smoke_passed`, chạy an toàn bên trong transaction rollback.

- [x] **Step 1: Tạo SQL smoke kiểm tra definition, behavior và ACL**

Tạo `supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql` với toàn bộ nội dung:

```sql
do $$
declare
  v_definition text;
begin
  select lower(regexp_replace(pg_get_functiondef(function_row.oid), '\s+', ' ', 'g'))
  into v_definition
  from pg_proc function_row
  join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
  where namespace_row.nspname = 'app_private'
    and function_row.proname = 'prevent_users_privilege_self_update'
    and function_row.pronargs = 0;

  if v_definition is null then
    raise exception 'Missing users privilege guard';
  end if;
  if position(
    'if session_user = ''supabase_auth_admin'' then return new; end if;'
    in v_definition
  ) = 0 then
    raise exception 'Missing narrow supabase_auth_admin bypass';
  end if;
  if v_definition !~
    'if auth\.role\(\) = ''service_role'' and coalesce\(current_setting\(''app\.account_lifecycle_command'', true\), ''''\) = ''on'' then return new; end if;'
  then
    raise exception 'Missing lifecycle-gated service_role bypass';
  end if;
  if v_definition ~
    'session_user = ''supabase_auth_admin''\s+or\s+auth\.role\(\) = ''service_role'''
  then
    raise exception 'Broad service_role bypass was restored';
  end if;
  if position('set search_path to ''''' in v_definition) = 0
    or position('security definer' in v_definition) = 0
  then
    raise exception 'Privilege guard lost SECURITY DEFINER or empty search_path';
  end if;
end;
$$;

create temp table auth_profile_sync_guard_fixture
on commit drop
as
select *
from public.users
limit 1;

do $$
begin
  if (select count(*) from auth_profile_sync_guard_fixture) <> 1 then
    raise exception 'Auth guard smoke requires one existing app profile';
  end if;
end;
$$;

create trigger trg_auth_profile_sync_guard_fixture
before update on auth_profile_sync_guard_fixture
for each row execute function app_private.prevent_users_privilege_self_update();

grant select, update on auth_profile_sync_guard_fixture
  to authenticated, service_role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);

do $$
begin
  begin
    update auth_profile_sync_guard_fixture set name = name;
    raise exception 'Authenticated actor bypassed the users privilege guard';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('app.account_lifecycle_command', '', true);

do $$
begin
  begin
    update auth_profile_sync_guard_fixture set name = name;
    raise exception 'service_role bypassed without lifecycle command';
  exception
    when sqlstate '42501' then null;
  end;
end;
$$;

select set_config('app.account_lifecycle_command', 'on', true);
update auth_profile_sync_guard_fixture set name = name;
reset role;

do $$
begin
  if has_function_privilege(
    'anon',
    'app_private.prevent_users_privilege_self_update()',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.prevent_users_privilege_self_update()',
    'EXECUTE'
  ) or exists (
    select 1
    from pg_proc function_row
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) acl
    where function_row.oid =
      'app_private.prevent_users_privilege_self_update()'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'Privilege guard is executable by PUBLIC, anon or authenticated';
  end if;
end;
$$;

select 'auth_profile_sync_guard_forward_fix_smoke_passed' as checkpoint;
```

- [x] **Step 2: Chạy repository verification không cần local Supabase**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
npm test -- \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts \
  lib/__tests__/userPrivilegeGuardMigration.test.ts \
  lib/__tests__/userAccountLifecycleMigration.test.ts \
  lib/__tests__/authUserProfileSyncMigration.test.ts \
  lib/__tests__/createUserEdgeFunctionContract.test.ts \
  lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts
npm run lint
git diff --check -- \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts
```

Expected: focused tests và TypeScript exit `0`; `git diff --check` không có output. Không chạy SQL smoke trực tiếp vì user không dùng local Supabase.

- [x] **Step 3: Review candidate chỉ gồm ba file implementation**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
git add \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts
git diff --cached --name-only
git diff --cached --stat
git diff --cached
```

Expected: cached name list có đúng ba path trên; không có sửa đổi Edge Function, UI, permission registry, grant, rollout setting hoặc migration cũ.

- [x] **Step 4: Commit candidate trước Cloud verification**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
test "$(git diff --cached --name-only | wc -l | tr -d ' ')" = "3"
git commit -m "fix(auth): restore trusted profile sync guard"
```

Expected: commit chứa đúng ba file; hai tài liệu Phase 2 đang dirty từ trước không bị stage.

---

### Task 3: Chạy linked-Cloud rollback-only verification và dừng tại checkpoint

**Files:**

- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Verify: the single generated migration path ending `_auth_profile_sync_guard_forward_fix.sql`
- Verify: `supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql`

**Interfaces:**

- Consumes: immutable candidate commit Task 2, linked Supabase project hiện có trong `supabase/.temp/project-ref` và credentials từ `.env`/CLI profile.
- Produces: bằng chứng RED trên committed Cloud, GREEN trong một transaction rollback, post-rollback fingerprint và checkpoint xin phép apply.

- [x] **Step 1: Reconfirm CLI, link, candidate và migration history**

Run:

```bash
npx supabase --version
test -s supabase/.temp/project-ref
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
test "$(printf '%s\n' "$FIX_MIGRATION" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
test "${#FIX_VERSION}" = "14"
npx supabase migration list --linked
git status --short
```

Expected: CLI reports `2.95.6`; version mới chưa có remote applied marker; only known documentation changes may remain dirty. Không repair hoặc apply ở bước này.

- [x] **Step 2: Capture read-only preflight without exposing identities**

Run:

```bash
npx supabase db query --linked --agent=no "
select
  md5(pg_get_functiondef('app_private.prevent_users_privilege_self_update()'::regprocedure)) as guard_hash,
  position(
    'session_user = ''supabase_auth_admin'''
    in pg_get_functiondef('app_private.prevent_users_privilege_self_update()'::regprocedure)
  ) > 0 as auth_admin_bypass_present,
  (
    select jsonb_object_agg(setting_row.key, setting_row.value order by setting_row.key)
    from app_private.permission_hardening_settings setting_row
    where setting_row.key in (
      'business_role_resolver_enabled',
      'legacy_governance_fallback_disabled',
      'system_admin_business_approval_bypass_disabled'
    )
  ) as rollout_flags,
  (
    select count(*)
    from public.user_permission_grants grant_row
    join public.permission_actions permission_row
      on permission_row.permission_code = grant_row.permission_code
    where grant_row.is_active
      and grant_row.expires_at is null
      and permission_row.risk_level = 'sensitive'
  ) as sensitive_null_expiry_grants;
"
```

Expected: `auth_admin_bypass_present = false`, ba flag đều `false`, inventory sensitive null-expiry vẫn là `467`. Chỉ ghi aggregate/fingerprint vào log.

- [x] **Step 3: Chạy RED smoke trên committed Cloud trong rollback**

Run:

```bash
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write(\"begin; set local lock_timeout='5s'; set local statement_timeout='120s'; \"+sql+\" rollback;\");" supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql)"
```

Expected: FAIL với `Missing narrow supabase_auth_admin bypass`. Vì transaction rollback, không có fixture hoặc schema change tồn tại.

- [x] **Step 4: Chạy migration + smoke GREEN trong cùng transaction rollback**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const files=process.argv.slice(1); const sql=files.map(file=>fs.readFileSync(file,'utf8')).join(' '); process.stdout.write(\"begin; set local lock_timeout='5s'; set local statement_timeout='120s'; \"+sql+\" select 'auth_profile_sync_guard_forward_fix_rollback_passed' as checkpoint; rollback;\");" "$FIX_MIGRATION" supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql)"
```

Expected: CLI hiển thị checkpoint cuối `auth_profile_sync_guard_forward_fix_rollback_passed` và exit `0`. Management API chỉ render result set cuối; việc tới được checkpoint này chứng minh smoke trước đó đã pass. SQL kết thúc bằng `ROLLBACK`, và Step 5 phải chứng minh fingerprint/history quay về preflight.

- [x] **Step 5: Prove rollback restored the original Cloud definition and history**

Run lại query Step 2 và:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
npx supabase migration list --linked | rg "$FIX_VERSION"
```

Expected: `guard_hash` bằng preflight hash, `auth_admin_bypass_present = false`, ba flag vẫn `false`, sensitive count vẫn `467`; version chỉ local/pending, không applied remote.

- [x] **Step 6: Record rollback-only evidence and commit documentation**

Thêm vào `docs/security/phase02-business-role-sod-live-apply-log.md`, thay commit SHA bằng output chính xác của `git rev-parse HEAD`:

```markdown
## Auth profile sync guard forward-fix

- Candidate commit: the immutable Task 2 implementation commit.
- Focused repository tests and TypeScript: PASS.
- Committed-Cloud RED reproduced the missing `supabase_auth_admin` bypass.
- Migration plus behavior/ACL smoke: PASS in one linked transaction ending in explicit `ROLLBACK`.
- Post-rollback guard hash matched preflight; the new migration version remained unapplied.
- Three rollout flags remained `false`; sensitive null-expiry inventory remained 467; no grant, role assignment, profile or migration-history row changed.
- Status: **Waiting for explicit operator approval to apply and repair exactly one forward-fix version.**
```

Run:

```bash
git diff --check -- docs/security/phase02-business-role-sod-live-apply-log.md
git add docs/security/phase02-business-role-sod-live-apply-log.md
git commit -m "docs(auth): record profile sync rollback verification"
```

Expected: documentation commit only. Stop and request explicit operator approval; do not start Task 4 in the same approval window.

---

### Task 4: Apply one version, run authenticated canaries and close the blocker

**Prerequisite:** Operator explicitly approves applying and repairing the one forward-fix version after reviewing Task 3 evidence.

**Files:**

- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`
- Modify: `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`
- Verify: the single generated migration path ending `_auth_profile_sync_guard_forward_fix.sql`
- Verify: `supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql`

**Interfaces:**

- Consumes: approved immutable migration candidate and authenticated Admin session.
- Produces: committed Cloud function, exactly one repaired migration version, successful disposable-user creation, unauthorized `42501` canary, disabled canary account and updated Phase 2 evidence.

- [x] **Step 1: Reconfirm approval, candidate SHA and unchanged preflight**

Run the Task 3 Step 1 and Step 2 commands again.

Expected: candidate migration has not changed since rollback verification; `auth_admin_bypass_present = false`; version is not remote-applied; flags are all `false`; sensitive null-expiry count is `467`. Stop on any drift.

- [x] **Step 2: Apply only the forward-fix in one explicit transaction**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write(\"begin; set local lock_timeout='5s'; set local statement_timeout='120s'; \"+sql+\" select 'auth_profile_sync_guard_forward_fix_applied' as checkpoint; commit;\");" "$FIX_MIGRATION")"
```

Expected: checkpoint `auth_profile_sync_guard_forward_fix_applied`, explicit `COMMIT`, exit `0`. Không chạy bất kỳ migration khác.

- [x] **Step 3: Verify committed schema before migration-history repair**

Run:

```bash
npx supabase db query --linked --agent=no "$(node -e "const fs=require('fs'); const sql=fs.readFileSync(process.argv[1],'utf8'); process.stdout.write(\"begin; set local lock_timeout='5s'; set local statement_timeout='120s'; \"+sql+\" select 'auth_profile_sync_guard_forward_fix_committed_smoke_passed' as checkpoint; rollback;\");" supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql)"
```

Run Task 3 Step 2 read-only inventory again.

Expected: committed smoke PASS; `auth_admin_bypass_present = true`; ba flags vẫn `false`; sensitive null-expiry count vẫn `467`. Nếu fingerprint/behavior sai, không repair history; dừng và lập forward migration.

- [x] **Step 4: Repair exactly one verified migration version**

Run:

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
FIX_VERSION="$(basename "$FIX_MIGRATION" | cut -d_ -f1)"
npx supabase migration repair "$FIX_VERSION" \
  --status applied \
  --linked \
  --workdir . \
  --yes
npx supabase migration list --linked | rg "$FIX_VERSION"
```

Expected: đúng version mới có local và remote marker aligned. Không repair version nào khác.

- [x] **Step 5: Run scoped Cloud advisors**

Run:

```bash
npx supabase db advisors --linked --level warn --type security
npx supabase db advisors --linked --level warn --type performance
```

Expected: không có warning mới trỏ tới `app_private.prevent_users_privilege_self_update`. Baseline warning ngoài phạm vi chỉ ghi nhận, không sửa kèm forward-fix.

- [ ] **Step 6: Create a zero-right disposable user through the application**

> Blocked on 2026-07-18 after two authenticated UI attempts. The Auth-admin
> guard branch is committed, but the subsequent `create-user` service-role
> PostgREST upsert is rejected with SQLSTATE `42501`. The Edge Function cleans
> up both the Auth account and app profile. Continue only through a separately
> reviewed forward fix; do not edit migration `20260718012151`.

Trong authenticated Admin browser session:

1. Mở màn hình Cài đặt người dùng và chọn tạo nhân viên mới.
2. Dùng email/username/password ngẫu nhiên chỉ tồn tại trong phiên browser; không chụp hoặc ghi vào log/chat.
3. Chọn role nền `EMPLOYEE`; không chọn legacy module/submodule, Business Role hoặc direct grant.
4. Submit một lần qua luồng ứng dụng hiện có.
5. Ghi lại duy nhất app profile ID trong biến tạm của browser runtime, không ghi Auth ID hoặc credential.
6. Xác nhận UI trả thành công và linked read-only aggregate cho thấy đúng một active profile có `auth_id` khác null, zero direct grant và zero active Business Role assignment.

Expected: lỗi công khai `Không thể xử lý yêu cầu tài khoản.` không còn xuất hiện; Auth user và `public.users` profile liên kết thành công.

- [ ] **Step 7: Run unauthorized Data API canary as the disposable user**

1. Đăng xuất Admin và đăng nhập tài khoản canary.
2. Xác nhận profile tải được nhưng không thấy/không truy cập được quản trị phân quyền.
3. Từ chính authenticated canary session, gọi RPC `preview_direct_grant_replacement` với payload:

```ts
{
  p_user_id: canaryProfileId,
  p_grants: [],
}
```

Trong đó `canaryProfileId: string` là app profile ID chỉ giữ trong browser runtime từ response tạo user ở Step 6.

4. Inspect PostgREST response nhưng không copy bearer token.

Expected: code `42501`, message `Authorization administration permission required`, `details` và `hint` không lộ SQL/schema/function/principal identifiers; zero grant và zero audit mutation trước/sau.

- [ ] **Step 8: Disable the canary through the normal account lifecycle**

1. Đăng xuất canary và đăng nhập lại Admin.
2. Mở profile canary, xem lifecycle preview, nhập lý do `Auth profile sync forward-fix canary cleanup`.
3. Chọn vô hiệu hóa qua UI/`manage-user-account`; không xóa trực tiếp `auth.users` hoặc `public.users`.
4. Xác nhận app profile có `account_status = 'DISABLED'`, `is_active = false`, zero active grant/role/assignment và Auth login bị chặn.

Expected: cleanup hoàn tất qua account lifecycle có audit; không để lại active disposable principal.

- [ ] **Step 9: Run final repository and Cloud verification**

Run:

```bash
npm test
npm run lint
npm run build
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_sync_guard_forward_fix\.sql$')"
git diff --check -- \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_sync_guard_forward_fix_smoke.sql \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts \
  docs/security/phase02-business-role-sod-live-apply-log.md \
  docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
```

Run lại committed Cloud smoke, inventory và `migration list` từ Steps 3–4.

Expected: full tests, TypeScript và build exit `0`; Cloud smoke PASS; exactly one new version aligned; flags all `false`; sensitive null-expiry count unchanged; canary disabled.

- [ ] **Step 10: Record evidence, update parent checkpoint and commit docs**

Trong `docs/security/phase02-business-role-sod-live-apply-log.md`, ghi:

- candidate/apply commit SHA và migration version;
- committed smoke/advisor result;
- one-version repair evidence;
- create-user success, unauthorized `42501` envelope và canary cleanup;
- confirmation flags/grant inventory unchanged;
- remaining blocker is 467 sensitive grants needing business-owner expiry remediation, không còn là disposable-account creation.

Trong `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`, cập nhật Task 13 checkpoint để chỉ đánh dấu phần authenticated negative-actor canary đã pass; không đánh dấu resolver cutover, expiry remediation, Vercel promotion hoặc 24-hour observation.

Run:

```bash
git diff --check -- \
  docs/security/phase02-business-role-sod-live-apply-log.md \
  docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
git add \
  docs/security/phase02-business-role-sod-live-apply-log.md \
  docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md
git commit -m "docs(auth): close profile sync guard canary"
```

Expected: documentation commit records only evidence actually observed. Phase 2 remains open at sensitive-grant remediation and later resolver/cutoff gates.
