---
title: Lập đơn hàng mua (PO) từ báo giá
module: Mua hàng
routes: /procurement|Mua hàng
keywords: lap don hang po tao po mua hang dat hang bao gia nha cung cap nhap excel chup bao gia dan bao gia don mua chu dong du tru kho tong chot gia hang dat dai ngay
questions: Lập PO từ báo giá NCC thế nào? | nhập báo giá Excel vào đơn | chụp báo giá để AI đọc | mua trước khi có đề xuất được không | đơn chủ động là gì | mua dự trữ kho tổng | sao không có nút Chụp / dán báo giá
permission: Mua hàng · Quản trị
---
**Khi nào:** có báo giá NCC, cần đặt hàng khi chưa có phiếu nhu cầu (chốt giá, hàng đặt dài ngày, bù tồn, dự trữ Kho Tổng).
**Các bước:**
1. Gõ "lập đơn hàng" ở ô Tìm kiếm (hoặc Mua hàng → **Đơn hàng (PO)**) → **Lập đơn chủ động**.
2. Chọn **Cho một dự án** (dự án + kho nhận) hoặc **Dự trữ Kho Tổng**; chọn **Nhà cung cấp**, ngày, **Thuế VAT**, lý do mua chủ động.
3. Thêm vật tư: **Nhập từ Excel** (có **Tải mẫu Excel**), **Chụp / dán báo giá** để AI đọc, hoặc gõ tìm từng mã; kiểm rồi bấm **Đưa N vật tư vào đơn**.
4. Kiểm SL, đơn giá, quy cách; vật tư vượt / ngoài BOQ phải ghi lý do.
5. **Lưu đơn nháp** → chọn người duyệt → **Gửi duyệt**.
**Không làm được?**
- Không có nút **Lập đơn chủ động** → thiếu quyền Mua hàng · Quản trị.
- Nút Excel / báo giá mờ → chọn dự án và kho nhận trước. Không thấy **Chụp / dán báo giá** → Admin chưa gán kết nối AI.
- Dòng ghi "Chưa có mã trong danh mục" → đề xuất cấp mã ở Danh mục vật tư rồi nhập lại.
**Lưu ý:**
- Đề xuất cùng vật tư đến sau sẽ hiện "Đã có trong đơn chủ động" ở phiếu Cần mua → bấm **Gắn …** thay vì mua thêm.
- Đã có phiếu đề xuất thì lập đơn từ ô **Cần mua**.
