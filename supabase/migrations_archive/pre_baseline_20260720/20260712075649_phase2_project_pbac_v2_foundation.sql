-- Phase 2 Project PBAC v2 foundation.
-- Direct-query rollout migration. Extends Phase 1 permission framework with project-scoped grants.

create schema if not exists app_private;

insert into public.permission_modules (application_code, code, name, routes, legacy_module_key, sort_order)
values
  ('project', 'project.overview', 'Tổng quan dự án', array['/da']::text[], 'DA', 10),
  ('project', 'project.org', 'Tổ chức dự án', array['/da/tabs/org']::text[], 'DA', 20),
  ('project', 'project.executive', 'Điều hành', array['/da/tabs/executive']::text[], 'DA', 30),
  ('project', 'project.daily_log', 'Nhật ký dự án', array['/da/tabs/dailylog']::text[], 'DA', 40),
  ('project', 'project.material_request', 'Đề xuất vật tư', array['/da/tabs/material','/da/tabs/supply','/da/tabs/material/summary','/da/tabs/material/request','/da/tabs/material/waste','/da/tabs/material/dashboard']::text[], 'DA', 50),
  ('project', 'project.material_plan', 'Kế hoạch vật tư', array['/da/tabs/material/planning']::text[], 'DA', 60),
  ('project', 'project.material_boq', 'BOQ vật tư', array['/da/tabs/material/boq']::text[], 'DA', 70),
  ('project', 'project.material_po', 'Đơn hàng PO dự án', array['/da/tabs/material/po']::text[], 'DA', 80),
  ('project', 'project.custom_material', 'Vật tư phi tiêu chuẩn', array['/da/tabs/material/custom']::text[], 'DA', 90),
  ('project', 'project.gantt', 'Tiến độ Gantt', array['/da/tabs/gantt']::text[], 'DA', 100),
  ('project', 'project.weekly_progress', 'Chốt tiến độ tuần', array['/da/tabs/weekly_progress']::text[], 'DA', 110),
  ('project', 'project.contract', 'Hợp đồng', array['/da/tabs/contract']::text[], 'DA', 120),
  ('project', 'project.subcontract', 'Nhà thầu phụ', array['/da/tabs/subcontract']::text[], 'DA', 130),
  ('project', 'project.payment', 'Nghiệm thu và thanh toán', array['/da/tabs/payment']::text[], 'DA', 140),
  ('project', 'project.quantity_acceptance', 'Nghiệm thu khối lượng', array['/da/tabs/payment']::text[], 'DA', 150),
  ('project', 'project.cashflow', 'Dòng tiền', array['/da/tabs/finance','/da/tabs/cashflow']::text[], 'DA', 160),
  ('project', 'project.budget', 'Ngân sách', array['/da/tabs/budget']::text[], 'DA', 170),
  ('project', 'project.quality', 'Chất lượng', array['/da/tabs/quality']::text[], 'DA', 180),
  ('project', 'project.safety', 'An toàn', array['/da/tabs/safety']::text[], 'DA', 190),
  ('project', 'project.documents', 'Tài liệu', array['/da/tabs/documents']::text[], 'DA', 200),
  ('project', 'project.report', 'Báo cáo', array['/da/tabs/report']::text[], 'DA', 210)
on conflict (code) do update
set application_code = excluded.application_code,
    name = excluded.name,
    routes = excluded.routes,
    legacy_module_key = excluded.legacy_module_key,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.permission_actions (
  module_code,
  action,
  permission_code,
  label,
  scope_modes,
  legacy_module_key,
  legacy_route,
  legacy_admin_only,
  sort_order
)
values
  ('project.overview', 'view', 'project.overview.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da', false, 10),
  ('project.overview', 'manage', 'project.overview.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da', true, 20),
  ('project.org', 'view', 'project.org.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/org', false, 10),
  ('project.org', 'assign_staff', 'project.org.assign_staff', 'Phân bổ nhân sự', array['global','project','construction_site']::text[], 'DA', '/da/tabs/org', true, 20),
  ('project.org', 'grant_permissions', 'project.org.grant_permissions', 'Cấp quyền', array['global','project','construction_site']::text[], 'DA', '/da/tabs/org', true, 30),
  ('project.org', 'manage', 'project.org.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/org', true, 40),
  ('project.executive', 'view', 'project.executive.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/executive', false, 10),
  ('project.executive', 'manage', 'project.executive.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/executive', true, 20),
  ('project.daily_log', 'view', 'project.daily_log.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', false, 10),
  ('project.daily_log', 'create', 'project.daily_log.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 20),
  ('project.daily_log', 'edit_own', 'project.daily_log.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 30),
  ('project.daily_log', 'edit_all', 'project.daily_log.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 40),
  ('project.daily_log', 'delete_own', 'project.daily_log.delete_own', 'Xóa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 50),
  ('project.daily_log', 'delete_all', 'project.daily_log.delete_all', 'Xóa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 60),
  ('project.daily_log', 'submit', 'project.daily_log.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 70),
  ('project.daily_log', 'return', 'project.daily_log.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 80),
  ('project.daily_log', 'verify', 'project.daily_log.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 90),
  ('project.daily_log', 'confirm', 'project.daily_log.confirm', 'Xác nhận', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 100),
  ('project.daily_log', 'approve', 'project.daily_log.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 110),
  ('project.daily_log', 'manage', 'project.daily_log.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/dailylog', true, 120),
  ('project.material_request', 'view', 'project.material_request.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', false, 10),
  ('project.material_request', 'create', 'project.material_request.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 20),
  ('project.material_request', 'edit_own', 'project.material_request.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 30),
  ('project.material_request', 'edit_all', 'project.material_request.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 40),
  ('project.material_request', 'delete_own', 'project.material_request.delete_own', 'Xóa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 50),
  ('project.material_request', 'delete_all', 'project.material_request.delete_all', 'Xóa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 60),
  ('project.material_request', 'submit', 'project.material_request.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 70),
  ('project.material_request', 'return', 'project.material_request.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 80),
  ('project.material_request', 'verify', 'project.material_request.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 90),
  ('project.material_request', 'confirm', 'project.material_request.confirm', 'Xác nhận', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 100),
  ('project.material_request', 'approve', 'project.material_request.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 110),
  ('project.material_request', 'manage', 'project.material_request.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material', true, 120),
  ('project.material_request', 'view_available_stock', 'project.material_request.view_available_stock', 'Xem tồn khả dụng', array['global','project','construction_site','warehouse']::text[], 'DA', '/da/tabs/material', false, 130),
  ('project.material_plan', 'view', 'project.material_plan.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/planning', false, 10),
  ('project.material_plan', 'edit', 'project.material_plan.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/planning', true, 20),
  ('project.material_plan', 'manage', 'project.material_plan.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/planning', true, 30),
  ('project.material_boq', 'view', 'project.material_boq.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/boq', false, 10),
  ('project.material_boq', 'edit', 'project.material_boq.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/boq', true, 20),
  ('project.material_boq', 'delete', 'project.material_boq.delete', 'Xóa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/boq', true, 30),
  ('project.material_boq', 'manage', 'project.material_boq.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/boq', true, 40),
  ('project.material_po', 'view', 'project.material_po.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/po', false, 10),
  ('project.material_po', 'create', 'project.material_po.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/po', true, 20),
  ('project.material_po', 'approve', 'project.material_po.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/po', true, 30),
  ('project.material_po', 'receive', 'project.material_po.receive', 'Nhận hàng', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/po', true, 40),
  ('project.material_po', 'manage', 'project.material_po.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/po', true, 50),
  ('project.custom_material', 'view', 'project.custom_material.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/custom', false, 10),
  ('project.custom_material', 'create', 'project.custom_material.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/custom', true, 20),
  ('project.custom_material', 'approve', 'project.custom_material.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/custom', true, 30),
  ('project.custom_material', 'manage', 'project.custom_material.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/material/custom', true, 40),
  ('project.gantt', 'view', 'project.gantt.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', false, 10),
  ('project.gantt', 'edit', 'project.gantt.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 20),
  ('project.gantt', 'approve_completion', 'project.gantt.approve_completion', 'Duyệt hoàn thành', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 30),
  ('project.gantt', 'manage', 'project.gantt.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/gantt', true, 40),
  ('project.weekly_progress', 'view', 'project.weekly_progress.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', false, 10),
  ('project.weekly_progress', 'create', 'project.weekly_progress.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 20),
  ('project.weekly_progress', 'edit_all', 'project.weekly_progress.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 30),
  ('project.weekly_progress', 'submit', 'project.weekly_progress.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 40),
  ('project.weekly_progress', 'verify', 'project.weekly_progress.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 50),
  ('project.weekly_progress', 'approve', 'project.weekly_progress.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 60),
  ('project.weekly_progress', 'manage', 'project.weekly_progress.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/weekly_progress', true, 70),
  ('project.contract', 'view', 'project.contract.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', false, 10),
  ('project.contract', 'create', 'project.contract.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 20),
  ('project.contract', 'edit_all', 'project.contract.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 30),
  ('project.contract', 'approve', 'project.contract.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 40),
  ('project.contract', 'manage', 'project.contract.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/contract', true, 50),
  ('project.subcontract', 'view', 'project.subcontract.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/subcontract', false, 10),
  ('project.subcontract', 'create', 'project.subcontract.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/subcontract', true, 20),
  ('project.subcontract', 'edit_all', 'project.subcontract.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/subcontract', true, 30),
  ('project.subcontract', 'approve', 'project.subcontract.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/subcontract', true, 40),
  ('project.subcontract', 'manage', 'project.subcontract.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/subcontract', true, 50),
  ('project.payment', 'view', 'project.payment.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', false, 10),
  ('project.payment', 'create', 'project.payment.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 20),
  ('project.payment', 'edit_own', 'project.payment.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 30),
  ('project.payment', 'edit_all', 'project.payment.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 40),
  ('project.payment', 'delete_own', 'project.payment.delete_own', 'Xóa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 50),
  ('project.payment', 'delete_all', 'project.payment.delete_all', 'Xóa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 60),
  ('project.payment', 'submit', 'project.payment.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 70),
  ('project.payment', 'return', 'project.payment.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 80),
  ('project.payment', 'verify', 'project.payment.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 90),
  ('project.payment', 'confirm', 'project.payment.confirm', 'Xác nhận', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 100),
  ('project.payment', 'approve', 'project.payment.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 110),
  ('project.payment', 'manage', 'project.payment.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 120),
  ('project.payment', 'mark_paid', 'project.payment.mark_paid', 'Đánh dấu đã thanh toán', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 130),
  ('project.quantity_acceptance', 'view', 'project.quantity_acceptance.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', false, 10),
  ('project.quantity_acceptance', 'create', 'project.quantity_acceptance.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 20),
  ('project.quantity_acceptance', 'submit', 'project.quantity_acceptance.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 30),
  ('project.quantity_acceptance', 'verify', 'project.quantity_acceptance.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 40),
  ('project.quantity_acceptance', 'approve', 'project.quantity_acceptance.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 50),
  ('project.quantity_acceptance', 'manage', 'project.quantity_acceptance.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/payment', true, 60),
  ('project.cashflow', 'view', 'project.cashflow.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/cashflow', false, 10),
  ('project.cashflow', 'manage', 'project.cashflow.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/cashflow', true, 20),
  ('project.budget', 'view', 'project.budget.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/budget', false, 10),
  ('project.budget', 'edit', 'project.budget.edit', 'Sửa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/budget', true, 20),
  ('project.budget', 'manage', 'project.budget.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/budget', true, 30),
  ('project.quality', 'view', 'project.quality.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', false, 10),
  ('project.quality', 'create', 'project.quality.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 20),
  ('project.quality', 'edit_own', 'project.quality.edit_own', 'Sửa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 30),
  ('project.quality', 'edit_all', 'project.quality.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 40),
  ('project.quality', 'delete_own', 'project.quality.delete_own', 'Xóa của mình', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 50),
  ('project.quality', 'delete_all', 'project.quality.delete_all', 'Xóa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 60),
  ('project.quality', 'submit', 'project.quality.submit', 'Gửi', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 70),
  ('project.quality', 'return', 'project.quality.return', 'Trả lại', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 80),
  ('project.quality', 'verify', 'project.quality.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 90),
  ('project.quality', 'confirm', 'project.quality.confirm', 'Xác nhận', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 100),
  ('project.quality', 'approve', 'project.quality.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 110),
  ('project.quality', 'manage', 'project.quality.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/quality', true, 120),
  ('project.safety', 'view', 'project.safety.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', false, 10),
  ('project.safety', 'create', 'project.safety.create', 'Tạo', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 20),
  ('project.safety', 'edit_all', 'project.safety.edit_all', 'Sửa tất cả', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 30),
  ('project.safety', 'verify', 'project.safety.verify', 'Kiểm tra', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 40),
  ('project.safety', 'approve', 'project.safety.approve', 'Duyệt', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 50),
  ('project.safety', 'manage', 'project.safety.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/safety', true, 60),
  ('project.documents', 'view', 'project.documents.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', false, 10),
  ('project.documents', 'upload', 'project.documents.upload', 'Tải lên', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 20),
  ('project.documents', 'delete', 'project.documents.delete', 'Xóa', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 30),
  ('project.documents', 'manage', 'project.documents.manage', 'Quản trị', array['global','project','construction_site']::text[], 'DA', '/da/tabs/documents', true, 40),
  ('project.report', 'view', 'project.report.view', 'Xem', array['global','project','construction_site']::text[], 'DA', '/da/tabs/report', false, 10),
  ('project.report', 'export', 'project.report.export', 'Xuất dữ liệu', array['global','project','construction_site']::text[], 'DA', '/da/tabs/report', true, 20)
on conflict (permission_code) do update
set module_code = excluded.module_code,
    action = excluded.action,
    label = excluded.label,
    scope_modes = excluded.scope_modes,
    legacy_module_key = excluded.legacy_module_key,
    legacy_route = excluded.legacy_route,
    legacy_admin_only = excluded.legacy_admin_only,
    sort_order = excluded.sort_order,
    is_active = true,
    updated_at = now();

insert into public.project_permission_types (code, name, module, description, sort_order, is_active)
values
  ('view', 'Xem', null, 'Legacy generic Project view permission.', 10, true),
  ('edit', 'Sửa', null, 'Legacy generic Project edit permission.', 20, true),
  ('delete', 'Xóa', null, 'Legacy generic Project delete permission.', 30, true),
  ('submit', 'Gửi', null, 'Legacy generic Project submit permission.', 40, true),
  ('verify', 'Kiểm tra', null, 'Legacy generic Project verify/return permission.', 50, true),
  ('confirm', 'Xác nhận', null, 'Legacy generic Project confirm permission.', 60, true),
  ('approve', 'Duyệt', null, 'Legacy generic Project approve permission.', 70, true),
  ('view_available_stock', 'Xem tồn khả dụng', null, 'Legacy generic material available-stock permission.', 80, true)
on conflict (code) do update
set name = excluded.name,
    module = excluded.module,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true;

create or replace function app_private.has_explicit_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and u.role = 'ADMIN'
  )
  or exists (
    select 1
    from public.users u
    join public.user_permission_grants g on g.user_id = u.id
    where u.id = p_user_id
      and coalesce(u.is_active, true)
      and g.permission_code = p_permission_code
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope_type = 'global'
        or (
          g.scope_type = coalesce(p_scope_type, 'global')
          and (g.scope_id = '*' or g.scope_id = coalesce(p_scope_id, '*'))
        )
      )
  );
$$;

revoke all on function app_private.has_explicit_permission(uuid, text, text, text) from public;
revoke all on function app_private.has_explicit_permission(uuid, text, text, text) from anon;
grant execute on function app_private.has_explicit_permission(uuid, text, text, text) to authenticated;

create or replace function app_private.project_has_permission_v2(
  p_project_id text,
  p_construction_site_id text,
  p_permission_code text,
  p_user_id uuid default public.current_app_user_id()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_permission_code like 'project.%'
  and (
    exists (
      select 1
      from public.users u
      where u.id = p_user_id
        and coalesce(u.is_active, true)
        and u.role = 'ADMIN'
    )
    or exists (
      select 1
      from public.users u
      join public.user_permission_grants g on g.user_id = u.id
      where u.id = p_user_id
        and coalesce(u.is_active, true)
        and g.permission_code = p_permission_code
        and coalesce(g.is_active, false)
        and (g.expires_at is null or g.expires_at > now())
        and (
          g.scope_type = 'global'
          or (g.scope_type = 'project' and (g.scope_id = '*' or g.scope_id = p_project_id))
          or (
            p_construction_site_id is not null
            and g.scope_type = 'construction_site'
            and (g.scope_id = '*' or g.scope_id = p_construction_site_id)
          )
        )
    )
  );
$$;

revoke all on function app_private.project_has_permission_v2(text, text, text, uuid) from public;
revoke all on function app_private.project_has_permission_v2(text, text, text, uuid) from anon;
grant execute on function app_private.project_has_permission_v2(text, text, text, uuid) to authenticated;

create or replace function app_private.replace_project_staff_permission_grants(
  p_staff_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record;
  v_actor_user_id uuid := public.current_app_user_id();
  v_target_user_id uuid;
  v_scope_type text;
  v_scope_id text;
  v_before jsonb;
  v_after jsonb := coalesce(p_grants, '[]'::jsonb);
begin
  select ps.*
  into v_staff
  from public.project_staff ps
  where ps.id = p_staff_id;

  if v_staff.id is null then
    raise exception 'Project staff row does not exist'
      using errcode = '23503';
  end if;

  if v_staff.user_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Project staff user_id is not a UUID: %', v_staff.user_id
      using errcode = '22P02';
  end if;

  v_target_user_id := v_staff.user_id::uuid;
  v_scope_type := case when nullif(v_staff.construction_site_id, '') is not null then 'construction_site' else 'project' end;
  v_scope_id := coalesce(nullif(v_staff.construction_site_id, ''), nullif(v_staff.project_id, ''));

  if v_scope_id is null then
    raise exception 'Project staff row has no project or construction site scope'
      using errcode = '23502';
  end if;

  if not (
    public.is_admin()
    or public.is_module_admin('DA')
    or app_private.project_has_permission_v2(v_staff.project_id, v_staff.construction_site_id, 'project.org.grant_permissions', v_actor_user_id)
    or app_private.project_has_permission_v2(v_staff.project_id, v_staff.construction_site_id, 'project.org.manage', v_actor_user_id)
  ) then
    raise exception 'Not allowed to manage project staff permissions'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_after) as grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    left join public.permission_actions pa on pa.permission_code = grant_row.permission_code
    where coalesce(grant_row.is_active, true)
      and (
        grant_row.permission_code is null
        or grant_row.permission_code not like 'project.%'
        or pa.permission_code is null
      )
  ) then
    raise exception 'All grants must be registered project.* permission codes'
      using errcode = '23503';
  end if;

  select coalesce(jsonb_agg(to_jsonb(g) order by g.permission_code), '[]'::jsonb)
  into v_before
  from public.user_permission_grants g
  where g.user_id = v_target_user_id
    and g.permission_code like 'project.%'
    and g.scope_type = v_scope_type
    and g.scope_id = v_scope_id;

  delete from public.user_permission_grants g
  where g.user_id = v_target_user_id
    and g.permission_code like 'project.%'
    and g.scope_type = v_scope_type
    and g.scope_id = v_scope_id;

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at
  )
  select
    v_target_user_id,
    grant_row.permission_code,
    v_scope_type,
    v_scope_id,
    coalesce(grant_row.is_active, true),
    v_actor_user_id,
    now(),
    grant_row.expires_at
  from jsonb_to_recordset(v_after) as grant_row(
    permission_code text,
    scope_type text,
    scope_id text,
    is_active boolean,
    expires_at timestamptz
  )
  where coalesce(grant_row.is_active, true)
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = excluded.is_active,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      updated_at = now();

  delete from public.project_staff_permissions
  where staff_id = p_staff_id;

  insert into public.project_staff_permissions (
    staff_id,
    permission_type_id,
    is_active,
    granted_by,
    granted_at
  )
  with active_grants as (
    select g.permission_code, pa.action
    from public.user_permission_grants g
    join public.permission_actions pa on pa.permission_code = g.permission_code
    where g.user_id = v_target_user_id
      and g.permission_code like 'project.%'
      and g.scope_type = v_scope_type
      and g.scope_id = v_scope_id
      and coalesce(g.is_active, false)
      and (g.expires_at is null or g.expires_at > now())
  ),
  legacy_codes as (
    select distinct legacy_code
    from active_grants
    cross join lateral (
      values
        (case when action = 'view' then 'view' end),
        (case when action in ('create','edit','edit_own','edit_all') then 'edit' end),
        (case when action in ('delete','delete_own','delete_all') then 'delete' end),
        (case when action = 'submit' then 'submit' end),
        (case when action in ('verify','return') then 'verify' end),
        (case when action in ('confirm','mark_paid') then 'confirm' end),
        (case when action = 'approve' then 'approve' end),
        (case when permission_code = 'project.material_request.view_available_stock' then 'view_available_stock' end)
    ) as mapped(legacy_code)
    where legacy_code is not null
  )
  select
    p_staff_id,
    ppt.id,
    true,
    v_actor_user_id::text,
    now()
  from legacy_codes lc
  join public.project_permission_types ppt on ppt.code = lc.legacy_code
  where coalesce(ppt.is_active, true)
  on conflict (staff_id, permission_type_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at;

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    v_target_user_id,
    'replace_project_staff_permission_grants',
    v_before,
    (
      select coalesce(jsonb_agg(to_jsonb(g) order by g.permission_code), '[]'::jsonb)
      from public.user_permission_grants g
      where g.user_id = v_target_user_id
        and g.permission_code like 'project.%'
        and g.scope_type = v_scope_type
        and g.scope_id = v_scope_id
    ),
    jsonb_build_object(
      'source', 'phase2_project_pbac_v2_foundation',
      'staff_id', p_staff_id,
      'scope_type', v_scope_type,
      'scope_id', v_scope_id
    )
  );
end;
$$;

revoke all on function app_private.replace_project_staff_permission_grants(uuid, jsonb) from public;
revoke all on function app_private.replace_project_staff_permission_grants(uuid, jsonb) from anon;
grant execute on function app_private.replace_project_staff_permission_grants(uuid, jsonb) to authenticated;

create or replace function public.replace_project_staff_permission_grants(
  p_staff_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform app_private.replace_project_staff_permission_grants(p_staff_id, p_grants);
end;
$$;

revoke all on function public.replace_project_staff_permission_grants(uuid, jsonb) from public;
revoke all on function public.replace_project_staff_permission_grants(uuid, jsonb) from anon;
grant execute on function public.replace_project_staff_permission_grants(uuid, jsonb) to authenticated;

with staff_permission_codes as (
  select
    ps.id as staff_id,
    ps.user_id::uuid as target_user_id,
    case when nullif(ps.construction_site_id, '') is not null then 'construction_site' else 'project' end as scope_type,
    coalesce(nullif(ps.construction_site_id, ''), nullif(ps.project_id, '')) as scope_id,
    ppt.code as legacy_code
  from public.project_staff ps
  join public.project_staff_permissions psp on psp.staff_id = ps.id
  join public.project_permission_types ppt on ppt.id = psp.permission_type_id
  join public.users u on u.id = ps.user_id::uuid
  where ps.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(psp.is_active, true)
    and ps.end_date is null
    and coalesce(ppt.is_active, true)
    and coalesce(nullif(ps.construction_site_id, ''), nullif(ps.project_id, '')) is not null
),
mapped_permission_codes as (
  select distinct
    spc.target_user_id,
    spc.scope_type,
    spc.scope_id,
    pa.permission_code
  from staff_permission_codes spc
  join public.permission_actions pa on pa.permission_code like 'project.%'
  where (
    spc.legacy_code = 'view' and pa.action = 'view'
  ) or (
    spc.legacy_code = 'edit' and pa.action in ('create','edit','edit_own','edit_all')
  ) or (
    spc.legacy_code = 'delete' and pa.action in ('delete','delete_own','delete_all')
  ) or (
    spc.legacy_code = 'submit' and pa.action = 'submit'
  ) or (
    spc.legacy_code = 'verify' and pa.action in ('verify','return')
  ) or (
    spc.legacy_code = 'confirm' and pa.action in ('confirm','mark_paid')
  ) or (
    spc.legacy_code = 'approve' and pa.action = 'approve'
  ) or (
    spc.legacy_code = 'view_available_stock' and pa.permission_code = 'project.material_request.view_available_stock'
  )
)
insert into public.user_permission_grants (
  user_id,
  permission_code,
  scope_type,
  scope_id,
  is_active,
  granted_by,
  granted_at
)
select
  target_user_id,
  permission_code,
  scope_type,
  scope_id,
  true,
  null,
  now()
from mapped_permission_codes
on conflict (user_id, permission_code, scope_type, scope_id) do update
set is_active = true,
    updated_at = now();

notify pgrst, 'reload schema';
