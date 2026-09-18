# Task 12.4.2 — Hoàn thiện quản trị quyền và thu hồi có kiểm soát

> **For agentic workers:** Thực hiện bằng agent chính, tuần tự theo checkpoint; có thể dùng `superpowers:executing-plans`. Không dùng sub-agent theo chỉ dẫn workspace. Đây là kế hoạch, chưa phải bằng chứng triển khai hoặc phê duyệt thu hồi tài khoản cụ thể.

**Goal:** Admin cấp/gỡ được quyền từng phân hệ, đổi loại tài khoản an toàn và hiểu đúng quyền còn hiệu lực; chuyển các nguồn quyền quá độ sang nguồn chuẩn trước khi mở observation gate của Task 13.

**Architecture:** Catalog Cloud mô tả capability, scope, nguồn cấp và điều kiện cấp; frontend và RLS/RPC thực thi cùng hợp đồng quyền. Thay đổi tương thích chức năng được phát hành trước; chuyển đổi dữ liệu chạy bằng manifest có phiên bản, đối chiếu từng tài khoản và rollback theo đúng đợt.

**Tech Stack:** React 18, TypeScript, Vitest, Playwright, Supabase Cloud/Postgres. Node `>=24.13.1 <25`, npm `>=11` theo package.json.

**Spec:** [Module-first editor](../specs/2026-09-11-authorization-v2-module-first-editor-design.md), [kế hoạch tổng](2026-09-04-permission-unification-v2.md), [mô hình vận hành](../../security/authorization-v2-operating-model.md), [rollout log](../../security/authorization-v2-main-rollout-log.md). Phần dưới bổ sung các thiếu sót audit ngày 2026-09-14; không diễn giải “Admin” thành quyền tự động đọc toàn bộ payroll.

## Môi trường và phạm vi

- Branch triển khai dự kiến: `feature/authorization-v2-task12-4-2`; worktree `.worktrees/authorization-v2-task12-4-2`, tạo từ `origin/main` đã fetch và kiểm tra khi bắt đầu thực hiện. Không triển khai trên branch Task 13 hoặc `vioo-work-r1a`.
- Database: Supabase Cloud **main**, project ref `ftciqmqhmfvjtwoycswe`; dùng cấu hình `.env` hiện có, xác minh URL/ref trước mỗi thao tác Cloud. Không local, Docker hoặc branch `baseline-vioo-git`.
- Tại lúc lập kế hoạch, root `main` ở `abc35de` và có thay đổi ngoài phạm vi. Chỉ bổ sung tài liệu kế hoạch; không gom các thay đổi đó vào checkpoint.
- Mọi migration mới tạo bằng Supabase CLI sau khi đọc `--help`; migration đã apply là bất biến. Trước apply phải đối soát ledger, dry-run chỉ chứa đúng thay đổi đã kiểm thử.
- Không chạy lại các Room đã cutover. Giữ `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract`: non-admin chỉ đọc; admin ghi theo backend policy hiện hành.
- HR thường chỉ đọc công/lương của mình; payroll quản trị yêu cầu HR/HR_MANAGE. Không chuyển template HR nhạy cảm thành direct grant để làm checkbox dễ sửa.
- Không drop bốn cột legacy hoặc xóa snapshot trong Task 12.4.2. Giữ fallback off, legacy writes disabled.
- Mỗi checkpoint gồm kiểm thử phù hợp, tự review diff, commit riêng và log bằng chứng. Commit không đồng nghĩa đã deploy hoặc đã đạt persona gate.

## Cơ sở audit và những điều cần xác minh lại

Audit Cloud trước kế hoạch ghi nhận 56 tài khoản active, 417 direct grant `system.*` trên 56 tài khoản và 54 tài khoản có template `LEGACY_HR_*`. Đây là số liệu tại thời điểm audit, **không phải danh sách cần xóa**. `system.authorization.*`, các quyền hệ thống thật và template đang cung cấp quyền hợp lệ phải được phân loại theo consumer, không theo tên.

- Settings bị loại khỏi catalog cấp trực tiếp; các tab chưa có mapping quyền chi tiết đầy đủ.
- UserModal khóa đổi role nhưng đường đổi role nhanh cũ vẫn tồn tại; cần kiểm tra cả RLS/trigger của đường cập nhật users.
- Checkbox chỉ tác động direct grants; grant ẩn hoặc vai trò còn lại có thể giữ quyền hiệu lực. Home/Sidebar/route có thể cho kết quả khác nhau.
- Case Hương đã sửa menu Mẫu yêu cầu; Workflow template, MISA export và các surface khác cần kiểm hợp đồng riêng.
- `App.tsx` còn dùng legacy để redirect; test quét runtime trước đây bỏ sót file này.
- Ledger và main đã thay đổi kể từ lần chuẩn bị Task 13. Không dùng nhận định “sáu migration còn thiếu” như trạng thái hiện tại khi chưa kiểm tra lại.

## Kết quả vận hành phải đạt

| Thao tác của admin | Kết quả cần quan sát và kiểm tra ở API |
|---|---|
| Chọn Module | Thêm đúng bundle Xem được khai báo; quyền ghi/duyệt và dữ liệu nhạy cảm không được tự thêm |
| Bỏ Xem của một phân hệ | Nếu không còn nguồn cấp khác thì menu, URL và API tương ứng đều từ chối |
| Gỡ direct nhưng còn vai trò/Room/Workspace | Hiển thị “Còn quyền từ …”, scope và nơi sửa; không báo đã thu hồi toàn bộ |
| Cấp một mục Cài đặt | Chỉ hiện/cho phép đúng mục, tách Xem và Quản lý; không mở toàn bộ Cài đặt |
| Đổi Admin/Thủ kho/Thường | Role, template quản trị và phạm vi kho nhất quán trong một giao dịch; có receipt/audit |
| Chuyển nguồn quyền cũ | Giữ đúng capability/phạm vi còn được phép; mọi tăng/giảm quyền có lý do và quyết định tường minh |

## Checkpoint 12.4.2-A — Chốt inventory, mapping và dữ liệu kiểm thử

**Create:** `docs/security/authorization-v2-task12-4-2-access-map.md`, `docs/security/authorization-v2-task12-4-2-rollout-log.md`, `supabase/tests/authorization_v2_task12_4_2_inventory.sql`.
**Read:** `components/Sidebar.tsx`, `pages/Home.tsx`, `pages/Settings.tsx`, `lib/settingsPermissions.ts`, `lib/permissions/erpPermissionRegistry.ts`, `lib/permissions/permissionService.ts`, `App.tsx`, Cloud RLS/RPC/catalog/resolver.

- [ ] Tạo worktree riêng từ main hiện hành; ghi Git SHA, Cloud ref và ledger diff. Nếu có remote-only migrations, tích hợp đúng file gốc trước apply; không dùng repair để che lệch ledger.
- [ ] Viết inventory SQL chỉ SELECT: tài khoản active/inactive, grant active/hết hạn, template/assignment, Room/Workspace, catalog, policy/function phụ thuộc; xuất số tổng hợp vào log. Snapshot có thông tin nhân sự giữ ở nơi hạn chế truy cập, không commit email/token/dữ liệu payroll.
- [ ] Lập access-map cho **mọi** mục Cài đặt và menu/module đang active: menu → route/tab → read API → write API → capability/scope/source → legacy consumer → test. Các mục admin-only có lý do nghiệp vụ, không mặc định mở hết.
- [ ] Phân loại từng mã quá độ: giữ quyền hệ thống thật; đã có quyền thay thế tương đương; cần bổ sung capability; cần operator quyết định; hết hạn/không hiệu lực. Mã chưa giải thích được không vào batch.
- [ ] Chốt persona mô phỏng Hà/Hương từ tập quyền đã đối chiếu, cùng admin, HR, thủ kho theo kho, nhân viên liên kết/chưa liên kết employee, Room member và Workspace member. Không ghi grant thật chỉ để QA.
- [ ] Kiểm coverage: mỗi surface có dòng mapping; mỗi nguồn định thu hồi có consumer và quyền thay thế hoặc lý do thu hồi. Commit `docs(auth): map task12.4.2 access and transition sources`.

**Exit:** access-map đầy đủ để triển khai B–E; trường hợp chưa có quyết định được ghi rõ, không tự chuyển thành quyền rộng.

## Checkpoint 12.4.2-B — Phân quyền chi tiết Cài đặt

**Modify:** `lib/settingsPermissions.ts`, `pages/Settings.tsx`, `lib/permissions/erpPermissionRegistry.ts`, `lib/permissions/permissionCatalogService.ts`, `lib/routeAccess.ts`, `constants/routes.ts`.
**Create:** `lib/__tests__/settingsFeatureAuthorization.test.ts`, `supabase/tests/authorization_v2_task12_4_2_settings_smoke.sql`; migrations CLI suffix `authorization_v2_task12_4_2_settings_capabilities`.

- [ ] Từ access-map A, ưu tiên tái sử dụng capability nghiệp vụ đúng nghĩa. Mục chưa có quyền tạo cặp `settings.<feature>.view/manage` với feature snake_case; ví dụ `settings.warehouses.view/manage`. HR dùng capability/template HR đang có. Mục bảo trì, người dùng, quản trị quyền giữ điều kiện quản trị đặc thù và không vào bundle Xem phổ thông.
- [ ] Thêm test thất bại cho người chỉ có Xem Kho bãi: thấy đúng tab, đọc đúng API, không ghi; người có manage được ghi; không quyền bị chặn qua URL/RPC. Kiểm thêm module checkbox không tự cấp quyền xem hồ sơ nhạy cảm.
- [ ] Viết migration additive cho catalog và enforcement RLS/RPC theo mapping; sửa metadata `direct_grant_allowed` khớp validation backend, đặc biệt `system.settings.manage`. Catalog có card Cài đặt cho actor quản trị phù hợp, tách quyền có thể cấp khỏi quyền chỉ giải thích/kế thừa.
- [ ] Thay token thiếu mapping và điều kiện role rải rác bằng hợp đồng feature; không chỉ sửa ẩn tab. Nếu endpoint dùng chung nhiều module, kiểm các caller hợp lệ để không vô tình khóa WMS/HR/Project.
- [ ] Run `npx vitest run lib/__tests__/settingsFeatureAuthorization.test.ts`; Cloud smoke transaction rollback kiểm read/write bằng role authenticated và JWT persona, không lấy service-role bypass làm bằng chứng RLS.
- [ ] Log kết quả và commit `feat(auth): support scoped settings feature permissions`.

**Exit:** cấp/gỡ riêng từng mục Cài đặt hoạt động tới API, gói Xem an toàn và không mở quyền quản trị tổng.

## Checkpoint 12.4.2-C — Chuyển loại tài khoản nguyên tử

**Modify:** `components/UserModal.tsx`, `pages/settings/SettingsUsers.tsx`, `pages/UserManagement.tsx`, `pages/Settings.tsx`, `context/AppContext.tsx`, `lib/permissions/permissionAdminService.ts`.
**Create:** `lib/__tests__/accountRoleTransition.test.ts`, `supabase/tests/authorization_v2_task12_4_2_role_transition_smoke.sql`; migration suffix `authorization_v2_task12_4_2_account_role_transition`.

**Contract dự kiến:** public wrapper `change_user_account_role_v2(p_user_id uuid, p_role text, p_warehouse_id text, p_expected_updated_at timestamptz, p_reason text) returns jsonb`; implementation ở `app_private`. Receipt chứa `userId`, `updatedAt`, `role`, `assignedWarehouseId`, các assignment thay đổi và `auditId`; actor chỉ suy từ JWT.

- [ ] Viết failing tests: employee không tự nâng admin; actor thiếu quyền bị chặn; phiên bản cũ bị chặn; hạ admin cuối cùng bị chặn; hai thao tác hạ admin đồng thời không vượt guard.
- [ ] Thực hiện RPC với kiểm capability quản trị, lý do >=10 ký tự, lock bảo vệ tập admin và target, kiểm phiên bản; cập nhật role cùng assignment SYSTEM_ADMIN, audit và tín hiệu refresh trong một transaction.
- [ ] Khi hạ admin, chỉ thu hồi assignment hệ thống tương ứng; không tự xóa các vai trò nghiệp vụ độc lập. Admin mới không tự có payroll quản trị. Thủ kho phải chọn kho hoặc chế độ toàn bộ kho tường minh; không biến giá trị trống thành cấp toàn kho ngoài ý muốn.
- [ ] Cho UI đổi loại tài khoản qua command này và xác nhận tác động. Menu nhanh gọi cùng command hoặc được bỏ nếu trùng. Backend chặn cập nhật đặc quyền trực tiếp qua users; kiểm không làm hỏng create-user/lifecycle đã được phép.
- [ ] Run `npx vitest run lib/__tests__/accountRoleTransition.test.ts`; SQL smoke kiểm rollback toàn bộ khi lỗi; kiểm concurrency bằng hai connection trên fixture được quản lý. Không tác động admin thật để thử mất quyền.
- [ ] Commit `feat(auth): make account role transitions atomic`.

**Exit:** một đường đổi role có enforcement server, không còn đường UI cập nhật role ngoài giao dịch chuẩn.

## Checkpoint 12.4.2-D — Checkbox và thông báo phản ánh quyền còn hiệu lực

**Modify:** `lib/permissions/moduleGrantSelection.ts`, `lib/permissions/authorizationUpdateValidation.ts`, `lib/permissions/permissionTypes.ts`, `components/permissions/AuthorizationEditor.tsx`, `components/permissions/PermissionModuleCard.tsx`, `components/permissions/RetainedPermissionGrantNotice.tsx`, `components/permissions/HrmAuthorizationPanel.tsx`, `components/UserModal.tsx`.
**Tests:** `components/permissions/__tests__/PermissionModuleEditor.test.tsx`, `lib/__tests__/authorizationUpdateValidation.test.ts`; create `lib/__tests__/moduleGrantRevocationScope.test.ts`.

- [ ] Viết failing case: cùng capability có DIRECT và ROLE; bỏ direct vẫn hiển thị nguồn ROLE. Grant scope kho A không bị xóa khi gỡ riêng kho B. Grant ẩn chưa chuyển đổi hiện lý do giữ lại.
- [ ] Dùng nguồn quyền đầy đủ gồm source ID, loại, scope, expiry để hiển thị “Cấp trực tiếp”, “Từ vai trò …”, “Từ Room …”, “Quyền chuyển đổi đang chờ xử lý”. Cùng mã khác scope không gộp thành một quyền toàn cục.
- [ ] Bỏ tích chỉ gỡ direct đúng phạm vi đang chọn; summary phân biệt quyền bị gỡ với quyền còn hiệu lực. Chỉ dẫn vai trò/Room/Workspace đi đúng nơi quản trị, không tạo thao tác revoke xuyên nguồn ngầm.
- [ ] Sau lưu đọc lại Cloud snapshot và so receipt; nếu lưu thành công nhưng refresh lỗi, báo đúng trạng thái và cho tải lại, không báo chưa lưu hoặc tự gửi lại mutation. Kiểm client đang mở nhận refresh, client offline nhận snapshot mới khi trở lại.
- [ ] Run `npx vitest run components/permissions/__tests__/PermissionModuleEditor.test.tsx lib/__tests__/authorizationUpdateValidation.test.ts lib/__tests__/moduleGrantRevocationScope.test.ts`.
- [ ] Commit `fix(auth): explain effective access and scope direct revocation`.

**Exit:** admin hiểu vì sao một module còn quyền; không có trạng thái “đã gỡ hết” trong khi nguồn khác vẫn tồn tại.

## Checkpoint 12.4.2-E — Đồng bộ menu, route và API trên toàn ứng dụng

**Modify:** `components/Sidebar.tsx`, `pages/Home.tsx`, `App.tsx`, `lib/routeAccess.ts`, `lib/permissions/permissionService.ts`, các page/handler trong access-map A.
**Tests:** mở rộng `lib/__tests__/authorizationLegacyRuntimeRemoval.test.ts`, `lib/__tests__/phase5PermissionHardening.test.ts`; create `lib/__tests__/authorizationSurfaceParity.test.ts`, `tests/e2e/authorization-v2-module-access.spec.ts`, `supabase/tests/authorization_v2_task12_4_2_surface_smoke.sql`.

- [ ] Tạo failing regression từ access-map: Hương có `request.template.manage` truy cập/sửa được mẫu; bỏ manage còn view thì chỉ đọc; bỏ tất cả nguồn view thì menu/URL/API từ chối.
- [ ] Sửa từng consumer theo hợp đồng; kiểm Workflow template theo quyền create/edit/publish riêng. MISA export chỉ mở sau khi có capability và enforcement đã review; không bỏ ADMIN guard chỉ để giống case Request.
- [ ] Home/Sidebar/route dùng cùng điều kiện quyền nghiệp vụ. Shell quá độ không tự mở module thiếu quyền nghiệp vụ; route quản trị thật vẫn dùng quyền hệ thống hợp lệ.
- [ ] Bỏ redirect dựa trên `allowedSubModules` trong App.tsx, suy landing hợp lệ từ capability/scope hiện hành. Mở rộng scanner gồm file root, context, hooks, lib, pages, components và Edge Functions; allowlist chỉ cho mapper/projection/evidence còn chờ Task 13, không allowlist quyết định quyền.
- [ ] Chạy component test thật và Playwright trên build: menu → URL trực tiếp → thao tác → reload; SQL persona test cho read/write mỗi surface có thay đổi. Route không biết và action không biết phải deny.
- [ ] Commit theo nhóm module đã kiểm thử, kết thúc `fix(auth): align application surfaces with effective capabilities`.

**Exit:** toàn bộ access-map có kết quả; B–E phát hành và persona đã xác nhận trước F/G. Test static quét code không thay thế kiểm thử runtime/RLS.

## Checkpoint 12.4.2-F — Manifest chuyển đổi và diễn tập rollback

**Create:** `scripts/authorization-v2/build-task12-4-2-manifest.mjs`, `lib/__tests__/authorizationTransitionManifest.test.ts`, `supabase/tests/authorization_v2_task12_4_2_reconciliation.sql`, `supabase/tests/authorization_v2_task12_4_2_restore_smoke.sql`; migration suffix `authorization_v2_task12_4_2_transition_commands`.

**Manifest contract:** mỗi item có `batchId`, `userId`, `sourceId`, `sourceType`, permission/scope/expiry trước-sau, `disposition` (`retain`, `replace`, `revoke`, `manual_review`), `reason`, `expectedSourceHash`, `expectedTargetVersion`, `mappingVersion`. Hash tính trên serialization chuẩn của toàn bộ nguồn liên quan, không chỉ users.updated_at. File có định danh tài khoản nằm trong evidence store hạn chế truy cập; Git chỉ chứa schema, mapping đã khử định danh và tổng hợp.

- [ ] Viết tests manifest: không xóa `system.authorization.*` chỉ vì tiền tố; không mở rộng own→global; grant hết hạn không được hồi sinh; unknown mapping phải manual_review; lần chạy thứ hai không nhân đôi quyền.
- [ ] Với shell có quyền nghiệp vụ tương đương: thêm phần quyền còn thiếu rồi thu hồi đúng source cũ trong cùng transaction. Nếu đang cần thu hẹp quyền theo mong muốn admin, ghi riêng intentional diff; không gọi đó là chuyển đổi tương đương.
- [ ] Với LEGACY_HR: dùng template nghiệp vụ có tập quyền/scope đúng tương đương, có thể tạo template giới hạn theo capability đã duyệt; không gán đại trà HR/HR_MANAGE, không sửa template chia sẻ làm tác động người ngoài batch. Assignment mới và revoke cũ cùng transaction.
- [ ] Với system quyền thật hoặc capability chưa có phương án: giữ nguyên và phân loại rõ. Mỗi blocker thuộc module đang chuyển phải được giải quyết trước khi đóng module đó; không yêu cầu số mã `system.*` về 0.
- [ ] Snapshot đầy đủ direct grants, role/assignment, scope, expiry, version và checksum ngay trước đợt; bao phủ source dùng chung, active/inactive. Không lưu dữ liệu payroll hoặc secret.
- [ ] Command apply kiểm actor, batch ID, mapping version, lock và hash nguồn; nếu có thay đổi từ admin/Room/template kể từ preview thì reject và tạo manifest mới. Audit before/after và kết quả thực thi nằm cùng transaction; retry có idempotency.
- [ ] Chạy rollback rehearsal bằng fixture Cloud: so effective capability/scope và hành vi API trước/sau; rollback kiểm đúng source do batch sửa và phiên bản hiện hành, dừng nếu có chỉnh sửa độc lập thay vì overwrite.
- [ ] Run `npx vitest run lib/__tests__/authorizationTransitionManifest.test.ts`; commit `feat(auth): add reviewed transition manifests and reversible batches`.

**Exit:** diff từng tài khoản/module, checksum, phép so tương đương và restore đã kiểm chứng. Bằng chứng đủ để operator duyệt batch cụ thể trước thu hồi tài khoản thật.

## Checkpoint 12.4.2-G — Pilot và mở rộng thu hồi

**Modify:** rollout log Task 12.4.2, access-map, operating model; lưu batch receipts và evidence ngoài Git nếu có thông tin tài khoản.

- [ ] Xác nhận release SHA B–F đang chạy, Cloud ledger khớp, persona preflight đạt. Chọn tài khoản pilot theo ID đã xác minh, không chỉ tên giống nhau; Hà/Hương là ứng viên sau khi operator duyệt manifest và expected diff.
- [ ] Đợt 1: pilot canonical module Tài sản/Yêu cầu có mapping đầy đủ; Settings theo feature đã chốt. Run apply đúng batch, đọc lại effective snapshot và kiểm thao tác trên session thực.
- [ ] Nếu không có tăng quyền ngoài manifest hoặc mất quyền bất ngờ, mở theo nhóm mapping đồng nhất; HR thành đợt riêng sau scope/payroll smoke, không trộn với nhóm shell đơn giản.
- [ ] Sau mỗi đợt so đủ người/source, hash, audit, số quyền thêm/gỡ/giữ, route/API allow/deny; ghi rõ người chưa chuyển. Có lỗi thì dừng đợt sau, dùng restore có kiểm tra phiên bản cho đúng đợt bị lỗi.
- [ ] Cập nhật notice và rule giữ grant ẩn theo source còn tồn tại; không xóa cơ chế bảo vệ trước khi mọi account liên quan, kể cả inactive và luồng reactivation, được phân loại.
- [ ] Commit log mỗi đợt `docs(auth): record task12.4.2 batch reconciliation`.

**Exit:** mọi nguồn quá độ trong phạm vi có disposition đã xử lý, không còn manual_review treo; nguồn hệ thống hợp lệ được giữ có lý do. Không dùng “0 LEGACY resolver source” làm bằng chứng duy nhất.

## Checkpoint 12.4.2-H — Nghiệm thu và quan sát trước Task 13

**Modify:** `docs/security/authorization-v2-operating-model.md`, `docs/security/authorization-v2-main-rollout-log.md`, kế hoạch tổng và rollout log Task 12.4.2; đồng bộ runbook Task 13 ở branch chuẩn bị khi tích hợp.

- [ ] Chạy hồi quy: `npm test`, `npm run lint`, `npm run build`, `npm run check:supabase-migrations`, `npm run audit:supabase-queries`, `npm run check:supabase-queries`, `git diff --check`. Nếu inventory query thay đổi, kiểm và cập nhật artifact theo script, không bỏ qua finding.
- [ ] Cloud smokes có rollback: Settings, role transition, source reconciliation, self check-in, own attendance/payroll, HR quản trị, Room và bốn phân hệ retired, Workspace/Work. Advisors kiểm findings mới liên quan thay đổi.
- [ ] Persona browser trên đúng release: Admin, thủ kho A/B, HR/HR_MANAGE, Hà, Hương, employee thường/chưa linked; desktop/mobile, hai phiên concurrent, refresh/offline. Xác nhận cả grant và revoke, không chỉ thêm quyền thành công.
- [ ] Ghi release SHA, thời điểm deploy thực, Cloud migration versions, batch cuối, checklist persona và bằng chứng restore. Cập nhật hướng dẫn với đường cấp Cài đặt/đổi role/gỡ quyền theo nguồn; bỏ mô tả UI cũ đã lỗi thời.
- [ ] Bắt đầu cửa sổ ít nhất 7 ngày tại thời điểm muộn nhất của: release cuối, batch cuối và persona đạt. Regression phân quyền hoặc rollback incident làm reset; thay đổi không liên quan không tự reset nếu có kiểm impact.
- [ ] Theo dõi deny lỗi so baseline đã ghi, lỗi lưu, lỗi tải hồ sơ, mismatch giữa receipt và quyền, phản ánh người dùng; deny hợp lệ sau revoke được phân biệt với deny bất thường. Thu thập tổng hợp, không log payroll/token.
- [ ] Chỉ mở Task 13 khi đủ thời gian, không còn regression/mismatch/manual review, ledger khớp và restore còn dùng được. Không tự drop schema khi hết 7 ngày.
- [ ] Commit `docs(auth): accept task12.4.2 and start observation gate` khi thật sự đạt; trong thời gian chờ, trạng thái là observation pending.

## Quy tắc kiểm thử Cloud và thứ tự phát hành

1. Đọc tài liệu Supabase hiện hành cho API/RLS/CLI thực sự thay đổi; xác minh target từ cấu hình mà không in secret.
2. Tạo migration qua CLI, kiểm local diff; thực hiện thử transaction trên Cloud main chỉ khi toàn bộ SQL thử có rollback và không có side effect ngoài DB. Tạo-user Auth, notification/push, upload không được thử như thể DB rollback sẽ hoàn tác chúng.
3. SQL smoke mô phỏng JWT actor với role authenticated và người ngoài phạm vi; ghi riêng concurrency tests cần fixture/two connections. Không test deny bằng superuser/service role.
4. Apply additive schema/commands trước frontend phụ thuộc; chỉ apply migration đã review với ledger dry-run sạch. Postflight trước release frontend; thu hồi dữ liệu sau frontend/persona gate.
5. Mỗi lỗi giữ evidence/checkpoint chưa đạt; không tick hoàn tất chỉ vì unit test pass. Trước merge/push thực thi theo quyền đã được giao cho checkpoint triển khai và trạng thái main lúc đó, không tái sử dụng SHA lúc lập kế hoạch.

## Self-review kế hoạch

- [x] Bốn câu hỏi audit được bao phủ: Settings (B), loại tài khoản (C), thêm/bớt không hiệu lực (D/E/F/G), quan hệ legacy và Task 13 (F/H).
- [x] Giữ nguyên phạm vi payroll, Room/Workspace và phân hệ retired; không wildcard revoke theo tên mã.
- [x] Có bước xác minh dữ liệu hiện hành, phân loại unknown, stale-preview, concurrency và rollback không đè thay đổi độc lập.
- [x] Tách kết quả kiểm code, deploy, chuyển dữ liệu và observation; mọi checkpoint triển khai còn chưa thực hiện.
