# Quyết định còn mở và giả định làm việc

Không hỏi lại các nguyên tắc đã rõ: workspace cạnh chat, mobile đổi tab, người dùng xác nhận nghiệp vụ cuối, cùng dữ liệu/quyền/workflow với module cũ, và phạm vi đích toàn ứng dụng.

**Đã xác định thêm:** dự án/công trường là ưu tiên cao nhất; quyết định, thông báo điều động và đề xuất nhân sự thuộc phạm vi phục vụ dự án. Thứ tự và hành trình đề xuất ở [05-project-first-strategy.md](05-project-first-strategy.md).

## Cần chủ nghiệp vụ bổ sung ở đúng chặng

| Điểm cần xác định | Đề xuất ban đầu | Khi nào cần câu trả lời |
|---|---|---|
| Nhóm người dùng đầu tiên | BCH/CHT/kỹ sư một công trường cùng người duyệt và HR/cung ứng phục vụ dự án; chọn pilot cụ thể | Trước UAT/pilot, không hỏi lại ưu tiên dự án đã xác định |
| Nhân sự/điều động/quyết định | Tách nhu cầu, phương án, phê duyệt, ban hành, ngày hiệu lực và tiếp nhận; giữ cơ cấu HRM khác phân công dự án | Trước command nhân sự P2: thẩm quyền, liên dự án, kiêm nhiệm, đổi ngày/thu hồi và cơ chế ký/phát hành |
| Tài sản: đề nghị cấp và bàn giao | Dùng Request template nếu đã có; bàn giao là command riêng | Trước tích hợp luồng đề nghị → bàn giao. Không tự tạo rule duyệt hay template sản xuất |
| Retention và độ nhạy hội thoại/nháp | Owner-only mặc định; tối thiểu hóa dữ liệu đưa cho model; không bật chia sẻ tự động | Trước persistence production và đưa dữ liệu nhân sự/tài chính vào AI |
| Provider và ngân sách | Tái dùng Gemini adapter hiện có, sau khi kiểm model/timeout/quota; không cần đổi provider để làm UI | Trước bật AI thật và đặt quota/cohort; hiện chưa có số ngân sách để áp mức tiền |
| Thao tác admin có được AI chuẩn bị không | Có catalog theo quyền; execute chỉ bằng UI xác nhận; nhóm nhạy cảm đưa vào chặng sau | Trước mở grant/revoke/role/config qua Center |
| Nghỉ phép và tài sản nếu thiếu rule domain | Giữ rule hiện hữu đã xác minh; ghi rõ các trạng thái/điều kiện còn thiếu | Trước viết command mới, không suy từ demo |

Các câu hỏi trên là register cho bước tiếp theo, không phải yêu cầu xin lại phép đọc repo hoặc sửa local thông thường.

## Quyết định kỹ thuật có thể chủ động thực hiện

- Giữ React/Vite/Supabase Cloud, HashRouter và permission engine hiện có; không Docker/Supabase local, không sub-agent.
- Bắt đầu route Center riêng dưới flag, giữ `/ai`/module cũ; chốt URL cụ thể khi triển khai shell.
- Không dùng role name demo, không để model execute, không chạy SQL/renderer tùy ý.
- `execute` dựa preview server; domain transaction nằm trong RPC thích hợp, không ghép atomicity bằng nhiều HTTP calls.
- Chưa dùng vector DB mới, microservice hay nhiều agent cho coordinator khi chưa có nhu cầu chứng minh được.
- Tách form/detail content khỏi wrapper theo từng renderer; không redesign toàn bộ UI ngoài phạm vi.
- Khôi phục thao tác chưa rõ kết quả bằng key/operation cũ; không tự gửi lại bằng key mới.

## Điều cần xác minh, không phải câu hỏi sản phẩm

Deployment hiện tại có khớp source/migrations; read permissions/ACL/field projection của từng capability; workflow version và assignment thật; trạng thái tài sản và rule cấp phát; schema nháp; limits model; test actors và môi trường Cloud test; baseline tsc bị prototype ảnh hưởng; tác động của migration mới lên cohort đang chạy. Agent phải thu thập bằng chứng thay vì yêu cầu chủ sản phẩm đoán các chi tiết kỹ thuật này.
