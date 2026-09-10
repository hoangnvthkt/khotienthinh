-- WS5: canonical Workspace configuration for groups, calendars and SLA.
-- Existing department/project configuration remains available while its source
-- is in legacy mode. New Workspace-owned records use scope_type='workspace'.

alter table public.work_task_groups drop constraint work_task_groups_scope_shape_check;
alter table public.work_task_groups add constraint work_task_groups_scope_shape_check check (
  (scope_type='department' and department_id is not null and project_id is null)
  or (scope_type='project' and project_id is not null and department_id is null)
  or (scope_type='workspace' and workspace_id is not null and department_id is null and project_id is null)
);
alter table public.work_sla_calendars drop constraint work_calendar_scope_check;
alter table public.work_sla_calendars add constraint work_calendar_scope_check check (
  (scope_type='global' and department_id is null and project_id is null and workspace_id is null)
  or (scope_type='department' and department_id is not null and project_id is null)
  or (scope_type='project' and project_id is not null and department_id is null)
  or (scope_type='workspace' and workspace_id is not null and department_id is null and project_id is null)
);
alter table public.work_sla_calendars drop constraint work_calendar_default_scope_check;
alter table public.work_sla_calendars add constraint work_calendar_default_scope_check
  check(not is_default or scope_type in('global','workspace'));
alter table public.work_sla_policies drop constraint work_sla_policies_scope_shape_check;
alter table public.work_sla_policies add constraint work_sla_policies_scope_shape_check check (
  (scope_type='global' and department_id is null and project_id is null and workspace_id is null)
  or (scope_type='department' and department_id is not null and project_id is null)
  or (scope_type='project' and project_id is not null and department_id is null)
  or (scope_type='workspace' and workspace_id is not null and department_id is null and project_id is null)
);

create unique index work_task_groups_workspace_name_idx
  on public.work_task_groups(workspace_id,lower(btrim(name)))
  where scope_type='workspace' and is_active;
create unique index work_sla_calendars_workspace_default_idx
  on public.work_sla_calendars(workspace_id)
  where scope_type='workspace' and is_default and is_active;
drop index public.work_sla_calendars_one_default_idx;
create unique index work_sla_calendars_global_default_idx
  on public.work_sla_calendars(is_default)
  where scope_type='global' and is_default and is_active;
create index work_sla_policies_workspace_priority_range_idx
  on public.work_sla_policies(workspace_id,priority,effective_from,effective_to)
  where scope_type='workspace' and is_active;

create or replace function app_private.work_resolve_configuration_scope(p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_scope jsonb; v_workspace uuid;
begin
  if p_scope='{"type":"global"}'::jsonb then return p_scope; end if;
  v_scope:=app_private.work_resolve_workspace_scope(p_scope);
  v_workspace:=(v_scope->>'workspaceId')::uuid;
  if v_workspace is not null then
    return jsonb_build_object('type','workspace','workspaceId',v_workspace);
  end if;
  if v_scope->>'type' in('department','project') then return v_scope; end if;
  raise exception 'WORK_INVALID_SCOPE' using errcode='22023';
exception when invalid_text_representation then
  raise exception 'WORK_INVALID_SCOPE' using errcode='22023';
end $$;
revoke all on function app_private.work_resolve_configuration_scope(jsonb) from public,anon,authenticated;

create or replace function app_private.work_configuration_record_workspace(
  p_scope_type text,p_department_id uuid,p_project_id text,p_workspace_id uuid
)
returns uuid language sql stable security definer set search_path='' as $$
  select coalesce(p_workspace_id,
    app_private.work_workspace_for_physical_scope(p_scope_type,p_department_id,p_project_id))
$$;
revoke all on function app_private.work_configuration_record_workspace(text,uuid,text,uuid) from public,anon,authenticated;

create or replace function app_private.work_configuration_record_matches(
  p_scope jsonb,p_scope_type text,p_department_id uuid,p_project_id text,p_workspace_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select case p_scope->>'type'
    when 'global' then p_scope_type='global' and p_workspace_id is null
    when 'workspace' then app_private.work_configuration_record_workspace(
      p_scope_type,p_department_id,p_project_id,p_workspace_id
    ) is not distinct from (p_scope->>'workspaceId')::uuid
    when 'department' then p_workspace_id is null and p_scope_type='department'
      and p_department_id=(p_scope->>'departmentId')::uuid
    when 'project' then p_workspace_id is null and p_scope_type='project'
      and p_project_id=p_scope->>'projectId'
    else false end
$$;
revoke all on function app_private.work_configuration_record_matches(jsonb,text,uuid,text,uuid) from public,anon,authenticated;

create or replace function app_private.work_assert_configure(p_scope jsonb)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_scope jsonb; v_type text; v_id text;
begin
  if v_actor is null or not app_private.has_permission(v_actor,'work.module.access','global','*') then
    raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501';
  end if;
  v_scope:=app_private.work_resolve_configuration_scope(p_scope);
  if v_scope->>'type'='workspace' and app_private.work_workspace_member_role(
    (v_scope->>'workspaceId')::uuid,v_actor
  ) is distinct from 'admin' then
    raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501';
  end if;
  v_type:=case when v_scope->>'type'='workspace' then 'work_workspace' else v_scope->>'type' end;
  v_id:=coalesce(v_scope->>'workspaceId',v_scope->>'departmentId',v_scope->>'projectId','*');
  if not app_private.has_permission(v_actor,'work.task.configure',v_type,v_id) then
    raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501';
  end if;
  return v_actor;
end $$;
revoke all on function app_private.work_assert_configure(jsonb) from public,anon,authenticated;

create or replace function app_private.work_lock_configuration_scope(p_scope jsonb,p_actor uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare v_scope jsonb:=app_private.work_resolve_configuration_scope(p_scope); w public.work_workspaces%rowtype;
begin
  if v_scope->>'type'='workspace' then
    select * into w from public.work_workspaces where id=(v_scope->>'workspaceId')::uuid for update;
    if w.id is null or app_private.work_workspace_member_role(w.id,p_actor) is distinct from 'admin'
      or not app_private.has_permission(p_actor,'work.task.configure','work_workspace',w.id::text) then
      raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501';
    end if;
    if w.status<>'active' then raise exception 'WORK_WORKSPACE_ARCHIVED' using errcode='42501'; end if;
  end if;
  return v_scope;
end $$;
revoke all on function app_private.work_lock_configuration_scope(jsonb,uuid) from public,anon,authenticated;

create or replace function app_private.work_configuration_scopes(p_search text,p_cursor text,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=public.current_app_user_id(); v_rows jsonb; v_n integer:=coalesce(p_limit,30);
begin
  if v_actor is null or not app_private.has_permission(v_actor,'work.module.access','global','*') then
    raise exception 'WORK_ACCESS_DENIED' using errcode='42501';
  end if;
  if v_n not between 1 and 50 or length(coalesce(p_search,''))>100 then
    raise exception 'WORK_INVALID_OPTIONS' using errcode='22023';
  end if;
  with choices as(
    select 'global'::text id,'Toàn hệ thống'::text name
      where app_private.has_permission(v_actor,'work.task.configure','global','*')
    union all
    select 'workspace:'||w.id,w.name from public.work_workspaces w
      where w.status='active' and w.access_mode='workspace'
        and app_private.work_workspace_member_role(w.id,v_actor)='admin'
        and app_private.has_permission(v_actor,'work.task.configure','work_workspace',w.id::text)
    union all
    select 'department:'||d.id,d.name from public.org_units d
      where app_private.work_workspace_for_physical_scope('department',d.id,null) is null
        and app_private.has_permission(v_actor,'work.task.configure','department',d.id::text)
    union all
    select 'project:'||p.id,p.name from public.projects p
      where app_private.work_workspace_for_physical_scope('project',null,p.id) is null
        and app_private.has_permission(v_actor,'work.task.configure','project',p.id)
  ),page as(
    select * from choices where(p_cursor is null or id>p_cursor)
      and(nullif(btrim(p_search),'') is null or strpos(lower(name),lower(btrim(p_search)))>0)
    order by id limit v_n+1
  )
  select coalesce(jsonb_agg(to_jsonb(page)order by id),'[]') into v_rows from page;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]')
      from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then v_rows->(v_n-1)->'id' else null end
  );
end $$;

create or replace function app_private.work_configuration_list(
  p_kind text,p_scope jsonb,p_parent_id uuid,p_cursor uuid,p_limit integer,p_record_id uuid
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=app_private.work_assert_configure(p_scope);
  v_scope jsonb:=app_private.work_resolve_configuration_scope(p_scope);
  v_rows jsonb; v_n integer:=coalesce(p_limit,30); v_cal public.work_sla_calendars%rowtype;
begin
  if p_kind not in('group','calendar','policy','exception','calendar_option') or v_n not between 1 and 50 then
    raise exception 'WORK_INVALID_OPTIONS' using errcode='22023';
  end if;
  if p_kind='exception' then
    select * into v_cal from public.work_sla_calendars where id=p_parent_id;
    if v_cal.id is null or not app_private.work_configuration_record_matches(
      v_scope,v_cal.scope_type,v_cal.department_id,v_cal.project_id,v_cal.workspace_id
    ) then raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(q)order by q.id),'[]') into v_rows from(
      select * from public.work_sla_calendar_exceptions
      where calendar_id=p_parent_id and(p_record_id is null or id=p_record_id)
        and(p_cursor is null or id>p_cursor) order by id limit v_n+1
    )q;
  elsif p_kind='group' then
    select coalesce(jsonb_agg(to_jsonb(q)order by q.id),'[]') into v_rows from(
      select * from public.work_task_groups g
      where app_private.work_configuration_record_matches(v_scope,g.scope_type,g.department_id,g.project_id,g.workspace_id)
        and(p_record_id is null or g.id=p_record_id) and(p_cursor is null or g.id>p_cursor)
      order by g.id limit v_n+1
    )q;
  elsif p_kind in('calendar','calendar_option') then
    select coalesce(jsonb_agg(to_jsonb(q)order by q.id),'[]') into v_rows from(
      select * from public.work_sla_calendars c where(
        app_private.work_configuration_record_matches(v_scope,c.scope_type,c.department_id,c.project_id,c.workspace_id)
        or(p_kind='calendar_option' and c.scope_type='global' and c.is_active)
      ) and(p_kind<>'calendar_option' or c.is_active)
        and(p_record_id is null or c.id=p_record_id) and(p_cursor is null or c.id>p_cursor)
      order by c.id limit v_n+1
    )q;
  else
    select coalesce(jsonb_agg(to_jsonb(q)order by q.id),'[]') into v_rows from(
      select * from public.work_sla_policies p
      where app_private.work_configuration_record_matches(v_scope,p.scope_type,p.department_id,p.project_id,p.workspace_id)
        and(p_record_id is null or p.id=p_record_id) and(p_cursor is null or p.id>p_cursor)
      order by p.id limit v_n+1
    )q;
  end if;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]')
      from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then v_rows->(v_n-1)->'id' else null end
  );
end $$;

create or replace function app_private.work_save_configuration(p_kind text,p_scope jsonb,p_id uuid,p_expected_version bigint,p_data jsonb,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=app_private.work_assert_configure(p_scope); v_scope jsonb; tab text; allowed text[]; d jsonb; old jsonb; result jsonb; cols text; vals text;
 prior app_private.work_command_idempotency%rowtype; h text;
 cal public.work_sla_calendars%rowtype; rec_id uuid:=coalesce(p_id,gen_random_uuid()); ints jsonb; first_at time; last_at time;
begin
 v_scope:=app_private.work_lock_configuration_scope(p_scope,a);
 h:=md5(jsonb_build_array(p_kind,v_scope,p_id,p_expected_version,p_data,p_reason)::text);
 tab:=case p_kind when 'group' then 'work_task_groups' when 'calendar' then 'work_sla_calendars' when 'policy' then 'work_sla_policies' when 'exception' then 'work_sla_calendar_exceptions' end;
 allowed:=case p_kind when 'group' then array['name','description','is_active','sort_order']
  when 'calendar' then array['name','timezone','working_weekdays','working_intervals','is_active','is_default']
  when 'policy' then array['name','calendar_id','priority','acknowledgement_minutes','execution_minutes','effective_from','effective_to','is_active']
  when 'exception' then array['calendar_id','exception_date','is_working_day','working_intervals','label','remove'] end;
 if tab is null or p_key is null or jsonb_typeof(p_data) is distinct from 'object' or p_data-allowed<>'{}' or octet_length(p_data::text)>16000 or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
 if p_kind='group' and v_scope->>'type'='global' then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
 -- Serialize configuration dependencies and policy ranges. This low-frequency lock
 -- never locks task/assignment rows and cannot rewrite an existing SLA snapshot.
 perform pg_advisory_xact_lock(hashtextextended('work_configuration',0));
 insert into app_private.work_command_idempotency(actor_user_id,idempotency_key,command_name,request_hash) values(a,p_key,'work_configuration',h) on conflict do nothing;
 select * into strict prior from app_private.work_command_idempotency where actor_user_id=a and idempotency_key=p_key for update;
 if prior.command_name<>'work_configuration' or prior.request_hash<>h then raise exception 'WORK_IDEMPOTENCY_CONFLICT'; end if;
 if prior.response_payload is not null then return prior.response_payload; end if;
 if p_id is not null then
  execute format('select to_jsonb(t) from public.%I t where id=$1 for update',tab) into old using p_id;
  if old is null then raise exception 'WORK_CONFIGURATION_NOT_FOUND' using errcode='42501'; end if;
  if p_kind<>'exception' and not app_private.work_configuration_record_matches(v_scope,old->>'scope_type',(old->>'department_id')::uuid,old->>'project_id',(old->>'workspace_id')::uuid) then raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501'; end if;
 end if;
 d:=jsonb_build_object('id',rec_id,'created_by',a,'created_at',now(),'updated_at',now(),'lock_version',1)
  ||case p_kind when 'group' then '{"description":null,"is_active":true,"sort_order":0}'::jsonb
   when 'calendar' then '{"timezone":"Asia/Ho_Chi_Minh","working_weekdays":[1,2,3,4,5],"is_default":false,"is_active":true}'::jsonb
   when 'policy' then jsonb_build_object('priority',null,'execution_minutes',null,'due_soon_minutes',array[1440,240,60],'overdue_digest_local_time','08:00','effective_from',now(),'effective_to',null,'is_active',true)
   else '{"is_working_day":false,"working_intervals":[],"workday_start":null,"workday_end":null,"label":null}'::jsonb end
  ||coalesce(old,'{}')||p_data||jsonb_build_object('updated_at',now(),'lock_version',coalesce((old->>'lock_version')::bigint,0)+1);
 if p_kind<>'exception' then
  d:=d||case when v_scope->>'type'='workspace' then jsonb_build_object('scope_type','workspace','workspace_id',v_scope->>'workspaceId','department_id',null,'project_id',null)
   else jsonb_build_object('scope_type',v_scope->>'type','workspace_id',null,'department_id',v_scope->>'departmentId','project_id',v_scope->>'projectId') end;
 end if;
 if p_kind in ('policy','exception') then
  select * into cal from public.work_sla_calendars where id=(d->>'calendar_id')::uuid;
  if cal.id is null or (p_kind='policy' and not cal.is_active)
   or (not (p_kind='policy' and cal.scope_type='global') and not app_private.work_configuration_record_matches(v_scope,cal.scope_type,cal.department_id,cal.project_id,cal.workspace_id))
   or (p_kind='exception' and old is not null and old->>'calendar_id'<>d->>'calendar_id') then raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501'; end if;
 end if;
 if p_id is not null and (p_expected_version is null or (old->>'lock_version')::bigint<>p_expected_version) then raise exception 'WORK_VERSION_CONFLICT'; end if;
 if p_kind='exception' and not isfinite((d->>'exception_date')::date) then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
 if p_kind in ('calendar','exception') then
  ints:=d->'working_intervals';
  if not app_private.work_valid_intervals(ints) or (p_kind='calendar' or (d->>'is_working_day')::boolean) and jsonb_array_length(ints)=0 then raise exception 'WORK_INVALID_INTERVALS' using errcode='22023'; end if;
  if p_kind='exception' and not (d->>'is_working_day')::boolean then d:=d||'{"working_intervals":[],"workday_start":null,"workday_end":null}';
  else first_at:=(ints->0->>'start')::time;last_at:=(ints->(jsonb_array_length(ints)-1)->>'end')::time;d:=d||jsonb_build_object('workday_start',first_at,'workday_end',last_at); end if;
 end if;
 if p_kind='calendar' then
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=d->>'timezone') or (select count(*) from jsonb_array_elements(d->'working_weekdays'))<>(select count(distinct value) from jsonb_array_elements(d->'working_weekdays')) then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
  if not (d->>'is_active')::boolean and exists(select 1 from public.work_sla_policies where calendar_id=rec_id and is_active and (effective_to is null or effective_to>now())) then raise exception 'WORK_CALENDAR_IN_USE'; end if;
  if (d->>'is_default')::boolean and (d->>'is_active')::boolean and exists(select 1 from public.work_sla_calendars c where c.id<>rec_id and c.is_default and c.is_active and app_private.work_configuration_record_matches(v_scope,c.scope_type,c.department_id,c.project_id,c.workspace_id)) then raise exception 'WORK_DEFAULT_CALENDAR_EXISTS'; end if;
 end if;
 if p_kind='policy' then
  if not isfinite((d->>'effective_from')::timestamptz) or (d->>'effective_to' is not null and not isfinite((d->>'effective_to')::timestamptz)) or (d->>'effective_to')::timestamptz<=(d->>'effective_from')::timestamptz then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
  if (d->>'is_active')::boolean and exists(select 1 from public.work_sla_policies p where p.id<>rec_id and p.is_active and app_private.work_configuration_record_matches(v_scope,p.scope_type,p.department_id,p.project_id,p.workspace_id) and p.priority is not distinct from d->>'priority'
   and tstzrange(p.effective_from,p.effective_to,'[)') && tstzrange((d->>'effective_from')::timestamptz,(d->>'effective_to')::timestamptz,'[)')) then raise exception 'WORK_POLICY_OVERLAP'; end if;
 end if;
 if p_kind='exception' and coalesce((d->>'remove')::boolean,false) then
  if p_id is null then raise exception 'WORK_CONFIGURATION_NOT_FOUND'; end if;
  delete from public.work_sla_calendar_exceptions where id=p_id;result:=null;
 else
  d:=d-'remove';
  -- Identifiers come exclusively from the fixed table/column catalog above.
  if p_id is null then execute format('insert into public.%I select (jsonb_populate_record(null::public.%I,$1)).* returning to_jsonb(%I.*)',tab,tab,tab) into result using d;
  else
   select string_agg(format('%I=r.%I',column_name,column_name),',') into cols from information_schema.columns where table_schema='public' and table_name=tab and column_name not in ('id','created_by','created_at');
   execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=$2 returning to_jsonb(t.*)',tab,cols,tab) into result using d,p_id;
  end if;
 end if;
 insert into app_private.work_configuration_events(actor_user_id,scope,kind,entity_id,before_value,after_value,reason,idempotency_key) values(a,v_scope,p_kind,rec_id,old,result,btrim(p_reason),p_key);
 result:=jsonb_build_object('id',rec_id,'record',result);
 update app_private.work_command_idempotency set response_payload=result,completed_at=now() where actor_user_id=a and idempotency_key=p_key;
 return result;
exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or unique_violation or foreign_key_violation then
 if sqlerrm like 'WORK_%' then raise; end if;
 raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023';
end $$;
revoke all on function app_private.work_save_configuration(text,jsonb,uuid,bigint,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function app_private.work_save_configuration(text,jsonb,uuid,bigint,jsonb,text,uuid) to authenticated;

create or replace function app_private.work_configuration_preview(
  p_scope jsonb,p_priority text,p_at timestamptz
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=app_private.work_assert_configure(p_scope);
  v_scope jsonb:=app_private.work_resolve_configuration_scope(p_scope);
  v_config jsonb; v_sla_scope jsonb;
begin
  if p_at is null or not isfinite(p_at) then
    raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023';
  end if;
  v_sla_scope:=case when v_scope->>'type'='global' then '{"type":"direct"}'::jsonb else v_scope end;
  v_config:=app_private.work_resolve_sla(v_sla_scope,p_priority,p_at);
  return jsonb_build_object(
    'calendarName',v_config->'calendar'->>'name','timezone',v_config->'calendar'->>'timezone',
    'policyId',v_config->'policyId','acknowledgementMinutes',v_config->'acknowledgementMinutes',
    'executionMinutes',v_config->'executionMinutes',
    'acknowledgementDueAt',app_private.work_add_business_minutes(
      (v_config->>'calendarId')::uuid,p_at,(v_config->>'acknowledgementMinutes')::integer),
    'executionDueAt',case when v_config->>'executionMinutes' is not null then
      app_private.work_add_business_minutes((v_config->>'calendarId')::uuid,p_at,
        (v_config->>'executionMinutes')::integer) end
  );
end $$;

create or replace function app_private.work_configuration_history(
  p_scope jsonb,p_cursor uuid,p_limit integer
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=app_private.work_assert_configure(p_scope);
  v_scope jsonb:=app_private.work_resolve_configuration_scope(p_scope);
  v_rows jsonb; v_n integer:=coalesce(p_limit,30);
begin
  if v_n not between 1 and 50 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(q)order by q.created_at desc,q.id desc),'[]') into v_rows from(
    select e.id,e.kind,e.entity_id,e.before_value,e.after_value,e.reason,e.created_at,u.name actor_name
    from app_private.work_configuration_events e join public.users u on u.id=e.actor_user_id
    where e.scope=v_scope and(p_cursor is null or(e.created_at,e.id)<(
      select c.created_at,c.id from app_private.work_configuration_events c
      where c.id=p_cursor and c.scope=v_scope
    )) order by e.created_at desc,e.id desc limit v_n+1
  )q;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]')
      from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then v_rows->(v_n-1)->'id' else null end
  );
end $$;

create or replace function app_private.work_task_group_actor_can_view(p_group_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.work_task_groups g
    where g.id=p_group_id and app_private.has_permission(
      public.current_app_user_id(),'work.module.access','global','*'
    ) and case
      when app_private.work_configuration_record_workspace(g.scope_type,g.department_id,g.project_id,g.workspace_id) is not null
        then app_private.work_workspace_member_role(
          app_private.work_configuration_record_workspace(g.scope_type,g.department_id,g.project_id,g.workspace_id),
          public.current_app_user_id()
        ) is not null
      else app_private.has_permission(public.current_app_user_id(),'work.task.view_scope',g.scope_type,
        coalesce(g.department_id::text,g.project_id,'*'))
    end
  )
$$;

create or replace function app_private.work_list_groups(p_scope jsonb,p_cursor jsonb,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid:=public.current_app_user_id(); v_scope jsonb; v_rows jsonb;
  v_n integer:=coalesce(p_limit,50); v_cursor_at timestamptz; v_cursor_id uuid;
begin
  if v_actor is null or not app_private.has_permission(v_actor,'work.module.access','global','*') then
    raise exception 'WORK_ACCESS_DENIED' using errcode='42501';
  end if;
  if v_n not between 1 and 50 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
  v_scope:=case when p_scope->>'type'='direct' then p_scope
    else app_private.work_resolve_configuration_scope(p_scope) end;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor-array['sortAt','id']<>'{}'::jsonb then
      raise exception 'WORK_INVALID_CURSOR' using errcode='22023';
    end if;
    v_cursor_at:=(p_cursor->>'sortAt')::timestamptz; v_cursor_id:=(p_cursor->>'id')::uuid;
  end if;
  select coalesce(jsonb_agg(to_jsonb(q)order by q.created_at desc,q.id desc),'[]') into v_rows from(
    select g.id,g.name,g.description,g.scope_type,g.workspace_id,g.department_id,g.project_id,g.sort_order,g.created_at
    from public.work_task_groups g where g.is_active
      and app_private.work_configuration_record_matches(v_scope,g.scope_type,g.department_id,g.project_id,g.workspace_id)
      and(v_cursor_at is null or(g.created_at,g.id)<(v_cursor_at,v_cursor_id))
      and app_private.work_task_group_actor_can_view(g.id)
    order by g.created_at desc,g.id desc limit v_n+1
  )q;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(value order by ordinality),'[]')
      from jsonb_array_elements(v_rows)with ordinality where ordinality<=v_n),
    'nextCursor',case when jsonb_array_length(v_rows)>v_n then
      jsonb_build_object('sortAt',v_rows->(v_n-1)->'created_at','id',v_rows->(v_n-1)->'id') else null end
  );
end $$;

create or replace function app_private.validate_work_task_group_scope()
returns trigger language plpgsql set search_path='' as $$
declare v_group public.work_task_groups%rowtype; v_group_workspace uuid; v_task_workspace uuid;
begin
  if new.task_group_id is null then return new; end if;
  select * into v_group from public.work_task_groups where id=new.task_group_id;
  v_group_workspace:=app_private.work_configuration_record_workspace(
    v_group.scope_type,v_group.department_id,v_group.project_id,v_group.workspace_id);
  v_task_workspace:=coalesce(new.workspace_id,
    app_private.work_workspace_for_physical_scope(new.scope_type,new.department_id,new.project_id));
  if v_group.id is null or(case
    when v_group_workspace is not null or v_task_workspace is not null
      then v_group_workspace is distinct from v_task_workspace
    else v_group.scope_type<>new.scope_type
      or v_group.department_id is distinct from new.department_id
      or v_group.project_id is distinct from new.project_id end) then
    raise exception 'WORK_TASK_GROUP_SCOPE_MISMATCH' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function app_private.work_guard_group_scope()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('app.work_workspace_backfill',true)='on'
    and new.scope_type is not distinct from old.scope_type
    and new.department_id is not distinct from old.department_id
    and new.project_id is not distinct from old.project_id
    and old.workspace_id is null and new.workspace_id is not null
    and exists(select 1 from public.work_workspaces w where w.id=new.workspace_id and(
      (w.kind='department' and new.scope_type='department' and w.department_id=new.department_id)
      or(w.kind='project' and new.scope_type='project' and w.project_id=new.project_id)
    )) then return new;
  end if;
  if new.scope_type is distinct from old.scope_type
    or new.department_id is distinct from old.department_id
    or new.project_id is distinct from old.project_id
    or new.workspace_id is distinct from old.workspace_id then
    raise exception 'WORK_GROUP_SCOPE_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end $$;

drop policy work_task_groups_select on public.work_task_groups;
create policy work_task_groups_select on public.work_task_groups for select to authenticated
using(app_private.work_task_group_actor_can_view(id));
drop policy work_sla_calendars_select on public.work_sla_calendars;
create policy work_sla_calendars_select on public.work_sla_calendars for select to authenticated
using(app_private.work_workspace_policy_visible(workspace_id,scope_type,department_id,project_id));

-- Existing public wrappers retain their OIDs and grants; the internal functions
-- above provide the canonical Workspace behavior.
