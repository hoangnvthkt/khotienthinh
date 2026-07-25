# Sửa lỗi tạo phiếu xuất cấp thi công

## Mục tiêu

Khôi phục luồng tạo và gửi kho duyệt cho thủ kho được phân công, đồng thời bảo đảm phiếu mới hiển thị ngay bảng trạng thái chi tiết mà không mở rộng quyền cập nhật trực tiếp bảng `material_issue_orders`.

## Phạm vi

- Sửa RPC `create_material_issue_order` để nhận và lưu `recipient_source_type` cùng `recipient_source_id` trong cùng thao tác tạo phiếu.
- Bỏ thao tác `UPDATE material_issue_orders` trực tiếp từ frontend sau khi RPC tạo phiếu trả về.
- Sau khi tạo và gửi thành công, tải lại danh sách và tự mở rộng phiếu vừa tạo để người dùng thấy bảng trạng thái.
- Thêm kiểm thử hồi quy cho payload tạo phiếu và quyền thực thi của vai trò `authenticated`/thủ kho.
- Áp dụng migration lên Supabase production đã liên kết và kiểm chứng bằng truy vấn mô phỏng phiên Nguyễn Văn Luật.

Không cấp `UPDATE` trực tiếp trên `material_issue_orders` cho vai trò `authenticated`. Không huỷ hoặc xoá năm phiếu nháp đã phát sinh ngày 25/07/2026.

## Thiết kế

### Backend

Giữ nguyên RPC hiện có và bổ sung hai tham số tùy chọn:

- `p_recipient_source_type text default null`
- `p_recipient_source_id text default null`

RPC kiểm tra `p_recipient_source_type` chỉ nhận `supplier_contract`, `business_partner` hoặc `null`. Hai giá trị được ghi ngay trong câu `INSERT` tạo `material_issue_orders`, nên không cần quyền `UPDATE` từ client và không có khoảng hở giữa lúc tạo phiếu với lúc lưu nguồn bên nhận.

Migration cập nhật chữ ký hàm, thu hồi quyền thực thi đối với chữ ký cũ nếu còn tồn tại, và chỉ cấp `EXECUTE` chữ ký mới cho `authenticated`. RLS và quyền bảng hiện tại được giữ nguyên.

### Frontend/service

`materialIssueService.createDraft` truyền hai tham số mới vào RPC và xóa câu lệnh cập nhật trực tiếp bảng. `createAndSubmit` tiếp tục tạo nháp rồi gọi RPC gửi duyệt với ngày chứng từ như hiện tại.

Sau khi `createAndSubmit` thành công, `MaterialIssuePanel` thêm ID phiếu mới vào `expandedOrderIds` trước khi/đồng thời tải lại danh sách. Phiếu mới vì vậy hiện trạng thái và bảng chi tiết ngay trong phiên thao tác.

### Xử lý lỗi

Nếu RPC tạo phiếu thất bại, không có bản ghi nào được tạo. Nếu bước gửi duyệt thất bại sau khi tạo nháp, phiếu nháp vẫn được giữ theo hành vi hiện hành để có thể kiểm tra hoặc xử lý tiếp; giao diện tải lại danh sách trong nhánh lỗi để không che giấu bản ghi đã phát sinh.

Thông báo lỗi tiếp tục đi qua `getApiErrorMessage`; lỗi quyền phải hiển thị thông báo quyền thay vì mô tả chung.

## Kiểm thử và xác minh

1. Kiểm thử service xác nhận payload RPC chứa đủ hai trường nguồn và không gọi `from(...).update(...)`.
2. Kiểm thử helper/UI state xác nhận phiếu vừa tạo được đánh dấu mở rộng.
3. Chạy bộ kiểm thử liên quan, kiểm tra kiểu TypeScript và build production.
4. Áp dụng migration lên production.
5. Trong transaction chỉ đọc, mô phỏng JWT Nguyễn Văn Luật và xác nhận:
   - tài khoản xem được phiếu Kho Sơn Miền Bắc;
   - `authenticated` vẫn không có quyền `UPDATE` bảng;
   - chữ ký RPC mới có quyền `EXECUTE`;
   - RPC nhận hai tham số nguồn theo schema cache.
6. Không tạo phiếu nghiệp vụ thử trên production và không thay đổi năm phiếu nháp cũ.

## Tiêu chí hoàn tất

- Nguyễn Văn Luật có thể tạo và gửi phiếu từ Kho Sơn Miền Bắc mà không gặp lỗi quyền ở bước lưu nguồn bên nhận.
- Phiếu thành công có giao dịch WMS và trạng thái chờ kho duyệt.
- Phiếu mới tự mở rộng để hiện bảng trạng thái.
- Vai trò `authenticated` vẫn chỉ có `SELECT` trên `material_issue_orders`, không có `UPDATE`.
- Migration, kiểm thử, typecheck và build đều hoàn tất không lỗi.
