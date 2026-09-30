-- Smoke test: template notification switches and direct-manager coverage
-- (2026-09-30). Run ONLY on a Supabase preview branch inside a rolled-back
-- transaction:  begin; \i this file; rollback;
-- Seed (preview branch, inside a transaction that is rolled back).
insert into app_private.request_feature_gates(gate, enabled) values ('content_edit', true)
on conflict (gate) do update set enabled = true;

create temp table t_users(tag text primary key, id uuid, auth_id uuid) on commit drop;
insert into t_users(tag, id, auth_id)
select tag, gen_random_uuid(), gen_random_uuid()
from unnest(array['A','C','P1','P2','E1','E2','W','O']) tag;
insert into auth.users(id, email, aud, role)
select auth_id, lower(tag) || '@phase3.test', 'authenticated', 'authenticated' from t_users;
-- auth.users insert provisions public.users through a trigger.
update t_users t set id = u.id from public.users u where lower(u.email) = lower(t.tag) || '@phase3.test';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('app.account_lifecycle_command', 'on', true);
update public.users u set name = 'Test ' || t.tag, auth_id = t.auth_id, is_active = true, account_status = 'ACTIVE',
  role = (case when t.tag = 'A' then 'ADMIN' else 'EMPLOYEE' end)::public.user_role
from t_users t where u.id = t.id;
select set_config('app.account_lifecycle_command', '', true);
do $$ begin if exists (select 1 from t_users where id not in (select id from public.users)) then raise exception 'seed users missing'; end if; end $$;
insert into public.user_permission_grants(user_id, permission_code)
select id, 'system.rq.view' from t_users where tag <> 'O';
insert into public.user_permission_grants(user_id, permission_code)
select id, 'request.template.manage' from t_users where tag = 'A';
grant select on t_users to public;

create or replace function pg_temp.as_user(p_tag text) returns uuid language plpgsql as $$
declare v t_users%rowtype;
begin
  select * into v from t_users where tag = p_tag;
  perform set_config('request.jwt.claims', json_build_object('sub', v.auth_id, 'role', 'authenticated')::text, true);
  return v.id;
end $$;
create or replace function pg_temp.uid(p_tag text) returns uuid language sql as $$ select id from t_users where tag = p_tag $$;
create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'ok  %', p_label;
end $$;
create or replace function pg_temp.pending(p_request uuid) returns text language sql as $$
  select coalesce(string_agg(u.tag || '@' || (a.metadata->>'requestBlockKey'), ',' order by u.tag), '')
  from public.workflow_step_assignments a
  join public.request_instances r on r.workflow_subject_id = a.workflow_subject_id
  join t_users u on u.id = a.assignee_user_id
  where r.id = p_request and a.status = 'PENDING'
$$;
create or replace function pg_temp.act(p_tag text, p_request uuid, p_action text, p_comment text default null) returns jsonb language plpgsql as $$
declare v_updated timestamptz;
begin
  perform pg_temp.as_user(p_tag);
  select updated_at into v_updated from public.request_instances where id = p_request;
  return app_private.act_on_request(p_request, p_action, p_comment, null, null, gen_random_uuid()::text, v_updated);
end $$;
create or replace function pg_temp.submit(p_version uuid, p_options jsonb) returns uuid language plpgsql as $$
begin
  perform pg_temp.as_user('C');
  return (app_private.submit_request(p_version, 'Phiếu thử', '', '{}'::jsonb, coalesce(p_options->'dynamic','{}'::jsonb), gen_random_uuid()::text, p_options - 'dynamic')->>'requestId')::uuid;
end $$;

do $test$
declare v_draft jsonb; v_pub jsonb; v_version uuid; r uuid; d jsonb;
  cfg_off jsonb := '{"SUBMITTED":false,"ASSIGNED":true,"REASSIGNED":true,"REMINDER":true,"RETURNED":true,"APPROVED":false,"REJECTED":true}';
  cfg_legacy jsonb := '{"SUBMITTED":true,"APPROVED":true}';
  v_cfg jsonb;
begin
  foreach v_cfg in array array[cfg_off, cfg_legacy] loop
    perform pg_temp.as_user('A');
    v_draft := app_private.save_request_template_draft(jsonb_build_object(
      'name', 'Mẫu thông báo ' || md5(v_cfg::text), 'description', '',
      'formSchema', jsonb_build_array(jsonb_build_object('key','reason','label','Lý do','fieldType','text','required',false,'options','[]'::jsonb,'sortOrder',1)),
      'usageScope', jsonb_build_object('companyWide', true, 'orgUnitIds', '[]'::jsonb, 'permissionCodes', '[]'::jsonb, 'userIds', '[]'::jsonb),
      'flowMode', 'SEQUENTIAL', 'completionPolicy', 'ALL',
      'blocks', jsonb_build_array(jsonb_build_object('key','b1','name','B1','source','FIXED_SINGLE','fixedUserIds',jsonb_build_array(pg_temp.uid('P1')),'sortOrder',1)),
      'watcherUserIds', '[]'::jsonb,
      'printConfig', jsonb_build_object('browserPrintEnabled', true, 'docxStoragePath', null),
      'notificationConfig', v_cfg));
    v_pub := app_private.publish_request_template_version((v_draft->>'id')::uuid, (v_draft->>'updatedAt')::timestamptz);
    r := pg_temp.submit((v_pub->>'requestTemplateVersionId')::uuid, '{}'::jsonb);
    perform pg_temp.act('P1', r, 'APPROVE');
    if v_cfg = cfg_off then
      perform pg_temp.check(not exists(select 1 from app_private.request_notification_outbox where request_id=r and event_type='REQUEST_SUBMITTED'), 'SUBMITTED=false suppresses submit notifications');
      perform pg_temp.check(not exists(select 1 from app_private.request_notification_outbox where request_id=r and event_type='REQUEST_APPROVED'), 'APPROVED=false suppresses completion notifications');
    else
      perform pg_temp.check(exists(select 1 from app_private.request_notification_outbox where request_id=r and event_type='REQUEST_SUBMITTED'), 'legacy config still sends submit notifications');
      perform pg_temp.check(exists(select 1 from app_private.request_notification_outbox where request_id=r and event_type='REQUEST_APPROVED'), 'legacy config still sends completion notifications');
    end if;
  end loop;

  perform pg_temp.as_user('A');
  d := app_private.request_direct_manager_coverage();
  perform pg_temp.check((d->>'activeUsers')::int > 0 and (d->>'withoutManager')::int >= 0, 'coverage returns counts for template managers (' || d::text || ')');
  perform pg_temp.as_user('C');
  begin
    perform app_private.request_direct_manager_coverage();
    raise exception 'FAIL: non-manager read coverage';
  exception when others then
    perform pg_temp.check(sqlerrm = 'REQUEST_TEMPLATE_FORBIDDEN', 'coverage forbidden for non-managers');
  end;
end $test$;
