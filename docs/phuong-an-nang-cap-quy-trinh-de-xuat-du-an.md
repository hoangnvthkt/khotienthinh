# Phương án nâng cấp quy trình đề xuất trong module Dự án

Ngày lập: 2026-06-03

Tài liệu này dựa trên báo cáo `docs/bao-cao-vong-doi-yeu-cau-vat-tu.md` và chốt lại hướng nâng cấp: các đề xuất trong module Dự án sẽ hoạt động chủ động giống module Quy trình, có mẫu, có bước, có người chịu trách nhiệm theo từng bước, và quyền xử lý đi theo người đang được gán.

Phần kiến trúc supply chain/inventory không nên trộn vào workflow phê duyệt. Các nguyên tắc về inventory ledger, reservation, fulfillment plan, allocation, hoàn tác, trả hàng, giao nhiều đợt và giao trực tiếp công trường được tách riêng trong `docs/doi-chieu-kien-truc-vat-tu-erp.md`.

## 1. Mục tiêu

Nâng cấp toàn bộ luồng đề xuất trong module Dự án từ dạng hard-code từng bước sang dạng workflow động:

- Admin/Quản trị dự án tạo được **mẫu quy trình**.
- Mẫu có nhiều **bước xử lý** theo thứ tự.
- Mỗi bước có quy tắc chọn người thực hiện.
- Khi chuyển sang bước mới, hệ thống bắt buộc **gán người chịu trách nhiệm**.
- Người đang được gán có quyền **duyệt, trả lại, từ chối**.
- Nếu trả lại, người tạo sửa và gửi lại vào vòng xử lý.
- Toàn bộ lịch sử gán việc, duyệt, trả lại, từ chối được ghi timeline.
- Khi workflow phê duyệt hoàn tất, nghiệp vụ phía sau như WMS/PO mới được mở.
- Workflow chỉ là lớp phê duyệt/ủy quyền. Tồn kho không được tính từ trạng thái workflow hoặc trạng thái chứng từ; tồn kho phải đi qua inventory ledger.

Nguyên tắc cốt lõi: **không còn trạng thái chờ chung chung**. Một phiếu đang chờ xử lý phải luôn biết đang nằm ở bước nào và đang gán cho pool người nào. Nếu pool có nhiều người, rule Phase 3-5 là `ANY_ONE`: một người trong pool duyệt là bước được chuyển tiếp, các người còn lại được ghi `SKIPPED`.

## Cập nhật sau Phase 2

Phase 1-2 đã đưa material request sang workflow động single-assignee. Từ Phase 3-5, kiến trúc phải nâng lên các rule chặt hơn:

- Mỗi template có `managers` là quản trị quy trình riêng, gần như admin nhưng không xoá workflow.
- Mỗi template và từng bước có watcher chỉ xem, không được duyệt/trả lại/từ chối.
- Runtime dùng participant ledger và assignment ledger, không dựa vào một field `current_assignee_user_id` duy nhất.
- Instance đã chạy phải có snapshot node/edge/version, sửa template không làm đổi cấu trúc instance cũ.
- Rollback/reject terminal phải kiểm `Document Dependency`, không chỉ kiểm phát sinh vật tư.

## 2. Phạm vi áp dụng

Triển khai trước cho **Đề xuất vật tư dự án** vì đây là luồng đang cần nhất.

Sau khi ổn định, mở rộng cùng cơ chế cho:

- Đề xuất PO/đơn hàng.
- Nghiệm thu khối lượng.
- Thanh toán.
- Phát sinh/variation.
- Nhật ký công trường.
- Checklist chất lượng.
- Các đề xuất dự án khác.

## 3. Kiến trúc đề xuất

Ưu tiên tái sử dụng module Quy trình hiện có:

- `workflow_templates`: mẫu quy trình.
- `workflow_nodes`: các bước.
- `workflow_edges`: thứ tự/chuyển bước.
- `workflow_instances`: một lần chạy workflow.
- `workflow_instance_logs`: timeline hành động.
- `workflow_template_versions`, `workflow_instance_nodes`, `workflow_instance_edges`: snapshot runtime để instance đã chạy không bị mutate khi sửa template.
- `workflow_participants`: ledger người tham gia với role `ADMIN`, `WATCHER`, `CREATOR`, `ASSIGNEE`.

Cần bổ sung một lớp adapter để gắn workflow với chứng từ dự án.

```text
Project document
  material request / PO / payment / variation
        |
        v
workflow_subjects
        |
        v
workflow_instances -> workflow_nodes -> workflow_edges
```

Workflow chịu trách nhiệm "ai duyệt, chuyển bước, trả lại, từ chối". Chứng từ dự án chịu trách nhiệm dữ liệu nghiệp vụ. WMS/PO chịu trách nhiệm thực thi hậu cần sau khi phê duyệt.

## 4. Data model cần bổ sung

### 4.1. Bảng gắn workflow với chứng từ

```sql
workflow_subjects
- id uuid primary key
- workflow_instance_id uuid references workflow_instances(id)
- subject_type text
- subject_id text
- project_id text
- construction_site_id text
- current_assignee_user_id text -- compatibility, giữ người đầu tiên trong pool
- current_assignee_user_ids uuid[] -- nguồn hiển thị pool mới
- current_node_id uuid
- current_instance_node_id uuid
- template_version_id uuid
- status text
- return_to_assignee_user_ids uuid[]
- created_by text
- created_at timestamptz
- updated_at timestamptz
```

`subject_type` ví dụ:

- `material_request`
- `purchase_order`
- `quantity_acceptance`
- `payment_certificate`
- `contract_variation`
- `daily_log`

### 4.2. Cấu hình bước workflow

Mở rộng `workflow_nodes.config` để hỗ trợ project proposal:

```json
{
  "assignmentMode": "select_on_transition",
  "approvalPolicy": "ANY_ONE",
  "assignmentTargets": [
    { "type": "user", "userId": "..." },
    { "type": "department", "orgUnitId": "..." }
  ],
  "stepWatcherTargets": [
    { "type": "user", "userId": "..." }
  ],
  "eligiblePermissionCodes": ["approve"],
  "eligibleRole": null,
  "slaHours": 24,
  "returnPolicy": "to_creator",
  "allowReject": true,
  "allowReassign": true,
  "completionEffect": {
    "subjectStatus": "APPROVED"
  }
}
```

Các mode đề xuất:

| Mode | Ý nghĩa |
|---|---|
| `select_on_submit` | Người tạo chọn người xử lý bước đầu tiên khi gửi. |
| `select_on_transition` | Người duyệt bước hiện tại chọn người xử lý bước kế tiếp. |
| `fixed_user` | Bước cố định một user. |
| `permission_pool` | Chọn trong danh sách user có permission cấu hình. |
| `previous_assignee` | Gán lại người đã xử lý bước đó trước đây, dùng khi gửi lại sau trả lại. |
| `creator` | Gán về người tạo. |

### 4.3. Lưu assignment theo từng bước

Có thể dùng `workflow_instances.step_assignees` hiện có, nhưng nên bổ sung bảng lịch sử assignment để audit rõ:

```sql
workflow_step_assignments
- id uuid primary key
- workflow_instance_id uuid
- node_id uuid
- assignee_user_id text
- assigned_by text
- status text -- PENDING, APPROVED, RETURNED, REJECTED, SKIPPED
- assigned_at timestamptz
- acted_at timestamptz
- action_comment text
- return_to_node_id uuid
- metadata jsonb
- instance_node_id uuid
- due_at timestamptz
- sla_hours integer
- assignment_source text
- assignment_group_type text
- assignment_group_id text
```

Lý do cần bảng này: một step có thể bị trả lại và gửi lại nhiều lần. Nếu chỉ lưu `step_assignees` dạng object thì không đủ lịch sử.

### 4.5. Participant ledger

```sql
workflow_participants
- workflow_subject_id uuid
- workflow_instance_id uuid
- user_id uuid
- role text -- ADMIN, WATCHER, CREATOR, ASSIGNEE
- source text
- node_id uuid
- instance_node_id uuid
- is_active boolean
```

Quyền xem/xử lý đi qua bảng này:

- `ADMIN`: xem, cấu hình, reassign, xử lý gần như admin, không xoá.
- `WATCHER`: xem timeline và nội dung, không có action.
- `CREATOR`: sửa/gửi lại khi bị trả.
- `ASSIGNEE`: action khi đang có assignment `PENDING`.

### 4.6. Dependency rollback

```sql
project_document_links
- source_type text
- source_id text
- target_type text
- target_id text
- relation_type text
- status text -- active/reversed/cancelled/returned/void
```

Rule rollback:

- Chưa có downstream document: rollback OK.
- Có downstream active: rollback bị khoá.
- Có downstream nhưng đã reverse/cancel/return đủ: rollback OK.

### 4.4. Gắn template mặc định theo loại đề xuất

```sql
project_workflow_bindings
- id uuid primary key
- subject_type text
- project_id text null
- construction_site_id text null
- workflow_template_id uuid
- is_default boolean
- is_active boolean
- created_at timestamptz
```

Quy tắc chọn template:

1. Template theo công trường nếu có.
2. Template theo dự án nếu có.
3. Template mặc định toàn hệ thống theo `subject_type`.

## 5. RPC/API cần có

Nên đưa transition quan trọng vào RPC để DB kiểm quyền thật, không để frontend tự update nhiều field.

### 5.1. `start_project_workflow_v2`

Dùng khi người tạo gửi đề xuất.

Input:

- `p_subject_type`
- `p_subject_id`
- `p_template_id`
- `p_first_assignee_user_ids`
- `p_comment`

DB kiểm:

- Người gửi có quyền tạo/gửi chứng từ.
- Template hợp lệ.
- First assignee pool thuộc danh sách eligible của bước đầu.

Kết quả:

- Tạo `workflow_instance`.
- Tạo `workflow_subject`.
- Tạo nhiều assignment bước đầu `PENDING`.
- Ghi participant role `CREATOR`, `ADMIN`, `WATCHER`, `ASSIGNEE`.
- Update chứng từ sang trạng thái đang chạy workflow.

### 5.2. `advance_project_workflow_v2`

Dùng khi current assignee duyệt và chuyển bước.

Input:

- `p_subject_type`
- `p_subject_id`
- `p_action = APPROVE`
- `p_next_assignee_user_ids`
- `p_comment`

DB kiểm:

- Người gọi nằm trong assignment pool pending hoặc là workflow admin/Admin.
- Step hiện tại đang `PENDING`.
- Next assignee pool hợp lệ với step kế tiếp.

Kết quả:

- Assignment của người duyệt `APPROVED`.
- Các assignment pending cùng step còn lại `SKIPPED` theo `ANY_ONE`.
- Nếu còn step kế tiếp: tạo assignment mới `PENDING`.
- Nếu tới END: workflow `COMPLETED`, chứng từ chuyển sang trạng thái sau phê duyệt.

### 5.3. `return_project_workflow`

Dùng khi current assignee trả lại.

Input:

- `p_subject_type`
- `p_subject_id`
- `p_return_to` -- creator / previous_step / selected_node
- `p_comment`

Kết quả:

- Assignment hiện tại `RETURNED`.
- Chứng từ về trạng thái `returned`.
- Gán lại cho người tạo để sửa.
- Lưu node bị trả lại để khi gửi lại có thể quay đúng bước.

### 5.4. `resubmit_project_workflow_v2`

Dùng khi người tạo sửa xong và gửi lại.

Input:

- `p_subject_type`
- `p_subject_id`
- `p_assignee_user_ids` optional
- `p_comment`

Kết quả:

- Chứng từ quay lại workflow running.
- Mặc định gán lại người đã trả lại.
- Nếu cho phép, người tạo có thể chọn người khác trong eligible pool.

### 5.5. `reject_project_workflow`

Dùng khi current assignee từ chối hẳn.

Kết quả:

- Workflow `REJECTED`.
- Assignment hiện tại `REJECTED`.
- Chứng từ `REJECTED`.
- Không cho tạo WMS/PO tiếp.

### 5.6. `reassign_project_workflow_v2`

Dùng khi Admin hoặc người được phép gán lại.

Kết quả:

- Pool pending hiện tại chuyển `SKIPPED`.
- Tạo pool pending mới.
- Ghi log đầy đủ ai gán lại, từ pool nào sang pool nào, lý do.

## 6. RLS và bảo mật

RLS phải đi theo nguyên tắc:

- Người tạo xem/sửa khi phiếu đang `draft` hoặc `returned`.
- Người thuộc assignment pool pending xem và xử lý bước hiện tại.
- Người có quyền dự án được xem nếu policy cho phép.
- Watcher được xem.
- Workflow admin riêng được xem/sửa/gán/reassign, không xoá template/instance.
- Admin/module admin override.
- Không ai được update workflow bằng cách gọi trực tiếp `update` vào các bảng chính nếu không qua RPC transition.

Các bảng mới cần bật RLS:

- `workflow_subjects`
- `workflow_step_assignments`
- `project_workflow_bindings`

RPC nên là `security definer`, nhưng phải:

- Kiểm `current_app_user_id()`.
- Không dùng `user_metadata`.
- Không cho actor truyền user khác để hành động thay, trừ Admin.
- Validate subject type và subject id.
- Validate assignee nằm trong eligible pool.

## 7. UI/UX cần nâng cấp

### 7.1. Màn tạo mẫu quy trình

Tận dụng `WorkflowBuilder`, bổ sung cấu hình cho từng bước:

- Tên bước.
- SLA.
- Loại bước: duyệt / xác nhận / thực hiện.
- Cách chọn assignee.
- Assignment pool: một người, nhiều người hoặc phòng ban.
- Watcher mặc định/từng bước.
- Workflow admin riêng theo template.
- Permission pool.
- Chính sách trả lại.
- Có cho từ chối hẳn không.
- Có bắt buộc ghi chú khi trả lại/từ chối không.

### 7.2. Màn gửi đề xuất

Khi người tạo bấm "Gửi duyệt":

- Hệ thống chọn template phù hợp.
- Hiển thị bước đầu tiên.
- Bắt chọn một hoặc nhiều người xử lý bước đầu.
- Có thể chọn cả phòng ban, hệ thống resolve ra user snapshot tại thời điểm gửi.
- Gửi xong, phiếu vào trạng thái "Đang xử lý" và hiển thị assignment pool.

### 7.3. Panel xử lý trong chi tiết phiếu

Mỗi phiếu cần một panel thống nhất:

- Bước hiện tại.
- Pool người đang xử lý.
- SLA/còn hạn/quá hạn.
- Nút: Duyệt & chuyển bước, Trả lại, Từ chối, Gán lại.
- Khi duyệt bước chưa phải cuối, modal bắt chọn pool người bước kế tiếp.

### 7.4. Timeline workflow

Timeline cần hiển thị:

- Ai tạo.
- Ai được gán.
- Ai duyệt.
- Ai trả lại.
- Lý do trả lại/từ chối.
- Gửi lại lần mấy.
- Gán lại từ pool nào sang pool nào.
- Người bị skip do `ANY_ONE`.
- Thời gian và SLA từng bước.

### 7.5. Kanban theo workflow động

Kanban không nên hard-code cột `site_manager_review`, `material_department_review`.

Nguồn cột nên lấy từ nodes của template:

```text
Nháp | Bước 1 | Bước 2 | ... | Hoàn thành | Từ chối/Trả lại
```

Với từng project/template, cột có thể khác nhau.

## 8. Luồng đề xuất vật tư sau nâng cấp

Ví dụ template:

```text
Người tạo
  -> Quản lý công trường duyệt
  -> Phòng QLDA duyệt
  -> Phòng vật tư duyệt
  -> Lập đợt cấp/PO
  -> Hoàn tất phê duyệt
```

Vòng đời:

1. Người tạo lập phiếu vật tư.
2. Gửi duyệt và chọn Quản lý công trường.
3. Quản lý công trường duyệt, chọn người Phòng QLDA.
4. Phòng QLDA duyệt, chọn người Phòng vật tư.
5. Phòng vật tư duyệt, chọn người phụ trách lập đợt cấp/PO.
6. Workflow phê duyệt hoàn tất.
7. Nghiệp vụ WMS/PO mở ra:
   - Tạo đợt cấp từ kho.
   - Hoặc tạo PO cho phần thiếu.
8. WMS/PO xử lý giao nhận và cập nhật tồn.

Nếu bị trả lại:

```text
Phòng QLDA trả lại
  -> Người tạo sửa
  -> Gửi lại cho Phòng QLDA
  -> Phòng QLDA xử lý tiếp
```

Không cần chạy lại từ Quản lý công trường, trừ khi người trả lại chọn rõ "trả về bước trước".

## 9. Lộ trình triển khai

### Phase 1 - Nền workflow adapter

Mục tiêu: tạo nền để workflow gắn được với đề xuất dự án.

Việc cần làm:

- Tạo migration cho `workflow_subjects`, `workflow_step_assignments`, `project_workflow_bindings`.
- Tạo RPC:
  - `start_project_workflow`
  - `advance_project_workflow`
  - `return_project_workflow`
  - `resubmit_project_workflow`
  - `reject_project_workflow`
  - `reassign_project_workflow`
- Thêm RLS cho bảng mới.
- Tạo service frontend `projectWorkflowService`.

Kết quả mong muốn:

- Có thể start workflow cho một material request.
- Có thể gán người bước đầu.
- Current assignee xử lý được qua RPC.

### Phase 2 - UI dùng chung cho project proposals

Mục tiêu: có component workflow dùng lại được.

Việc cần làm:

- `ProjectWorkflowPanel`.
- `ProjectWorkflowTimeline`.
- `ProjectWorkflowActionDialog`.
- `ProjectWorkflowAssigneeSelect`.
- Badge current assignee/SLA trong danh sách.

Kết quả mong muốn:

- Chi tiết phiếu nào cũng hiển thị được workflow panel.
- Người được gán nhìn thấy việc cần xử lý.
- Người không được gán không thấy nút xử lý.

### Phase 3 - Harden Workflow Runtime

Mục tiêu: làm runtime đủ chặt quyền cho các rule mới.

Việc cần làm:

- Tạo `workflow_template_versions`.
- Tạo `workflow_instance_nodes`, `workflow_instance_edges`.
- Tạo `workflow_participants`.
- Thêm `template_version_id`, `current_instance_node_id`, `current_assignee_user_ids`.
- Đổi RLS helper sang participant/assignment ledger.
- Giữ `current_assignee_user_id`, `requests.submitted_to_user_id`, `requests.workflow_step` làm compatibility.

Kết quả mong muốn:

- Instance đã chạy không đổi khi sửa template.
- Workflow admin/watcher/creator/assignee có quyền đúng.
- Không còn phụ thuộc single-assignee làm nguồn quyền thật.

### Phase 4 - Multi-assignee UI + Material Request Runtime

Mục tiêu: material request chạy end-to-end với assignment pool.

Việc cần làm:

- RPC v2 nhận `uuid[]`.
- UI chọn nhiều user/phòng ban.
- Department assignment resolve qua `employees.user_id`.
- `ANY_ONE`: một người duyệt là qua, người còn lại `SKIPPED`.
- Timeline/card/panel hiển thị pool thật.

Kết quả mong muốn:

- Tạo MR gửi cho nhiều người.
- Một người trong pool duyệt, phiếu chuyển bước.
- Trả lại/gửi lại/reassign giữ đúng pool và audit.

### Phase 5 - Dependency Rollback + Cleanup

Mục tiêu: rollback/reject terminal theo document dependency.

Việc cần làm:

- Tạo `project_document_links`.
- Backfill/resolve dependency từ fulfillment batches, PO links, purchase orders, transactions.
- RPC `get_project_workflow_rollback_dependencies`.
- Chặn rollback/reject terminal khi còn downstream active.
- Dọn dần logic hard-code `site_manager_review`, `material_department_review`; giữ compatibility cho phiếu cũ.

Kết quả mong muốn:

- MR chưa có downstream rollback được.
- MR có PO/batch/transaction active bị khóa rollback.
- MR có downstream đã cancel/reverse/return đủ rollback được.

## 10. Migration từ dữ liệu hiện tại

Không nên ép toàn bộ phiếu cũ chạy workflow mới ngay.

Phương án an toàn:

- Phiếu đã `COMPLETED`, `REJECTED`, `CANCELLED`: giữ nguyên, chỉ hiển thị lịch sử cũ.
- Phiếu đang `DRAFT`: khi gửi lại thì chạy workflow mới.
- Phiếu đang `PENDING`: tạo workflow instance tương ứng với bước hiện tại và gán `submitted_to_user_id`.
- Phiếu `APPROVED` nhưng chưa tạo đợt cấp/PO: tạo workflow completed hoặc gắn trạng thái "đã qua phê duyệt", tùy cần audit.
- Phiếu `IN_TRANSIT`: không đưa ngược vào workflow phê duyệt; tiếp tục WMS/PO.

Cần một script migration riêng để map:

| Current field | Workflow mới |
|---|---|
| `requests.workflow_step` | `workflow_subjects.current_node_id` theo template mapping |
| `requests.submitted_to_user_id` | current assignment assignee |
| `requests.logs` | timeline import vào `workflow_instance_logs` hoặc giữ legacy |
| `material_request_events` | import thành workflow action history nếu cần |

## 11. Rủi ro chính

| Rủi ro | Cách xử lý |
|---|---|
| Workflow engine hiện tại chưa đủ cấu hình assignee | Mở rộng `workflow_nodes.config` trước, không viết lại toàn bộ. |
| Client update trực tiếp làm lệch state | Chuyển thao tác workflow sang RPC. |
| Dữ liệu cũ không khớp template mới | Migrate theo trạng thái, không ép completed/in-transit chạy lại workflow. |
| Người được chọn không còn quyền/không active | RPC validate user active và eligible tại thời điểm gán. |
| Kanban động phức tạp hơn | Làm trước ở material request, sau đó mới mở rộng. |
| PO/WMS bị lẫn với workflow phê duyệt | Giữ ranh giới rõ: workflow chỉ phê duyệt, WMS/PO xử lý hậu cần. |

## 12. Tiêu chí nghiệm thu

Một workflow đề xuất vật tư được coi là đạt khi:

- Tạo được template gồm nhiều bước.
- Thêm bước QLDA bằng cấu hình template, không sửa code workflow vật tư.
- Người tạo gửi phiếu và chọn người bước đầu.
- Mỗi lần duyệt sang bước mới bắt buộc chọn assignee.
- Chỉ người trong assignment pool, workflow admin hoặc Admin có nút duyệt/trả lại/từ chối.
- Một bước gán được một người, nhiều người hoặc cả phòng ban.
- Với `ANY_ONE`, một người duyệt thì những người còn lại trong pool được ghi `SKIPPED`.
- Trả lại bắt buộc nhập lý do.
- Người tạo sửa và gửi lại đúng bước bị trả.
- Watcher xem được nhưng không gọi được action RPC.
- Workflow admin riêng gán/reassign được nhưng không xoá workflow.
- Instance đang chạy không bị đổi cấu trúc khi sửa template.
- Reject/rollback terminal bị khoá nếu còn downstream active.
- Timeline hiển thị đầy đủ mọi lần gán, duyệt, trả lại, gửi lại.
- Workflow completed mới cho phép tạo đợt cấp/PO.
- WMS/PO hiện tại vẫn hoạt động, không bị thay đổi tồn kho sai.
- RLS/RPC chặn được thao tác trái quyền dù người dùng gọi API trực tiếp.

## 13. Quyết định cần chốt trước khi implement

1. Dùng lại module WF hiện tại làm nền, hay tạo workflow riêng cho project documents?
2. Khi trả lại, mặc định về người tạo hay về bước trước?
3. Khi gửi lại sau trả lại, tự động gán lại người đã trả hay cho người tạo chọn lại?
4. Template workflow áp dụng theo toàn hệ thống, theo dự án, hay theo công trường?
5. Có cần permission riêng cho từng phòng như `qlda_approve`, `material_dept_approve`, hay chỉ dùng pool `approve` và chọn người?

Khuyến nghị của em:

- Dùng lại module WF hiện tại.
- Trả lại mặc định về người tạo, nhưng lưu bước bị trả để gửi lại đúng bước đó.
- Khi gửi lại, mặc định gán lại người đã trả; cho phép Admin/người tạo chọn lại nếu cần.
- Template cho phép override theo dự án/công trường.
- Giai đoạn đầu dùng permission `approve` để nhanh, sau đó thêm permission riêng nếu cần quản trị chặt hơn.
