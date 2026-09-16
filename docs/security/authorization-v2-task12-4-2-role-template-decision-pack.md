# Task 12.4.2 — Role-template decision pack

Ngày chốt nguyên tắc: 2026-09-16. Đây là thiết kế và Cloud audit read-only; chưa tạo/sửa template trên Cloud, chưa cấp/gỡ quyền và chưa tạo transition manifest.

## Quyết định owner đã chốt

1. Mẫu quyền chỉ chứa tập hành động; phạm vi cụ thể được chọn khi gán mẫu cho từng người.
2. Cùng một mẫu có thể gán cho nhiều người với kho/dự án/phòng ban khác nhau.
3. Nút **Toàn quyền** của mẫu thường chỉ chụp tập quyền tại thời điểm lưu; capability mới mặc định chưa được chọn.
4. Template không kế thừa động template khác. Mẫu quản lý chứa một snapshot tường minh của quyền vận hành cộng quyền nâng cao; quyền mới vẫn phải review.
5. `Super Admin` là system role được khóa, tự bao gồm toàn bộ capability hiện tại và tương lai, chỉ Permission Admin đủ thẩm quyền mới được gán/thu hồi và mọi thay đổi phải audit.
6. WMS tách `Thủ kho` và `Quản lý kho`; quyền nhạy cảm không mặc định nằm trong mọi tài khoản thủ kho.
7. Người dùng Quy trình chỉ sửa/xóa bản nháp của mình; sau khi chạy chỉ được thực hiện bước được giao. Quản trị mẫu và quản trị instance là quyền riêng.

## Cloud baseline

Cloud hiện có 17 application, 103 module và 372 action active; 65 action nhạy cảm. Phân loại module:

- 84 module nghiệp vụ canonical.
- 1 module điều khiển canonical có prefix hệ thống: `system.authorization`.
- 18 module shell `system.*` còn lại cần thay thế hoặc đóng trước khi loại bỏ legacy schema.

`SYSTEM_ADMIN` hiện chỉ chứa 2 item và không phải full application role. Vì vậy không đổi nghĩa ngầm của template này. Thiết kế mới bổ sung `SUPER_ADMIN` riêng, có semantics root rõ ràng và guard riêng.

## Trải nghiệm quản trị

### Bước 1 — Thông tin chung

- Tên, mã, mô tả và trạng thái mẫu.
- System template hiển thị badge khóa; không cho sửa/xóa nếu là `SUPER_ADMIN`, `PERMISSION_ADMIN` hoặc template kiểm toán hệ thống.
- Mẫu thường mặc định `futureActionPolicy=manual_review`.

### Bước 2 — Bảng phân quyền

Hiển thị `Ứng dụng → Module → Nhóm chức năng → Hành động`. Mỗi action cho biết:

- mức rủi ro và trạng thái catalog;
- scope được hỗ trợ;
- có bắt buộc thời hạn hay không;
- nguồn canonical hay compatibility shell;
- quyền được chọn trực tiếp hay chỉ qua template.

Nút **Toàn quyền** chỉ chọn action hiện có và không tự nhận action được thêm sau. Action nhạy cảm có cảnh báo riêng; không thể dùng checkbox cha để bỏ qua expiry, SoD hoặc guard backend.

### Bước 3 — Gán đối tượng và phạm vi

- Chọn một hoặc nhiều user.
- Chọn scope riêng trên từng assignment: kho, dự án, công trường, phòng ban, đơn vị tổ chức hoặc global tùy mẫu.
- Project Room và Work Workspace tiếp tục dùng membership/action source riêng; template không được bypass membership.
- Hiển thị preview `người nào × action nào × phạm vi nào`, số người bị ảnh hưởng và cảnh báo mở rộng quyền trước khi lưu.

## Ma trận template đề xuất

Blueprint máy đọc nằm tại `scripts/authorization-v2/task12-4-2-role-template-blueprints.json`.

| Ứng dụng | Template đề xuất | Scope chính | Trạng thái |
| --- | --- | --- | --- |
| Hệ thống | Super Admin; Permission Admin; Kiểm toán phân quyền | global hoặc scope quản trị | Nguyên tắc Super Admin đã duyệt |
| Dự án | Thành viên; Điều phối; Người duyệt; Quản lý dự án | project/construction_site | Chờ owner theo Room/action |
| Kho | Thủ kho; Quản lý kho | warehouse | Baseline đã duyệt |
| Nhân sự | Self-service; People Manager; HR nghiệp vụ; HR Manager; Payroll Admin | own/direct_reports/org_unit/assigned/global | Chờ owner HR và payroll |
| Quy trình | Người dùng; Quản trị quy trình | own/assigned/global | Baseline đã duyệt, catalog còn thiếu action |
| Yêu cầu | Người tạo; Người xử lý; Quản trị yêu cầu | own/assigned/global | Chờ tách lifecycle action |
| Công việc | Thành viên; Quản lý công việc; Workspace Admin | own/assigned/department/project/workspace/global | Chờ owner Work |
| Chi phí | Người đề nghị; Người kiểm tra; Người duyệt; Quản lý chi phí | own/department/global | Chờ owner finance |
| Tài sản | Người dùng; Người quản lý; Quản trị tài sản | assigned/department/warehouse/global | Đủ catalog để owner duyệt |
| Hợp đồng | Người xem; Chuyên viên; Quản lý hợp đồng | global hiện tại | Catalog còn quá thô |
| AI | Người dùng; Người tạo báo cáo; AI Admin | global | Provider/Tender admin còn thiếu |
| Analytics | Viewer; Exporter; Dashboard Admin | global | Author/publish/share còn thiếu |
| Knowledge Base | Reader; Editor; Publisher | global | Create/edit/publish còn thiếu |
| Storage | User; Storage Admin | global hiện tại | Cần action và record-bound scope |
| Đặt xe | Requester; Approver; Driver; Dispatcher; Fleet Manager | own/assigned/department/global | Đủ catalog để owner duyệt |
| Settings | Viewer; Business Settings Admin; Platform Admin | global | Authorization tách thành system template |
| Chat | User; Moderator; Admin | membership/global | Bị chặn vì chỉ còn shell view/manage |
| Procurement | Requester; Buyer; Approver; Manager | project/department/global | Bị chặn vì chỉ còn shell view/manage |

## WMS baseline đã duyệt

### Thủ kho

Tại kho được gán: xem tồn; xem/tạo/duyệt/xuất/nhận yêu cầu; xem/tạo/duyệt/hoàn tất giao dịch. Các quyền duyệt/hoàn tất vẫn chịu guard backend và audit.

### Quản lý kho

Snapshot tường minh gồm toàn bộ quyền Thủ kho cộng: sửa tồn, xóa yêu cầu WMS, hủy duyệt giao dịch, quyết toán/hoàn tác quyết toán xuất cấp, trả NCC và quản trị danh mục kho.

Không dùng inheritance động; nếu Thủ kho có action mới, Quản lý kho chỉ nhận action đó sau review.

## Workflow baseline và capability checkpoint

### Người dùng quy trình

Catalog hiện có: xem instance, khởi tạo, xử lý bước được giao, xem mẫu và hai action mô tả quyền trên bản nháp:

- sửa bản nháp do mình tạo;
- xóa bản nháp do mình tạo.

Hai action bản nháp đang ở `grant_readiness=declared`, `direct_grant_allowed=false` vì schema hiện không có trạng thái `DRAFT`: tạo phiếu chuyển thẳng sang `RUNNING`. Chúng chưa được cấp thật cho đến khi có lifecycle nháp và command tương ứng; không coi checkbox catalog là runtime đã hoàn tất.

### Quản trị quy trình

Catalog hiện đáp ứng quyền người dùng cộng tạo/sửa/publish mẫu và ba action riêng `workflow.instance.cancel`, `workflow.instance.reopen`, `workflow.instance.administer`. Command hủy/mở lại, quản lý watcher và sửa nội dung instance đã kiểm capability riêng; compatibility module-admin được giữ trong `workflow_has_action` cho giai đoạn chuyển đổi. Người được giao bước chỉ được thay đổi các khóa dữ liệu có namespace của bước hiện tại; quyền `administer` mới được sửa tiêu đề hoặc dữ liệu cấp instance. Không map các thao tác này vào một quyền `manage` chung.

Quyền `UPDATE/DELETE` trực tiếp của role `authenticated` trên `workflow_instances` và `workflow_instance_logs` đã bị thu hồi. Phiếu `RUNNING` không còn đường xóa; xóa chỉ được mở lại khi có lifecycle `DRAFT` thật và command `delete_own_draft` tương ứng.

Sau checkpoint này Cloud có 377 action active, trong đó 8 action thuộc `workflow.instance`. Không có assignment/grant thật nào được tạo bởi migration.

## Những điểm chặn trước executable manifest

1. Chat và Procurement chưa có capability canonical ngoài shell.
2. Request còn thiếu lifecycle actions; Workflow còn thiếu runtime lifecycle `DRAFT` dù catalog đã có hai action declared.
3. Contract, KB và Storage còn dùng cặp view/manage quá rộng.
4. Project cần giữ Project Room/action làm nguồn chuẩn; không đổi thành role global.
5. `SUPER_ADMIN` cần model/guard riêng. Việc đơn thuần thêm 372 item vào `SYSTEM_ADMIN` không đáp ứng semantics tự nhận quyền tương lai và dễ lẫn với System Admin kỹ thuật.
6. Schema hiện cho phép scope ở cả template item và assignment. Trước UI builder phải chốt command semantics: item mô tả action/default scope; assignment mang entity scope cụ thể và hai lớp phải giao nhau, không mở rộng.

Do các điểm trên, blueprint là decision pack, không phải manifest cấp quyền. Mọi cohort chưa có owner approval vẫn giữ `manual_review`.

## Checkpoint triển khai tiếp theo

1. Hoàn thiện runtime draft cho Workflow, catalog gap của Request và định nghĩa `SUPER_ADMIN` protected dynamic role.
2. Tạo command/RPC quản lý template và assignment: validation, stale version, impact preview, audit, SoD và last-admin guard.
3. Xây wizard ba bước dùng catalog hiện tại; system template fail closed và mẫu thường không tự nhận capability mới.
4. Pilot Cloud với WMS + Workflow bằng fixture rollback, sau đó mới mở Asset/Booking và các module khác.
5. Chỉ map/revoke shell khi owner decision hoàn tất, persona test đạt và reconciliation có 0 unexpected gain/loss.
