# 12 — Mua theo Hợp đồng nguyên tắc trong Mua hàng (việc 4)

Chủ SP duyệt 6 câu hướng làm, mockup `fc-v1` và 4 câu sau mockup ngày 03/10/2026. Migration `20261008133600_procurement_framework_contract_orders.sql`.

## Vấn đề

- HĐ nguyên tắc nằm ở 3 nơi: khai ở Hợp đồng — Đối tác, công trường tạo phiếu giao ở Dự án → Chuỗi cung ứng, Mua hàng chỉ đối soát.
- Dòng "nhập–xuất thẳng" phải **xuất kho xong** mới vào được bảng đối soát. Hàng nhập để lưu kho (VD bulong HĐ Hưng Thịnh, 12 dòng nhập Kho SMB 03/10) bị khóa vì phiếu xuất tự sinh còn chờ.

## Luồng mới (tất cả trong Mua hàng → Hợp đồng nguyên tắc)

1. **Khai HĐ** (Mua hàng — Quản trị): số, tên, NCC, dự án (để trống = dùng chung nhiều dự án, cả Kho Tổng), thời hạn, giá trị / hạn mức, hạn thanh toán. Dùng chung bảng với Hợp đồng — Đối tác. Đã phát sinh giao nhận / đơn thì khóa NCC và dự án.
2. **Bảng giá** có ngày hiệu lực (như cũ); HĐ chưa có giá thì danh sách vật tư đã nhận được điền sẵn.
3. **Gọi hàng theo HĐ** = đơn PO gắn HĐ (`purchase_orders.supplier_contract_id`):
   - Người lập: Mua hàng, hoặc người có quyền "Gọi hàng theo HĐ" (`project.material_supplier_delivery.create`) của dự án. Kho Tổng chỉ Mua hàng.
   - Giá lấy từ bảng giá HĐ tại ngày giao; vật tư chưa có giá → giá tạm, chốt khi đối soát. Một đơn một mức VAT.
   - **Không duyệt từng đơn**: gửi là duyệt, tạo đợt giao + phiếu nhập/QR cho thủ kho. Vượt giá trị HĐ hoặc hạn mức vật tư → chọn người Mua hàng duyệt.
   - Hình thức nhận theo đơn: **Nhập lưu kho** (tồn tăng) hoặc **Nhập–xuất thẳng** (ghi nhận dùng ngay, tồn không đổi — chế độ `DIRECT_CONSUMPTION` sẵn có của PO).
4. **Thủ kho nhận** như đơn PO. Nhận xong **không ghi nợ / chi phí**; hệ thống ghi một phiếu giao nhận chờ đối soát (`supplier_direct_delivery_notes.source_delivery_batch_id`). Trả NCC trước đối soát thì giảm SL chờ đối soát.
5. **Đối soát tháng**: dòng đã nhập kho xong (hoặc không qua kho) là đối soát được — **không chờ xuất kho**. Giá khác giá HĐ bắt buộc ghi lý do (lưu `price_reason`, `contract_unit_price`). Mỗi bảng một dự án; nhận về Kho Tổng thì bảng cấp công ty.
6. **Kế toán ghi nợ** (như cũ) → chi phí vào dự án của kho nhận; Kho Tổng là hàng tồn, chi phí vào dự án khi chuyển / xuất.

## Dự án → Chuỗi cung ứng

Bỏ nút "Tạo phiếu giao HĐ", thay bằng "Gọi hàng ở Mua hàng". Phiếu giao cũ vẫn xem được và đối soát được trong Mua hàng (cũng bỏ ràng buộc xuất kho).

## Công trường không có quyền Mua hàng

Mở `/procurement?mode=contracts`: thấy HĐ của dự án mình được gọi hàng, đơn của mình, hàng đã nhận; không thấy bảng đối soát / công nợ.

## Khác với mockup

- Hình thức nhận chọn **theo đơn**, không theo từng dòng (mỗi đợt giao của PO có một hình thức). Cần cả hai thì lập 2 đơn.
- "Không qua kho" gộp vào "Nhập–xuất thẳng": cả hai đều không làm đổi tồn kho và đều cần thủ kho / công trường xác nhận SL nhận.
