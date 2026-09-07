-- Scoped configuration; no operational calendars, policies or pilot grants seeded.
alter table public.work_task_groups add column lock_version bigint not null default 1;
alter table public.work_sla_calendars add column lock_version bigint not null default 1,
 add column scope_type text not null default 'global', add column department_id uuid references public.org_units(id), add column project_id text references public.projects(id),
 add constraint work_calendar_scope_check check ((scope_type='global' and department_id is null and project_id is null) or (scope_type='department' and department_id is not null and project_id is null) or (scope_type='project' and project_id is not null and department_id is null)),
 add constraint work_calendar_default_scope_check check (not is_default or scope_type='global');
create index work_calendar_department_idx on public.work_sla_calendars(department_id);
create index work_calendar_project_idx on public.work_sla_calendars(project_id);
alter table public.work_sla_calendar_exceptions add column lock_version bigint not null default 1;
alter table public.work_sla_policies add column lock_version bigint not null default 1;
create table app_private.work_configuration_events(
 id uuid primary key default gen_random_uuid(),actor_user_id uuid not null references public.users(id),
 scope jsonb not null,kind text not null,entity_id uuid not null,before_value jsonb,after_value jsonb,reason text not null,
 idempotency_key uuid not null,created_at timestamptz not null default now());
alter table app_private.work_configuration_events enable row level security;
revoke all on app_private.work_configuration_events from public,anon,authenticated;
create index work_configuration_events_scope_idx on app_private.work_configuration_events(scope,created_at desc,id desc);
create index work_configuration_events_actor_idx on app_private.work_configuration_events(actor_user_id);
create index work_configuration_events_entity_idx on app_private.work_configuration_events(entity_id,created_at desc);

create function app_private.work_assert_configure(p_scope jsonb) returns uuid language plpgsql stable security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); ctx text:=p_scope->>'type'; sid text:=coalesce(p_scope->>'departmentId',p_scope->>'projectId','*');
begin
 if jsonb_typeof(p_scope) is distinct from 'object' or p_scope-array['type','departmentId','projectId']<>'{}' or ctx is null or ctx not in ('global','department','project')
  or (ctx='global' and (p_scope ? 'departmentId' or p_scope ? 'projectId'))
  or (ctx='department' and (nullif(p_scope->>'departmentId','') is null or p_scope ? 'projectId'))
  or (ctx='project' and (nullif(p_scope->>'projectId','') is null or p_scope ? 'departmentId')) then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
 if a is null or not app_private.has_permission(a,'work.module.access','global','*') or not app_private.has_permission(a,'work.task.configure',ctx,sid) then raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501'; end if;
 if (ctx='department' and not exists(select 1 from public.org_units where id=(p_scope->>'departmentId')::uuid)) or (ctx='project' and not exists(select 1 from public.projects where id=p_scope->>'projectId')) then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
 return a;
end $$;
revoke all on function app_private.work_assert_configure(jsonb) from public,anon,authenticated;

create function app_private.work_configuration_scopes(p_search text,p_cursor text,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=public.current_app_user_id(); rows jsonb; n integer:=coalesce(p_limit,30);
begin
 if not coalesce(app_private.has_permission(a,'work.module.access','global','*'),false) then raise exception 'WORK_ACCESS_DENIED' using errcode='42501'; end if;
 if n not between 1 and 50 or length(coalesce(p_search,''))>100 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
 with choices as (
 select 'global'::text id,'Toàn hệ thống'::text name where app_private.has_permission(a,'work.task.configure','global','*')
 union all select 'department:'||d.id,d.name from public.org_units d where app_private.has_permission(a,'work.task.configure','department',d.id::text)
 union all select 'project:'||p.id,p.name from public.projects p where app_private.has_permission(a,'work.task.configure','project',p.id)
 ), page as(select * from choices where (p_cursor is null or id>p_cursor) and (nullif(btrim(p_search),'') is null or strpos(lower(name),lower(btrim(p_search)))>0) order by id limit n+1)
 select coalesce(jsonb_agg(to_jsonb(page) order by id),'[]') into rows from page;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),'nextCursor',case when jsonb_array_length(rows)>n then rows->(n-1)->'id' else null end);
end $$;
revoke all on function app_private.work_configuration_scopes(text,text,integer) from public,anon,authenticated;
grant execute on function app_private.work_configuration_scopes(text,text,integer) to authenticated;
create function public.list_work_configuration_scopes(p_search text default '',p_cursor text default null,p_limit integer default 30) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_configuration_scopes(p_search,p_cursor,p_limit); $$;
revoke all on function public.list_work_configuration_scopes(text,text,integer) from public,anon,authenticated;
grant execute on function public.list_work_configuration_scopes(text,text,integer) to authenticated;

create function app_private.work_configuration_list(p_kind text,p_scope jsonb,p_parent_id uuid,p_cursor uuid,p_limit integer,p_record_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=app_private.work_assert_configure(p_scope); rows jsonb; n integer:=coalesce(p_limit,30); tab text; cal public.work_sla_calendars%rowtype;
begin
 tab:=case p_kind when 'group' then 'work_task_groups' when 'calendar' then 'work_sla_calendars' when 'policy' then 'work_sla_policies' when 'exception' then 'work_sla_calendar_exceptions' when 'calendar_option' then 'work_sla_calendars' end;
 if tab is null or n not between 1 and 50 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023'; end if;
 if p_kind='exception' then
  select * into cal from public.work_sla_calendars where id=p_parent_id;
  if cal.id is null or cal.scope_type<>p_scope->>'type' or coalesce(cal.department_id::text,cal.project_id,'*')<>coalesce(p_scope->>'departmentId',p_scope->>'projectId','*') then raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') into rows from(select * from public.work_sla_calendar_exceptions where calendar_id=p_parent_id and (p_record_id is null or id=p_record_id) and (p_cursor is null or id>p_cursor) order by id limit n+1) q;
 else
  execute format('select coalesce(jsonb_agg(to_jsonb(q) order by q.id),''[]'') from (select * from public.%I where ((scope_type=$1 and coalesce(department_id::text,project_id,''*'')=$2) or ($5 and scope_type=''global'' and is_active)) and ($3 is null or id>$3) and ($6 is null or id=$6) and (not $5 or is_active) order by id limit $4) q',tab)
   into rows using p_scope->>'type',coalesce(p_scope->>'departmentId',p_scope->>'projectId','*'),p_cursor,n+1,p_kind='calendar_option',p_record_id;
 end if;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),'nextCursor',case when jsonb_array_length(rows)>n then rows->(n-1)->'id' else null end);
end $$;
revoke all on function app_private.work_configuration_list(text,jsonb,uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function app_private.work_configuration_list(text,jsonb,uuid,uuid,integer,uuid) to authenticated;
create function public.list_work_configuration(p_kind text,p_scope jsonb,p_parent_id uuid default null,p_cursor uuid default null,p_limit integer default 30,p_record_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_configuration_list(p_kind,p_scope,p_parent_id,p_cursor,p_limit,p_record_id); $$;
revoke all on function public.list_work_configuration(text,jsonb,uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.list_work_configuration(text,jsonb,uuid,uuid,integer,uuid) to authenticated;

create function app_private.work_save_configuration(p_kind text,p_scope jsonb,p_id uuid,p_expected_version bigint,p_data jsonb,p_reason text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=app_private.work_assert_configure(p_scope); tab text; allowed text[]; d jsonb; old jsonb; result jsonb; cols text; vals text;
 prior app_private.work_command_idempotency%rowtype; h text:=md5(jsonb_build_array(p_kind,p_scope,p_id,p_expected_version,p_data,p_reason)::text);
 cal public.work_sla_calendars%rowtype; rec_id uuid:=coalesce(p_id,gen_random_uuid()); ints jsonb; first_at time; last_at time;
begin
 tab:=case p_kind when 'group' then 'work_task_groups' when 'calendar' then 'work_sla_calendars' when 'policy' then 'work_sla_policies' when 'exception' then 'work_sla_calendar_exceptions' end;
 allowed:=case p_kind when 'group' then array['name','description','is_active','sort_order']
  when 'calendar' then array['name','timezone','working_weekdays','working_intervals','is_active','is_default']
  when 'policy' then array['name','calendar_id','priority','acknowledgement_minutes','execution_minutes','effective_from','effective_to','is_active']
  when 'exception' then array['calendar_id','exception_date','is_working_day','working_intervals','label','remove'] end;
 if tab is null or p_key is null or jsonb_typeof(p_data) is distinct from 'object' or p_data-allowed<>'{}' or octet_length(p_data::text)>16000 or char_length(btrim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
 if p_kind='group' and p_scope->>'type'='global' then raise exception 'WORK_INVALID_SCOPE' using errcode='22023'; end if;
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
  if p_kind<>'exception' and (old->>'scope_type'<>p_scope->>'type' or coalesce(old->>'department_id',old->>'project_id','*')<>coalesce(p_scope->>'departmentId',p_scope->>'projectId','*')) then raise exception 'WORK_CONFIGURE_DENIED' using errcode='42501'; end if;
 end if;
 d:=jsonb_build_object('id',rec_id,'created_by',a,'created_at',now(),'updated_at',now(),'lock_version',1)
  ||case p_kind when 'group' then '{"description":null,"is_active":true,"sort_order":0}'::jsonb
   when 'calendar' then '{"timezone":"Asia/Ho_Chi_Minh","working_weekdays":[1,2,3,4,5],"is_default":false,"is_active":true}'::jsonb
   when 'policy' then jsonb_build_object('priority',null,'execution_minutes',null,'due_soon_minutes',array[1440,240,60],'overdue_digest_local_time','08:00','effective_from',now(),'effective_to',null,'is_active',true)
   else '{"is_working_day":false,"working_intervals":[],"workday_start":null,"workday_end":null,"label":null}'::jsonb end
  ||coalesce(old,'{}')||p_data||jsonb_build_object('updated_at',now(),'lock_version',coalesce((old->>'lock_version')::bigint,0)+1);
 if p_kind<>'exception' then d:=d||jsonb_build_object('scope_type',p_scope->>'type','department_id',p_scope->>'departmentId','project_id',p_scope->>'projectId'); end if;
 if p_kind in ('policy','exception') then
  select * into cal from public.work_sla_calendars where id=(d->>'calendar_id')::uuid;
  if cal.id is null or (p_kind='policy' and not cal.is_active)
   or (not (p_kind='policy' and cal.scope_type='global') and (cal.scope_type<>p_scope->>'type' or coalesce(cal.department_id::text,cal.project_id,'*')<>coalesce(p_scope->>'departmentId',p_scope->>'projectId','*')))
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
  if (d->>'is_default')::boolean and (d->>'is_active')::boolean and exists(select 1 from public.work_sla_calendars where id<>rec_id and is_default and is_active) then raise exception 'WORK_DEFAULT_CALENDAR_EXISTS'; end if;
 end if;
 if p_kind='policy' then
  if not isfinite((d->>'effective_from')::timestamptz) or (d->>'effective_to' is not null and not isfinite((d->>'effective_to')::timestamptz)) or (d->>'effective_to')::timestamptz<=(d->>'effective_from')::timestamptz then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
  if (d->>'is_active')::boolean and exists(select 1 from public.work_sla_policies p where p.id<>rec_id and p.is_active and p.scope_type=d->>'scope_type' and coalesce(p.department_id::text,p.project_id,'*')=coalesce(d->>'department_id',d->>'project_id','*') and p.priority is not distinct from d->>'priority'
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
 insert into app_private.work_configuration_events(actor_user_id,scope,kind,entity_id,before_value,after_value,reason,idempotency_key) values(a,p_scope,p_kind,rec_id,old,result,btrim(p_reason),p_key);
 result:=jsonb_build_object('id',rec_id,'record',result);
 update app_private.work_command_idempotency set response_payload=result,completed_at=now() where actor_user_id=a and idempotency_key=p_key;
 return result;
exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or unique_violation or foreign_key_violation then
 if sqlerrm like 'WORK_%' then raise; end if;
 raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023';
end $$;
revoke all on function app_private.work_save_configuration(text,jsonb,uuid,bigint,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function app_private.work_save_configuration(text,jsonb,uuid,bigint,jsonb,text,uuid) to authenticated;
create function public.save_work_configuration(p_kind text,p_scope jsonb,p_id uuid,p_expected_version bigint,p_data jsonb,p_reason text,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_save_configuration(p_kind,p_scope,p_id,p_expected_version,p_data,p_reason,p_key); $$;
revoke all on function public.save_work_configuration(text,jsonb,uuid,bigint,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.save_work_configuration(text,jsonb,uuid,bigint,jsonb,text,uuid) to authenticated;

create function app_private.work_configuration_preview(p_scope jsonb,p_priority text,p_at timestamptz) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=app_private.work_assert_configure(p_scope); config jsonb;
begin
 if p_at is null or not isfinite(p_at) then raise exception 'WORK_INVALID_CONFIGURATION' using errcode='22023'; end if;
 config:=app_private.work_resolve_sla(case when p_scope->>'type'='global' then '{"type":"direct"}'::jsonb else p_scope end,p_priority,p_at);
 return jsonb_build_object('calendarName',config->'calendar'->>'name','timezone',config->'calendar'->>'timezone','policyId',config->'policyId','acknowledgementMinutes',config->'acknowledgementMinutes','executionMinutes',config->'executionMinutes',
  'acknowledgementDueAt',app_private.work_add_business_minutes((config->>'calendarId')::uuid,p_at,(config->>'acknowledgementMinutes')::integer),
  'executionDueAt',case when config->>'executionMinutes' is not null then app_private.work_add_business_minutes((config->>'calendarId')::uuid,p_at,(config->>'executionMinutes')::integer) end);
end $$;
revoke all on function app_private.work_configuration_preview(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function app_private.work_configuration_preview(jsonb,text,timestamptz) to authenticated;
create function public.preview_work_configuration_sla(p_scope jsonb,p_priority text,p_at timestamptz) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_configuration_preview(p_scope,p_priority,p_at); $$;
revoke all on function public.preview_work_configuration_sla(jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.preview_work_configuration_sla(jsonb,text,timestamptz) to authenticated;

-- Audit is bounded and guarded by the same canonical scope as configuration writes.
create function app_private.work_configuration_history(p_scope jsonb,p_cursor uuid,p_limit integer) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=app_private.work_assert_configure(p_scope); rows jsonb; n integer:=coalesce(p_limit,30);
begin
 if n not between 1 and 50 then raise exception 'WORK_INVALID_OPTIONS' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from (
  select e.id,e.kind,e.entity_id,e.before_value,e.after_value,e.reason,e.created_at,u.name actor_name
  from app_private.work_configuration_events e join public.users u on u.id=e.actor_user_id
  where e.scope=p_scope and (p_cursor is null or (e.created_at,e.id)<(select c.created_at,c.id from app_private.work_configuration_events c where c.id=p_cursor and c.scope=p_scope)) order by e.created_at desc,e.id desc limit n+1
 ) q;
 return jsonb_build_object('items',(select coalesce(jsonb_agg(value order by ordinality),'[]') from jsonb_array_elements(rows) with ordinality where ordinality<=n),'nextCursor',case when jsonb_array_length(rows)>n then rows->(n-1)->'id' else null end);
end $$;
revoke all on function app_private.work_configuration_history(jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function app_private.work_configuration_history(jsonb,uuid,integer) to authenticated;
create function public.list_work_configuration_history(p_scope jsonb,p_cursor uuid default null,p_limit integer default 30) returns jsonb language sql security invoker set search_path='' as $$ select app_private.work_configuration_history(p_scope,p_cursor,p_limit); $$;
revoke all on function public.list_work_configuration_history(jsonb,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_work_configuration_history(jsonb,uuid,integer) to authenticated;
