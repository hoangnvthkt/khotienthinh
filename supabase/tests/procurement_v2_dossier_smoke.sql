-- Run after the Task 8 fixture within the same rollback-only Cloud transaction.
do $$
declare
  v_ids record;
  v_page jsonb;
  v_detail jsonb;
  v_demand_id uuid;
  v_cursor text;
  v_owner_id uuid;
  v_source_id uuid;
  v_revision_id uuid;
  v_registry_id uuid;
  v_request_demand_id uuid;
  v_outsider_id uuid;
begin
  select * into v_ids from task8_ids;
  v_outsider_id := gen_random_uuid();
  insert into public.users(id,name,email,username,role)
  values (v_outsider_id,'Task 9 outsider','project-v2-task9-outsider@example.invalid',
    'task9-' || left(v_outsider_id::text,8),'EMPLOYEE');
  select id into v_owner_id from public.procurement_owner_contexts
    where logical_key = 'company_default';
  insert into public.procurement_source_documents(owner_context_id,source_adapter,
    source_document_id,source_code_snapshot,project_id,current_revision,source_hash)
  values (v_owner_id,'project_material_request','task9-mr-fixture','MR-T9',
    v_ids.project_id,1,repeat('a',64)) returning id into v_source_id;
  insert into public.procurement_source_revisions(source_document_id,revision,
    source_hash,payload,changed_by)
  values (v_source_id,1,repeat('a',64),'{}'::jsonb,v_ids.reviewer_id)
    returning id into v_revision_id;
  insert into public.procurement_source_line_registry(source_document_id,
    source_line_id,item_id,unit,source_hash,first_revision,last_revision)
  values (v_source_id,'mr-line',v_ids.item_id,'kg',repeat('b',64),1,1)
    returning id into v_registry_id;
  insert into public.procurement_demands(owner_context_id,source_document_id,
    current_source_revision_id,project_id,source_code_snapshot,intake_state,
    health_state,created_by,updated_by)
  values (v_owner_id,v_source_id,v_revision_id,v_ids.project_id,'MR-T9','ready',
    'healthy',v_ids.reviewer_id,v_ids.reviewer_id) returning id into v_request_demand_id;
  insert into public.procurement_demand_lines(demand_id,source_line_registry_id,
    current_source_revision_id,item_id,unit,requested_qty,approved_qty,
    intake_state,health_state)
  values (v_request_demand_id,v_registry_id,v_revision_id,v_ids.item_id,'kg',12,12,
    'ready','healthy');
  select d.id into v_demand_id from public.procurement_demands d
    join public.procurement_source_documents source on source.id = d.source_document_id
    where source.source_adapter = 'material_plan'
      and source.source_code_snapshot = 'V-T8';
  perform set_config('request.jwt.claims',
    '{"email":"project-v2-task8-reviewer@example.invalid"}', true);
  v_page := public.list_procurement_dossiers_v2(
    jsonb_build_object('projectId', v_ids.project_id), null, 1);
  if v_page #>> '{counters,0,grain}' <> 'document'
    or (v_page #>> '{counters,0,count}')::integer <> 3
    or jsonb_array_length(v_page -> 'items') <> 1
    or v_page ->> 'nextCursor' is null then
    raise exception 'TASK9_DOCUMENT_GRAIN_INVALID';
  end if;
  v_cursor := v_page ->> 'nextCursor';
  v_page := public.list_procurement_dossiers_v2(
    jsonb_build_object('projectId', v_ids.project_id), v_cursor, 1);
  if jsonb_array_length(v_page -> 'items') <> 1 or v_page ->> 'nextCursor' is null then
    raise exception 'TASK9_CURSOR_INVALID';
  end if;
  v_page := public.list_procurement_dossiers_v2(jsonb_build_object(
    'projectId',v_ids.project_id,'source','project_material_request'),null,10);
  if (v_page #>> '{counters,0,count}')::integer <> 1
    or v_page #>> '{items,0,sourceCode}' <> 'MR-T9' then
    raise exception 'TASK9_REQUEST_ADAPTER_INVALID';
  end if;
  v_page := public.list_procurement_dossiers_v2(
    jsonb_build_object('projectId', 'other-project'), null, 10);
  if (v_page #>> '{counters,0,count}')::integer <> 0 then
    raise exception 'TASK9_SCOPE_LEAK';
  end if;
  v_detail := public.get_procurement_dossier_v2(v_demand_id);
  if v_detail ->> 'sourceAdapter' <> 'material_plan'
    or v_detail #>> '{sourceRef,id}' is null
    or v_detail ->> 'stage' <> 'reconcile'
    or (v_detail ->> 'lineCount')::integer <> 2
    or v_detail #>> '{lines,0,availableToPlanQty}' is not null
    or v_detail #>> '{lines,0,neededDate}' is null
    or v_detail ? 'unitPrice' then
    raise exception 'TASK9_DETAIL_UNKNOWN_OR_SOURCE_INVALID';
  end if;
  v_detail := public.get_procurement_dossier_v2(v_request_demand_id);
  if v_detail ->> 'sourceAdapter' <> 'project_material_request'
    or v_detail #>> '{lines,0,approvedQty}' <> '12.000000'
    or v_detail #>> '{lines,0,availableToPlanQty}' <> '12.000000' then
    raise exception 'TASK9_REQUEST_DETAIL_INVALID';
  end if;
  update public.procurement_demands set version = version + 1
    where id = v_request_demand_id;
  begin
    perform public.list_procurement_dossiers_v2(
      jsonb_build_object('projectId', v_ids.project_id), v_cursor, 1);
    raise exception 'TASK9_STALE_CURSOR_ACCEPTED';
  exception when serialization_failure then null;
  end;
  perform set_config('request.jwt.claims',
    '{"email":"project-v2-task9-outsider@example.invalid"}', true);
  v_page := public.list_procurement_dossiers_v2('{}'::jsonb,null,10);
  if (v_page #>> '{counters,0,count}')::integer <> 0 then
    raise exception 'TASK9_UNAUTHORIZED_COUNT_LEAK';
  end if;
  begin
    perform public.get_procurement_dossier_v2(v_demand_id);
    raise exception 'TASK9_UNAUTHORIZED_DETAIL_READ';
  exception when insufficient_privilege then null;
  end;
end $$;
