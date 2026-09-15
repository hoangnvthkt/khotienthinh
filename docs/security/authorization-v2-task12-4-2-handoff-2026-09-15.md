# Handoff — Authorization V2 Task 12.4.2

**Thời điểm chốt:** 2026-09-15, Asia/Ho_Chi_Minh

**Mục tiêu tiếp tục:** hoàn tất thu hồi có kiểm soát các nguồn quyền quá độ, đạt persona/observation gate, sau đó mới xem xét Task 13.

**Trạng thái:** Task 12.4.2 đang thực hiện; Task 13 bị chặn.

## 1. Điểm bắt đầu bắt buộc cho phiên mới

- Repository: `/Users/admin/khotienthinh`
- Worktree đang dùng: `/Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2`
- Branch: `feature/authorization-v2-task12-4-2`
- HEAD đã kiểm: `3e64c4c5f1537829b0da29dcf1cccdc2a6f0443f`
- `origin/main` đã kiểm: cùng SHA `3e64c4c5f1537829b0da29dcf1cccdc2a6f0443f`
- Supabase: **Cloud main**, project ref `ftciqmqhmfvjtwoycswe`
- Cấu hình Cloud: `/Users/admin/khotienthinh/.env`
- Supabase CLI đã dùng: `npx --yes supabase@2.116.0`
- Không dùng Supabase local, Docker hoặc branch Cloud `baseline-vioo-git`.
- Không dùng sub-agent theo `AGENTS.md`.

Lệnh kiểm tra đầu phiên:

```bash
cd /Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2
git status --short
git fetch origin main
git rev-parse HEAD
git rev-parse origin/main
```

Nếu hai SHA không còn giống nhau, phải fetch, đọc diff mới và kiểm merge-tree trước khi sửa hoặc push. Không gom thay đổi ngoài phạm vi từ workspace root.

## 2. Quyết định nghiệp vụ không được làm sai lệch

- System Admin vẫn được ghi dữ liệu theo policy/backend hiện hành.
- Bốn phân hệ `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract`: non-admin chỉ đọc; Admin được ghi. Không tái kích hoạt Room mutation cho bốn phân hệ này.
- Không chạy lại 7/14 Room đã cutover trước đó.
- Check-in, chấm công cá nhân và phiếu lương cá nhân phải độc lập với batch HR/payroll quản trị.
- Nhân viên thường chỉ xem công/lương của chính mình. Payroll quản trị chỉ dành cho nguồn vai trò nghiệp vụ HR/HR_MANAGE đã chốt.
- Editor Module-first tự chọn bundle Xem đã review; quyền nâng cao phải được chọn rõ ràng.
- Quyền ẩn `system.*` đã tồn tại được giữ read-only khi lưu grant canonical; không được dùng UI để tạo mới hoặc sửa scope/expiry quyền ẩn.
- Không coi `role=ADMIN` đồng nghĩa tự động có `wms.transaction.reverse`. Quyền Hủy duyệt WMS là canonical-only và yêu cầu grant rõ ràng.
- Không thay `is_module_admin('WMS')` bằng phép “có bất kỳ quyền WMS” vì sẽ biến quyền hẹp thành quyền toàn module.
- Không apply transition batch có định danh tài khoản nếu chưa có operator duyệt manifest/diff cụ thể.
- Không drop bốn cột legacy, snapshot, guard hoặc helper schema trong Task 12.4.2.

## 3. Trạng thái Cloud/Git đã xác minh

Cloud main tại thời điểm handoff:

| Chỉ số | Giá trị |
|---|---:|
| Migration ledger | 68 |
| Migration mới nhất | `20260915024855` |
| Tài khoản active | 56 |
| `system.wms.view` active | 40 |
| `system.wms.manage` active | 23 |
| Transition batch thật | 0 |
| Transition item thật | 0 |
| Function gọi trực tiếp `is_module_admin('WMS')` | 11 |

Bốn flag vẫn phải giữ:

- `legacy_fallback_disabled=true`
- `legacy_governance_fallback_disabled=true`
- `legacy_projection_enabled=false`
- `legacy_permission_writes_disabled=true`

Không có grant/revoke tài khoản thật hoặc batch chuyển đổi nào được chạy trong E5–E13. Các SQL smoke đều dùng transaction rollback.

## 4. Các checkpoint quan trọng đã hoàn tất

Nguồn bằng chứng đầy đủ: `docs/security/authorization-v2-task12-4-2-rollout-log.md`.

### Nền tảng Task 12.4.2

- Inventory/access-map, editor hiển thị nguồn và gỡ đúng direct scope.
- Settings capability chi tiết và account-role transition nguyên tử.
- Request template, Chat và AI Learning đã nối capability canonical.
- Manifest/transition command có checksum, stale guard, idempotency và restore guard.
- Mapping WMS v1 “shell manage → đủ 13 quyền” **đã bị loại** vì sẽ tự cấp `wms.transaction.reverse` cho 23 tài khoản trước đó không có quyền này.
- Mapping hiện hành giữ 23 `system.wms.manage` ở `manual_review`.

### WMS E5–E13

| Checkpoint | Kết quả | Commit |
|---|---|---|
| E5 | Unknown/inactive WMS action fail-closed | `092ca54` |
| E6 | `wms.transaction.reverse` canonical-only | `c1790ca` |
| E7 | Read inventory/transaction theo capability và scope | `82180af` |
| E8 | Tách attachment read (`view`) và mutate (`approve`) | `43684b9` |
| E9 | Status command dùng `approve/complete`, đóng requester/warehouse bypass | `8c5daac` |
| E10 | Receipt/update/sync dùng đúng kho nguồn/đích, chặn actor giả | `5a9bf93` |
| E11 | Status chỉ nhận target hợp lệ và actor từ JWT | `812c8a8` |
| Test debt | Làm mới Phase 4 Cloud smoke fixture | `a8009ad` |
| E12 | PO quality/finalize tách `approve` và `complete`; private bypass bị revoke | `1449822` |
| E13 | Tạo/gửi phiếu xuất cấp dùng canonical-only `wms.transaction.create` đúng kho nguồn | `3e64c4c` |

E12 release: GitHub CI run `34922221577`, Supabase Preview và Vercel thành công.

E13 release: GitHub CI run `34922998817`, Supabase Preview và Vercel thành công.

## 5. Bằng chứng kiểm thử cuối cùng

Sau E13:

- `npm test`: 398/398 files, 1.901/1.901 tests pass.
- `npm run lint`: pass.
- `npm run build`: pass; chỉ có cảnh báo chunk size hiện hữu.
- `npm run check:supabase-migrations`: 68 active / 402 archived, pass.
- `npm run audit:supabase-queries`: 0 finding/error.
- `npm run check:supabase-queries`: 0 finding/error.
- Cloud dry-run: up-to-date.
- Security Advisor: 0 ERROR. Ba WARN liên quan E13 là public `SECURITY DEFINER` command có authorization guard nội bộ; helper private không callable bởi `authenticated`.
- Cloud DB lint còn chín lỗi tồn đọng ngoài E13. Không được ghi “DB lint toàn dự án pass”; không có lỗi nào chỉ tới helper/function mới của E13.

Các smoke E13 cần giữ:

- `supabase/tests/authorization_v2_task12_4_2_material_issue_create_submit_smoke.sql`
- `supabase/tests/authorization_v2_task12_4_2_material_issue_create_submit_reconciliation.sql`
- `supabase/tests/authorization_v2_task12_4_2_wms_catalog_smoke.sql`
- `supabase/tests/material_issue_reversal_return_smoke.sql`
- `supabase/tests/authorization_v2_task12_4_2_wms_transaction_command_smoke.sql`

## 6. Trạng thái dependency còn lại

11 function còn gọi trực tiếp `is_module_admin('WMS')`:

1. `app_private.can_manage_warehouse_site_bindings`
2. `app_private.current_user_can_receive_purchase_batch_v2`
3. `app_private.custom_material_request_can_select`
4. `app_private.material_issue_can_manage_project`
5. `app_private.material_issue_can_process`
6. `app_private.material_request_can_delete`
7. `app_private.material_request_can_delete_v2`
8. `app_private.wms_has_action`
9. `app_private.wms_transaction_attachment_can_access`
10. `public.cancel_material_issue_order`
11. `public.create_purchase_order_supplier_return`

Các dependency gián tiếp qua policy/helper còn nhiều. Con số 11 không đồng nghĩa cohort WMS đã sẵn sàng thu hồi shell.

## 7. Công việc nên làm tiếp theo

### Ưu tiên 1 — E14: tách `material_issue_can_process` theo từng nghiệp vụ

Helper này hiện đang dùng chung cho nhiều thao tác không tương đương:

- `confirm_material_issue_receipt`
- `app_private.create_material_issue_return_v2_impl`
- `post_material_issue_settlement_v1`
- `reverse_material_issue_settlement_v1`
- các wrapper compatibility gọi các function trên

Không được OR toàn bộ với một capability chung. Trình tự an toàn:

1. Đọc definition Cloud và call graph hiện hành.
2. Chốt riêng actor hợp lệ cho nhận hàng, tạo hoàn trả, quyết toán và hoàn tác quyết toán.
3. Viết Cloud smoke RED cho từng boundary, gồm đúng kho, sai kho, creator, responsible, employee recipient, keeper và Room/Project nếu có.
4. Dùng `app_private.wms_has_canonical_action(...)` cho canonical grant; không dùng `wms_has_action(...)` ở nơi cần tránh legacy fallback.
5. Rehearsal migration + smoke bằng `scripts/run-supabase-cloud-transaction.mjs`.
6. Reconciliation toàn bộ 56 user × warehouse/resource tuple, bắt buộc 0 `unexpected_legacy_loss`; mọi allow mới phải được giải thích theo capability.
7. Dry-run chỉ đúng một migration, apply Cloud main, postflight, full gate, commit, conflict check, push main và theo dõi đúng SHA.

Điểm cần quyết định kỹ:

- Xác nhận nhận hàng có thể liên quan `wms.transaction.complete`, nhưng vẫn phải giữ creator/responsible/employee recipient hiện hành.
- Tạo hoàn trả có thể liên quan `wms.transaction.create`, nhưng không được tự mở quyết toán.
- Quyết toán và hoàn tác quyết toán chưa có mapping capability đủ chắc chắn. Nếu `complete/reverse` không diễn đạt đúng nghiệp vụ, phải giữ `manual_review` hoặc bổ sung capability riêng qua catalog + UI + backend + test; không tự suy diễn.

### Ưu tiên 2 — Các boundary WMS còn lại

- `cancel_material_issue_order`: hủy trước xuất không mặc định đồng nghĩa với Hủy duyệt sau xuất.
- `create_purchase_order_supplier_return`: tiếp tục `manual_review`. UI hiện hẹp hơn backend; gán thẳng `wms.transaction.create` có thể tăng quyền.
- `material_request_can_delete` và `_v2`: cần tách nhánh Project/WMS và trạng thái chứng từ.
- `can_manage_warehouse_site_bindings`: cần giữ contract Settings và WMS đúng nguồn.
- `custom_material_request_can_select`: phải giữ quy tắc `custom_material` non-admin view-only.
- Compatibility helper `current_user_can_receive_purchase_batch_v2`, `wms_has_action`, `wms_transaction_attachment_can_access` chỉ retire sau khi mọi caller và persona đã được đối chiếu.

### Ưu tiên 3 — Manifest và observation

- Chỉ khi toàn bộ source của cohort có mapping hoặc disposition rõ ràng mới tạo preview/manifest mới.
- 23 `system.wms.manage` vẫn là `manual_review`; không dùng mapping F2 v1.
- Operator phải duyệt batch/diff có định danh trước apply.
- Sau batch: persona browser trên đúng release, kiểm cả add và revoke, desktop/mobile, refresh/offline và hai phiên concurrent.
- Observation gate ít nhất 7 ngày bắt đầu tại mốc muộn nhất giữa release cuối, batch cuối và persona đạt. Incident authorization làm reset gate.

## 8. Task 13 vẫn bị chặn

Không thực hiện `Drop legacy schema` chỉ vì đủ số ngày theo lịch. Task 13 chỉ mở khi đồng thời:

- Task 12.4.2 không còn `manual_review` trong phạm vi định thu hồi.
- Tất cả batch đã được duyệt, apply và reconciliation đạt.
- Persona trọng yếu đã xác nhận trên bản release thực tế.
- Observation tối thiểu 7 ngày hoàn tất, không incident/deny anomaly.
- Restore rehearsal còn hoạt động và Cloud ledger khớp Git.

Hiện chưa đạt các điều kiện trên, vì vậy tuyệt đối không drop `allowed_modules`, `admin_modules`, `allowed_sub_modules`, `admin_sub_modules` hoặc legacy-only functions/triggers/views.

## 9. Quy trình Cloud bắt buộc cho checkpoint mới

```bash
cd /Users/admin/khotienthinh/.worktrees/authorization-v2-task12-4-2
set -a
source /Users/admin/khotienthinh/.env
set +a

npx --yes supabase@2.116.0 db push --linked --dry-run --include-all --yes
```

- Migration mới phải tạo bằng `supabase migration new <suffix>` sau khi đọc `--help` nếu CLI/version thay đổi.
- Trước apply: RED → migration → rehearsal rollback → reconciliation → dry-run.
- Sau apply: smoke standalone → postflight counts/ACL/ledger → full test/lint/build/query checks/advisor → commit.
- Trước push: fetch `origin/main`, kiểm merge-tree/conflict và chỉ fast-forward phần đúng phạm vi.
- Không in token/password từ `.env` ra log.

## 10. Prompt đề xuất cho phiên chat mới

Sao chép nguyên văn đoạn sau:

> Tiếp tục Task 12.4.2 theo handoff tại `docs/security/authorization-v2-task12-4-2-handoff-2026-09-15.md`. Làm trong worktree `.worktrees/authorization-v2-task12-4-2`, branch `feature/authorization-v2-task12-4-2`, Supabase Cloud main ref `ftciqmqhmfvjtwoycswe`; không dùng local/Docker/sub-agent. Trước tiên xác minh HEAD, origin/main, Cloud ledger và đọc đầy đủ handoff, rollout log, legacy dependency gate cùng controlled-revocation plan. Bắt đầu từ E14: audit và tách `material_issue_can_process` theo từng boundary; TDD Cloud, reconciliation không mất quyền, migration từng checkpoint, full test, commit và push main. Không apply batch thật, không cấp `wms.transaction.reverse` từ shell manage và không mở Task 13 khi chưa đủ gate.

## 11. Tài liệu phải đọc trước khi tiếp tục

1. `docs/security/authorization-v2-task12-4-2-handoff-2026-09-15.md`
2. `docs/security/authorization-v2-task12-4-2-rollout-log.md`
3. `docs/security/authorization-v2-task12-4-2-legacy-runtime-dependencies.md`
4. `docs/security/authorization-v2-task12-4-2-access-map.md`
5. `docs/superpowers/plans/2026-09-14-authorization-v2-task12-4-2-controlled-revocation.md`
6. `docs/superpowers/plans/2026-09-04-permission-unification-v2.md`
7. `docs/security/authorization-v2-operating-model.md`

Nếu số liệu Cloud hoặc Git khác handoff, trạng thái mới là nguồn sự thật; phải ghi chênh lệch vào rollout log trước khi triển khai tiếp.
