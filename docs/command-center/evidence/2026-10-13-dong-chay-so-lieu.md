# Số liệu thật đọc ngày 13/10/2026 cho ý tưởng "Dòng chảy công việc"

Đọc **chỉ đọc** từ Supabase Cloud production (`ftciqmqhmfvjtwoycswe`) qua Management API (`read_only: true`), lúc 04:30 UTC (11:30 Hà Nội). Không ghi gì vào production. Các truy vấn gom nhóm, không kéo bản ghi cá nhân.

## 1. Cơ cấu

| Chỉ số | Giá trị |
|---|---|
| Đơn vị tổ chức đang hoạt động (`org_units`) | 23, trong đó 17 phòng ban; loại: company, department, factory, construction_site, custom |
| Nhân viên đang làm việc (`employees`) | 87 |
| Nhân viên **chưa gắn `org_unit_id`** | **44 / 87** |
| Tài khoản đang hoạt động (`users`) | 88 |
| Dự án `status = 'active'` | 4 |

Nhân viên theo phòng: Quản lý dự án 10 · Hành chính - Nhân sự 8 · Tài chính - Kế toán 5 · Ban lãnh đạo 5 · Văn phòng nhà máy 5 · Thiết kế - Đấu thầu 3 · Vật tư - Thiết bị 3 · Thư ký - Trợ lý 2 · Tiến Thịnh Group 1 · Công trường Xinhai 1 · chưa gắn 44.

## 2. Lượt giao bước xử lý (`workflow_step_assignments`), 90 ngày gần nhất

| Trạng thái | Lượt | Giờ trung bình (giao → xử lý) | Giờ trung vị |
|---|---|---|---|
| APPROVED | 282 | 56,5 | 19,5 |
| PENDING | 28 | — | 92,3 (đang chờ, tính tới hôm nay) |
| SKIPPED | 22 | 114,9 | 49,1 |
| CANCELLED | 17 | 30,8 | 0,1 |
| RETURNED | 12 | 16,6 | 18,3 |
| REJECTED | 5 | 124,3 | 0,9 |

Có `sla_hours` + `due_at`: 265 / 366 lượt (72%). Phiếu bị trả lại ít nhất 1 lần: 11; trả 2 lần trở lên: 1.

Lượt giao theo ngày 13/09 → 12/10 (30 ngày, 176 lượt): 1 6 0 0 0 4 1 1 3 8 8 4 7 12 3 5 7 9 8 0 1 4 5 12 12 12 17 7 1 18.

### Phòng của người giao → phòng của người nhận (20 cặp lớn nhất, 363 / 366 lượt)

| Từ | Đến | Lượt |
|---|---|---|
| Quản lý dự án | Quản lý dự án | 155 |
| Quản lý dự án | Vật tư - Thiết bị | 60 |
| Hành chính - Nhân sự | Hành chính - Nhân sự | 26 |
| Quản lý dự án | (chưa gắn phòng) | 24 |
| Hành chính - Nhân sự | Ban lãnh đạo | 15 |
| (chưa gắn phòng) | Quản lý dự án | 15 |
| Quản lý dự án | Hành chính - Nhân sự | 15 |
| (chưa gắn phòng) | Vật tư - Thiết bị | 14 |
| (chưa gắn phòng) | Hành chính - Nhân sự | 8 |
| Hành chính - Nhân sự | Quản lý dự án | 7 |
| (chưa gắn phòng) | Ban lãnh đạo | 7 |
| Vật tư - Thiết bị | Vật tư - Thiết bị | 6 |
| Quản lý dự án | Ban lãnh đạo | 2 |
| Vật tư - Thiết bị | Quản lý dự án | 2 |
| Hành chính - Nhân sự | Vật tư - Thiết bị | 2 |
| Vật tư - Thiết bị | (chưa gắn phòng) | 1 |
| Hành chính - Nhân sự | (chưa gắn phòng) | 1 |
| Tài chính - Kế toán | Quản lý dự án | 1 |
| Ban lãnh đạo | Ban lãnh đạo | 1 |
| Hành chính - Nhân sự | Văn phòng nhà máy | 1 |

## 3. Đang chờ hôm nay (mọi thời điểm phát sinh, `status = 'PENDING'`)

Tổng 42. Tuổi: dưới 1 ngày 11 · 3–7 ngày 7 · 7–30 ngày 3 · **trên 30 ngày 21**.

| Phòng của người nhận | Đang chờ | Đứng yên > 3 ngày | Quá hạn `due_at` |
|---|---|---|---|
| Vật tư - Thiết bị | 13 | 5 | 5 |
| Quản lý dự án | 11 | 8 | 2 |
| Ban lãnh đạo | 7 | 7 | 1 |
| Hành chính - Nhân sự | 6 | 6 | 6 |
| (chưa gắn phòng) | 3 | 3 | 0 |
| Tài chính - Kế toán | 1 | 1 | 0 |
| Văn phòng nhà máy | 1 | 1 | 0 |

Theo người nhận (10 người nhiều nhất): Nguyễn Văn Luật 6 (cũ nhất 16/06) · Bùi Thuỳ Linh 6 (16/06) · Admin Hoàng 6 (04/06) · Dương Xuân Thịnh 5 (07/09) · Bùi Quang Chung 5 (08/10) · Đặng Thị Thu Hà 2 (12/10) · Nguyễn Quang Thuận 2 (08/07) · Nguyễn Thành Đô 2 (12/10) · Hoàng Công Minh 1 (09/10) · Đoàn Văn Dương 1 (01/10).

Theo mẫu quy trình: Quy trình cấp vật tư công trường 30 · (riêng SMB-2026) 6 · [Request] Đề xuất trực tiếp 3 · [Request] Đề xuất phê duyệt hồ sơ phòng HCNS 3.

## 4. Người xử lý 90 ngày (đã xử lý xong, từ 5 lượt)

| Người | Lượt | Trung vị giờ | Trung bình giờ |
|---|---|---|---|
| Nguyễn Phương Thảo | 6 | 0,1 | 1,4 |
| Phạm Ngọc Sơn | 45 | 0,6 | 19,2 |
| Nguyễn Văn Năm | 43 | 1,3 | 7,0 |
| Nguyễn Thị Giang | 28 | 4,6 | 60,2 |
| Nguyễn Thành Đô | 73 | 20,3 | 25,5 |
| Nguyễn Thị Mơ | 17 | 50,2 | 142,3 |
| Phạm Đức Thiện | 23 | 51,1 | 105,8 |
| Đặng Thị Hương | 16 | 53,8 | 103,0 |
| Đặng Thị Thu Hà | 10 | 65,0 | 61,7 |
| Bùi Quang Chung | 35 | 65,3 | 108,6 |
| Bùi Thuỳ Linh | 27 | 89,6 | 138,0 |

Người tạo phiếu quy trình nhiều nhất 90 ngày: Nguyễn Văn Luật 45 (QLDA) · Nguyễn Phương Thảo 26 (QLDA) · Nguyễn Hồng Quân 17 (VP nhà máy) · Admin Hoàng 11 (HCNS) · Nguyễn Thị Thu Hà 11 (chưa gắn) · Đoàn Văn Dương 11 (chưa gắn) · Lưu Công Danh 9 · Đặng Thị Hương 7 · Nguyễn Thành Đô 6 · Trần Thị Tươi 6.

## 5. Các nguồn khác (phiếu tạo trong 90 ngày, theo trạng thái)

| Nguồn | Trạng thái |
|---|---|
| `request_instances` (Đề xuất) | APPROVED 24 · CANCELLED 6 · PENDING 5 · REJECTED 1 |
| `requests` (Đề xuất vật tư) | APPROVED 48 · PENDING 15 · DRAFT 8 · COMPLETED 8 · REJECTED 4 · IN_TRANSIT 2 |
| `purchase_orders` | sent 32 · confirmed 25 · delivered 23 · draft 8 · partial 7 · in_transit 6 |
| `transactions` (phiếu kho) | COMPLETED 212 · CANCELLED 40 · PENDING 23 · APPROVED 1 |
| `daily_logs` | draft 154 · verified 114 · submitted 6 · rejected 4 |
| `workflow_instances` | COMPLETED 100 · RUNNING 51 · CANCELLED 13 · REJECTED 9 · DRAFT 1 |
| `hrm_leave_requests` | approved 6 · pending 4 · rejected 1 |
| `hrm_site_assignments` | approved 19 · awaiting_office 1 |
| `office_documents` | PENDING_APPROVAL 2 · ARCHIVED 2 · REVOKED 2 · APPROVED 1 · DRAFT 1 |
| `vehicle_bookings` | DRAFT 3 · CANCELLED 2 · COMPLETED 1 |
| `work_tasks` (Vioo Work) | completed 3 |
| `wms_inventory_counts` | counting 1 |
| `procurement_receipt_reconciliations` | voided 1 |
| `finance_payment_requests` | không có phiếu trong 90 ngày |

Đề xuất vật tư đang mở theo dự án (`requests` PENDING / APPROVED / IN_TRANSIT, số ngày trung bình từ khi tạo): Sơn Miền Bắc APPROVED 30 (53,5 ngày) · PENDING 4 (6,9) · IN_TRANSIT 3 (96,6); Nhà máy thú nhồi bông GĐ2 APPROVED 21 (37,8) · PENDING 8 (10,1); G3 BOQ project PENDING 3 · IN_TRANSIT 1 · APPROVED 1 (20,6).

## 6. Dòng thông tin (`notifications`, `audit_trail`)

| Chỉ số | Giá trị |
|---|---|
| Thông báo 30 ngày | 3.749 (tổng bảng 8.861) |
| Theo module 30 ngày | **không có module 2.497** · WF 925 · OFFICE 296 · HRM 20 · DA 9 · VEHICLE_BOOKING 2 |
| Chưa đọc 30 ngày | 3.170 (85%) |
| Chưa đọc quá 7 ngày | 1.111, ở 34 người |
| `audit_trail` 30 ngày theo module | TC 699 · HRM 142 · WF 127 · OFFICE 105 · DA 47 · SETTINGS 46 · PROJECT 29 · CENTER 28 · WMS 19 · quality 17 · TS 3 · VEHICLE_BOOKING 2 · REQUEST 1 (tổng bảng 4.381) |
| Nhật ký 30 ngày | `workflow_instance_logs` 349 · `material_request_events` 181 · `request_logs` 0 |

## 7. Điều rút ra cho thiết kế

1. Dữ liệu "ai giao cho ai, lúc nào, xong lúc nào" đã có sẵn và sạch nhất ở `workflow_step_assignments` (có `assigned_by`, `assignee_user_id`, `assigned_at`, `acted_at`, `due_at`, `sla_hours`). Đây là nguồn đợt 0.
2. 44 / 87 nhân viên chưa gắn phòng → 12% lượt giao không biết "phòng nào". Sơ đồ phải hiện rõ ô "Chưa gắn phòng ban" như lỗ hổng, không giấu.
3. 21 / 42 việc chờ đã quá 30 ngày (từ tháng 6) → cần thao tác "dọn việc cũ" có lý do, nếu không sơ đồ sẽ đỏ mãi.
4. Thông báo không gắn module ở 66% bản ghi → thống kê "thông tin gửi đi" phải suy từ `source_type` / `entity_type`, hoặc sửa nơi phát thông báo.
5. Vioo Work gần như chưa dùng (3 việc / 90 ngày); dòng "giao việc tự do" sẽ trống trên sơ đồ cho đến khi dùng thật.
