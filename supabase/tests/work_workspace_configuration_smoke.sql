begin;

do $$
begin
  if to_regprocedure('app_private.work_resolve_configuration_scope(jsonb)') is null then
    raise exception 'WORK_WORKSPACE_CONFIGURATION_MISSING';
  end if;
end;
$$;

create temporary table ws5_people(name text primary key,id uuid,email text) on commit drop;
create temporary table ws5_data(key text primary key,value jsonb) on commit drop;
create temporary table ws5_shared_calendar(id uuid primary key) on commit drop;
grant select on ws5_people to authenticated;
grant select,insert,update on ws5_data to authenticated;
grant select on ws5_shared_calendar to authenticated;

insert into ws5_people
select name,gen_random_uuid(),'ws5-'||gen_random_uuid()||'@invalid.local'
from unnest(array['admin','member','outsider']) name;

insert into public.users(id,name,username,email,role,is_active,account_status)
select id,'WS5 '||name,'ws5-'||id,email,'EMPLOYEE',true,'ACTIVE' from ws5_people;

insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,permission,'global','*','WS5 rollback fixture'
from ws5_people cross join unnest(array['work.module.access','work.task.view_scope']) permission
where name='outsider';

with created as (
  insert into public.work_workspaces(kind,name,icon_key,color_key,cover_key,status,access_mode,created_by)
  select 'collaboration','WS5 Workspace A','users','blue','grid','active','workspace',id
  from ws5_people where name='admin'
  returning id
)
insert into ws5_data values('workspace_a',(select to_jsonb(id) from created));

with created as (
  insert into public.work_workspaces(kind,name,icon_key,color_key,cover_key,status,access_mode,created_by)
  select 'collaboration','WS5 Workspace B','users','teal','dots','active','workspace',id
  from ws5_people where name='admin'
  returning id
)
insert into ws5_data values('workspace_b',(select to_jsonb(id) from created));

insert into public.work_workspace_members(workspace_id,user_id,role,added_by,starts_at)
select (select (value#>>'{}')::uuid from ws5_data where key='workspace_a'),p.id,
  case when p.name='admin' then 'admin' else 'member' end,
  (select id from ws5_people where name='admin'),now()-interval '1 hour'
from ws5_people p where p.name in('admin','member');

insert into public.work_workspace_members(workspace_id,user_id,role,added_by,starts_at)
select (select (value#>>'{}')::uuid from ws5_data where key='workspace_b'),p.id,'admin',p.id,now()-interval '1 hour'
from ws5_people p where p.name='admin';

-- A direct configure grant must not elevate a Workspace member to Workspace
-- administrator. The role boundary remains canonical.
insert into public.user_permission_grants(
  user_id,permission_code,scope_type,scope_id,grant_reason,expires_at
)
select p.id,'work.task.configure','work_workspace',d.value#>>'{}',
  'WS5 member overgrant regression',now()+interval '1 hour'
from ws5_people p cross join ws5_data d
where p.name='member' and d.key='workspace_a';

-- A global calendar may be selected by a Workspace policy, but only a global
-- configurator may edit it.
with created as (insert into public.work_sla_calendars(
  name,timezone,working_weekdays,workday_start,workday_end,working_intervals,
  is_default,is_active,scope_type,created_by
)
select 'WS5 shared calendar','Asia/Ho_Chi_Minh',array[1,2,3,4,5,6]::smallint[],
  '08:00','17:00','[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}]',
  false,true,'global',id from ws5_people where name='admin'
returning id)
insert into ws5_shared_calendar select id from created;

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from ws5_people where name='admin';

do $$
declare
  wa uuid:=(select (value#>>'{}')::uuid from ws5_data where key='workspace_a');
  wb uuid:=(select (value#>>'{}')::uuid from ws5_data where key='workspace_b');
  sa jsonb:=jsonb_build_object('type','workspace','workspaceId',wa);
  sb jsonb:=jsonb_build_object('type','workspace','workspaceId',wb);
  g jsonb; c jsonb; p jsonb; e jsonb; shared uuid:=(select id from ws5_shared_calendar);
begin
  if not exists(select 1 from jsonb_array_elements(public.list_work_configuration_scopes()->'items') x
    where x->>'id'='workspace:'||wa) then raise exception 'TEST_WORKSPACE_SCOPE_DISCOVERY'; end if;

  g:=public.save_work_configuration('group',sa,null,null,
    '{"name":"Kế hoạch tuần","sort_order":10}',
    'Tạo nhóm việc Workspace',gen_random_uuid());
  if not exists(select 1 from public.work_task_groups where id=(g->>'id')::uuid and workspace_id=wa and scope_type='workspace') then
    raise exception 'TEST_WORKSPACE_GROUP_STORAGE';
  end if;
  if not exists(select 1 from jsonb_array_elements(public.list_work_task_groups(sa,null,50)->'items') x where x->>'id'=g->>'id') then
    raise exception 'TEST_WORKSPACE_GROUP_SELECTOR';
  end if;

  c:=public.save_work_configuration('calendar',sa,null,null,
    '{"name":"Lịch văn phòng","timezone":"Asia/Ho_Chi_Minh","working_weekdays":[1,2,3,4,5,6],"working_intervals":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}]}',
    'Tạo lịch Workspace',gen_random_uuid());
  e:=public.save_work_configuration('exception',sa,null,null,
    jsonb_build_object('calendar_id',c->>'id','exception_date','2026-09-09','is_working_day',false),
    'Tạo ngày nghỉ Workspace',gen_random_uuid());
  if public.list_work_configuration('exception',sa,(c->>'id')::uuid)->'items'->0->>'id'<>e->>'id' then
    raise exception 'TEST_WORKSPACE_EXCEPTION';
  end if;

  p:=public.save_work_configuration('policy',sa,null,null,
    jsonb_build_object('name','SLA thường','calendar_id',shared,'priority','normal','acknowledgement_minutes',60,
      'execution_minutes',480,'effective_from','2026-01-01T00:00:00Z'),
    'Tạo SLA dùng lịch chung',gen_random_uuid());
  if not exists(select 1 from public.work_sla_policies where id=(p->>'id')::uuid and workspace_id=wa) then
    raise exception 'TEST_WORKSPACE_POLICY_STORAGE';
  end if;
  begin
    perform public.save_work_configuration('policy',sa,null,null,
      jsonb_build_object('name','SLA trùng','calendar_id',shared,'priority','normal','acknowledgement_minutes',30,
        'effective_from','2026-06-01T00:00:00Z'),
      'Tạo SLA trùng',gen_random_uuid());
    raise exception 'TEST_POLICY_OVERLAP_NOT_BLOCKED';
  exception when raise_exception then
    if sqlerrm<>'WORK_POLICY_OVERLAP' then raise; end if;
  end;
  perform public.save_work_configuration('policy',sb,null,null,
    jsonb_build_object('name','SLA Workspace B','calendar_id',shared,'priority','normal','acknowledgement_minutes',30,
      'effective_from','2026-06-01T00:00:00Z'),
    'Tạo SLA khác Workspace',gen_random_uuid());
  if (public.preview_work_configuration_sla(sa,'normal','2026-09-07T04:30:00Z')->>'acknowledgementDueAt')::timestamptz
      <>'2026-09-07T06:30:00Z'::timestamptz then
    raise exception 'TEST_WORKSPACE_SLA_LUNCH_BREAK';
  end if;
  begin
    perform public.save_work_configuration('calendar',sa,shared,1,'{"name":"Không được sửa"}',
      'Sửa lịch dùng chung',gen_random_uuid());
    raise exception 'TEST_GLOBAL_CALENDAR_WRITE_NOT_BLOCKED';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from ws5_people where name='member';
do $$
declare wa uuid:=(select (value#>>'{}')::uuid from ws5_data where key='workspace_a');
begin
  begin perform public.list_work_configuration('group',jsonb_build_object('type','workspace','workspaceId',wa));
    raise exception 'TEST_MEMBER_CONFIG_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
end;
$$;

select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true)
from ws5_people where name='outsider';
do $$
declare wa uuid:=(select (value#>>'{}')::uuid from ws5_data where key='workspace_a');
begin
  if exists(select 1 from jsonb_array_elements(public.list_work_configuration_scopes()->'items') x where x->>'id'='workspace:'||wa) then
    raise exception 'TEST_OUTSIDER_SCOPE_LEAK';
  end if;
  begin perform public.list_work_configuration('group',jsonb_build_object('type','workspace','workspaceId',wa));
    raise exception 'TEST_OUTSIDER_CONFIG_NOT_BLOCKED';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.work_task_groups where workspace_id=wa) then raise exception 'TEST_RAW_GROUP_LEAK'; end if;
  if exists(select 1 from public.work_sla_calendars where workspace_id=wa) then raise exception 'TEST_RAW_CALENDAR_LEAK'; end if;
  if exists(select 1 from public.work_sla_policies where workspace_id=wa) then raise exception 'TEST_RAW_POLICY_LEAK'; end if;
end;
$$;

reset role;
select 'WORK_WORKSPACE_CONFIGURATION_SMOKE_PASSED' as result;
rollback;
