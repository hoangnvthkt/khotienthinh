# Yêu cầu → Mua hàng → Tài sản

## Vận hành
1. Quản trị Yêu cầu mở mẫu, chọn **Kết nối đầu ra**, bật **Chuyển sang Mua hàng sau duyệt**, lưu và xuất bản.
2. Người lập nhập bảng chuẩn: tên/quy cách, đơn vị, số lượng, kho nhận, ngày cần, loại hàng. Tài sản cần nhóm tài sản; người dự kiến nhận có thể để trống.
3. Duyệt cuối chuyển bảng sang Mua hàng, nguồn Module Đề xuất. Muốn thay số lượng trước duyệt thì trả lại phiếu cho người lập sửa.
4. Người mua mở dòng, chọn hàng danh mục cùng đơn vị, NCC, giá và VAT. Đơn nháp được tạo theo từng dòng, kho và ngày lấy từ phiếu. Gửi người khác duyệt theo quy trình Mua hàng hiện tại.
5. Lập từng đợt giao và xác nhận số thực nhận. Vật tư vào tồn vật tư; tài sản tạo từng hồ sơ và vị trí kho riêng. Không ghi nhập/tồn vật tư lần hai cho tài sản.
6. Từ dòng nguồn, mở mã tài sản để đến **Tài sản → Cấp phát**, chọn người nhận và xác nhận bàn giao. Thu hồi và luân chuyển người giữ dùng cùng màn hình.

## Phạm vi và giới hạn
- Chỉ phiếu mới dùng phiên bản đã bật kết nối. Không backfill RQ-2026-000052 hoặc phiếu đã duyệt cũ. Phiếu đang duyệt giữ cấu hình phiên bản lúc gửi.
- Kết nối Quy trình hiện có giữ nguyên; mở rộng Quy trình và kết cấu thép chưa triển khai trong phần này.
- Mỗi đơn tạo từ một dòng nhu cầu. Đơn được nhận nhiều đợt; không gom nhiều dòng hoặc nhiều phiếu trong đợt triển khai này.
- Tài sản được quản lý theo từng chiếc; tối đa 200 chiếc/dòng, không tự kết luận là tài sản cố định kế toán. Bộ phận Tài sản bổ sung serial, bảo hành và thông tin kế toán.
- Sổ tài sản là sổ chi tiết theo dõi quyền giữ; AP/chi phí vẫn qua quy trình receipt hiện có, không tạo bút toán nhận hàng thứ hai. Phân loại/khấu hao kế toán không tự động hóa ở đây.
- Trả nhà cung cấp bằng phiếu vật tư và chuyển tồn hàng loạt bị chặn đối với tài sản từ nguồn này để tránh sai sổ; xử lý trả NCC theo hồ sơ tài sản cần triển khai riêng.
- Giữ nguyên hệ thống phân quyền: Mua hàng không tự có quyền cấp phát. Người thực hiện cần `asset.assignment.assign`, `asset.assignment.return` hoặc `asset.assignment.transfer` tương ứng, đúng phạm vi.
- Bật kết nối không thay đổi quyền, không tự duyệt, không tự tạo phiếu thật hoặc cấp tài sản cho người dùng.

## Kiểm chứng
Kiểm thử Cloud bằng transaction rollback, dùng phiếu tổng hợp và các lệnh duyệt/nhận/cấp phát thực tế. Không duyệt hoặc thay đổi phiếu kinh doanh đang có. Bằng chứng: `evidence/request-assets-validation.json`; SQL: `supabase/tests/request_purchase_assets_smoke.sql`. Mobile/tablet/desktop: `tests/e2e/request-assets.spec.ts`.
