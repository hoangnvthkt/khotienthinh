# 10 — Mua nóng / CCDC (M2c, việc 3)

Chủ SP duyệt mockup `mc-v1` và 6 câu ngày 03/10/2026. Migration `20261008133400_procurement_hot_purchase_m2c.sql`.

## Luật

| Trường hợp | Xử lý |
|---|---|
| Tổng phiếu ≥ ngưỡng (mặc định 5.000.000 đ, gồm VAT) | Gửi **Chỉ huy trưởng** duyệt **trước khi mua** |
| Cộng dồn 7 ngày, cùng NCC, cùng dự án ≥ ngưỡng | Cũng phải duyệt (chống chia nhỏ phiếu) |
| Dưới ngưỡng | Mua trước (bắt buộc số hóa đơn / phiếu bán lẻ), hệ thống báo CHT |
| Mua thực tế vượt số đã duyệt quá 10% | CHT xác nhận lại rồi mới nhận hàng, ghi chi phí / công nợ |

- **Người duyệt** = chức danh "Chỉ huy trưởng" trong Tổ chức dự án. Chưa có CHT, hoặc CHT chính là người lập → Admin / quản trị module Dự án. Người lập không tự duyệt.
- **Ngưỡng** sửa ở Mua hàng → Mua nóng → Ngưỡng (Admin / Mua hàng — Quản trị), lưu lịch sử. Phiếu chốt ngưỡng lúc gửi.

## Vòng phiếu (`site_direct_purchases`, cờ `hub_flow`)

Nháp → (Chờ CHT duyệt → Được mua →) Đã mua → Nhận hàng → Kế toán ghi nợ **hoặc** chờ bộ hoàn ứng tháng → Xong. Hủy được trước khi mua (bắt buộc lý do). CHT trả lại → về Nháp kèm lý do.

| Loại dòng | Khi nhận hàng |
|---|---|
| Nhập kho | Tạo phiếu nhập kho, hoàn tất bằng quyền WMS của người nhận (thủ kho kho nhận) |
| Dùng ngay | Không qua kho |
| CCDC | Vào sổ CCDC (`site_small_tool_records`) theo người giữ |

| Nguồn tiền | Chi phí / thanh toán |
|---|---|
| Quỹ công trường, Nhân viên ứng trước | Bộ hoàn ứng cuối tháng (module có sẵn) ghi chi phí dự án |
| Công ty chuyển khoản, NCC cho nợ | Kế toán (Tài chính — Ghi sổ) **Ghi công nợ NCC** → chi phí dự án ghi cùng lúc → Đề nghị chi |

- Dòng gắn **đề xuất vật tư** (nút Mua nóng ở Cần mua): đã gửi/duyệt/mua tính là có nguồn, nhận xong tính là đã nhận → đề xuất tự hoàn tất (việc 1).

## Nơi dùng

- Mua hàng → tab **Mua nóng** (mọi dự án; người không có quyền Mua hàng mở link `?mode=hot` vẫn thấy phiếu của mình).
- Dự án → Vật tư → **Mua nóng** (công trường lập phiếu, CHT duyệt).
- Cần mua → dòng thiếu → nút **Mua nóng** (mang sẵn dự án, kho, vật tư, số lượng, gắn dòng đề xuất).

## Kiểm thử rollback trên production (03/10)

`tools/mc-test.mjs`: dưới ngưỡng có hóa đơn → đã mua, báo CHT; thủ kho nhận → phiếu nhập kho hoàn tất, sổ CCDC, đề xuất tự hoàn tất; ≥ ngưỡng → CHT duyệt (Mua hàng không duyệt được); vượt 12% → chặn nhận đến khi CHT xác nhận; kế toán ghi nợ → chi phí 13,2 triệu vào dự án, hạn 30 ngày; cộng dồn 7 ngày → phải duyệt; 11 trường hợp sai quyền / thiếu dữ liệu bị chặn.
