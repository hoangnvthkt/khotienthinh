# Bản đồ tích hợp đề xuất

Trạng thái: thiết kế kỹ thuật cho bước tiếp theo, chưa triển khai. Đọc cùng [audit](00-repository-audit.md) và [inventory](01-capability-inventory.csv).

## Ranh giới kiến trúc

```text
App.tsx / Layout / AuthContext / permission engine hiện tại
  └─ Command Center (route mới, feature flag mặc định tắt)
      ├─ Việc cần xử lý, catalog, tác vụ/nháp, lịch sử
      ├─ Hội thoại: intent → resolve → điền form → prepare
      └─ Workspace: renderer thật → review server → nút xác nhận
                      │ JWT của phiên người dùng
                      ▼
          Server gateway + capability registry allowlist
          ├─ query / lookup / draft / prepare / operation status
          ├─ coordinator + provider adapter có giới hạn
          └─ execute (không cung cấp cho model)
                      ▼
          RPC transaction theo domain / app_private owners
          └─ quyền + versions + mutation + audit + result + outbox
                      ▼
          cùng bảng nghiệp vụ và worker hiện có
```

Tên đường dẫn mới dự kiến: `pages/command-center/`, `components/command-center/`, `lib/commandCenter/`, gateway Edge Function và các RPC được đặt tên sau thiết kế contract. Đây là đề xuất, không phải đường dẫn/API đang tồn tại. Giữ `/ai` và các module cũ trong quá trình pilot; trích phần provider dùng chung sau khi củng cố các vấn đề F01/F02.

Không import trực tiếp các browser services dùng singleton `supabase`/React context vào Edge Function. Chia validation thuần và adapter server; cả UI cũ lẫn Center gọi cùng domain RPC. Nếu bổ sung owner function thì giữ wrapper tương thích cho UI cũ.

## Các tuyến tiêu biểu

| Công việc người dùng | Renderer/source | Adapter tới backend hiện có | Điều kiện trước khi mở ở Center |
|---|---|---|---|
| Tìm/xem đề xuất | RequestTable, RequestDetailPanel | `list_request_instances`, `get_request_detail` | Query projection theo quyền; record mở trong workspace; phân trang |
| Tạo/gửi đề xuất | RequestFormFields, phần nội dung RequestCreateDialog | `submit_request` → private owner | Nháp bền vững; template/version/approver canonical; preview, operation receipt |
| Duyệt/trả lại/gửi lại | RequestActionBar, RequestApprovalInspector | `act_on_request` + workflow assignments | Server preview; giữ key qua timeout; refresh quyền và trạng thái; không chỉ đổi toast |
| Tác vụ ngoài dự án | WorkCreateDrawer, WorkDetail | `preview_work_task_recipients`, `create_work_task`, `command_work_task` | Đối chiếu fingerprint hiện có với preview mới; giữ Work lifecycle nguyên trạng |
| Thành viên workspace | WorkSpaceMembers | `preview_work_workspace_members`, `apply_work_workspace_members` | Reuse fingerprint/version; bổ sung preview owner/expiry và status lookup nếu cần |
| Ghi nhận bàn giao tài sản | Tách form từ AssetAssignment | `record_asset_assignment` | F05: state/keeper/revision, actor, idempotency và receipt; không đồng nghĩa duyệt đề nghị |
| Nghỉ phép | Tách form từ LeaveManagement | Hiện tại AppContext → nhiều table writes | F06: cần domain command atomic trước; không mở write qua adapter gọi lại chuỗi client |
| Kế hoạch dự án | ProjectV2PlanDetail, các dialog và action components | `save/submit/approve/return_project_v2_plan_v1` | Giữ revision/lineage/cohort; renderer không phụ thuộc useParams |
| BOQ/kế hoạch vật tư | BoqMaterialPlanningWorkspace, BoqMaterialTree | `list_boq_material_planning_v1`, `save_material_plan_v1`, `convert_material_plan_to_request_v1` | Tôn trọng workspace mới và adapter nguồn; không tạo thêm master kế hoạch |
| Nhu cầu mua hàng | ProcurementV2Inbox/DemandDetail | `list_procurement_dossiers_v2`, `get_procurement_dossier_v2` | Cùng sourceAdapter/snapshotToken và remaining theo allocation |
| PO nhiều đợt | Trích từng phần từ SupplyChainTab và workbench | Command PO/allocation/schedule hiện có | Lock/version đủ child set; ghi riêng giá từng đợt; bulk có outcome từng nhóm |
| Chuyển kho/kiểm kê | WMS workspace/transaction detail | `dispatch_wms_transfer_v1`, `receive_wms_transfer_v1`, `post_wms_inventory_count_v1` | Quyền hai kho, quantities còn lại, ledger và server rollout gate |
| Thanh toán NCC | Phần nội dung ProjectFinanceWorkspace | `save_supplier_payment_batch_draft_v1`, `post_supplier_payment_batch_v2` | Review đúng khoản tiền/đối tượng; phân biệt duyệt đề nghị và ghi nhận thanh toán |
| Nhật ký và công bố tiến độ | Daily-log WBS components | `dailyLogWbsService` → các RPC source/summary/publication | Mỗi action có semantics riêng; giữ pilot shadow/enforced, revision nguồn |
| Báo cáo điều hành | Renderer bảng + drilldown | `list_management_dataset_v1` | Cùng metric definition/lineage; không cộng trùng PO/công nợ/chi phí |
| Tệp đề xuất | RequestDiscussion + requestAttachmentService | reserve + storage + attachment processor | ACL hồ sơ, trạng thái xử lý thật; không coi tên file là upload xong |

## Contract tối thiểu nên chốt

- Registry versioned theo action; có input/output runtime validation, entity/scope resolver, authorization, read/write readiness, renderer, invalidations. Không dùng readiness cấp quyền làm readiness tích hợp.
- Preview giữ canonical payload và dependency revisions ở server; summary trả riêng, không đưa payload bí mật/confirmation challenge vào prompt. Actor lấy từ verified session và mapping canonical user, không từ form.
- Execute dùng preview reference + confirmation + key cố định của attempt. Trong DB thực hiện claim/replay, guards, mutation, audit/outbox/result cùng transaction; ngoài DB dùng retry/dedupe theo worker thật.
- Operation status có accepted/running/committed/no_op/failed/unknown theo thiết kế thực tế; `unknown` mô tả chưa biết kết quả, không khẳng định rollback. Replay cũng phải kiểm quyền truy cập receipt hiện tại.
- Một mutation event chuẩn trả entity refs, resulting versions và invalidation tags. Adapter UI cũ và Center cùng refresh service/context tương ứng; kiểm tra cả hai màn hình đồng thời mở.
- Draft của Center là working copy có owner/revision/schemaVersion, không phải bản sao hồ sơ nghiệp vụ. Khi domain đã có draft thật, lưu reference và dùng draft thật; khi chưa có, chỉ tạo record nghiệp vụ tại submit theo rule hiện hữu.
- Không nhận SQL, URL endpoint hoặc component name tự do từ model. Dùng query allowlist, typed filter, pagination, projection theo field và giới hạn tool chain.

## UX implementation brief

Một session task giữ draft, entity, scope, selected rows, scroll, phase và operation. Đặt state trên renderer để đổi tab/fullscreen không mất dữ liệu; lazy-load renderer và chỉ giữ số lượng view nặng cần thiết. Renderer còn gắn route cần props cho entity và callbacks thay `useNavigate` trực tiếp. Sau thành công hiển thị receipt có mã hồ sơ, kết quả bước hiện tại và action tiếp theo đã được cấp quyền.

Acceptance: desktop 1440px, tablet khoảng 768px, mobile khoảng 390px; kiểm breakpoint theo nội dung thực. Kiểm keyboard/focus, drawer/modal, bàn phím ảo, lỗi lookup/upload, draft đổi scope, hết phiên, reload khi executing và mở cùng hồ sơ tại UI cũ. Các kích thước là viewport test đề xuất, chưa đo production.
