# Module Mua hàng — trung tâm tiếp nhận và xử lý mọi nhu cầu mua (thiết kế, 30/09/2026)

## Yêu cầu chủ sản phẩm
Mua hàng là nơi dành riêng để tiếp nhận đề xuất mua từ mọi nguồn — kế hoạch vật tư, đề xuất vật tư trực tiếp của công trường, về sau module Đề xuất, module Quy trình… Dạng dashboard: chọn nguồn đề xuất → tạo đơn hàng → mua → theo dõi, cập nhật đơn cho tới khi nhập kho.

## Quyết định đã chốt (30/09)
1. **PO chỉ tạo ở Mua hàng.** Tab Vật tư → Đơn hàng PO của dự án chỉ còn xem/theo dõi và xác nhận nhận hàng.
2. **Người dùng: phòng Mua hàng/Cung ứng công ty**, xử lý mọi dự án; mỗi phiếu nhu cầu có một người phụ trách; dự án chỉ xem tiến độ.
3. **Thay giao diện `/procurement` hiện tại bằng giao diện mới, giữ backend** (PO, đợt giao, nhận hàng, kiểm tra chất lượng, trả hàng NCC, duyệt bổ sung giá).

## Luồng 5 bước (tab kèm số việc)
1. Tiếp nhận — phiếu nhu cầu đã duyệt từ mọi nguồn, lọc theo nguồn, nhóm theo dự án, ngày cần/mức gấp, tiến độ đã đặt/cần, người phụ trách.
2. Đơn hàng — chọn nhiều phiếu (khác nguồn được), gom theo vật tư + NCC thành PO; dòng PO giữ liên kết dòng nhu cầu gốc.
3. Đã đặt NCC — chờ giao.
4. Đang giao — đợt giao, cảnh báo trễ.
5. Nhập kho — công trường xác nhận nhận hàng; nhu cầu gốc tự cập nhật "đã về".
Cộng tab Tổng quan (theo NCC, theo dự án).

## Hiện trạng (audit 30/09)
- Mua hàng chỉ nhận nguồn `project_material_request` (80) và `purchase_order` (61); PO SMB/DA29 đang tạo trong tab Vật tư dự án (`from_request`, `proactive_project`).
- Màn `/procurement` (Codex): danh sách theo từng dòng vật tư, hiện mã kho thô, 48 dòng "Cần đối chiếu"/"Chưa xác định", không ngày cần, không người phụ trách, lẫn dữ liệu test G3.

## Thứ tự làm
- M1 Tiếp nhận: read model gom nguồn (Đề xuất vật tư đã duyệt + KH vật tư đã duyệt — nguồn mới), phân công người phụ trách, giao diện mới thay `/procurement`.
- M2 Tạo đơn hàng từ nhiều phiếu (dùng lại lệnh PO sẵn có), khóa tạo PO ở tab dự án.
- M3 Theo dõi giao hàng và nhập kho.
- M4 Tổng quan.
