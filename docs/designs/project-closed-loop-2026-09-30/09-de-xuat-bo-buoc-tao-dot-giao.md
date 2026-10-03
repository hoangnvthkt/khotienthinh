# 09 — Đề xuất vật tư: bỏ bước "Tạo đợt giao" (việc 1)

Chủ SP duyệt mockup `mr-v1` và 5 câu hỏi ngày 02/10/2026. Migration `20261008133300_material_request_supply_v1.sql`.

## Luồng mới

Lập → CT duyệt → Phòng vật tư duyệt (giữ nguyên) → **Đang cung ứng** → **Hoàn tất** (tự động) / **Đã kết thúc** (bằng tay).

- Mã bước nội bộ vẫn là `workflow_step = 'batch_planning'`, giao diện hiển thị "Đang cung ứng", không đặt hạn SLA.
- Đã kết thúc: `status = COMPLETED`, `workflow_step = 'ended'`.

## Cung ứng ở Mua hàng → Cần mua

| Cách | Làm gì |
|---|---|
| Mua mới | Lập đơn hàng (PO) như trước |
| Cấp từ kho | `create_material_request_supply_transfer_v1`: phiếu chuyển `PENDING` gắn dòng (`transactions.source_type = 'material_request_supply'`, `items[].requestLineId`). Kho gửi xuất, kho công trường nhận bằng lệnh chuyển kho 2 bước. Chi phí đi theo hàng (K3a-2). |

- Chỉ cấp từ kho khi **cả kho gửi và kho nhận đã bật** lệnh `wms.transfer.dispatch` + `wms.transfer.receive` (rollout ERP). Chưa bật thì nút khóa, có giải thích.
- Khả dụng = tồn kho gửi − phiếu chuyển đang chờ xuất từ kho đó. Không cho chuyển vượt phần còn thiếu.

## Tiến độ theo dòng (`app_private.material_request_supply_lines_v1`)

- Đã có nguồn = PO (trừ phần NCC ghi giảm) + phiếu chuyển (chờ xuất / đang đi / đã nhận) + đợt cấp cũ từ kho đã nhận.
- Đã nhận (đơn vị kho) = nhận qua PO (đã quy đổi) + nhận qua phiếu chuyển + đợt cấp cũ từ kho.
- Dòng **đủ** khi đã nhận ≥ 98% số cần. Trạng thái dòng: Đã nhận / Chờ hàng / Chưa có nguồn / Đã đóng.
- Cần mua dùng cùng số này (`procurement_inbox_lines`).

## Tự hoàn tất / mở lại (`refresh_material_request_supply_v1`)

- Gọi khi PO đổi `items` / `status` / lưu trữ, khi kho nhận / trả phiếu chuyển, và cuối hai hàm đồng bộ đợt cấp cũ.
- Mọi dòng đủ hoặc đã đóng → Hoàn tất (hoặc Đã kết thúc nếu có dòng đóng). Trả NCC làm thiếu lại → mở lại Đang cung ứng. Ghi `material_request_events` (`SUPPLY_COMPLETED` / `SUPPLY_REOPENED`).

## Kết thúc đề xuất (`end_material_request_supply_v1`)

- Người được kết thúc: chỉ huy trưởng (quyền Duyệt trong room Đề xuất vật tư), người lập phiếu, Admin / quản trị module DA.
- Bắt buộc lý do; lý do chọn nhanh: Không cần nữa / Đã mua ngoài hệ thống / Thay bằng đề xuất khác / Lệch quy đổi, coi như đủ.
- Dòng còn thiếu ghi `material_request_line_need_closures` (số đóng, số đã nhận lúc đóng, lý do, người) và rời Cần mua.
- PO đang chờ vẫn giao, hàng về thành tồn kho công trường.

## Chuyển đổi khi lên bản

- 6 đề xuất đã nhận đủ → Hoàn tất. 28 có nguồn → Đang cung ứng. 20 chưa có nguồn → banner **Đề xuất treo cần quyết** trong tab Đề xuất của dự án, CHT giữ hoặc kết thúc hàng loạt.
- Bảng đợt cấp cũ (`material_request_fulfillment_*`) giữ nguyên để truy vết; cột đợt cũ trên kanban chỉ hiện khi còn phiếu.

## Kiểm thử rollback trên production (02/10)

`tools/mr-test.mjs` (`stats`, `flow`, `po`, `perf`): chuyển đổi đúng số đã duyệt; Cấp từ kho → xuất → nhận 398/400 tự hoàn tất, chi phí 2,77 triệu chuyển dự án; chặn đúng quyền / lý do / vượt nhu cầu / kho chưa bật chuyển kho; PO nhận đủ → hoàn tất, trả NCC một nửa → mở lại; tốc độ Cần mua không đổi (~0,7 s).

## Bổ sung 03/10 — "Đóng nhu cầu" ở Mua hàng tự Kết thúc đề xuất

Migration `20261008133700_procurement_close_need_ends_request.sql` (chủ SP đồng ý 03/10).

- Mua hàng đóng nhu cầu của một đề xuất vật tư đang cung ứng → đề xuất chuyển **Kết thúc** như CHT bấm Kết thúc: dòng chưa có nguồn ghi đóng kèm lý do; dòng đã đặt PO / đang chuyển kho vẫn giao, hàng về thành tồn kho công trường. Lịch sử ghi "Mua hàng đóng nhu cầu: <lý do>".
- **Mở lại** ở Mua hàng → gỡ đúng các dòng đóng của lần đóng đó, đề xuất về **Đang cung ứng** (hoặc tự hoàn tất nếu đã nhận đủ). Không gỡ Kết thúc do CHT bấm.
- Phiếu kết thúc do Mua hàng đóng vẫn ở tab "Đã đóng" để mở lại. Kế hoạch vật tư giữ như cũ.
- Thử rollback trên production (`tools/cn-test.mjs`): MR-2026-9776 (3 dòng đã đủ, 3 dòng chờ) → đóng: Kết thúc, đóng 3 dòng, vẫn ở tab Đã đóng → mở lại: Đang cung ứng, gỡ 3 dòng.
