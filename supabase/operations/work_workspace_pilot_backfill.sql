-- Named Workspace pilot cutover for ftciqmqhmfvjtwoycswe.
-- Safety default: this tracked operation always ends with ROLLBACK. WS8 applies
-- an exact candidate copy whose only semantic difference is the final COMMIT.
begin;
select pg_advisory_xact_lock(hashtextextended('work_workspace_pilot_backfill',0));
select pg_advisory_xact_lock(hashtextextended('work_configuration',0));

-- Reads remain available. Writers pause only for this short transaction so a
-- legacy row cannot appear between bridge backfill and the access-mode switch.
lock table public.work_workspaces,public.work_workspace_members,
  public.work_tasks,public.work_task_groups,public.work_sla_calendars,
  public.work_sla_policies,public.user_permission_grants in share mode;

do $$
begin
  if to_regprocedure('app_private.work_resolve_configuration_scope(jsonb)') is null
     or to_regprocedure('app_private.work_workspace_permission_sources(uuid,text,text,text,timestamptz)') is null then
    raise exception 'WORK_WORKSPACE_CONFIGURATION_MISSING';
  end if;
  if not exists(select 1 from public.users
      where id='928d3473-49a2-4427-a319-19729689a084'
        and auth_id='e99f1b85-ab8e-49ee-b068-e100fe698533'
        and lower(email)='admin@khoviet.vn' and is_active and account_status='ACTIVE')
     or not exists(select 1 from public.users
      where id='d0a300a0-1586-4748-b6e7-71773addc004'
        and auth_id='d0a300a0-1586-4748-b6e7-71773addc004'
        and lower(email)='sonpn@tienthinhjsc.vn' and is_active and account_status='ACTIVE') then
    raise exception 'WORK_PILOT_USER_MISMATCH';
  end if;
  if not exists(select 1 from public.org_units
      where id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'
        and name='Phòng Quản lý dự án' and is_active) then
    raise exception 'WORK_PILOT_SCOPE_MISMATCH';
  end if;
  if exists(select 1 from public.work_workspaces
      where kind='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9') then
    raise exception 'WORK_PILOT_ALREADY_CUT_OVER';
  end if;
end $$;

create temporary table work_pilot_tasks_before on commit drop as
select id,to_jsonb(t)-'workspace_id' value from public.work_tasks t
where scope_type='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9';
create temporary table work_pilot_assignments_before on commit drop as
select id,to_jsonb(a) value from public.work_task_assignments a
where task_id in(select id from work_pilot_tasks_before);
create temporary table work_pilot_groups_before on commit drop as
select id,to_jsonb(g)-'workspace_id' value from public.work_task_groups g
where scope_type='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9';
create temporary table work_pilot_calendars_before on commit drop as
select id,to_jsonb(c)-'workspace_id' value from public.work_sla_calendars c
where scope_type='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9';
create temporary table work_pilot_policies_before on commit drop as
select id,to_jsonb(p)-'workspace_id' value from public.work_sla_policies p
where scope_type='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9';
create temporary table work_pilot_outbox_before on commit drop as
select id,to_jsonb(o) value from app_private.work_notification_outbox o
where task_id in(select id from work_pilot_tasks_before);
create temporary table work_pilot_deliveries_before on commit drop as
select id,to_jsonb(d) value from app_private.work_notification_deliveries d
where outbox_id in(select id from work_pilot_outbox_before);
create temporary table work_pilot_attachments_before on commit drop as
select id,to_jsonb(a) value from public.work_task_attachments a
where task_id in(select id from work_pilot_tasks_before);
create temporary table work_pilot_events_before on commit drop as
select id,to_jsonb(e) value from public.work_task_events e
where task_id in(select id from work_pilot_tasks_before);
create temporary table work_pilot_versions_before on commit drop as
select id,to_jsonb(v) value from public.work_task_versions v
where task_id in(select id from work_pilot_tasks_before);
create temporary table work_other_scopes_before on commit drop as
select scope_type,coalesce(department_id::text,project_id) scope_id,count(*) task_count
from public.work_tasks
where scope_type in('department','project')
  and not(scope_type='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9')
group by scope_type,coalesce(department_id::text,project_id);
create temporary table work_direct_before on commit drop as
select id,workspace_id from public.work_tasks where scope_type='direct';

create temporary table work_pilot_expected_grants(
  id uuid primary key,user_id uuid not null,permission_code text not null,
  scope_type text not null,scope_id text not null
) on commit drop;
insert into work_pilot_expected_grants values
('e81ce1d6-3bc0-49df-b4ce-70c153f18c7b','928d3473-49a2-4427-a319-19729689a084','work.module.access','global','*'),
('5e8fd000-20ae-4e19-9116-00d7d50a5b31','928d3473-49a2-4427-a319-19729689a084','work.task.assign_user','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('cea13f83-c47d-4001-91cb-f33b39bdf246','928d3473-49a2-4427-a319-19729689a084','work.task.audit_view','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('c3ca34d6-82bf-483a-90e4-5b5e473e3d78','928d3473-49a2-4427-a319-19729689a084','work.task.configure','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('e808893b-0c8d-4cbf-996d-c0e09d8afb03','928d3473-49a2-4427-a319-19729689a084','work.task.create','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('c1366ba0-94c7-4f32-94f9-10f07cafe9f1','928d3473-49a2-4427-a319-19729689a084','work.task.manage_scope','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('73cf34b8-9024-4c1b-af2d-cd0517f8cc14','928d3473-49a2-4427-a319-19729689a084','work.task.review','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('b6608117-0dff-4548-a569-9589c8658ff2','928d3473-49a2-4427-a319-19729689a084','work.task.view_related','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('ac08759b-6953-4a45-8cc7-d4d5ab072a5d','928d3473-49a2-4427-a319-19729689a084','work.task.view_scope','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('5a2a5de2-16c9-4345-92ea-bf25251f173a','d0a300a0-1586-4748-b6e7-71773addc004','work.module.access','global','*'),
('b47c5c86-dcdc-4892-83e0-bd4762b4e75b','d0a300a0-1586-4748-b6e7-71773addc004','work.task.assign_user','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('9207a3a1-8091-4aa8-8553-0c81595561cf','d0a300a0-1586-4748-b6e7-71773addc004','work.task.audit_view','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('5371b709-c914-406a-ab64-57a7c286a78c','d0a300a0-1586-4748-b6e7-71773addc004','work.task.create','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('6e4dbbf4-5edb-49cb-9bcc-65dbb0c69651','d0a300a0-1586-4748-b6e7-71773addc004','work.task.review','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
('afe1f077-337e-4640-88d0-4b843c910e49','d0a300a0-1586-4748-b6e7-71773addc004','work.task.view_related','department','6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9');
create temporary table work_pilot_grants_before on commit drop as
select g.* from public.user_permission_grants g join work_pilot_expected_grants e using(id);

do $$
begin
  if (select count(*) from work_pilot_tasks_before)<>1
     or (select count(*) from work_pilot_assignments_before)<>1
     or (select count(*) from work_pilot_groups_before)<>0
     or (select count(*) from work_pilot_calendars_before)<>1
     or (select count(*) from work_pilot_policies_before)<>3
     or coalesce((select md5(string_agg(value::text,'' order by id)) from work_pilot_tasks_before),md5(''))<>'d74eadfd341f2c01e515e1baa6a9c6f1'
     or coalesce((select md5(string_agg(value::text,'' order by id)) from work_pilot_assignments_before),md5(''))<>'0e9e7ac5f5ddc8f56a77cd27cb73772a'
     or coalesce((select md5(string_agg(value::text,'' order by id)) from work_pilot_calendars_before),md5(''))<>'ebf8adafa642c61eb5853271ca0e476d'
     or coalesce((select md5(string_agg(value::text,'' order by id)) from work_pilot_policies_before),md5(''))<>'8ba38c1c49589bde2fb7099ae0447d48' then
    raise exception 'WORK_PILOT_FINGERPRINT_MISMATCH';
  end if;
  if (select count(*) from work_pilot_grants_before)<>15
     or exists(select 1 from work_pilot_expected_grants e left join work_pilot_grants_before g using(id)
       where g.id is null or g.user_id is distinct from e.user_id
         or g.permission_code is distinct from e.permission_code
         or g.scope_type is distinct from e.scope_type or g.scope_id is distinct from e.scope_id
         or not g.is_active
         or g.grant_reason is distinct from 'Vioo Work R1A named pilot — Phòng Quản lý dự án'
         or g.expires_at is distinct from '2026-09-21T07:02:36.939209+00:00') then
    raise exception 'WORK_PILOT_GRANT_INVENTORY_MISMATCH';
  end if;
end $$;

create or replace function pg_temp.apply_work_pilot_workspace()
returns uuid language plpgsql security invoker set search_path='' as $$
declare
  v_workspace uuid;
  v_admin constant uuid:='928d3473-49a2-4427-a319-19729689a084';
  v_member constant uuid:='d0a300a0-1586-4748-b6e7-71773addc004';
  v_department constant uuid:='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9';
  v_expiry constant timestamptz:='2026-09-21T07:02:36.939209+00:00';
begin
  select id into v_workspace from public.work_workspaces
  where kind='department' and department_id=v_department for update;
  if v_workspace is null then
    insert into public.work_workspaces(
      kind,department_id,name,description,icon_key,color_key,cover_key,status,access_mode,created_by
    ) values(
      'department',v_department,'Phòng Quản lý dự án',
      'Không gian pilot Vioo Work của Phòng Quản lý dự án.',
      'building','blue','blueprint','active','legacy',v_admin
    ) returning id into v_workspace;
  elsif not exists(select 1 from public.work_workspaces where id=v_workspace
      and status='active' and access_mode in('legacy','workspace')) then
    raise exception 'WORK_PILOT_WORKSPACE_STATE_MISMATCH';
  end if;

  insert into public.work_workspace_members(
    workspace_id,user_id,role,status,starts_at,expires_at,added_by,origin,source_reference
  ) values
    (v_workspace,v_admin,'admin','active','2026-09-07T07:02:36.939209+00:00',v_expiry,
      v_admin,'organization',v_department::text),
    (v_workspace,v_member,'member','active','2026-09-07T07:02:36.939209+00:00',v_expiry,
      v_admin,'organization',v_department::text)
  on conflict(workspace_id,user_id) do nothing;

  if (select count(*) from public.work_workspace_members where workspace_id=v_workspace)<>2
     or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
       and user_id=v_admin and role='admin' and status='active'
       and starts_at='2026-09-07T07:02:36.939209+00:00' and expires_at=v_expiry
       and added_by=v_admin and origin='organization' and source_reference=v_department::text)
     or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
       and user_id=v_member and role='member' and status='active'
       and starts_at='2026-09-07T07:02:36.939209+00:00' and expires_at=v_expiry
       and added_by=v_admin and origin='organization' and source_reference=v_department::text) then
    raise exception 'WORK_PILOT_MEMBERSHIP_STATE_MISMATCH';
  end if;

  if exists(select 1 from public.work_task_groups where scope_type='department'
      and department_id=v_department and workspace_id is not null and workspace_id<>v_workspace)
     or exists(select 1 from public.work_sla_calendars where scope_type='department'
      and department_id=v_department and workspace_id is not null and workspace_id<>v_workspace)
     or exists(select 1 from public.work_sla_policies where scope_type='department'
      and department_id=v_department and workspace_id is not null and workspace_id<>v_workspace)
     or exists(select 1 from public.work_tasks where scope_type='department'
      and department_id=v_department and workspace_id is not null and workspace_id<>v_workspace) then
    raise exception 'WORK_PILOT_BRIDGE_CONFLICT';
  end if;

  perform set_config('app.work_workspace_backfill','on',true);
  update public.work_task_groups set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department and workspace_id is null;
  update public.work_sla_calendars set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department and workspace_id is null;
  update public.work_sla_policies set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department and workspace_id is null;
  update public.work_tasks set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department and workspace_id is null;
  update public.work_workspaces set access_mode='workspace',updated_at=now()
  where id=v_workspace and access_mode='legacy';
  return v_workspace;
end $$;

create temporary table work_pilot_result(workspace_id uuid primary key) on commit drop;
insert into work_pilot_result values(pg_temp.apply_work_pilot_workspace());
do $$
declare first_id uuid:=(select workspace_id from work_pilot_result); second_id uuid;
begin
  second_id:=pg_temp.apply_work_pilot_workspace();
  if second_id is distinct from first_id then raise exception 'WORK_PILOT_NOT_IDEMPOTENT'; end if;
end $$;

-- Prove membership replaces every old task/module grant before retirement.
do $$
declare v_workspace uuid:=(select workspace_id from work_pilot_result); v_user uuid; v_code text;
begin
  for v_user,v_code in select * from(values
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.module.access'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.create'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.view_related'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.assign_user'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.review'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.audit_view'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.view_scope'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.manage_scope'),
    ('928d3473-49a2-4427-a319-19729689a084'::uuid,'work.task.configure'),
    ('d0a300a0-1586-4748-b6e7-71773addc004'::uuid,'work.module.access'),
    ('d0a300a0-1586-4748-b6e7-71773addc004'::uuid,'work.task.create'),
    ('d0a300a0-1586-4748-b6e7-71773addc004'::uuid,'work.task.view_related'),
    ('d0a300a0-1586-4748-b6e7-71773addc004'::uuid,'work.task.assign_user'),
    ('d0a300a0-1586-4748-b6e7-71773addc004'::uuid,'work.task.review'),
    ('d0a300a0-1586-4748-b6e7-71773addc004'::uuid,'work.task.audit_view')
  ) x(user_id,permission_code) loop
    if not exists(select 1 from app_private.work_workspace_permission_sources(
        v_user,v_code,case when v_code='work.module.access' then 'global' else 'work_workspace' end,
        case when v_code='work.module.access' then '*' else v_workspace::text end,now())) then
      raise exception 'WORK_PILOT_MEMBERSHIP_PARITY_MISSING: % %',v_user,v_code;
    end if;
  end loop;
end $$;

insert into public.user_permission_grants(
  id,user_id,permission_code,scope_type,scope_id,is_active,granted_by,granted_at,
  expires_at,grant_reason
) values(
  '680f7574-2e97-42e7-a038-658025b70fbc','928d3473-49a2-4427-a319-19729689a084',
  'work.workspace.create','global','*',true,'928d3473-49a2-4427-a319-19729689a084',now(),
  '2026-09-21T07:02:36.939209+00:00','Vioo Work Workspace pilot — create capability'
);

update public.user_permission_grants g
set is_active=false,revoked_at=now(),revoked_by='928d3473-49a2-4427-a319-19729689a084',
  revoked_reason='Replaced by canonical Workspace membership during WS8 pilot cutover',updated_at=now()
from work_pilot_expected_grants e where g.id=e.id and g.is_active;

insert into public.permission_audit_events(
  actor_user_id,target_user_id,event_type,before_grants,after_grants,metadata
)
select '928d3473-49a2-4427-a319-19729689a084',b.user_id,
  'work_workspace_pilot_direct_grants_retired',jsonb_agg(to_jsonb(b) order by b.id),'[]',
  jsonb_build_object('reason','Replaced by canonical Workspace membership during WS8 pilot cutover',
    'operationKey','91fa4436-8c00-44bf-8e1d-3a587d047364','workspaceId',(select workspace_id from work_pilot_result),
    'grantIds',jsonb_agg(to_jsonb(b.id) order by b.id))
from work_pilot_grants_before b group by b.user_id;

insert into public.permission_audit_events(
  actor_user_id,target_user_id,event_type,before_grants,after_grants,metadata
)
select '928d3473-49a2-4427-a319-19729689a084','928d3473-49a2-4427-a319-19729689a084',
  'work_workspace_pilot_create_grant_bootstrapped','[]',jsonb_build_array(to_jsonb(g)),
  jsonb_build_object('reason','Named WS8 pilot bootstrap','operationKey','91fa4436-8c00-44bf-8e1d-3a587d047364')
from public.user_permission_grants g where g.id='680f7574-2e97-42e7-a038-658025b70fbc';

insert into app_private.work_workspace_events(
  id,actor_user_id,workspace_id,kind,before_value,after_value,reason,idempotency_key
)
select '91fa4436-8c00-44bf-8e1d-3a587d047364','928d3473-49a2-4427-a319-19729689a084',
  workspace_id,'workspace.pilot_cutover',
  jsonb_build_object('accessMode','legacy','directGrantIds',(select jsonb_agg(id order by id) from work_pilot_expected_grants)),
  jsonb_build_object('accessMode','workspace','memberCount',2,'bootstrapGrantId','680f7574-2e97-42e7-a038-658025b70fbc'),
  'WS8 named pilot cutover to canonical Workspace membership','91fa4436-8c00-44bf-8e1d-3a587d047364'
from work_pilot_result;

do $$
declare v_workspace uuid:=(select workspace_id from work_pilot_result);
begin
  if (select count(*) from public.work_workspace_members where workspace_id=v_workspace)<>2
     or not exists(select 1 from public.work_workspaces where id=v_workspace and access_mode='workspace' and status='active')
     or exists(select 1 from public.user_permission_grants g join work_pilot_expected_grants e using(id)
       where g.is_active or g.revoked_at is null or g.revoked_by is distinct from '928d3473-49a2-4427-a319-19729689a084')
     or not exists(select 1 from public.user_permission_grants where id='680f7574-2e97-42e7-a038-658025b70fbc'
       and is_active and permission_code='work.workspace.create' and scope_type='global' and scope_id='*'
       and expires_at='2026-09-21T07:02:36.939209+00:00')
     or app_private.has_permission('d0a300a0-1586-4748-b6e7-71773addc004','work.workspace.create','global','*')
     or app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.workspace.recover','global','*')
     or app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.task.view_restricted','work_workspace',v_workspace::text) then
    raise exception 'WORK_PILOT_PERMISSION_CUTOVER_MISMATCH';
  end if;
  if not app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.workspace.create','global','*')
     or not app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.task.configure','work_workspace',v_workspace::text)
     or app_private.has_permission('d0a300a0-1586-4748-b6e7-71773addc004','work.task.configure','work_workspace',v_workspace::text) then
    raise exception 'WORK_PILOT_EFFECTIVE_PERMISSION_MISMATCH';
  end if;
  if exists(select 1 from work_pilot_tasks_before b full join public.work_tasks t on t.id=b.id
      where b.value is distinct from to_jsonb(t)-'workspace_id' or t.workspace_id is distinct from v_workspace)
     or exists(select 1 from public.work_tasks t where t.workspace_id=v_workspace
      and not exists(select 1 from work_pilot_tasks_before b where b.id=t.id)) then
    raise exception 'WORK_PILOT_TASK_CHANGED';
  end if;
  if exists(select value from work_pilot_assignments_before except
      select to_jsonb(a) from public.work_task_assignments a where a.task_id in(select id from work_pilot_tasks_before))
     or exists(select to_jsonb(a) from public.work_task_assignments a where a.task_id in(select id from work_pilot_tasks_before)
      except select value from work_pilot_assignments_before) then
    raise exception 'WORK_WORKSPACE_ASSIGNMENT_CHANGED';
  end if;
  if exists(select 1 from work_pilot_groups_before b full join public.work_task_groups g on g.id=b.id
      where b.value is distinct from to_jsonb(g)-'workspace_id' or g.workspace_id is distinct from v_workspace)
     or exists(select 1 from work_pilot_calendars_before b full join public.work_sla_calendars c on c.id=b.id
      where b.value is distinct from to_jsonb(c)-'workspace_id' or c.workspace_id is distinct from v_workspace)
     or exists(select 1 from work_pilot_policies_before b full join public.work_sla_policies p on p.id=b.id
      where b.value is distinct from to_jsonb(p)-'workspace_id' or p.workspace_id is distinct from v_workspace) then
    raise exception 'WORK_PILOT_CONFIGURATION_CHANGED';
  end if;
  if exists(select 1 from work_pilot_outbox_before b full join(
      select * from app_private.work_notification_outbox where task_id in(select id from work_pilot_tasks_before))o on o.id=b.id
      where b.value is distinct from to_jsonb(o))
     or exists(select 1 from work_pilot_deliveries_before b full join(
      select * from app_private.work_notification_deliveries where outbox_id in(select id from work_pilot_outbox_before))d on d.id=b.id
      where b.value is distinct from to_jsonb(d))
     or exists(select 1 from work_pilot_attachments_before b full join(
      select * from public.work_task_attachments where task_id in(select id from work_pilot_tasks_before))a on a.id=b.id
      where b.value is distinct from to_jsonb(a))
     or exists(select 1 from work_pilot_events_before b full join(
      select * from public.work_task_events where task_id in(select id from work_pilot_tasks_before))e on e.id=b.id
      where b.value is distinct from to_jsonb(e))
     or exists(select 1 from work_pilot_versions_before b full join(
      select * from public.work_task_versions where task_id in(select id from work_pilot_tasks_before))v on v.id=b.id
      where b.value is distinct from to_jsonb(v)) then
    raise exception 'WORK_PILOT_CHILD_DATA_CHANGED';
  end if;
  if exists(select 1 from work_direct_before b full join public.work_tasks t on t.id=b.id
      where t.scope_type='direct' and b.workspace_id is distinct from t.workspace_id)
     or exists(select 1 from public.work_tasks where scope_type='direct' and workspace_id is not null) then
    raise exception 'WORK_DIRECT_TASK_WORKSPACE_CHANGED';
  end if;
  if exists(select * from work_other_scopes_before except
      select scope_type,coalesce(department_id::text,project_id),count(*) from public.work_tasks
      where scope_type in('department','project') and not(scope_type='department'
        and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9')
      group by scope_type,coalesce(department_id::text,project_id)) then
    raise exception 'WORK_OTHER_SCOPE_CHANGED';
  end if;
end $$;

select jsonb_build_object(
  'result','WORK_WORKSPACE_PILOT_BACKFILL_REHEARSAL_PASSED',
  'workspaceId',(select workspace_id from work_pilot_result),
  'taskCount',(select count(*) from work_pilot_tasks_before),
  'assignmentCount',(select count(*) from work_pilot_assignments_before),
  'groupCount',(select count(*) from work_pilot_groups_before),
  'calendarCount',(select count(*) from work_pilot_calendars_before),
  'policyCount',(select count(*) from work_pilot_policies_before),
  'retiredGrantCount',(select count(*) from work_pilot_expected_grants),
  'bootstrapGrantId','680f7574-2e97-42e7-a038-658025b70fbc',
  'otherScopes',(select coalesce(jsonb_agg(to_jsonb(x)order by scope_type,scope_id),'[]') from work_other_scopes_before x),
  'mode','rollback'
) as result;
rollback;
