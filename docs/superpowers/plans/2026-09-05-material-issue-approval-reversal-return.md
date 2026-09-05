# Implementation Plan — Hủy duyệt phiếu xuất và nhập hoàn vật tư

**Ngày lập:** 2026-09-05

**Trạng thái:** Đang triển khai

**Đặc tả:** `docs/superpowers/specs/2026-09-05-material-issue-approval-reversal-return-design.md`

## Mục tiêu và kiến trúc

Bổ sung chứng từ đảo toàn bộ cho phiếu xuất đã ghi sổ nhưng hàng chưa giao,
đồng thời làm cứng luồng nhập hoàn để không hoàn hoặc quyết toán vượt số lượng
còn giữ.

Không sửa hoặc xóa chứng từ `COMPLETED`. PostgreSQL tạo giao dịch `IMPORT` bù,
liên kết phiếu xuất gốc, cập nhật tồn kho, inventory ledger và party ledger
trong một transaction. Nhập hoàn tiếp tục qua WMS
`PENDING → APPROVED → COMPLETED`.

Permission Unification V2 Phase 2 là điều kiện tiên quyết. Capability
`wms.transaction.reverse` không được kế thừa legacy role/module fallback. Mọi
thử nghiệm database chạy trên Supabase Cloud cấu hình từ `.env`; không dùng
Supabase local hoặc Docker.

## API và invariant

```text
reverse_material_issue_approval_v1(
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text
) returns material_issue_orders
```

```text
create_material_issue_return_v2(
  p_order_id uuid,
  p_target_warehouse_id text,
  p_lines jsonb,
  p_reason text,
  p_note text,
  p_idempotency_key text
) returns material_issue_returns
```

```ts
type MaterialIssueReturnKind = 'unused_return' | 'approval_reversal';

type MaterialIssueLineDisposition = {
  openQty: number;
  pendingReturnQty: number;
  returnableQty: number;
  settleableQty: number;
};

type MaterialIssueReversalEligibility = {
  eligible: boolean;
  reasonCode:
    | 'eligible'
    | 'invalid_status'
    | 'no_issued_quantity'
    | 'already_received'
    | 'already_returned'
    | 'already_settled'
    | 'pending_return';
};
```

Bổ sung `reversed` vào `MaterialIssueStatus`; thêm `returnKind`,
`idempotencyKey`, `metadata` vào `MaterialIssueReturn`; thêm
`reversalOfTransactionId`, `idempotencyKey` vào `Transaction`; thêm
`inReversal` vào `InventoryLedgerStockReportRow`.

```text
openQty = issuedQty - returnedQty - consumedQty - lostQty
pendingReturnQty = tổng returnQty của material_issue_returns.status = pending
returnableQty = max(openQty - pendingReturnQty, 0)
settleableQty = returnableQty
```

## Task 1 — Capability hủy duyệt theo Permission V2

**Files:**

- `lib/permissions/erpPermissionRegistry.ts`
- `lib/wmsPermissions.ts`
- `lib/__tests__/permissionRegistry.test.ts`
- `lib/__tests__/wmsPermissions.phase4.test.ts`
- `lib/__tests__/authorizationEvaluator.test.ts`

1. Viết test yêu cầu registry có `wms.transaction.reverse`, nhãn `Hủy duyệt`,
   chỉ hỗ trợ scope `global | warehouse`.
2. Kiểm thử direct/global và warehouse grant đúng kho được phép; sai kho, grant
   hết hạn và legacy-only source đều bị từ chối.
3. Đăng ký action sau `complete`, đánh dấu nhạy cảm và yêu cầu direct grant có
   hạn sử dụng trong dữ liệu Cloud.
4. Thêm `canReverseWmsTransaction(user, sourceWarehouseId)` gọi evaluator chuẩn,
   không kiểm tra `Role.WAREHOUSE_KEEPER`, `adminModules` hoặc
   `assignedWarehouseId`.
5. Chạy test registry/evaluator/WMS và lint.

Commit: `feat(auth): register warehouse transaction reversal capability`.

## Task 2 — Domain policy, types và service contract

**Files:**

- `types.ts`
- `lib/materialIssueReturnPolicy.ts`
- `lib/materialIssueService.ts`
- `lib/supabaseProjections.ts`
- `lib/__tests__/materialIssueReturnPolicy.test.ts`
- `lib/__tests__/materialIssueReturnService.test.ts`

1. Viết test cho `openQty`, `pendingReturnQty`, `returnableQty`,
   `settleableQty` và eligibility đảo phiếu.
2. Tạo `getMaterialIssueLineDisposition(order, issueLineId)` và
   `getMaterialIssueReversalEligibility(order)` dưới dạng hàm thuần.
3. Mở rộng types/projection cho `reversed`, `return_kind`, `idempotency_key`,
   `metadata` và liên kết reversal.
4. Chuyển `createReturn()` sang RPC V2 và bắt buộc `idempotencyKey`.
5. Thêm `reverseApproval({ orderId, reason, idempotencyKey })`; sau command
   hydrate lại order để trả đủ chứng từ liên quan.
6. Kiểm thử chính xác tên RPC và mapping camelCase/snake_case.

Commit: `feat(wms): add material issue reversal and return contracts`.

## Task 3 — Migration nguyên tử và ledger đảo

**Files:**

- `supabase/migrations/*_material_issue_approval_reversal_return.sql`
- `lib/__tests__/materialIssueReversalReturnMigration.test.ts`
- `supabase/tests/material_issue_reversal_return_smoke.sql`

1. Viết migration contract test trước cho schema, constraints, RPC wrappers,
   private implementation, capability V2 strict, reversal ledger và pending
   reservation trong settlement.
2. Tạo migration bằng Supabase CLI.
3. Thêm cột reversal/idempotency cho `transactions`; kind/idempotency/metadata
   cho `material_issue_returns`; trạng thái `reversed`; FK indexes và unique
   partial indexes.
4. Upsert `wms.transaction.reverse` với scope `global, warehouse`,
   `risk_level = sensitive`, `is_business_action = true`,
   `is_business_approval = false`, `direct_grant_requires_expiry = true`.
5. Tạo private helpers tính pending/returnable, kiểm tra capability V2,
   fingerprint payload và hoàn tất chứng từ đảo nội bộ.
6. Cài `create_material_issue_return_v2`: khóa order và line theo thứ tự ổn
   định, bắt buộc kho nguồn, giữ chỗ toàn bộ return pending, idempotent cùng
   key/cùng payload và báo `MATERIAL_ISSUE_IDEMPOTENCY_CONFLICT` khi khác
   payload. Giữ RPC cũ làm wrapper một release.
7. Làm cứng settlement/completion: consume/loss không chiếm phần pending;
   completion khóa và kiểm tra lại trước khi cộng tồn; cancel trước completion
   giải phóng giữ chỗ, không ghi ledger.
8. Cài `reverse_material_issue_approval_v1`: capability strict, khóa đầy đủ,
   chặn mọi downstream use/receive/return/loss/pending/already reversed; tạo
   WMS `IMPORT` bù, return `approval_reversal`, hoàn tất atomically và đặt order
   `reversed`; giữ WMS xuất gốc `COMPLETED`.
9. Sửa inventory sync để reversal là movement `in`, liên kết inventory
   transaction gốc và đánh dấu giao dịch gốc `reversed`; thiếu liên kết phải
   rollback.
10. Coi `reversed` là terminal trong refresh/document-link sync; chỉ expose
    public wrappers cần thiết và revoke `PUBLIC/anon`.
11. Viết Cloud-safe SQL smoke `BEGIN … ROLLBACK` bao phủ tồn, idempotency,
    eligibility, pending reservation, quyền/kho và cân bằng ledger.
12. Chạy contract test và migration baseline check.

Commit: `feat(db): add auditable material issue reversal and safe returns`.

## Task 4 — UI hủy duyệt, nhập hoàn và lịch sử

**Files:**

- `components/project/MaterialIssuePanel.tsx`
- `lib/__tests__/materialIssuePanelReversalContract.test.ts`

1. Viết UI contract test cho trạng thái `Đã đảo`, nút hủy duyệt, checkbox xác
   nhận hàng chưa rời kho, kho hoàn readonly, cột pending/returnable và lịch sử.
2. Thêm action state `approval_reversal`; chỉ hiện nút khi domain eligibility và
   `canReverseWmsTransaction()` đều đạt.
3. Modal hủy duyệt hiển thị đầy đủ dòng/kho/tổng lượng; bắt buộc lý do và xác
   nhận. Giữ một idempotency key từ lúc mở đến khi RPC kết thúc và khóa submit.
4. Modal nhập hoàn dùng `returnableQty`, cố định kho nguồn, RPC V2 và thông báo
   rõ `Chờ WMS kiểm nhận - chưa cộng tồn`.
5. Consume/loss dùng `settleableQty`; sau thành công refresh order, item, WMS
   gốc và WMS bù.
6. Hiển thị history với kind/status/reason/actor/time/transaction ID.
7. Chạy contract/policy/service tests, lint và build.

Commit: `feat(wms): add issue approval reversal and safe return UI`.

## Task 5 — WMS, báo cáo và MISA

**Files:**

- `lib/wmsTransactionListService.ts`
- `components/TransactionDetailModal.tsx`
- `lib/inventoryLedgerService.ts`
- `pages/Reports.tsx`
- `pages/MisaExport.tsx`
- `types.ts`
- `lib/supabaseProjections.ts`
- `lib/__tests__/inventoryLedgerReversalReport.test.ts`
- `lib/__tests__/transactionDetailModal.contract.test.ts`

1. Kiểm thử và map `reversal_of_transaction_id`, `idempotency_key` ở list/detail.
2. Detail hiển thị badge `Đảo phiếu xuất`, ID phiếu gốc và lý do.
3. Báo cáo tách `in_reversal` khỏi `in_import`, đồng thời giữ
   `total_in = in_import + in_transfer + in_adjustment + in_reversal`.
4. Cập nhật mapper, bảng, bộ lọc, CSV và fallback calculation với cột
   `Nhập đảo`; thêm filter `Đảo giao dịch`.
5. MISA xuất reversal như chứng từ nhập bù với mô tả
   `Đảo phiếu xuất <mã gốc>`, không gắn nghĩa nhập mua/NCC.
6. Chạy test, lint và build.

Commit: `feat(reports): distinguish warehouse reversal movements`.

## Task 6 — Full verification và Supabase Cloud rollout

**Files:**

- `docs/superpowers/specs/2026-09-05-material-issue-approval-reversal-return-design.md`
- `docs/runbooks/material-issue-reversal-return-rollout.md`

1. Chạy `npm test`, lint, build, Supabase query audit, migration check và
   `git diff --check`.
2. Chụp Cloud preflight: migration history, status counts, checksum tồn,
   inventory balances, invariant violations và WMS completed thiếu inventory
   transaction.
3. Dry-run Cloud; chỉ migration của tính năng này được xuất hiện.
4. Dùng transaction runner Phase 2 chạy migration và smoke trong rollback.
5. Chạy security/performance advisors với `--fail-on error`.
6. Commit release candidate, apply migration Cloud, chạy smoke Cloud và
   postflight đối chiếu checksum/quyền/constraints/rollback fixtures.
7. Cập nhật spec thành `Đã triển khai`; ghi migration, commit, tests, advisors
   và Cloud evidence vào runbook.

Commit: `docs(wms): record reversal and return rollout evidence`.

## Kịch bản nghiệm thu

- Phiếu chưa xuất hủy trực tiếp, tồn không đổi.
- Phiếu đã xuất nhưng chưa giao được đảo toàn bộ và tồn về đúng giá trị.
- WMS gốc không sửa/xóa; chứng từ đảo liên kết một-một với chứng từ gốc.
- Đã nhận hoặc đã quyết toán không thể hủy duyệt.
- Nhập hoàn một phần, toàn bộ và nhiều lần hoạt động đúng.
- Pending return giữ chỗ, không thể hoàn/dùng/hao hụt trùng lượng.
- `PENDING/APPROVED` chưa cộng tồn; chỉ `COMPLETED` mới cộng.
- Retry cùng idempotency key không sinh thêm chứng từ; cùng key khác payload bị
  từ chối.
- Sai kho hoặc sai capability bị từ chối.
- Inventory ledger, party ledger, tồn hiện tại và BOQ đối chiếu khớp.
- Báo cáo/MISA phân biệt reversal với nhập mua thông thường.

## Giới hạn đã chốt

- Hủy duyệt không có vòng duyệt thứ hai, chỉ áp dụng toàn bộ phiếu khi hàng chưa
  rời kho.
- Nhập hoàn trong phase này bắt buộc về kho xuất gốc.
- Hàng hỏng không tái sử dụng ghi `loss`; chưa có kho cách ly.
- Chưa hỗ trợ đảo phiếu nhập hoàn đã `COMPLETED`.
- RPC `create_material_issue_return` cũ giữ một release.
- Không backfill chứng từ đảo và migration không được làm thay đổi tồn hiện tại.
