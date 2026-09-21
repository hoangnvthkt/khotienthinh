begin;
set local statement_timeout = '20s';

insert into public.users (id,name,email,username,role,is_active,account_status) values
('81111111-1111-4111-8111-111111111111','G8 Admin','g8-admin@example.test','g8-admin','ADMIN',true,'ACTIVE'),
('82222222-2222-4222-8222-222222222222','G8 Limited','g8-limited@example.test','g8-limited','EMPLOYEE',true,'ACTIVE');

insert into public.projects (id,code,name,status) values
('g8-project-a','G8-A','G8 Project A','active'),
('g8-project-b','G8-B','G8 Project B','active');

insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,is_active,granted_by,grant_reason)
values
('82222222-2222-4222-8222-222222222222','project.dashboard.view_progress','project','g8-project-a',true,'81111111-1111-4111-8111-111111111111','G8 scoped read smoke');

insert into public.purchase_orders(
  id,project_id,vendor_id,vendor_name,po_number,items,total_amount,order_date,
  expected_delivery_date,status,source_mode,created_by_id
) values
('g8-po-a','g8-project-a','g8-supplier','G8 Supplier',public.next_purchase_order_number_v2(),'[]',100,current_date::text,(current_date-1)::text,'confirmed','proactive_project','81111111-1111-4111-8111-111111111111'),
('g8-po-b','g8-project-b','g8-supplier','G8 Supplier',public.next_purchase_order_number_v2(),'[]',100,current_date::text,(current_date-1)::text,'confirmed','proactive_project','81111111-1111-4111-8111-111111111111');

insert into public.purchase_order_delivery_batches(
  id,purchase_order_id,project_id,delivery_no,planned_delivery_date,status,
  supplier_id,supplier_name_snapshot,quality_result
) values
('83333333-3333-4333-8333-333333333331','g8-po-a','g8-project-a',1,current_date-1,'receiving','g8-supplier','G8 Supplier','passed'),
('83333333-3333-4333-8333-333333333332','g8-po-b','g8-project-b',1,current_date-1,'receiving','g8-supplier','G8 Supplier','passed');

insert into public.supplier_payable_documents(
  id,code,source_type,source_id,project_id,supplier_id,supplier_name_snapshot,
  document_no,document_date,due_date,currency,committed_amount,recognized_amount,credit_amount,status,created_by
) values (
  '84444444-4444-4444-8444-444444444441','G8-AP-A','purchase_delivery_receipt',
  '83333333-3333-4333-8333-333333333331','g8-project-a','g8-supplier','G8 Supplier',
  'G8-AP-A',current_date-10,current_date-1,'VND',100,100,0,'open','81111111-1111-4111-8111-111111111111'
);

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','81111111-1111-4111-8111-111111111111','email','g8-admin@example.test','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_m02 jsonb; v_m04 jsonb; v_m05 jsonb; v_graph jsonb; v_cursor text; v_next jsonb;
begin
  v_m02 := public.list_management_dataset_v1('{"viewId":"M02"}'::jsonb,null,50,current_date::timestamptz + interval '12 hours');
  if v_m02 ->> 'metricVersion' <> 'g8.management.dataset.v1'
    or (v_m02 #>> '{totals,rowCount}')::int <> 4 then
    raise exception 'G8_ADMIN_M02_TOTAL_MISMATCH: %',v_m02;
  end if;
  if jsonb_array_length(v_m02 -> 'rows') <> 4 then raise exception 'G8_ADMIN_M02_PAGE_MISMATCH'; end if;

  v_m04 := public.list_management_dataset_v1('{"viewId":"M04"}'::jsonb,null,50,current_date::timestamptz + interval '12 hours');
  if (v_m04 #>> '{totals,rowCount}')::int <> 2
    or not (v_m04 #>> '{capabilities,canViewFinancials}')::boolean then
    raise exception 'G8_ADMIN_M04_MISMATCH: %',v_m04;
  end if;

  v_m05 := public.list_management_dataset_v1('{"viewId":"M05"}'::jsonb,null,1,current_date::timestamptz + interval '12 hours');
  if (v_m05 #>> '{totals,rowCount}')::int <> 2 or jsonb_array_length(v_m05 -> 'rows') <> 1 then
    raise exception 'G8_ADMIN_M05_PAGE_MISMATCH: %',v_m05;
  end if;
  v_cursor := v_m05 ->> 'nextCursor';
  if v_cursor is null then raise exception 'G8_CURSOR_MISSING'; end if;
  v_next := public.list_management_dataset_v1('{"viewId":"M05"}'::jsonb,v_cursor,1,(v_m05 ->> 'asOf')::timestamptz);
  if jsonb_array_length(v_next -> 'rows') <> 1 or v_next ->> 'nextCursor' is not null then
    raise exception 'G8_CURSOR_PAGE_MISMATCH: %',v_next;
  end if;

  v_graph := public.get_management_lineage_v1('purchase_order','g8-po-a',8);
  if not exists(select 1 from jsonb_array_elements(v_graph -> 'nodes') node where node ->> 'type'='quality_check')
    or not exists(select 1 from jsonb_array_elements(v_graph -> 'nodes') node where node ->> 'type'='supplier_payable_document')
    or (v_graph #>> '{completeness,hasInferredHistory}')::boolean then
    raise exception 'G8_LINEAGE_MISMATCH: %',v_graph;
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','82222222-2222-4222-8222-222222222222','email','g8-limited@example.test','role','authenticated'
)::text,true);
set local role authenticated;

do $$
declare v_m02 jsonb; v_m04 jsonb; v_m05 jsonb; v_graph jsonb;
begin
  v_m02 := public.list_management_dataset_v1('{"viewId":"M02"}'::jsonb,null,50,current_date::timestamptz + interval '12 hours');
  if (v_m02 #>> '{totals,rowCount}')::int <> 2
    or exists(select 1 from jsonb_array_elements(v_m02 -> 'rows') row where row ->> 'projectId' <> 'g8-project-a') then
    raise exception 'G8_SCOPE_LEAK: %',v_m02;
  end if;
  v_m04 := public.list_management_dataset_v1('{"viewId":"M04"}'::jsonb,null,50,current_date::timestamptz + interval '12 hours');
  if (v_m04 #>> '{totals,rowCount}')::int <> 0
    or (v_m04 #>> '{capabilities,canViewFinancials}')::boolean
    or not exists(select 1 from jsonb_array_elements(v_m04 -> 'catalog') metric
      where metric ->> 'viewId'='M04' and metric ->> 'availability'='restricted'
        and metric ->> 'unavailableReason'='FINANCE_SCOPE_RESTRICTED') then
    raise exception 'G8_FINANCE_RESTRICTION_FAILED: %',v_m04;
  end if;
  v_m05 := public.list_management_dataset_v1('{"viewId":"M05"}'::jsonb,null,50,current_date::timestamptz + interval '12 hours');
  if (v_m05 #>> '{totals,rowCount}')::int <> 1 then raise exception 'G8_EXECUTIVE_SCOPE_LEAK: %',v_m05; end if;
  v_graph := public.get_management_lineage_v1('purchase_order','g8-po-a',8);
  if exists(select 1 from jsonb_array_elements(v_graph -> 'nodes') node where node ->> 'type'='supplier_payable_document')
    or not (v_graph #>> '{completeness,financeRestricted}')::boolean then
    raise exception 'G8_LINEAGE_FINANCE_LEAK: %',v_graph;
  end if;
  begin
    perform public.get_management_lineage_v1('purchase_order','g8-po-b',8);
    raise exception 'G8_FOREIGN_SCOPE_LINEAGE_ALLOWED';
  exception when insufficient_privilege then null;
  end;
end;
$$;

rollback;
