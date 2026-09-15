# E22 — Audit `system.wms.manage` theo consumer và persona

Cloud main `ftciqmqhmfvjtwoycswe`, snapshot read-only ngày 2026-09-15. Tài liệu này không chứa user ID, email, token hoặc dữ liệu nghiệp vụ; nó là bằng chứng mapping và đề xuất, chưa phải manifest executable.

## Số liệu hiện hành

| Chỉ số | Kết quả |
|---|---:|
| Active `system.wms.manage` grants | 23 |
| Tài khoản có shell manage | 23 |
| Scope shell | 23 `global/*` |
| Persona role | 1 Admin, 17 Employee không gán kho, 3 thủ kho toàn kho, 2 thủ kho gán kho |
| Canonical direct grants đã có ở cả 23 actor | `wms.inventory.view`, `wms.master_data.manage`, `wms.request.view`, `wms.transaction.view` |
| Canonical direct grants thao tác nhạy cảm đã có từ shell snapshot | Chưa có |
| Function consumers còn trực tiếp/gián tiếp dùng boundary WMS | 10 |
| Policy rows dùng `wms_has_action` | 17 |
| Transition batch/item thật | 0 / 0 |

Bốn grant canonical hiện có giải thích quyền đọc và master data, nhưng không chứng minh shell manage có thể thay thế bằng bốn grant đó. Các thao tác tạo, duyệt, hoàn tất, hủy, trả NCC, quyết toán, hoàn tác và xóa yêu cầu vẫn có thể đi qua compatibility của shell.

## Ma trận consumer

| Consumer | Boundary thực tế | Capability canonical ứng viên | Disposition đề xuất E22 | Lý do chưa tự động thay thế |
|---|---|---|---|---|
| `can_manage_warehouse_site_bindings` | 3 RPC binding/enforcement kho–công trường | `settings.warehouses.manage`, `wms.master_data.manage` | `manual_review` theo actor | Một endpoint Settings dùng dữ liệu chung; cần kiểm cả Settings và caller nghiệp vụ WMS, không map shell thành quyền chỉnh binding toàn cục. |
| `current_user_can_receive_purchase_batch_v2` | Duyệt chất lượng và finalize nhận PO | `wms.transaction.approve`, `wms.transaction.complete` tại kho đích | `manual_review` theo actor/kho | Shell hiện global; capability mới phải xác định actor nào thực sự cần approve, complete và kho đích nào. |
| `custom_material_request_can_select` | Đọc lựa chọn custom material/storage | `project.custom_material.view` và các Room/PO action liên quan | `retain compatibility` | WMS manage không tương đương quyền custom-material; non-admin vẫn phải view-only theo policy Project. |
| `material_issue_can_cancel` | Hủy phiếu xuất cấp trước khi xuất | `wms.transaction.approve` tại kho nguồn; creator path | `manual_review` theo actor/kho | E15 đã nối capability đúng kho nhưng shell global vẫn là fallback; không suy `system.wms.manage` thành approve mọi kho. |
| `material_issue_can_manage_project` | Tạo/gửi phiếu xuất cấp ở Project/WMS | Project Room `submit/edit`, `wms.transaction.create` tại kho nguồn | `manual_review` | Có nhánh Project/Room và nhánh WMS; một shell global không cho biết actor nào được phép ở project/site hoặc kho cụ thể. |
| `material_issue_has_process_compatibility_access` | Nhận hàng, tạo hoàn, quyết toán, hoàn tác | `complete`, `create`, `wms.material_issue.settle`, `wms.material_issue.reverse_settlement` | `manual_review` | Bốn nghiệp vụ không tương đương; hoàn tác là sensitive và không được mở chỉ vì shell manage. |
| `material_request_wms_can_delete_compatibility` | Xóa yêu cầu WMS | `wms.request.delete` tại kho nguồn/kho công trường | `manual_review` | E20 đã có capability và trạng thái guard, nhưng compatibility còn giữ requester/assignee/keeper/module-admin; cần quyết định theo actor và quan hệ chứng từ. |
| `purchase_order_supplier_return_can_create` | Tạo phiếu trả NCC và WMS export pending | `wms.purchase_order.return_supplier` tại kho nguồn; Project PO manager | `manual_review` | E19 đã có capability riêng, nhưng backend còn compatibility Project PO manager/WMS module-admin rộng hơn UI. |
| `wms_has_action` | 10 function consumers và nhiều WMS policy | Action-specific capability tương ứng từng caller | `retain compatibility` | Đây là boundary dùng chung; bỏ shell ở đây trước khi tách hết caller sẽ làm thay đổi đồng thời nhiều API/RLS policy. |
| `wms_transaction_attachment_can_access` | SELECT/INSERT/DELETE object attachment | `wms.transaction.view` cho đọc; `wms.transaction.approve` cho mutate | `manual_review` | E8 đã tách helper read/mutate nhưng compatibility object-path vẫn giữ shell; cần kiểm owner/requester/kho của từng object. |

## Kết luận theo persona

- Admin: giữ quyền hiện hành; không dùng persona Admin để chứng minh Employee có thể thay shell bằng capability rộng.
- 17 Employee không gán kho: shell global hiện có thể đi qua các fallback không có scope. Chưa có bằng chứng an toàn để cấp hàng loạt capability warehouse/global thay thế.
- 3 thủ kho toàn kho: có thể tiếp tục compatibility trong giai đoạn chuyển tiếp; nếu thay thế phải ghi rõ capability global nào được owner duyệt.
- 2 thủ kho gán kho: cần mapping theo assigned warehouse và kiểm sai kho; không dùng `scope_id = '*'` làm thay thế mặc định.

## Quyết định E22

E22 đã hoàn tất phần audit và làm rõ lý do cho toàn bộ 23 source. Không có source nào đủ bằng chứng để tự động đưa vào `replace` hoặc `revoke` ở cấp tài khoản chỉ từ snapshot hiện tại; đề xuất an toàn là giữ `manual_review`/compatibility cho tới khi owner duyệt từng nhóm consumer và persona.

Không apply batch, không grant/revoke tài khoản và không thay đổi schema trong E22. Bước tiếp theo là E23: kiểm tra các cohort ngoài WMS và đồng thời thu thập quyết định owner cho các nhóm WMS cần thay thế; chỉ sau đó mới sinh manifest có định danh trong evidence store riêng.
