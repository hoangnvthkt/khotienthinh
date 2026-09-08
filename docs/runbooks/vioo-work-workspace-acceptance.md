# Nghiệm thu Workspace pilot trên dev

Phạm vi nghiệm thu là dev server vioo-work-r1a tại
http://127.0.0.1:5187/#/work. Pilot chỉ gồm Workspace **Phòng Quản lý dự án**,
admin admin@khoviet.vn và thành viên sonpn@tienthinhjsc.vn. Thông báo vẫn tắt.

## Bằng chứng tự động

- [ ] Cloud có đúng một Workspace phòng ban ở chế độ workspace.
- [ ] Workspace có đúng hai thành viên, đúng vai trò admin/member và cùng hạn
  2026-09-21T07:02:36.939209Z.
- [ ] Task VW-2026-000017, assignment, lịch, SLA, event, version và outbox giữ
  nguyên fingerprint; không tạo notification delivery.
- [ ] 15 direct grant pilot cũ được soft revoke có before/after audit; module access
  của hai người đến từ membership.
- [ ] Chỉ admin có work.workspace.create global; Sơn không có create Workspace,
  configure, recovery hoặc quyền xem task restricted.
- [ ] Persona SQL dùng auth_id thật của admin và Sơn qua guarded RPC; principal
  không tồn tại bị từ chối ở raw table/RLS.
- [ ] Full test, lint, TypeScript, build, migration ledger, query audit, browser
  regressions và postflight Cloud đều đạt.

## Anh nghiệm thu bằng đăng nhập thật

Các ô dưới đây chỉ đánh dấu sau khi anh trực tiếp đăng nhập. Bộ kiểm thử không giả
JWT trong browser và không tạo task gửi thông báo cho người thật.

### Admin — admin@khoviet.vn

- [ ] Dashboard /work hiển thị thẻ **Phòng Quản lý dự án** sống động, đúng ảnh
  bìa và số việc cần xử lý.
- [ ] Mở thẻ xem được task hiện có; nút quay lại danh sách và giao diện mobile hoạt
  động đúng.
- [ ] Tạo được Workspace cộng tác mới; danh sách nguồn phòng ban/dự án chỉ hiển thị
  nguồn admin được phép dùng.
- [ ] Mở **Thành viên**, tìm nhanh người từ sơ đồ tổ chức, xem preview thay đổi và
  áp dụng được với lý do rõ ràng.
- [ ] Mở **Cài đặt**, chỉnh nhóm việc/lịch/SLA trong Workspace; thao tác lưu trữ
  hiện đúng capability và cảnh báo task đang mở.
- [ ] Tạo task standard trong Workspace thành công khi chủ động thực hiện; task
  restricted chỉ hiện với đúng người liên quan.

### Thành viên — sonpn@tienthinhjsc.vn

- [ ] Dashboard chỉ hiển thị Workspace đã tham gia và mở được task trong phòng.
- [ ] Tạo/giao công việc trong Workspace theo capability thành viên.
- [ ] Không thấy nút quản trị thành viên, cấu hình, lưu trữ hoặc tạo Workspace mới.
- [ ] Công việc giao trực tiếp vẫn nằm ở **Việc của tôi** và không bị gộp vào
  Workspace.

### Người ngoài pilot

- [ ] Một tài khoản không phải thành viên không thấy Workspace Phòng Quản lý dự án,
  kể cả khi biết URL.

## Sau nghiệm thu

Giữ dev server chạy và thông báo tắt. Mốc quan sát 48 giờ bắt đầu sau khi anh xác
nhận các mục đăng nhập thật; chưa được đánh dấu hoàn thành chỉ từ kiểm thử tự động.
