-- Performance indexes for the main read paths used by the app.
-- These indexes intentionally avoid data/flow changes and only target
-- filters, sort orders, realtime refresh lookups, and foreign-key checks.

-- WMS core
create index if not exists idx_transactions_date_desc
  on public.transactions (date desc);

create index if not exists idx_transactions_status_date
  on public.transactions (status, date desc);

create index if not exists idx_transactions_source_wh_date
  on public.transactions (source_warehouse_id, date desc)
  where source_warehouse_id is not null;

create index if not exists idx_transactions_target_wh_date
  on public.transactions (target_warehouse_id, date desc)
  where target_warehouse_id is not null;

create index if not exists idx_transactions_requester_date
  on public.transactions (requester_id, date desc)
  where requester_id is not null;

create index if not exists idx_transactions_related_request
  on public.transactions (related_request_id)
  where related_request_id is not null;

create index if not exists idx_requests_created_date_desc
  on public.requests (created_date desc);

create index if not exists idx_requests_status_created_date
  on public.requests (status, created_date desc);

create index if not exists idx_requests_requester_created_date
  on public.requests (requester_id, created_date desc);

create index if not exists idx_requests_site_created_date
  on public.requests (site_warehouse_id, created_date desc);

create index if not exists idx_items_supplier_id
  on public.items (supplier_id)
  where supplier_id is not null;

create index if not exists idx_items_category
  on public.items (category);

create index if not exists idx_activities_timestamp_desc
  on public.activities ("timestamp" desc);

create index if not exists idx_activities_user_timestamp
  on public.activities (user_id, "timestamp" desc);

create index if not exists idx_activities_warehouse_timestamp
  on public.activities (warehouse_id, "timestamp" desc)
  where warehouse_id is not null;

-- Assets
create index if not exists idx_assets_status_updated_at
  on public.assets (status, updated_at desc);

create index if not exists idx_assets_warehouse_id
  on public.assets (warehouse_id)
  where warehouse_id is not null;

create index if not exists idx_assets_parent_id
  on public.assets (parent_id)
  where parent_id is not null;

create index if not exists idx_assets_type_status
  on public.assets (asset_type, status);

create index if not exists idx_asset_location_stocks_asset_id
  on public.asset_location_stocks (asset_id);

create index if not exists idx_asset_location_stocks_lookup
  on public.asset_location_stocks (asset_id, warehouse_id, assigned_to_user_id);

create index if not exists idx_asset_location_stocks_site_dept
  on public.asset_location_stocks (construction_site_id, dept_id)
  where construction_site_id is not null or dept_id is not null;

create index if not exists idx_asset_transfers_asset_created_at
  on public.asset_transfers (asset_id, created_at desc);

create index if not exists idx_asset_transfers_from_wh_created_at
  on public.asset_transfers (from_warehouse_id, created_at desc)
  where from_warehouse_id is not null;

create index if not exists idx_asset_transfers_to_wh_created_at
  on public.asset_transfers (to_warehouse_id, created_at desc)
  where to_warehouse_id is not null;

create index if not exists idx_asset_assignments_asset_created_at
  on public.asset_assignments (asset_id, created_at desc);

create index if not exists idx_asset_assignments_user_created_at
  on public.asset_assignments (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_asset_maintenances_asset_created_at
  on public.asset_maintenances (asset_id, created_at desc);

create index if not exists idx_asset_maintenances_status_start_date
  on public.asset_maintenances (status, start_date);

-- Request workflow
create index if not exists idx_request_instances_status_created_at
  on public.request_instances (status, created_at desc);

create index if not exists idx_request_instances_created_by_created_at
  on public.request_instances (created_by, created_at desc);

create index if not exists idx_request_instances_assigned_created_at
  on public.request_instances (assigned_to, created_at desc)
  where assigned_to is not null;

create index if not exists idx_request_instances_due_date
  on public.request_instances (due_date)
  where due_date is not null;

create index if not exists idx_request_instances_category_created_at
  on public.request_instances (category_id, created_at desc);

create index if not exists idx_request_logs_request_created_at
  on public.request_logs (request_id, created_at);

create index if not exists idx_request_print_templates_category_created_at
  on public.request_print_templates (category_id, created_at desc);

-- Generic workflow
create index if not exists idx_workflow_instances_status_created_at
  on public.workflow_instances (status, created_at desc);

create index if not exists idx_workflow_instances_template_created_at
  on public.workflow_instances (template_id, created_at desc);

create index if not exists idx_workflow_instances_created_by_created_at
  on public.workflow_instances (created_by, created_at desc);

create index if not exists idx_workflow_instances_current_node
  on public.workflow_instances (current_node_id)
  where current_node_id is not null;

create index if not exists idx_workflow_instance_logs_instance_created_at
  on public.workflow_instance_logs (instance_id, created_at);

create index if not exists idx_workflow_instance_logs_acted_by_created_at
  on public.workflow_instance_logs (acted_by, created_at desc);

-- Notifications and audit
create index if not exists idx_notifications_visible_user_created_at
  on public.notifications (user_id, is_dismissed, created_at desc);

create index if not exists idx_notifications_unread_visible_user
  on public.notifications (user_id, created_at desc)
  where is_read = false and is_dismissed = false;

create index if not exists idx_audit_trail_table_record_created_at
  on public.audit_trail (table_name, record_id, created_at desc);

create index if not exists idx_audit_trail_module_created_at
  on public.audit_trail (module, created_at desc);

create index if not exists idx_audit_trail_user_created_at
  on public.audit_trail (user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_audit_trail_action_created_at
  on public.audit_trail (action, created_at desc);

-- Project module
create index if not exists idx_project_tasks_site_sort_order
  on public.project_tasks (construction_site_id, sort_order);

create index if not exists idx_daily_logs_site_date
  on public.daily_logs (construction_site_id, date desc);

create index if not exists idx_acceptance_records_site_period
  on public.acceptance_records (construction_site_id, period_number);

create index if not exists idx_material_budget_items_site_category
  on public.material_budget_items (construction_site_id, category);

create index if not exists idx_project_material_requests_site_created_at
  on public.project_material_requests (construction_site_id, created_at desc);

create index if not exists idx_project_vendors_site_name
  on public.project_vendors (construction_site_id, name);

create index if not exists idx_purchase_orders_site_created_at
  on public.purchase_orders (construction_site_id, created_at desc);

create index if not exists idx_payment_schedules_site_due_date
  on public.payment_schedules (construction_site_id, due_date);

create index if not exists idx_project_baselines_site_locked_at
  on public.project_baselines (construction_site_id, locked_at desc);

create index if not exists idx_project_documents_site_created_at
  on public.project_documents (construction_site_id, created_at desc);

create index if not exists idx_project_finances_site
  on public.project_finances ("constructionSiteId");

create index if not exists idx_project_finances_status
  on public.project_finances (status);

-- HRM hot lookups
create index if not exists idx_hrm_attendance_employee_date
  on public.hrm_attendance ("employeeId", date);

create index if not exists idx_hrm_attendance_date
  on public.hrm_attendance (date);

create index if not exists idx_hrm_attendance_site_date
  on public.hrm_attendance ("constructionSiteId", date)
  where "constructionSiteId" is not null;

create index if not exists idx_hrm_leave_requests_employee_start
  on public.hrm_leave_requests ("employeeId", "startDate");

create index if not exists idx_hrm_leave_requests_status_due
  on public.hrm_leave_requests (status, "dueDate")
  where "dueDate" is not null;

create index if not exists idx_hrm_payrolls_employee_period
  on public.hrm_payrolls ("employeeId", year, month);

create index if not exists idx_employees_user_id
  on public.employees (user_id)
  where user_id is not null;

create index if not exists idx_employees_org_unit_id
  on public.employees (org_unit_id)
  where org_unit_id is not null;

create index if not exists idx_employees_construction_site_id
  on public.employees (construction_site_id)
  where construction_site_id is not null;

create index if not exists idx_employees_department_id
  on public.employees (department_id)
  where department_id is not null;

create index if not exists idx_org_units_parent_id
  on public.org_units (parent_id)
  where parent_id is not null;

-- Cash/expense/AI support paths surfaced by the Supabase performance advisor.
create index if not exists idx_cash_vouchers_created_by
  on public.cash_vouchers (created_by)
  where created_by is not null;

create index if not exists idx_cash_vouchers_approved_by
  on public.cash_vouchers (approved_by)
  where approved_by is not null;

create index if not exists idx_expense_records_category_id
  on public.expense_records ("categoryId");

create index if not exists idx_ai_memory_conversation_id
  on public.ai_memory (conversation_id);

create index if not exists idx_ai_report_results_report_id
  on public.ai_report_results (report_id);

create index if not exists idx_ai_scheduled_reports_created_by
  on public.ai_scheduled_reports (created_by);
