# Quy tắc Chống "Vibe Coding" & Quản lý Nợ Kỹ Thuật (Anti-Vibe Coding Rule)

**BỐI CẢNH:**
AI sinh code rất nhanh, nhưng nếu không có kiến trúc, codebase sẽ sớm trở thành một "mớ hỗn độn" (vibe coding) không thể bảo trì. Đã có những hệ thống sau 6 tháng phát triển bằng AI bị sụp đổ vì đụng vào đâu hỏng đó.

**ĐIỀU KHOẢN BẮT BUỘC KHI TRIỂN KHAI TÍNH NĂNG MỚI:**
AI (Antigravity/Cursor/Claude...) phải ĐỌC và TUÂN THỦ nghiêm ngặt 4 quy tắc sống còn sau đây trước khi viết dòng code nào cho dự án KhoTienThinh:

## 1. Luật Chia Nhỏ (Componentization) - "Không dồn trứng vào một rổ"
- **Ngưỡng báo động đỏ:** Bất kỳ file UI (React component) nào tiến gần đến **500 - 800 dòng code**, AI PHẢI chủ động đề xuất dừng lại để tách component (ví dụ: tách Toolbar, Table, Form Modal ra các file riêng) trước khi nhồi thêm tính năng mới.
- **Tránh Monolith Component:** Không để một component gánh vác quá nhiều vai trò (vừa fetch data, vừa tính toán logic phức tạp, vừa render hàng ngàn dòng UI).

## 2. Luật Tách Bạch Logic (Separation of Concerns)
- **Tách hàm tính toán ra khỏi UI:** Bất kỳ thuật toán cốt lõi nào (như tính toán Critical Path, AI Risk Engine, Xử lý số liệu biểu đồ) phải được dời sang thư mục `/lib/` hoặc thư mục `/utils/`.
- Component `.tsx` chỉ làm 2 việc: Lấy dữ liệu (Fetch/State) và Hiển thị (Render).
- Hạn chế sử dụng `useEffect` chằng chịt gây re-render vô tận. Nếu có quá nhiều state lồng nhau, hãy nghĩ đến việc gộp state hoặc dùng Custom Hooks.

## 3. Luật Tái Sử Dụng (DRY - Don't Repeat Yourself)
- **Cấm tự tiện "phát minh lại cái bánh xe":** Trước khi tạo một Helper function mới (như format ngày tháng, tính tiền, call API) hay một UI Component mới (nút bấm, modal xác nhận), AI PHẢI tìm kiếm trong codebase xem đã có hàm/component tương đương chưa.
- Luôn ưu tiên sử dụng lại các pattern chuẩn đã có (như `ConfirmContext` thay cho `window.confirm`, dùng Toast notification chuẩn của hệ thống).

## 4. Luật Rào Chắn & Lập Kế Hoạch (Plan before you act)
- **Không nhắm mắt code:** Trước khi thêm một Feature lớn (Epic), AI PHẢI viết `implementation_plan.md` để chốt kiến trúc với Dev (Anh Thịnh).
- **Trọn vẹn thay vì chắp vá:** Khi sửa một logic có liên quan đến các module khác, phải kiểm tra các side-effects (hiệu ứng phụ) để đảm bảo không làm sập các tính năng đang chạy ổn định.
- Sau mỗi Phase, phải tóm tắt lại bằng `walkthrough.md` để ghi nhận tài liệu cho người đến sau.

> **LỜI THỀ:** "Tôi là một AI Assistant. Tôi không chỉ là một thợ gõ code tốc độ cao, tôi là một Kiến trúc sư phụ tá. Tôi cam kết giữ cho dự án KhoTienThinh luôn sạch sẽ, dễ bảo trì, và không bao giờ để nợ kỹ thuật vượt tầm kiểm soát."
