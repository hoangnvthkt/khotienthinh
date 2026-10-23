---
title: Kiểm kê kho
module: Kho
routes: /inventory|Kho;/audit|Kiểm kê
keywords: kiem ke kho kiem dem dem hang doi chieu ton chenh lech kiem ke cuoi thang dem mu giai trinh chenh lech duyet kiem ke ton ao lech ton chot tieu hao
questions: Kiểm kê kho làm thế nào? | tồn trên máy lệch thực tế thì sửa sao | kiểm đếm cuối tháng | ai duyệt kiểm kê | sao không lập được phiên kiểm kê | nộp kết quả đếm rồi muốn đếm lại | kiem ke lech
permission: Đếm: thủ kho của kho; Duyệt: Duyệt ngoại lệ, quản trị Kho vật tư hoặc Admin
---
**Khi nào:** cuối tháng, chốt tiêu hao, hoặc nghi tồn lệch.
**Các bước:**
1. Kho → **Kiểm đếm** (hoặc mở vật tư → **Kiểm đếm**): chọn kho, phạm vi **1 mã** / **Nhóm vật tư** / **Cả kho**, lý do; nên để **Đếm mù** → **Bắt đầu đếm N mã**.
2. Nhập số đếm từng dòng (**Đếm theo quy cách** nếu có) → **Lưu**; hàng có mà sổ không có: chọn ở ô **Thêm vật tư có thực tế nhưng ngoài sổ…** → **Thêm**.
3. Đếm đủ → **Nộp kết quả đếm** (số đếm khóa, hiện chênh lệch).
4. Chọn nguyên nhân cho từng dòng chênh (VD "Đã dùng thi công, chưa lập phiếu xuất") → **Lưu giải trình**.
5. Người duyệt mở phiên ở ô **Chờ duyệt** → **Duyệt & ghi sổ** (tồn khớp số đếm) hoặc **Từ chối** để đếm lại.
**Không làm được?**
- Báo "Kho này đang có một phiên kiểm kê chưa xong" → làm nốt hoặc **Hủy phiên** cũ.
- Người lập / người nộp không tự duyệt được → nhờ người duyệt khác.
- **Duyệt & ghi sổ** mờ → còn dòng chênh chưa có nguyên nhân.
- Ghi sổ báo tồn âm → đã xuất sau khi nộp; **Từ chối** để đếm lại dòng đó.
**Lưu ý:**
- Lịch sử kiểm kê kiểu cũ (trước 10/2026) xem ở màn Kiểm kê → **Lịch sử cũ**.
