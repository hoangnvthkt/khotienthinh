# Session Handoff — VIOO System Admin / Member Permission Hard Cutover

Ngày kết xuất: `2026-07-20T20:52:11+07:00`

Workspace: `/Users/admin/khotienthinh`

Nhánh làm việc: `refactor/module-du-an-v1`

HEAD trước commit handoff: `f7e6757f1980b9f6d5954cd23972241f9144436a`

Remote snapshot tại thời điểm kết xuất:

- `origin/refactor/module-du-an-v1`: `316be574158e9a6c91c8f173221c7bad3bad7e19`;
- local branch đang đi trước remote `13` commit và không đi sau commit nào;
- `origin/main`: `e30332a0a82d1a2df8609d930c250e125ee69b7b`;
- local `main`: `59a5ddcb7c9ff47fce7156cc17c96ca1dd05295a`.

Tài liệu này dùng để mang công việc sang một phiên chat/Agent khác. Nó mô tả
định hướng đã duyệt, trạng thái repository, thay đổi chưa commit, trình tự thực
hiện và các cổng an toàn. **Handoff không tự cấp quyền push, deploy, mutation
Supabase Cloud, thay đổi grant người dùng, bật rollout flag hoặc chạy cutover.**

---

## 1. Chỉ dẫn bắt đầu cho Agent ở phiên mới

Đọc đầy đủ theo đúng thứ tự:

1. `docs/session-handoff-2026-07-20-system-admin-permission-hard-cutover.md`;
2. `docs/superpowers/specs/2026-07-20-vioo-system-admin-member-permission-model-design.md`;
3. `docs/superpowers/plans/2026-07-20-vioo-pilot-hard-cutover-program.md`;
4. `docs/superpowers/plans/2026-07-20-vioo-account-application-foundation.md`;
5. `docs/superpowers/plans/2026-07-20-vioo-permission-enforcement-readiness.md`;
6. `docs/superpowers/plans/2026-07-20-vioo-pilot-cutover-and-recovery.md`;
7. khi cần đối chiếu code hiện tại:
   - `types.ts`;
   - `components/UserModal.tsx`;
   - `components/permissions/DirectUserPermissionWorkspace.tsx`;
   - `components/permissions/UnifiedPermissionMatrix.tsx`;
   - `lib/permissions/permissionTypes.ts`;
   - `lib/permissions/permissionRegistry.ts`;
   - `lib/permissions/permissionService.ts`;
   - `lib/permissions/authorizationGovernanceTypes.ts`;
   - `lib/permissions/authorizationGovernanceService.ts`;
   - `lib/wmsPermissions.ts`;
   - `context/AuthContext.tsx`;
   - `context/authState.ts`;
   - `supabase/migrations/20260720095234_remote_schema_baseline.sql`.

Sau khi đọc, Agent mới phải:

1. chạy `git branch --show-current`, `git log -5 --oneline` và
   `git status --short`;
2. xác nhận các file dirty bên dưới vẫn còn nguyên, không tự động reset/checkout;
3. chạy lại focused tests, TypeScript và build trước khi kết luận trạng thái;
4. nếu cần dữ liệu Supabase, chỉ chạy read-only inventory và không in secret/PII;
5. báo ngắn gọn cho anh checkpoint thực tế;
6. nếu prompt mới chỉ yêu cầu đọc/báo cáo thì dừng ở checkpoint; nếu prompt yêu
   cầu tiếp tục triển khai thì mặc định làm `Inline Execution`, bắt đầu từ
   Checkpoint 0 bên dưới và không hỏi lại một quyết định đã có trong handoff;
7. không coi việc duyệt thiết kế/kế hoạch là phê duyệt production cutover.

Phương thức trao đổi anh ưu tiên:

- dùng tiếng Việt, xưng `anh/em`;
- lead bằng kết quả/checkpoint, sau đó mới nói kỹ thuật;
- cập nhật ngắn trong lúc làm, không để quá lâu không báo trạng thái;
- nêu rõ phần nào đã xong, phần nào đang dở và anh có thể kiểm tra ở đâu;
- không tự mở rộng sang refactor ngoài phạm vi phân quyền.

---

## 2. Quyết định nghiệp vụ cuối cùng đã được anh duyệt

Đặc tả chuẩn duy nhất:

`docs/superpowers/specs/2026-07-20-vioo-system-admin-member-permission-model-design.md`

### 2.1 Vai trò tài khoản

Chỉ còn hai vai trò nghiệp vụ:

```text
SYSTEM_ADMIN | MEMBER
```

Giá trị lưu trữ hiện tại chưa đổi ngay:

```text
ADMIN    -> SYSTEM_ADMIN
EMPLOYEE -> MEMBER
```

`WAREHOUSE_KEEPER` phải được chuyển thành Member + warehouse assignment + WMS
action permissions trước khi bị loại khỏi UI/resolver.

Yêu cầu cứng:

- đúng một System Admin active trong vận hành bình thường;
- tài khoản System Admin đó là của anh;
- mọi tài khoản còn lại là Member;
- UI/RPC bình thường không được tạo System Admin thứ hai;
- System Admin duy nhất không được tự hạ quyền, disable hoặc delete;
- recovery khẩn cấp dùng service-role-only command, có snapshot, lý do, change
  reference và audit;
- recovery chỉ phục hồi quyền quản trị hệ thống, không tự sinh business grants.

### 2.2 Không có Application Administrator

Bỏ hoàn toàn các khái niệm sau khỏi target state:

- Application Administrator / App Admin;
- `APP_ADMIN` effective source;
- access level `APP_ADMIN`;
- checkbox/badge/chip “Quản trị ứng dụng”;
- per-app admin assignment;
- App Admin trong cutover manifest.

Không đổi tên App Admin thành một capability khác cho Member. Nếu sau này cần
ủy quyền cấu hình cho người khác thì phải có design mới.

### 2.3 Quyền mặc định của System Admin

System Admin mặc định có:

```text
SYSTEM_ADMIN_VIEW
SYSTEM_ADMIN_CONFIGURATION
```

`SYSTEM_ADMIN_VIEW` cho phép:

- mở mọi application/module route đã đăng ký;
- SELECT/read-only toàn bộ dữ liệu mọi project, warehouse, department,
  ownership và assignment;
- đọc detail, dashboard, audit và read-only RPC ngoài scope được phân công.

Nó không cho phép:

- INSERT/UPDATE/DELETE;
- create/edit/delete business record;
- submit/return/verify/confirm/approve/pay/close/adjust/receive/issue;
- import/export/bulk operation;
- RPC/Edge Function/trigger/storage mutation.

Các action tên `report`, `download`, `export`, `summarize`, `generate` không
được tự coi là read-only. Phải kiểm tra side effect/data-exfiltration risk trước.

`SYSTEM_ADMIN_CONFIGURATION` chỉ phát các permission thuộc allowlist
`permission_group = 'system_admin'`, ví dụ account, permission governance,
system settings, template, shared catalog và workflow definition.

Tạo project, warehouse hoặc root business object vẫn là business mutation và
cần permission riêng.

### 2.4 Business mutations và quyền nhạy cảm

Mọi business mutation, kể cả khi actor là System Admin, phải có:

```text
explicit action permission
+ compatible scope
+ required assignment/relationship
+ valid workflow state
+ no SoD/sensitive denial
```

System Admin có thể được cấp explicit non-sensitive business grant khi thật sự
cần. System Admin duy nhất không được tự cấp sensitive business permission.
Sensitive actions trong vận hành bình thường được System Admin cấp cho Member
đủ điều kiện, có reason, expiry khi policy yêu cầu, audit và SoD.

### 2.5 Application membership

Membership chỉ áp dụng cho Member:

```text
NONE | MEMBER
```

Không có cột `access_level`. Relation target chỉ có ACTIVE/REVOKED cùng evidence
grant/revoke. System Admin không có membership row vì được vào mọi app mặc định.

Quy tắc:

- membership chỉ mở application shell, không tự cấp business action;
- Member grant phải thuộc app mà Member đang có membership;
- remove membership phải atomically revoke active Direct Grants của app;
- re-add app không được phục hồi grants đã revoke;
- `settings` là System Admin-only, `member_assignable=false`;
- `procurement` là một application độc lập trong canonical catalog.

### 2.6 Cutover

Anh đã duyệt hướng `pilot hard cutover`:

- không xây dual-mode dài hạn;
- không xây product-facing Legacy conversion workbench;
- trước cutover phải snapshot, lập manifest đủ user và verify backend readiness;
- apply membership/grants, clear Legacy arrays và bật fallback-disable atomically;
- post-cutover không còn effective `LEGACY` hoặc `APP_ADMIN` source;
- rollback chỉ là recovery ngắn hạn, có fingerprint/drift guard.

---

## 3. Việc đã hoàn thành và đã commit

### 3.1 Design và kế hoạch

Các commit quan trọng theo thứ tự:

| Commit | Nội dung | Trạng thái |
| --- | --- | --- |
| `a619fc1` | Thiết kế Base-style ban đầu có App Admin | Bị supersede |
| `6903e72` | Chọn pilot hard cutover | Còn hiệu lực ở phần cutover |
| `147a253` | Bộ bốn implementation plan ban đầu | Đã được sửa tiếp |
| `8e5dd08` | Thiết kế System Admin + Member, bỏ App Admin | Approved |
| `f7e6757` | Sửa bốn plan theo thiết kế mới | Plan hiện hành |

Đặc tả App Admin cũ đã có notice superseded:

`docs/superpowers/specs/2026-07-20-vioo-base-style-user-application-permission-model-design.md`

Plan workbench Legacy cũ cũng đã có notice superseded:

`docs/superpowers/plans/2026-07-20-vioo-application-permission-workbench.md`

Không triển khai các task tạo editable Legacy conversion UI trong plan cũ.

### 3.2 Backend permission foundation đã có từ trước

Repository hiện đã có:

- typed permission registries cho Project và ERP apps;
- `permission_applications`, `permission_modules`, `permission_actions`;
- `user_permission_grants` với scope/expiry/revoke metadata;
- effective-source resolver hiện tại (`ROLE | DIRECT | LEGACY`);
- governed Preview/Apply cho unified user permission change;
- permission audit events, SoD rules và readiness gate;
- Asset action enforcement migration;
- HRM employee permission enforcement migration;
- nhiều SQL smokes cho Project, WMS, HRM, global apps và hardening.

Active migration directory hiện có:

```text
supabase/migrations/20260720095234_remote_schema_baseline.sql
supabase/migrations/20260720100000_asset_action_operation_guards.sql
supabase/migrations/20260720104623_hrm_employee_permission_guards.sql
supabase/migrations/20260720110000_current_user_permission_grant_realtime.sql  # uncommitted
```

Không đưa migration archive trở lại active directory.

### 3.3 Những gì chưa được triển khai dù design/plan đã approved

Chưa có trong code/database target:

- `user_application_memberships`;
- `permission_actions.access_application_code`;
- `permission_actions.permission_group = system_admin`;
- `SYSTEM_ADMIN_VIEW`;
- `SYSTEM_ADMIN_CONFIGURATION`;
- exactly-one-System-Admin DB invariant/recovery RPC;
- Base-style Member application panel;
- Member-only membership Preview/Apply command;
- System Admin global read-only RLS/RPC coverage;
- complete removal of ADMIN mutation bypasses;
- complete replacement of WAREHOUSE_KEEPER;
- target entitlement manifest validator;
- cutover Preview/Apply/Rollback commands;
- actual Legacy hard cutover.

Không được nói mô hình mới đã hoạt động chỉ vì spec/plan đã commit.

---

## 4. Công việc đang dở trong worktree — tuyệt đối không làm mất

`git status --short` tại thời điểm handoff:

```text
 M components/permissions/DirectUserPermissionWorkspace.tsx
 M context/AuthContext.tsx
 M context/authState.ts
 M lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx
 M lib/__tests__/authBoundary.test.tsx
?? supabase/migrations/20260720110000_current_user_permission_grant_realtime.sql
```

Các file này chưa commit và không nằm trong commit design/plan. Không dùng
`git reset --hard`, `git checkout --`, `git clean`, hoặc stage rộng.

### 4.1 UX workbench đang dở

Files:

- `components/permissions/DirectUserPermissionWorkspace.tsx`;
- `lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx`.

Nội dung thay đổi:

- thêm ba bước hướng dẫn Chọn scope -> Chọn app/module/action -> Nhập lý do;
- đưa textarea lý do thay đổi quyền lên trước matrix;
- hiển thị tiến độ tối thiểu 10 ký tự;
- giải thích trực tiếp vì sao nút Save đang bị khóa;
- giữ SoD hard-deny và backend Preview/Apply;
- thêm UI contract test kiểm tra thứ tự nội dung.

Lưu ý:

- component hiện vẫn chứa Legacy conversion UI từ plan cũ;
- target cuối cùng không giữ product-facing Legacy conversion;
- không mở rộng thêm Legacy conversion trong thay đổi UX này;
- full-suite hiện có một contract mismatch trực tiếp: test cũ mong
  `Quyền đang có`, component đang dùng `Quyền hiện có`;
- Agent tiếp theo phải chọn một copy chuẩn và đồng bộ test/component trước khi
  commit UX; không sửa test chỉ để che hành vi ngoài design.

### 4.2 Realtime refresh Direct Grant đang dở

Files:

- `context/AuthContext.tsx`;
- `context/authState.ts`;
- `lib/__tests__/authBoundary.test.tsx`;
- `supabase/migrations/20260720110000_current_user_permission_grant_realtime.sql`.

Mục tiêu:

- refresh effective permission snapshot của user đang đăng nhập khi Direct
  Grant của chính user được INSERT/UPDATE/revoke/reactivate/đổi expiry;
- subscribe `user_permission_grants` có filter `user_id=eq.<profileId>`;
- reconcile snapshot ngay khi channel đạt `SUBSCRIBED`;
- debounce refresh bằng zero-delay timer;
- publication migration thêm `public.user_permission_grants` vào
  `supabase_realtime` nếu chưa có.

Current helper behavior:

```text
shouldRefreshCurrentAuthorization:
  true cho INSERT/UPDATE khi new.user_id == current profile
  false cho user khác hoặc DELETE payload hiện tại

shouldReconcileAuthorizationChannel:
  true chỉ khi status == SUBSCRIBED
```

Điểm cần review trước commit:

- DELETE không được lọc theo `new.user_id`; thiết kế hiện dựa vào revoke bằng
  UPDATE và initial/reconnect reconciliation. Xác nhận backend không hard-delete
  active grants hoặc bổ sung DELETE strategy an toàn;
- kiểm tra publication migration bằng local/approved SQL smoke;
- migration chưa được apply Cloud;
- không tự apply hoặc repair migration history dựa trên handoff.

### 4.3 Verification mới nhất cho dirty work

Fresh verification tại `2026-07-20 20:51 +07`:

```text
npm test -- \
  lib/__tests__/applicationPermissionWorkbenchUiContract.test.tsx \
  lib/__tests__/authBoundary.test.tsx

2 test files PASS
28 tests PASS
```

```text
npm run lint
PASS (tsc exit 0)
```

```text
npm run build
PASS (Vite exit 0, 3626 modules transformed)
Known advisory: một số chunks > 500 kB
```

Full suite hiện không xanh:

```text
npm test
136 files PASS, 3 files FAIL
721 tests PASS, 3 tests FAIL, tổng 724 tests
```

Ba failure:

1. `lib/__tests__/authorizationAdminUiContract.test.ts`
   - mong chuỗi `Quyền đang có`;
   - component dirty đang dùng `Quyền hiện có`;
   - liên quan trực tiếp UX workbench đang dở.

2. `lib/__tests__/phase5PermissionHardening.test.ts`
   - actual Legacy consumer có thêm
     `lib/permissions/hrmPermissionCapabilities.ts`;
   - file này không thuộc dirty set hiện tại;
   - cần xác minh consumer hợp lệ rồi cập nhật allowlist hoặc loại Legacy usage,
     không blanket-allow.

3. `lib/__tests__/unifiedPermissionMatrix.test.tsx`
   - test mong label `Chưa xác minh` cho HRM create;
   - UI hiện render `Đã thực thi`;
   - cần đối chiếu readiness HRM migration/catalog, không đổi label tùy tiện.

Không được báo “full test pass” trước khi ba failure được xử lý và chạy lại
`npm test` fresh.

---

## 5. Read-only inventory nền dùng để lập kế hoạch

Các số dưới đây được lấy read-only trong phiên trước ngày `2026-07-20`. Agent
mới phải revalidate trước khi dùng làm preflight/cutover evidence.

### 5.1 Active accounts

| Stored role | Số lượng active |
| --- | ---: |
| `ADMIN` | 1 |
| `EMPLOYEE` | 36 |
| `WAREHOUSE_KEEPER` | 5 |
| Tổng | 42 |

### 5.2 Legacy application assignments

| Legacy key | Active assignment count |
| --- | ---: |
| `CHAT` | 40 |
| `HRM` | 39 |
| `DA` | 37 |
| `WF` | 26 |
| `WMS` | 23 |
| `HD` | 11 |
| `TS` | 10 |
| `EX` | 8 |
| `RQ` | 6 |
| `SETTINGS` | 5 |
| `EP` | 2 |

Read-only query không trả active `admin_modules`, nhưng `admin_sub_modules` vẫn
còn ở Project, Workflow, WMS, Contract, HRM và Request.

### 5.3 Rollout flags

```text
legacy_fallback_disabled=false
business_role_resolver_enabled=false
```

Cutover plan còn yêu cầu bật
`admin_business_approval_bypass_disabled=true` trong cùng governed event; phải
revalidate tên flag/function thực tế trước implementation.

### 5.4 Permission readiness

| Prefix | Readiness aggregate đã quan sát |
| --- | --- |
| Project | `135 declared / 25 legacy / 19 verified` |
| HRM | `6 declared / 3 enforced / 2 legacy` |
| WMS | `11 declared / 1 legacy` |
| Asset | `2 declared / 16 enforced / 4 legacy` |

Các app khác vẫn có nhiều `declared`/`legacy`. Direct Grant readiness guard hiện
từ chối grant mới nếu action chưa `enforced` hoặc `verified`.

### 5.5 Known code/backend gaps

- `EffectivePermissionSourceType` hiện chỉ có `ROLE | DIRECT | LEGACY`;
- `permissionService.ts` vẫn cho `Role.ADMIN` nhiều action/route mặc định;
- `lib/wmsPermissions.ts` vẫn dùng `Role.ADMIN` và `Role.WAREHOUSE_KEEPER`;
- `types.ts` vẫn có enum `WAREHOUSE_KEEPER` và `assignedWarehouseId`;
- nhiều SQL policies/RPCs vẫn dùng `is_admin()`, `is_module_admin(...)` và WMS
  keeper helpers;
- Project BOQ DELETE có đường enforcement chấp nhận edit ở policy/helper hiện
  tại; phải tách `.edit` và `.delete`;
- BOQ `view/edit/delete` đã declared, `manage` còn Legacy;
- Project frontend registry có 26 module trong khi DB inventory từng trả 28;
  hai module cần reconcile là direct purchase và supplier delivery;
- `project.material_request.confirm` và `confirm_fulfillment` có code mismatch;
- nhiều approval/confirm actions chưa có real backend operation/evidence.

Không blanket-promote readiness để vượt gate.

---

## 6. Trình tự công việc sẽ triển khai

Master plan:

`docs/superpowers/plans/2026-07-20-vioo-pilot-hard-cutover-program.md`

Tổng hiện tại: `34` task và `205` checkbox/checkpoint.

### Phase A — Account và Application Foundation

Plan:

`docs/superpowers/plans/2026-07-20-vioo-account-application-foundation.md`

Thứ tự bắt buộc:

1. canonical application catalog;
2. `procurement` là app độc lập;
3. `settings.memberAssignable=false`;
4. permission groups `access | action | system_admin`;
5. audited Member-only `user_application_memberships`;
6. governed membership Preview/Apply;
7. membership removal atomically revokes app Direct Grants;
8. `SYSTEM_ADMIN_VIEW` effective sources;
9. `SYSTEM_ADMIN_CONFIGURATION` allowlist;
10. exactly-one-System-Admin invariant;
11. service-role-only admin recovery;
12. Base-style single-toggle Member application UI;
13. account form chỉ hiển thị System Admin/Member, không tạo keeper mới;
14. session/realtime refresh integration.

Phase A exit gate:

- direct membership DML bị deny;
- System Admin không có membership row;
- System Admin đọc global nhưng không có business mutation source;
- configuration source chỉ chứa allowlist;
- ordinary UI không tạo zero/two admins;
- recovery smoke pass;
- membership remove/re-add semantics pass;
- tests/typecheck/build/local SQL smokes pass.

### Phase B — Permission Enforcement Readiness

Plan:

`docs/superpowers/plans/2026-07-20-vioo-permission-enforcement-readiness.md`

Thứ tự:

1. generate readiness/bypass inventory;
2. enforce Member application prerequisite;
3. add System Admin read-only branch to SELECT/read RPC only;
4. use Project BOQ as golden fine-grained slice;
5. prove System Admin BOQ view outside project assignment;
6. prove System Admin BOQ edit/delete denial without grants;
7. replace WAREHOUSE_KEEPER with warehouse relationship + WMS actions;
8. preserve System Admin warehouse read, deny stock mutations;
9. complete required Project workflow slices;
10. complete HRM/Workflow/WMS/Contract/Asset/Expense/Request/Chat waves;
11. classify/remove every broad ADMIN/module-admin mutation bypass;
12. create encrypted off-repo pilot entitlement manifest;
13. validate exactly one SYSTEM_ADMIN and zero System Admin memberships;
14. database readiness Preview returns zero blockers.

Chỉ action thật sự cần cho pilot manifest mới bắt buộc hoàn thiện. Action không
dùng có thể tiếp tục `declared` nhưng không được grant và không xuất hiện trong
manifest.

Mỗi action được promote chỉ sau:

1. intended allow;
2. wrong-scope denial;
3. ownership/state/assignment denial;
4. adjacent-action denial;
5. direct-API denial;
6. separate readiness promotion migration.

### Phase C — Pilot Cutover và Recovery

Plan:

`docs/superpowers/plans/2026-07-20-vioo-pilot-cutover-and-recovery.md`

Deliverables:

- immutable private DB snapshot;
- encrypted external snapshot artifact;
- normalized manifest + SHA-256;
- read-only cutover Preview;
- atomic Apply with advisory lock/idempotency/fingerprint;
- exact postconditions;
- drift-protected, time-bounded rollback;
- post-cutover Legacy write guard;
- permission health checks;
- operator runbook và archetype checklist;
- hai apply rehearsals + một rollback rehearsal;
- exact production approval packet.

Production Apply phải đảm bảo:

- đúng một ADMIN/SYSTEM_ADMIN active;
- System Admin không có membership row;
- keeper roles -> Member;
- Member memberships/grants đúng manifest;
- Legacy arrays rỗng;
- zero effective `LEGACY` và `APP_ADMIN`;
- `SYSTEM_ADMIN_VIEW` cover toàn bộ pilot read workflows;
- `SYSTEM_ADMIN_CONFIGURATION` chỉ allowlist;
- zero implicit System Admin business mutation;
- audit + refresh đầy đủ;
- fingerprint đúng.

Production mutation không được chạy nếu chưa có approval riêng cho exact
packet, migration hashes, manifest fingerprint, environment và rollback window.

### Post-stabilization

Sau khi cutover ổn định:

- remove product-facing Legacy controls/conversion branches;
- remove frontend Legacy fallback;
- giữ DB Legacy fields đến hết recovery retention;
- drop columns/functions chỉ trong cleanup plan và approval riêng;
- không xóa recovery evidence/audit.

---

## 7. Checkpoint tiếp theo đề xuất

Chưa bắt đầu Plan A ngay khi worktree còn dirty mà không phân loại.

Checkpoint đề xuất:

### Checkpoint 0 — Đóng hoặc cô lập dirty realtime/UX work

1. đọc diff sáu file dirty;
2. nếu prompt mới đã yêu cầu tiếp tục triển khai, hoàn tất checkpoint này trong
   phạm vi local; nếu prompt chỉ yêu cầu tiếp nhận handoff, báo hai lựa chọn và
   chờ anh chọn;
3. nếu hoàn tất:
   - đồng bộ `Quyền hiện có`/`Quyền đang có`;
   - triage hai full-suite failure còn lại;
   - verify migration publication/realtime semantics;
   - chạy focused tests, full `npm test`, `npm run lint`, `npm run build`;
   - commit UX và realtime theo hai commit riêng nếu reviewer có thể duyệt độc lập;
4. nếu tạm hoãn:
   - tuyệt đối không reset;
   - không sửa chồng các file đó trong Plan A nếu chưa thống nhất;
   - cân nhắc worktree riêng khi bắt đầu implementation, theo skill
     `superpowers:using-git-worktrees`.

### Checkpoint 1 — Plan A Task 1

Sau khi dirty boundary rõ ràng:

- mặc định dùng `superpowers:executing-plans` để làm inline;
- chỉ dùng subagent khi anh yêu cầu rõ trong phiên mới;
- viết failing test cho canonical app catalog;
- tạo `lib/permissions/applicationAccessCatalog.ts`;
- include `procurement`;
- mark `settings.memberAssignable=false`;
- không động Cloud;
- commit focused và review trước Task 2.

Agent mới không được nhảy thẳng vào cutover hoặc xóa Legacy.

---

## 8. Quy tắc Git bắt buộc

- Current branch: `refactor/module-du-an-v1`.
- Branch local đang ahead remote; không push nếu anh chưa yêu cầu.
- Không rebase/merge/pull tùy ý trong dirty worktree.
- Không dùng `git reset --hard`, `git checkout --`, `git clean -fd`.
- Không stage `.` hoặc stage directory rộng khi đang có dirty changes.
- Luôn `git add` exact file list và kiểm tra `git diff --cached --name-only`.
- Existing/new dirty changes thuộc về user/current work; preserve.
- Mỗi task implementation dùng focused commit sau fresh verification.
- Không amend các commit design/plan đã có nếu không được yêu cầu.

---

## 9. Quy tắc Supabase và Cloud bắt buộc

Khi làm bất kỳ việc gì liên quan Supabase, phải đọc skill Supabase đầy đủ.

### Local migration development

- CLI hiện tại: `2.95.6`;
- luôn chạy `npx supabase <command> --help` trước khi đoán flag;
- tạo migration bằng `npx supabase migration new exact_name`;
- không tự đặt timestamp filename;
- private authorization helpers ở `app_private`, wrapper có kiểm soát ở public;
- public tables phải bật RLS;
- browser không direct-write role/membership/grant/audit/cutover/Legacy fields;
- không tạo security-definer helper tùy tiện trong exposed schema;
- behavior migration và readiness-promotion migration phải tách riêng.

### Cloud

Handoff không cho phép:

- `db push`;
- apply migration;
- migration history repair;
- deploy Edge Function;
- mutate users/memberships/grants;
- enable flags;
- run cutover/rollback.

Mọi Cloud mutation cần approval riêng, nêu rõ:

- project/environment;
- exact command;
- exact files và SHA-256;
- expected before/after counts;
- rollback/containment;
- dữ liệu nào thay đổi.

Read-only query được phép khi cần kiểm chứng, nhưng không in:

- `.env`;
- database URL;
- anon/service-role token;
- password/session/Auth ID;
- tên/email/user ID;
- raw grant manifest.

Manifest thật chứa danh tính/scope nên phải encrypted và off-repo. Git chỉ giữ
schema, validator, aggregate counts và fingerprint.

---

## 10. Testing và evidence

TDD cho mọi feature/bugfix:

```text
failing test/smoke
-> verify RED
-> minimal implementation
-> focused PASS
-> negative evidence
-> typecheck/build
-> focused commit
```

Readiness action evidence tối thiểu:

- intended allow;
- no-membership denial với Member;
- wrong scope/assignment denial;
- state/ownership denial;
- adjacent-action denial;
- direct API denial;
- System Admin global read allow nếu là read workflow;
- System Admin mutation denial nếu chưa có explicit grant.

Trước khi nói hoàn thành:

```bash
npm test
npm run lint
npm run build
npx supabase db reset
npx supabase test db
git status --short
```

Chỉ chạy local Supabase commands khi environment hỗ trợ và đúng plan. Nếu local
DB không khả dụng, báo chính xác phần nào chưa verify; không thay bằng claim.

Không promote `declared/legacy` action chỉ vì frontend đã ẩn/hiện đúng.

---

## 11. Blocker và chú ý thiết kế

1. **Single-admin availability:** exactly-one invariant cần recovery command
   trước cutover; không dựa vào UI.
2. **Universal view boundary:** phải audit từng SELECT/read RPC. Không dùng
   `is_admin()` chung cho mutation.
3. **Export/data exfiltration:** export/download không mặc định thuộc view.
4. **Configuration taxonomy:** `manage` không tự thành `system_admin`.
5. **Root object creation:** project/warehouse create là business mutation.
6. **Membership vs permission:** app membership không tự cấp view/action; System
   Admin là ngoại lệ chỉ về app access và reviewed read sources.
7. **Sensitive self-grant:** sole System Admin không thể tự cấp sensitive grant;
   đừng lách bằng service role hoặc direct SQL.
8. **Keeper migration:** `assignedWarehouseId=null` không được hiểu là global
   keeper sau cutover; global scope phải explicit.
9. **Readiness:** `declared` và `legacy` không grantable cho target manifest.
10. **Legacy conversion UI:** superseded, không tiếp tục đầu tư.
11. **Dirty realtime migration:** chưa Cloud apply, chưa commit.
12. **Full test suite:** đang có ba failures; không bỏ qua trong handoff.
13. **Remote drift:** local ahead 13 commits tại snapshot; re-check trước push.
14. **Migration baseline:** không sửa baseline đã tạo; forward migration mới.

---

## 12. Definition of Done tổng thể

Chương trình chỉ được coi hoàn thành khi:

- đúng một System Admin active;
- mọi user còn lại là Member;
- không còn App Admin ở schema target/resolver/UI/manifest;
- System Admin đọc được toàn bộ business data qua reviewed read paths;
- System Admin role không tạo business mutation authority;
- configuration implicit authority chỉ đúng allowlist;
- Members chỉ dùng assigned apps/actions/scopes/relationships;
- WAREHOUSE_KEEPER không còn là authorization role;
- mọi action trong pilot manifest `enforced`/`verified`;
- Project BOQ edit/delete độc lập;
- cutover apply atomically và zero Legacy source;
- realtime session refresh hoạt động sau membership/grant change;
- audit/fingerprint/health checks đầy đủ;
- rollback rehearsal khôi phục exact fingerprint;
- full tests/typecheck/build/local SQL tests pass;
- production packet được anh approve riêng và post-cutover checklist pass.

---

## 13. Prompt gợi ý để anh dán vào phiên chat mới

```text
Em hãy tiếp tục chương trình refactor phân quyền VIOO tại
/Users/admin/khotienthinh.

Đầu tiên đọc đầy đủ file:
docs/session-handoff-2026-07-20-system-admin-permission-hard-cutover.md

Sau đó đọc spec và ba child plan được file handoff chỉ định. Kiểm tra branch,
HEAD và git status bằng read-only commands. Tuyệt đối không reset hoặc làm mất
các file dirty realtime/UX; không mutation Supabase Cloud và không push nếu anh
chưa duyệt riêng.

Hãy báo lại anh ngắn gọn:
1. trạng thái đã hoàn thành;
2. phần đang dở và test hiện tại;
3. checkpoint tiếp theo;
4. cách em sẽ xử lý dirty realtime/UX trước khi vào Plan A.

Sau checkpoint, hãy tiếp tục triển khai ngay theo Checkpoint 0 rồi Plan A bằng
Inline Execution. Không hỏi lại các quyết định đã ghi Approved trong spec. Chỉ
dừng để xin anh duyệt khi cần mutation Supabase Cloud, push/deploy/cutover, hoặc
phát hiện lựa chọn mới có thể làm thay đổi thiết kế đã duyệt.

Mô hình đã duyệt: đúng một System Admin, còn lại Member; không có App Admin;
System Admin xem toàn bộ bằng read-only authority nhưng mọi business mutation
và sensitive action vẫn theo explicit permission/gate trong spec.
```

---

## 14. Tóm tắt một đoạn cho Agent mới

VIOO đang chuyển từ Legacy module/submodule permission sang pilot hard cutover.
Target cuối là đúng một System Admin và các Member, không có App Admin. System
Admin được vào mọi app, đọc toàn bộ dữ liệu cross-scope và quản lý cấu hình theo
allowlist, nhưng không có business mutation hoặc sensitive action từ role. Member
cần app membership + action + scope + assignment + workflow. Design và bốn plan
đã approved/commit, nhưng target model chưa được code. Worktree đang dirty với
UX permission editor và realtime Direct Grant refresh; focused 28 tests, tsc và
build pass, full suite còn 3 failures. Việc đúng tiếp theo là đóng/cô lập dirty
work, rồi bắt đầu Plan A Task 1; không nhảy vào Cloud/cutover và không xóa Legacy.
