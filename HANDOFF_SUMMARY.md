# HANDOFF_SUMMARY

## 1. Mục tiêu ban đầu
- Xây luồng kế toán/cung ứng khép kín cho: công nợ NCC, thanh toán theo đợt, mua nóng công trường, CCDC nhỏ/ngoài kho, hoàn ứng quỹ công trường, và chuẩn bị QR/truy vết chứng từ.
- Nguyên tắc xuyên suốt: WMS quản tồn kho, AP subledger quản công nợ NCC, payment/cash/project transaction quản dòng tiền.

## 2. Việc đã hoàn thành
- Phase 1-2: AP subledger và thanh toán NCC theo đợt đã có service/UI/RPC, AP là nguồn công nợ chính.
- Phase 3: `Mua nóng công trường` đã có service/UI, hỗ trợ NCC viết tay, file/hình ảnh, line `stock_item | expense_only`.
- Phase 3.5: thêm `small_tool` và sổ CCDC nhỏ/ngoài kho.
- Phase 3.6: thêm luồng `Gọi hàng HĐ NCC`: lấy HĐ từ module HD, tạo phiếu giao, đối soát, sinh AP từ bảng đối soát.
- Phase 4: hoàn ứng/quỹ công trường đã implement, migration đã apply lên Supabase cloud.
- Test cloud Phase 4 đã chạy bằng transaction rollback: site cash 360k + staff paid approved 200k/reimbursed 150k, post/reverse đều đúng số, không để lại dữ liệu test.
- Ý tưởng mới đã chốt ở mức thiết kế: `Phiếu giao HĐ NCC` có thể link mã WMS, nhập kho rồi tạo phiếu xuất dùng ngay để net tồn = 0 nhưng vẫn có chứng từ nhập/xuất.

## 3. File đã thay đổi
- Đã nằm trong codebase/commit gần nhất:
  - `types.ts`
  - `pages/project/SupplyChainTab.tsx`
  - `pages/project/ProjectFinanceWorkspace.tsx`
  - `pages/hd/SupplierContracts.tsx`
  - `lib/supplierPayableService.ts`
  - `lib/supplierPaymentBatchService.ts`
  - `lib/siteDirectPurchaseService.ts`
  - `lib/siteSmallToolService.ts`
  - `lib/siteCashSettlementService.ts`
  - `lib/cashFundService.ts`
  - `lib/supplierDeliveryStatementService.ts`
  - `lib/projectFinanceWorkspaceService.ts`
  - `supabase/migrations/20260707071817_supplier_ap_payment_site_cash_qr_v1.sql`
  - `supabase/migrations/20260708162411_supplier_contract_direct_delivery_v1.sql`
  - `supabase/migrations/20260708170426_site_small_tools_v1.sql`
  - `supabase/migrations/20260709053843_site_cash_settlement_posting_v1.sql`
  - các test tương ứng trong `lib/__tests__/`.
- Workspace hiện đang dirty nhưng KHÔNG thuộc task này:
  - `components/chat-v2/ChatShell.tsx`
  - `lib/chatV2Service.ts`
  - `lib/__tests__/chatV2Service.test.ts`

## 4. Quyết định kỹ thuật quan trọng
- AP không sinh trực tiếp từ WMS; AP sinh từ PO, mua nóng, hoặc bảng đối soát HĐ NCC tùy nghiệp vụ.
- Với `Gọi hàng HĐ NCC`, AP phải sinh từ `supplier_delivery_statement`, không sinh từ `supplier_direct_delivery_note`.
- Với hoàn ứng quỹ/cá nhân ứng trước, RPC post sẽ sync AP mua nóng rồi credit AP để NCC không còn outstanding sai.
- Project transaction từ `supplier_payment_batch:*` và `site_cash_settlement_batch:*` chỉ phản ánh cashflow, không được cộng trùng vào actual material cost.
- `site_cash` và `staff_paid` đi vào hoàn ứng; `supplier_credit` đi theo thanh toán NCC/AP.
- Ý tưởng mới: với cát/đá/xi/bê tông dùng ngay, vẫn tạo WMS nhập và WMS xuất dùng ngay; AP vẫn từ đối soát HĐ NCC.
- WMS xuất dùng ngay nên là phiếu xuất nháp do hệ thống tạo, thủ kho xác nhận; không tự complete hoàn toàn.

## 5. Lỗi / vấn đề còn tồn tại
- Chưa implement Phase 4.7: `Gọi hàng HĐ NCC nhập-xuất thẳng WMS`.
- Chưa implement Phase 5: QR/trace graph đầy đủ.
- `SupplyChainTab.tsx` đang rất lớn, dễ đụng lỗi khi thêm UI mới.
- Current dirty files về chat-v2 chưa rõ chủ sở hữu; không liên quan task cung ứng/tài chính.
- `supabase db push` không dùng được trực tiếp vì remote có nhiều migration history cũ không có trong local; lần trước đã apply migration bằng `npx supabase db query --linked --file ...` rồi `migration repair`.

## 6. Rủi ro cần chú ý
- Không được cộng trùng chi phí: WMS nhập/xuất chỉ trace số lượng, AP mới là nguồn ghi nhận chi phí/công nợ.
- Nếu WMS nhập xong chưa xuất, phải có trạng thái/cảnh báo `Tồn chờ xuất dùng`.
- Nếu xuất dùng ngay fail hoặc bị hủy, không được post đối soát/AP như đã hoàn tất kho.
- Với hàng dùng ngay từ HĐ NCC, không quay lại tạo PO.
- Cần giữ link chứng từ theo cả chiều xuôi và ngược: HĐ -> phiếu giao -> WMS nhập -> WMS xuất -> đối soát -> AP -> payment.

## 7. Việc cần làm tiếp theo
1. Tạo spec/plan Phase 4.7: `Gọi hàng HĐ NCC nhập-xuất thẳng WMS`.
2. Thiết kế DB fields cho `supplier_direct_delivery_lines`:
   - `item_id` / `sku_snapshot` / `item_name_snapshot`
   - `wms_flow_mode`: `none | direct_in_out`
   - `wms_import_transaction_id`
   - `wms_export_transaction_id`
   - `target_warehouse_id`
   - trạng thái kho: `not_required | import_pending | imported | export_pending | exported`.
3. Service: tạo WMS import từ phiếu giao HĐ, sau khi import `COMPLETED` tạo WMS export draft.
4. UI: trong `Tạo phiếu giao HĐ NCC`, cột vật tư link mã WMS; chọn mode `Không qua kho` hoặc `Nhập-xuất thẳng`.
5. Guard đối soát: dòng `direct_in_out` chỉ được đưa vào statement/AP khi WMS import và export đã hoàn tất.
6. Sau Phase 4.7, làm Phase 5 QR/trace graph cho toàn chuỗi.

## 8. Lệnh đã chạy và kết quả
- `npm run test`: 40 files, 214 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed, chỉ có warning chunk size của Vite.
- `git diff --check`: clean tại thời điểm trước khi commit Phase 4.
- `npx supabase db query --linked --file supabase/migrations/20260709053843_site_cash_settlement_posting_v1.sql`: applied cloud.
- `npx supabase migration repair --linked --status applied 20260709053843 -p "$SUPABASE_DB_PASSWORD"`: remote migration history repaired.
- Cloud rollback test Phase 4: passed, không còn dữ liệu test `CODX/HU-CODX`.

## 9. Các phần KHÔNG được tự ý thay đổi
- Không đổi hướng `Gọi hàng HĐ NCC` sang PO.
- Không sinh AP từ WMS nhập/xuất.
- Không bỏ yêu cầu thủ kho xác nhận phiếu xuất dùng ngay.
- Không xóa/đảo migration đã apply cloud.
- Không chạy `supabase db push --include-all`.
- Không sửa/revert 3 file chat-v2 đang dirty nếu không có yêu cầu riêng.
- Không refactor lớn `SupplyChainTab.tsx` ngoài phạm vi Phase 4.7/5.

## 10. Prompt đề xuất để bắt đầu phiên Codex mới
```text
Tiếp tục từ HANDOFF_SUMMARY.md.
Hãy tạo spec/plan Phase 4.7 cho nghiệp vụ "Gọi hàng HĐ NCC nhập-xuất thẳng WMS":
- Phiếu giao HĐ NCC vẫn lấy HĐ từ module HD.
- Cột vật tư link mã WMS.
- Dòng có mode không qua kho hoặc nhập-xuất thẳng.
- Nhập WMS xong hệ thống tạo phiếu xuất nháp, thủ kho xác nhận.
- AP vẫn sinh từ bảng đối soát HĐ NCC, không sinh từ WMS.
- Phải review luồng xuôi/ngược, trạng thái kho, tồn, công nợ, cashflow, và chống cộng trùng.
Không đụng các file chat-v2 đang dirty.
```
