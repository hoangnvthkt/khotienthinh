# Unified Permission Matrix — bounded manual checklist

Ngày lập: 2026-07-18

Phạm vi: bộ quyền đã xác minh của Nhật ký dự án (Daily Log)

Trạng thái: chỉ là phiếu Pass/Fail; chưa chạy mutation Cloud.

## Điều kiện tiên quyết

- Dùng tài khoản kiểm thử non-Admin đang hoạt động.
- Tài khoản không có Business Role hoặc Legacy umbrella che khuất bằng chứng deny.
- Ghi lại badge nguồn quyền trước từng ca kiểm thử.
- Xác minh response tin cậy từ backend, không chỉ dựa vào trạng thái ẩn/hiện của nút.
- Dừng ngay ở lần allow ngoài dự kiến đầu tiên và lưu evidence.
- Không chạy trên Cloud nếu chưa có checkpoint riêng phê duyệt tài khoản test và mutation.

## Ma trận Pass/Fail

Project A là scope được cấp. Project B là scope đối chứng phải bị từ chối.

| Direct permissions được cấp | Phải cho phép | Phải từ chối | Kiểm tra scope | Kết quả |
|---|---|---|---|---|
| View | Mở/đọc Daily Log | Create, Edit, Submit, Verify, Approve | Project B bị từ chối | Chưa chạy |
| View + Create | Tạo draft đủ điều kiện | Submit, Verify, Approve | Project B bị từ chối | Chưa chạy |
| View + Edit own | Sửa draft đủ điều kiện do chính mình tạo | Sửa draft của người khác, Submit, Verify, Approve | Project B bị từ chối | Chưa chạy |
| View + Edit all | Sửa draft đủ điều kiện trong project | Submit, Verify, Approve | Project B bị từ chối | Chưa chạy |
| View + Submit | Submit draft đủ điều kiện | Verify, Approve | Project B bị từ chối | Chưa chạy |
| View + Verify | Verify bản ghi đủ điều kiện được phân công | Approve | Project B bị từ chối | Chưa chạy |
| View + Approve | Approve bản ghi đủ điều kiện | Sửa tùy ý hoặc Verify | Project B bị từ chối | Chưa chạy |

## Evidence cần ghi cho mỗi dòng

- ID tài khoản test và project scope (không ghi mật khẩu/token).
- Direct Grant trước/sau và các badge nguồn quyền hiệu lực.
- Request nghiệp vụ, HTTP status/RPC result và mã lỗi backend nếu bị từ chối.
- Người kiểm thử, thời gian, kết quả Pass/Fail và liên kết evidence nội bộ.
- Xác nhận đã hoàn nguyên quyền test theo checkpoint Cloud được phê duyệt.
