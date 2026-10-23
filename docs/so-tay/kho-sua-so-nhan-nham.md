---
title: Sửa số đã nhận nhầm (nhập kho thừa)
module: Kho
routes: /inventory|Kho
keywords: sua so nhan nham nhap nham nhap thua sua phieu nhap da ghi so giam so nhan sai so can nhap sai so luong dieu chinh phieu nhap
questions: Nhập kho nhầm số lượng thì sửa thế nào? | phiếu nhập đã ghi sổ sửa được không | lỡ nhập thừa một số 0 | sửa số nhận sau khi nhập kho | sao không bấm được Sửa số nhận nhầm | nhập thiếu muốn sửa tăng
permission: Giao dịch kho · Duyệt ngoại lệ (kho nhận) hoặc Admin
---
**Khi nào:** đợt giao theo đơn đã nhập kho nhưng số ghi lớn hơn số thực nhận.
**Các bước:**
1. Kho → **Sổ phiếu** → gõ số phiếu / NCC → mở phiếu nhập.
2. Trong khung tiến độ đơn, bấm **Sửa số nhận nhầm**.
3. Nhập số đúng từng dòng (chỉ được giảm) và lý do (số cân thực tế, ai phát hiện) → lưu.
4. Hệ thống ghi phiếu điều chỉnh kho, giảm công nợ NCC, đơn mở lại phần thiếu; mục "Đã sửa số nhận" giữ trước → sau.
**Không làm được?**
- Nút mờ, ghi người đã duyệt nhận không tự sửa → nhờ người Duyệt ngoại lệ khác.
- Không thấy nút → bạn chưa có việc Duyệt ngoại lệ ở kho này (Admin giao ở Phân quyền kho).
- Số đúng lớn hơn số đã nhận → không sửa tăng; phần còn lại nhận qua **NCC giao tiếp**.
- Báo "Công nợ của đợt đã có…" → báo kế toán điều chỉnh công nợ; kho chỉnh qua kiểm kê.
- Đơn gọi hàng theo HĐ nguyên tắc → Mua hàng điều chỉnh ở bảng đối soát tháng.
**Lưu ý:**
- Phiếu chưa ghi sổ thì sửa thẳng ô **SL thực tế** trước khi nhận.
