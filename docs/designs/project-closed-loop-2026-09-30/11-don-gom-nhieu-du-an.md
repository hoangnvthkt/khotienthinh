# 11 — Đơn gom nhiều dự án (việc 2)

Chủ SP duyệt mockup `mg-v1` và 6 câu ngày 03/10/2026. Migration `20261008133500_procurement_group_po_multi_project.sql`.

## Luật

| Trường hợp | Xử lý |
|---|---|
| Chọn dòng Cần mua của nhiều dự án, cùng NCC | Lập **một đơn gom** (PO không gắn một dự án; `metadata.groupOrder`) |
| Mỗi dòng nhu cầu | Bắt buộc có kho nhận (kho công trường của dự án) |
| Đợt giao | Mỗi đợt về **một công trường**; thủ kho công trường đó nhận (kể cả khi không có quyền Mua hàng) |
| Công nợ + chi phí | Ghi cho **dự án của công trường** nhận đợt đó |
| Giao ít hơn phần còn thiếu | Chia cho các đề xuất của công trường theo **ngày cần sớm nhất** (mặc định) hoặc **tỷ lệ** (chọn ở đợt giao) |
| Giao nhiều hơn | Phần thừa là tồn kho công trường; Mua hàng có thể gán sang đề xuất khác **cùng dự án, cùng vật tư** (bắt buộc lý do, không vượt phần thừa) |
| Kết thúc thiếu | Phần chưa giao quay về Cần mua của từng dự án |
| Trả NCC | Trừ vào đề xuất cần muộn nhất của công trường đó |

- Đơn một dự án giữ nguyên như cũ (tự tạo đợt khi duyệt, chia tỷ lệ).
- Bản in đề nghị duyệt có thêm bảng **Phân bổ theo dự án** (SL, tiền hàng, VAT theo từng dự án).

## Kỹ thuật

- Cột mới: `purchase_order_delivery_batches.target_warehouse_id`, `allocation_mode`; `purchase_order_request_lines.excess_reason`.
- `app_private.group_po_link_allocation(po)` tính phần nhận theo từng dòng đề xuất; `procurement_link_received_v2` / `procurement_link_credited_v2` thay v1 trong Cần mua, inbox, kết thúc thiếu, đối chiếu (đơn một dự án cho kết quả như v1).
- RPC mới `assign_group_po_excess_v1`. `get_procurement_order_v1` trả `isGroup`, `sites`.

## Kiểm thử rollback trên production (03/10)

`tools/mg-test.mjs`: đơn gom Dầu Diezel 2 dự án (SMB, DA29) → lưu, gửi, duyệt; đợt không chọn công trường bị chặn; đợt 800 L về SMB → thủ kho SMB nhận, chia ngày cần sớm nhất (MR-9807 đủ 370 tự hoàn tất, MR-9818 nhận 430), công nợ + chi phí 18,92 tr vào SMB; đợt 450 L về XHV → MR-9810 đủ 400, thừa 50; gán thừa sang dự án khác / thiếu lý do / vượt phần thừa bị chặn, gán hợp lệ chạy; chế độ tỷ lệ chia 233/378/189; kết thúc thiếu trả 170 L về Cần mua. `tools/mg-single.mjs`: đơn một dự án không đổi (inbox 140 dòng, tự tạo đợt, v1 = v2).
