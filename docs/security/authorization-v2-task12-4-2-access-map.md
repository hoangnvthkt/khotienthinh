# Task 12.4.2 — Access map và chốt phạm vi

Base `abc35de`; Cloud inventory 2026-09-14 08:20:54 UTC. Đây là bản đồ implementation, không xác nhận các quyền đề xuất đã enforce.

## Quy tắc đối chiếu

- Danh sách đầy đủ 87 submodule registry và route/action/scope: [surfaces](authorization-v2-task12-4-2-surfaces.md). Catalog active/assignable và metadata Settings thực tế: [Cloud inventory](authorization-v2-task12-4-2-inventory.json).
- Chọn đúng quyền cho tài nguyên và thao tác, giữ scope; không suy “view” thành mọi dữ liệu hoặc “manage” thành mọi hành động.
- Một bảng có nhiều consumer hợp lệ: gỡ quyền vào mục Cài đặt không tự cấm đọc cùng dữ liệu danh mục phục vụ chứng từ WMS/Project nếu người đó vẫn có quyền nghiệp vụ tương ứng. Summary phải giải thích nguồn còn lại. Kiểm deny chỉ khi mọi nguồn đọc/ghi hợp lệ đều đã hết.
- Mỗi dòng B bên dưới cần cả component test read-only và SQL persona read/write/deny; trước đó capability mới chưa được coi là sẵn sàng cấp.

## Toàn bộ mục Cài đặt

`settings.<feature>.view/manage` dưới đây là tên đề xuất mới trong B. Tất cả scope global cho danh mục dùng chung; không giả vờ kho-specific nếu endpoint không hỗ trợ. Backend cần xét ảnh hưởng tới client nghiệp vụ dùng chung trước khi đổi policy.

| Tab | Consumer/read | Write API hoặc owner | Hợp đồng và chốt B |
|---|---|---|---|
| Chung | SettingsGeneral / app_settings (branding dùng ở bootstrap) | AppContext.updateAppSettings/upsert app_settings | settings.general.view/manage; chỉ manage mới lưu, await server trước toast; giữ đọc branding phục vụ bootstrap |
| Kho bãi | SettingsWarehouses / warehouses, warehouse_types, projects và sites cho binding | create_warehouse_with_site_binding, set_warehouse_construction_site_binding, set_construction_site_warehouse_enforcement; AppContext CRUD warehouse types | settings.warehouses.view/manage; quyền chỉnh binding cần kiểm đầy đủ RPC, không chỉ mở bảng warehouses |
| Dữ liệu gốc | Settings.tsx / items, categories, units, suppliers | AppContext CRUD, nhập Excel cùng bảng | settings.master_data.view/manage; kiểm quyền WMS inventory edit hiện hữu; không cấp manage kho chỉ để sửa vật tư |
| Định mức G8 | SettingsG8CostNormLibrary / costNormImportService / cost_norm_libraries, items, resources, components, import jobs/errors/raw rows/change logs | costNormImportService CRUD và import nhiều bảng | settings.g8_cost_norms.view/manage; import chỉ manage; log/raw source là tài nguyên cần kiểm riêng |
| Danh mục DA | SettingsProjectMasterData / projectMasterDataService + projectMasterService | upsert_project_category, delete_project_category | settings.project_master_data.view/manage; chỉ danh mục groups/types/sectors, không quyền sửa chứng từ hoặc dự án |
| Mẫu nghiệm thu | SettingsInspectionTemplates / qualityChecklistService / inspection_categories, inspection_work_types, inspection_templates, template_sections, inspection_template_items | CRUD template tables | settings.inspection_templates.view/manage; tách khỏi quality_checklists và quality_inspection_attempts do Room quản trị |
| Nhóm làm việc | SettingsWorkGroups / work_groups, work_group_members, users | upsert_work_group, delete_work_group, member CRUD | settings.work_groups.view/manage; không đồng nhất với thành viên Workspace Vioo Work |
| Định mức hao hụt | Settings.tsx / loss_norms | AppContext CRUD loss_norms | settings.loss_norms.view/manage; policy ALL true hiện có phải được thay bằng hợp đồng tài nguyên, kiểm mọi caller trước rollout |
| Danh mục dùng chung HRM | SettingsHrmSharedCatalog / hrmSharedCatalogCapabilities / route /settings/hrm-shared-catalog | HR master-data/organization/staffing commands | tái sử dụng capability HR có scope/template; không cấp HR_MANAGE khi tích Cài đặt |
| Người dùng | SettingsUsers, UserModal / users, snapshot/catalog RPC | update_user_authorization_v2, create-user/lifecycle; command role ở C | quyền quản trị người dùng tách khỏi grant/role management; không nằm trong bundle Xem phổ thông |
| Cảnh báo | SettingsAlerts / notificationAlertRules | notificationAlertRuleService và cấu hình recipient | giữ admin-only trước khi hợp đồng recipient/broadcast được kiểm; không tự cấp trong bundle |
| Permission health | SettingsPermissionHealth | audit/read-only | quyền audit/quản trị hợp lệ; view không cấp manage_grants/manage_roles |
| Trợ lý ảo | SettingsChibiBot / chatbot_messages | insert/update/delete chatbot_messages | settings.chibi_bot.view/manage; read-only khóa cả active-toggle; kiểm lỗi Supabase trước toast |
| AI Learning | SettingsAiLearning / ai_feedback, ai_memory, ai_business_rules, ai_business_glossary, ai_chat_runs | CRUD tương ứng | settings.ai_learning.view/manage là nhạy cảm; loại khỏi bundle phổ thông vì chứa nội dung trao đổi/log; kiểm scope đọc và trường được sửa |
| Phiên bản | SettingsReleaseNotes | release notes service | giữ admin-only theo sản phẩm hiện hành; không bỏ guard máy móc |
| Bảo trì | SettingsMaintenance | AppContext.clearAllData, nhiều lệnh delete | giữ admin-only, không tạo default-view có thể kéo quyền xóa; không chạy destructive action trên Cloud để smoke |
| Tài khoản | SettingsAccount | own profile/signature | self-service, không phụ thuộc grant quản trị Cài đặt |
| Sơ đồ tổ chức | SETTINGS_FEATURES có org-chart nhưng Settings.tsx không có tab tương ứng; route /org-map | HR organization/staffing | giải quyết mismatch metadata, không tạo tab/đường cấp quyền thứ hai |

## Module và owner kiểm API

Mỗi submodule ở surfaces kế thừa owner dưới đây. Trước revoke phải nối tiếp tới từng policy/RPC thực tế và ghi kết quả persona; việc có registry entry chưa chứng minh enforcement.

| Application/family | Owner code/API | Test boundary bắt buộc |
|---|---|---|
| project | projectPermissionService, projectRoomEffectiveActions và các project services/RPC theo Room | project ID/site ID; giữ 10 Room enforced, không replay 7 Room; retired rooms admin-write/non-admin-read |
| wms | wmsPermissions, inventoryLedgerService, warehouseSiteBindingService, AppContext transaction commands | kho A/B; nhận/xuất/duyệt không suy từ quyền danh mục; MISA export cần hợp đồng riêng |
| hrm | hrmSharedCatalogCapabilities, self-service RPC, HR sensitive RLS/template | own attendance/payroll; HR global chỉ qua nguồn hợp lệ; user chưa linked trả rỗng |
| expense | expense/budget services, AppContext expense tables | own/department/global; không mở global khi map shell EX |
| workflow | WorkflowContext, workflow template/instance services, granular template commands | create/edit/publish tách biệt; manager/assignee vẫn phải đúng instance |
| work | Work services và Workspace RPC | Workspace membership, private tasks, attachments; không map work_groups thành Workspace |
| request | Request templates/instances/category services và request RPC | Hương employee view/manage template; quản trị template không tự act trên instance ngoài phân công |
| asset | asset permissions/services, AppContext asset tables | bốn view bundle; assign/approve/maintenance/audit, scope và expiry |
| contract | contract/customer/supplier/subcontract services | quyền đối tác/catalog không kéo quyền hợp đồng khác; project subcontract retired khác với contract application |
| ai | globalModulePermissions, ai-assistant Edge Function | use/reports/executive capabilities, JWT actor; không tin actor ID gửi từ client |
| storage/kb | globalModulePermissions, storage policies và knowledge services | view/upload/manage tách biệt, storage object API không bypass bằng URL |
| analytics | globalModulePermissions và report/export endpoints | view khác export; không mở bằng wildcard system |
| resource_booking | vehicle-booking RPC/services | self-service route được phép theo sản phẩm; dispatch/approve/fleet vẫn kiểm riêng |
| system | Settings, audit, chat, tender/custom-dashboard/EP compatibility | giữ quyền hệ thống thật; consumer chưa có canonical tương đương chặn chuyển đổi source đó |

## Disposition các nguồn quá độ

| Nhóm grant/assignment | Quyết định ở A | Điều kiện F/G |
|---|---|---|
| system.authorization.* | retain: quyền quản trị thật | không xóa theo prefix; sửa metadata/nguồn cấp theo policy cụ thể |
| system.settings.view/manage | giữ trong lúc B/C hoàn thiện; manage direct hiện không phải nguồn resolver hợp lệ | thay bằng feature rights/role SYSTEM_ADMIN phù hợp; tuyệt đối không map view thành mọi manage |
| system.da.*, system.rq.*, system.ts.*, system.wf.*, system.wms.*, system.ex.*, system.hd.* | cần reconcile từng source với quyền nghiệp vụ/Room/scopes | không map rộng từ tên module; missing mapping hoặc quyền tăng là review chứ không auto-apply |
| system.ai.*, system.storage.*, system.kb.*, system.analytics.* | đối chiếu consumer canonical tương ứng | giữ use/read/export/expiry đúng hiện trạng và quyết định nghiệp vụ |
| system.chat.*, system.ep.*, system.tender_ai.*, system.custom_dashboard.*, system.procurement.* | retain/manual_review tùy consumer; chưa có phép thay thế một-một được chứng minh | cần kiểm canonical ownership/capability trước khi revoke; thiếu app active không đồng nghĩa quyền vô dụng |
| system.audit_trail.* | giữ audit hợp lệ, kiểm read/manage riêng | không làm mất audit của operator trong chuyển đổi |
| LEGACY_HR_0923012A0F922B85 (2 active), LEGACY_HR_1F11EEEB6E9FBB4F (46), LEGACY_HR_D460548B832323EE (1), LEGACY_HR_FD9FD9BA9D958E2C (5) | giữ nguyên cho tới khi F so tập capability/scope từng template | không thay bằng HR/HR_MANAGE đại trà; bảo toàn own, sensitive/template-only và các assignment độc lập |
| Grant/assignment inactive hoặc expired | không coi là quyền hiện hành | snapshot giữ lịch sử; migration không hồi sinh và không auto reactivate |

## Persona và tiêu chí checkpoint

- Hà: Asset bốn Xem; không có HR documents thì menu/URL/API tài liệu không mở; own công/lương.
- Hương: Request template view/manage cấp trực tiếp; kiểm thêm/bớt trên client đang mở và reload; còn source shell/role phải hiển thị rõ.
- Admin: Cài đặt và role transition; không mặc định payroll quản trị; không hạ admin cuối cùng hoặc tự vượt grant scope.
- Thủ kho A, thủ kho B, chế độ toàn kho tường minh: không nâng scope qua giá trị null/ngầm định.
- HR/HR_MANAGE: quyền HR hợp lệ không mất khi đổi loại tài khoản; nhân viên không được xem lương người khác.
- Room/Workspace member: gỡ DIRECT không thu hồi quyền ở nguồn khác; trả đúng provenance.
- Inactive/chưa linked: không mất lịch sử, không truy dữ liệu người khác, reactivation không hồi sinh nguồn đã thu hồi.

Inventory/scanner/SQL inspection là bằng chứng A. Exit B–H còn đòi hỏi test runtime và authenticated SQL, snapshot/restore, release/persona và observation thật.
