# HANDOFF_SUMMARY

## 1. Mục tiêu ban đầu
- Sửa và đổi luồng `Mua nóng công trường`, `Gọi hàng HĐ NCC`, AP và sổ tài chính theo hướng:
  - Thủ kho chỉ nhập số lượng/kho/SL-CL.
  - Kế toán nhập giá/VAT ở bước đối soát/AP.
  - Bỏ duyệt/gửi duyệt phiếu giao HĐ NCC, dùng `Ghi/Bỏ ghi`.
  - Tab Phải trả/Phải thu chỉ hiển thị khoản còn outstanding.
  - Sổ giao dịch tách `Đã trả` và `Đã thu`.
  - Vòng dữ liệu cuối cùng vẫn phải thể hiện được chi phí.

## 2. Việc đã hoàn thành
- Tạo migration `supabase/migrations/20260714063446_supplier_ap_recording_flow_v1.sql`.
- Migration đã được apply lên Supabase cloud bằng Postgres direct/session pooler, không dùng `supabase db push`.
- Đã repair migration history cloud cho version `20260714063446`.
- Thêm RPC atomic cho:
  - `upsert_site_direct_purchase_with_lines`
  - `delete_site_direct_purchase_v1`
  - `upsert_supplier_direct_delivery_note_with_lines`
  - `record_supplier_direct_delivery_note`
  - `unrecord_supplier_direct_delivery_note`
  - `delete_supplier_direct_delivery_note_v1`
- Thêm permission actions cho mua nóng và phiếu giao HĐ NCC.
- Sửa service mua nóng và phiếu giao HĐ NCC gọi RPC atomic.
- UI `SupplyChainTab` đã có các thao tác chính: `Ghi`, `Bỏ ghi`, `Xóa`, `Chi tiết`, `Tạo WMS nhập`, `Đối soát/AP`.
- Đối soát HĐ NCC chuyển giá/VAT sang bước kế toán nhập ở statement.
- Finance workspace đã lọc Phải trả/Phải thu theo outstanding và tách ledger `Đã trả`/`Đã thu`.
- Sửa bug UI hiển thị sai `Nhập-xuất thẳng` thành `Không qua kho` bằng helper `supplierDeliveryWmsSummary`.
- Sửa WMS import payload trước mắt:
  - Không gửi cột `created_by` vào bảng `transactions` vì schema hiện chưa có cột này.
  - Không gửi `supplier_id` legacy vào `transactions` vì bảng `suppliers` không còn là chuẩn; chuẩn mới là `business_partners`.

## 3. File đã thay đổi
- `supabase/migrations/20260714063446_supplier_ap_recording_flow_v1.sql`
- `types.ts`
- `hooks/project/material/useProjectMaterialAccess.ts`
- `lib/permissions/projectMaterialPermissions.ts`
- `lib/siteDirectPurchaseService.ts`
- `lib/supplierDeliveryStatementService.ts`
- `lib/supplierDeliveryWmsSummary.ts`
- `lib/__tests__/siteDirectPurchaseService.test.ts`
- `lib/__tests__/supplierDeliveryStatementService.test.ts`
- `lib/__tests__/supplierDeliveryWmsSummary.test.ts`
- `pages/project/MaterialTab.tsx`
- `pages/project/SupplyChainTab.tsx`
- `pages/project/ProjectFinanceWorkspace.tsx`
- `HANDOFF_SUMMARY.md`

File cần đọc tiếp trước khi làm:
- `pages/project/SupplyChainTab.tsx`
- `lib/supplierDeliveryStatementService.ts`
- `lib/siteDirectPurchaseService.ts`
- `lib/supplierDeliveryWmsSummary.ts`
- `supabase/migrations/20260714063446_supplier_ap_recording_flow_v1.sql`
- `types.ts`
- `lib/permissions/projectMaterialPermissions.ts`
- `hooks/project/material/useProjectMaterialAccess.ts`
- `pages/project/ProjectFinanceWorkspace.tsx`
- `docs/security/permission-refactor-roadmap.md`

## 4. Quyết định kỹ thuật quan trọng
- `business_partners` là bảng chuẩn cho NCC/khách hàng/đối tác. `suppliers` là legacy, không dùng cho flow mới.
- Không sinh AP từ WMS. AP HĐ NCC phải sinh từ `supplier_delivery_statement`.
- WMS chỉ phản ánh nhập/xuất/tồn và phục vụ truy vết số lượng.
- Phiếu giao HĐ NCC:
  - `draft` thì sửa/xóa được theo quyền.
  - `Ghi` thì khóa số lượng.
  - `Bỏ ghi` chỉ được khi chưa có WMS/AP.
  - Đã có WMS hoặc AP thì không sửa phiếu nguồn trực tiếp.
- `Ghi` hiện vẫn gồm 2 bước ở frontend: RPC ghi phiếu trước, sau đó tạo WMS import nếu dòng là `direct_in_out`. Đây chưa phải mô hình atomic cuối cùng.
- Việc bỏ `created_by`/`supplier_id` khỏi WMS insert chỉ là fix tránh lỗi schema/FK hiện tại; không phải quyết định bỏ audit.
- Chuẩn cần đi tiếp: `transactions` phải có audit và partner chuẩn:
  - `created_by`
  - `updated_by`
  - `business_partner_id`
  - `business_partner_name_snapshot`
  - `source_type`
  - `source_id`

## 5. Lỗi / vấn đề còn tồn tại
- Bảng `transactions` chưa có `created_by`, nên WMS transaction chưa lưu rõ người tạo riêng ở cấp giao dịch kho.
- Bảng `transactions` chưa có `business_partner_id`, nên WMS transaction chưa ghi trực tiếp NCC chuẩn từ `business_partners`.
- `transactions.supplier_id` vẫn FK sang bảng legacy `suppliers`; không được dùng cho flow mới.
- `Ghi` phiếu giao HĐ NCC chưa atomic với tạo WMS import. Nếu WMS fail sau khi RPC ghi phiếu thành công, UI có thể báo lỗi dù trạng thái DB đã `accepted`.
- Phiếu cloud `GHHD-20260714-126346` đã `accepted`, line đã `accepted_quantity = 1`, nhưng chưa có WMS transaction.
- Nút `Sửa phiếu` cho phiếu giao HĐ NCC chưa được implement.
- Full `npm test` trước đó có 2 lỗi baseline không liên quan:
  - `lib/__tests__/dailyLogWorkflow.test.ts`
  - `lib/__tests__/phase5PermissionHardening.test.ts`
- Code local đã sửa nhưng chưa có deploy/cloud frontend mới trong phiên này.

## 6. Rủi ro cần chú ý
- Không được drop bảng `suppliers` ngay nếu chưa audit dữ liệu và FK toàn hệ thống.
- Không được ghi `business_partners.id` vào `transactions.supplier_id` vì sẽ vi phạm FK legacy.
- Không được mất audit người tạo; nếu WMS cần biết ai tạo thì phải thêm schema đúng, không nhét cột không tồn tại.
- Không được cộng chi phí từ WMS. Chi phí lấy từ AP/recognized amount.
- Không được đổi luồng HĐ NCC quay lại PO.
- Không được reintroduce duyệt/gửi duyệt cho phiếu giao HĐ NCC.
- Không được chạy `supabase db push`.
- Không được reapply migration `20260714063446` lên cloud nếu không thay đổi có chủ đích; version này đã được apply và repair history.
- Worktree đang dirty; không revert file người khác/chưa hiểu nguồn gốc.

## 7. Việc cần làm tiếp theo
1. Tạo migration mới bằng `supabase migration new ...`, không tự đặt tên file thủ công.
2. Migration cần bổ sung audit/partner/source cho `public.transactions`:
   - `created_by uuid references public.users(id)`
   - `updated_by uuid references public.users(id)`
   - `business_partner_id uuid references public.business_partners(id)`
   - `business_partner_name_snapshot text`
   - `source_type text`
   - `source_id text`
3. Cập nhật WMS insert trong:
   - `lib/supplierDeliveryStatementService.ts`
   - `lib/siteDirectPurchaseService.ts`
   - các service WMS/PO khác nếu còn ghi `supplier_id` legacy.
4. Với phiếu giao HĐ NCC, WMS import phải ghi:
   - `created_by = user hiện tại`
   - `business_partner_id = note.supplierId`
   - `business_partner_name_snapshot = note.supplierNameSnapshot`
   - `source_type = supplier_direct_delivery_note`
   - `source_id = note.id`
5. Làm `Ghi + tạo WMS` atomic hơn:
   - hoặc đưa tạo WMS import vào RPC/security definer;
   - hoặc tách UI thành `Ghi số lượng` thành công riêng và `Tạo WMS` riêng, không báo `Không ghi được` khi chỉ fail WMS.
6. Thêm nút `Sửa` phiếu giao HĐ NCC:
   - chỉ hiện khi `draft/cancelled` và chưa WMS/AP;
   - nếu `accepted` nhưng chưa WMS/AP thì phải `Bỏ ghi` trước khi sửa.
7. Apply migration cloud chỉ khi user yêu cầu rõ. Nếu apply cloud, dùng direct SQL/`db query`, không dùng `db push`.

## 8. Lệnh đã chạy và kết quả
- `npm test -- lib/__tests__/supplierDeliveryWmsSummary.test.ts lib/__tests__/supplierDeliveryStatementService.test.ts lib/__tests__/siteDirectPurchaseService.test.ts`
  - Kết quả: passed, 30 tests.
- `npm run lint`
  - Kết quả: passed.
- `npm run build`
  - Kết quả: passed, chỉ có warning chunk size của Vite.
- Apply migration cloud:
  - Dùng Node `pg` kết nối session pooler Supabase, chạy `supabase/migrations/20260714063446_supplier_ap_recording_flow_v1.sql` trong transaction.
  - Kết quả: commit thành công.
- `npx supabase migration repair --db-url ... --status applied 20260714063446`
  - Kết quả: migration history cloud đã repaired.
- Verify cloud sau migration:
  - `site_purchase_rpc = true`
  - `supplier_delivery_record_rpc = true`
  - `statement_price_snapshot = true`
  - `supplier_reconcile_permission = true`
  - `migration_version = 20260714063446`
- Debug cloud phiếu `GHHD-20260714-126346`:
  - Note status: `accepted`.
  - Line status: `accepted`.
  - `accepted_quantity = 1`.
  - Chưa có WMS transaction.
  - Payload WMS cũ fail `42703` vì `transactions.created_by` không tồn tại.
  - Payload bỏ `created_by` nhưng còn `supplier_id` fail `23503` vì FK sang `suppliers`.
  - Payload bỏ cả `created_by` và `supplier_id` insert giả lập rollback thành công.

## 9. Các phần KHÔNG được tự ý thay đổi
- Không dùng lại bảng `suppliers` làm chuẩn NCC.
- Không ghi `business_partners.id` vào cột `transactions.supplier_id`.
- Không drop bảng `suppliers` khi chưa có migration/data audit riêng.
- Không đổi AP sang sinh từ WMS.
- Không đổi `Gọi hàng HĐ NCC` thành PO.
- Không bật lại duyệt/gửi duyệt cho phiếu giao HĐ NCC.
- Không sửa lớn `SupplyChainTab.tsx` ngoài phạm vi task tiếp theo.
- Không revert các thay đổi hiện có trong worktree.
- Không chạy `supabase db push`.
- Không reapply migration đã apply cloud nếu chưa kiểm tra migration history.

## 10. Prompt đề xuất để bắt đầu phiên Codex mới
```text
Tiếp tục từ HANDOFF_SUMMARY.md trong repo /Users/admin/khotienthinh.

Nhiệm vụ tiếp theo:
1. Đọc các file được liệt kê ở mục 3 và mục 7.
2. Tạo migration mới bằng `supabase migration new ...` để bổ sung audit/partner/source cho `public.transactions`:
   - created_by
   - updated_by
   - business_partner_id
   - business_partner_name_snapshot
   - source_type
   - source_id
3. Cập nhật các WMS insert để dùng `business_partners`, không dùng `suppliers`.
4. Đảm bảo phiếu PO/mua nóng/GHHD có đủ: ngày giờ tạo, ai tạo, kho nhập/xuất, partner chuẩn, trạng thái bước, quyền theo trạng thái.
5. Không sinh AP từ WMS. AP vẫn từ đối soát/AP.
6. Không chạy `supabase db push`.
7. Viết test trước, chạy test/lint/build sau khi sửa.

Lưu ý: migration `20260714063446_supplier_ap_recording_flow_v1.sql` đã apply cloud và đã repair history, không apply lại nếu chưa có lý do rõ ràng.
```
