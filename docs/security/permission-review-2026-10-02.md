# Rà soát phân quyền toàn hệ thống — 02/10/2026

**Lý do:** chủ sản phẩm gặp lỗi: người được cấp đủ quyền Hợp đồng vẫn không tạo được hợp đồng đối tác; đã cấp Admin vẫn không tạo được HĐ thầu phụ. Chủ sản phẩm chưa yên tâm các mẫu quyền hoạt động đúng thực tế.
**Phạm vi:** chỉ ghi số đếm, không ghi dữ liệu cá nhân. Mọi kiểm tra trên Cloud chạy trong giao dịch kết thúc bằng rollback.

## 1. Cách rà

1. **Lệch mã quyền máy chủ ↔ giao diện:** liệt kê mọi bảng có quyền ghi chỉ dựa vào `is_admin()` hoặc "quản trị module" cũ (`is_module_admin(...)`) — **50 bảng** — rồi đối chiếu với mã quyền mà nút trên giao diện và mẫu quyền đang dùng.
2. **Mã quyền cấp được nhưng không nơi nào kiểm tra:** 56 mã thao tác (không phải "xem") có trạng thái khác `enforced`; lọc ra mã đang có người giữ hoặc nằm trong mẫu mà không hàm/policy nào kiểm tra.
3. **Mẫu vị trí:** gán từng mẫu cho một nhân viên thật (rollback), kiểm tra máy chủ công nhận từng dòng quyền (`supabase/tests/authorization_position_templates_resolve_smoke.sql`).
4. **Chạy lại toàn bộ smoke theo persona của các phân hệ** (206 file): 184 file có bọc rollback được chạy, 22 file không bọc rollback bị **loại** (một số tự xóa dữ liệu mẫu).

## 2. Kết quả chính

| Hạng mục | Kết quả |
|---|---|
| Mẫu vị trí | 14 mẫu, 652 dòng quyền: máy chủ công nhận **652/652** |
| Hợp đồng | **Lỗi thật, đã sửa** (mục 3.1) |
| Kiểm kê tài sản | **Lỗi thật, chưa sửa**: nút "Hoàn tất" không lưu xuống cơ sở dữ liệu (mục 4.1) |
| 2 mã dự án do Room quản lý | Cho cấp trực tiếp trái quy tắc P1.3; **đã sửa** (0 người giữ) |
| Đặt xe (bàn giao, chạy chuyến) | Đúng thiết kế: cấp theo **phân công** (người lái / người bàn giao được giao; người điều xe làm thay phải ghi lý do). Mã `booking.vehicle.handover`, `booking.vehicle.trip.execute` trong mẫu không có tác dụng |
| Tài sản (danh mục, cấp phát, bảo trì, chuyển kho) | Máy chủ kiểm tra theo từng quyền chi tiết. Mã `asset.catalog.manage`, `asset.maintenance.manage` không có tác dụng (vô hại) |
| Danh mục Phiếu yêu cầu | Bảng `request_categories` không còn được dùng; mã `request.category.manage` không có tác dụng |
| Smoke phân hệ | 99 đạt, 85 lỗi, 22 bỏ qua; đã phân loại (mục 5) |

## 3. Đã sửa

### 3.1 Hợp đồng (migration `20261004150000`, PR #52)
- Máy chủ: ghi đối tác / HĐ khách hàng / HĐ NCC / HĐ thầu phụ / bảo lãnh / mẫu HĐ / thư viện đơn giá theo đúng `contract.*.manage` (trước chỉ Admin hoặc `system.hd.manage` không ai giữ).
- Giao diện: nút Thêm/Sửa/Xóa/tải tệp chỉ hiện khi có quyền, người chỉ xem thấy lý do; form HĐ thầu phụ và HĐ NCC báo rõ trường còn thiếu (trước thoát im lặng — nguyên nhân "bấm tạo mà không thêm được").

### 3.2 Mã dự án Room (migration `20261004160000`)
`project.daily_log.publish_progress`, `project.payment.view_resource_evidence` không còn cấp trực tiếp được (quyền dự án đi qua Room).

## 4. Việc mở

### 4.1 Kiểm kê tài sản không lưu (lỗi chức năng)
`pages/ts/AssetAudit.tsx`: "Hoàn tất" chờ 0,8 giây, giữ phiên trong bộ nhớ trang và báo "Dữ liệu đã được lưu"; tải lại trang là mất. Cần bảng lưu + RLS theo `asset.audit.perform` / `asset.audit.view`. Đã tách thành việc riêng.

### 4.2 `system.da.manage` — cần chủ sản phẩm quyết
- 37 người không phải Admin đang giữ (27 từ bước chuyển dữ liệu legacy 10/09: "quản trị module DA" cũ đổi thành quyền mới). Trái quyết định 3 ("DA: bỏ hết").
- Máy chủ không dùng mã này, nhưng **Ma trận duyệt** (duyệt thanh toán, phát sinh, nghiệm thu) ở giao diện tính người giữ mã là người được duyệt theo 4 quy tắc "quản trị Dự án". Thu hồi sẽ đổi quyền duyệt theo ma trận của 37 người.

### 4.3 Mã "nhãn" không có tác dụng
`asset.catalog.manage`, `asset.maintenance.manage`, `request.category.manage`, `booking.vehicle.handover`, `booking.vehicle.trip.execute`, `asset.audit.*` (đến khi 4.1 xong). Đề xuất: ẩn khỏi màn phân quyền và mẫu, hoặc gắn chú thích "theo phân công".

### 4.4 Bảng Admin-only thuộc luồng khác (chỉ ghi nhận)
Trigger chỉ Admin trên `acceptance_records`, `boq_reconciliation_*`, `custom_material_*` (Dự án V2 / Mua hàng V2); tài chính dự án (`project_cost_items`, `project_cost_actuals`, `cash_*`), KPI, `units`, `categories`, `approval_rules` ghi chỉ Admin — đúng quyết định 4 ("chỉ Admin ghi tạm ứng, hạng mục chi phí, snapshot") với phần tài chính; phần còn lại cần xác nhận ai được sửa.

## 5. Phân loại smoke lỗi

| Nhóm | Số lượng (ước) | Ý nghĩa |
|---|---|---|
| "Legacy permission writes are disabled" | ~20 | Smoke cũ ghi cột legacy — nay bị chặn có chủ đích |
| Pilot ERP / tạo PO đã chuyển sang Mua hàng | ~7 | Lệnh cũ bị tắt có chủ đích |
| Thiếu dữ liệu mẫu / khoá ngoại tới dữ liệu đã xoá (Nhật ký, Mua hàng, Phiếu YC...) | ~25 | Cần dựng lại fixture (luồng tương ứng) |
| Số cố định đã đổi (14 Room, 384 quyền, số module) | ~6 | Smoke cũ; đã sửa 384 |
| Hết thời gian chờ (524 / statement timeout) | 3 | Không phải lỗi quyền |
| Smoke chọn người mẫu đã có vai trò mới (Admin có HR Manage; người duyệt cũng là người theo dõi) | 4 | **Không phải lỗi**; đã sửa fixture |
| Đã sửa trong đợt này | 5 | E27, E30, thông báo Phiếu YC, retired-rooms, P1.3 |

Các smoke em đã sửa fixture: `authorization_v2_task12_4_2_e27_runtime`, `authorization_v2_task12_4_2_warehouse_operator_pilot`, `notification_event_recipients_request_safety`, `authorization_v2_retired_view_only_rooms`, `hrm_manager_scope_readiness`, `hrm_personnel_import_export`, `hrm_workforce_planning` (3 smoke HRM: kiểm tra "Admin kỹ thuật bị chặn" nay đạt; bước sau cần một Admin có quyền quản lý vai trò mà không giữ HR — dữ liệu hiện chưa có).

Gửi luồng Phiếu yêu cầu xem: `request_approval_phase1` báo `REQUEST_ACTION_FORBIDDEN`.
