# Permission Unification V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hợp nhất nền tảng quyền mới, quyền module và Project Room thành một chuỗi quyết định nhất quán; hoàn tất cutover trên Supabase Cloud `main`, sau đó tắt và dọn legacy có kiểm soát.

**Architecture:** Module permission chỉ mở product shell; capability có namespace và scope quyết định năng lực nghiệp vụ; Project Room quyết định assignment/action trong đúng project hoặc công trường; workflow state và RLS/RPC là lớp quyết định cuối. Frontend dùng một authorization snapshot có nguồn gốc rõ ràng, còn mutation nhạy cảm được backend deny-by-default. Với các module được chỉ định là view-only, user thường chỉ được đọc; System Admin (`public.is_admin()`) là ngoại lệ ghi dữ liệu explicit và không cần Room/action grant.

**Tech Stack:** React 18, TypeScript 5.8, Vitest 4, Supabase Cloud/Postgres, RLS, SECURITY DEFINER functions trong `app_private`, Supabase CLI 2.95.6+.

**Spec:** `docs/security/principal-permission-scope-assignment-workflow-notification-architecture.md`

## Global Constraints

- Git branch: `feature/audit-phan-quyen-v2`.
- Supabase Cloud target: branch `main`, project ref `ftciqmqhmfvjtwoycswe`.
- Không Supabase local, không Docker, không dùng `--local`.
- Chỉ đọc credential từ `.env`; không in URL, password, JWT secret, service-role key hoặc output của `supabase branches get`.
- Trước mọi Cloud query/apply, assert `supabase/.temp/project-ref` bằng đúng project ref trên.
- Không sửa migration đã áp dụng. Migration mới phải được tạo bằng `npx --no-install supabase migration new <name>`.
- Không dùng `db push --include-all`. `db push --dry-run` phải chỉ liệt kê migration của checkpoint hiện tại; nếu có ledger drift thì dừng.
- Không dùng `migration repair` làm đường vòng; repair cần audit riêng, bằng chứng SQL và commit giải trình độc lập.
- Bảng public mới phải bật RLS. Privileged function đặt trong `app_private`, revoke `PUBLIC`; wrapper public chỉ grant vai trò cần thiết.
- Không authorize từ `user_metadata`; không đưa secret/service-role key vào frontend.
- Project Room chỉ cấp action theo assignment trong scope; module permission chỉ mở shell.
- `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract` không còn là Project Room. User thường chỉ đọc; chỉ System Admin theo `public.is_admin()` được ghi. Không dùng role string/frontend-only gate làm authority.
- System Admin bypass phải explicit. Ngoài ngoại lệ ghi của bốn module view-only nêu trên, bypass không áp dụng ngầm cho HRM, business approval, recipient resolution hoặc separation-of-duty.
- Mỗi checkpoint: failing test → implementation → targeted tests → lint → Cloud transaction rollback → commit release candidate → dry-run → apply Cloud main → postflight → commit evidence.
- Mọi Vitest command loại `.worktrees/**`.
- Không stage `supabase/.temp/**`, `.env*`, credential hoặc database output có PII; không dùng `git add .`.
- Thực thi inline bằng primary agent, không dùng sub-agent theo `AGENTS.md`.

---

## Baseline đo ngày 2026-09-04

- 55 active users; cả 55 còn module legacy; 31 có direct grant mới; 24 EMPLOYEE legacy-only.
- 1.181 active direct grants; 1.164 thuộc `project.*`; 17 grant ngoài Project.
- 7/14 Room đã cutover nghiệp vụ: `daily_log`, `material_planning`, `material_request`, `material_po`, `gantt`, `weekly_progress`, `quality`. Không backfill hoặc triển khai lại UI/RLS/RPC của bảy Room này.
- Registry hiện có 72 action bindings: 34 `pilot`, 38 `audit_only`, 0 `enforced`. Sáu Room cutover có toàn bộ action ở `pilot`; riêng `material_request.verify` còn `audit_only` và phải được xác nhận là action cần giữ hay retire, không được dùng làm lý do chạy lại cả Room.
- 24 fallback-only combinations ở Weekly Progress; 2 active Room members gắn với `project_staff` đã kết thúc.
- Effective sources: 1.181 DIRECT, 5.362 LEGACY, 333 ROLE; 768 LEGACY+DIRECT và 261 LEGACY+ROLE collisions theo user/code.
- Flags: `business_role_resolver_enabled=true`, `legacy_fallback_disabled=false`, `legacy_governance_fallback_disabled=false`, `legacy_projection_enabled=false`, `project_room_pbac_fallback_enabled=true`, `system_admin_business_approval_bypass_disabled=false`.
- Permission regression baseline: 10 files / 88 tests pass khi loại `.worktrees/**`.

Các số trên là snapshot, không phải hằng số migration. Task 1 chụp lại và ghi mọi chênh lệch trước khi thay đổi Cloud main.

## Rà soát thay đổi gần đây ngày 2026-09-10

### Kết luận phạm vi

- Giữ nguyên 7 Room đã cutover: `daily_log`, `material_planning`, `material_request`, `material_po`, `gantt`, `weekly_progress`, `quality`; chỉ chạy regression/checksum, không re-apply.
- Retire khỏi Project Room bốn module: `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract`.
- Bốn module vẫn hiển thị dữ liệu cho user có quyền view tương ứng. Chỉ System Admin được tạo/sửa/xóa/chuyển trạng thái; quyền ghi không được suy từ Room, PBAC rộng, module admin hoặc direct grant cũ.
- Chỉ còn 3 Room cần cutover: `quantity_acceptance`, `payment`, `safety`. Sau disposition của `material_request.verify`, tắt Room fallback toàn cục.
- Phạm vi `subcontract` ở đây là tab Project “Nghiệm thu & thanh toán nhà thầu” và bảng `acceptance_records`; không thay đổi quyền quản trị danh mục hợp đồng thầu phụ thuộc module HĐ.

### Bằng chứng Cloud main

- Cả 4 Room đang active, có tổng 17 binding đều `audit_only` và `pbac_fallback_enabled=true`: `material_waste` 3, `custom_material` 3, `boq_reconciliation` 5, `subcontract` 6.
- Có 39 active Room memberships cần snapshot rồi deactivate: `material_waste` 13, `custom_material` 1, `boq_reconciliation` 5, `subcontract` 20. Không hard-delete evidence.
- Có 32 active non-view direct grants cần revoke có audit: Custom Material 11, Material Waste 1, Subcontract 20; không có role-template item tương ứng. `boq_reconciliation` chưa có canonical capability riêng nên hiện không có direct/role grant theo namespace này.
- Các bảng ghi đang trống tại thời điểm audit: `custom_material_requests`, lines, attachments, RFQ; `boq_reconciliation_groups`, contract/work lines; `acceptance_records`. Đây là cửa sổ ít rủi ro để đóng write path, nhưng migration vẫn phải idempotent và có rollback transaction.
- Cloud hiện có 1 active System Admin. Không ghi user id/name/email vào artifact.
- `material_waste` UI hiện đã read-only, nhưng registry vẫn quảng bá `record/approve/manage`; các action này phải retire.
- `custom_material` UI/service/RLS hiện còn create, edit, import, upload, approve/reject/return và procurement paths cho admin/module admin/owner/PBAC; phải thu về `is_admin()` cho mutation.
- `boq_reconciliation` nằm trong tab BOQ vật tư và hiện còn create/delete/edit/submit/review/lock; UI chưa gate toàn bộ mutation, RLS còn cho PBAC rộng. View tiếp tục theo `project.material_boq.view`, không tạo namespace quyền ghi mới; mutation chỉ `is_admin()`.
- `subcontract` UI còn mặc định `canManageTab=true`; Cloud RLS của `acceptance_records` đã admin-only cho mutation. Phải đổi frontend gate thành System Admin và bỏ default-allow.

### Ảnh hưởng từ các commit/migration mới

- `28c052d` bổ sung route Template Yêu cầu vào registry và test deny-by-default; không chạm bốn module nhưng củng cố yêu cầu mọi route phải có canonical mapping.
- `7ddfab9` sửa deep-link/thông báo duyệt PO và projection; không đổi quyết định quyền, cần giữ regression Material PO.
- Cloud main đã áp dụng `20260905034726` (legacy write guard), `20260905035047` (authorization snapshot), `20260905041938` (WMS reversal) và toàn bộ migration Work từ `20260907012229` đến `20260909023239`.
- Trước Task 0, branch `feature/audit-phan-quyen-v2` chưa chứa các migration/code tương ứng và `supabase migration list --linked` có 24 remote-only entries. Blocker đã được reconcile tại merge commit `6585fdf`; không dùng `migration repair` và không chạy lại migration.
- Registry/cleanup Phase 5–6 phải giữ capability `wms.transaction.reverse`, toàn bộ `work.*`, strict route boundary và quyền EXECUTE helper đã được sửa ở nhánh Work.

## Task 0 — Reconcile Git với Cloud main trước khi thực thi tiếp

**Mục tiêu:** đưa source branch về đúng lịch sử đã triển khai trên Cloud main mà không chạy lại migration.

- [x] Snapshot `git status`, `git log`, `supabase migration list --linked` và checksum các file migration remote-only.
- [x] Tích hợp có review chuỗi Authorization `959cce1..6fc94d4`, WMS bắt đầu tại `8a2b11f` và Work bắt đầu tại `c47433a` từ các nhánh đã triển khai; resolve theo hành vi hiện hành, không copy riêng SQL bỏ code/test/evidence.
- [x] Assert tất cả version Cloud đã có file local đúng checksum; không có local-only migration ngoài checkpoint dự kiến.
- [x] Chạy targeted authorization/WMS/Work tests, full lint/build và `db push --linked --dry-run`; kết quả `Remote database is up to date` trước khi tạo migration view-only.
- [x] Commit reconciliation riêng `6585fdf`, không trộn với thay đổi bốn module.

**Gate:** nếu ledger còn remote-only/local-only hoặc source không chứa runtime tương thích với schema Cloud thì dừng; không bắt đầu Task 1/Task 8.

## File map

- Create `scripts/lib/supabase-cloud-transaction.mjs`: target guard, tạo `BEGIN ... ROLLBACK` SQL, redaction và temp cleanup.
- Create `scripts/run-supabase-cloud-transaction.mjs`: CLI wrapper cho migration + smoke files.
- Create `lib/__tests__/supabaseCloudTransactionRunner.test.ts`: contract test cho runner.
- Create `supabase/audits/authorization_v2_reconciliation.sql`: một JSON result set không chứa PII.
- Create `docs/security/authorization-v2-main-rollout-log.md`: SHA, migration, preflight, apply, postflight và rollback evidence.
- Create `lib/permissions/authorizationEvaluator.ts`: pure evaluator cho source, scope và Room action.
- Modify `types.ts`, `context/authState.ts`, `context/AuthContext.tsx`: authorization snapshot giữ source semantics.
- Modify `lib/permissions/permissionService.ts`, `lib/permissions/projectPermissionService.ts`, `lib/routeAccess.ts`, `App.tsx`: một evaluator, deny unknown route/action.
- Create `components/permissions/AuthorizationEditor.tsx` và `LegacyPermissionReadOnly.tsx`: một editor, legacy read-only trong transition.
- Modify `components/UserModal.tsx`, `components/permissions/PermissionMatrix.tsx`, `lib/permissions/permissionAdminService.ts`, `context/AppContext.tsx`: atomic admin save, không ghi legacy.
- Modify `components/project/permissions/ProjectPermissionRoomsPanel.tsx`, `components/project/permissions/ProjectPermissionRoomCard.tsx`, `components/project/permissions/ProjectPermissionRoomDrawer.tsx`, `lib/projectPermissionRoomService.ts`; regression-only cho 7 Room đã cutover, retire 4 Room view-only và tạo smoke cho 3 Room còn lại.
- Modify `lib/permissions/projectPermissionRooms.ts`, `lib/permissions/projectPermissionRegistry.ts`, `lib/permissions/projectMaterialPermissions.ts`, `pages/project/MaterialTab.tsx`, `components/project/material/CustomMaterialRequestTab.tsx`, `components/project/BoqReconciliationPanel.tsx`, `pages/project/SubcontractTab.tsx`, `pages/ProjectDashboard.tsx`: view-only cho user thường, System Admin-only mutation.
- Modify `supabase/functions/ai-assistant/index.ts`, `lib/homeCapabilities.ts`, `lib/feedbackNotificationService.ts`: xóa runtime legacy ở Phase 6.

Mỗi migration được tham chiếu bằng suffix duy nhất. Timestamp prefix do CLI tạo tại thời điểm thực thi; executor phải assert chỉ có đúng một file khớp suffix.

## Protocol cho mọi migration checkpoint

- [ ] Xác nhận targets:

```bash
test "$(git branch --show-current)" = "feature/audit-phan-quyen-v2"
test "$(sed -n '1p' supabase/.temp/project-ref)" = "ftciqmqhmfvjtwoycswe"
git status --short
```

- [ ] Nạp `.env` và kiểm tra ledger:

```bash
set -a
source .env
set +a
npm run check:supabase-migrations
npx --no-install supabase migration list --linked
```

- [ ] Tạo migration bằng CLI, chạy targeted tests, lint, rollback transaction và security advisor.
- [ ] Commit release candidate bằng file list tường minh.
- [ ] Chạy `db push --linked --dry-run`; chỉ apply khi output có đúng migration vừa commit.
- [ ] Chạy postflight smoke + reconciliation audit trên Cloud main.
- [ ] Ghi SHA/kết quả vào rollout log và tạo evidence commit riêng.

Nếu một gate fail, không sang checkpoint tiếp theo. Rollback hành vi bằng feature flag hoặc forward migration; không sửa migration đã chạy.

## Giai đoạn 1 — Chốt baseline, quan sát và khóa đường phát sinh legacy

### Task 1: Cloud-safe runner và reconciliation snapshot

**Files:**
- Create: `scripts/lib/supabase-cloud-transaction.mjs`
- Create: `scripts/run-supabase-cloud-transaction.mjs`
- Create: `lib/__tests__/supabaseCloudTransactionRunner.test.ts`
- Create: `supabase/audits/authorization_v2_reconciliation.sql`
- Create: `docs/security/authorization-v2-main-rollout-log.md`

**Interfaces:**
- `assertCloudTarget(projectRef: string, expectedRef: string): void`.
- `buildRollbackSql(migrationSql: string, smokeSql: readonly string[]): string`.
- Audit JSON keys: `users`, `grants`, `effectiveSources`, `collisions`, `rooms`, `fallbackOnly`, `staleMembers`, `flags`.

- [ ] **Step 1: Viết failing tests**

```ts
expect(() => assertCloudTarget('preview', 'ftciqmqhmfvjtwoycswe')).toThrow(/Cloud target mismatch/);
expect(buildRollbackSql('select 1;', ['select 2;'])).toMatch(/^begin;[\s\S]*select 1;[\s\S]*select 2;[\s\S]*rollback;$/i);
```

- [ ] **Step 2: Chạy và xác nhận fail vì runner chưa tồn tại**

```bash
npx vitest run --exclude '.worktrees/**' lib/__tests__/supabaseCloudTransactionRunner.test.ts
```

- [ ] **Step 3: Implement runner** — đọc linked ref; dùng OS temp dir; ghép migration/smokes giữa `begin;` và `rollback;`; gọi `supabase db query --linked --file`; cleanup trong `finally`; error không chứa env.
- [ ] **Step 4: Implement audit** — CTE + `jsonb_build_object`, chỉ count/group theo source, namespace, Room/status và flag; không select name/email/reason/JWT.
- [ ] **Step 5: Verify và commit**

```bash
npx vitest run --exclude '.worktrees/**' lib/__tests__/supabaseCloudTransactionRunner.test.ts lib/__tests__/supabaseBaselineTooling.test.ts
npm run lint
npx --no-install supabase db query --linked --file supabase/audits/authorization_v2_reconciliation.sql
git diff --check
git add scripts/lib/supabase-cloud-transaction.mjs scripts/run-supabase-cloud-transaction.mjs lib/__tests__/supabaseCloudTransactionRunner.test.ts supabase/audits/authorization_v2_reconciliation.sql docs/security/authorization-v2-main-rollout-log.md
git commit -m "chore(auth): establish cloud main rollout controls"
```

Expected: audit trả một JSON row; log ghi snapshot mới và delta so với baseline.

### Task 2: Audit/guard legacy writes bằng feature flag

**Files:**
- Create via CLI suffix: `_authorization_v2_phase1_legacy_write_guard.sql`
- Create: `supabase/tests/authorization_v2_phase1_legacy_write_guard_smoke.sql`
- Create: `lib/__tests__/authorizationLegacyWriteGuardMigration.test.ts`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

**Interfaces:**
- Setting `legacy_permission_writes_disabled`, default `false`.
- Table `app_private.authorization_legacy_write_audit(actor_user_id, target_user_id, changed_columns, reason, occurred_at)`.
- Trigger `app_private.guard_and_audit_legacy_permission_write()`.

- [ ] **Step 1: Test migration contract** — assert setting, private audit table, trigger và cả bốn legacy columns xuất hiện trong SQL.
- [ ] **Step 2: Implement trigger** — flag false ghi audit; flag true raise `Legacy permission writes are disabled`; controlled migration chỉ bypass bằng transaction-local `app.authorization_legacy_migration='on'`; audit table revoke toàn bộ client roles.
- [ ] **Step 3: Smoke ba nhánh** — audit-only, blocked write, controlled migration; fixture rollback.
- [ ] **Step 4: Verify, release-candidate commit, dry-run, apply main, postflight và evidence commit theo protocol.**

**Commit:** `feat(auth): audit and guard legacy permission writes`

**Phase 1 exit gate:** snapshot đầy đủ, legacy mutation quan sát được, ledger sạch, chưa thay đổi effective access.

## Giai đoạn 2 — Một evaluator và một authorization snapshot

### Task 3: Source-aware snapshot RPC

**Files:**
- Create via CLI suffix: `_authorization_v2_phase2_snapshot_rpc.sql`
- Create: `supabase/tests/authorization_v2_phase2_snapshot_smoke.sql`
- Create: `lib/__tests__/authorizationSnapshotMigration.test.ts`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

**Interfaces:**
- RPC `public.get_my_authorization_snapshot() returns jsonb`.
- Shape `{ generatedAt, flags, sources, roomActions }`.
- `sources[]` giữ `permissionCode`, `sourceType`, `sourceId`, `sourceCode`, `scopeType`, `scopeId`, dates, risk và metadata.
- `roomActions[]` giữ project/site/room/action/source/enforcement/fallback.

- [ ] **Step 1: Contract test** — wrapper dùng `current_app_user_id()`, không nhận target user, không đọc `user_metadata`, revoke `PUBLIC`/`anon`.
- [ ] **Step 2: Implement private resolver + public wrapper** — tái dùng effective source resolver và Room resolver, không làm mất DIRECT/ROLE/LEGACY/ROOM source types.
- [ ] **Step 3: Smoke** — self-only, inactive deny, expired/wrong-scope deny, Room action scope isolation.
- [ ] **Step 4: Verify/apply/evidence theo protocol.**

**Commit:** `feat(auth): expose canonical authorization snapshot`

### Task 4: Frontend evaluator duy nhất

**Files:**
- Create: `lib/permissions/authorizationEvaluator.ts`
- Create: `lib/__tests__/authorizationEvaluator.test.ts`
- Modify: `types.ts`, `context/authState.ts`, `context/AuthContext.tsx`
- Modify: `lib/permissions/permissionService.ts`, `lib/permissions/projectPermissionService.ts`
- Modify: `lib/routeAccess.ts`, `App.tsx`

**Interfaces:**
- `evaluateCapability(snapshot, permissionCode, scope): AuthorizationDecision`.
- `hasRoomAction(snapshot, projectId, constructionSiteId, roomCode, actionCode): boolean`.
- Decision reason: `granted | inactive | unknown_permission | scope_mismatch | legacy_disabled | not_granted`.

- [ ] **Step 1: Failing tests**

```ts
expect(evaluateCapability(directProjectA, 'project.daily_log.view', projectA).allowed).toBe(true);
expect(evaluateCapability(directProjectA, 'project.daily_log.view', projectB).allowed).toBe(false);
expect(evaluateCapability(legacyOnlyFallbackOff, 'wms.inventory.view', globalScope).reason).toBe('legacy_disabled');
expect(hasRoomAction(snapshot, 'project-a', null, 'weekly_progress', 'confirm')).toBe(false);
```

- [ ] **Step 2: Implement scope/source evaluator** — global, exact scope và verified project→site inheritance; unknown code/route deny.
- [ ] **Step 3: Auth tải snapshot RPC; giữ `effectivePermissionSources`; `permissionGrants` chỉ là compatibility projection đến Phase 6.**
- [ ] **Step 4: Delegate module/route/project tab checks; Room action chỉ dùng `hasRoomAction`, không suy từ module/PBAC.**
- [ ] **Step 5: Verify và commit**

```bash
npx vitest run --exclude '.worktrees/**' lib/__tests__/authorizationEvaluator.test.ts lib/__tests__/authBoundary.test.tsx lib/__tests__/permissionService.test.ts lib/__tests__/projectPermissionService.test.ts lib/__tests__/permissionRouteRegistry.test.ts lib/__tests__/routeAccess.test.ts
npm run lint
npm run build
git diff --check
git add lib/permissions/authorizationEvaluator.ts lib/__tests__/authorizationEvaluator.test.ts types.ts context/authState.ts context/AuthContext.tsx lib/permissions/permissionService.ts lib/permissions/projectPermissionService.ts lib/routeAccess.ts App.tsx
git commit -m "refactor(auth): use one source-aware permission evaluator"
```

**Phase 2 exit gate:** UI có một evaluator; backend vẫn là authority; helper mới không đọc trực tiếp legacy columns.

## Giai đoạn 3 — Một màn hình và một transaction quản trị quyền

### Task 5: Transactional authorization admin RPC

**Files:**
- Create via CLI suffix: `_authorization_v2_phase3_admin_transaction.sql`
- Create: `supabase/tests/authorization_v2_phase3_admin_transaction_smoke.sql`
- Create: `lib/__tests__/authorizationAdminTransactionMigration.test.ts`
- Modify: `lib/permissions/permissionAdminService.ts`
- Create: `lib/__tests__/permissionAdminServiceV2.test.ts`

**Interfaces:**
- RPC `update_user_authorization_v2(p_user_id uuid, p_profile jsonb, p_grants jsonb, p_reason text, p_expected_updated_at timestamptz) returns jsonb`.
- Return `{ userId, updatedAt, activeGrantCount, auditEventId }`.

- [x] **Step 1: Tests** — non-manager deny; blank reason deny; stale version conflict; invalid grant rolls back profile; valid request updates profile+grants atomically.
- [x] **Step 2: Implement** — whitelist `name`, `phone`, `avatar`, `manager_id`, `assigned_warehouse_id`; reject role/auth/account/legacy fields; reuse v2 grant validation.
- [x] **Step 3: Typed frontend service** — reason required, optimistic version, conflict message, no direct `.from('users').update()`.
- [x] **Step 4: Verify/apply/evidence theo protocol.**

**Commit:** `feat(auth): make user authorization updates transactional`

**Kết quả:** release candidate `1306c81`; migration `20260910022617` đã áp dụng lên Cloud main và postflight rollback smoke đạt.

### Task 6: Unified authorization editor

**Files:**
- Create: `components/permissions/AuthorizationEditor.tsx`
- Create: `components/permissions/LegacyPermissionReadOnly.tsx`
- Create: `lib/__tests__/authorizationEditorUiContract.test.ts`
- Modify: `components/UserModal.tsx`, `components/permissions/PermissionMatrix.tsx`
- Modify: `context/AppContext.tsx`, `lib/permissions/permissionAdminService.ts`

- [x] **Step 1: UI contract test** — `UserModal` không còn editor “Phân quyền Module”/“Quản trị Sub-module”, không mutate legacy arrays, chỉ gọi transaction service.
- [x] **Step 2: Implement ba vùng** — module shell, scoped capabilities, Project Room summary/link; legacy chỉ đọc với source/collision/migration state.
- [x] **Step 3: Clipboard chỉ copy direct grants + scope; save yêu cầu reason; inherited badge không phải checkbox sửa được.**
- [x] **Step 4: Targeted tests, lint, build và commit.**

**Commit:** `feat(auth): unify permission administration UI`

**Kết quả:** commit `41af7e2`; full checkout regression 371 files / 1.759 tests, lint và build đạt.

**Phase 3 exit gate:** một editor, một atomic RPC; không còn partial save giữa profile và grants.

## Giai đoạn 4 — Retire 4 Room view-only và cutover 3 Room còn lại

### Task 7: Đóng băng phạm vi 7 Room đã cutover — regression-only

**Không tái triển khai:** `daily_log`, `material_planning`, `material_request`, `material_po`, `gantt`, `weekly_progress`, `quality`.

**Files:**
- Modify: `docs/security/authorization-v2-main-rollout-log.md`
- Existing test: `supabase/tests/project_permission_rooms_smoke.sql`
- Existing test: `supabase/tests/project_room_permission_audit_pilots_smoke.sql`
- Existing test: `supabase/tests/phase3_daily_log_permissions_smoke.sql`
- Existing test: `supabase/tests/material_request_room_authoritative_cutover_smoke.sql`
- Existing test: `supabase/tests/material_po_room_authoritative_cutover_smoke.sql`
- Existing test: `supabase/tests/gantt_room_authoritative_cutover_smoke.sql`
- Existing test: `supabase/tests/weekly_progress_period_state_smoke.sql`
- Existing test: `supabase/tests/quality_room_authoritative_smoke.sql`

- [x] **Step 1: Snapshot checksums** của binding rows, Room memberships, RLS policies và function definitions cho bảy Room trước Phase 4.
- [x] **Step 2: Chạy regression hiện hữu**; không tạo migration, không backfill, không đổi policy/function/UI cho Room đã pass.
- [x] **Step 3: Đối với `material_request.verify`** — xác nhận từ registry/runtime rằng action có business path hay không. Nếu không có path, retire riêng binding này bằng migration metadata-only ở Task 9; nếu có path nhưng chưa cutover, tách thành checkpoint action-level và không mở lại các action khác của Material Request.
- [x] **Step 4: Ghi checksum và test result vào rollout log; commit evidence-only.**

**Commit:** `test(auth): lock regression baseline for seven cutover rooms`

Expected: checksum trước/sau không đổi; không có SQL mutation trên bảy Room đã cutover.

**Kết quả:** baseline bảy Room được khóa mà không tạo migration hay thay đổi Cloud. Contract tĩnh đạt 8 files / 35 tests. Hai Cloud rollback smoke đạt; sáu smoke lịch sử còn test debt do assertion pilot/fallback toàn cục hoặc fixture workflow đã lệch với runtime hiện tại, được ghi chi tiết trong rollout log. `material_request.verify` không có business path chính xác và được chốt disposition retire metadata-only ở Task 9.

### Task 8: Retire bốn Room, giữ System Admin-only mutation

**Chỉ thực thi:** `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract`.

**Files:**
- Create via CLI suffix: `_authorization_v2_phase4_retire_view_only_rooms.sql`
- Create: `supabase/tests/authorization_v2_retired_view_only_rooms_smoke.sql`
- Modify: `lib/permissions/projectPermissionRooms.ts`
- Modify: `lib/permissions/projectPermissionRegistry.ts`
- Modify: `lib/permissions/projectMaterialPermissions.ts`
- Modify: `pages/project/MaterialTab.tsx`
- Modify: `components/project/material/CustomMaterialRequestTab.tsx`
- Modify: `components/project/BoqReconciliationPanel.tsx`
- Modify: `pages/project/SubcontractTab.tsx`
- Modify: `pages/ProjectDashboard.tsx`
- Modify: `components/project/permissions/ProjectPermissionRoomCard.tsx`
- Modify: `components/project/permissions/ProjectPermissionRoomDrawer.tsx`
- Modify: `lib/projectPermissionRoomService.ts`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

- [x] **Step 1: Viết failing contract tests** — bốn Room không còn trong Room registry/admin UI; non-admin không thấy hoặc gọi được mutation; System Admin vẫn ghi được; `SubcontractTab` không default-allow.
- [x] **Step 2: Snapshot trước migration** — 17 bindings, 39 memberships, member actions, direct/role grants, RLS/functions và row counts; lưu counts/checksum, không PII.
- [x] **Step 3: Retire Room metadata có audit** — deactivate memberships/actions và room rows; retire bindings với reason hoặc chuyển sang bảng disposition; không hard-delete. Không backfill Room.
- [x] **Step 4: Thu gọn canonical capability** — chỉ giữ `project.material_waste.view`, `project.custom_material.view`, `project.subcontract.view`; BOQ reconciliation tiếp tục dùng `project.material_boq.view`. Retire/revoke active non-view grants bằng audited forward migration. System Admin không cần grant ghi.
- [x] **Step 5: Enforce frontend** — `material_waste` giữ read-only; `custom_material` và `boq_reconciliation` chỉ render mutation cho System Admin; `subcontract` nhận `isAdmin`, default false. Frontend check dùng canonical admin state nhưng không phải authority cuối.
- [x] **Step 6: Enforce backend** — RLS/RPC/storage mutation của custom material, BOQ reconciliation và Project acceptance chỉ cho `public.is_admin()`; SELECT giữ đúng scope/view hiện tại. Loại PBAC/module-admin/owner bypass khỏi write path.
- [x] **Step 7: Dọn recipient/workflow paths** — user thường không thể submit/verify/approve; admin action không resolve recipient qua Room đã retire. `ContractVariationPanel` không được phụ thuộc `boq_reconciliation` Room sau migration.
- [x] **Step 8: Smoke matrix** — non-admin SELECT allow theo view scope và mọi INSERT/UPDATE/DELETE/status RPC deny; System Admin mutation allow; cross-scope SELECT vẫn deny nơi đang scope-bound; bảy Room cũ checksum không đổi.
- [x] **Step 9: Rollback transaction, release-candidate commit, dry-run/apply/postflight/evidence theo protocol.**

**Commit:** `feat(auth): retire four project rooms as admin-write views`

**Kết quả:** release candidate `1eb71f7`; migration `20260910025910` đã áp dụng lên Cloud main. Cloud còn 10 Room active; bốn Room có disposition audit, 17 binding không còn fallback, 39 membership và 66 member-action đã inactive, 32 non-view direct grants đã revoke; admin-write guard phủ 15 bảng. Postflight persona smoke, 373 files / 1.765 tests, lint và build đạt.

### Task 9: Cutover Quantity Acceptance, Payment, Safety và tắt Room fallback

**Chỉ thực thi:** `quantity_acceptance`, `payment`, `safety`. Bảy Room cũ vẫn regression-only; bốn Room retired chỉ chạy view/admin-write regression.

**Files:**
- Create via CLI suffix: `_authorization_v2_phase4_remaining_enforced_rooms.sql`
- Create: `supabase/tests/authorization_v2_room_remaining_enforced_smoke.sql`
- Modify: `pages/project/ProjectPermissionsTab.tsx`
- Modify: `pages/settings/SettingsPermissionHealth.tsx`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

- [x] **Step 1: Test assignment, payment/acceptance workflow, incident close, approval/confirmation, final-state immutability và wrong project/site.**
- [x] **Step 2: Backfill và enforce chỉ Quantity Acceptance/Payment/Safety; action không có business path phải retire với reason.**
- [x] **Step 3: Xử lý disposition action-level của `material_request.verify` theo kết quả Task 7, không thay đổi các Material Request actions đã cutover.**
- [x] **Step 4: Audit assert 10 active Room có disposition rõ ràng, 4 Room retired có evidence, fallback-only=0, stale member=0; checksum bảy Room cũ không đổi ngoại trừ metadata disposition đã duyệt.**
- [x] **Step 5: Set `project_room_pbac_fallback_enabled=false`; chạy full Room smoke/audit matrix và regression bốn module view/admin-write.**
- [x] **Step 6: Apply/evidence theo protocol.**

**Commit:** `feat(auth): cut over final three project rooms`

**Kết quả:** release candidate `e235c72`; migration `20260910031856` đã áp dụng lên Cloud main. 20 binding của ba Room cuối được cutover; mọi active Room action đã `enforced`, Room fallback đã tắt, `audit_only=0`, fallback-only=0 và stale member=0. `material_request.verify` được retire action-level có snapshot/reason. Backfill tạo 63 membership active cho mỗi Room Quantity Acceptance/Payment/Safety theo quyết định DIRECT/ROLE/LEGACY đang hiệu lực; 7 Room cũ không chạy lại migration, chỉ reconcile 7 stale membership và 24 Weekly Progress fallback gap đã đo trước. Full regression đạt 374 files / 1.769 tests; lint/build và Cloud postflight đạt.

**Phase 4 exit gate:** 7 Room cũ không bị re-apply; 3 Room mới được cutover; 4 Room view-only được retire có evidence và admin-write regression; mọi active action `enforced` hoặc retired có reason; 0 `audit_only`, 0 fallback-only, 0 stale member, Room fallback off.

## Giai đoạn 5 — Migrate module legacy sang canonical grants

### Task 10: Deterministic legacy migration

**Files:**
- Create via CLI suffix: `_authorization_v2_phase5_legacy_grant_migration.sql`
- Create: `supabase/tests/authorization_v2_phase5_legacy_grant_migration_smoke.sql`
- Create: `supabase/audits/authorization_v2_legacy_migration_preview.sql`
- Create: `lib/__tests__/authorizationLegacyGrantMigration.test.ts`
- Modify: `pages/settings/SettingsPermissionHealth.tsx`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

**Interfaces:**
- Private backup `authorization_legacy_user_snapshots(cutover_id, user_id, legacy_payload, captured_at, checksum)`.
- Dispositions: `mapped_view`, `mapped_manage`, `room_owned`, `role_owned`, `manual_review`, `retired`.

- [x] **Step 1: Preview không ghi data** — allowed module/submodule→view; admin module/submodule→view/manage; không tự sinh submit/verify/confirm/approve; Project workflow→Room; HR template-only→ROLE; unknown→manual_review.
- [x] **Step 1a: View-only disposition** — bốn module retired chỉ map sang quyền view; không sinh lại `create/record/edit/manage/submit/verify/approve/confirm`. System Admin write đến từ `is_admin()`, không từ grant migration.
- [x] **Step 2: Gate** — manual_review=0; 24 legacy-only baseline có canonical shell/view hoặc retired disposition; không duplicate active grant tuple.
- [x] **Step 3: Snapshot bốn columns vào private table rồi insert idempotent grants với cutover metadata.**
- [x] **Step 4: Shadow compare allow/deny; production audit đạt legacy-only=0, unresolved collisions=0, unknown mapping=0.**
- [x] **Step 5: Apply/evidence theo protocol.**

**Commit:** `feat(auth): migrate legacy modules to canonical grants`

**Kết quả:** release candidate `d4dc7e2`; migration `20260910033302` đã áp dụng lên Cloud main. 57 user snapshots có SHA-256; 0 manual review và 0 legacy-only. 5.837 disposition được ghi rõ: 1.741 mapped-view, 565 mapped-manage, 1.605 Room-owned, 550 HR role-owned và 1.376 retired. Có 4 deterministic HR profiles theo đúng permission set, tránh gán role HR rộng. Active canonical grants tăng lên 3.271; view-only modules không nhận lại mutation grant. Full regression 375 files / 1.774 tests, lint và build đạt.

### Task 11: Tắt legacy fallback, giữ columns cho rollback window

**Files:**
- Create via CLI suffix: `_authorization_v2_phase5_disable_legacy_fallback.sql`
- Create: `supabase/tests/authorization_v2_phase5_no_legacy_fallback_smoke.sql`
- Modify: `context/authState.ts`
- Modify: `lib/permissions/authorizationEvaluator.ts`
- Modify: `pages/settings/SettingsPermissionHealth.tsx`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

- [ ] **Step 1: Failing tests xác nhận LEGACY source không authorize khi fallback off.**
- [ ] **Step 2: Set `legacy_governance_fallback_disabled=true`, `legacy_fallback_disabled=true`, giữ `legacy_projection_enabled=false`.**
- [ ] **Step 3: Snapshot không đưa LEGACY vào active decision; health vẫn đếm legacy config để cleanup.**
- [ ] **Step 4: Run existing no-legacy smoke, new smoke, 88-test permission regression, lint và build.**
- [ ] **Step 5: Apply/evidence theo protocol.**

**Commit:** `feat(auth): disable legacy permission fallback`

**Phase 5 exit gate:** 0 legacy-only, 0 unresolved collision; active flows chỉ dùng DIRECT/ROLE/ROOM; legacy columns chỉ còn rollback evidence.

## Giai đoạn 6 — Tắt legacy và dọn dẹp

### Task 12: Chặn legacy writes và xóa runtime consumers

**Files:**
- Create via CLI suffix: `_authorization_v2_phase6_disable_legacy_writes.sql`
- Create: `supabase/tests/authorization_v2_phase6_legacy_write_disabled_smoke.sql`
- Create: `lib/__tests__/authorizationLegacyRuntimeRemoval.test.ts`
- Modify: `components/UserModal.tsx`
- Modify: `components/permissions/PermissionMatrix.tsx`
- Modify: `lib/permissions/permissionService.ts`
- Modify: `lib/permissions/projectPermissionService.ts`
- Modify: `lib/homeCapabilities.ts`
- Modify: `lib/feedbackNotificationService.ts`
- Modify: `context/AppContext.tsx`
- Modify: `context/authState.ts`
- Modify: `supabase/functions/ai-assistant/index.ts`
- Modify: `pages/settings/SettingsPermissionHealth.tsx`

- [ ] **Step 1: Static failing test** — runtime authorization files có 0 decision từ bốn legacy fields; chỉ migration/audit và read-only evidence được phép nhắc tới.
- [ ] **Step 2: Remove legacy helpers/consumers và compatibility projection; AI tools dùng canonical evaluator/RPC.**
- [ ] **Step 3: Set `legacy_permission_writes_disabled=true`; smoke chứng minh direct update/RPC cũ bị chặn, canonical admin RPC và account lifecycle vẫn chạy.**
- [ ] **Step 4: Full Vitest, lint, build, query audit, security advisor; apply/evidence theo protocol.**

**Commit:** `refactor(auth): remove legacy authorization runtime`

### Task 13: Drop legacy schema sau observation gate

**Observation gate:** tối thiểu 7 ngày sau Task 12 trên Cloud main; không incident rollback; deny anomaly không tăng; các persona trọng yếu được xác nhận; reconciliation vẫn đạt Phase 5 gates. Chưa đủ gate thì dừng ở Task 12 và không coi chương trình hoàn tất.

**Files:**
- Create via CLI suffix: `_authorization_v2_phase6_drop_legacy_schema.sql`
- Create: `supabase/tests/authorization_v2_phase6_final_smoke.sql`
- Modify: `types.ts`, `context/authState.ts`
- Modify: `docs/security/permission-audit.md`
- Modify: `docs/security/permission-refactor-roadmap.md`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

- [ ] **Step 1: Chụp checksum backup; test restore query trong rollback transaction.**
- [ ] **Step 2: Dependency preflight rồi drop `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules` và legacy-only functions/triggers/views.**
- [ ] **Step 3: Xóa legacy fields khỏi `User` và row mappers.**
- [ ] **Step 4: Final smoke** — legacy objects absent; public authorization tables RLS on; no PUBLIC private execute; all fallbacks off; unknown route/action deny.
- [ ] **Step 5: Full tests/lint/build/migration check/query audit/advisors; dry-run; apply main; final evidence commits.**

**Commits:**
- `refactor(auth): drop retired legacy permission schema`
- `docs(auth): close authorization v2 main rollout`

**Phase 6 exit gate:** legacy schema/runtime đã xóa; Cloud main và Git ledger khớp; audit/tests/docs phản ánh một mô hình duy nhất.

## Kết quả dự kiến

- Một chuỗi quyết định: active account → module shell → scoped capability → Room/assignment → workflow state → action.
- Một authorization editor và một atomic transaction; không còn ba bề mặt chỉnh quyền cạnh tranh.
- 0 active legacy-only user; 0 unresolved collision; 0 unknown legacy mapping.
- 10 active Project Room; 7 Room giữ nguyên cutover, 3 Room cutover mới; 4 Room retired thành view-only cho user thường/System Admin-write.
- 100% active Room action `enforced` hoặc retired có lý do; 0 `audit_only`; 0 fallback-only; 0 stale active Room member.
- Room fallback off; legacy fallback off; legacy writes disabled.
- Unknown protected route/action deny; RLS/RPC là authority cuối; notification recipient không suy từ permission rộng.
- Mỗi Cloud main change truy được tới migration SHA, preflight, smoke, advisor output, rollback decision và evidence commit.

## Rollback boundaries

- Phase 1–3: forward commit tắt UI/RPC usage; giữ additive schema.
- Phase 4: forward migration bật per-action fallback và hạ binding về `audit_only`; giữ membership/backfill evidence.
- Phase 5: bật lại legacy flags và đối soát snapshot checksum; không overwrite canonical grants tự động.
- Phase 6 Task 12: chỉ hạ write guard bằng audited forward migration.
- Phase 6 Task 13: destructive drop chỉ sau observation gate; restore bằng reviewed forward migration từ snapshot, không sửa migration đã chạy.
