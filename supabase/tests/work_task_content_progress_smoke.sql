begin;

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_tasks' and column_name='progress_percent')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='work_tasks' and column_name='result_draft_document')
    or to_regprocedure('app_private.work_command_content_progress(uuid,text,jsonb,uuid)') is null then
    raise exception 'WORK_TASK_CONTENT_PROGRESS_MIGRATION_MISSING' using errcode='42883';
  end if;
end $$;

create temporary table work_content_people(name text primary key,id uuid,email text) on commit drop;
create temporary table work_content_data(key text primary key,value jsonb) on commit drop;
grant select on work_content_people to authenticated;
grant all on work_content_data to authenticated;

insert into work_content_people
select name,gen_random_uuid(),'content-'||gen_random_uuid()||'@invalid.local'
from unnest(array['creator','assignee','outsider']) name;

insert into public.users(id,name,username,email,role,is_active,account_status)
select id,'Content '||name,'content-'||id,email,'EMPLOYEE',true,'ACTIVE' from work_content_people;

insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.module.access','global','*','content rollback smoke' from work_content_people;
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.view_related','own','*','content rollback smoke' from work_content_people where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.audit_view','own','*','content rollback smoke' from work_content_people where name='creator';
insert into public.user_permission_grants(user_id,permission_code,scope_type,scope_id,grant_reason)
select id,'work.task.view_related','assigned','*','content rollback smoke' from work_content_people where name='assignee';

with inserted as (
  insert into public.work_tasks(task_code,title,description_document,description_text,scope_type,status,privacy,priority,review_policy,created_by)
  select app_private.next_work_task_code(),'Content progress smoke',
    '{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Original"}]}]}'::jsonb,
    'Original','direct','in_progress','standard','normal','creator_review',id
  from work_content_people where name='creator' returning id
)
insert into work_content_data values('task',(select to_jsonb(id) from inserted));

insert into public.work_task_assignments(task_id,user_id,state,assigned_by,acknowledged_at,started_at)
select (select (value#>>'{}')::uuid from work_content_data where key='task'),assignee.id,'in_progress',creator.id,now(),now()
from work_content_people assignee cross join work_content_people creator
where assignee.name='assignee' and creator.name='creator';

create function pg_temp.work_content_as(p_name text)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform set_config('request.jwt.claims',(select jsonb_build_object(
    'sub',gen_random_uuid(),'email',email,'role','authenticated')::text
    from pg_temp.work_content_people where name=p_name),true);
end $$;
grant execute on function pg_temp.work_content_as(text) to authenticated;

create function pg_temp.work_rich_doc(p_text text)
returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_object('version',1,'type','doc','content',jsonb_build_array(
    jsonb_build_object('type','heading','level',2,'content',jsonb_build_array(
      jsonb_build_object('type','text','text',p_text,'marks',jsonb_build_array(jsonb_build_object('type','bold'))))),
    jsonb_build_object('type','bullet_list','content',jsonb_build_array(
      jsonb_build_object('type','list_item','content',jsonb_build_array(
        jsonb_build_object('type','text','text','Tài liệu','marks',jsonb_build_array(
          jsonb_build_object('type','link','attrs',jsonb_build_object('href','https://example.com/file'))))))))));
$$;
grant execute on function pg_temp.work_rich_doc(text) to authenticated;

set local role authenticated;
select pg_temp.work_content_as('assignee');

do $$
declare
  v_task uuid := (select (value#>>'{}')::uuid from work_content_data where key='task');
  v_result jsonb; v_key uuid := gen_random_uuid(); v_events integer; v_detail jsonb;
begin
  v_detail := public.get_work_task_detail(v_task::text);
  if (v_detail->'capabilities'->>'canUpdateResultDraft')::boolean is not true
    or (v_detail->'capabilities'->>'canUpdateProgress')::boolean is not true
    or (v_detail->'capabilities'->>'canUpdateDescription')::boolean is not false then
    raise exception 'TEST_CONTENT_CAPABILITIES';
  end if;

  v_result := public.command_work_task_collaboration(v_task,'result_draft_update',
    jsonb_build_object('content',pg_temp.work_rich_doc('Đã hoàn thành'),'expectedLockVersion',1),v_key);
  if v_result is distinct from public.command_work_task_collaboration(v_task,'result_draft_update',
      jsonb_build_object('content',pg_temp.work_rich_doc('Đã hoàn thành'),'expectedLockVersion',1),v_key)
    or v_result->'content'->>'text' <> E'Đã hoàn thành\nTài liệu'
    or (v_result->>'taskLockVersion')::bigint <> 2 then
    raise exception 'TEST_RESULT_DRAFT_RETRY %',v_result;
  end if;

  v_result := public.command_work_task_collaboration(v_task,'progress_update',
    '{"progressPercent":100,"expectedLockVersion":2}'::jsonb,gen_random_uuid());
  if v_result->>'progressPercent'<>'100' or (v_result->>'taskLockVersion')::bigint<>3
    or (select status from public.work_tasks where id=v_task)<>'in_progress' then
    raise exception 'TEST_PROGRESS_100_COMPLETED_TASK %',v_result;
  end if;

  select count(*) into v_events from public.work_task_events where task_id=v_task;
  v_result := public.command_work_task_collaboration(v_task,'progress_update',
    '{"progressPercent":100,"expectedLockVersion":3}'::jsonb,gen_random_uuid());
  if (v_result->>'taskLockVersion')::bigint<>3
    or (select count(*) from public.work_task_events where task_id=v_task)<>v_events then
    raise exception 'TEST_PROGRESS_NOOP';
  end if;

  begin
    perform public.command_work_task_collaboration(v_task,'progress_update',
      '{"progressPercent":25.5,"expectedLockVersion":3}'::jsonb,gen_random_uuid());
    raise exception 'TEST_FRACTIONAL_PROGRESS_ALLOWED';
  exception when invalid_parameter_value then
    if sqlerrm<>'WORK_INVALID_PROGRESS' then raise; end if;
  end;
  begin
    perform public.command_work_task_collaboration(v_task,'result_draft_update',jsonb_build_object(
      'content','{"version":1,"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"bad","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}'::jsonb,
      'expectedLockVersion',3),gen_random_uuid());
    raise exception 'TEST_UNSAFE_LINK_ALLOWED';
  exception when invalid_parameter_value then
    if sqlerrm<>'WORK_INVALID_DOCUMENT' then raise; end if;
  end;
  begin
    perform public.command_work_task_collaboration(v_task,'progress_update',
      '{"progressPercent":75,"expectedLockVersion":2}'::jsonb,gen_random_uuid());
    raise exception 'TEST_STALE_PROGRESS_ALLOWED';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'WORK_VERSION_CONFLICT' then raise; end if;
  end;
  begin
    perform public.command_work_task_collaboration(v_task,'description_update',
      jsonb_build_object('content',pg_temp.work_rich_doc('Denied'),'expectedLockVersion',3),gen_random_uuid());
    raise exception 'TEST_ASSIGNEE_DESCRIPTION_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm<>'WORK_COMMAND_DENIED' then raise; end if;
  end;

  v_detail := public.get_work_task_detail(v_task::text);
  if v_detail->'task'->>'progress_percent'<>'100'
    or v_detail->'task'->>'result_draft_text'<>E'Đã hoàn thành\nTài liệu' then
    raise exception 'TEST_DETAIL_PROJECTION %',v_detail->'task';
  end if;
end $$;

select pg_temp.work_content_as('creator');
do $$
declare v_task uuid:=(select (value#>>'{}')::uuid from work_content_data where key='task'); v_result jsonb; v_page jsonb;
begin
  v_result:=public.command_work_task_collaboration(v_task,'description_update',
    jsonb_build_object('content',pg_temp.work_rich_doc('Mô tả mới'),'expectedLockVersion',3),gen_random_uuid());
  if (v_result->>'taskLockVersion')::bigint<>4 or v_result->'content'->>'text'<>E'Mô tả mới\nTài liệu' then
    raise exception 'TEST_DESCRIPTION_UPDATE %',v_result;
  end if;
  v_page:=public.list_work_tasks('created_by_me','{}'::jsonb,null,50);
  if not exists(select 1 from jsonb_array_elements(v_page->'items') item
    where item->>'id'=v_task::text and item->>'progress_percent'='100') then
    raise exception 'TEST_LIST_PROGRESS %',v_page;
  end if;
end $$;

reset role;
do $$
declare v_task uuid:=(select (value#>>'{}')::uuid from work_content_data where key='task');
begin
  if (select count(*) from public.work_task_events where task_id=v_task and event_type in(
      'task.result_draft_updated','task.progress_updated','task.description_updated'))<>3
    or (select count(*) from public.work_task_versions where task_id=v_task and version between 2 and 4)<>3
    or (select count(*) from app_private.work_notification_outbox where task_id=v_task and event_type in(
      'task.result_draft_updated','task.progress_updated','task.description_updated'))<>3 then
    raise exception 'TEST_CONTENT_ATOMIC_EVIDENCE';
  end if;
  update public.work_tasks set status='completed',completed_at=now(),progress_percent=40 where id=v_task;
  if (select progress_percent from public.work_tasks where id=v_task)<>100 then
    raise exception 'TEST_COMPLETED_PROGRESS_NOT_FORCED';
  end if;
  if has_function_privilege('anon','public.command_work_task_collaboration(uuid,text,jsonb,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.command_work_task_collaboration(uuid,text,jsonb,uuid)','EXECUTE') then
    raise exception 'TEST_CONTENT_RPC_PRIVILEGES';
  end if;
end $$;

rollback;
