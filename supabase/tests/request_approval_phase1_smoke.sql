-- Request Phase 1 end-to-end smoke.  This is deliberately transaction-only:
-- no fixture survives a local reset or a linked branch smoke run.
begin;

do $smoke$
declare
  v_admin uuid;
  v_users uuid[];
  v_creator uuid;
  v_manager uuid;
  v_director_a uuid;
  v_director_b uuid;
  v_outsider uuid;
  v_admin_auth_id uuid;
  v_manager_auth_id uuid;
  v_director_a_auth_id uuid;
  v_director_b_auth_id uuid;
  v_outsider_auth_id uuid;
  v_template uuid;
  v_version uuid;
  v_request uuid;
  v_parallel_template uuid;
  v_parallel_version uuid;
  v_parallel_request uuid;
  v_reject_template uuid;
  v_reject_version uuid;
  v_reject_request uuid;
  v_result jsonb;
  v_replay jsonb;
  v_first_updated_at timestamptz;
  v_updated_at timestamptz;
  v_code text;
  v_idempotency text := gen_random_uuid()::text;
  v_parallel_key text := gen_random_uuid()::text;
  v_reject_key text := gen_random_uuid()::text;
  v_round_count integer;
begin
  select u.id into v_admin
  from public.users u
  where coalesce(u.is_active, true)
    and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
    and u.role::text = 'ADMIN'
  order by u.created_at
  limit 1;

  select array_agg(u.id order by u.created_at)
    into v_users
  from (
    select u.id, u.created_at
    from public.users u
    where coalesce(u.is_active, true)
      and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
      and u.id <> v_admin
    order by u.created_at
    limit 4
  ) u;
  if v_admin is null or coalesce(cardinality(v_users), 0) < 4 then
    raise exception 'request smoke requires an active admin and four active users';
  end if;
  v_creator := v_admin;
  v_manager := v_users[1];
  v_director_a := v_users[2];
  v_director_b := v_users[3];
  v_outsider := v_users[4];

  select auth_id into v_admin_auth_id from public.users where id = v_admin;
  select auth_id into v_manager_auth_id from public.users where id = v_manager;
  select auth_id into v_director_a_auth_id from public.users where id = v_director_a;
  select auth_id into v_director_b_auth_id from public.users where id = v_director_b;
  select auth_id into v_outsider_auth_id from public.users where id = v_outsider;
  if v_admin_auth_id is null or v_manager_auth_id is null or v_director_a_auth_id is null
     or v_director_b_auth_id is null or v_outsider_auth_id is null then
    raise exception 'request smoke requires auth_id for every selected active user';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );

  -- Sequential ALL: manager -> two directors.  The same idempotency key must
  -- replay the original command without creating another request/code.
  v_template := gen_random_uuid();
  insert into public.request_templates(id, name, description, created_by)
  values (v_template, 'Smoke sequential request', 'request phase 1', v_admin);
  insert into public.request_template_versions(
    id, request_template_id, version_number, form_schema, usage_scope,
    flow_mode, completion_policy, status, created_by
  ) values (
    gen_random_uuid(), v_template, 1,
    '[{"key":"purpose","label":"Purpose","fieldType":"text","required":false}]'::jsonb,
    jsonb_build_object('companyWide', true, 'departmentIds', '[]'::jsonb,
      'orgUnitIds', '[]'::jsonb, 'permissionCodes', '[]'::jsonb, 'userIds', '[]'::jsonb),
    'SEQUENTIAL', 'ALL', 'DRAFT', v_admin
  ) returning id into v_version;
  insert into public.request_approval_blocks(
    request_template_version_id, block_key, name, sort_order,
    approver_source, fixed_user_ids
  ) values
    (v_version, 'manager', 'Manager', 0, 'FIXED_SINGLE', array[v_manager]),
    (v_version, 'directors', 'Directors', 1, 'FIXED_MULTI', array[v_director_a, v_director_b]);
  update public.request_templates set current_version_id = null where id = v_template;
  perform public.publish_request_template_version(v_template, (select updated_at from public.request_templates where id = v_template));

  v_result := public.submit_request(
    v_version,
    'Sequential smoke request',
    'Smoke body',
    '{}'::jsonb,
    '{}'::jsonb,
    v_idempotency
  );
  v_request := (v_result ->> 'requestId')::uuid;
  v_code := v_result ->> 'requestCode';
  v_first_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  if v_result ->> 'status' <> 'PENDING' or v_code !~ '^RQ-[0-9]{4}-[0-9]{6}$' then
    raise exception 'sequential submit did not create a pending request code: %', v_result;
  end if;
  v_replay := public.submit_request(v_version, 'Sequential smoke request', 'Smoke body', '{}'::jsonb, '{}'::jsonb, v_idempotency);
  if v_replay ->> 'requestId' <> v_request::text or v_replay ->> 'requestCode' <> v_code then
    raise exception 'idempotency replay created a different request: %', v_replay;
  end if;

  perform set_config('request.jwt.claim.sub', v_manager_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_manager_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_request, 'APPROVE', 'Manager approved', null, null, gen_random_uuid()::text, v_first_updated_at);
  v_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  if not exists (
    select 1 from public.workflow_step_assignments assignment
    where assignment.workflow_subject_id = (select workflow_subject_id from public.request_instances where id = v_request)
      and assignment.assignee_user_id = v_director_a and assignment.status = 'PENDING'
  ) then
    raise exception 'sequential approval did not activate the director block';
  end if;

  perform set_config('request.jwt.claim.sub', v_director_a_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_director_a_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_request, 'RETURN', 'Please revise', null, null, gen_random_uuid()::text, v_updated_at);
  v_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_request, 'RESUBMIT', 'Resubmitted', '{}'::jsonb, null, gen_random_uuid()::text, v_updated_at);
  v_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  select count(distinct assignment.assignment_round_id)::integer into v_round_count
  from public.workflow_step_assignments assignment
  where assignment.workflow_subject_id = (select workflow_subject_id from public.request_instances where id = v_request);
  if v_round_count < 2 then
    raise exception 'resubmit did not create a new assignment round';
  end if;

  perform set_config('request.jwt.claim.sub', v_director_a_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_director_a_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_request, 'APPROVE', 'Director A approved', null, null, gen_random_uuid()::text, v_updated_at);
  v_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  perform set_config('request.jwt.claim.sub', v_director_b_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_director_b_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_request, 'APPROVE', 'Director B approved', null, null, gen_random_uuid()::text, v_updated_at);
  if v_result ->> 'status' <> 'APPROVED' then
    raise exception 'sequential ALL request did not finish after both directors: %', v_result;
  end if;

  -- Parallel ANY_ONE: one approval completes the request and skips the other.
  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text, true);
  v_parallel_template := gen_random_uuid();
  insert into public.request_templates(id, name, created_by)
  values (v_parallel_template, 'Smoke parallel request', v_admin);
  insert into public.request_template_versions(
    id, request_template_id, version_number, form_schema, usage_scope,
    flow_mode, completion_policy, status, created_by
  ) values (
    gen_random_uuid(), v_parallel_template, 1,
    '[{"key":"purpose","label":"Purpose","fieldType":"text","required":false}]'::jsonb,
    jsonb_build_object('companyWide', true), 'PARALLEL', 'ANY_ONE', 'DRAFT', v_admin
  ) returning id into v_parallel_version;
  insert into public.request_approval_blocks(request_template_version_id, block_key, name, sort_order, approver_source, fixed_user_ids)
  values (v_parallel_version, 'parallel', 'Parallel', 0, 'FIXED_MULTI', array[v_manager, v_director_a]);
  perform public.publish_request_template_version(v_parallel_template, (select updated_at from public.request_templates where id = v_parallel_template));
  v_result := public.submit_request(v_parallel_version, 'Parallel smoke request', '', '{}'::jsonb, '{}'::jsonb, v_parallel_key);
  v_parallel_request := (v_result ->> 'requestId')::uuid;
  v_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  perform set_config('request.jwt.claim.sub', v_manager_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_manager_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_parallel_request, 'APPROVE', 'One is enough', null, null, gen_random_uuid()::text, v_updated_at);
  if v_result ->> 'status' <> 'APPROVED'
     or not exists (
       select 1 from public.workflow_step_assignments assignment
       where assignment.workflow_subject_id = (select workflow_subject_id from public.request_instances where id = v_parallel_request)
         and assignment.assignee_user_id = v_director_a and assignment.status = 'SKIPPED'
     ) then
    raise exception 'parallel ANY_ONE did not approve/skip pending assignments: %', v_result;
  end if;

  -- Reject is terminal and cancels every remaining pending assignment.
  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text, true);
  v_reject_template := gen_random_uuid();
  insert into public.request_templates(id, name, created_by)
  values (v_reject_template, 'Smoke reject request', v_admin);
  insert into public.request_template_versions(id, request_template_id, version_number, form_schema, usage_scope, flow_mode, completion_policy, status, created_by)
  values (
    gen_random_uuid(), v_reject_template, 1,
    '[{"key":"purpose","label":"Purpose","fieldType":"text","required":false}]'::jsonb,
    jsonb_build_object('companyWide', true), 'SEQUENTIAL', 'ALL', 'DRAFT', v_admin
  )
  returning id into v_reject_version;
  insert into public.request_approval_blocks(request_template_version_id, block_key, name, sort_order, approver_source, fixed_user_ids)
  values
    (v_reject_version, 'reject-first', 'Reject first', 0, 'FIXED_SINGLE', array[v_manager]),
    (v_reject_version, 'reject-second', 'Reject second', 1, 'FIXED_SINGLE', array[v_director_b]);
  perform public.publish_request_template_version(v_reject_template, (select updated_at from public.request_templates where id = v_reject_template));
  v_result := public.submit_request(v_reject_version, 'Reject smoke request', '', '{}'::jsonb, '{}'::jsonb, v_reject_key);
  v_reject_request := (v_result ->> 'requestId')::uuid;
  v_updated_at := (v_result ->> 'updatedAt')::timestamptz;
  perform set_config('request.jwt.claim.sub', v_manager_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_manager_auth_id, 'role', 'authenticated')::text, true);
  v_result := public.act_on_request(v_reject_request, 'REJECT', 'Rejected by smoke', null, null, gen_random_uuid()::text, v_updated_at);
  if v_result ->> 'status' <> 'REJECTED'
     or exists (
       select 1 from public.workflow_step_assignments assignment
       where assignment.workflow_subject_id = (select workflow_subject_id from public.request_instances where id = v_reject_request)
         and assignment.status = 'PENDING'
     ) then
    raise exception 'reject did not terminate/cancel pending assignments: %', v_result;
  end if;

  -- Visibility is checked inside the RPC, not by trusting a client filter.
  perform set_config('request.jwt.claim.sub', v_outsider_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_outsider_auth_id, 'role', 'authenticated')::text, true);
  if public.get_request_detail(v_request) is not null then
    raise exception 'outsider unexpectedly received request detail';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text, true);
  if not (public.get_request_summary() ? 'all') then
    raise exception 'request summary did not return aggregate counters';
  end if;
end;
$smoke$;

rollback;
