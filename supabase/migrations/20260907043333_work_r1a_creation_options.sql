-- Task 8 UI reads: bounded, minimal projections and canonical creation decisions.
create function app_private.work_creation_context(p_scope jsonb,p_priority text default 'normal')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=app_private.work_assert_create_scope(p_scope); v_ctx text; v_id text; v_ready boolean:=true;
begin
 v_ctx:=case when p_scope->>'type'='direct' then 'own' else p_scope->>'type' end;
 v_id:=coalesce(p_scope->>'departmentId',p_scope->>'projectId','*');
 begin perform app_private.work_resolve_sla(p_scope,p_priority,now());
 exception when sqlstate 'P0001' then if sqlerrm='WORK_CALENDAR_NOT_CONFIGURED' then v_ready:=false; else raise; end if; end;
 return jsonb_build_object('actorId',v_actor,'canCreate',true,'calendarReady',v_ready,
  'canAssignUser',app_private.has_permission(v_actor,'work.task.assign_user',v_ctx,v_id),
  'canAssignGroup',app_private.has_permission(v_actor,'work.task.assign_group',v_ctx,v_id),
  'canChooseReviewer',app_private.has_permission(v_actor,'work.task.manage_scope',case when v_ctx='own' then 'global' else v_ctx end,v_id));
end $$;
revoke all on function app_private.work_creation_context(jsonb,text) from public,anon,authenticated;
grant execute on function app_private.work_creation_context(jsonb,text) to authenticated;
create function public.get_work_creation_context(p_scope jsonb,p_priority text default 'normal') returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_creation_context(p_scope,p_priority); $$;
revoke all on function public.get_work_creation_context(jsonb,text) from public,anon,authenticated;
grant execute on function public.get_work_creation_context(jsonb,text) to authenticated;

create function app_private.work_creation_options(p_kind text,p_scope jsonb,p_search text,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_ctx text; v_scope_id text; v_rows jsonb; v_after text; v_n integer:=coalesce(p_limit,30);
begin
 if v_actor is null or not app_private.has_permission(v_actor,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('scope','filter_scope','user','work_group','watcher','reviewer') or v_n not between 1 and 50 or length(coalesce(p_search,''))>100
  or (p_cursor is not null and (jsonb_typeof(p_cursor)<>'object' or p_cursor-array['id']<>'{}' or jsonb_typeof(p_cursor->'id') is distinct from 'string' or nullif(p_cursor->>'id','') is null)) then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
 v_after:=p_cursor->>'id';
 if p_kind not in ('scope','filter_scope') then
  perform app_private.work_assert_create_scope(p_scope);
  v_ctx:=case when p_scope->>'type'='direct' then 'own' else p_scope->>'type' end;
  v_scope_id:=coalesce(p_scope->>'departmentId',p_scope->>'projectId','*');
  if (p_kind='user' and not app_private.has_permission(v_actor,'work.task.assign_user',v_ctx,v_scope_id))
   or (p_kind='work_group' and not app_private.has_permission(v_actor,'work.task.assign_group',v_ctx,v_scope_id))
   or (p_kind='reviewer' and not app_private.has_permission(v_actor,'work.task.manage_scope',case when v_ctx='own' then 'global' else v_ctx end,v_scope_id)) then raise exception 'WORK_OPTIONS_DENIED' using errcode='42501'; end if;
 end if;
 with choices as (
  select 'direct'::text id,'Trực tiếp'::text name,'direct'::text kind where (p_kind='scope' and app_private.has_permission(v_actor,'work.task.create','own','*')) or p_kind='filter_scope'
  union all select 'department:'||d.id,d.name,'department' from public.org_units d where (p_kind='scope' and app_private.has_permission(v_actor,'work.task.create','department',d.id::text)) or (p_kind='filter_scope' and exists(select 1 from public.work_tasks t where t.department_id=d.id and app_private.work_task_actor_can_view(t.id)))
  union all select 'project:'||p.id,p.name,'project' from public.projects p where (p_kind='scope' and app_private.has_permission(v_actor,'work.task.create','project',p.id)) or (p_kind='filter_scope' and exists(select 1 from public.work_tasks t where t.project_id=p.id and app_private.work_task_actor_can_view(t.id)))
  union all select u.id::text,u.name,'user' from public.users u where p_kind in ('user','watcher','reviewer') and u.is_active and u.account_status='ACTIVE'
   and app_private.has_permission(u.id,'work.module.access','global','*')
   and (p_kind<>'reviewer' or app_private.has_permission(u.id,'work.task.review','assigned','*') or (v_ctx<>'own' and app_private.has_permission(u.id,'work.task.review',v_ctx,v_scope_id)))
  union all select g.id::text,g.name,'work_group' from public.work_groups g where p_kind='work_group' and g.is_active
 ), page as (select * from choices where (v_after is null or id>v_after) and (nullif(btrim(p_search),'') is null or strpos(lower(name),lower(btrim(p_search)))>0) order by id limit v_n+1)
 select coalesce(jsonb_agg(to_jsonb(page) order by id),'[]') into v_rows from page;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(v_rows) with ordinality where ordinality<=v_n),
 'nextCursor',case when jsonb_array_length(v_rows)>v_n then jsonb_build_object('id',v_rows->(v_n-1)->>'id') else null end);
end $$;
revoke all on function app_private.work_creation_options(text,jsonb,text,jsonb,integer) from public,anon,authenticated;
grant execute on function app_private.work_creation_options(text,jsonb,text,jsonb,integer) to authenticated;
create function public.list_work_creation_options(p_kind text,p_scope jsonb default null,p_search text default '',p_cursor jsonb default null,p_limit integer default 30)
returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_creation_options(p_kind,p_scope,p_search,p_cursor,p_limit); $$;
revoke all on function public.list_work_creation_options(text,jsonb,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.list_work_creation_options(text,jsonb,text,jsonb,integer) to authenticated;

-- Clone references are label-only projections from an already authorized subject.
create function app_private.work_clone_form(p_task_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_labels jsonb; v_draft jsonb;
begin
 v_result:=app_private.work_get_clone_draft(p_task_id); v_draft:=v_result->'draft';
 select coalesce(jsonb_object_agg(id,name),'{}') into v_labels from (
  select u.id::text id,u.name from public.users u where u.id::text in (
   select x->>'id' from jsonb_array_elements(v_draft->'recipientSources') x where x->>'type'='user'
   union select jsonb_array_elements_text(v_draft->'watcherUserIds') union select v_draft->>'reviewerUserId')
  union all select g.id::text,g.name from public.work_groups g where g.id::text in(select x->>'id' from jsonb_array_elements(v_draft->'recipientSources') x where x->>'type'='work_group')
  union all select g.id::text,g.name from public.work_task_groups g where g.id::text=v_draft->>'taskGroupId'
  union all select 'department:'||d.id,d.name from public.org_units d where d.id::text=v_draft->'scope'->>'departmentId'
  union all select 'project:'||p.id,p.name from public.projects p where p.id=v_draft->'scope'->>'projectId'
  union all select 'direct','Trực tiếp' where v_draft->'scope'->>'type'='direct'
 ) q;
 return v_result||jsonb_build_object('labels',v_labels);
end $$;
revoke all on function app_private.work_clone_form(uuid) from public,anon,authenticated;
grant execute on function app_private.work_clone_form(uuid) to authenticated;
create function public.get_work_clone_form(p_task_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_clone_form(p_task_id); $$;
revoke all on function public.get_work_clone_form(uuid) from public,anon,authenticated;
grant execute on function public.get_work_clone_form(uuid) to authenticated;

-- Bounded summary includes confirmation progress without eager assignment loading.
create or replace function app_private.work_list_tasks(p_view text,p_filters jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); n integer := least(100,greatest(1,coalesce(p_limit,50)));
  rows jsonb; cursor_at timestamptz; cursor_id uuid; scope_filter jsonb := p_filters->'scope';
begin
  if a is null or not app_private.has_permission(a,'work.module.access','global','*') then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
  if p_view is null or p_view not in ('assigned_to_me','created_by_me','following','pinned')
    or jsonb_typeof(p_filters) is distinct from 'object'
    or p_filters-array['status','priority','scope','taskGroupId','deadlineFrom','deadlineTo','search']<>'{}'::jsonb
    or (p_filters ? 'status' and jsonb_typeof(p_filters->'status')<>'array')
    or (p_filters ? 'priority' and jsonb_typeof(p_filters->'priority')<>'array') then raise exception 'WORK_INVALID_FILTER' using errcode='22023'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->>'sortAt' is null or p_cursor->>'id' is null then
      raise exception 'WORK_INVALID_CURSOR' using errcode='22023'; end if;
    cursor_at:=(p_cursor->>'sortAt')::timestamptz; cursor_id:=(p_cursor->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.updated_at desc,q.id desc),'[]') into rows from (
    select t.id,t.task_code,t.title,t.status,t.priority,t.privacy,t.scope_type,t.department_id,t.project_id,
      t.task_group_id,t.deadline_at,t.created_by,t.reviewer_user_id,t.updated_at,t.lock_version,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in ('completed','cancelled'))) as assignment_count,
      (select count(*) from public.work_task_assignments a where a.task_id=t.id and (a.ended_at is null or a.state in ('completed','cancelled')) and a.acknowledged_at is not null) as acknowledged_count
    from public.work_tasks t
    where (case p_view
      when 'created_by_me' then t.created_by=a
      when 'assigned_to_me' then exists(select 1 from public.work_task_assignments x where x.task_id=t.id and x.user_id=a and (x.ended_at is null or x.state in ('completed','cancelled')))
      when 'following' then exists(select 1 from public.work_task_participants x where x.task_id=t.id and x.user_id=a and x.participant_role='watcher' and x.ended_at is null)
      when 'pinned' then exists(select 1 from public.work_task_pins x where x.task_id=t.id and x.user_id=a) end)
    and (cursor_at is null or (t.updated_at,t.id)<(cursor_at,cursor_id))
    and (not p_filters ? 'status' or t.status in (select jsonb_array_elements_text(p_filters->'status')))
    and (not p_filters ? 'priority' or t.priority in (select jsonb_array_elements_text(p_filters->'priority')))
    and (scope_filter is null or (t.scope_type=scope_filter->>'type'
      and t.department_id is not distinct from (scope_filter->>'departmentId')::uuid
      and t.project_id is not distinct from scope_filter->>'projectId'))
    and (not p_filters ? 'taskGroupId' or t.task_group_id=(p_filters->>'taskGroupId')::uuid)
    and (not p_filters ? 'deadlineFrom' or t.deadline_at>=(p_filters->>'deadlineFrom')::timestamptz)
    and (not p_filters ? 'deadlineTo' or t.deadline_at<=(p_filters->>'deadlineTo')::timestamptz)
    and (nullif(btrim(p_filters->>'search'),'') is null or t.task_code=p_filters->>'search'
      or to_tsvector('simple',coalesce(t.title,'') || ' ' || coalesce(t.description_text,'')) @@ plainto_tsquery('simple',p_filters->>'search'))
    and app_private.work_task_actor_can_view(t.id)
    order by t.updated_at desc,t.id desc limit n+1
  ) q;
  return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),
    'nextCursor',case when jsonb_array_length(rows)>n then jsonb_build_object('sortAt',rows->(n-1)->'updated_at','id',rows->(n-1)->'id') else null end);
end $$;
