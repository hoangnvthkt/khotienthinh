# Task 12.4.2 — Role-template decision pack

Ngày chốt nguyên tắc: 2026-09-16. E26 đã triển khai catalog lifecycle Request và system template `SUPER_ADMIN` trên Cloud; chưa gán `SUPER_ADMIN`, chưa cấp/gỡ quyền người dùng và chưa tạo transition manifest.

## Quyết định owner đã chốt

1. Mẫu quyền chỉ chứa tập hành động; phạm vi cụ thể được chọn khi gán mẫu cho từng người.
2. Cùng một mẫu có thể gán cho nhiều người với kho/dự án/phòng ban khác nhau.
3. Nút **Toàn quyền** của mẫu thường chỉ chụp tập quyền tại thời điểm lưu; capability mới mặc định chưa được chọn.
4. Template không kế thừa động template khác. Mẫu quản lý chứa một snapshot tường minh của quyền vận hành cộng quyền nâng cao; quyền mới vẫn phải review.
5. `Super Admin` là system role được khóa, tự bao gồm toàn bộ capability hiện tại và tương lai, chỉ Permission Admin đủ thẩm quyền mới được gán/thu hồi và mọi thay đổi phải audit.
6. WMS tách `Thủ kho` và `Quản lý kho`; quyền nhạy cảm không mặc định nằm trong mọi tài khoản thủ kho.
7. Người dùng Quy trình chỉ sửa/xóa bản nháp của mình; sau khi chạy chỉ được thực hiện bước được giao. Quản trị mẫu và quản trị instance là quyền riêng.

## Cloud baseline

Cloud hiện có 17 application, 103 module và 384 action active; 68 action nhạy cảm. Phân loại module:

- 84 module nghiệp vụ canonical.
- 1 module điều khiển canonical có prefix hệ thống: `system.authorization`.
- 18 module shell `system.*` còn lại cần thay thế hoặc đóng trước khi loại bỏ legacy schema.

`SYSTEM_ADMIN` hiện chỉ chứa 2 item và không phải full application role. Vì vậy không đổi nghĩa ngầm của template này. `SUPER_ADMIN` là system template riêng, bị khóa, không chứa item tĩnh; resolver tự mở rộng toàn bộ action active hiện tại và tương lai. E26 không tự gán role này cho tài khoản thật.

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
| Hệ thống | Super Admin; Permission Admin; Kiểm toán phân quyền | global hoặc scope quản trị | Super Admin protected dynamic đã triển khai |
| Dự án | Thành viên; Điều phối; Người duyệt; Quản lý dự án | project/construction_site | Chờ owner theo Room/action |
| Kho | Thủ kho; Quản lý kho | warehouse | Baseline đã duyệt |
| Nhân sự | Self-service; People Manager; HR nghiệp vụ; HR Manager; Payroll Admin | own/direct_reports/org_unit/assigned/global | Chờ owner HR và payroll |
| Quy trình | Người dùng; Quản trị quy trình | own/assigned/global | Baseline đã duyệt, catalog còn thiếu action |
| Yêu cầu | Người tạo; Người xử lý; Quản trị yêu cầu | own/assigned/global | Lifecycle runtime đã tách; chờ owner chốt template |
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

Hai action bản nháp đã ở `grant_readiness=enforced`, `direct_grant_allowed=true`. Runtime có trạng thái `DRAFT` thật và bốn command tách biệt để tạo, sửa, xóa và gửi nháp. Chỉ chính người tạo có capability own tương ứng mới sửa/xóa; quyền Admin hoặc instance-admin không tự suy ra quyền sửa nháp của người khác. Khi gửi, hệ thống kiểm mẫu, người nhận bước đầu rồi chuyển nguyên tử sang `RUNNING` và ghi log `SUBMITTED`.

### Quản trị quy trình

Catalog hiện đáp ứng quyền người dùng cộng tạo/sửa/publish mẫu và ba action riêng `workflow.instance.cancel`, `workflow.instance.reopen`, `workflow.instance.administer`. Command hủy/mở lại, quản lý watcher và sửa nội dung instance đã kiểm capability riêng; compatibility module-admin được giữ trong `workflow_has_action` cho giai đoạn chuyển đổi. Người được giao bước chỉ được thay đổi các khóa dữ liệu có namespace của bước hiện tại; quyền `administer` mới được sửa tiêu đề hoặc dữ liệu cấp instance. Không map các thao tác này vào một quyền `manage` chung.

Quyền `INSERT/UPDATE/DELETE` trực tiếp của role `authenticated` trên `workflow_instances` và `workflow_instance_logs` đã bị thu hồi. Mọi mutation đi qua command có capability guard; chỉ bản nháp `DRAFT` do chính actor tạo mới được xóa bằng `delete_own_draft`. Phiếu đã gửi sang `RUNNING` không có đường xóa.

Sau checkpoint này Cloud có 377 action active, trong đó 8 action thuộc `workflow.instance`. Không có assignment/grant thật nào được tạo bởi migration.

## Request lifecycle và Super Admin checkpoint

E26 tách bảy thao tác Request đang tồn tại thật thành capability enforced: duyệt, từ chối, trả lại bước được giao; gửi lại và sửa nội dung phiếu của mình; hủy; và chuyển người xử lý. Guard chạy tại bảng `request_instances` và `workflow_step_assignments`, nên direct grant không thể bỏ qua quan hệ owner/assignee. Compatibility `act_assigned`/`system.rq.view` được giữ để 45 quyết định hiện hành không bị mất trong giai đoạn chuyển đổi. Request vẫn chưa có command tạo/lưu/xóa `DRAFT`, vì vậy blueprint không tuyên bố các quyền nháp đó đã hoàn tất.

`SUPER_ADMIN` được triển khai bằng system template khóa và resolver động, không phải hàng trăm item tĩnh. Chỉ actor đang giữ `PERMISSION_ADMIN` global active mới được gán/thu hồi; không được tự gán, chỉ gán `global/*`, không expiry, target phải active, assignment không được sửa/reactivate và không được thu hồi Super Admin cuối cùng. Migration tạo đúng một template và không tạo assignment thật.

Sau E26 Cloud có 384 action active, trong đó 11 action thuộc `request.instance`; `SUPER_ADMIN` có 0 item tĩnh và 0 assignment.

## Những điểm chặn trước executable manifest

1. Chat và Procurement chưa có capability canonical ngoài shell.
2. Request đã có capability cho lifecycle đang chạy nhưng chưa có create/save/delete DRAFT; Workflow và Request vẫn cần command quản lý template/assignment trước khi cohort có thể thành manifest executable.
3. Contract, KB và Storage còn dùng cặp view/manage quá rộng.
4. Project cần giữ Project Room/action làm nguồn chuẩn; không đổi thành role global.
5. UI và command quản trị template/assignment đã có ở E27, nhưng chưa có owner approval để tạo template nghiệp vụ hoặc gán role thật cho cohort đang chờ.
6. Schema hiện cho phép scope ở cả template item và assignment. Trước UI builder phải chốt command semantics: item mô tả action/default scope; assignment mang entity scope cụ thể và hai lớp phải giao nhau, không mở rộng.

Do các điểm trên, blueprint là decision pack, không phải manifest cấp quyền. Sau E28, WMS và Workflow có owner approval nhưng vẫn chưa qua technical readiness; 13 cohort còn lại giữ `owner_pending/manual_review`.

## E27 — Bề mặt quản trị mẫu quyền và assignment

- Wizard ba bước đã được nối vào Settings: `Thông tin chung` → `Cấu hình bảng phân quyền` → `Gán đối tượng`. Quyền hiển thị và gọi command đều yêu cầu `system.authorization.manage_roles`; kiểm tra persona Employee không có quyền xác nhận URL bị chặn và redirect.
- Mẫu thường lưu action theo snapshot tường minh, chỉ cho chọn capability đã `enforced/verified`. Mẫu hệ thống bị khóa; `SUPER_ADMIN` tiếp tục là role động, không sinh item tĩnh.
- Preview assignment trả tổng capability, capability nhạy cảm, capability cần phê duyệt, cảnh báo SoD và hard deny. Gán role chỉ chạy khi role version và fingerprint preview còn khớp; stale preview/version bị từ chối.
- Cảnh báo SoD phải có audit control owner khác actor/target, lý do, compensating control và thời hạn. Command hiện hữu vẫn ghi audit; revoke giữ continuity guard, còn `SUPER_ADMIN` giữ last-admin guard của E26.
- Hai mutation RPC legacy `save_business_role` và `assign_business_role` đã bị thu hồi khỏi `anon/authenticated`; service role giữ compatibility. API V2 có ACL tường minh và snapshot read model riêng cho màn quản trị.
- Migration không tạo template, item hoặc assignment thật. Cloud sau postflight vẫn có 12 template, 136 item, 114 assignment active, `SUPER_ADMIN` có 0 item và 0 assignment.

## Checkpoint tiếp theo

1. Owner tiếp tục chốt mapping actor/action/scope cho 13 cohort `owner_pending`; WMS và Workflow đã có approval nhưng phải qua technical readiness trước pilot. Request là cohort kế tiếp chỉ sau khi owner chốt ba template.
2. Tạo/pilot template qua wizard chỉ cho cohort đã duyệt, dùng tài khoản fixture hoặc nhóm pilot xác định; preview và SoD acceptance phải được lưu làm evidence.
3. Chạy persona test allow/deny, reconciliation gain/loss và kiểm tra audit sau từng pilot. Không mở cohort kế tiếp nếu cohort hiện tại chưa đạt.
4. Chỉ sinh executable manifest và revoke shell khi cohort tương ứng có 0 `manual_review`, owner approval hợp lệ và rollback plan đã kiểm thử.

## E28 — Chốt owner mapping WMS/Workflow và pilot-readiness gate

- Decision register ghi owner approval hiện hành cho đúng hai cohort đã được anh duyệt: `wms_manage` và `workflow`. 13 cohort còn lại, gồm Request, vẫn `owner_pending`; không dùng việc đồng ý kiến trúc chung để tự suy ra approval nghiệp vụ chi tiết.
- WMS mapping đã tường minh actor và scope: `WAREHOUSE_OPERATOR` và `WAREHOUSE_MANAGER` chỉ gán theo `warehouse/<warehouse-id>`. Workflow mapping giữ action record-bound: nháp `own`, xử lý bước `assigned`, còn quyền quản trị mẫu/phiên là `global` theo blueprint tương ứng.
- Bộ kiểm máy đọc đối chiếu đồng thời owner decision, blueprint, action catalog, `grant_readiness` và scope modes trên Cloud. Chỉ action `enforced/verified` mới được materialize qua wizard; thiếu action/scope hoặc action còn `declared/legacy` đều fail closed.
- Cloud preflight phát hiện 0/4 template sẵn sàng pilot. Có 19 action duy nhất chưa đạt readiness, xuất hiện thành 33 blocker theo template: WMS có 11 action `declared` và `wms.master_data.manage` còn `legacy`; Workflow có 7 action `declared`. Vì vậy E28 không tạo template/assignment và không thay đổi Cloud.
- Đây là chặn kỹ thuật có chủ đích, không phải thiếu owner approval. Nâng readiness chỉ được thực hiện sau khi command/RLS/backend guard của từng action được kiểm bằng allow/deny runtime smoke; không đổi metadata để ép wizard mở checkbox.

Checkpoint kế tiếp là hardening nhóm WMS Operator trước: xác minh hoặc bổ sung backend guard cho 10 action vận hành, chạy persona/scope reconciliation, rồi mới nâng từng action sang `enforced/verified` và pilot `WAREHOUSE_OPERATOR`. `WAREHOUSE_MANAGER` chỉ mở sau khi các action nhạy cảm riêng đạt lại smoke và SoD preview.

## E29 — WAREHOUSE_OPERATOR đã qua technical readiness

- Mười action của Thủ kho đã có runtime boundary và ở trạng thái `enforced`. Hai khoảng trống trước đó được đóng tại backend: lifecycle request bắt buộc riêng `create/approve/export/receive`, còn transaction xuất theo request cần cả quyền tạo giao dịch và quyền xuất request tại kho nguồn.
- Smoke trên Cloud kiểm đúng kho/sai kho, bỏ từng quyền xuất/nhận, semantics upsert không đòi thừa quyền create và chuỗi transaction approve/complete trong transaction rollback. Vì vậy readiness checker hiện trả `WAREHOUSE_OPERATOR canPilot=true`, 10 action, 0 blocker.
- Chưa có template hoặc assignment thật được tạo. Pilot kế tiếp phải đi qua command V2, dùng fingerprint/version và rollback; chỉ sau khi preview/audit/scope reconciliation đạt mới cân nhắc lưu template thật hoặc gán cho người dùng cụ thể.
- `WAREHOUSE_MANAGER`, `WORKFLOW_USER` và `WORKFLOW_ADMIN` vẫn bị khóa. Không dùng readiness của Thủ kho để suy mở các action quản lý kho hay Workflow.
