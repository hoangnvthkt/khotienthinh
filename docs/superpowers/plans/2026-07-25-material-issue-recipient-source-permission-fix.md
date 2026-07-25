# Material Issue Recipient Source Permission Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép thủ kho tạo và gửi phiếu xuất cấp có nguồn hợp đồng/đối tác mà không cần quyền `UPDATE` trực tiếp trên `material_issue_orders`, đồng thời tự mở bảng trạng thái của phiếu mới.

**Architecture:** Mở rộng RPC `create_material_issue_order` để nhận và ghi hai trường nguồn ngay trong câu `INSERT`, sau đó frontend chỉ gọi RPC và không cập nhật bảng trực tiếp. Giữ nguyên luồng submit hiện tại, nhưng tải lại danh sách khi lỗi và mở rộng phiếu vừa tạo khi thành công.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase JS 2.98, PostgreSQL/RLS/RPC, Vite 6.

## Global Constraints

- Không cấp `INSERT`, `UPDATE` hoặc `DELETE` trực tiếp trên `public.material_issue_orders` cho `authenticated`.
- Không huỷ, xoá hoặc chỉnh sửa năm phiếu nháp của Nguyễn Văn Luật phát sinh ngày 25/07/2026.
- Không tạo phiếu nghiệp vụ thử trên production.
- Migration phải được tạo bằng `npx supabase migration new`, không tự đặt timestamp.
- Chỉ commit các file thuộc bản sửa lỗi; giữ nguyên các thay đổi đang có trong `pages/Inventory.tsx`, `lib/inventoryNumberFormat.ts` và `lib/__tests__/inventoryNumberFormat.test.ts`.

---

### Task 1: Viết contract tests tái hiện hồi quy

**Files:**

- Create: `lib/__tests__/materialIssueCreatePermissionRegression.test.ts`
- Create: `lib/__tests__/materialIssueRecipientSourceMigration.test.ts`

**Interfaces:**

- Consumes: `lib/materialIssueService.ts`, `components/project/MaterialIssuePanel.tsx`, migration có hậu tố `_material_issue_recipient_source_atomic_create.sql`.
- Produces: contract đỏ cho payload RPC, loại bỏ direct update, auto-expand UI và chữ ký RPC an toàn.

- [ ] **Step 1: Viết test đỏ cho service và UI**

Tạo `lib/__tests__/materialIssueCreatePermissionRegression.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(join(process.cwd(), 'lib/materialIssueService.ts'), 'utf8');
const panel = readFileSync(join(process.cwd(), 'components/project/MaterialIssuePanel.tsx'), 'utf8');

describe('material issue create permission regression', () => {
  it('passes recipient source through the create RPC without a direct table update', () => {
    expect(service).toContain('p_recipient_source_type: input.recipientSourceType || null');
    expect(service).toContain('p_recipient_source_id: input.recipientSourceId || null');
    expect(service).not.toMatch(/\\.from\\(ORDER_TABLE\\)[\\s\\S]{0,300}\\.update\\(\\{[\\s\\S]{0,200}recipient_source_type/);
  });

  it('expands a successful order and refreshes orders after an error', () => {
    expect(panel).toContain('setExpandedOrderIds(prev => new Set([...prev, created.id]))');
    const catchBlock = panel.slice(
      panel.indexOf(\"logApiError('materialIssueService.createAndSubmit'\"),
      panel.indexOf('} finally {', panel.indexOf(\"logApiError('materialIssueService.createAndSubmit'\")),
    );
    expect(catchBlock).toContain('void loadOrders()');
  });
});
```

- [ ] **Step 2: Viết test đỏ cho migration**

Tạo `lib/__tests__/materialIssueRecipientSourceMigration.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationDir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const migrationName = readdirSync(migrationDir)
  .find(name => name.endsWith('_material_issue_recipient_source_atomic_create.sql'));

describe('material issue recipient source migration', () => {
  it('stores recipient source inside the security-definer create RPC', () => {
    expect(migrationName).toBeTruthy();
    const migration = readFileSync(`${migrationDir}/${migrationName}`, 'utf8');
    expect(migration).toContain('p_recipient_source_type text default null');
    expect(migration).toContain('p_recipient_source_id text default null');
    expect(migration).toContain('recipient_source_type, recipient_source_id');
    expect(migration).toContain('p_recipient_source_type, nullif(p_recipient_source_id');
    expect(migration).toContain(\"p_recipient_source_type not in ('supplier_contract', 'business_partner')\");
  });

  it('preserves table least privilege and grants only the new RPC signature', () => {
    expect(migrationName).toBeTruthy();
    const migration = readFileSync(`${migrationDir}/${migrationName}`, 'utf8');
    expect(migration).not.toMatch(/grant\\s+update\\s+on\\s+(table\\s+)?public\\.material_issue_orders/i);
    expect(migration).toContain('grant execute on function public.create_material_issue_order(');
    expect(migration).toContain('to authenticated');
    expect(migration).toContain(\"notify pgrst, 'reload schema'\");
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận RED**

Run:

```bash
npm test -- lib/__tests__/materialIssueCreatePermissionRegression.test.ts lib/__tests__/materialIssueRecipientSourceMigration.test.ts
```

Expected: FAIL vì service chưa truyền hai tham số, frontend chưa auto-expand/refresh và migration chưa tồn tại.

---

### Task 2: Tạo migration RPC và smoke test production-safe

**Files:**

- Create: file do `npx supabase migration new material_issue_recipient_source_atomic_create` sinh ra trong `supabase/migrations/`.
- Create: `supabase/tests/material_issue_recipient_source_permission_smoke.sql`

**Interfaces:**

- Consumes: hàm hiện tại trong `supabase/migrations/20260605145231_material_external_issue_v1.sql`.
- Produces: `public.create_material_issue_order(..., p_lines jsonb, p_recipient_source_type text default null, p_recipient_source_id text default null)`.

- [ ] **Step 1: Kiểm tra CLI và tạo migration đúng chuẩn**

Run:

```bash
npx supabase --version
npx supabase migration new material_issue_recipient_source_atomic_create
```

Expected: CLI in phiên bản dự án tạo đúng một file migration có hậu tố `_material_issue_recipient_source_atomic_create.sql`.

- [ ] **Step 2: Viết migration tối thiểu**

Migration phải:

1. `drop function if exists` chữ ký 13 tham số cũ.
2. Tạo lại `security definer`, `set search_path = ''` với toàn bộ thân hàm hiện tại.
3. Thêm hai tham số cuối có default `null`.
4. Kiểm tra nguồn hợp lệ và yêu cầu type/id cùng có hoặc cùng không.
5. Thêm `recipient_source_type, recipient_source_id` vào `INSERT`.
6. `revoke all` từ `public, anon`, `grant execute` cho `authenticated`.
7. Gọi `notify pgrst, 'reload schema'`.

Phần thay đổi trọng tâm:

```sql
if p_recipient_source_type is not null
   and p_recipient_source_type not in ('supplier_contract', 'business_partner') then
  raise exception 'Nguồn bên nhận không hợp lệ.';
end if;
if (p_recipient_source_type is null)
   <> (nullif(trim(coalesce(p_recipient_source_id, '')), '') is null) then
  raise exception 'Nguồn bên nhận phải có đủ loại và mã tham chiếu.';
end if;

insert into public.material_issue_orders(
  ...,
  recipient_source_type, recipient_source_id
) values (
  ...,
  p_recipient_source_type,
  nullif(trim(coalesce(p_recipient_source_id, '')), '')
);
```

- [ ] **Step 3: Viết smoke test chỉ đọc**

`supabase/tests/material_issue_recipient_source_permission_smoke.sql` phải chạy trong `begin`/`rollback` và assert:

- chữ ký RPC 15 tham số tồn tại;
- định nghĩa hàm chứa hai cột nguồn;
- `authenticated` có `EXECUTE` trên chữ ký mới;
- `authenticated` có `SELECT` nhưng không có `UPDATE` trên bảng;
- user Nguyễn Văn Luật vẫn active, là `WAREHOUSE_KEEPER` và được gán `Kho Sơn Miền Bắc`;
- năm phiếu nháp ngày 25/07/2026 không bị thay đổi.

- [ ] **Step 4: Chạy contract tests để xác nhận migration GREEN, UI/service vẫn RED**

Run:

```bash
npm test -- lib/__tests__/materialIssueCreatePermissionRegression.test.ts lib/__tests__/materialIssueRecipientSourceMigration.test.ts
```

Expected: migration tests PASS; service/UI test vẫn FAIL đúng hai assertion chưa triển khai.

---

### Task 3: Sửa service và bảng trạng thái theo TDD

**Files:**

- Modify: `lib/materialIssueService.ts:224-253`
- Modify: `components/project/MaterialIssuePanel.tsx:547-590`
- Test: `lib/__tests__/materialIssueCreatePermissionRegression.test.ts`

**Interfaces:**

- Consumes: chữ ký RPC mới của Task 2.
- Produces: create payload không direct update; UI tự mở phiếu mới và refresh khi create/submit lỗi.

- [ ] **Step 1: Truyền nguồn vào RPC và bỏ direct update**

Trong `createDraft`, thêm:

```ts
p_recipient_source_type: input.recipientSourceType || null,
p_recipient_source_id: input.recipientSourceId || null,
```

Xóa toàn bộ block:

```ts
if (input.recipientSourceType && input.recipientSourceId) {
  await supabase.from(ORDER_TABLE).update(...);
}
```

- [ ] **Step 2: Mở rộng phiếu mới và refresh ở nhánh lỗi**

Sau khi `createAndSubmit` trả về:

```ts
setExpandedOrderIds(prev => new Set([...prev, created.id]));
```

Trong `catch`, sau `logApiError`:

```ts
void loadOrders();
```

- [ ] **Step 3: Chạy targeted tests để xác nhận GREEN**

Run:

```bash
npm test -- lib/__tests__/materialIssueCreatePermissionRegression.test.ts lib/__tests__/materialIssueRecipientSourceMigration.test.ts lib/__tests__/materialIssueRecipientSource.test.ts
```

Expected: toàn bộ targeted tests PASS.

- [ ] **Step 4: Kiểm tra diff phạm vi**

Run:

```bash
git diff --check
git status --short
```

Expected: chỉ có các file bản sửa lỗi cộng với ba thay đổi có sẵn của người dùng; không có chỉnh sửa ngoài phạm vi.

---

### Task 4: Kiểm chứng, áp dụng production và phát hành frontend

**Files:**

- Test: `supabase/tests/material_issue_recipient_source_permission_smoke.sql`
- Modify only if verification finds a scoped defect: files from Tasks 1–3.

**Interfaces:**

- Consumes: migration, service và UI đã GREEN.
- Produces: schema production đã nâng cấp, commit/push frontend chính xác, bằng chứng quyền và build.

- [ ] **Step 1: Chạy đầy đủ local verification**

Run:

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: tất cả tests PASS, TypeScript exit 0, Vite production build exit 0, không có whitespace error.

- [ ] **Step 2: Kiểm tra lệnh Supabase trước khi áp dụng**

Run:

```bash
npx supabase db push --help
npx supabase migration list --linked
```

Expected: xác nhận linked project và migration mới đang pending đúng một lần.

- [ ] **Step 3: Áp dụng migration production**

Run:

```bash
npx supabase db push --linked --yes
```

Expected: migration `_material_issue_recipient_source_atomic_create.sql` được áp dụng thành công, không áp dụng migration ngoài dự kiến.

- [ ] **Step 4: Chạy smoke test production-safe**

Run:

```bash
set -a
source .env
set +a
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "$(cat supabase/.temp/pooler-url)" \
  -X -v ON_ERROR_STOP=1 \
  -f supabase/tests/material_issue_recipient_source_permission_smoke.sql
```

Expected: exit 0; mọi assertion quyền/RPC/user/draft đều PASS và transaction rollback.

- [ ] **Step 5: Commit đúng phạm vi**

Run:

```bash
git add \
  components/project/MaterialIssuePanel.tsx \
  lib/materialIssueService.ts \
  lib/__tests__/materialIssueCreatePermissionRegression.test.ts \
  lib/__tests__/materialIssueRecipientSourceMigration.test.ts \
  supabase/migrations/*_material_issue_recipient_source_atomic_create.sql \
  supabase/tests/material_issue_recipient_source_permission_smoke.sql
git diff --cached --check
git commit -m "fix(wms): create material issue source through RPC"
```

Expected: commit không chứa `pages/Inventory.tsx`, `lib/inventoryNumberFormat.ts` hoặc test liên quan.

- [ ] **Step 6: Push `main` để kích hoạt Vercel Git production workflow**

Run:

```bash
git push origin main
```

Expected: push thành công đúng commit đã kiểm chứng; thay đổi chưa commit của người dùng không được đưa lên remote.

- [ ] **Step 7: Xác minh sau phát hành**

Chạy lại smoke SQL và truy vấn read-only mô phỏng JWT Nguyễn Văn Luật:

```sql
begin;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"e9be7010-cbb9-4cf1-9d5a-8ec558ec5d99","role":"authenticated","email":"luatnv@tienthinhjsc.vn"}',
  true
);
select public.current_app_user_id();
select count(*) from public.material_issue_orders
where source_warehouse_id = 'wh-1773110380822-zm5oj';
rollback;
```

Expected: actor đúng Nguyễn Văn Luật, danh sách kho vẫn đọc được, `authenticated` vẫn không có `UPDATE`, năm phiếu nháp cũ giữ nguyên.
