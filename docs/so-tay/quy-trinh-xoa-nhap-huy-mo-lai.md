---
title: Xóa bản nháp, hủy hoặc mở lại phiếu quy trình
module: Quy trình
routes: /wf|Quy trình
keywords: xoa phieu quy trinh huy phieu qt xoa ban nhap gui nham rut lai phieu mo lai phieu da hoan thanh mo lai phieu bi tu choi keo tha kanban tiep tuc soan
questions: xóa phiếu quy trình thế nào | huy phieu quy trinh da gui | gửi nhầm phiếu qt muốn rút lại | xoá bản nháp phiếu | mở lại phiếu đã hoàn thành | sao không có nút hủy phiếu
permission: Phiên quy trình · Xóa bản nháp của mình; mở lại cần Phiên quy trình · Mở lại phiên quy trình
---
**Khi nào:** tạo nhầm, gửi nhầm, hoặc cần chạy lại phiếu đã kết thúc.
**Các bước:**
1. Bản nháp: **Quy trình** → **Phiếu của tôi** → dòng phiếu → **Tiếp tục soạn**.
2. Trong hộp **Sửa phiếu**: bấm nút thùng rác → xác nhận để xóa; hoặc **Gửi xử lý** để gửi luôn.
3. Phiếu đã gửi nhầm: nhờ người đang xử lý bấm **Từ chối** kèm lý do "gửi nhầm" (chỉ cần sửa thì **Yêu cầu bổ sung**).
4. Phiếu đã **Hoàn thành / Từ chối** cần chạy lại: người có quyền mở lại bấm **Kanban**, kéo thẻ từ cột kết thúc về bước cần làm lại, ghi lý do.
**Không làm được?**
- Không thấy nút hủy cho phiếu đang chạy → màn Quy trình hiện chưa có nút hủy → làm như bước 3; bước không có **Từ chối** thì nhờ Admin.
- Không kéo được thẻ trên Kanban → thiếu quyền "Phiên quy trình · Mở lại phiên quy trình" → nhờ Admin.
- Không thấy nút thùng rác → phiếu không còn là bản nháp.
**Lưu ý:**
- Muốn làm phiếu mới giống phiếu cũ: mở phiếu → **Nhân bản**.
