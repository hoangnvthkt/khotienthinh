# Thiết kế Danh mục dùng chung HRM, sơ đồ tổ chức và slot biên chế

Ngày: 2026-08-18

## 1. Mục tiêu

Hợp nhất dữ liệu gốc HRM và sơ đồ tổ chức thành một khu vực quản trị duy nhất. Cơ cấu tổ chức được dựng bằng đơn vị và slot vị trí; nhân viên được phân công vào slot thay vì trở thành cấu trúc của sơ đồ.

## 2. Phạm vi phát hành đầu tiên

- Chuẩn hóa danh mục HRM từ `Data Nguồn.xlsx` theo các quyết định đã chốt.
- Gộp hai khu vực `Dữ liệu gốc HRM` và `Sơ đồ tổ chức` thành `Danh mục dùng chung HRM`.
- Tạo cây `Tiến Thịnh Group -> K1/K2/K3 -> phòng/tổ`.
- Quản lý slot vị trí, quan hệ báo cáo giữa slot, slot quản lý đơn vị và trạng thái trống/có người.
- Phân công chính, kiêm nhiệm hoặc quyền quản lý tạm thời của nhân viên vào slot, có thời gian hiệu lực.
- Nhập tay phụ cấp ăn ca, thâm niên và thu hút theo nhân viên, thành phần lương và thời gian hiệu lực.
- Phân giải quản lý trực tiếp từ slot cho các phiếu gửi mới, giữ fallback `users.manager_id` trong giai đoạn chuyển tiếp.

Ngoài phạm vi: tính P3, đánh giá năng lực cá nhân, tự động tính ba khoản phụ cấp nhập tay và thay đổi lương thực nhận.

## 3. Quy tắc dữ liệu nguồn

- Hợp đồng `36T` chỉ có một bản ghi.
- Thêm nhóm vị trí `CG` với tên `Chuyên gia`.
- `suggested_org_unit_code` không khớp đơn vị hiện hữu được đặt `NULL`.
- Không sử dụng `salary_range` trong form hoặc tính toán.
- Mã level nghiệp vụ là `E1` đến `E11`; dữ liệu `L1` đến `L11` hiện tại được đổi đồng bộ.
- `K4` và đơn vị `VPHN` được ngừng hoạt động; `C6` được ngừng hoạt động.
- Chỉ `C1` đến `C5` là cấp năng lực chính thức.
- Ba khoản ăn ca, thâm niên, thu hút dùng số tiền nhập tay.
- P3 hiện tại không phải nguồn chính thức và không bị thay đổi trong phát hành này.

## 4. Mô hình dữ liệu

### `hrm_org_position_slots`

Một ghế biên chế cụ thể trong đơn vị. Trường chính: `code`, `org_unit_id`, `position_id`, `level_code`, `reports_to_slot_id`, `slot_type`, `status`, thời gian hiệu lực và thứ tự hiển thị. Trạng thái có người được suy ra từ phân công, không lưu lặp trên slot.

### `hrm_employee_slot_assignments`

Quan hệ có hiệu lực giữa nhân viên và slot. Mỗi nhân viên có tối đa một phân công `PRIMARY` đang hoạt động; mỗi slot có tối đa một người giữ chính hoặc giữ tạm đang hoạt động. `SECONDARY` dùng cho kiêm nhiệm.

### `hrm_employee_manual_allowances`

Khoản phụ cấp nhập tay theo nhân viên và `hrm_payroll_components`. Mỗi bản ghi có số tiền, ngày hiệu lực, ghi chú và trạng thái; không sinh công thức.

### `org_units.manager_slot_id`

Slot đứng đầu đơn vị. Slot phải thuộc chính đơn vị đó. Các slot thường mặc định báo cáo cho slot này; slot quản lý đơn vị có thể báo cáo cho slot quản lý ở đơn vị cha.

## 5. Ràng buộc

- Không cho slot báo cáo cho chính nó hoặc tạo chu trình báo cáo.
- Không cho `parent_id` của đơn vị tạo chu trình.
- Không xóa cứng slot, phân công hoặc danh mục đã được sử dụng; chuyển sang `ARCHIVED`/`ENDED`/`is_active = false`.
- Người quản lý phục vụ duyệt phải có hồ sơ nhân viên, tài khoản liên kết và tài khoản đang hoạt động.
- Khi gửi phiếu, người duyệt được snapshot; thay đổi slot sau đó không đổi phiếu đang chạy.
- Mọi bảng mới ở schema `public` bật RLS. Chỉ Admin hoặc HRM module admin được ghi; người dùng đã xác thực được đọc.

## 6. Giao diện

`Cài đặt -> Danh mục dùng chung HRM` có năm tab:

1. Tổng quan: số đơn vị, slot, slot trống, nhân sự chưa có slot và đơn vị thiếu quản lý.
2. Sơ đồ tổ chức: cây đơn vị, slot quản lý và danh sách slot/thành viên.
3. Slot & phân bổ: tạo nhiều slot, sửa quan hệ báo cáo, phân công/chuyển nhân sự.
4. Danh mục HRM: trạng thái, hợp đồng, nhóm vị trí, level, vị trí, năng lực, trình độ, BHXH.
5. Phụ cấp nhập tay: nhân viên, khoản phụ cấp, số tiền và hiệu lực.

Mọi form có label trên input, lỗi dưới input, trạng thái loading/empty/error và nút lưu không được gửi lặp.

## 7. Chuyển đổi dữ liệu

- Tạo hoặc cập nhật ba node K1–K3 dưới node công ty; gán các phòng/tổ theo `block_code`.
- Không xóa văn phòng Hưng Yên hiện hữu; giữ như node địa điểm độc lập để tránh mất liên kết.
- Ngừng hoạt động K4, VPHN và C6 sau khi kiểm tra không có liên kết hoạt động.
- Đổi đồng bộ `hrm_position_levels.code` và `hrm_positions.level_code` từ L sang E.
- Tạo slot nền cho từng nhân viên đang làm việc có đơn vị và vị trí; mã slot sinh ổn định theo mã đơn vị, mã vị trí và số thứ tự.
- Tạo phân công chính vào các slot nền. Không tự suy đoán ai là quản lý đơn vị.

## 8. Tiêu chí nghiệm thu

- Có thể quản trị tất cả danh mục nguồn đã chốt mà không dùng màn hình cũ.
- Sơ đồ chỉ có K1–K3 trong danh mục khối hoạt động và các phòng/tổ nằm đúng khối.
- Có thể tạo slot trống, phân công nhân viên, kết thúc phân công và chỉ định slot quản lý.
- Dashboard chỉ ra dữ liệu thiếu thay vì âm thầm tự gán quản lý.
- Resolver quản lý ưu tiên slot, chống tự duyệt và fallback dữ liệu cũ trong giai đoạn chuyển tiếp.
- Migration contract test, Cloud smoke test, unit test, TypeScript và production build đều đạt.
