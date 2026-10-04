# Vioo Office — trạng thái trên branch riêng

Branch `codex/vioo-office`, nền `origin/main` tại `6e32def`. Mọi mã nguồn Office nằm trong checkout riêng; không merge main, không sửa nhánh làm việc khác. Theo chỉ dẫn hiện hành, Supabase Cloud chỉ được kiểm thử trong transaction rồi rollback. Không Docker/local, không sub-agent.

| Nhóm | Trạng thái |
| --- | --- |
| P0: 22 chức năng vòng đời văn bản | Đã triển khai và kiểm thử trong phạm vi cho phép |
| P1: mẫu, export, phiên bản, liên kết, xác nhận, báo cáo, scan | Đã triển khai và kiểm thử |
| Góp ý: đơn vị gửi/nhận, tag sau phát hành, hủy/hết hạn, folders/workflow/quyền | Đã triển khai; dùng cùng RBAC và cơ cấu tổ chức của ERP |
| Rich editor và UI mobile theo Procurement | Đã triển khai; 22 browser tests trên Chromium/WebKit |
| AI/OCR: đọc PDF/ảnh, metadata, tóm tắt, hỏi đáp, tìm kiếm, soạn | Đã có backend/UI; chưa cấu hình key/model hay gọi provider thật |
| Digital signature integration | Chưa tích hợp; cần provider, chứng thư và quy trình ký chính thức |
| Command Center | Service độc lập UI đã sẵn sàng; chưa có module host để gắn actions vào giao diện |
| Kích hoạt production | Chưa thực hiện; migration vẫn chưa áp dụng |

## Bước vận hành còn lại

1. Review migration duy nhất và cấu hình quyền/người duyệt/kho/sổ số; xác định mốc số chuyển đổi nếu dùng tiếp sổ cũ.
2. Khi được phép kích hoạt Cloud, triển khai đúng migration và frontend. Nghiệm thu bằng Auth thật, tệp thật qua Storage HTTP, thông báo/push trên thiết bị thật và hai phiên cấp số đồng thời.
3. Thêm secrets AI/model, deploy `office-assistant`, kiểm tra OCR bằng tài liệu được phép gửi provider. Không có khóa frontend hay provider fallback tự bật.
4. Chọn provider/chứng thư ký số và host Command Center trước khi triển khai hai tích hợp còn lại. Đây là phần chưa hoàn tất, không có nút giả báo đã ký.

[Bằng chứng kiểm thử](validation.md) · [Runbook kích hoạt](activation.md) · [Kế hoạch P1](p1-plan.md)
