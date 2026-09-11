# Mô hình vận hành Phân quyền V2

Tài liệu này mô tả cơ chế phân quyền đang có hiệu lực sau Phase 5/6. Bốn trường cũ `allowed_modules`, `allowed_sub_modules`, `admin_modules`, `admin_sub_modules` không còn tham gia quyết định cho phép/từ chối và đã bị khóa ghi. Chúng chỉ được giữ tạm làm bằng chứng rollback cho tới Task 13.

## 1. Đơn vị cấp quyền

Hệ thống không còn cấp một quyền mơ hồ kiểu “được xem module/submodule”. Một quyền hiệu lực có ba thành phần:

`capability + scope + source`

- **Capability** là mã thao tác cụ thể, ví dụ `hrm.attendance.view`, `hrm.attendance.edit`, `project.payment.approve`.
- **Scope** là phạm vi dữ liệu mà thao tác được phép áp dụng: `global`, `own`, `assigned`, `project`, `construction_site`, `warehouse`, `department`, `direct_reports`, `org_unit`, hoặc `work_workspace`.
- **Source** giải thích quyền đến từ đâu: cấp trực tiếp (`DIRECT`), template/vai trò nghiệp vụ (`ROLE`), thành viên và action của Room dự án (`ROOM`), hoặc thành viên Workspace (`WORKSPACE_MEMBER`).

Vai trò tài khoản `ADMIN` là vai trò quản trị hệ thống, không phải wildcard mặc định cho mọi dữ liệu nghiệp vụ nhạy cảm. Ví dụ quyền payroll quản trị phải đến từ template `HR`/`HR_MANAGE`. Đây là chủ đích tách “quản trị hệ thống” khỏi “quản trị nghiệp vụ”.

## 2. Vì sao không còn checkbox View module/submodule

Module shell và menu được **suy ra** từ capability xem/truy cập đang có hiệu lực. Nếu người dùng có ít nhất một capability `view`, `view_*` hoặc `access` hợp lệ của module, giao diện liên quan mới xuất hiện. Vì vậy không cần và không nên cấp thêm một checkbox View module độc lập; làm như vậy sẽ tạo hai nguồn sự thật có thể lệch nhau.

Ví dụ:

- Có `hrm.attendance.view/own` thì thấy Chấm công nhưng chỉ thấy dữ liệu của mình.
- Có `hrm.attendance.view/global` từ HR thì thấy chấm công toàn công ty.
- Có `project.payment.view` ở scope dự án A thì thấy phần Thanh toán trong dự án A, không tự động thấy dự án B.
- Có Room action `payment/view` ở dự án A cũng mở đúng tab tương ứng trong dự án A.

Checkbox trong **Ma trận quyền mới** là checkbox của từng capability tại scope đang chọn, không phải checkbox bật/tắt module kiểu cũ.

## 3. Bốn luồng quản trị quyền

| Nhu cầu | Nơi quản trị | Kết quả |
|---|---|---|
| Quyền cá nhân ngoại lệ | Cài đặt → người dùng → Ma trận quyền mới | Tạo/thu hồi `DIRECT` grant theo capability và scope |
| Nghiệp vụ HR nhạy cảm | Panel Vai trò nghiệp vụ HR | Gán template `HR` hoặc `HR_MANAGE`; quyền kế thừa hiển thị khóa |
| Quy trình trong dự án | Tab Phân quyền của từng dự án | Gán thành viên và action cho từng Room, theo dự án/công trình |
| Công việc cộng tác | Thành viên Workspace | Suy quyền từ vai trò thành viên Workspace |

Khi sửa người dùng, phần **Quyền hiệu lực** là tổng hợp của mọi nguồn. Chỉ direct grant được sửa trong ma trận chung; quyền kế thừa từ role/Room/Workspace không được gỡ bằng cách bỏ chọn một ô direct.

Mọi thay đổi quyền quản trị phải có lý do. Các thao tác nhạy cảm dùng preview/validation, ghi audit và được áp dụng qua RPC giao dịch thay vì cập nhật rời rạc từ client.

## 4. Cách hệ thống ra quyết định

1. Xác thực JWT và ánh xạ đúng tài khoản ứng dụng đang hoạt động.
2. Đọc permission registry để xác nhận capability tồn tại và scope được hỗ trợ.
3. Tổng hợp các nguồn quyền hiệu lực; loại nguồn bị thu hồi, chưa đến hạn hoặc hết hạn.
4. So khớp scope. `global` bao phủ phạm vi con; quyền `own` chỉ bao phủ chủ thể gắn chính xác với user hiện tại; quyền dự án/công trình chỉ bao phủ ID tương ứng.
5. Frontend dùng cùng snapshot để ẩn/hiện route, tab và nút thao tác.
6. Database RLS hoặc RPC kiểm lại actor, capability và scope. Đây là lớp quyết định cuối cùng; ẩn nút ở frontend không được coi là biện pháp bảo mật dữ liệu.

Nguyên tắc mặc định là **deny**: permission không tồn tại, sai scope, nguồn hết hạn hoặc không có grant đều bị từ chối.

## 5. Quy tắc HRM hiện tại

- Check-in lấy hồ sơ theo liên kết chính xác `current user → employees.user_id`; không dùng email fallback.
- `Chấm công của tôi`: nhân viên có `hrm.attendance.view/own` chỉ thấy bản ghi của chính mình.
- HR/người vận hành có `hrm.attendance.view/global` thật sự được xem toàn công ty; quyền sửa/duyệt vẫn là capability riêng.
- Phiếu lương cá nhân chỉ trả payroll `confirmed`/`paid` của chính nhân viên hiện tại.
- Payroll quản trị chỉ mở cho nguồn role `HR`/`HR_MANAGE`; System Admin đơn thuần không tự động được đọc payroll.
- Check-in, chấm công, payroll cá nhân và payroll quản trị là các đường tải/ủy quyền độc lập; lỗi một đường không được làm mất dữ liệu của đường khác.

## 6. Quy tắc Room dự án hiện tại

Có 10 Room đang enforce: `daily_log`, `material_planning`, `material_request`, `material_po`, `gantt`, `weekly_progress`, `quantity_acceptance`, `payment`, `quality`, `safety`.

Mỗi Room có tập action riêng như `view`, `edit`, `delete`, `submit`, `verify`, `approve`, `confirm`; một số action có điều kiện bắt buộc hoặc prerequisite. Quyền Room luôn gắn với dự án và có thể gắn thêm công trình, nên cùng một người có thể có quyền khác nhau giữa hai dự án.

Bốn chức năng `material_waste`, `custom_material`, `boq_reconciliation`, `subcontract` đã được loại khỏi cơ chế Room. Người không phải Admin chỉ đọc; Admin vẫn được ghi theo policy backend dành riêng cho các chức năng đã retire này.

## 7. Cách đọc màn hình phân quyền mới

- Chọn **ứng dụng** chỉ để lọc/thu gọn ma trận, không tự cấp quyền.
- Chọn **scope** trước, sau đó tích capability cần cấp. Một capability không hỗ trợ scope đó sẽ bị khóa.
- Nhãn **Kế thừa** nghĩa là quyền đến từ role/Room/Workspace; phải sửa tại nguồn tương ứng.
- Nhãn **Template** nghĩa là quyền không được cấp trực tiếp, ví dụ nhóm HR nhạy cảm; phải dùng vai trò nghiệp vụ.
- Phần **Phân quyền Room dự án** chỉ hiển thị tổng hợp và dẫn tới nơi quản trị đúng là từng dự án.
- Phần legacy là read-only evidence, không còn tác dụng cấp quyền.

## 8. Kiểm tra vận hành tối thiểu sau mỗi thay đổi

- Người dùng phải đăng nhập lại hoặc refresh profile để nhận snapshot mới.
- Kiểm tra persona ở cả menu, route trực tiếp, dữ liệu trả về và thao tác ghi.
- Tối thiểu phải có các persona: System Admin, HR/HR Manage, nhân viên thường có hồ sơ, nhân viên chưa có hồ sơ, thành viên Room đúng dự án, và người ngoài dự án.
- Không kết luận an toàn chỉ từ giao diện; phải có smoke test RLS/RPC xác nhận không đọc/ghi chéo scope.
