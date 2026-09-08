-- Pilot Workspace rehearsal for ftciqmqhmfvjtwoycswe.
-- Safety default: this file always ends with ROLLBACK. Do not change the final
-- statement to COMMIT before the WS8 activation checkpoint.
begin;
select pg_advisory_xact_lock(hashtextextended('work_workspace_pilot_backfill',0));

do $$
begin
  if to_regprocedure('app_private.work_resolve_configuration_scope(jsonb)') is null then
    raise exception 'WORK_WORKSPACE_CONFIGURATION_MISSING';
  end if;
  if not exists(select 1 from public.users where id='928d3473-49a2-4427-a319-19729689a084'
    and lower(email)='admin@khoviet.vn' and is_active and account_status='ACTIVE')
    or not exists(select 1 from public.users where id='d0a300a0-1586-4748-b6e7-71773addc004'
      and lower(email)='sonpn@tienthinhjsc.vn' and is_active and account_status='ACTIVE') then
    raise exception 'WORK_PILOT_USER_MISMATCH';
  end if;
  if not exists(select 1 from public.org_units where id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'
    and name='Phòng Quản lý dự án') then raise exception 'WORK_PILOT_SCOPE_MISMATCH'; end if;
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
      'building','blue','blueprint','active','workspace',v_admin
    ) returning id into v_workspace;
  elsif not exists(select 1 from public.work_workspaces where id=v_workspace
    and status='active' and access_mode='workspace') then
    raise exception 'WORK_PILOT_WORKSPACE_STATE_MISMATCH';
  end if;

  insert into public.work_workspace_members(
    workspace_id,user_id,role,status,starts_at,expires_at,added_by,origin,source_reference
  ) values
    (v_workspace,v_admin,'admin','active','2026-09-07T07:02:36.939209+00:00',v_expiry,
      v_admin,'organization','pilot:phong-quan-ly-du-an:admin'),
    (v_workspace,v_member,'member','active','2026-09-07T07:02:36.939209+00:00',v_expiry,
      v_admin,'organization','pilot:phong-quan-ly-du-an:member')
  on conflict(workspace_id,user_id) do nothing;

  if exists(select 1 from public.work_workspace_members
    where workspace_id=v_workspace and user_id not in(v_admin,v_member)) then
    raise exception 'WORK_PILOT_UNEXPECTED_MEMBER';
  end if;
  if not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
      and user_id=v_admin and role='admin' and status='active'
      and starts_at='2026-09-07T07:02:36.939209+00:00' and expires_at=v_expiry
      and added_by=v_admin and origin='organization'
      and source_reference='pilot:phong-quan-ly-du-an:admin')
    or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
      and user_id=v_member and role='member' and status='active'
      and starts_at='2026-09-07T07:02:36.939209+00:00' and expires_at=v_expiry
      and added_by=v_admin and origin='organization'
      and source_reference='pilot:phong-quan-ly-du-an:member') then
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
    where scope_type='department' and department_id=v_department
      and workspace_id is null;
  update public.work_sla_calendars set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department
      and workspace_id is null;
  update public.work_sla_policies set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department
      and workspace_id is null;
  update public.work_tasks set workspace_id=v_workspace
    where scope_type='department' and department_id=v_department
      and workspace_id is null;
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

do $$
declare v_workspace uuid:=(select workspace_id from work_pilot_result);
begin
  if (select count(*) from public.work_workspace_members where workspace_id=v_workspace)<>2
    or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
      and user_id='928d3473-49a2-4427-a319-19729689a084' and role='admin' and status='active'
      and expires_at='2026-09-21T07:02:36.939209+00:00')
    or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
      and user_id='d0a300a0-1586-4748-b6e7-71773addc004' and role='member' and status='active'
      and expires_at='2026-09-21T07:02:36.939209+00:00') then
    raise exception 'WORK_PILOT_MEMBERSHIP_MISMATCH';
  end if;
  if exists(select 1 from work_pilot_tasks_before b full join public.work_tasks t on t.id=b.id
    where b.value is distinct from to_jsonb(t)-'workspace_id'
      or t.workspace_id is distinct from v_workspace)
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
      select * from app_private.work_notification_outbox where task_id in(select id from work_pilot_tasks_before)
    )o on o.id=b.id
      where b.value is distinct from to_jsonb(o))
    or exists(select 1 from work_pilot_deliveries_before b full join(
      select * from app_private.work_notification_deliveries where outbox_id in(select id from work_pilot_outbox_before)
    )d on d.id=b.id
      where b.value is distinct from to_jsonb(d))
    or exists(select 1 from work_pilot_attachments_before b full join(
      select * from public.work_task_attachments where task_id in(select id from work_pilot_tasks_before)
    )a on a.id=b.id
      where b.value is distinct from to_jsonb(a))
    or exists(select 1 from work_pilot_events_before b full join(
      select * from public.work_task_events where task_id in(select id from work_pilot_tasks_before)
    )e on e.id=b.id
      where b.value is distinct from to_jsonb(e))
    or exists(select 1 from work_pilot_versions_before b full join(
      select * from public.work_task_versions where task_id in(select id from work_pilot_tasks_before)
    )v on v.id=b.id
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
  'otherScopes',(select coalesce(jsonb_agg(to_jsonb(x)order by scope_type,scope_id),'[]') from work_other_scopes_before x),
  'mode','rollback'
) as result;
rollback;
