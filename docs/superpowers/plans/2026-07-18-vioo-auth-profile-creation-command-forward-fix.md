# Minimal Auth Profile Creation Forward-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:executing-plans` and `superpowers:test-driven-development`.
> Execute inline, task-by-task, and stop at the Cloud mutation checkpoint.

**Goal:** Khôi phục chức năng Admin tạo tài khoản và ngăn Auth
`raw_user_meta_data` sửa role/quyền, chỉ bằng thay đổi tối thiểu cần thiết để gỡ
blocker Task 13 Step 5.

**Architecture:** `create-user` tiếp tục dùng service role cho Supabase Auth
Admin API, nhưng lần cập nhật protected profile chạy bằng JWT của Admin đang gọi
Edge Function nên đi qua RLS/guard hiện hữu. Một forward migration hẹp thay định
nghĩa `sync_auth_user_profile()` để metadata chỉ đồng bộ `name`, `phone`,
`avatar`; profile mới luôn bắt đầu là `EMPLOYEE` không có quyền.

**Tech Stack:** Supabase Cloud Postgres/Auth/Edge Functions, PL/pgSQL,
`@supabase/supabase-js`, Vitest, TypeScript, Supabase CLI.

## Global Constraints

- Chỉ dùng Supabase Cloud; không dùng Docker, `supabase start`, `--local` hoặc
  local database reset.
- Không sửa bất kỳ migration đã apply nào.
- Tạo đúng một migration mới bằng `npx supabase migration new
  auth_profile_safe_metadata_sync`.
- Không tạo command RPC, public wrapper, snapshot, compensation framework hoặc
  audit event mới.
- Không mở bypass rộng cho `service_role`.
- Không đưa role, username, warehouse, legacy module/submodule, direct grant
  hoặc Business Role vào `user_metadata`/`raw_user_meta_data`.
- Không bật ba rollout flag; sensitive-null-expiry inventory phải giữ `467`.
- Không apply/repair/deploy Cloud trước rollback-only gate và approval riêng.
- Mỗi production change phải có test RED được quan sát trước GREEN.
- Giữ nguyên thay đổi dirty có sẵn trong
  `docs/superpowers/plans/2026-07-17-vioo-business-role-minimal-sod.md`.

---

### Task 1: Baseline và xác nhận root cause

**Files:**

- Verify: `supabase/functions/create-user/index.ts`
- Verify: `supabase/migrations/20260718012151_auth_profile_sync_guard_forward_fix.sql`
- Verify: `supabase/migrations/20260516135817_harden_user_crud_auth.sql`

**Interfaces:**

- Consumes: production error SQLSTATE `42501` tại direct profile write.
- Produces: evidence rằng Auth creation không phải lỗi; service-role protected
  write là boundary sai, còn authenticated Admin RLS là boundary đã có.

- [ ] **Step 1: Chạy focused baseline**

```bash
git status --short
git branch --show-current
git rev-parse HEAD
npm test -- \
  lib/__tests__/authUserProfileSyncMigration.test.ts \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts \
  lib/__tests__/createUserEdgeFunctionContract.test.ts \
  lib/__tests__/adminEdgeFunctionAuthorizationContract.test.ts \
  lib/__tests__/userAccountCreation.test.ts
npm run lint
```

Expected: focused tests/lint PASS; chỉ parent plan dirty đã biết còn unstaged.

- [ ] **Step 2: Ghi nhận data-flow boundary**

Xác nhận bằng source:

1. `requireActiveAdmin(req, admin)` đã xác thực caller.
2. `admin.auth.admin.createUser(...)` tạo Auth user và trigger tạo/liên kết
   `public.users`.
3. `admin.from('users').upsert(...)` chạy với service role ngoài lifecycle
   command và bị guard từ chối.
4. `users_select` và `users_update` đã cho authenticated Admin đọc/cập nhật.

Không sửa code hoặc Cloud trong Task này.

---

### Task 2: TDD chuyển protected profile update sang caller Admin RLS

**Files:**

- Modify: `lib/__tests__/createUserEdgeFunctionContract.test.ts`
- Modify: `supabase/functions/create-user/index.ts`

**Interfaces:**

- Consumes: `Authorization: Bearer <user-jwt>` của request và
  `SUPABASE_ANON_KEY` có sẵn trong Edge runtime.
- Produces: caller-scoped Supabase client; Auth Admin API vẫn dùng admin client;
  profile update đi qua RLS và trả `profileId` như cũ.

- [ ] **Step 1: Viết RED contract**

Thay các assertion direct-upsert/cleanup cũ bằng contract yêu cầu:

```ts
it('updates the trigger-linked profile through the caller Admin RLS context', () => {
  expect(normalized).toContain("Deno.env.get('SUPABASE_ANON_KEY')");
  expect(normalized).toContain("req.headers.get('Authorization')");
  expect(normalized).toContain('const callerClient = createClient');
  expect(normalized).toMatch(/callerClient[\s\S]*from\('users'\)[\s\S]*\.update\(/);
  expect(normalized).toContain(".eq('auth_id', data.user.id)");
  expect(normalized).not.toMatch(/admin\.from\('users'\)\.upsert/);
});

it('keeps protected authorization fields out of Auth user metadata', () => {
  const createStart = source.indexOf('admin.auth.admin.createUser');
  const createEnd = source.indexOf('});', createStart);
  const authCreate = source.slice(createStart, createEnd);
  for (const field of [
    'role', 'username', 'assignedWarehouseId', 'allowedModules',
    'adminModules', 'allowedSubModules', 'adminSubModules', 'isActive',
  ]) expect(authCreate).not.toContain(field);
});
```

- [ ] **Step 2: Chạy RED**

```bash
npm test -- lib/__tests__/createUserEdgeFunctionContract.test.ts
```

Expected: FAIL vì source hiện còn `admin.from('users').upsert(...)` và chưa có
caller-scoped client.

- [ ] **Step 3: Viết GREEN tối thiểu**

Trong `create-user/index.ts`:

1. Import `createClient` từ `@supabase/supabase-js`.
2. Sau `requireActiveAdmin`, tạo client bằng `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` và nguyên `Authorization` header của request.
3. Sau khi trigger trả linked profile, dùng `callerClient.from('users').update`
   để ghi `name`, `email`, `username`, `phone`, `role`, `avatar`, warehouse và
   bốn legacy permission fields; bind cả `id` và `auth_id`.
4. Giữ cleanup hiện hữu nếu update lỗi; không thêm cơ chế mới.

Caller client phải dùng cấu hình:

```ts
const callerClient = createClient(supabaseUrl, anonKey, {
  global: { headers: { Authorization: authorization } },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 4: Chạy GREEN và regression**

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

Expected: PASS; không còn service-role direct upsert.

- [ ] **Step 5: Commit Edge fix**

```bash
git add \
  lib/__tests__/createUserEdgeFunctionContract.test.ts \
  supabase/functions/create-user/index.ts
git diff --cached --check
git commit -m "fix(auth): write created profile through admin RLS"
```

---

### Task 3: TDD giới hạn Auth metadata sync

**Files:**

- Create: `lib/__tests__/authProfileSafeMetadataSyncMigration.test.ts`
- Create: `supabase/migrations/*_auth_profile_safe_metadata_sync.sql`
- Create: `supabase/tests/auth_profile_safe_metadata_sync_smoke.sql`

**Interfaces:**

- Consumes: final applied definition của `public.sync_auth_user_profile()`.
- Produces: trigger chỉ đọc `name`, `phone`, `avatar`; insert mới dùng
  `EMPLOYEE`, empty arrays/maps và `ACTIVE`; update profile có sẵn không chạm
  protected fields.

- [ ] **Step 1: Viết RED migration contract**

Test phải tìm đúng một suffix `_auth_profile_safe_metadata_sync.sql`, trích
definition `sync_auth_user_profile()` và assert:

```ts
for (const key of [
  'role', 'username', 'assignedWarehouseId', 'allowedModules',
  'adminModules', 'allowedSubModules', 'adminSubModules',
  'isActive', 'accountStatus',
]) {
  expect(syncDefinition).not.toContain(`raw_user_meta_data ->> '${key}'`);
  expect(syncDefinition).not.toContain(`raw_user_meta_data -> '${key}'`);
  expect(syncDefinition).not.toContain(`raw_user_meta_data ? '${key}'`);
}
expect(syncDefinition).toContain("new.raw_user_meta_data ->> 'name'");
expect(syncDefinition).toContain("new.raw_user_meta_data ->> 'phone'");
expect(syncDefinition).toContain("new.raw_user_meta_data ->> 'avatar'");
expect(syncDefinition).toMatch(/'EMPLOYEE'::public\.user_role/i);
expect(syncDefinition).toMatch(/'\{\}'::text\[\]/i);
expect(syncDefinition).toMatch(/'\{\}'::jsonb/i);
```

- [ ] **Step 2: Chạy RED**

```bash
npm test -- lib/__tests__/authProfileSafeMetadataSyncMigration.test.ts
```

Expected: FAIL vì forward migration chưa tồn tại.

- [ ] **Step 3: Tạo migration bằng CLI**

```bash
npx supabase migration new auth_profile_safe_metadata_sync
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_safe_metadata_sync\.sql$')"
test "$(printf '%s\n' "$FIX_MIGRATION" | sed '/^$/d' | wc -l | tr -d ' ')" = "1"
```

- [ ] **Step 4: Viết safe trigger replacement**

Giữ logic link theo `auth_id` rồi email và collision-safe username mặc định từ
email. Với profile có sẵn, chỉ update `auth_id`, `name`, `email`, `phone`,
`avatar`, `updated_at`. Với profile mới, insert:

```sql
role = 'EMPLOYEE'::public.user_role,
assigned_warehouse_id = null,
allowed_modules = '{}'::text[],
admin_modules = '{}'::text[],
allowed_sub_modules = '{}'::jsonb,
admin_sub_modules = '{}'::jsonb,
is_active = true,
account_status = 'ACTIVE'
```

Không đọc protected key nào từ `new.raw_user_meta_data`.

- [ ] **Step 5: Viết SQL smoke định nghĩa**

`auth_profile_safe_metadata_sync_smoke.sql` dùng `pg_get_functiondef` để từ
chối mọi protected key, xác nhận ba display key và trả checkpoint:

```sql
select 'auth_profile_safe_metadata_sync_smoke_passed' as checkpoint;
```

- [ ] **Step 6: Chạy GREEN và regression**

```bash
npm test -- \
  lib/__tests__/authProfileSafeMetadataSyncMigration.test.ts \
  lib/__tests__/authUserProfileSyncMigration.test.ts \
  lib/__tests__/authProfileSyncGuardForwardFixMigration.test.ts
npm run lint
git diff --check -- \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_safe_metadata_sync_smoke.sql \
  lib/__tests__/authProfileSafeMetadataSyncMigration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit migration candidate**

```bash
git add \
  lib/__tests__/authProfileSafeMetadataSyncMigration.test.ts \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_safe_metadata_sync_smoke.sql
git diff --cached --check
git commit -m "fix(auth): restrict profile sync to safe metadata"
```

---

### Task 4: Candidate verification và linked-Cloud rollback gate

**Files:**

- Verify: all Task 2–3 files
- Modify: `docs/security/phase02-business-role-sod-live-apply-log.md`

- [ ] **Step 1: Chạy full repository verification**

```bash
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected: PASS; parent Phase 2 plan dirty vẫn unstaged.

- [ ] **Step 2: Capture candidate và Cloud preflight read-only**

Ghi SHA, migration version/hash; xác nhận version pending, ba flags `false`,
sensitive-null-expiry inventory `467`. Không log identity/credential.

- [ ] **Step 3: Chạy migration + smoke trong linked transaction rollback**

```bash
FIX_MIGRATION="$(rg --files supabase/migrations | rg '_auth_profile_safe_metadata_sync\.sql$')"
BUNDLE="$(mktemp /tmp/auth-profile-safe-sync.XXXXXX)"
trap 'rm -f "$BUNDLE"' EXIT
node -e "const fs=require('fs'); const out=process.argv[1]; const files=process.argv.slice(2); const sql=files.map(f=>fs.readFileSync(f,'utf8')).join('\n'); fs.writeFileSync(out, \"begin; set local lock_timeout='5s'; set local statement_timeout='120s';\\n\"+sql+\"\\nselect 'auth_profile_safe_sync_rollback_passed' as checkpoint; rollback;\\n\", {mode:0o600});" \
  "$BUNDLE" \
  "$FIX_MIGRATION" \
  supabase/tests/auth_profile_safe_metadata_sync_smoke.sql
npx supabase db query --linked --agent=no --file "$BUNDLE"
```

Expected: smoke checkpoint và rollback checkpoint PASS; post-check sync hash,
history, flags và inventory khớp preflight.

- [ ] **Step 4: Ghi evidence và commit**

Chỉ ghi aggregate/hash/SHA/version vào live apply log, rồi commit documentation.

- [ ] **Step 5: Stop tại approval checkpoint**

Trình exact candidate SHA, migration version/hash, repository PASS và linked
rollback PASS. Không apply, repair hoặc deploy trong cùng approval window.

---

### Task 5: Sau approval — apply, deploy và canary

**Prerequisite:** Operator duyệt exact SHA/version/hash từ Task 4.

- [ ] Apply đúng một migration trong explicit transaction.
- [ ] Chạy committed smoke rồi repair đúng một version.
- [ ] Deploy đúng Edge Function `create-user`, giữ JWT verification.
- [ ] Tạo một zero-right `EMPLOYEE` canary qua UI; expected linked profile `1`,
  active direct grants `0`, active Business Roles `0`.
- [ ] Đăng nhập canary và xác nhận governance RPC bị từ chối `42501`, zero
  mutation.
- [ ] Disable canary qua account lifecycle chuẩn; không xóa trực tiếp.
- [ ] Chạy full verification/advisors; flags vẫn `false`, inventory vẫn `467`.
- [ ] Cập nhật evidence: chỉ đóng authenticated negative-actor blocker; Task 13
  Step 5 vẫn mở do `467` sensitive grants.
