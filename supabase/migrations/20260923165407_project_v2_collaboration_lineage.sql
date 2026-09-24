-- Guarded keyset pages keep discussion and activity bounded at document grain.
create or replace function public.list_project_v2_plan_collaboration_v1(
  p_plan_id uuid, p_kind text, p_limit integer default 30,
  p_before_at timestamptz default null, p_before_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 30)));
  v_all jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_last jsonb;
  v_more boolean;
begin
  if p_kind not in ('comments', 'events') or (p_before_at is null) <> (p_before_id is null) then
    raise exception using errcode = '22023', message = 'PROJECT_V2_COLLABORATION_CURSOR_INVALID';
  end if;
  select * into v_plan from public.project_v2_plans where id = p_plan_id;
  select * into v_workspace from public.project_v2_workspaces
    where id = v_plan.workspace_id and lifecycle <> 'archived';
  if v_actor is null or v_workspace.id is null then
    raise exception using errcode = '42501', message = 'PROJECT_V2_READ_DENIED';
  end if;
  perform app_private.project_v2_assert_permission(v_workspace, v_plan.plan_type, 'view', v_actor);
  if p_kind = 'comments' then
    select coalesce(jsonb_agg(entry.payload order by entry.created_at desc, entry.id desc), '[]'::jsonb)
    into v_all from (select c.id,c.created_at,jsonb_build_object(
      'id',c.id,'revision',c.revision_no,'authorUserId',c.author_user_id,
      'body',c.body,'createdAt',c.created_at) payload
      from public.project_v2_plan_comments c where c.plan_id=p_plan_id
        and (p_before_at is null or (c.created_at,c.id)<(p_before_at,p_before_id))
      order by c.created_at desc,c.id desc limit v_limit+1) entry;
  else
    select coalesce(jsonb_agg(entry.payload order by entry.occurred_at desc, entry.id desc), '[]'::jsonb)
    into v_all from (select e.id,e.occurred_at,jsonb_build_object(
      'id',e.id,'revision',e.revision_no,'eventType',e.event_type,
      'actorUserId',e.actor_user_id,'reason',e.reason,'metadata',e.payload,
      'occurredAt',e.occurred_at) payload
      from public.project_v2_plan_events e where e.plan_id=p_plan_id
        and (p_before_at is null or (e.occurred_at,e.id)<(p_before_at,p_before_id))
      order by e.occurred_at desc,e.id desc limit v_limit+1) entry;
  end if;
  v_more := jsonb_array_length(v_all)>v_limit;
  if v_more then
    select coalesce(jsonb_agg(value order by ordinality), '[]'::jsonb) into v_items
    from jsonb_array_elements(v_all) with ordinality entry(value, ordinality)
    where ordinality<=v_limit;
    v_last := v_items -> (v_limit-1);
  else v_items := v_all; end if;
  return jsonb_build_object('asOf',now(),'items',v_items,
    'nextCursor',case when v_more then jsonb_build_object(
      'at',coalesce(v_last->'createdAt',v_last->'occurredAt'),'id',v_last->'id')
      else 'null'::jsonb end);
end;
$$;
revoke all on function public.list_project_v2_plan_collaboration_v1(
  uuid,text,integer,timestamptz,uuid) from public,anon;
grant execute on function public.list_project_v2_plan_collaboration_v1(
  uuid,text,integer,timestamptz,uuid) to authenticated,service_role;

-- The link payload never contains a protected plan's ID, title, code or revision.
create or replace function app_private.project_v2_link_payload_v1(
  p_plan_id uuid,p_revision_no integer,p_actor uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
  v_approved boolean;
begin
  select * into v_plan from public.project_v2_plans where id=p_plan_id;
  select * into v_workspace from public.project_v2_workspaces
    where id=v_plan.workspace_id and lifecycle<>'archived';
  if p_actor is null or v_workspace.id is null or not coalesce(
    app_private.project_has_permission_v2(v_workspace.project_id,
      v_workspace.primary_construction_site_id::text,
      'project.v2_'||v_plan.plan_type||'_plan.view',p_actor),false) then
    return jsonb_build_object('canOpen',false);
  end if;
  select exists(select 1 from public.project_v2_plan_revisions r
    where r.plan_id=p_plan_id and r.revision_no=p_revision_no and r.approved_at is not null)
    into v_approved;
  return jsonb_build_object('canOpen',true,'id',v_plan.id,
    'revision',case when v_approved then p_revision_no else null end,
    'code',v_plan.code,'title',v_plan.title,'planType',v_plan.plan_type);
end;
$$;
revoke all on function app_private.project_v2_link_payload_v1(uuid,integer,uuid)
  from public,anon,authenticated;

create or replace function public.get_project_v2_plan_lineage_v1(
  p_plan_id uuid,p_revision_no integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
  v_sources jsonb;
  v_downstream jsonb;
begin
  select * into v_plan from public.project_v2_plans where id=p_plan_id;
  select * into v_workspace from public.project_v2_workspaces
    where id=v_plan.workspace_id and lifecycle<>'archived';
  if v_actor is null or v_workspace.id is null or p_revision_no is null or p_revision_no<1 then
    raise exception using errcode='42501',message='PROJECT_V2_READ_DENIED';
  end if;
  perform app_private.project_v2_assert_permission(v_workspace,v_plan.plan_type,'view',v_actor);
  if not exists(select 1 from public.project_v2_plan_lines l
    where l.plan_id=p_plan_id and l.revision_no=p_revision_no) then
    return jsonb_build_object('sources','[]'::jsonb,'downstream','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(app_private.project_v2_link_payload_v1(
    relation.source_plan_id,relation.source_plan_revision_no,v_actor)), '[]'::jsonb)
  into v_sources from (select distinct s.source_plan_id,s.source_plan_revision_no
    from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines target on target.id=s.target_line_id
    where target.plan_id=p_plan_id and target.revision_no=p_revision_no
      and s.source_plan_id is not null) relation;
  select coalesce(jsonb_agg(app_private.project_v2_link_payload_v1(
    relation.target_plan_id,relation.target_revision_no,v_actor)), '[]'::jsonb)
  into v_downstream from (select distinct target.plan_id target_plan_id,
      target.revision_no target_revision_no
    from public.project_v2_plan_line_sources s
    join public.project_v2_plan_lines target on target.id=s.target_line_id
    where s.source_plan_id=p_plan_id and s.source_plan_revision_no=p_revision_no) relation;
  return jsonb_build_object('sources',v_sources,'downstream',v_downstream);
end;
$$;
revoke all on function public.get_project_v2_plan_lineage_v1(uuid,integer) from public,anon;
grant execute on function public.get_project_v2_plan_lineage_v1(uuid,integer)
  to authenticated,service_role;

-- Historical links resolve to the exact approved revision, including its own lines.
create or replace function public.get_project_v2_plan_revision_v1(
  p_plan_id uuid,p_revision_no integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_current jsonb;
  v_plan public.project_v2_plans%rowtype;
  v_revision public.project_v2_plan_revisions%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
  v_can_view_price boolean;
begin
  v_current := public.get_project_v2_plan_v1(p_plan_id);
  select * into strict v_plan from public.project_v2_plans where id=p_plan_id;
  select * into strict v_workspace from public.project_v2_workspaces where id=v_plan.workspace_id;
  select * into v_revision from public.project_v2_plan_revisions r
    where r.plan_id=p_plan_id and r.revision_no=p_revision_no;
  if p_revision_no is null or p_revision_no<1 or v_revision.plan_id is null
    or v_revision.approved_at is null
    or jsonb_typeof(v_revision.approved_snapshot->'plan')<>'object' then
    raise exception using errcode='P0002',message='PROJECT_V2_APPROVED_REVISION_NOT_FOUND';
  end if;
  v_can_view_price := coalesce((v_current #>> '{capabilities,priceVisible}')::boolean,false);
  return jsonb_build_object('asOf',now(),'historical',true,
    'plan',(v_revision.approved_snapshot->'plan')||jsonb_build_object(
      'revision_no',p_revision_no,'status','approved',
      'approver_user_id',v_revision.approved_by,'approved_at',v_revision.approved_at,
      'content_hash',v_revision.content_hash,'effective_revision_no',p_revision_no),
    'capabilities',jsonb_build_object('view',true,'priceVisible',v_can_view_price),
    'lines',coalesce((select jsonb_agg((case when v_can_view_price then to_jsonb(l)
      else to_jsonb(l)-'unit_price_snapshot' end)||jsonb_build_object(
      'displayCode',coalesce(i.code,t.code,it.sku),
      'displayName',coalesce(i.name,t.name,it.name)) order by l.sort_order,l.id)
      from public.project_v2_plan_lines l
      left join public.contract_items i on i.project_id=v_workspace.project_id
        and (i.id=l.contract_item_id or (l.plan_type='construction' and i.id::text=l.work_item_id))
      left join public.project_tasks t on t.project_id=v_workspace.project_id and t.id=l.work_item_id
      left join public.items it on it.id=l.inventory_item_id
      where l.plan_id=p_plan_id and l.revision_no=p_revision_no),'[]'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.id)
      from public.project_v2_plan_line_sources s
      join public.project_v2_plan_lines l on l.id=s.target_line_id
      where l.plan_id=p_plan_id and l.revision_no=p_revision_no),'[]'::jsonb));
end;
$$;
revoke all on function public.get_project_v2_plan_revision_v1(uuid,integer)
  from public,anon;
grant execute on function public.get_project_v2_plan_revision_v1(uuid,integer)
  to authenticated,service_role;

-- Procurement can reveal the approved plan revision only to actors allowed to
-- view that plan. The dossier itself keeps its independent buyer permission.
create or replace function public.get_procurement_dossier_v2(p_demand_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_payload jsonb := app_private.procurement_v2_dossier_payload_v2(p_demand_id);
  v_source public.procurement_source_documents%rowtype;
  v_source_revision public.procurement_source_revisions%rowtype;
  v_plan public.project_v2_plans%rowtype;
  v_workspace public.project_v2_workspaces%rowtype;
  v_can_open boolean := false;
begin
  if v_payload ->> 'sourceAdapter' = 'material_plan' then
    select source.* into v_source from public.procurement_demands demand
    join public.procurement_source_documents source on source.id=demand.source_document_id
    where demand.id=p_demand_id;
    select revision.* into v_source_revision from public.procurement_demands demand
    join public.procurement_source_revisions revision
      on revision.id=demand.current_source_revision_id
    where demand.id=p_demand_id;
    select * into v_plan from public.project_v2_plans
      where id::text=v_source.source_document_id;
    select * into v_workspace from public.project_v2_workspaces
      where id=v_plan.workspace_id and project_id=v_payload->>'projectId'
        and lifecycle<>'archived';
    v_can_open := v_source_revision.id is not null and v_workspace.id is not null and coalesce(
      app_private.project_has_permission_v2(v_workspace.project_id,
        v_workspace.primary_construction_site_id::text,
        'project.v2_material_plan.view',public.current_app_user_id()),false);
    v_payload := jsonb_set(v_payload,'{sourceRef}',jsonb_build_object(
      'adapter','material_plan','canOpen',v_can_open,
      'id',case when v_can_open then to_jsonb(v_source.source_document_id) else 'null'::jsonb end,
      'revision',case when v_can_open then to_jsonb(v_source_revision.revision) else 'null'::jsonb end));
    if not v_can_open then
      v_payload := v_payload||jsonb_build_object('sourceCode','Tài liệu nguồn được bảo vệ',
        'sourceDocumentId',null);
    end if;
  end if;
  return v_payload||jsonb_build_object('asOf',now());
end;
$$;
revoke all on function public.get_procurement_dossier_v2(uuid) from public,anon;
grant execute on function public.get_procurement_dossier_v2(uuid) to authenticated,service_role;
