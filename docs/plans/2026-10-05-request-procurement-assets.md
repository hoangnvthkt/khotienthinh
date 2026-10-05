# Yêu cầu → Mua hàng → Tài sản → Cấp phát

Phạm vi đã được người dùng đồng ý: làm trên codex/vioo-office, chỉ Module Yêu cầu; giữ nguyên kết nối Quy trình hiện có, hoãn kết cấu thép. Không hồi tố các phiếu đã duyệt.

## Thiết kế sử dụng
- Quản trị mẫu bật “Chuyển sang Mua hàng sau duyệt”. Cấu hình nằm trong phiên bản mẫu; phiếu đang chạy giữ phiên bản đã gửi.
- Người đề xuất nhập bảng nhu cầu: tên/quy cách, đơn vị, số lượng, kho nhận, ngày cần, vật tư hay tài sản, người dự kiến nhận. Được duyệt toàn bộ số lượng; muốn sửa thì trả lại người lập trước khi duyệt.
- Mua hàng nhận đúng bảng đã duyệt, chọn hàng trong danh mục và nhà cung cấp, lập PO theo từng kho. Không yêu cầu người đề xuất hiểu mã hàng. Mỗi dòng truy vết về phiếu và phiên bản, khóa chống đặt vượt và bấm lặp.
- Nhận hàng theo quy trình PO hiện có. Tài sản hình thành theo số lượng thực nhận, chưa gán người giữ trước khi xác nhận bàn giao. Phân biệt tài sản quản lý với phân loại tài sản cố định kế toán.
- Tồn tài sản là sổ theo dõi chi tiết; không tạo thêm phiếu nhập hoặc bút toán giá trị lần hai. Cấp phát phải làm giảm lượng sẵn sàng cấp và lưu lịch sử.

## Các bước triển khai và bằng chứng
1. [x] Bảng chuẩn, công tắc phiên bản, kiểm tra dữ liệu phía máy chủ; UI mobile dùng từng dòng mở rộng.
2. [x] Tiếp nhận chuẩn, PO liên kết nguồn, giới hạn số lượng và bảo vệ chỉnh sửa/thu hồi.
3. [x] Nhận thực tế → ghi nhận tài sản → xác nhận cấp phát; truy vết xuyên suốt.
4. [x] Unit, typecheck, build; kiểm thử Cloud trong transaction rollback: quyền, lặp, thiếu dữ liệu, đặt/nhận từng phần.
5. [ ] Walkthrough desktop/tablet/mobile, tự review diff; chỉ apply migration đã kiểm chứng, push/PR/merge và kiểm tra production.
