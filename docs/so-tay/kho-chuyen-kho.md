---
title: Chuyển kho giữa hai kho, nhận hàng chuyển đến
module: Kho
routes: /inventory|Kho
keywords: chuyen kho dieu chuyen vat tu gui hang sang kho khac nhan chuyen kho hang dang chuyen hoan hang ve kho tong tra hang ve kho cong truong khac
questions: Chuyển vật tư sang kho khác thế nào? | điều chuyển từ kho tổng ra công trường | công trường trả hàng thừa về kho tổng | nhận hàng chuyển kho ở đâu | chuyển kho rồi mà kho nhận chưa thấy | nhận thiếu hàng chuyển kho
permission: Giao dịch kho · Thủ kho (kho gửi để gửi, kho nhận để nhận)
---
**Khi nào:** đưa vật tư giữa hai kho (kho tổng ↔ công trường, công trường trả hàng thừa về kho tổng).
**Các bước:**
1. Kho gửi: Kho → **Chuyển kho** (hoặc **Tồn kho** → bấm vật tư → **Chuyển**).
2. Chọn **Kho gửi**, **Kho nhận**; **Thêm vật tư** (chỉ hiện mã còn tồn), quy cách, SL; **Ngày chứng từ**, ghi chú.
3. Bấm **Gửi hàng**: hàng rời kho gửi, phiếu ở trạng thái đang chuyển.
4. Kho nhận: Kho → **Hàng về chờ nhận** → mở phiếu → nhập số nhận lần này → **Xác nhận số đã nhận**. Nhận thiếu thì phần còn lại vẫn đang chuyển, nhận tiếp lần sau.
**Không làm được?**
- Không thấy nút **Chuyển kho** → bạn chưa là thủ kho kho nào (chỉ xem).
- Dòng báo "vượt tồn" / **Gửi hàng** mờ → SL lớn hơn tồn, hoặc chưa chọn kho nhận khác kho gửi.
- Kho nhận không thấy phiếu → người nhận chưa là thủ kho kho đó (Admin giao ở Phân quyền kho).
**Lưu ý:**
- Hàng từ Kho Tổng chuyển sang công trường thì chi phí vào dự án của công trường khi nhận.
