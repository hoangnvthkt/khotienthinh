# Báo cáo vòng đời yêu cầu vật tư, nhập/xuất kho và tạo đơn hàng

Ngày rà soát: 2026-06-03

## 1. Phạm vi rà soát

Báo cáo này tập trung vào luồng đang liên quan trực tiếp tới yêu cầu vật tư, nhập/xuất kho và tạo đơn hàng:

- Yêu cầu vật tư dự án/WMS: bảng `requests`, service `materialRequestService`, modal `RequestModal`, tab `MaterialTab`.
- Nhập/xuất/chuyển kho: bảng `transactions`, trang `Operations`, RPC `process_transaction_status`.
- Đợt cấp vật tư: bảng `material_request_fulfillment_batches`, `material_request_fulfillment_lines`.
- Đơn hàng PO: bảng `purchase_orders`, `purchase_order_request_lines`, tab `SupplyChainTab`.
- Luồng yêu cầu tổng quát: `request_instances` và workflow engine `workflow_instances` được ghi nhận riêng để tránh nhầm với yêu cầu vật tư.

Nguồn code chính:

- `types.ts`
- `lib/materialRequestService.ts`
- `lib/materialRequestFulfillmentService.ts`
- `lib/wmsPermissions.ts`
- `lib/projectStaffService.ts`
- `context/AppContext.tsx`
- `components/RequestModal.tsx`
- `components/project/MaterialRequestKanbanBoard.tsx`
- `components/project/ProjectSubmissionDialog.tsx`
- `pages/project/MaterialTab.tsx`
- `pages/project/SupplyChainTab.tsx`
- `pages/Operations.tsx`
- `supabase/migrations/20260528100710_project_requests_project_scope_rls.sql`
- `supabase/migrations/20260529012407_material_request_kanban_sla.sql`
- `supabase/migrations/20260602085356_allow_decimal_wms_stock_rpc.sql`

## 2. Kết luận nhanh

Hệ thống hiện có 3 lớp workflow khác nhau:

1. **Yêu cầu vật tư dự án/WMS** là luồng chính của báo cáo này. Nó dùng `status` để thể hiện trạng thái nghiệp vụ và dùng thêm `workflow_step` để biết phiếu đang nằm ở bước xử lý nào.
2. **WMS transaction** là luồng nhập/xuất/chuyển kho thật sự. Yêu cầu vật tư khi được cấp sẽ tạo transaction liên kết để trừ/cộng tồn.
3. **PO** có workflow riêng, nhưng có thể được tạo từ các dòng yêu cầu vật tư và đồng bộ ngược lại yêu cầu thông qua `purchase_order_request_lines` và fulfillment batch.

Điểm quan trọng: `status = PENDING` chưa đủ để biết đang chờ ai. Ví dụ một phiếu `PENDING` có thể đang ở `site_manager_review` hoặc `material_department_review`. Người xử lý thực tế nằm ở `submitted_to_user_id`.

## 3. State của yêu cầu vật tư

### 3.1. Trạng thái nghiệp vụ `status`

| Status | Ý nghĩa | Ghi chú |
|---|---|---|
| `DRAFT` | Nháp hoặc đã bị trả lại người tạo | Người tạo có thể bổ sung và gửi lại. |
| `PENDING` | Đang chờ duyệt | Phải xem thêm `workflow_step` để biết chờ quản lý công trường hay phòng vật tư. |
| `APPROVED` | Đã duyệt, chờ cấp vật tư/PO | Chuyển sang lập đợt cấp hoặc tạo đơn mua. |
| `IN_TRANSIT` | Đã có đợt cấp/PO đang giao | Chờ thủ kho công trường kiểm tra SL/CL hoặc xác nhận nhận. |
| `COMPLETED` | Hoàn tất | Đã nhận đủ phần cam kết/cấp. |
| `REJECTED` | Từ chối hẳn | Phiếu vào nhóm đóng. |

### 3.2. Bước xử lý `workflow_step`

| Workflow step | Cột Kanban | SLA hiện tại | Người xử lý chính |
|---|---|---:|---|
| `draft` | Nháp | Không | Người tạo |
| `site_manager_review` | Chờ quản lý CT duyệt | 24h | Người được chọn có quyền `approve` |
| `material_department_review` | Chờ phòng vật tư xử lý | 24h | Người được chọn có quyền `approve` |
| `batch_planning` | Chờ tạo đợt cấp | 48h | Người được chọn phụ trách lập đợt cấp/PO |
| `site_quality_check` | Đang cấp - chờ duyệt SL/CL | 8h | Thủ kho công trường hoặc người có quyền WMS phù hợp |
| `site_receipt` | Chờ xác nhận nhập kho | 8h | Thủ kho kho nhận/công trường |
| `completed` | Hoàn tất | Không | Không còn xử lý |
| `rejected` | Từ chối / trả lại | Không | Không còn xử lý |
| `returned_to_creator` | Từ chối / trả lại | Không | Người tạo bổ sung |

## 4. Vòng đời chuẩn của một yêu cầu vật tư dự án

1. **Tạo nháp**
   - Người tạo lập phiếu trong tab vật tư.
   - `status = DRAFT`, `workflow_step = draft`.
   - Dữ liệu chính: kho nhận công trường, danh sách vật tư, BOQ/work BOQ snapshot, ngày cần, ghi chú.

2. **Gửi quản lý công trường duyệt**
   - Người tạo chọn người duyệt bằng `ProjectSubmissionDialog`.
   - Danh sách người nhận lấy từ nhân sự dự án có permission `approve`.
   - Khi gửi: `status = PENDING`, `workflow_step = site_manager_review`, `submitted_to_user_id = người được chọn`.

3. **Quản lý công trường xử lý**
   - Người được giao hoặc Admin có thể xử lý.
   - Nếu duyệt: phiếu vẫn `PENDING`, chuyển `workflow_step = material_department_review`, chọn tiếp người phòng vật tư.
   - Nếu trả lại: hiện tại code đưa phiếu về `DRAFT`, `workflow_step = returned_to_creator`, target về người tạo.
   - Nếu từ chối: `status = REJECTED`, `workflow_step = rejected`.

4. **Phòng vật tư duyệt/xử lý**
   - Người được giao ở `submitted_to_user_id` xử lý.
   - Nếu duyệt: `status = APPROVED`, `workflow_step = batch_planning`.
   - Khi duyệt, hệ thống bắt chọn người phụ trách bước tạo đợt cấp/PO tiếp theo.
   - Nếu phiếu vượt BOQ, chỉ Admin hoặc thủ kho tổng được duyệt qua bước tạo đợt cấp theo logic hiện tại.

5. **Lập đợt cấp hoặc PO**
   - Nếu có hàng trong kho: tạo fulfillment batch từ `RequestModal`.
   - Nếu cần mua: tạo PO từ tab Cung ứng, có link từng dòng qua `purchase_order_request_lines`.
   - Khi tạo đợt cấp từ kho, hệ thống tạo:
     - `material_request_fulfillment_batches.status = issued`
     - `transactions.status = PENDING`
     - request chuyển sang `IN_TRANSIT`/`site_quality_check`.

6. **Thủ kho công trường duyệt số lượng/chất lượng**
   - Transaction đang `PENDING` xuất hiện ở `Operations`.
   - Với fulfillment transfer, thủ kho công trường/kho đích có thể duyệt SL/CL.
   - Sau duyệt: transaction chuyển `APPROVED`, request hiển thị sang `site_receipt`.

7. **Xác nhận nhận hàng/nhập kho**
   - Thủ kho kho nhận xác nhận nhận.
   - Transaction chuyển `COMPLETED`; RPC cập nhật tồn kho.
   - Batch chuyển `received`; request được sync lại.
   - Nếu đã nhận đủ phần cam kết: `status = COMPLETED`, `workflow_step = completed`.
   - Nếu còn thiếu: quay lại `batch_planning` để xử lý phần còn lại.

## 5. Quyền của từng nhóm user

| Nhóm user | Quyền chính trong yêu cầu vật tư | Ghi chú |
|---|---|---|
| `ADMIN` | Xem/xử lý gần như toàn bộ, duyệt WMS, nhận hàng, thao tác PO hạn chế | DB/RPC có nhiều nhánh `public.is_admin()` hoặc module admin. |
| Người tạo phiếu | Tạo nháp, sửa nháp, gửi duyệt, nhận phiếu bị trả lại | Với project request cần có quyền `submit` hoặc quyền quản trị tab tương ứng. |
| Nhân sự dự án có `submit` | Có thể gửi yêu cầu trong phạm vi dự án | Kiểm bởi PBAC trong `project_staff_permissions`. |
| Nhân sự dự án có `approve` | Có thể được chọn làm người duyệt các bước request vật tư | Thực tế người đang được giao là `submitted_to_user_id`. |
| Người đang được giao xử lý | Duyệt/chuyển bước/trả lại trong bước hiện tại | UI kiểm `submitted_to_user_id === user.id`, trừ Admin. |
| Thủ kho tổng (`WAREHOUSE_KEEPER` không gán kho) | Duyệt WMS toàn cục, cấp hàng, xử lý vượt BOQ, thao tác PO hạn chế | `isGlobalWarehouseKeeper`. |
| Thủ kho theo kho | Duyệt/nhận các transaction thuộc kho mình | Kho nguồn duyệt xuất/chuyển thường; kho đích/công trường duyệt fulfillment transfer và xác nhận nhận. |
| Người có `confirm` | Được chọn là người nhận/xác nhận PO khi gửi PO | Lưu ý: UI PO hiện vẫn gate nút duyệt bằng `canManageTab`; DB policy có cho current handler/`confirm`. |
| Module/tab admin | Quản trị tab, tạo/sửa/duyệt tùy màn hình | Được truyền qua `canManageTab`, `canManageRequest` từ phân quyền tab. |

## 6. Luồng nhập/xuất/chuyển kho WMS

WMS transaction dùng `TransactionStatus`:

| Status | Ý nghĩa | Ai xử lý |
|---|---|---|
| `PENDING` | Phiếu mới tạo, chờ duyệt | Admin, thủ kho tổng, hoặc thủ kho đúng kho theo loại phiếu. |
| `APPROVED` | Đã duyệt, chờ kho nhận xác nhận | Dùng cho nhập kho/chuyển kho hoặc fulfillment transfer. |
| `COMPLETED` | Đã hoàn tất và đã cập nhật tồn | RPC `process_transaction_status` gọi `apply_stock_change`. |
| `CANCELLED` | Từ chối/hủy | Người có quyền duyệt hoặc người tạo trong một số nhánh. |

Quy tắc chính:

- `IMPORT`: duyệt bởi thủ kho kho nhận; sau duyệt thường chờ xác nhận nhận.
- `EXPORT`/`LIQUIDATION`: duyệt là hoàn tất luôn và trừ kho.
- `TRANSFER`: duyệt xong chờ kho đích nhận; khi nhận thì trừ kho nguồn và cộng kho đích.
- Fulfillment batch transfer có điểm đặc biệt: thủ kho công trường/kho đích có quyền duyệt SL/CL trước khi nhận.

## 7. Luồng tạo đơn hàng PO

PO dùng `POStatus`:

| Status | Ý nghĩa | Thao tác chính |
|---|---|---|
| `draft` | Nháp | Tạo/sửa PO, có thể từ dòng yêu cầu vật tư. |
| `sent` | Đã gửi | Chọn người nhận/xác nhận PO có quyền `confirm`. |
| `confirmed` | Đã duyệt/đặt hàng | Có thể đánh dấu đang giao. |
| `in_transit` | Đang giao | Nếu PO link với request, hệ thống tạo batch/transaction chờ nhập. |
| `partial` | Đã nhận một phần | Có thể nhận tiếp hoặc kết thúc thiếu. |
| `delivered` | Hoàn thành giao | Có thể đóng PO. |
| `closed` | Đã đóng | Có thể hoàn trả nếu đủ điều kiện. |
| `returned` | Hoàn hàng | Không còn thao tác trạng thái. |
| `cancelled` | Hủy | Không còn thao tác trạng thái. |

Khi tạo PO từ đề xuất:

- Người dùng chọn dòng yêu cầu còn thiếu.
- Hệ thống tạo PO theo nhà cung cấp.
- Bảng `purchase_order_request_lines` lưu link từ PO line về request line.
- Khi PO `in_transit`, hệ thống tạo fulfillment batch nguồn `po_receipt` và transaction `IMPORT/PENDING`.
- Khi nhận PO, tồn kho được cập nhật, batch/request được sync lại.

## 8. Luồng yêu cầu tổng quát và workflow engine

Module `RQ` tổng quát không phải luồng vật tư:

- Bảng: `request_instances`, `request_logs`.
- Approver nằm trong mảng `approvers`.
- Duyệt tuần tự bằng RPC `process_request_step`.
- State: `DRAFT`, `PENDING`, `APPROVED`, `IN_PROGRESS`, `DONE`, `REJECTED`, `CANCELLED`.

Workflow engine `WF` cũng tách riêng:

- Bảng: `workflow_templates`, `workflow_nodes`, `workflow_edges`, `workflow_instances`.
- Có thể thêm bước bằng builder: thêm node `APPROVAL` và nối edge.
- Phù hợp với quy trình động. Yêu cầu vật tư hiện tại lại là workflow code-driven, không chạy qua builder WF.

## 9. Kiến trúc mục tiêu: đề xuất dự án chạy theo workflow động

Yêu cầu mục tiêu của anh là hợp lý: các đề xuất trong module Dự án không nên hard-code theo từng bước như hiện tại. Nên chuyển sang một runtime workflow dùng chung, tương tự module Quy trình:

- Có **mẫu workflow**.
- Có **các bước xử lý**.
- Mỗi bước khi chuyển tới đều phải **gán người chịu trách nhiệm**.
- Người đang được gán ở bước hiện tại là người có quyền **duyệt, trả lại, từ chối**.
- Nếu bị trả lại, người tạo sửa rồi gửi lại vào vòng xử lý.
- Luồng khép kín cho tới khi `COMPLETED`, `REJECTED` hoặc `CANCELLED`.

### 9.1. Nguyên tắc quyền mới

Quyền xử lý nên xoay quanh current assignee:

| Vai trò | Quyền trong workflow động |
|---|---|
| Người tạo | Tạo nháp, sửa khi `draft` hoặc `returned`, gửi lại sau khi bị trả lại. |
| Current assignee | Duyệt/chuyển bước, trả lại, từ chối trong bước đang được gán. |
| Người được gán bước kế tiếp | Chỉ có quyền sau khi bước được chuyển tới họ. |
| Watcher/người theo dõi | Xem timeline, không xử lý nếu không được gán. |
| Admin/module admin | Override, gán lại, rollback, huỷ khi cần. |

Các permission như `approve`, `confirm`, `verify` lúc này chỉ nên dùng để **lọc danh sách người có thể được chọn**, không phải là quyền xử lý trực tiếp. Quyền xử lý trực tiếp là: "có phải người đang được gán ở bước hiện tại không".

### 9.2. State chuẩn cho workflow động

Nên tách rõ 3 lớp state:

| Lớp | State đề xuất | Ý nghĩa |
|---|---|---|
| Document | `draft`, `submitted/running`, `returned`, `rejected`, `completed`, `cancelled` | Trạng thái tổng của phiếu. |
| Workflow run | `RUNNING`, `RETURNED`, `REJECTED`, `COMPLETED`, `CANCELLED` | Trạng thái vòng đời workflow. |
| Step assignment | `PENDING`, `APPROVED`, `RETURNED`, `REJECTED`, `SKIPPED` | Trạng thái từng lần giao việc ở từng bước. |

Với vật tư, vẫn giữ state nghiệp vụ để phục vụ WMS:

- `APPROVED`: đã qua phê duyệt, được phép lập đợt cấp/PO.
- `IN_TRANSIT`: đang cấp/đang giao.
- `COMPLETED`: đã nhận xong.

Nhưng phần phê duyệt nên do workflow runtime quyết định, không hard-code bằng `workflow_step`.

### 9.3. Data model đề xuất

Có 2 hướng triển khai.

**Hướng 1: tái sử dụng module WF hiện có**

- Dùng `workflow_templates`, `workflow_nodes`, `workflow_edges` để tạo mẫu và bước.
- Tạo `workflow_instances` cho từng đề xuất.
- Gắn đề xuất với instance bằng một bảng mapping:

```text
workflow_subjects
- id
- workflow_instance_id
- subject_type       -- material_request, purchase_order, payment_certificate...
- subject_id
- project_id
- construction_site_id
```

Ưu điểm: tận dụng builder sẵn có. Nhược điểm: module WF hiện tại còn khá tổng quát, cần adapter để hiểu từng loại chứng từ dự án.

**Hướng 2: tạo runtime riêng cho project documents**

Các bảng đề xuất:

```text
project_workflow_templates
project_workflow_steps
project_workflow_runs
project_workflow_assignments
project_workflow_actions
```

Ưu điểm: đúng nghiệp vụ dự án hơn, dễ gắn với WMS/PO/thanh toán. Nhược điểm: phải làm builder mới hoặc copy nhiều logic từ WF.

Khuyến nghị: bắt đầu bằng **hướng 1**, nhưng thêm adapter/mapping rõ ràng. Không nên tạo thêm một workflow engine thứ hai nếu module WF đã có phần mẫu/bước/instance.

### 9.4. Action chuẩn

| Action | Điều kiện | Kết quả |
|---|---|---|
| `SUBMIT` | Người tạo gửi nháp | Tạo workflow instance/run, gán bước đầu tiên. |
| `APPROVE_AND_FORWARD` | Current assignee duyệt | Đóng assignment hiện tại, chọn người cho bước kế tiếp. |
| `RETURN` | Current assignee trả lại | Phiếu về người tạo sửa, ghi rõ bước/người trả lại. |
| `RESUBMIT` | Người tạo gửi lại sau khi sửa | Quay lại đúng bước đã trả lại, mặc định gán lại người đã trả hoặc cho chọn người khác. |
| `REJECT` | Current assignee từ chối | Kết thúc workflow ở trạng thái rejected. |
| `COMPLETE` | Đến node kết thúc | Hoàn tất phê duyệt; mở tiếp nghiệp vụ WMS/PO nếu có. |
| `REASSIGN` | Admin hoặc current assignee được phép | Gán lại người chịu trách nhiệm hiện tại. |

Điểm mấu chốt: khi chuyển bước, hệ thống **bắt buộc chọn assignee của bước mới**. Không có trạng thái "chờ chung chung".

### 9.5. Vòng lặp khép kín khi bị trả lại

Luồng nên là:

```text
Người tạo gửi
  -> Assignee bước 1 duyệt
  -> Assignee bước 2 trả lại
  -> Người tạo sửa
  -> Gửi lại đúng bước 2
  -> Assignee bước 2 duyệt
  -> Bước tiếp theo...
  -> Hoàn thành
```

Không nên tự động reset về bước đầu, trừ khi template hoặc người trả lại chọn rõ "trả về bước đầu". Như vậy audit rõ hơn và người tạo không phải chạy lại toàn bộ luồng không cần thiết.

### 9.6. Ví dụ thêm bước Phòng QLDA trong mô hình mới

Nếu đã có workflow động, thêm bước QLDA không cần sửa code nghiệp vụ:

1. Vào mẫu workflow "Đề xuất vật tư dự án".
2. Chèn step `Phòng QLDA duyệt` sau `Quản lý công trường duyệt`.
3. Cấu hình bước:
   - Loại: Approval.
   - Assignee mode: chọn người khi chuyển bước.
   - Eligible users: nhóm Phòng QLDA, hoặc người có permission `qlda_approve`.
   - SLA: ví dụ 24h.
4. Lưu mẫu.
5. Các phiếu mới chạy theo template mới.

Luồng khi chạy:

```text
Người tạo
  -> chọn Quản lý CT
  -> Quản lý CT duyệt, chọn người Phòng QLDA
  -> Phòng QLDA duyệt, chọn người Phòng vật tư
  -> Phòng vật tư duyệt, chọn người lập đợt cấp/PO
  -> Hoàn tất phê duyệt
```

### 9.7. Ranh giới với WMS/PO

Workflow động chỉ nên quyết định phần **ai duyệt/chuyển bước/trả lại/từ chối**.

Nghiệp vụ WMS/PO vẫn giữ engine riêng:

- Sau khi workflow phê duyệt hoàn tất, request vật tư mới được mở quyền tạo đợt cấp hoặc PO.
- Transaction WMS vẫn chịu trách nhiệm kiểm tồn, giữ chỗ, trừ/cộng tồn, xác nhận nhập kho.
- PO vẫn chịu trách nhiệm đặt hàng, giao hàng, nhận hàng.

Nói ngắn gọn: workflow là "đường phê duyệt"; WMS/PO là "thực thi hậu cần".

### 9.8. Kế hoạch triển khai hợp lý

1. Chuẩn hóa mô hình workflow động dùng chung cho project documents.
2. Tạo mapping giữa proposal và workflow instance.
3. Làm component dùng chung:
   - Workflow timeline.
   - Current assignee panel.
   - Forward/return/reject dialog.
   - Reassign dialog.
4. Migrate request vật tư trước vì đang có nhu cầu rõ nhất.
5. Sau đó mở rộng sang PO, nghiệm thu, thanh toán, phát sinh, nhật ký, chất lượng nếu cần.
6. Khi đã ổn, bỏ dần các state hard-code như `site_manager_review`, `material_department_review` khỏi logic UI.

## 10. Cách thêm bước "Phòng QLDA duyệt" trong hệ hiện tại

Mục tiêu: chèn bước mới sau `site_manager_review` và trước `material_department_review`.

Luồng đề xuất:

```text
draft
  -> site_manager_review
  -> qlda_review
  -> material_department_review
  -> batch_planning
  -> site_quality_check
  -> site_receipt
  -> completed
```

### 10.1. Phương án quyền

Có 2 cách:

1. **Nhanh, ít thay đổi:** dùng tiếp permission `approve`. Khi quản lý công trường duyệt, người dùng chọn đích danh nhân sự QLDA trong danh sách người có quyền `approve`. Nhược điểm: danh sách có thể lẫn quản lý công trường/phòng vật tư nếu cùng quyền.
2. **Chặt chẽ hơn:** thêm permission riêng như `qlda_approve` hoặc thêm cấu hình/filter theo vị trí/phòng ban. Khi đó dialog chỉ hiện người thuộc Phòng QLDA. Đây là phương án nên dùng nếu công ty cần kiểm soát phân quyền rõ.

### 10.2. File cần sửa nếu làm theo hướng code-driven hiện tại

1. `types.ts`
   - Thêm `qlda_review` vào `MaterialRequestWorkflowStep`.
   - Thêm `qlda_review` vào `MaterialRequestKanbanStage`.
   - Nếu dùng permission mới, mở rộng `ProjectPermissionCode` trong `projectStaffService`.

2. `lib/materialRequestService.ts`
   - Thêm SLA cho `qlda_review`, ví dụ 24h.
   - Thêm cột Kanban "Chờ Phòng QLDA duyệt".
   - Cập nhật `resolveRequestKanbanStage` để `PENDING + qlda_review` hiện đúng cột.
   - Cập nhật `getDefaultMaterialRequestWorkflowStep` nếu cần fallback từ status/log.

3. `components/project/MaterialRequestKanbanBoard.tsx`
   - Thêm màu `columnTone.qlda_review`.
   - Đổi grid từ 8 cột sang 9 cột và tăng `min-w` cho phù hợp.

4. `pages/project/MaterialTab.tsx`
   - `canMoveMaterialRequest`:
     - đổi `site_manager_review -> material_department_review` thành `site_manager_review -> qlda_review`.
     - thêm `qlda_review -> material_department_review`.
     - cho phép `qlda_review -> closed` nếu người đang được giao xử lý.
   - `handleMoveMaterialRequest`:
     - khi kéo tới `qlda_review`: mở `ProjectSubmissionDialog`, chọn người QLDA.
     - khi kéo tới `material_department_review`: xử lý từ QLDA sang phòng vật tư.
   - `handleProjectWorkflowApproveFromModal`:
     - nếu current step là `site_manager_review`: chuyển sang `qlda_review`.
     - nếu current step là `qlda_review`: chuyển sang `material_department_review`.
     - nếu current step là `material_department_review`: chuyển sang `batch_planning`.
   - `handleProjectWorkflowReturnFromModal`:
     - thêm nhánh cho `qlda_review`.
     - cần quyết định "trả lại" là về người tạo hay về bước quản lý công trường.

5. `components/RequestModal.tsx`
   - `isProjectWorkflowReviewStep` phải nhận thêm `qlda_review`.
   - Label nút duyệt nên map theo step:
     - `site_manager_review`: "Duyệt, gửi Phòng QLDA"
     - `qlda_review`: "Duyệt, gửi Phòng vật tư"
     - `material_department_review`: "Duyệt phiếu"

6. `components/project/ProjectSubmissionDialog.tsx`
   - Nếu dùng permission riêng, truyền `recipientPermissionCodes={['qlda_approve']}` cho bước QLDA.
   - Nếu dùng `approve`, chỉ cần đổi text hướng dẫn để người dùng chọn đúng nhân sự QLDA.

7. Supabase migration
   - Không bắt buộc thêm cột vì `workflow_step` đang là `text`.
   - Nếu thêm permission riêng, cần migration seed `project_permission_types`.
   - Nên chuẩn hóa lại policy `project_doc_can_update_step` theo `lower(p_status)` để không lệch với status `PENDING/APPROVED` của request vật tư.
   - Nên cân nhắc RPC riêng `transition_material_request_step` để DB kiểm from-step, to-step, current handler và quyền target, thay vì để client tự update nhiều trường.

### 10.3. Quy tắc trả lại cho bước QLDA

Hiện tại "trả lại" trong luồng vật tư đang đưa phiếu về người tạo:

```text
any review step -> returned_to_creator + DRAFT
```

Nếu yêu cầu mới là "Phòng QLDA trả lại về quản lý công trường", cần thêm nhánh khác:

```text
qlda_review -> site_manager_review + PENDING
```

Khi đó cần lưu/biết lại người quản lý công trường trước đó. Có 2 cách:

- Lấy từ `material_request_events` gần nhất có `to_step = site_manager_review`.
- Lưu thêm metadata trong request khi forward, ví dụ `previousHandlerUserId` trong event hoặc dùng event hiện có làm nguồn.

Khuyến nghị: dùng event history để xác định previous handler, nhưng khi return nên vẫn cho người QLDA chọn lại người nhận nếu không tìm được handler cũ.

## 11. Rủi ro và điểm nên cải thiện

1. **Workflow vật tư đang phân tán nhiều file.**
   - Step được định nghĩa ở `types`, SLA/cột ở service, quyền move ở `MaterialTab`, review step ở `RequestModal`, màu/cột ở Kanban.
   - Khi thêm bước mới dễ sót.
   - Nên gom thành một cấu hình step trung tâm: id, label, SLA, next step, return step, recipient permission.

2. **Return label chưa khớp hoàn toàn với hành vi.**
   - UI có text "Trả lại bước trước", nhưng code hiện trả về người tạo/nháp.
   - Nếu muốn trả về đúng bước trước, cần sửa state transition.

3. **PO gửi người `confirm`, nhưng UI duyệt PO gate bằng `canManageTab`.**
   - DB policy có hỗ trợ current handler/`confirm`.
   - UI nên cho người được chọn xử lý nếu `submitted_to_user_id === user.id`.

4. **DB chưa có state machine riêng cho material request.**
   - RLS hiện chủ yếu bảo vệ theo current handler/PBAC.
   - Nó chưa kiểm chặt `from_step -> to_step`.
   - Nên thêm RPC transition nếu workflow sẽ tiếp tục mở rộng.

5. **Về dài hạn, nên ưu tiên workflow động thay vì thêm hard-code mới.**
   - Nếu chỉ thêm `qlda_review` bằng code, lần sau thêm một phòng khác lại phải sửa nhiều file.
   - Nếu chuyển sang template workflow, việc thêm/bớt bước sẽ là cấu hình.

## 12. Checklist triển khai bước QLDA trong hệ hiện tại

- [ ] Chốt permission: dùng `approve` hay thêm `qlda_approve`.
- [ ] Thêm `qlda_review` vào type và cấu hình SLA/cột.
- [ ] Cập nhật Kanban 9 cột.
- [ ] Cập nhật logic chuyển bước trong `MaterialTab`.
- [ ] Cập nhật nhận diện review step và label nút trong `RequestModal`.
- [ ] Cập nhật dialog chọn người nhận cho bước QLDA.
- [ ] Nếu cần trả về bước trước, thêm logic return `qlda_review -> site_manager_review`.
- [ ] Tạo migration nếu thêm permission mới hoặc RPC state transition.
- [ ] Test tối thiểu:
  - Người tạo gửi quản lý CT.
  - Quản lý CT duyệt và chọn QLDA.
  - QLDA duyệt và chọn phòng vật tư.
  - QLDA trả lại.
  - Người không phải current handler không duyệt được.
  - Phòng vật tư duyệt sang tạo đợt cấp.
  - Tạo batch, duyệt SL/CL, xác nhận nhập kho.
  - Tạo PO từ dòng yêu cầu, gửi/duyệt/đang giao/nhận.
