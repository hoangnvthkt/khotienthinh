-- Persistent-state acceptance for the named WS8 Workspace pilot.
-- Read-only checks run in a rollback transaction and use the two real auth IDs.
begin;

do $$
declare
  v_workspace uuid;
  v_calendar uuid;
  v_retired uuid[]:=array[
    'e81ce1d6-3bc0-49df-b4ce-70c153f18c7b','5e8fd000-20ae-4e19-9116-00d7d50a5b31',
    'cea13f83-c47d-4001-91cb-f33b39bdf246','c3ca34d6-82bf-483a-90e4-5b5e473e3d78',
    'e808893b-0c8d-4cbf-996d-c0e09d8afb03','c1366ba0-94c7-4f32-94f9-10f07cafe9f1',
    '73cf34b8-9024-4c1b-af2d-cd0517f8cc14','b6608117-0dff-4548-a569-9589c8658ff2',
    'ac08759b-6953-4a45-8cc7-d4d5ab072a5d','5a2a5de2-16c9-4345-92ea-bf25251f173a',
    'b47c5c86-dcdc-4892-83e0-bd4762b4e75b','9207a3a1-8091-4aa8-8553-0c81595561cf',
    '5371b709-c914-406a-ab64-57a7c286a78c','6e4dbbf4-5edb-49cb-9bcc-65dbb0c69651',
    'afe1f077-337e-4640-88d0-4b843c910e49'
  ]::uuid[];
begin
  if not exists(select 1 from public.users
      where id='928d3473-49a2-4427-a319-19729689a084'
        and auth_id is not distinct from 'e99f1b85-ab8e-49ee-b068-e100fe698533'
        and lower(email)='admin@khoviet.vn' and is_active and account_status='ACTIVE')
     or not exists(select 1 from public.users
      where id='d0a300a0-1586-4748-b6e7-71773addc004'
        and auth_id is not distinct from 'd0a300a0-1586-4748-b6e7-71773addc004'
        and lower(email)='sonpn@tienthinhjsc.vn' and is_active and account_status='ACTIVE') then
    raise exception 'WORK_PILOT_AUTH_IDENTITY_MISMATCH';
  end if;
  select id into v_workspace from public.work_workspaces
  where kind='department' and department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9';
  if v_workspace is null
     or not exists(select 1 from public.work_workspaces where id=v_workspace
       and name='Phòng Quản lý dự án' and status='active' and access_mode='workspace'
       and icon_key='building' and color_key='blue' and cover_key='blueprint')
     or (select count(*) from public.work_workspaces where department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9')<>1 then
    raise exception 'WORK_PILOT_WORKSPACE_MISMATCH';
  end if;
  if (select count(*) from public.work_workspace_members where workspace_id=v_workspace)<>2
     or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
       and user_id='928d3473-49a2-4427-a319-19729689a084' and role='admin' and status='active'
       and starts_at='2026-09-07T07:02:36.939209+00:00'
       and expires_at='2026-09-21T07:02:36.939209+00:00' and origin='organization'
       and source_reference='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9')
     or not exists(select 1 from public.work_workspace_members where workspace_id=v_workspace
       and user_id='d0a300a0-1586-4748-b6e7-71773addc004' and role='member' and status='active'
       and starts_at='2026-09-07T07:02:36.939209+00:00'
       and expires_at='2026-09-21T07:02:36.939209+00:00' and origin='organization'
       and source_reference='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9') then
    raise exception 'WORK_PILOT_MEMBER_MISMATCH';
  end if;

  if (select count(*) from public.work_tasks where workspace_id=v_workspace)<>1
     or not exists(select 1 from public.work_tasks where workspace_id=v_workspace
       and task_code='VW-2026-000017' and privacy='standard' and status='in_progress')
     or exists(select 1 from public.work_tasks where scope_type='direct' and workspace_id is not null)
     or coalesce((select md5(string_agg((to_jsonb(t)-'workspace_id')::text,'' order by id))
       from public.work_tasks t where workspace_id=v_workspace),md5(''))<>'d74eadfd341f2c01e515e1baa6a9c6f1'
     or coalesce((select md5(string_agg(to_jsonb(a)::text,'' order by a.id))
       from public.work_task_assignments a join public.work_tasks t on t.id=a.task_id
       where t.workspace_id=v_workspace),md5(''))<>'0e9e7ac5f5ddc8f56a77cd27cb73772a' then
    raise exception 'WORK_PILOT_TASK_FINGERPRINT_MISMATCH';
  end if;
  if (select count(*) from app_private.work_notification_outbox o
      join public.work_tasks t on t.id=o.task_id where t.workspace_id=v_workspace)<>2
     or exists(select 1 from app_private.work_notification_deliveries d
      join app_private.work_notification_outbox o on o.id=d.outbox_id
      join public.work_tasks t on t.id=o.task_id where t.workspace_id=v_workspace)
     or exists(select 1 from public.work_task_attachments a join public.work_tasks t on t.id=a.task_id
      where t.workspace_id=v_workspace)
     or (select count(*) from public.work_task_events e join public.work_tasks t on t.id=e.task_id
      where t.workspace_id=v_workspace)<>2
     or (select count(*) from public.work_task_versions x join public.work_tasks t on t.id=x.task_id
      where t.workspace_id=v_workspace)<>2 then
    raise exception 'WORK_PILOT_CHILD_DATA_MISMATCH';
  end if;

  select id into v_calendar from public.work_sla_calendars where workspace_id=v_workspace;
  if v_calendar is null or (select count(*) from public.work_sla_calendars where workspace_id=v_workspace)<>1
     or not exists(select 1 from public.work_sla_calendars where id=v_calendar
       and timezone='Asia/Ho_Chi_Minh' and working_weekdays=array[1,2,3,4,5,6]::smallint[]
       and working_intervals='[{"end":"12:00","start":"08:00"},{"end":"17:00","start":"13:00"}]'::jsonb
       and is_active and not is_default)
     or (select count(*) from public.work_sla_policies where workspace_id=v_workspace)<>3
     or not exists(select 1 from public.work_sla_policies where workspace_id=v_workspace
       and priority='normal' and acknowledgement_minutes=480 and execution_minutes is null and calendar_id=v_calendar)
     or not exists(select 1 from public.work_sla_policies where workspace_id=v_workspace
       and priority='important' and acknowledgement_minutes=240 and execution_minutes is null and calendar_id=v_calendar)
     or not exists(select 1 from public.work_sla_policies where workspace_id=v_workspace
       and priority='urgent' and acknowledgement_minutes=60 and execution_minutes is null and calendar_id=v_calendar)
     or coalesce((select md5(string_agg((to_jsonb(c)-'workspace_id')::text,'' order by id))
       from public.work_sla_calendars c where workspace_id=v_workspace),md5(''))<>'ebf8adafa642c61eb5853271ca0e476d'
     or coalesce((select md5(string_agg((to_jsonb(p)-'workspace_id')::text,'' order by id))
       from public.work_sla_policies p where workspace_id=v_workspace),md5(''))<>'8ba38c1c49589bde2fb7099ae0447d48' then
    raise exception 'WORK_PILOT_CONFIGURATION_MISMATCH';
  end if;

  if (select count(*) from public.user_permission_grants where id=any(v_retired))<>15
     or exists(select 1 from public.user_permission_grants where id=any(v_retired)
       and (is_active or revoked_at is null
         or revoked_by is distinct from '928d3473-49a2-4427-a319-19729689a084'
         or revoked_reason is distinct from 'Replaced by canonical Workspace membership during WS8 pilot cutover'
         or expires_at is distinct from '2026-09-21T07:02:36.939209+00:00'))
     or not exists(select 1 from public.user_permission_grants
       where id='680f7574-2e97-42e7-a038-658025b70fbc'
         and user_id='928d3473-49a2-4427-a319-19729689a084'
         and permission_code='work.workspace.create' and scope_type='global' and scope_id='*'
         and is_active and expires_at='2026-09-21T07:02:36.939209+00:00')
     or (select count(*) from public.permission_audit_events
       where metadata->>'operationKey'='91fa4436-8c00-44bf-8e1d-3a587d047364')<>3
     or not exists(select 1 from app_private.work_workspace_events
       where id='91fa4436-8c00-44bf-8e1d-3a587d047364' and workspace_id=v_workspace
         and kind='workspace.pilot_cutover') then
    raise exception 'WORK_PILOT_GRANT_AUDIT_MISMATCH';
  end if;

  if not app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.module.access','global','*')
     or not app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.workspace.create','global','*')
     or not app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.task.configure','work_workspace',v_workspace::text)
     or not app_private.has_permission('d0a300a0-1586-4748-b6e7-71773addc004','work.task.create','work_workspace',v_workspace::text)
     or app_private.has_permission('d0a300a0-1586-4748-b6e7-71773addc004','work.task.configure','work_workspace',v_workspace::text)
     or app_private.has_permission('d0a300a0-1586-4748-b6e7-71773addc004','work.workspace.create','global','*')
     or app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.workspace.recover','global','*')
     or app_private.has_permission('928d3473-49a2-4427-a319-19729689a084','work.task.view_restricted','work_workspace',v_workspace::text)
     or (select enabled from app_private.work_notification_settings) then
    raise exception 'WORK_PILOT_EFFECTIVE_PERMISSION_MISMATCH';
  end if;
end $$;

-- Admin persona: real auth ID, full Workspace operations and current task read.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','e99f1b85-ab8e-49ee-b068-e100fe698533','email','admin@khoviet.vn','role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_workspace uuid; v_list jsonb; v_detail jsonb; v_members jsonb;
begin
  if public.current_app_user_id() is distinct from '928d3473-49a2-4427-a319-19729689a084' then
    raise exception 'WORK_PILOT_ADMIN_PRINCIPAL_MISMATCH';
  end if;
  v_list:=public.list_my_work_workspaces('',null,null,null,'updated',30);
  v_workspace:=(v_list->'items'->0->>'id')::uuid;
  v_detail:=public.get_work_workspace(v_workspace);
  v_members:=public.list_work_workspace_members(v_workspace,'',null,30);
  if jsonb_array_length(v_list->'items')<>1
     or (v_detail->'capabilities'->>'canManageMembers')::boolean is not true
     or (v_detail->'capabilities'->>'canConfigure')::boolean is not true
     or jsonb_array_length(v_members->'items')<>2
     or (select count(*) from public.work_tasks)<>1 then
    raise exception 'WORK_PILOT_ADMIN_PERSONA_MISMATCH';
  end if;
end $$;
reset role;

-- Member persona: real auth ID, same Workspace/task visibility without admin powers.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','d0a300a0-1586-4748-b6e7-71773addc004','email','sonpn@tienthinhjsc.vn','role','authenticated')::text,true);
set local role authenticated;
do $$
declare v_workspace uuid; v_list jsonb; v_detail jsonb; v_members jsonb;
begin
  if public.current_app_user_id() is distinct from 'd0a300a0-1586-4748-b6e7-71773addc004' then
    raise exception 'WORK_PILOT_MEMBER_PRINCIPAL_MISMATCH';
  end if;
  v_list:=public.list_my_work_workspaces('',null,null,null,'updated',30);
  v_workspace:=(v_list->'items'->0->>'id')::uuid;
  v_detail:=public.get_work_workspace(v_workspace);
  v_members:=public.list_work_workspace_members(v_workspace,'',null,30);
  if jsonb_array_length(v_list->'items')<>1
     or (v_detail->'capabilities'->>'canManageMembers')::boolean is not false
     or (v_detail->'capabilities'->>'canConfigure')::boolean is not false
     or jsonb_array_length(v_members->'items')<>2
     or (select count(*) from public.work_tasks)<>1 then
    raise exception 'WORK_PILOT_MEMBER_PERSONA_MISMATCH';
  end if;
end $$;
reset role;

-- Unknown principal: raw RLS exposes neither Workspace nor task.
select set_config('request.jwt.claims',jsonb_build_object(
  'sub','11111111-1111-4111-8111-111111111111','email','outsider@example.invalid','role','authenticated')::text,true);
set local role authenticated;
do $$
begin
  if public.current_app_user_id() is not null then
    raise exception 'WORK_PILOT_OUTSIDER_RLS_MISMATCH';
  end if;
  begin
    perform 1 from public.work_workspaces;
    raise exception 'WORK_PILOT_OUTSIDER_WORKSPACE_TABLE_EXPOSED';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.work_tasks) then
    raise exception 'WORK_PILOT_OUTSIDER_TASK_EXPOSED';
  end if;
end $$;
reset role;

select jsonb_build_object(
  'result','WORK_WORKSPACE_PILOT_ACCEPTANCE_PASSED',
  'workspaceId',(select id from public.work_workspaces
    where department_id='6a1ee524-c7f6-41dd-9b0d-440e76c6cdc9'),
  'members',2,'taskCode','VW-2026-000017','notificationsEnabled',false
) result;
rollback;
