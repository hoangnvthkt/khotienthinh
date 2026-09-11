# Authorization V2 Module-First Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay ma trận quyền phẳng bằng editor theo Module, trong đó tích Module tự chọn đúng gói quyền Xem của các phân hệ, đồng thời sửa validation lưu và lỗi mở nhầm route HR.

**Architecture:** Supabase Cloud là nguồn catalog authoritative qua RPC có guard quản trị; mapping gói Xem được lưu tường minh trong `app_private`. Frontend tải catalog, dùng model thuần để tạo/xóa direct grants, rồi lưu nguyên tử qua RPC V2 hiện có. Route HR kiểm tra capability riêng cho từng màn hình; RLS/RPC tiếp tục là authority dữ liệu.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase JS 2.98, PostgreSQL/Supabase Cloud, Tailwind classes hiện có.

**Spec:** `docs/superpowers/specs/2026-09-11-authorization-v2-module-first-editor-design.md`

## Global Constraints

- Làm trên Git branch `feature/audit-phan-quyen-v2` và Supabase Cloud branch `main`, project ref `ftciqmqhmfvjtwoycswe`.
- Không dùng Supabase local hoặc Docker; mọi SQL thử nghiệm phải chạy trong transaction rollback trên Cloud trước khi apply.
- Không triển khai lại 7 Room đã cutover và không thay thiết kế Room Dự án.
- Tích Module chỉ thêm gói Xem tường minh; không tự cấp Tạo/Sửa/Xóa/Duyệt/Quản trị.
- `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract`: non-admin chỉ đọc, admin vẫn ghi theo rule server hiện tại.
- User thường chỉ đọc chấm công và bảng lương của chính mình; không nới RLS/RPC HRM.
- Không stage các thay đổi không thuộc checkpoint đang thực hiện.
- Repository này không cho dùng sub-agent; khi thực thi phải dùng `superpowers:executing-plans` bằng agent chính.
- Mỗi checkpoint phải có failing test trước, targeted test sau, `git diff --check` và commit riêng.
- Migration chỉ được tạo bằng `npx --no-install supabase migration new <name>`; không tự đặt timestamp.
- Vai trò nghiệp vụ tiếp tục được gán qua luồng hiện có; editor này hiển thị quyền
  kế thừa và nguồn vai trò, không tạo một cơ chế gán vai trò thứ hai.

---

## File map

- `supabase/migrations/*_authorization_v2_module_first_catalog.sql`: metadata direct-assignable, mapping default-view và RPC catalog.
- `supabase/tests/authorization_v2_module_first_catalog_smoke.sql`: security/integrity/persona smoke cho catalog và bundle Tài sản.
- `lib/permissions/permissionCatalogService.ts`: type, parser và gateway tải catalog Cloud.
- `lib/permissions/moduleGrantSelection.ts`: model thuần tính checkbox, add/remove bundle và validation action.
- `components/permissions/PermissionModuleEditor.tsx`: danh sách/search Module và orchestration card.
- `components/permissions/PermissionModuleCard.tsx`: checkbox ba trạng thái, accordion phân hệ và action nâng cao.
- `components/permissions/PermissionScopePicker.tsx`: nhãn phạm vi nghiệp vụ và input scope dùng lại.
- `components/permissions/AuthorizationEditor.tsx`: ghép catalog, module editor, source kế thừa, diff và Room summary.
- `components/UserModal.tsx`: change detection, validation trước submit và reload receipt.
- `lib/permissions/authorizationUpdateValidation.ts`: validation lý do, expiry, scope và chuẩn hóa lỗi RPC.
- `lib/routeAccess.ts`: capability tường minh cho từng route HR.
- `lib/hrmNavigation.ts`: tiếp tục render từ `canAccessRoute`, không tự suy quyền rộng.
- `docs/security/authorization-v2-main-rollout-log.md`: evidence Cloud và persona sau triển khai.
- `docs/superpowers/plans/2026-09-04-permission-unification-v2.md`: thêm trạng thái Task 12.4, giữ Task 13 blocked theo observation gate.

---

### Task 1: Catalog Cloud và default-view bundle authoritative

**Files:**
- Create via CLI: migration ending `_authorization_v2_module_first_catalog.sql`
- Create: `supabase/tests/authorization_v2_module_first_catalog_smoke.sql`
- Create: `lib/__tests__/authorizationModuleCatalogMigration.test.ts`

**Interfaces:**
- Produces RPC `public.get_permission_admin_catalog() returns jsonb`.
- Produces table `app_private.permission_application_default_view_grants(application_code, permission_code, default_scope_type, sort_order, is_active)`.
- Produces `public.permission_actions.direct_grant_allowed boolean not null default true`.
- RPC JSON keys use camelCase: `applications[].modules[].actions[]` with `permissionCode`, `scopeTypes`, `riskLevel`, `directGrantAllowed`, `directGrantRequiresExpiry`, `grantReadiness`, `isDefaultView`, `defaultScopeType`.

- [ ] **Step 1: Chụp preflight Cloud read-only và xác nhận target**

Run:

```bash
npx --no-install supabase --version
npx --no-install supabase migration list --linked
npx --no-install supabase db query --linked --agent=no --file supabase/tests/phase0_permission_snapshot.sql
```

Expected: linked ref là `ftciqmqhmfvjtwoycswe`; migration ledger local/remote không có entry lệch; snapshot không thay dữ liệu.

- [ ] **Step 2: Viết failing migration contract test**

Create `lib/__tests__/authorizationModuleCatalogMigration.test.ts` để tìm migration có suffix chính xác và kiểm tra các boundary:

```ts
expect(sql).toContain('app_private.permission_application_default_view_grants');
expect(sql).toContain('direct_grant_allowed boolean not null default true');
expect(sql).toContain('create or replace function public.get_permission_admin_catalog()');
expect(sql).toMatch(/assert_authorization_permission\(\s*'system\.authorization\.manage_grants'/);
expect(sql).toMatch(/revoke all on function public\.get_permission_admin_catalog\(\) from public/);
expect(sql).toMatch(/revoke all on function public\.get_permission_admin_catalog\(\) from anon/);
expect(sql).toMatch(/grant execute on function public\.get_permission_admin_catalog\(\) to authenticated/);
```

Run:

```bash
npx vitest run lib/__tests__/authorizationModuleCatalogMigration.test.ts
```

Expected: FAIL vì migration/RPC chưa tồn tại.

- [ ] **Step 3: Viết SQL smoke trước implementation**

Create `supabase/tests/authorization_v2_module_first_catalog_smoke.sql` với assertions:

```sql
begin;

do $$
begin
  if exists (
    select 1
    from app_private.permission_application_default_view_grants bundle
    join public.permission_actions action_row
      on action_row.permission_code = bundle.permission_code
    where bundle.is_active
      and (
        not action_row.is_active
        or not action_row.direct_grant_allowed
        or bundle.default_scope_type <> all(action_row.scope_modes)
        or action_row.direct_grant_requires_expiry
      )
  ) then
    raise exception 'Invalid active default-view bundle item';
  end if;

  if (select count(*) from app_private.permission_application_default_view_grants
      where application_code = 'asset' and is_active) <> 4 then
    raise exception 'Asset default-view bundle must contain four items';
  end if;
end;
$$;

rollback;
```

Add two database sessions inside savepoints: set `request.jwt.claims` to an active
non-manager Auth UUID and assert SQLSTATE `42501`; then set it to an active actor
with `system.authorization.manage_grants/global/*` and assert the RPC returns an
`applications` JSON array. Assert asset codes exactly: `asset.catalog.view`,
`asset.assignment.view`, `asset.maintenance.view`, `asset.audit.view`.

- [ ] **Step 4: Tạo và implement migration**

Run:

```bash
npx --no-install supabase migration new authorization_v2_module_first_catalog
```

In the generated migration:

1. Add `direct_grant_allowed`; set false for the governed HR template-only list currently duplicated in `lib/permissions/permissionService.ts`.
2. Create the mapping table in `app_private`, primary key `(application_code, permission_code)`, foreign keys to public applications/actions, and scope-type check using the existing grant scope allowlist.
3. Seed a reviewed, explicit `values` list. Include safe `view`, `access` and `view_own` choices only when named in the list; exclude `view_all`, inactive/legacy-only actions, template-only HR actions and all expiry-required actions. Set HR self-service to `own` where applicable and Asset’s four view actions to their reviewed default scope.
4. Add a trigger validation function that rejects inactive actions, application mismatch, disallowed direct grant, unsupported scope or expiry-required items.
5. Implement `app_private.get_permission_admin_catalog_impl()` as `security definer set search_path=''`, begin with `app_private.assert_authorization_permission('system.authorization.manage_grants')`, and aggregate only active canonical applications/modules/actions.
6. Implement the public wrapper without `security definer`; revoke PUBLIC/anon and grant execute only to authenticated/service_role. Revoke direct table access from PUBLIC/anon/authenticated.

Canonical ownership must use `coalesce(permission_actions.access_application_code, permission_modules.application_code)` so legacy `system.*` shells cannot duplicate an existing business application.

- [ ] **Step 5: Chạy static tests và Cloud rollback transaction**

Resolve and verify the exact CLI-generated path, then run:

```bash
AUTHZ_CATALOG_MIGRATION_PATH="$(rg --files supabase/migrations | rg '/[0-9]+_authorization_v2_module_first_catalog\.sql$' | tail -1)"
test -f "$AUTHZ_CATALOG_MIGRATION_PATH"
npx vitest run lib/__tests__/authorizationModuleCatalogMigration.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$AUTHZ_CATALOG_MIGRATION_PATH" \
  --smoke supabase/tests/authorization_v2_module_first_catalog_smoke.sql
git diff --check
```

Expected: test PASS; rollback smoke prints no exception; Cloud ledger/data remain unchanged.

- [ ] **Step 6: Commit release candidate, dry-run, apply và postflight**

```bash
AUTHZ_CATALOG_MIGRATION_PATH="$(rg --files supabase/migrations | rg '/[0-9]+_authorization_v2_module_first_catalog\.sql$' | tail -1)"
test -f "$AUTHZ_CATALOG_MIGRATION_PATH"
git add lib/__tests__/authorizationModuleCatalogMigration.test.ts \
  supabase/tests/authorization_v2_module_first_catalog_smoke.sql \
  "$AUTHZ_CATALOG_MIGRATION_PATH"
git commit -m "feat(auth): publish module permission catalog"
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db push --linked
npx --no-install supabase db query --linked --agent=no \
  --file supabase/tests/authorization_v2_module_first_catalog_smoke.sql
npx --no-install supabase migration list --linked
```

Expected: dry-run liệt kê duy nhất migration mới; apply và postflight PASS; local/remote ledger khớp.

---

### Task 2: Frontend catalog service fail-closed

**Files:**
- Create: `lib/permissions/permissionCatalogService.ts`
- Create: `lib/__tests__/permissionCatalogService.test.ts`
- Modify: `lib/permissions/permissionTypes.ts`
- Modify: `lib/permissions/permissionService.ts`

**Interfaces:**
- Produces `PermissionAdminCatalog`, `PermissionCatalogApplication`, `PermissionCatalogModule`, `PermissionCatalogAction`.
- Produces `listPermissionAdminCatalog(gateway?: PermissionCatalogGateway): Promise<PermissionAdminCatalog>`.
- `PermissionCatalogAction` contains the database metadata listed in Task 1; no UI component calls Supabase directly.

- [ ] **Step 1: Viết failing parser/service tests**

```ts
it('keeps only canonical active applications and preserves bundle metadata', async () => {
  rpc.mockResolvedValue({ data: catalogFixture, error: null });
  const result = await listPermissionAdminCatalog({ rpc });
  expect(result.applications.find(app => app.code === 'asset')?.modules
    .flatMap(module => module.actions)
    .filter(action => action.isDefaultView)
    .map(action => action.permissionCode)).toEqual([
      'asset.catalog.view',
      'asset.assignment.view',
      'asset.maintenance.view',
      'asset.audit.view',
    ]);
});

it('fails closed when RPC data is malformed', async () => {
  rpc.mockResolvedValue({ data: { applications: null }, error: null });
  await expect(listPermissionAdminCatalog({ rpc })).rejects.toThrow('Catalog phân quyền không hợp lệ');
});
```

Run `npx vitest run lib/__tests__/permissionCatalogService.test.ts`; expected FAIL because service/types do not exist.

- [ ] **Step 2: Implement immutable catalog types and strict parser**

Define:

```ts
export interface PermissionCatalogAction extends PermissionActionDefinition {
  riskLevel: 'normal' | 'important' | 'sensitive';
  grantReadiness: 'legacy' | 'declared' | 'enforced' | 'verified';
  directGrantAllowed: boolean;
  directGrantRequiresExpiry: boolean;
  isDefaultView: boolean;
  defaultScopeType?: PermissionScopeType;
}

export interface PermissionAdminCatalog {
  generatedAt: string;
  applications: readonly PermissionCatalogApplication[];
}
```

The parser rejects duplicate permission codes, missing scope arrays, default-view actions without a valid default scope, and empty/duplicate application codes. Freeze the parsed result before returning it.

- [ ] **Step 3: Make direct-grant policy consume catalog metadata in the editor path**

Keep `isDirectPermissionGrantAllowed(permissionCode)` only as a compatibility fallback for non-editor call sites. Add:

```ts
export const isCatalogActionDirectGrantAllowed = (
  action: PermissionCatalogAction,
): boolean => action.directGrantAllowed;
```

Do not remove the static HR deny set until every save call is catalog-backed; server validation remains mandatory.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run lib/__tests__/permissionCatalogService.test.ts lib/__tests__/permissionService.test.ts
npm run lint
git diff --check
git add lib/permissions/permissionCatalogService.ts lib/permissions/permissionTypes.ts \
  lib/permissions/permissionService.ts lib/__tests__/permissionCatalogService.test.ts
git commit -m "feat(auth): load authoritative permission catalog"
```

---

### Task 3: Module selection model theo TDD

**Files:**
- Create: `lib/permissions/moduleGrantSelection.ts`
- Create: `lib/__tests__/moduleGrantSelection.test.ts`

**Interfaces:**
- Produces `getApplicationGrantState(input): 'unchecked' | 'checked' | 'indeterminate'`.
- Produces `selectApplicationDefaultViews(input): UserPermissionGrant[]`.
- Produces `removeApplicationDirectGrants(input): { grants: UserPermissionGrant[]; removed: UserPermissionGrant[]; needsConfirmation: boolean }`.
- Produces `togglePermissionAction(input): UserPermissionGrant[]`.
- Grant identity is `permissionCode::scopeType::scopeId`; functions are pure and never mutate caller arrays.

- [ ] **Step 1: Viết failing state and selection tests**

Cover these exact cases:

```ts
expect(selectApplicationDefaultViews(assetInput).map(g => g.permissionCode)).toEqual([
  'asset.catalog.view',
  'asset.assignment.view',
  'asset.maintenance.view',
  'asset.audit.view',
]);
expect(selectApplicationDefaultViews(assetInput).some(g => g.permissionCode.endsWith('.approve'))).toBe(false);
expect(selectApplicationDefaultViews(partialAssetInput)).toHaveLength(4); // deduped
expect(getApplicationGrantState(fullAssetInput)).toBe('checked');
expect(getApplicationGrantState(partialAssetInput)).toBe('indeterminate');
expect(getApplicationGrantState(inheritedOnlyInput)).toBe('indeterminate');
```

Add tests that a template-only default item throws catalog validation, an entity scope without a scope ID is rejected, and expired advanced grants do not count as active.

Run `npx vitest run lib/__tests__/moduleGrantSelection.test.ts`; expected FAIL because module does not exist.

- [ ] **Step 2: Implement normalized grant keys and bundle selection**

```ts
const grantKey = (permissionCode: string, scopeType: PermissionScopeType, scopeId: string) =>
  `${permissionCode}::${scopeType}::${scopeId}`;

export const selectApplicationDefaultViews = ({ catalog, applicationCode, grants, targetUserId }: SelectInput) => {
  const defaults = getDefaultViewActions(catalog, applicationCode);
  return dedupeGrants([...grants, ...defaults.map(action => ({
    id: `local-${action.permissionCode}-${action.defaultScopeType}-*`,
    userId: targetUserId,
    permissionCode: action.permissionCode,
    scopeType: action.defaultScopeType!,
    scopeId: '*',
    isActive: true,
  }))]);
};
```

Entity-scoped action creation must receive an explicit chosen `scopeId`; only `global`, `own`, `assigned` may normalize to `*` without an entity picker.

- [ ] **Step 3: Implement removal safety and advanced action toggles**

Removing a Module collects all direct grants whose action belongs to its canonical application. `needsConfirmation` is true when any removed grant is outside the default-view bundle. Inherited sources are never in the returned removal list. Adding expiry-required action without a future `expiresAt` returns a typed validation failure instead of an invalid grant.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run lib/__tests__/moduleGrantSelection.test.ts
npm run lint
git diff --check
git add lib/permissions/moduleGrantSelection.ts lib/__tests__/moduleGrantSelection.test.ts
git commit -m "feat(auth): model module-first grant selection"
```

---

### Task 4: Module-first editor UI

**Files:**
- Create: `components/permissions/PermissionModuleEditor.tsx`
- Create: `components/permissions/PermissionModuleCard.tsx`
- Create: `components/permissions/__tests__/PermissionModuleEditor.test.tsx`
- Modify: `components/permissions/AuthorizationEditor.tsx`
- Modify: `components/permissions/PermissionScopePicker.tsx`
- Modify: `lib/__tests__/authorizationEditorUiContract.test.ts`

**Interfaces:**
- `PermissionModuleEditor` consumes catalog, direct grants, effective sources and callbacks; it delegates all mutations to Task 3 functions.
- `PermissionModuleCard` exposes separate `onToggleSelected`, `onToggleExpanded`, `onToggleAction`, `onScopeChange`, `onExpiryChange` callbacks.
- Existing `AuthorizationEditor` public props remain compatible, adding `effectivePermissionSources` and catalog loading state.

- [ ] **Step 1: Viết failing render tests**

Use `renderToStaticMarkup` and a controlled view component, following `components/permissions/__tests__/HrmAuthorizationPanel.test.tsx`:

```tsx
expect(html).toContain('Tài sản');
expect(html).not.toContain('Ma trận quyền mới');
expect(html).toContain('4 phân hệ được xem');
expect(html).toContain('Quyền nâng cao');
expect(html).toContain('Kế thừa từ HR');
expect(html).toContain('aria-expanded="false"');
```

Add source contract assertions that `AuthorizationEditor.tsx` imports `PermissionModuleEditor` and no longer imports `PermissionMatrix`.

Run:

```bash
npx vitest run components/permissions/__tests__/PermissionModuleEditor.test.tsx \
  lib/__tests__/authorizationEditorUiContract.test.ts
```

Expected: FAIL because the module-first components do not exist.

- [ ] **Step 2: Implement card header and tri-state behavior**

The checkbox label is `Cấp quyền Xem cho {application.label}`. The chevron is a distinct button with `aria-expanded`. Selecting auto-expands and invokes `selectApplicationDefaultViews`; unselecting with advanced grants opens an inline confirmation listing the removal count. Use an actual checkbox ref to set `indeterminate`, not a visual-only icon.

- [ ] **Step 3: Implement progressive disclosure**

Expanded card renders submodule rows. Default Xem is visible first; advanced actions remain under a disclosure. Show badges `Kế thừa`, `Template`, `Nhạy cảm`, and `Cần ngày hết hạn` using both text and color. Expiry uses `datetime-local` and validates future time before invoking the callback.

- [ ] **Step 4: Implement search, responsive layout and scope copy**

Search filters Module and submodule labels without changing selection state. Cards use one column on mobile and at most two on wide screens. Update labels to `Toàn công ty`, `Chính mình`, `Được phân công`, `Công trường`, `Kho`, `Phòng ban`; preserve canonical scope values.

- [ ] **Step 5: Wire catalog loading and fail-closed states**

`AuthorizationEditor` loads catalog once when opened. While loading, disable permission mutations. On error, show `Không tải được danh mục phân quyền`, a Retry button, and disable Save through a callback to `UserModal`; do not render the static registry as editable fallback. Keep Project Room summary and legacy read-only section unchanged.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run components/permissions/__tests__/PermissionModuleEditor.test.tsx \
  lib/__tests__/authorizationEditorUiContract.test.ts \
  lib/__tests__/moduleGrantSelection.test.ts
npm run lint
npm run build
git diff --check
git add components/permissions/PermissionModuleEditor.tsx \
  components/permissions/PermissionModuleCard.tsx \
  components/permissions/__tests__/PermissionModuleEditor.test.tsx \
  components/permissions/AuthorizationEditor.tsx \
  components/permissions/PermissionScopePicker.tsx \
  lib/__tests__/authorizationEditorUiContract.test.ts
git commit -m "feat(auth): replace permission matrix with module cards"
```

Do not delete `PermissionMatrix.tsx` in this task; remove it only after `rg` proves no production import remains and its historical tests have replacements.

---

### Task 5: Save validation và structured errors

**Files:**
- Create: `lib/permissions/authorizationUpdateValidation.ts`
- Create: `lib/__tests__/authorizationUpdateValidation.test.ts`
- Modify: `lib/permissions/permissionAdminService.ts`
- Modify: `lib/__tests__/permissionAdminServiceV2.test.ts`
- Modify: `components/UserModal.tsx`
- Modify: `components/permissions/AuthorizationEditor.tsx`
- Create via CLI: migration ending `_authorization_v2_structured_grant_errors.sql`
- Modify: `supabase/tests/authorization_v2_phase3_admin_transaction_smoke.sql`

**Interfaces:**
- Produces `validateAuthorizationUpdate(input): AuthorizationValidationIssue[]`.
- Produces `mapAuthorizationRpcError(error): AuthorizationCommandError` with fields `code`, `message`, `permissionCode?`, `field?`.
- Existing `updateUserAuthorizationV2` signature remains stable.

- [ ] **Step 1: Viết failing client validation tests**

```ts
expect(validateAuthorizationUpdate({ changed: true, reason: 'Cấp TS', grants, catalog, now }))
  .toContainEqual(expect.objectContaining({ field: 'reason', code: 'reason_too_short' }));
expect(validateAuthorizationUpdate({ changed: true, reason: 'Cấp quyền tài sản', grants: [approveWithoutExpiry], catalog, now }))
  .toContainEqual(expect.objectContaining({ permissionCode: 'asset.assignment.approve', code: 'expiry_required' }));
expect(validateAuthorizationUpdate({ changed: false, reason: '', grants, catalog, now })).toEqual([]);
```

Also change `permissionAdminServiceV2.test.ts` to expect a trimmed reason shorter than 10 characters to be rejected before RPC.

- [ ] **Step 2: Implement validation and normalized error mapping**

Validate only active grants; reject duplicate keys, unknown actions, disallowed direct grants, unsupported scopes, missing entity scope IDs, invalid/past expiry and reason length 1–9 when changes exist. Parse PostgreSQL `details` JSON when present; otherwise map known message fragments and retain a safe generic message.

- [ ] **Step 3: Add structured database error details**

Generate the migration with:

```bash
npx --no-install supabase migration new authorization_v2_structured_grant_errors
```

Update the private grant replacement validation functions using `raise exception ... using errcode='23514', detail=jsonb_build_object('code', ..., 'permissionCode', ..., 'field', ...)::text`. Preserve signatures, transaction behavior and existing access control. Enforce `char_length(v_reason) >= 10` in the server path so UI/database agree.

- [ ] **Step 4: Wire UserModal change detection and field errors**

Compute `changed` from the normalized profile plus normalized direct-grant keys against the loaded originals. Disable Lưu when unchanged, catalog unavailable or validation issues exist. Display reason/action errors inline, keep draft on error, and after success call `onAuthorizationSaved(userId)` before showing success. A stale version preserves draft and tells the administrator to reload/compare.

- [ ] **Step 5: Verify migration in Cloud rollback, then commit/apply/postflight**

```bash
AUTHZ_ERROR_MIGRATION_PATH="$(rg --files supabase/migrations | rg '/[0-9]+_authorization_v2_structured_grant_errors\.sql$' | tail -1)"
test -f "$AUTHZ_ERROR_MIGRATION_PATH"
npx vitest run lib/__tests__/authorizationUpdateValidation.test.ts \
  lib/__tests__/permissionAdminServiceV2.test.ts \
  lib/__tests__/authorizationAdminTransactionMigration.test.ts
node scripts/run-supabase-cloud-transaction.mjs \
  --expected-ref ftciqmqhmfvjtwoycswe \
  --migration "$AUTHZ_ERROR_MIGRATION_PATH" \
  --smoke supabase/tests/authorization_v2_phase3_admin_transaction_smoke.sql
npm run lint
git diff --check
git add lib/permissions/authorizationUpdateValidation.ts \
  lib/__tests__/authorizationUpdateValidation.test.ts \
  lib/permissions/permissionAdminService.ts \
  lib/__tests__/permissionAdminServiceV2.test.ts \
  components/UserModal.tsx components/permissions/AuthorizationEditor.tsx \
  lib/__tests__/authorizationAdminTransactionMigration.test.ts \
  supabase/tests/authorization_v2_phase3_admin_transaction_smoke.sql \
  "$AUTHZ_ERROR_MIGRATION_PATH"
git commit -m "fix(auth): validate permission changes before save"
npx --no-install supabase db push --linked --dry-run
npx --no-install supabase db push --linked
npx --no-install supabase db query --linked --agent=no \
  --file supabase/tests/authorization_v2_phase3_admin_transaction_smoke.sql
```

Expected: dry-run lists only the structured-error migration; valid Asset views save; short reason and approval without expiry fail with action-specific details and no partial profile update.

---

### Task 6: Capability riêng cho route HR

**Files:**
- Modify: `lib/routeAccess.ts`
- Modify: `lib/__tests__/routeAccess.test.ts`
- Modify: `lib/__tests__/hrmNavigation.test.ts`
- Modify: `lib/permissions/erpPermissionRegistry.ts`
- Modify: `lib/__tests__/permissionRouteRegistry.test.ts`

**Interfaces:**
- `HRM_ROUTE_PERMISSION_REQUIREMENTS` remains the only explicit HR route map used by `canAccessRoute`.
- `getHrmNavigationItems` continues to filter exclusively through `canAccessRoute`.

- [ ] **Step 1: Viết regression tests cho persona Đặng Thị Thu Hà**

Create a non-admin persona with only `hrm.master_data.view/global`; assert:

```ts
expect(canAccessRoute(masterDataOnly, '/hrm/shifts')).toBe(true);
expect(canAccessRoute(masterDataOnly, '/hrm/contracts')).toBe(false);
expect(canAccessRoute(masterDataOnly, '/hrm/documents')).toBe(false);
expect(canAccessRoute(masterDataOnly, '/hrm/reports')).toBe(false);
expect(canAccessRoute(masterDataOnly, '/hrm/ranking')).toBe(false);
```

Add HR-role source tests proving `hrm.contract.view` opens contracts and `hrm.document.view` opens documents only when the permission source is governed `HR`/`HR_MANAGE`.

Run:

```bash
npx vitest run lib/__tests__/routeAccess.test.ts lib/__tests__/hrmNavigation.test.ts \
  lib/__tests__/permissionRouteRegistry.test.ts
```

Expected: FAIL because contracts/documents/reports/ranking currently fall through the broad registry route match.

- [ ] **Step 2: Add exact route requirements**

Use this mapping:

```ts
'/hrm/shifts': { permissionCode: 'hrm.master_data.view', scope: GLOBAL_SCOPE },
'/hrm/contracts': { permissionCode: 'hrm.contract.view', scope: GLOBAL_SCOPE, templateOnly: true },
'/hrm/documents': { permissionCode: 'hrm.document.view', scope: GLOBAL_SCOPE, templateOnly: true },
'/hrm/reports': { permissionCode: 'hrm.employee.view_sensitive', scope: GLOBAL_SCOPE, templateOnly: true },
'/hrm/ranking': { permissionCode: 'hrm.employee.view_sensitive', scope: GLOBAL_SCOPE, templateOnly: true },
```

Remove `/hrm/contracts`, `/hrm/documents`, `/hrm/reports`, `/hrm/ranking` from the route list of `hrm.master_data`; leave `/hrm/shifts`. Do not change payroll/check-in/attendance mappings established in Tasks 12.2–12.3.

- [ ] **Step 3: Verify navigation and security regressions**

```bash
npx vitest run lib/__tests__/routeAccess.test.ts lib/__tests__/hrmNavigation.test.ts \
  lib/__tests__/permissionRouteRegistry.test.ts \
  lib/__tests__/hrmSelfServiceIsolation.test.ts \
  lib/__tests__/hrmAttendanceVisibility.test.ts
npm run lint
npm run build
git diff --check
```

Expected: master-data-only persona sees Ca làm việc but not Contract/Documents/Reports/Ranking; self-service and governed HR personas remain correct.

- [ ] **Step 4: Commit**

```bash
git add lib/routeAccess.ts lib/__tests__/routeAccess.test.ts \
  lib/__tests__/hrmNavigation.test.ts lib/permissions/erpPermissionRegistry.ts \
  lib/__tests__/permissionRouteRegistry.test.ts
git commit -m "fix(hrm): require exact capability for each route"
```

---

### Task 7: Full verification, Cloud persona và rollout evidence

**Files:**
- Modify: `docs/security/authorization-v2-main-rollout-log.md`
- Modify: `docs/superpowers/plans/2026-09-04-permission-unification-v2.md`
- Delete if unreferenced: `components/permissions/PermissionMatrix.tsx`

**Interfaces:**
- No new runtime interface; produces Task 12.4 evidence and keeps Task 13 observation gate explicit.

- [ ] **Step 1: Prove the old matrix is unused before deletion**

```bash
rg -n "PermissionMatrix" --glob '!docs/**' --glob '!node_modules/**' --glob '!.worktrees/**'
```

Expected: only the component file itself remains. Delete it with `apply_patch`; if any production import remains, keep the file and remove the import through Task 4 behavior before continuing.

- [ ] **Step 2: Run full repository verification**

```bash
npm test -- --exclude '.worktrees/**'
npm run lint
npm run build
npm run check:supabase-migrations
npm run audit:supabase-queries
npm run check:supabase-queries
git diff --check
```

Expected: all commands exit 0. Record exact test-file/test counts and build output; do not report “pass” from an earlier run.

- [ ] **Step 3: Run Cloud security smokes**

```bash
npx --no-install supabase db query --linked --agent=no \
  --file supabase/tests/authorization_v2_module_first_catalog_smoke.sql
npx --no-install supabase db query --linked --agent=no \
  --file supabase/tests/authorization_v2_task12_2_hrm_self_service_isolation_smoke.sql
npx --no-install supabase db query --linked --agent=no \
  --file supabase/tests/authorization_v2_task12_3_attendance_scope_smoke.sql
npx --no-install supabase db query --linked --agent=no \
  --file supabase/tests/authorization_v2_retired_view_only_rooms_smoke.sql
npx --no-install supabase migration list --linked
```

Expected: all smoke transactions roll back successfully; migration ledger matches; no Room membership/binding mutation is persisted.

- [ ] **Step 4: Browser/persona acceptance**

With dev server started from `/Users/admin/khotienthinh` on this branch:

1. Admin opens Đặng Thị Thu Hà, selects Tài sản, confirms four Xem actions and saves with reason `Cấp quyền xem Module Tài sản`.
2. Reload the user and verify exactly four active Asset view grants at intended scopes; no approval/manage action.
3. Sign in as that user: Tài sản visible/readable; mutation actions absent/denied; Hồ sơ & Công văn absent; direct URL denied.
4. Verify “Chấm công của tôi” contains only the current employee and “Phiếu lương” contains only confirmed/paid rows belonging to current employee.
5. Verify admin still writes the four designated view-only project areas, while the non-admin cannot mutate them.

Use a transaction rollback persona for database grant mutation before any persistent test. If the real user must be changed persistently, record before/after grants and restore only with the user’s explicit operational intent; do not silently change production authorization for QA.

- [ ] **Step 5: Update evidence and commit**

Append Task 12.4 to both documents with migration versions, commit SHAs, Cloud ref, test counts, persona result and any observation reset. Task 13 remains blocked until the approved 7-day post-release observation gate is satisfied.

```bash
git add docs/security/authorization-v2-main-rollout-log.md \
  docs/superpowers/plans/2026-09-04-permission-unification-v2.md
git add -u -- components/permissions/PermissionMatrix.tsx
git commit -m "docs(auth): record module-first rollout evidence"
git status --short
```

Expected: final status shows only pre-existing unrelated worktree changes; no uncommitted Task 12.4 file remains.

---

## Definition of done

- Admin sees only canonical active Module cards; no duplicate legacy system shell.
- Selecting Tài sản adds exactly its four view permissions and nothing else.
- Every Module selection uses a reviewed Cloud bundle and valid default scope.
- Template-only and sensitive rights cannot be directly granted by accident.
- Missing expiry and reason under 10 characters are explained before submit and enforced server-side.
- Save remains atomic; stale/error cases retain the draft and do not partially update the profile.
- `hrm.master_data.view` no longer opens Hồ sơ & Công văn, Hợp đồng, Báo cáo or Xếp hạng.
- Check-in, attendance and personal payroll isolation still pass Cloud smoke.
- Seven already-cutover Rooms are untouched; four view-only project areas keep admin-write/non-admin-read behavior.
- Targeted tests, full tests, lint, build, migration checks, query audit and postflight Cloud smokes all pass with fresh evidence.
