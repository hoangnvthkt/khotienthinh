-- Smoke test: dynamic approval steps named by the admin, submit-time watchers,
-- reassignment, outsider access and soft delete (2026-09-30).
--
-- Run ONLY against a Supabase preview branch, inside a transaction that is
-- rolled back:  begin; \i this file; rollback;
-- Seeds throwaway auth/public users; every check raises on failure.
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
declare
  v_draft jsonb; v_pub jsonb; v_version uuid; r uuid; d jsonb; v_updated timestamptz; v_asg uuid;
begin
  -- Admin publishes: step 1 "Quản lý trực tiếp" (dynamic) -> step 2 "Giám đốc vật tư" (dynamic).
  perform pg_temp.as_user('A');
  v_draft := app_private.save_request_template_draft(jsonb_build_object(
    'name', 'Đề xuất thiết bị văn phòng', 'description', '',
    'formSchema', jsonb_build_array(jsonb_build_object('key','reason','label','Lý do','fieldType','text','required',false,'options','[]'::jsonb,'sortOrder',1)),
    'usageScope', jsonb_build_object('companyWide', true, 'orgUnitIds', '[]'::jsonb, 'permissionCodes', '[]'::jsonb, 'userIds', '[]'::jsonb),
    'flowMode', 'SEQUENTIAL', 'completionPolicy', 'ALL',
    'blocks', jsonb_build_array(
      jsonb_build_object('key','manager','name','Quản lý trực tiếp','source','DYNAMIC_CREATOR_SELECT','minimumDynamicApprovers',1,'sortOrder',1),
      jsonb_build_object('key','director','name','Giám đốc vật tư','source','DYNAMIC_CREATOR_SELECT','minimumDynamicApprovers',1,'sortOrder',2)),
    'watcherUserIds', '[]'::jsonb,
    'printConfig', jsonb_build_object('browserPrintEnabled', true, 'docxStoragePath', null),
    'notificationConfig', '{}'::jsonb));
  v_pub := app_private.publish_request_template_version((v_draft->>'id')::uuid, (v_draft->>'updatedAt')::timestamptz);
  v_version := (v_pub->>'requestTemplateVersionId')::uuid;
  perform pg_temp.check(v_version is not null, 'template published');

  perform pg_temp.as_user('C');
  d := app_private.list_usable_request_templates();
  perform pg_temp.check(d->'items'->0->>'flowMode' = 'SEQUENTIAL' and d->'items'->0->'approvalBlocks'->1->>'name' = 'Giám đốc vật tư', 'usable template exposes flow mode and ordered steps');

  -- S1: creator names the approver of each dynamic step; order follows the template.
  r := pg_temp.submit(v_version, jsonb_build_object(
    'dynamic', jsonb_build_object('manager', jsonb_build_array(pg_temp.uid('P1')), 'director', jsonb_build_array(pg_temp.uid('P2'))),
    'watcherIds', jsonb_build_array(pg_temp.uid('W'))));
  perform pg_temp.check(pg_temp.pending(r) = 'P1@manager', 'S1 step 1 (Quản lý trực tiếp) active first');
  perform pg_temp.check(app_private.request_instance_can_select(r, pg_temp.uid('W')), 'S1 submit-time watcher can view');
  perform pg_temp.check((select count(*) from app_private.request_notification_outbox where request_id = r and event_type = 'REQUEST_WATCHER_ADDED') = 1, 'S1 watcher notified');
  d := app_private.request_detail_payload(r, pg_temp.uid('C'));
  perform pg_temp.check(jsonb_array_length(d->'watchers') = 1 and d->'watchers'->0->>'source' = 'MANUAL', 'S1 detail lists the watcher');
  perform pg_temp.act('P1', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'P2@director', 'S1 step 2 (Giám đốc vật tư) follows');
  perform pg_temp.act('P2', r, 'APPROVE');
  perform pg_temp.check((select status from public.request_instances where id = r) = 'APPROVED', 'S1 request completes');

  -- S2: missing approver for a dynamic step is rejected.
  begin
    perform pg_temp.submit(v_version, jsonb_build_object('dynamic', jsonb_build_object('manager', jsonb_build_array(pg_temp.uid('P1')))));
    raise exception 'FAIL: S2 accepted a dynamic step without approver';
  exception when others then
    perform pg_temp.check(sqlerrm = 'REQUEST_DYNAMIC_APPROVER_REQUIRED', 'S2 every dynamic step needs an approver');
  end;

  -- S3: watchers are validated; submitting without options still works.
  begin
    perform pg_temp.submit(v_version, jsonb_build_object('dynamic', jsonb_build_object('manager', jsonb_build_array(pg_temp.uid('P1')), 'director', jsonb_build_array(pg_temp.uid('P2'))), 'watcherIds', jsonb_build_array(gen_random_uuid())));
    raise exception 'FAIL: S3 unknown watcher accepted';
  exception when others then
    perform pg_temp.check(sqlerrm = 'REQUEST_WATCHER_INVALID', 'S3 unknown watcher rejected');
  end;
  perform pg_temp.as_user('C');
  r := (app_private.submit_request(v_version, 'Không tuỳ chọn', '', '{}'::jsonb,
    jsonb_build_object('manager', jsonb_build_array(pg_temp.uid('P1')), 'director', jsonb_build_array(pg_temp.uid('P2'))),
    gen_random_uuid()::text)->>'requestId')::uuid;
  perform pg_temp.check(pg_temp.pending(r) = 'P1@manager', 'S3 six-argument submit still works');

  -- S4: phase 2 regressions: approver hands over, outsider blocked, creator deletes.
  perform pg_temp.as_user('P1');
  select a.id into v_asg from public.workflow_step_assignments a join public.request_instances q on q.workflow_subject_id=a.workflow_subject_id where q.id=r and a.status='PENDING';
  select updated_at into v_updated from public.request_instances where id = r;
  perform app_private.reassign_request_assignment(r, v_asg, pg_temp.uid('E1'), 'Đi công tác', gen_random_uuid()::text, v_updated);
  perform pg_temp.check(pg_temp.pending(r) = 'E1@manager', 'S4 approver reassigned their step');
  perform pg_temp.as_user('O');
  begin
    perform app_private.add_request_watchers(r, array[pg_temp.uid('O')]);
    raise exception 'FAIL: S4 outsider added watcher';
  exception when others then
    perform pg_temp.check(sqlerrm = 'REQUEST_NOT_FOUND_OR_FORBIDDEN', 'S4 outsider cannot add watchers');
  end;
  perform pg_temp.as_user('C');
  select updated_at into v_updated from public.request_instances where id = r;
  perform app_private.delete_request(r, v_updated);
  perform pg_temp.check(not app_private.request_instance_can_select(r, pg_temp.uid('C')) and not app_private.request_instance_can_select(r, pg_temp.uid('A')), 'S4 deleted request hidden from creator and admin');
end $test$;
