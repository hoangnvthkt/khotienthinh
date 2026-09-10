begin;
create temporary table work_sla_fixture(actor uuid,calendar uuid,email text) on commit drop;
grant select on work_sla_fixture to authenticated;
do $$ declare a uuid:=gen_random_uuid(); c uuid; mail text:='sla-'||gen_random_uuid()||'@invalid.local';
  due timestamptz; result jsonb; department uuid:=gen_random_uuid();
begin
  if to_regprocedure('app_private.work_add_business_minutes(uuid,timestamptz,integer)') is null then raise exception 'TEST_MISSING_SLA_ENGINE'; end if;
  insert into public.users(id,name,username,email,role,is_active,account_status) values(a,'SLA actor','sla-'||a,mail,'EMPLOYEE',true,'ACTIVE');
  insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
  select a,code,'global','*','rollback smoke' from unnest(array['work.module.access','work.task.create','work.task.assign_user','work.task.view_related','work.task.review']) code;
  begin
    perform app_private.work_resolve_sla('{"type":"direct"}','urgent',now()); raise exception 'TEST_SLA_MISSING_CALENDAR_ACCEPTED';
  exception when sqlstate 'P0001' then if sqlerrm<>'WORK_CALENDAR_NOT_CONFIGURED' then raise; end if; end;
  insert into public.work_sla_calendars(name,working_weekdays,workday_start,workday_end,working_intervals,is_default,created_by)
  values('SLA split day',array[1,2,3,4,5]::smallint[],'08:00','17:00','[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}]',true,a) returning id into c;
  insert into work_sla_fixture values(a,c,mail);
  due:=app_private.work_add_business_minutes(c,'2026-09-04 11:30+07',120);
  if due<>'2026-09-04 14:30+07'::timestamptz then raise exception 'TEST_SLA_LUNCH %',due; end if;
  due:=app_private.work_add_business_minutes(c,'2026-09-04 12:15+07',60);
  if due<>'2026-09-04 14:00+07'::timestamptz then raise exception 'TEST_SLA_START_DURING_BREAK %',due; end if;
  insert into public.work_sla_calendar_exceptions(calendar_id,exception_date,is_working_day,created_by) values(c,'2026-09-07',false,a);
  due:=app_private.work_add_business_minutes(c,'2026-09-04 16:30+07',60);
  if due<>'2026-09-08 08:30+07'::timestamptz then raise exception 'TEST_SLA_HOLIDAY %',due; end if;
  insert into public.work_sla_calendar_exceptions(calendar_id,exception_date,is_working_day,workday_start,workday_end,working_intervals,created_by)
    values(c,'2026-09-05',true,'09:00','11:00','[{"start":"09:00","end":"11:00"}]',a);
  due:=app_private.work_add_business_minutes(c,'2026-09-04 16:30+07',60);
  if due<>'2026-09-05 09:30+07'::timestamptz then raise exception 'TEST_SLA_WORKING_EXCEPTION %',due; end if;
  result:=app_private.work_resolve_sla('{"type":"direct"}','normal',now());
  if (result->>'acknowledgementMinutes')::int<>480 or result->'executionMinutes'<>'null'::jsonb then raise exception 'TEST_SLA_DEFAULT_NORMAL %',result; end if;
  result:=app_private.work_resolve_sla('{"type":"direct"}','important',now());
  if (result->>'acknowledgementMinutes')::int<>240 then raise exception 'TEST_SLA_DEFAULT_IMPORTANT'; end if;
  result:=app_private.work_resolve_sla('{"type":"direct"}','urgent',now());
  if (result->>'acknowledgementMinutes')::int<>60 then raise exception 'TEST_SLA_DEFAULT_URGENT'; end if;
  insert into public.work_sla_policies(name,scope_type,priority,calendar_id,acknowledgement_minutes,execution_minutes,created_by)
    values('SLA global normal','global',null,c,90,960,a),('SLA urgent override','global','urgent',c,30,120,a);
  result:=app_private.work_resolve_sla('{"type":"direct"}','urgent',now());
  if (result->>'acknowledgementMinutes')::int<>30 or (result->>'executionMinutes')::int<>120 then raise exception 'TEST_SLA_PRIORITY_POLICY %',result; end if;
  insert into public.org_units(id,name) values(department,'SLA scoped department');
  insert into public.work_sla_policies(name,scope_type,department_id,calendar_id,acknowledgement_minutes,created_by)
    values('SLA scoped default','department',department,c,45,a);
  result:=app_private.work_resolve_sla(jsonb_build_object('type','department','departmentId',department),'urgent',now());
  if result->>'acknowledgementMinutes'<>'45' then raise exception 'TEST_SLA_SCOPE_PRECEDENCE'; end if;
  insert into public.work_sla_policies(name,scope_type,department_id,priority,calendar_id,acknowledgement_minutes,created_by)
    values('SLA scoped urgent','department',department,'urgent',c,15,a);
  result:=app_private.work_resolve_sla(jsonb_build_object('type','department','departmentId',department),'urgent',now());
  if result->>'acknowledgementMinutes'<>'15' then raise exception 'TEST_SLA_SCOPE_PRIORITY'; end if;
  update public.work_sla_policies set effective_to=now()-interval '1 second',effective_from=now()-interval '1 day'
    where name='SLA scoped urgent';
  result:=app_private.work_resolve_sla(jsonb_build_object('type','department','departmentId',department),'urgent',now());
  if result->>'acknowledgementMinutes'<>'45' then raise exception 'TEST_SLA_EXPIRED_POLICY'; end if;
  begin
    update public.work_sla_calendars set working_intervals='[{"start":"08:00","end":"12:00"},{"start":"11:00","end":"17:00"}]' where id=c;
    raise exception 'TEST_OVERLAPPING_INTERVALS_ACCEPTED';
  exception when check_violation then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'email',email,'role','authenticated')::text,true) from work_sla_fixture;
do $$ declare src jsonb; p jsonb; r jsonb; a public.work_task_assignments%rowtype; deadline timestamptz:=now()+interval '5 minutes'; begin
  src:=jsonb_build_array(jsonb_build_object('type','user','id',public.current_app_user_id()));
  p:=public.preview_work_task_recipients(src,'{"type":"direct"}');
  r:=public.create_work_task(jsonb_build_object('title','SLA self task','description','{"version":1,"type":"doc","content":[]}'::jsonb,
    'scope','{"type":"direct"}'::jsonb,'recipientSources',src,'watcherUserIds','[]'::jsonb,'checklist','[]'::jsonb,'labels','[]'::jsonb,
    'priority','urgent','privacy','standard','deadlineAt',deadline),gen_random_uuid(),p->>'fingerprint');
  select * into strict a from public.work_task_assignments where task_id=(r->>'taskId')::uuid;
  if a.execution_sla_started_at is distinct from a.acknowledged_at or a.execution_sla_due_at<=a.acknowledged_at
    or a.execution_sla_due_at is null or a.sla_snapshot->'execution'->>'executionMinutes'<>'120' then raise exception 'TEST_SELF_EXECUTION_SLA'; end if;
  if (select deadline_at from public.work_tasks where id=a.task_id) is distinct from deadline then raise exception 'TEST_SLA_REWROTE_DEADLINE'; end if;
end $$;
reset role;
select 'WORK_SLA_ENGINE_SMOKE_PASSED' as result;
rollback;
