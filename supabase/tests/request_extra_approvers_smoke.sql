-- Smoke test: request extra approvers, submit-time watchers, reassignment and
-- soft delete (phases 2–3, 2026-09-30).
--
-- Run ONLY against a Supabase preview branch, inside a transaction that is
-- rolled back:  begin; \i this file; rollback;
-- It seeds throwaway auth/public users, publishes two templates and walks
-- sequential, any-one, return/resubmit, reassign, content-edit, validation,
-- delete and parallel scenarios. Every check raises on failure.
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
  return (app_private.submit_request(p_version, 'Phiếu thử', '', '{}'::jsonb, '{}'::jsonb, gen_random_uuid()::text, p_options)->>'requestId')::uuid;
end $$;

do $test$
declare
  v_draft jsonb; v_pub jsonb; v_version uuid; r uuid; d jsonb; v_updated timestamptz; v_asg uuid;
begin
  -- Admin publishes a sequential template B1(P1) -> B2(P2).
  perform pg_temp.as_user('A');
  v_draft := app_private.save_request_template_draft(jsonb_build_object(
    'name', 'Mẫu thử Đợt 3', 'description', '',
    'formSchema', jsonb_build_array(jsonb_build_object('key','reason','label','Lý do','fieldType','text','required',false,'options','[]'::jsonb,'sortOrder',1)),
    'usageScope', jsonb_build_object('companyWide', true, 'orgUnitIds', '[]'::jsonb, 'permissionCodes', '[]'::jsonb, 'userIds', '[]'::jsonb),
    'flowMode', 'SEQUENTIAL', 'completionPolicy', 'ALL',
    'blocks', jsonb_build_array(
      jsonb_build_object('key','b1','name','B1','source','FIXED_SINGLE','fixedUserIds',jsonb_build_array(pg_temp.uid('P1')),'sortOrder',1),
      jsonb_build_object('key','b2','name','B2','source','FIXED_SINGLE','fixedUserIds',jsonb_build_array(pg_temp.uid('P2')),'sortOrder',2)),
    'watcherUserIds', '[]'::jsonb,
    'printConfig', jsonb_build_object('browserPrintEnabled', true, 'docxStoragePath', null),
    'notificationConfig', '{}'::jsonb));
  v_pub := app_private.publish_request_template_version((v_draft->>'id')::uuid, (v_draft->>'updatedAt')::timestamptz);
  v_version := (v_pub->>'requestTemplateVersionId')::uuid;
  perform pg_temp.check(v_version is not null, 'template published');

  -- S1: no extra approvers -> unchanged behaviour.
  r := pg_temp.submit(v_version, '{}'::jsonb);
  perform pg_temp.check(pg_temp.pending(r) = 'P1@b1', 'S1 no extra: B1 active first (' || pg_temp.pending(r) || ')');

  -- S2: extra ALL + watcher at submit.
  r := pg_temp.submit(v_version, jsonb_build_object('extraApproverIds', jsonb_build_array(pg_temp.uid('E1'), pg_temp.uid('E2')), 'extraCompletionPolicy', 'ALL', 'watcherIds', jsonb_build_array(pg_temp.uid('W'))));
  perform pg_temp.check(pg_temp.pending(r) = 'E1@__extra,E2@__extra', 'S2 extra step runs before template (' || pg_temp.pending(r) || ')');
  perform pg_temp.check(app_private.request_instance_can_select(r, pg_temp.uid('W')), 'S2 submit-time watcher can view');
  perform pg_temp.as_user('C');
  d := app_private.request_detail_payload(r, pg_temp.uid('C'));
  perform pg_temp.check(d->'approvalBlocks'->0->>'key' = '__extra' and d->'approvalBlocks'->0->>'status' = 'ACTIVE', 'S2 detail shows extra step first and active');
  perform pg_temp.check(jsonb_array_length(d->'watchers') = 1 and d->'watchers'->0->>'source' = 'MANUAL', 'S2 detail lists the watcher');
  perform pg_temp.act('E1', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'E2@__extra', 'S2 ALL waits for the second extra approver');
  perform pg_temp.act('E2', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'P1@b1', 'S2 extra done -> B1 starts');
  perform pg_temp.act('P1', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'P2@b2', 'S2 B1 -> B2');
  perform pg_temp.act('P2', r, 'APPROVE');
  perform pg_temp.check((select status from public.request_instances where id = r) = 'APPROVED', 'S2 request completes');

  -- S3: extra ANY_ONE.
  r := pg_temp.submit(v_version, jsonb_build_object('extraApproverIds', jsonb_build_array(pg_temp.uid('E1'), pg_temp.uid('E2')), 'extraCompletionPolicy', 'ANY_ONE'));
  perform pg_temp.act('E2', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'P1@b1', 'S3 ANY_ONE: one approval starts B1');
  perform pg_temp.check(exists(select 1 from public.workflow_step_assignments a join public.request_instances q on q.workflow_subject_id=a.workflow_subject_id where q.id=r and a.assignee_user_id=pg_temp.uid('E1') and a.status='SKIPPED'), 'S3 other extra approver skipped');

  -- S4: extra approver returns, creator resubmits -> extra step restarts.
  r := pg_temp.submit(v_version, jsonb_build_object('extraApproverIds', jsonb_build_array(pg_temp.uid('E1'))));
  perform pg_temp.act('E1', r, 'RETURN', 'Bổ sung');
  perform pg_temp.check((select status from public.request_instances where id = r) = 'RETURNED', 'S4 returned by extra approver');
  perform pg_temp.act('C', r, 'RESUBMIT');
  perform pg_temp.check(pg_temp.pending(r) = 'E1@__extra', 'S4 resubmit restarts extra step');

  -- S5: extra approver hands over; snapshot follows; approval continues.
  perform pg_temp.as_user('E1');
  select a.id into v_asg from public.workflow_step_assignments a join public.request_instances q on q.workflow_subject_id=a.workflow_subject_id where q.id=r and a.status='PENDING';
  select updated_at into v_updated from public.request_instances where id = r;
  perform app_private.reassign_request_assignment(r, v_asg, pg_temp.uid('E2'), 'Đi công tác', gen_random_uuid()::text, v_updated);
  perform pg_temp.check(pg_temp.pending(r) = 'E2@__extra', 'S5 reassigned inside extra step');
  perform pg_temp.check((select approval_config_snapshot #> '{extraBlock,resolvedUserIds}' from public.request_instances where id = r) = jsonb_build_array(pg_temp.uid('E2')), 'S5 extra snapshot updated');
  perform pg_temp.act('E2', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'P1@b1', 'S5 new extra approver completes the step');

  -- S6: content edit restarts from the extra step.
  perform pg_temp.as_user('C');
  select updated_at into v_updated from public.request_instances where id = r;
  perform app_private.update_request_content(r, 'Phiếu thử (sửa)', '', '{}'::jsonb, v_updated, gen_random_uuid()::text);
  perform pg_temp.check(pg_temp.pending(r) = 'E2@__extra', 'S6 edit restarts from extra step (' || pg_temp.pending(r) || ')');

  -- S7: validation.
  begin
    perform pg_temp.submit(v_version, jsonb_build_object('extraApproverIds', jsonb_build_array(pg_temp.uid('C'))));
    raise exception 'FAIL: S7 creator accepted as extra approver';
  exception when others then
    perform pg_temp.check(sqlerrm = 'REQUEST_APPROVER_SELF_NOT_ALLOWED', 'S7 creator rejected as extra approver');
  end;

  -- S8: phase 2 regressions: outsider, delete.
  r := pg_temp.submit(v_version, '{}'::jsonb);
  perform pg_temp.as_user('O');
  begin
    perform app_private.add_request_watchers(r, array[pg_temp.uid('O')]);
    raise exception 'FAIL: S8 outsider added watcher';
  exception when others then
    perform pg_temp.check(sqlerrm = 'REQUEST_NOT_FOUND_OR_FORBIDDEN', 'S8 outsider cannot add watchers');
  end;
  perform pg_temp.as_user('C');
  select updated_at into v_updated from public.request_instances where id = r;
  perform app_private.delete_request(r, v_updated);
  perform pg_temp.check(not app_private.request_instance_can_select(r, pg_temp.uid('C')) and not app_private.request_instance_can_select(r, pg_temp.uid('A')), 'S8 deleted request hidden from creator and admin');
  perform pg_temp.check(pg_temp.pending(r) = '', 'S8 pending approvals closed on delete');
  -- S9: parallel ANY_ONE template with an extra step.
  perform pg_temp.as_user('A');
  v_draft := app_private.save_request_template_draft(jsonb_build_object(
    'name', 'Mẫu thử đồng thời', 'description', '',
    'formSchema', jsonb_build_array(jsonb_build_object('key','reason','label','Lý do','fieldType','text','required',false,'options','[]'::jsonb,'sortOrder',1)),
    'usageScope', jsonb_build_object('companyWide', true, 'orgUnitIds', '[]'::jsonb, 'permissionCodes', '[]'::jsonb, 'userIds', '[]'::jsonb),
    'flowMode', 'PARALLEL', 'completionPolicy', 'ANY_ONE',
    'blocks', jsonb_build_array(
      jsonb_build_object('key','b1','name','B1','source','FIXED_SINGLE','fixedUserIds',jsonb_build_array(pg_temp.uid('P1')),'sortOrder',1),
      jsonb_build_object('key','b2','name','B2','source','FIXED_SINGLE','fixedUserIds',jsonb_build_array(pg_temp.uid('P2')),'sortOrder',2)),
    'watcherUserIds', '[]'::jsonb,
    'printConfig', jsonb_build_object('browserPrintEnabled', true, 'docxStoragePath', null),
    'notificationConfig', '{}'::jsonb));
  v_pub := app_private.publish_request_template_version((v_draft->>'id')::uuid, (v_draft->>'updatedAt')::timestamptz);
  r := pg_temp.submit((v_pub->>'requestTemplateVersionId')::uuid, jsonb_build_object('extraApproverIds', jsonb_build_array(pg_temp.uid('E1'))));
  perform pg_temp.check(pg_temp.pending(r) = 'E1@__extra', 'S9 parallel: extra step first');
  perform pg_temp.act('E1', r, 'APPROVE');
  perform pg_temp.check(pg_temp.pending(r) = 'P1@b1,P2@b2', 'S9 parallel: all template blocks start together (' || pg_temp.pending(r) || ')');
  perform pg_temp.act('P2', r, 'APPROVE');
  perform pg_temp.check((select status from public.request_instances where id = r) = 'APPROVED', 'S9 parallel ANY_ONE: one template approval completes');
end $test$;
