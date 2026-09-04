# Permission Unification V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hợp nhất nền tảng quyền mới, quyền module và Project Room thành một chuỗi quyết định nhất quán; hoàn tất cutover trên Supabase Cloud `main`, sau đó tắt và dọn legacy có kiểm soát.

**Architecture:** Module permission chỉ mở product shell; capability có namespace và scope quyết định năng lực nghiệp vụ; Project Room quyết định assignment/action trong đúng project hoặc công trường; workflow state và RLS/RPC là lớp quyết định cuối. Frontend dùng một authorization snapshot có nguồn gốc rõ ràng, còn mutation nhạy cảm được backend deny-by-default.

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
- System Admin bypass phải explicit, không áp dụng ngầm cho HRM, business approval, recipient resolution hoặc separation-of-duty.
- Mỗi checkpoint: failing test → implementation → targeted tests → lint → Cloud transaction rollback → commit release candidate → dry-run → apply Cloud main → postflight → commit evidence.
- Mọi Vitest command loại `.worktrees/**`.
- Không stage `supabase/.temp/**`, `.env*`, credential hoặc database output có PII; không dùng `git add .`.
- Thực thi inline bằng primary agent, không dùng sub-agent theo `AGENTS.md`.

---

## Baseline đo ngày 2026-09-04

- 55 active users; cả 55 còn module legacy; 31 có direct grant mới; 24 EMPLOYEE legacy-only.
- 1.181 active direct grants; 1.164 thuộc `project.*`; 17 grant ngoài Project.
- 14 Project Rooms, 72 action bindings: 34 `pilot`, 38 `audit_only`, 0 `enforced`.
- 24 fallback-only combinations ở Weekly Progress; 2 active Room members gắn với `project_staff` đã kết thúc.
- Effective sources: 1.181 DIRECT, 5.362 LEGACY, 333 ROLE; 768 LEGACY+DIRECT và 261 LEGACY+ROLE collisions theo user/code.
- Flags: `business_role_resolver_enabled=true`, `legacy_fallback_disabled=false`, `legacy_governance_fallback_disabled=false`, `legacy_projection_enabled=false`, `project_room_pbac_fallback_enabled=true`, `system_admin_business_approval_bypass_disabled=false`.
- Permission regression baseline: 10 files / 88 tests pass khi loại `.worktrees/**`.

Các số trên là snapshot, không phải hằng số migration. Task 1 chụp lại và ghi mọi chênh lệch trước khi thay đổi Cloud main.

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
- Modify `components/project/permissions/ProjectPermissionRoomsPanel.tsx`, `components/project/permissions/ProjectPermissionRoomCard.tsx`, `components/project/permissions/ProjectPermissionRoomDrawer.tsx`, `lib/projectPermissionRoomService.ts`; tạo ba wave smoke SQL.
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

- [ ] **Step 1: Tests** — non-manager deny; blank reason deny; stale version conflict; invalid grant rolls back profile; valid request updates profile+grants atomically.
- [ ] **Step 2: Implement** — whitelist `name`, `phone`, `avatar`, `manager_id`, `assigned_warehouse_id`; reject role/auth/account/legacy fields; reuse v2 grant validation.
- [ ] **Step 3: Typed frontend service** — reason required, optimistic version, conflict message, no direct `.from('users').update()`.
- [ ] **Step 4: Verify/apply/evidence theo protocol.**

**Commit:** `feat(auth): make user authorization updates transactional`

### Task 6: Unified authorization editor

**Files:**
- Create: `components/permissions/AuthorizationEditor.tsx`
- Create: `components/permissions/LegacyPermissionReadOnly.tsx`
- Create: `lib/__tests__/authorizationEditorUiContract.test.ts`
- Modify: `components/UserModal.tsx`, `components/permissions/PermissionMatrix.tsx`
- Modify: `context/AppContext.tsx`, `lib/permissions/permissionAdminService.ts`

- [ ] **Step 1: UI contract test** — `UserModal` không còn editor “Phân quyền Module”/“Quản trị Sub-module”, không mutate legacy arrays, chỉ gọi transaction service.
- [ ] **Step 2: Implement ba vùng** — module shell, scoped capabilities, Project Room summary/link; legacy chỉ đọc với source/collision/migration state.
- [ ] **Step 3: Clipboard chỉ copy direct grants + scope; save yêu cầu reason; inherited badge không phải checkbox sửa được.**
- [ ] **Step 4: Targeted tests, lint, build và commit.**

**Commit:** `feat(auth): unify permission administration UI`

**Phase 3 exit gate:** một editor, một atomic RPC; không còn partial save giữa profile và grants.

## Giai đoạn 4 — Project Room authoritative cutover

### Task 7: Material Room wave

**Rooms:** `material_planning`, `material_request`, `material_po`, `material_waste`, `custom_material` với toàn bộ actions trong `projectPermissionRooms.ts`.

**Files:**
- Create via CLI suffix: `_authorization_v2_phase4_material_rooms.sql`
- Create: `supabase/tests/authorization_v2_room_material_smoke.sql`
- Modify: `components/project/permissions/ProjectPermissionRoomCard.tsx`
- Modify: `components/project/permissions/ProjectPermissionRoomDrawer.tsx`
- Modify: `lib/projectPermissionRoomService.ts`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

- [ ] **Step 1: Snapshot bindings, PBAC mappings, policies và function definitions.**
- [ ] **Step 2: Smoke Room-only allow; PBAC/module/owner/participant-only deny; wrong scope; inactive staff; empty Room; missing prerequisite.**
- [ ] **Step 3: Backfill chỉ active user + một active unambiguous `project_staff`; preserve manual grants; source `pbac_backfill`; deactivate stale membership.**
- [ ] **Step 4: Enforce exact Room action trong UI/RPC/RLS/transition/recipient path; promote only passing bindings to `enforced`.**
- [ ] **Step 5: Run new smoke cùng material request/PO/phase3 material regressions; apply/evidence theo protocol.**

**Commit:** `feat(auth): enforce material project rooms`

### Task 8: Finance and quality Room wave

**Rooms:** `quantity_acceptance`, `payment`, `boq_reconciliation`, `quality`.

**Files:**
- Create via CLI suffix: `_authorization_v2_phase4_finance_quality_rooms.sql`
- Create: `supabase/tests/authorization_v2_room_finance_quality_smoke.sql`
- Modify: `docs/security/authorization-v2-main-rollout-log.md`

- [ ] **Step 1: Test maker/checker/approver separation, current assignment, final-state immutability, cross-project/site isolation.**
- [ ] **Step 2: Backfill unambiguous staff; enforce exact actions; protect workflow/status columns from direct REST update.**
- [ ] **Step 3: Run new smoke cùng payment/contract và quality authoritative regressions.**
- [ ] **Step 4: Apply/evidence theo protocol.**

**Commit:** `feat(auth): enforce finance and quality project rooms`

### Task 9: Remaining Rooms và tắt fallback

**Rooms:** `gantt`, `weekly_progress`, `safety`, `subcontract`, và re-verify `daily_log`. Gantt edit/delete và Weekly Progress edit/confirm bắt buộc prerequisite view.

**Files:**
- Create via CLI suffix: `_authorization_v2_phase4_remaining_rooms.sql`
- Create: `supabase/tests/authorization_v2_room_remaining_smoke.sql`
- Modify: `pages/project/ProjectPermissionsTab.tsx`
- Modify: `pages/settings/SettingsPermissionHealth.tsx`

- [ ] **Step 1: Test ownership, period lock, assignment, incident close, subcontract approval/confirm và Daily Log verifier/approver.**
- [ ] **Step 2: Enforce passing actions; action không có business path phải retire bằng migration có reason, không để `audit_only`.**
- [ ] **Step 3: Audit assert mọi binding `enforced` hoặc retired, fallback-only=0, stale member=0.**
- [ ] **Step 4: Set `project_room_pbac_fallback_enabled=false`; chạy full Room smoke/audit matrix.**
- [ ] **Step 5: Apply/evidence theo protocol.**

**Commit:** `feat(auth): complete project room authoritative cutover`

**Phase 4 exit gate:** 0 `audit_only`, 0 fallback-only, 0 stale member, Room fallback off; PBAC ngoài Room có disposition và không tự cấp Room action.

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

- [ ] **Step 1: Preview không ghi data** — allowed module/submodule→view; admin module/submodule→view/manage; không tự sinh submit/verify/confirm/approve; Project workflow→Room; HR template-only→ROLE; unknown→manual_review.
- [ ] **Step 2: Gate** — manual_review=0; 24 legacy-only baseline có canonical shell/view hoặc retired disposition; không duplicate active grant tuple.
- [ ] **Step 3: Snapshot bốn columns vào private table rồi insert idempotent grants với cutover metadata.**
- [ ] **Step 4: Shadow compare allow/deny; production audit đạt legacy-only=0, unresolved collisions=0, unknown mapping=0.**
- [ ] **Step 5: Apply/evidence theo protocol.**

**Commit:** `feat(auth): migrate legacy modules to canonical grants`

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
- 100% Room action `enforced` hoặc retired có lý do; 0 `audit_only`; 0 fallback-only; 0 stale active Room member.
- Room fallback off; legacy fallback off; legacy writes disabled.
- Unknown protected route/action deny; RLS/RPC là authority cuối; notification recipient không suy từ permission rộng.
- Mỗi Cloud main change truy được tới migration SHA, preflight, smoke, advisor output, rollback decision và evidence commit.

## Rollback boundaries

- Phase 1–3: forward commit tắt UI/RPC usage; giữ additive schema.
- Phase 4: forward migration bật per-action fallback và hạ binding về `audit_only`; giữ membership/backfill evidence.
- Phase 5: bật lại legacy flags và đối soát snapshot checksum; không overwrite canonical grants tự động.
- Phase 6 Task 12: chỉ hạ write guard bằng audited forward migration.
- Phase 6 Task 13: destructive drop chỉ sau observation gate; restore bằng reviewed forward migration từ snapshot, không sửa migration đã chạy.
