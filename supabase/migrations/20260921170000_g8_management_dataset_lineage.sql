-- G8 management dataset: one scoped/versioned source for KPI, drill and export.
-- Quantities stay at line level. Cross-project headline values are record counts;
-- financial amounts remain per document/currency and are separately permissioned.

create function app_private.list_management_dataset_v1(
  p_actor uuid,
  p_filter jsonb default '{}'::jsonb,
  p_cursor text default null,
  p_limit integer default 50,
  p_as_of timestamptz default null
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
  v_view text := coalesce(nullif(p_filter ->> 'viewId', ''), 'M05');
  v_as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  v_limit integer := least(200, greatest(1, coalesce(p_limit, 50)));
  v_offset integer := 0;
  v_snapshot text;
  v_cursor_snapshot text;
  v_result jsonb;
begin
  if p_actor is null or not exists (
    select 1 from public.users actor
    where actor.id = p_actor and coalesce(actor.is_active, true)
      and coalesce(actor.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'MANAGEMENT_DATASET_ACCESS_DENIED';
  end if;
  if jsonb_typeof(v_filter) <> 'object' or v_view not in ('M01','M02','M03','M04','M05') then
    raise exception using errcode = '22023', message = 'MANAGEMENT_DATASET_FILTER_INVALID';
  end if;

  v_snapshot := encode(extensions.digest(
    concat_ws('|', p_actor::text, v_as_of::text, v_filter::text, 'g8.management.dataset.v1'), 'sha256'
  ), 'hex');
  if p_cursor is not null then
    if p_cursor !~ '^[0-9]+:[0-9a-f]{64}$' then
      raise exception using errcode = '22023', message = 'MANAGEMENT_DATASET_CURSOR_INVALID';
    end if;
    v_offset := split_part(p_cursor, ':', 1)::integer;
    v_cursor_snapshot := split_part(p_cursor, ':', 2);
    if v_cursor_snapshot <> v_snapshot then
      raise exception using errcode = '22023', message = 'MANAGEMENT_DATASET_SNAPSHOT_CHANGED';
    end if;
  end if;

  with
  authorized_projects as materialized (
    select project.id, project.code, project.name, project.status,
      project.construction_site_id::text construction_site_id,
      app_private.project_has_permission_v2(
        project.id, project.construction_site_id::text,
        'project.dashboard.view_progress', p_actor
      ) can_view_progress,
      app_private.project_has_permission_v2(
        project.id, project.construction_site_id::text,
        'project.dashboard.view_financials', p_actor
      ) can_view_financials,
      app_private.project_has_permission_v2(
        project.id, project.construction_site_id::text,
        'project.report.export', p_actor
      ) can_export
    from public.projects project
    where not coalesce(project.is_hidden, false)
      and (nullif(v_filter ->> 'projectId', '') is null or project.id = v_filter ->> 'projectId')
      and (nullif(v_filter ->> 'constructionSiteId', '') is null
        or project.construction_site_id::text = v_filter ->> 'constructionSiteId')
      and app_private.project_has_permission_v2(
        project.id, project.construction_site_id::text,
        'project.dashboard.view_progress', p_actor
      )
  ),
  task_material_risk as (
    select 'M01:task:' || task.id id, 'M01'::text view_id,
      'project.material-risk.count'::text metric_id, '1.0.0'::text definition_version,
      'Công tác sắp đến hạn chưa có kế hoạch vật tư'::text title,
      concat(task.name, ' · hạn ', task.end_date)::text description,
      case when (case when pg_input_is_valid(task.end_date, 'date') then task.end_date::date end) < v_as_of::date then 'critical' else 'warning' end severity,
      project.id project_id, project.construction_site_id, project.name project_name,
      nullif(task.assignee_user_id, '') owner_id, coalesce(actor.name, task.assignee) owner_name,
      (case when pg_input_is_valid(task.end_date, 'date') then task.end_date::date end)::timestamptz due_at, 1::numeric value, 'record'::text unit,
      null::text currency, 'not_applicable'::text vat_basis, 'complete'::text completeness,
      array[]::text[] quality_issues, 'project_task'::text source_type, task.id source_id,
      task.name source_label, false inferred, 'project_task'::text drill_type, task.id drill_id,
      '/da?tab=gantt&taskId=' || task.id drill_path, null::text supplier_id, null::text warehouse_id
    from authorized_projects project
    join public.project_tasks task on task.project_id = project.id
      and task.construction_site_id is not distinct from project.construction_site_id
    left join public.users actor on actor.id::text = task.assignee_user_id
    where task.progress < 100
      and (case when pg_input_is_valid(task.end_date, 'date') then task.end_date::date end) <= v_as_of::date + 14
      and exists (
        select 1 from public.project_work_boq_items work
        join public.material_budget_items budget on budget.work_boq_item_id = work.id
        where work.project_id = project.id and work.source_task_id = task.id
      )
      and not exists (
        select 1 from public.material_plan_allocations allocation
        join public.material_plans plan on plan.id = allocation.plan_id
        where allocation.source_task_id = task.id and allocation.archived_at is null
          and plan.status not in ('cancelled','superseded') and allocation.created_at <= v_as_of
      )
  ),
  unallocated_demand as (
    select 'M01:demand:' || line.id id, 'M01'::text view_id,
      'project.unallocated-demand.count'::text metric_id, '1.0.0'::text definition_version,
      'Nhu cầu chưa có phương án cung ứng'::text title,
      coalesce(document.source_code_snapshot, demand.source_code_snapshot, line.item_id)::text description,
      case when line.health_state <> 'healthy' then 'critical' else 'warning' end severity,
      project.id project_id, project.construction_site_id, project.name project_name,
      demand.assignee_user_id::text owner_id, owner.name owner_name,
      null::timestamptz due_at,
      case when line.health_state = 'healthy' then 1::numeric else null::numeric end value,
      'record'::text unit, null::text currency, 'not_applicable'::text vat_basis,
      case when line.health_state = 'healthy' then 'complete' else 'unknown' end completeness,
      case when line.health_state = 'healthy' then array[]::text[] else array['SOURCE_RECONCILIATION_REQUIRED']::text[] end quality_issues,
      'procurement_demand_line'::text source_type, line.id::text source_id,
      coalesce(document.source_code_snapshot, line.id::text) source_label, false inferred,
      'material_request'::text drill_type, document.source_document_id drill_id,
      '/procurement?demandId=' || demand.id::text drill_path,
      null::text supplier_id, null::text warehouse_id
    from authorized_projects project
    join public.procurement_demands demand on demand.project_id = project.id
      and demand.construction_site_id is not distinct from project.construction_site_id
    join public.procurement_demand_lines line on line.demand_id = demand.id
    join public.procurement_source_documents document on document.id = demand.source_document_id
    left join public.users owner on owner.id = demand.assignee_user_id
    where demand.intake_state not in ('withdrawn') and line.intake_state not in ('withdrawn')
      and line.created_at <= v_as_of
      and not exists (
        select 1 from public.procurement_supply_allocations allocation
        where allocation.demand_line_id = line.id
          and allocation.state in ('planned','reserved','committed','settled')
      )
  ),
  procurement_unassigned as (
    select 'M02:unassigned:' || demand.id id, 'M02'::text view_id,
      'procurement.unassigned-backlog.count'::text metric_id, '1.0.0'::text definition_version,
      'Nhu cầu mua hàng chưa có người xử lý'::text title,
      coalesce(document.source_code_snapshot, demand.source_code_snapshot, demand.id::text) description,
      'warning'::text severity, project.id project_id, project.construction_site_id,
      project.name project_name, null::text owner_id, null::text owner_name,
      null::timestamptz due_at, 1::numeric value, 'record'::text unit, null::text currency,
      'not_applicable'::text vat_basis, 'complete'::text completeness,
      array[]::text[] quality_issues, 'procurement_demand'::text source_type,
      demand.id::text source_id, coalesce(document.source_code_snapshot, demand.id::text) source_label,
      false inferred, 'procurement_demand'::text drill_type, demand.id::text drill_id,
      '/procurement?demandId=' || demand.id::text drill_path,
      null::text supplier_id, null::text warehouse_id
    from authorized_projects project
    join public.procurement_demands demand on demand.project_id = project.id
      and demand.construction_site_id is not distinct from project.construction_site_id
    join public.procurement_source_documents document on document.id = demand.source_document_id
    where demand.assignee_user_id is null and demand.intake_state not in ('withdrawn')
      and demand.created_at <= v_as_of
  ),
  late_delivery as (
    select 'M02:delivery:' || batch.id id, 'M02'::text view_id,
      'procurement.late-delivery.count'::text metric_id, '1.0.0'::text definition_version,
      'Đợt giao hàng đã quá ngày hẹn'::text title,
      concat(po.po_number, ' · ', coalesce(po.vendor_name, batch.supplier_name_snapshot, 'NCC')) description,
      'critical'::text severity, project.id project_id, project.construction_site_id,
      project.name project_name, po.submitted_to_user_id owner_id, po.submitted_to_name owner_name,
      batch.planned_delivery_date::timestamptz due_at, 1::numeric value, 'record'::text unit,
      null::text currency, 'not_applicable'::text vat_basis, 'complete'::text completeness,
      array[]::text[] quality_issues, 'purchase_delivery_batch'::text source_type,
      batch.id::text source_id, po.po_number || '-' || batch.delivery_no::text source_label,
      false inferred, 'purchase_order'::text drill_type, po.id drill_id,
      '/da?tab=material&materialTab=po&poId=' || po.id drill_path,
      po.vendor_id supplier_id, po.target_warehouse_id warehouse_id
    from authorized_projects project
    join public.purchase_orders po on po.project_id = project.id
      and po.construction_site_id is not distinct from project.construction_site_id
      and po.archived_at is null
    join public.purchase_order_delivery_batches batch on batch.purchase_order_id = po.id
    where batch.planned_delivery_date < v_as_of::date
      and batch.status not in ('received','received_short','received_over','cancelled')
      and batch.created_at <= v_as_of
  ),
  open_commitment as (
    select 'M02:po:' || po.id id, 'M02'::text view_id,
      'procurement.open-commitment.count'::text metric_id, '1.0.0'::text definition_version,
      'PO còn nghĩa vụ giao nhận'::text title,
      concat(po.po_number, ' · ', coalesce(po.vendor_name, 'NCC')) description,
      'info'::text severity, project.id project_id, project.construction_site_id,
      project.name project_name, po.submitted_to_user_id owner_id, po.submitted_to_name owner_name,
      case when pg_input_is_valid(po.expected_delivery_date, 'date') then po.expected_delivery_date::date::timestamptz end due_at,
      1::numeric value, 'record'::text unit, null::text currency,
      'not_applicable'::text vat_basis, 'complete'::text completeness,
      array[]::text[] quality_issues, 'purchase_order'::text source_type, po.id source_id,
      po.po_number source_label, false inferred, 'purchase_order'::text drill_type, po.id drill_id,
      '/da?tab=material&materialTab=po&poId=' || po.id drill_path,
      po.vendor_id supplier_id, po.target_warehouse_id warehouse_id
    from authorized_projects project
    join public.purchase_orders po on po.project_id = project.id
      and po.construction_site_id is not distinct from project.construction_site_id
    where po.archived_at is null and po.status in ('sent','confirmed','in_transit','partial')
      and po.created_at <= v_as_of
  ),
  qc_wait as (
    select 'M03:qc:' || batch.id id, 'M03'::text view_id,
      'warehouse.qc-wait.count'::text metric_id, '1.0.0'::text definition_version,
      'Lô nhận đang chờ hoàn tất QC'::text title,
      po.po_number || '-' || batch.delivery_no::text description,
      case when batch.planned_delivery_date < v_as_of::date then 'critical' else 'warning' end severity,
      project.id project_id, project.construction_site_id, project.name project_name,
      batch.approval_assignee_user_id::text owner_id, owner.name owner_name,
      batch.planned_delivery_date::timestamptz due_at, 1::numeric value, 'record'::text unit,
      null::text currency, 'not_applicable'::text vat_basis,
      case when batch.quality_result is null then 'partial' else 'complete' end completeness,
      case when batch.quality_result is null then array['QC_RESULT_PENDING']::text[] else array[]::text[] end quality_issues,
      'quality_check'::text source_type, batch.id::text source_id,
      po.po_number || '-' || batch.delivery_no::text source_label, false inferred,
      'purchase_delivery_batch'::text drill_type, batch.id::text drill_id,
      '/da?tab=material&materialTab=po&poId=' || po.id drill_path,
      po.vendor_id supplier_id, po.target_warehouse_id warehouse_id
    from authorized_projects project
    join public.purchase_orders po on po.project_id = project.id
      and po.construction_site_id is not distinct from project.construction_site_id
      and po.archived_at is null
    join public.purchase_order_delivery_batches batch on batch.purchase_order_id = po.id
    left join public.users owner on owner.id = batch.approval_assignee_user_id
    where batch.status in ('wms_pending','receiving','quality_approved') and batch.created_at <= v_as_of
  ),
  wms_reconciliation as (
    select 'M03:reconciliation:' || issue.id id, 'M03'::text view_id,
      'warehouse.reconciliation-open.count'::text metric_id, '1.0.0'::text definition_version,
      'Chênh lệch tồn kho cần đối soát'::text title,
      concat(coalesce(item.sku, issue.material_id), ' · ', warehouse.name) description,
      'critical'::text severity, null::text project_id, null::text construction_site_id,
      null::text project_name, issue.owner_user_id::text owner_id, owner.name owner_name,
      null::timestamptz due_at, null::numeric value, 'record'::text unit, null::text currency,
      'not_applicable'::text vat_basis, 'unknown'::text completeness,
      array[upper(issue.classification)]::text[] quality_issues,
      'wms_reconciliation_issue'::text source_type, issue.id::text source_id,
      coalesce(item.sku, issue.material_id) source_label, false inferred,
      'wms_reconciliation_issue'::text drill_type, issue.id::text drill_id,
      '/inventory?warehouseId=' || issue.warehouse_id drill_path,
      null::text supplier_id, issue.warehouse_id warehouse_id
    from public.wms_inventory_reconciliation_issues issue
    join public.warehouses warehouse on warehouse.id = issue.warehouse_id
    left join public.items item on item.id = issue.material_id
    left join public.users owner on owner.id = issue.owner_user_id
    where issue.status = 'open' and issue.detected_at <= v_as_of
      and (public.is_admin() or app_private.current_user_is_global_wms_keeper()
        or app_private.current_user_is_wms_keeper_for(issue.warehouse_id))
  ),
  overdue_ap as (
    select 'M04:ap-overdue:' || balance.id id, 'M04'::text view_id,
      'finance.ap-overdue.amount'::text metric_id, '1.0.0'::text definition_version,
      'Công nợ nhà cung cấp quá hạn'::text title,
      concat(balance.document_no, ' · ', balance.supplier_name_snapshot) description,
      'critical'::text severity, project.id project_id, project.construction_site_id,
      project.name project_name, null::text owner_id, null::text owner_name,
      balance.due_date::timestamptz due_at, balance.outstanding_amount value,
      balance.currency unit, balance.currency currency, 'gross'::text vat_basis,
      'complete'::text completeness, array[]::text[] quality_issues,
      'supplier_payable_document'::text source_type, balance.id::text source_id,
      balance.document_no source_label, false inferred,
      'supplier_payable_document'::text drill_type, balance.id::text drill_id,
      '/trace?type=supplier_payable_document&id=' || balance.id::text drill_path,
      balance.supplier_id supplier_id, null::text warehouse_id
    from authorized_projects project
    join public.supplier_payable_document_balances balance on balance.project_id = project.id
      and balance.construction_site_id is not distinct from project.construction_site_id
    where project.can_view_financials and balance.is_overdue and balance.created_at <= v_as_of
  ),
  uninvoiced_receipt as (
    select 'M04:uninvoiced:' || document.id id, 'M04'::text view_id,
      'finance.received-uninvoiced.amount'::text metric_id, '1.0.0'::text definition_version,
      'Hàng đã nhận chưa được hóa đơn đầy đủ'::text title,
      concat(document.document_no, ' · ', document.supplier_name_snapshot) description,
      'warning'::text severity, project.id project_id, project.construction_site_id,
      project.name project_name, null::text owner_id, null::text owner_name,
      document.due_date::timestamptz due_at, invoice_balance.uninvoiced_amount value,
      document.currency unit, document.currency currency, 'gross'::text vat_basis,
      'complete'::text completeness, array[]::text[] quality_issues,
      'supplier_payable_document'::text source_type, document.id::text source_id,
      document.document_no source_label, false inferred,
      'supplier_payable_document'::text drill_type, document.id::text drill_id,
      '/trace?type=supplier_payable_document&id=' || document.id::text drill_path,
      document.supplier_id supplier_id, null::text warehouse_id
    from authorized_projects project
    join public.supplier_payable_documents document on document.project_id = project.id
      and document.construction_site_id is not distinct from project.construction_site_id
    join public.supplier_invoice_payable_balances invoice_balance on invoice_balance.payable_document_id = document.id
    where project.can_view_financials and document.source_type = 'purchase_delivery_receipt'
      and document.status not in ('cancelled','reversed') and invoice_balance.uninvoiced_amount > 0
      and document.created_at <= v_as_of
  ),
  paid_cash as (
    select 'M04:paid:' || batch.id id, 'M04'::text view_id,
      'finance.cash-paid.amount'::text metric_id, '1.0.0'::text definition_version,
      'Khoản thanh toán đã ghi nhận'::text title,
      concat(batch.code, ' · ', batch.supplier_name_snapshot) description,
      'info'::text severity, project.id project_id, project.construction_site_id,
      project.name project_name, null::text owner_id, null::text owner_name,
      batch.payment_date::timestamptz due_at, batch.payment_amount value,
      batch.currency unit, batch.currency currency, 'gross'::text vat_basis,
      'complete'::text completeness, array[]::text[] quality_issues,
      'supplier_payment_batch'::text source_type, batch.id::text source_id,
      batch.code source_label, false inferred, 'supplier_payment_batch'::text drill_type,
      batch.id::text drill_id, '/trace?type=supplier_payment_batch&id=' || batch.id::text drill_path,
      batch.supplier_id supplier_id, null::text warehouse_id
    from authorized_projects project
    join public.supplier_payment_batches batch on batch.project_id = project.id
      and batch.construction_site_id is not distinct from project.construction_site_id
    where project.can_view_financials and batch.status = 'paid'
      and coalesce(batch.paid_at, batch.updated_at) <= v_as_of
  ),
  base_rows as materialized (
    select * from task_material_risk union all select * from unallocated_demand
    union all select * from procurement_unassigned union all select * from late_delivery
    union all select * from open_commitment union all select * from qc_wait
    union all select * from wms_reconciliation union all select * from overdue_ap
    union all select * from uninvoiced_receipt union all select * from paid_cash
  ),
  scoped_base as materialized (
    select * from base_rows row_data
    where (nullif(v_filter ->> 'projectId', '') is null or row_data.project_id = v_filter ->> 'projectId')
      and (nullif(v_filter ->> 'constructionSiteId', '') is null or row_data.construction_site_id = v_filter ->> 'constructionSiteId')
      and (nullif(v_filter ->> 'warehouseId', '') is null or row_data.warehouse_id = v_filter ->> 'warehouseId')
      and (nullif(v_filter ->> 'supplierId', '') is null or row_data.supplier_id = v_filter ->> 'supplierId')
      and (nullif(v_filter ->> 'ownerId', '') is null or row_data.owner_id = v_filter ->> 'ownerId')
      and (nullif(v_filter ->> 'severity', '') is null or row_data.severity = v_filter ->> 'severity')
  ),
  executive_rows as (
    select 'M05:project:' || project_id id, 'M05'::text view_id,
      'executive.intervention.count'::text metric_id, '1.0.0'::text definition_version,
      coalesce(max(project_name), project_id) title,
      concat(count(*) filter (where severity in ('critical','warning')), ' việc cần can thiệp') description,
      case when bool_or(severity = 'critical') then 'critical' else 'warning' end severity,
      project_id, max(construction_site_id) construction_site_id, max(project_name) project_name,
      null::text owner_id, null::text owner_name, min(due_at) due_at,
      case when bool_or(completeness = 'unknown') then null::numeric
        else count(*) filter (where severity in ('critical','warning'))::numeric end value,
      'record'::text unit, null::text currency, 'not_applicable'::text vat_basis,
      case when bool_or(completeness = 'unknown') then 'unknown' else 'complete' end completeness,
      case when bool_or(completeness = 'unknown') then array['SOURCE_NOT_COMPLETE']::text[] else array[]::text[] end quality_issues,
      'management_dataset'::text source_type, project_id source_id,
      coalesce(max(project_name), project_id) source_label, false inferred,
      'project'::text drill_type, project_id drill_id,
      '/da?projectId=' || project_id drill_path, null::text supplier_id, null::text warehouse_id
    from scoped_base where project_id is not null and severity in ('critical','warning')
    group by project_id
  ),
  selected_rows as materialized (
    select * from scoped_base where v_view <> 'M05' and view_id = v_view
    union all select * from executive_rows where v_view = 'M05'
  ),
  searched_rows as materialized (
    select * from selected_rows row_data
    where nullif(btrim(v_filter ->> 'search'), '') is null
      or lower(concat_ws(' ', row_data.title, row_data.description, row_data.project_name,
        row_data.owner_name, row_data.source_label)) like '%' || lower(btrim(v_filter ->> 'search')) || '%'
  ),
  numbered_rows as (
    select row_data.*, row_number() over (order by
      case row_data.severity when 'critical' then 0 when 'warning' then 1 else 2 end,
      row_data.due_at nulls last, row_data.id
    ) row_number from searched_rows row_data
  ),
  page_rows as (
    select * from numbered_rows where row_number > v_offset and row_number <= v_offset + v_limit
  ),
  catalog as (
    select * from (values
      ('project.material-risk.count','M01','1.0.0','Công tác nguy cơ thiếu vật tư','record',null,'not_applicable','available',null),
      ('project.unallocated-demand.count','M01','1.0.0','Nhu cầu chưa bố trí','record',null,'not_applicable','available',null),
      ('procurement.unassigned-backlog.count','M02','1.0.0','Backlog chưa có buyer','record',null,'not_applicable','available',null),
      ('procurement.late-delivery.count','M02','1.0.0','Đợt giao trễ','record',null,'not_applicable','available',null),
      ('procurement.open-commitment.count','M02','1.0.0','PO còn nghĩa vụ','record',null,'not_applicable','available',null),
      ('warehouse.qc-wait.count','M03','1.0.0','Lô chờ QC','record',null,'not_applicable','available',null),
      ('warehouse.reconciliation-open.count','M03','1.0.0','Chênh lệch kho mở','record',null,'not_applicable','available',null),
      ('finance.ap-overdue.amount','M04','1.0.0','AP quá hạn','currency',null,'gross','available',null),
      ('finance.received-uninvoiced.amount','M04','1.0.0','Đã nhận chưa invoice','currency',null,'gross','available',null),
      ('finance.cash-paid.amount','M04','1.0.0','Thanh toán đã ghi nhận','currency',null,'gross','available',null),
      ('finance.advance-uncleared.count','M04','1.0.0','Ứng chưa clearing','record',null,'gross','unavailable','FINANCE_ADVANCE_CLEARING_SOURCE_NOT_MAPPED'),
      ('executive.intervention.count','M05','1.0.0','Dự án cần can thiệp','record',null,'not_applicable','available',null),
      ('executive.cost-forecast','M05','1.0.0','Dự báo chi phí','currency',null,'mixed','unavailable','D13_COST_POLICY_NOT_AUTHORITATIVE')
    ) definition(id, view_id, definition_version, label, unit, currency, vat_basis, availability, unavailable_reason)
  )
  select jsonb_build_object(
    'metricVersion', 'g8.management.dataset.v1',
    'asOf', v_as_of,
    'staleAfter', v_as_of + interval '5 minutes',
    'filter', v_filter || jsonb_build_object('viewId', v_view),
    'capabilities', jsonb_build_object(
      'canViewFinancials', exists(select 1 from authorized_projects where can_view_financials),
      'canExport', exists(select 1 from authorized_projects where can_export)
    ),
    'options', jsonb_build_object('projects', coalesce((select jsonb_agg(jsonb_build_object(
      'id', project.id, 'name', project.name, 'constructionSiteId', project.construction_site_id
    ) order by project.name, project.id) from authorized_projects project), '[]'::jsonb)),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object(
      'id', catalog.id, 'viewId', catalog.view_id,
      'definitionVersion', catalog.definition_version, 'label', catalog.label,
      'unit', catalog.unit, 'currency', catalog.currency, 'vatBasis', catalog.vat_basis,
      'availability', case when catalog.view_id = 'M04'
        and not exists(select 1 from authorized_projects where can_view_financials)
        then 'restricted' else catalog.availability end,
      'unavailableReason', case when catalog.view_id = 'M04'
        and not exists(select 1 from authorized_projects where can_view_financials)
        then 'FINANCE_SCOPE_RESTRICTED' else catalog.unavailable_reason end
    ) order by catalog.view_id, catalog.id) from catalog), '[]'::jsonb),
    'totals', jsonb_build_object(
      'rowCount', (select count(*) from searched_rows),
      'criticalCount', (select count(*) from searched_rows where severity = 'critical'),
      'warningCount', (select count(*) from searched_rows where severity = 'warning'),
      'unknownCount', (select count(*) from searched_rows where completeness <> 'complete' or value is null)
    ),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', row_data.id, 'viewId', row_data.view_id, 'metricId', row_data.metric_id,
      'metricDefinitionVersion', row_data.definition_version, 'title', row_data.title,
      'description', row_data.description, 'severity', row_data.severity,
      'projectId', row_data.project_id, 'constructionSiteId', row_data.construction_site_id,
      'projectName', row_data.project_name, 'ownerId', row_data.owner_id,
      'ownerName', row_data.owner_name, 'dueAt', row_data.due_at,
      'value', row_data.value, 'unit', row_data.unit, 'currency', row_data.currency,
      'vatBasis', row_data.vat_basis, 'completeness', row_data.completeness,
      'qualityIssues', to_jsonb(row_data.quality_issues),
      'source', jsonb_build_object('type', row_data.source_type, 'id', row_data.source_id,
        'label', row_data.source_label, 'inferred', row_data.inferred),
      'drill', jsonb_build_object('type', row_data.drill_type, 'id', row_data.drill_id,
        'path', row_data.drill_path)
    ) order by row_data.row_number) from page_rows row_data), '[]'::jsonb),
    'nextCursor', case when (select count(*) from searched_rows) > v_offset + v_limit
      then (v_offset + v_limit)::text || ':' || v_snapshot else null end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function app_private.list_management_dataset_v1(uuid,jsonb,text,integer,timestamptz)
  from public, anon, authenticated;
grant execute on function app_private.list_management_dataset_v1(uuid,jsonb,text,integer,timestamptz)
  to service_role;

create function public.list_management_dataset_v1(
  p_filter jsonb default '{}'::jsonb,
  p_cursor text default null,
  p_limit integer default 50,
  p_as_of timestamptz default null
) returns jsonb language sql stable security definer set search_path = ''
as $$
  select app_private.list_management_dataset_v1(
    public.current_app_user_id(), p_filter, p_cursor, p_limit, p_as_of
  );
$$;
revoke all on function public.list_management_dataset_v1(jsonb,text,integer,timestamptz)
  from public, anon;
grant execute on function public.list_management_dataset_v1(jsonb,text,integer,timestamptz)
  to authenticated, service_role;

-- Batched project lineage. Authoritative normalized links are kept separate
-- from legacy PO.material_request_id inference via the inferred flag.
create or replace function app_private.get_management_lineage_v1(
  p_actor uuid, p_seed_type text, p_seed_id text, p_max_depth integer default 8
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_project_id text;
  v_site_id text;
  v_depth integer := least(12, greatest(1, coalesce(p_max_depth, 8)));
  v_can_finance boolean;
  v_result jsonb;
begin
  if p_actor is null then
    raise exception using errcode = '42501', message = 'MANAGEMENT_LINEAGE_ACCESS_DENIED';
  end if;
  if nullif(p_seed_id, '') is null or p_seed_type not in (
    'project_task','boq_work_item','material_budget_line','material_plan','material_plan_line',
    'material_request','purchase_order','purchase_delivery_batch','quality_check',
    'supplier_payable_document','supplier_invoice','supplier_payment_batch'
  ) then raise exception using errcode = '22023', message = 'MANAGEMENT_LINEAGE_SEED_INVALID'; end if;

  select scope.project_id, scope.construction_site_id into v_project_id, v_site_id
  from (
    select task.project_id, task.construction_site_id from public.project_tasks task
      where p_seed_type = 'project_task' and task.id = p_seed_id
    union all select work.project_id, work.construction_site_id from public.project_work_boq_items work
      where p_seed_type = 'boq_work_item' and work.id = p_seed_id
    union all select budget.project_id, budget.construction_site_id from public.material_budget_items budget
      where p_seed_type = 'material_budget_line' and budget.id = p_seed_id
    union all select plan.project_id, plan.construction_site_id from public.material_plans plan
      where p_seed_type = 'material_plan' and plan.id::text = p_seed_id
    union all select plan.project_id, plan.construction_site_id from public.material_plan_lines line
      join public.material_plans plan on plan.id = line.plan_id
      where p_seed_type = 'material_plan_line' and line.id::text = p_seed_id
    union all select request.project_id, request.construction_site_id from public.requests request
      where p_seed_type = 'material_request' and request.id = p_seed_id
    union all select po.project_id, po.construction_site_id from public.purchase_orders po
      where p_seed_type = 'purchase_order' and po.id = p_seed_id
    union all select batch.project_id, batch.construction_site_id from public.purchase_order_delivery_batches batch
      where p_seed_type in ('purchase_delivery_batch','quality_check') and batch.id::text = p_seed_id
    union all select document.project_id, document.construction_site_id from public.supplier_payable_documents document
      where p_seed_type = 'supplier_payable_document' and document.id::text = p_seed_id
    union all select link.project_id, link.construction_site_id from public.supplier_invoice_payable_links link
      where p_seed_type = 'supplier_invoice' and link.invoice_id::text = p_seed_id
    union all select batch.project_id, batch.construction_site_id from public.supplier_payment_batches batch
      where p_seed_type = 'supplier_payment_batch' and batch.id::text = p_seed_id
  ) scope limit 1;
  if v_project_id is null or not app_private.project_has_permission_v2(
    v_project_id, v_site_id, 'project.dashboard.view_progress', p_actor
  ) then raise exception using errcode = '42501', message = 'MANAGEMENT_LINEAGE_ACCESS_DENIED'; end if;
  v_can_finance := app_private.project_has_permission_v2(
    v_project_id, v_site_id, 'project.dashboard.view_financials', p_actor
  );

  with recursive all_edges as materialized (
    select 'project_task'::text from_type, work.source_task_id from_id,
      'boq_work_item'::text to_type, work.id to_id, 'defines_work'::text relation, false inferred
    from public.project_work_boq_items work
    where work.project_id = v_project_id and work.construction_site_id is not distinct from v_site_id
      and work.source_task_id is not null
    union all select 'boq_work_item', budget.work_boq_item_id, 'material_budget_line', budget.id,
      'budgets_material', false
    from public.material_budget_items budget where budget.project_id = v_project_id
      and budget.construction_site_id is not distinct from v_site_id and budget.work_boq_item_id is not null
    union all select 'material_budget_line', allocation.source_budget_line_id,
      'material_plan_line', allocation.plan_line_id::text, 'allocates_plan', false
    from public.material_plan_allocations allocation join public.material_plans plan on plan.id=allocation.plan_id
    where plan.project_id=v_project_id and plan.construction_site_id is not distinct from v_site_id
      and allocation.archived_at is null
    union all select 'material_plan_line', line.id::text, 'material_plan', line.plan_id::text,
      'belongs_to_plan', false from public.material_plan_lines line join public.material_plans plan on plan.id=line.plan_id
    where plan.project_id=v_project_id and plan.construction_site_id is not distinct from v_site_id
    union all select 'material_plan', conversion.plan_id::text, 'material_request', conversion.request_id,
      'converted_to_request', false from public.material_plan_conversions conversion
      join public.material_plans plan on plan.id=conversion.plan_id
    where plan.project_id=v_project_id and plan.construction_site_id is not distinct from v_site_id
      and conversion.state='active'
    union all select 'material_request', link.material_request_id, 'purchase_order', link.purchase_order_id,
      'ordered_by_line', false from public.purchase_order_request_lines link
    where link.project_id=v_project_id and link.construction_site_id is not distinct from v_site_id
    union all select 'material_request', po.material_request_id, 'purchase_order', po.id,
      'legacy_order_reference', true from public.purchase_orders po
    where po.project_id=v_project_id and po.construction_site_id is not distinct from v_site_id
      and po.material_request_id is not null and not exists (
        select 1 from public.purchase_order_request_lines link where link.purchase_order_id=po.id
      )
    union all select 'purchase_order', batch.purchase_order_id, 'purchase_delivery_batch', batch.id::text,
      'scheduled_delivery', false from public.purchase_order_delivery_batches batch
    where batch.project_id=v_project_id and batch.construction_site_id is not distinct from v_site_id
    union all select 'purchase_delivery_batch', batch.id::text, 'quality_check', batch.id::text,
      'quality_control', false from public.purchase_order_delivery_batches batch
    where batch.project_id=v_project_id and batch.construction_site_id is not distinct from v_site_id
      and batch.quality_result is not null
    union all select 'purchase_delivery_batch', document.source_id, 'supplier_payable_document', document.id::text,
      'recognizes_ap', false from public.supplier_payable_documents document
    where v_can_finance and document.project_id=v_project_id
      and document.construction_site_id is not distinct from v_site_id
      and document.source_type='purchase_delivery_receipt'
    union all select 'supplier_payable_document', link.payable_document_id::text, 'supplier_invoice', link.invoice_id::text,
      'matched_invoice', false from public.supplier_invoice_payable_links link
    where v_can_finance and link.project_id=v_project_id
      and link.construction_site_id is not distinct from v_site_id
    union all select 'supplier_payable_document', allocation.payable_document_id::text,
      'supplier_payment_batch', allocation.payment_batch_id::text, 'paid_by', false
    from public.supplier_payment_allocations allocation
    join public.supplier_payment_batches batch on batch.id=allocation.payment_batch_id
    where v_can_finance and batch.project_id=v_project_id
      and batch.construction_site_id is not distinct from v_site_id
  ),
  walk(node_type,node_id,depth) as (
    select p_seed_type,p_seed_id,0
    union
    select case when edge.from_type=walk.node_type and edge.from_id=walk.node_id then edge.to_type else edge.from_type end,
      case when edge.from_type=walk.node_type and edge.from_id=walk.node_id then edge.to_id else edge.from_id end,
      walk.depth+1
    from walk join all_edges edge on (edge.from_type=walk.node_type and edge.from_id=walk.node_id)
      or (edge.to_type=walk.node_type and edge.to_id=walk.node_id)
    where walk.depth < v_depth
  ),
  visited as materialized (select node_type,node_id,min(depth) depth from walk group by node_type,node_id),
  visible_edges as (
    select edge.* from all_edges edge
    join visited source on source.node_type=edge.from_type and source.node_id=edge.from_id
    join visited target on target.node_type=edge.to_type and target.node_id=edge.to_id
  ),
  nodes as (
    select 'project_task'::text type, task.id, task.name label, coalesce(task.code,task.id) document_no,
      task.progress::text status, jsonb_build_object('projectId',task.project_id) metadata
    from public.project_tasks task join visited on visited.node_type='project_task' and visited.node_id=task.id
    union all select 'boq_work_item',work.id,work.name,coalesce(work.wbs_code,work.id),null,
      jsonb_build_object('projectId',work.project_id) from public.project_work_boq_items work
      join visited on visited.node_type='boq_work_item' and visited.node_id=work.id
    union all select 'material_budget_line',budget.id,budget.item_name,coalesce(budget.material_code,budget.id),null,
      jsonb_build_object('unit',budget.unit) from public.material_budget_items budget
      join visited on visited.node_type='material_budget_line' and visited.node_id=budget.id
    union all select 'material_plan',plan.id::text,plan.title,plan.plan_no,plan.status,
      jsonb_build_object('version',plan.current_version) from public.material_plans plan
      join visited on visited.node_type='material_plan' and visited.node_id=plan.id::text
    union all select 'material_plan_line',line.id::text,line.item_name_snapshot,coalesce(line.sku_snapshot,line.id::text),null,
      jsonb_build_object('unit',line.unit,'quantity',line.quantity) from public.material_plan_lines line
      join visited on visited.node_type='material_plan_line' and visited.node_id=line.id::text
    union all select 'material_request',request.id,request.title,request.code,request.status::text,
      jsonb_build_object('projectId',request.project_id) from public.requests request
      join visited on visited.node_type='material_request' and visited.node_id=request.id
    union all select 'purchase_order',po.id,coalesce(po.vendor_name,po.po_number),po.po_number,po.status,
      jsonb_build_object('projectId',po.project_id) from public.purchase_orders po
      join visited on visited.node_type='purchase_order' and visited.node_id=po.id
    union all select 'purchase_delivery_batch',batch.id::text,
      po.po_number||'-'||batch.delivery_no::text,po.po_number||'-'||batch.delivery_no::text,batch.status,
      jsonb_build_object('qualityResult',batch.quality_result) from public.purchase_order_delivery_batches batch
      join public.purchase_orders po on po.id=batch.purchase_order_id
      join visited on visited.node_type='purchase_delivery_batch' and visited.node_id=batch.id::text
    union all select 'quality_check',batch.id::text,'QC '||po.po_number||'-'||batch.delivery_no::text,
      po.po_number||'-'||batch.delivery_no::text,coalesce(batch.quality_result,'pending'),
      jsonb_build_object('approvedAt',batch.quality_approved_at) from public.purchase_order_delivery_batches batch
      join public.purchase_orders po on po.id=batch.purchase_order_id
      join visited on visited.node_type='quality_check' and visited.node_id=batch.id::text
    union all select 'supplier_payable_document',document.id::text,document.supplier_name_snapshot,
      document.document_no,document.status,jsonb_build_object('currency',document.currency)
      from public.supplier_payable_documents document join visited
        on visited.node_type='supplier_payable_document' and visited.node_id=document.id::text where v_can_finance
    union all select 'supplier_invoice',invoice.id::text,invoice.supplier_name_snapshot,
      invoice.invoice_number,invoice.status,jsonb_build_object('currency',invoice.currency)
      from public.supplier_invoices invoice join visited
        on visited.node_type='supplier_invoice' and visited.node_id=invoice.id::text where v_can_finance
    union all select 'supplier_payment_batch',batch.id::text,batch.supplier_name_snapshot,
      batch.code,batch.status,jsonb_build_object('currency',batch.currency)
      from public.supplier_payment_batches batch join visited
        on visited.node_type='supplier_payment_batch' and visited.node_id=batch.id::text where v_can_finance
  )
  select jsonb_build_object(
    'metricVersion','g8.lineage.v1','seed',jsonb_build_object('type',p_seed_type,'id',p_seed_id),
    'nodes',coalesce((select jsonb_agg(jsonb_build_object(
      'type',nodes.type,'id',nodes.id,'label',nodes.label,'documentNo',nodes.document_no,
      'status',nodes.status,'amount',null,'metadata',nodes.metadata
    ) order by visited.depth,nodes.type,nodes.id) from nodes join visited
      on visited.node_type=nodes.type and visited.node_id=nodes.id),'[]'::jsonb),
    'edges',coalesce((select jsonb_agg(jsonb_build_object(
      'from',edge.from_type||':'||edge.from_id,'to',edge.to_type||':'||edge.to_id,
      'relation',edge.relation,'amount',null,
      'metadata',jsonb_build_object('inferred',edge.inferred)
    ) order by edge.from_type,edge.from_id,edge.to_type,edge.to_id) from visible_edges edge),'[]'::jsonb),
    'completeness',jsonb_build_object(
      'financeRestricted',not v_can_finance,
      'hasInferredHistory',exists(select 1 from visible_edges where inferred)
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function app_private.get_management_lineage_v1(uuid,text,text,integer)
  from public, anon, authenticated;
grant execute on function app_private.get_management_lineage_v1(uuid,text,text,integer)
  to service_role;
create function public.get_management_lineage_v1(
  p_seed_type text, p_seed_id text, p_max_depth integer default 8
) returns jsonb language sql stable security definer set search_path = ''
as $$
  select app_private.get_management_lineage_v1(
    public.current_app_user_id(), p_seed_type, p_seed_id, p_max_depth
  );
$$;
revoke all on function public.get_management_lineage_v1(text,text,integer) from public, anon;
grant execute on function public.get_management_lineage_v1(text,text,integer) to authenticated, service_role;

notify pgrst, 'reload schema';
