begin;

do $smoke$
declare
  v_admin_id uuid;
  v_admin_auth_id uuid;
  v_user_a_id uuid;
  v_user_a_auth_id uuid;
  v_user_b_id uuid;
  v_user_b_auth_id uuid;
  v_project_id text;
  v_warehouse_id text;
  v_item_id text;
  v_template_id uuid := gen_random_uuid();
  v_start_node_id uuid := gen_random_uuid();
  v_review_node_id uuid := gen_random_uuid();
  v_end_node_id uuid := gen_random_uuid();
  v_request_id text := 'smoke-mr-' || gen_random_uuid()::text;
  v_request_code text := 'SMOKE-MR-' || left(gen_random_uuid()::text, 8);
  v_site_id text := 'smoke-site-' || gen_random_uuid()::text;
  v_issue_transaction_id text := 'tx-smoke-issue-' || gen_random_uuid()::text;
  v_return_transaction_id text := 'tx-smoke-return-' || gen_random_uuid()::text;
  v_batch_id uuid := gen_random_uuid();
  v_subject public.workflow_subjects%rowtype;
  v_board jsonb;
  v_board_card jsonb;
  v_instance_template_id uuid;
  v_configuration jsonb;
  v_dependency jsonb;
  v_denied boolean;
  v_sla_assignment_id uuid;
begin
  if pg_catalog.has_function_privilege(
    'anon',
    'public.get_material_request_workflow_board(text,text,jsonb,integer,text)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'anon',
    'public.get_project_material_request_board(text,text,jsonb,integer,text)',
    'EXECUTE'
  ) then
    raise exception 'anon unexpectedly has execute access to a material request board RPC';
  end if;

  if exists (
    select 1
    from (
      values
        ('public.get_material_request_workflow_board(text,text,jsonb,integer,text)'::regprocedure),
        ('public.get_project_material_request_board(text,text,jsonb,integer,text)'::regprocedure)
    ) as target(function_oid)
    join pg_catalog.pg_proc function_definition
      on function_definition.oid = target.function_oid
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        function_definition.proacl,
        pg_catalog.acldefault('f', function_definition.proowner)
      )
    ) function_privilege
    where function_privilege.grantee = 0
      and function_privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC unexpectedly has execute access to a material request board RPC';
  end if;

  if not (
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_material_request_workflow_board(text,text,jsonb,integer,text)',
      'EXECUTE'
    ) and pg_catalog.has_function_privilege(
      'authenticated',
      'public.get_project_material_request_board(text,text,jsonb,integer,text)',
      'EXECUTE'
    )
  ) then
    raise exception 'authenticated is missing execute access to a material request board RPC';
  end if;

  if not (
    pg_catalog.has_function_privilege(
      'service_role',
      'public.get_material_request_workflow_board(text,text,jsonb,integer,text)',
      'EXECUTE'
    ) and pg_catalog.has_function_privilege(
      'service_role',
      'public.get_project_material_request_board(text,text,jsonb,integer,text)',
      'EXECUTE'
    )
  ) then
    raise exception 'service_role is missing execute access to a material request board RPC';
  end if;

  select u.id, u.auth_id
    into v_admin_id, v_admin_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.role::text = 'ADMIN'
  order by u.created_at
  limit 1;

  select u.id, u.auth_id
    into v_user_a_id, v_user_a_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.id <> v_admin_id
  order by u.created_at
  limit 1;

  select u.id, u.auth_id
    into v_user_b_id, v_user_b_auth_id
  from public.users u
  where u.auth_id is not null
    and coalesce(u.is_active, true)
    and u.id not in (v_admin_id, v_user_a_id)
  order by u.created_at
  limit 1;

  select p.id::text into v_project_id from public.projects p order by p.created_at limit 1;
  select w.id::text into v_warehouse_id from public.warehouses w order by w.created_at limit 1;
  select i.id::text into v_item_id from public.items i order by i.created_at limit 1;

  if v_admin_id is null or v_user_a_id is null or v_user_b_id is null
     or v_project_id is null or v_warehouse_id is null or v_item_id is null then
    raise exception 'smoke prerequisites are missing';
  end if;

  insert into public.workflow_templates(
    id, name, description, created_by, is_active, managers, default_watchers
  )
  values (
    v_template_id, 'Smoke Project Workflow', 'Transaction-only smoke test',
    v_admin_id, true, array[v_admin_id::text], array[v_user_b_id::text]
  );

  insert into public.workflow_nodes(id, template_id, type, label, config, position_x, position_y)
  values
    (v_start_node_id, v_template_id, 'START', 'Start', '{}'::jsonb, 0, 0),
    (
      v_review_node_id, v_template_id, 'APPROVAL', 'Smoke Review',
      jsonb_build_object(
        'approvalPolicy', 'ANY_ONE',
        'assignmentMode', 'select_on_submit',
        'assignmentTargets', jsonb_build_array(
          jsonb_build_object('type', 'user', 'userId', v_user_a_id),
          jsonb_build_object('type', 'user', 'userId', v_user_b_id)
        ),
        'stepWatcherTargets', jsonb_build_array(
          jsonb_build_object('type', 'user', 'userId', v_user_b_id)
        ),
        'allowReject', true,
        'allowReassign', true,
        'slaHours', 4
      ),
      0, 100
    ),
    (v_end_node_id, v_template_id, 'END', 'End', '{}'::jsonb, 0, 200);

  insert into public.workflow_edges(template_id, source_node_id, target_node_id, label)
  values
    (v_template_id, v_start_node_id, v_review_node_id, ''),
    (v_template_id, v_review_node_id, v_end_node_id, '');

  insert into public.project_workflow_bindings(
    subject_type, project_id, construction_site_id, workflow_template_id,
    is_default, is_active, created_by
  )
  values (
    'material_request', v_project_id, v_site_id, v_template_id,
    true, true, v_admin_id
  );

  insert into public.requests(
    id, code, site_warehouse_id, requester_id, status, items,
    created_date, expected_date, project_id, construction_site_id,
    request_origin, workflow_step
  )
  values (
    v_request_id, v_request_code, v_warehouse_id, v_admin_id, 'DRAFT', '[]'::jsonb,
    now(), now() + interval '1 day', v_project_id, v_site_id,
    'project', 'draft'
  );

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );

  v_configuration := public.get_project_workflow_configuration(
    'material_request', v_project_id, v_site_id
  );
  if not coalesce((v_configuration ->> 'valid')::boolean, false)
     or v_configuration ->> 'scope' <> 'site'
     or v_configuration -> 'binding' ->> 'workflow_template_id' <> v_template_id::text then
    raise exception 'site workflow binding did not resolve as the effective valid binding: %', v_configuration;
  end if;

  select * into v_subject
  from public.start_project_workflow_v2(
    'material_request', v_request_id, v_template_id,
    array[v_user_a_id, v_user_b_id], 'Smoke submit'
  );

  if v_subject.status <> 'RUNNING'
     or cardinality(v_subject.current_assignee_user_ids) <> 2
     or v_subject.current_instance_node_id is null then
    raise exception 'start workflow did not create the expected assignment pool/runtime node';
  end if;

  update public.requests
  set workflow_template_id = null
  where id = v_request_id;

  v_board := public.get_project_material_request_board(
    v_project_id,
    v_site_id,
    jsonb_build_object('search', v_request_id),
    10,
    null
  );

  select card.value
  into v_board_card
  from jsonb_array_elements(coalesce(v_board -> 'cards', '[]'::jsonb)) card(value)
  where card.value ->> 'id' = v_request_id
  limit 1;

  if v_board_card is null then
    raise exception 'workflow board omitted the material request after clearing its request template field: %', v_board;
  end if;

  select workflow_instance.template_id
  into v_instance_template_id
  from public.workflow_instances workflow_instance
  where workflow_instance.id = v_subject.workflow_instance_id;

  if v_instance_template_id is null
     or (v_board_card #>> '{subject,workflowTemplateId}') is distinct from v_instance_template_id::text then
    raise exception 'workflow board did not use the workflow instance template: %', v_board_card;
  end if;

  update public.requests
  set workflow_template_id = v_template_id
  where id = v_request_id;

  if not exists (
    select 1
    from public.workflow_step_assignments wsa
    where wsa.workflow_subject_id = v_subject.id
      and wsa.status = 'PENDING'
      and wsa.due_at is not null
    group by wsa.workflow_subject_id
    having count(*) = 2
  ) then
    raise exception 'start workflow did not create two SLA assignments';
  end if;

  select wsa.id into v_sla_assignment_id
  from public.workflow_step_assignments wsa
  where wsa.workflow_subject_id = v_subject.id
    and wsa.assignee_user_id = v_user_a_id
    and wsa.status = 'PENDING'
  limit 1;

  update public.workflow_step_assignments
  set assigned_at = now() - interval '2 hours',
      due_at = now() - interval '1 hour'
  where id = v_sla_assignment_id;

  perform public.process_project_workflow_sla_reminders();
  perform public.process_project_workflow_sla_reminders();

  if (
    select count(*)
    from public.workflow_sla_notifications notification
    where notification.workflow_step_assignment_id = v_sla_assignment_id
      and notification.notification_kind = 'OVERDUE'
  ) <> 1 then
    raise exception 'SLA reminder dedupe did not keep exactly one overdue notification';
  end if;

  if not exists (
    select 1 from public.workflow_participants wp
    where wp.workflow_subject_id = v_subject.id
      and wp.user_id = v_admin_id
      and wp.role = 'ADMIN'
  ) or not exists (
    select 1 from public.workflow_participants wp
    where wp.workflow_subject_id = v_subject.id
      and wp.user_id = v_user_b_id
      and wp.role = 'WATCHER'
  ) then
    raise exception 'template manager/default watcher participants were not snapshotted';
  end if;

  update public.workflow_nodes
  set label = 'Changed Live Template', config = '{}'::jsonb
  where id = v_review_node_id;

  if not exists (
    select 1 from public.workflow_instance_nodes win
    where win.id = v_subject.current_instance_node_id
      and win.label = 'Smoke Review'
      and win.config ->> 'slaHours' = '4'
  ) then
    raise exception 'runtime snapshot changed after live template edit';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_a_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_a_auth_id, 'role', 'authenticated')::text,
    true
  );
  select * into v_subject
  from public.advance_project_workflow_v2('material_request', v_request_id, '{}'::uuid[], 'Smoke approve');

  if v_subject.status <> 'COMPLETED'
     or not exists (
       select 1 from public.workflow_step_assignments wsa
       where wsa.workflow_subject_id = v_subject.id
         and wsa.assignee_user_id = v_user_a_id
         and wsa.status = 'APPROVED'
     )
     or not exists (
       select 1 from public.workflow_step_assignments wsa
       where wsa.workflow_subject_id = v_subject.id
         and wsa.assignee_user_id = v_user_b_id
         and wsa.status = 'SKIPPED'
     ) then
    raise exception 'ANY_ONE approval did not approve one and skip the remaining assignee';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );

  insert into public.project_document_links(
    source_type, source_id, target_type, target_id, project_id,
    relation_type, status, metadata
  )
  values (
    'material_request', v_request_id, 'smoke_document', gen_random_uuid()::text,
    v_project_id, 'downstream', 'active', jsonb_build_object('smoke', true)
  );

  v_dependency := public.get_project_workflow_rollback_dependencies('material_request', v_request_id);
  if coalesce((v_dependency ->> 'allowed')::boolean, true) then
    raise exception 'active dependency did not lock rollback';
  end if;

  v_denied := false;
  begin
    perform public.rollback_completed_project_workflow('material_request', v_request_id, 'Must be locked');
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'rollback unexpectedly succeeded with an active dependency';
  end if;

  update public.project_document_links
  set status = 'reversed'
  where source_type = 'material_request'
    and source_id = v_request_id
    and target_type = 'smoke_document';

  insert into public.transactions(
    id, type, date, items, source_warehouse_id, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id
  )
  values (
    v_issue_transaction_id, 'TRANSFER', now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id, 'quantity', 2,
      'materialRequestId', v_request_id, 'requestLineId', 'smoke-line-1'
    )),
    v_warehouse_id, v_warehouse_id, v_admin_id, v_admin_id, 'COMPLETED',
    'Smoke completed issue transaction', v_request_id
  );

  insert into public.material_request_fulfillment_batches(
    id, project_id, construction_site_id, material_request_id, batch_no,
    source_warehouse_id, target_warehouse_id, fulfillment_mode, source_type,
    status, transaction_id, created_by, note
  )
  values (
    v_batch_id, v_project_id, v_site_id, v_request_id, 'SMOKE-BATCH-1',
    v_warehouse_id, v_warehouse_id, 'RECEIVE_TO_STOCK', 'stock',
    'returned', v_issue_transaction_id, v_admin_id, null
  );

  insert into public.material_request_fulfillment_lines(
    batch_id, material_request_id, request_line_id, item_id,
    issued_qty, received_qty
  )
  values (v_batch_id, v_request_id, 'smoke-line-1', v_item_id, 3, 2);

  v_dependency := public.get_project_workflow_rollback_dependencies('material_request', v_request_id);
  if coalesce((v_dependency ->> 'allowed')::boolean, true)
     or coalesce((v_dependency ->> 'activeCount')::integer, 0) <> 2 then
    raise exception 'completed stock transaction without a full return did not lock rollback once per dependency: %', v_dependency;
  end if;

  insert into public.transactions(
    id, type, date, items, target_warehouse_id,
    requester_id, approver_id, status, note, related_request_id
  )
  values (
    v_return_transaction_id, 'IMPORT', now(),
    jsonb_build_array(jsonb_build_object(
      'itemId', v_item_id, 'quantity', 2,
      'materialRequestId', v_request_id, 'requestLineId', 'smoke-line-1'
    )),
    v_warehouse_id, v_admin_id, v_admin_id, 'COMPLETED',
    'Smoke full return transaction', v_request_id
  );

  update public.material_request_fulfillment_batches
  set note = 'Phiếu hoàn kho: ' || v_return_transaction_id
  where id = v_batch_id;

  v_dependency := public.get_project_workflow_rollback_dependencies('material_request', v_request_id);
  if not coalesce((v_dependency ->> 'allowed')::boolean, false) then
    raise exception 'fully reversed dependencies did not unlock rollback: %', v_dependency;
  end if;

  select * into v_subject
  from public.rollback_completed_project_workflow('material_request', v_request_id, 'Smoke rollback');

  if v_subject.status <> 'RUNNING'
     or cardinality(v_subject.current_assignee_user_ids) <> 2 then
    raise exception 'rollback did not restore the last approval pool';
  end if;

  v_denied := false;
  begin
    perform public.advance_project_workflow_v2('material_request', v_request_id, '{}'::uuid[], 'Admin must not approve');
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'workflow admin unexpectedly approved without a pending assignment';
  end if;

  select * into v_subject
  from public.reassign_project_workflow_v2(
    'material_request', v_request_id, array[v_user_a_id], 'Admin reassign'
  );
  if cardinality(v_subject.current_assignee_user_ids) <> 1
     or v_subject.current_assignee_user_ids[1] <> v_user_a_id then
    raise exception 'workflow admin reassign failed';
  end if;

  v_denied := false;
  begin
    perform public.return_project_workflow_v2('material_request', v_request_id, 'Admin must not return');
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'workflow admin unexpectedly returned without a pending assignment';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_a_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_a_auth_id, 'role', 'authenticated')::text,
    true
  );
  select * into v_subject
  from public.return_project_workflow_v2('material_request', v_request_id, 'Need revision');
  if v_subject.status <> 'RETURNED' then
    raise exception 'assigned user could not return workflow';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_b_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_b_auth_id, 'role', 'authenticated')::text,
    true
  );
  v_denied := false;
  begin
    perform public.resubmit_project_workflow_v2(
      'material_request', v_request_id, null::uuid[], 'Non-requester must not resubmit'
    );
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'non-requester unexpectedly resubmitted workflow';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_admin_auth_id, 'role', 'authenticated')::text,
    true
  );
  select * into v_subject
  from public.resubmit_project_workflow_v2(
    'material_request', v_request_id, null::uuid[], 'Requester resubmit'
  );
  if v_subject.status <> 'RUNNING'
     or cardinality(v_subject.current_assignee_user_ids) <> 1
     or v_subject.current_assignee_user_ids[1] <> v_user_a_id then
    raise exception 'requester resubmit did not restore the returned assignment pool';
  end if;

  v_denied := false;
  begin
    perform public.reject_project_workflow('material_request', v_request_id, 'Admin must not reject');
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'workflow admin unexpectedly rejected without a pending assignment';
  end if;

  perform set_config('request.jwt.claim.sub', v_user_a_auth_id::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_user_a_auth_id, 'role', 'authenticated')::text,
    true
  );
  select * into v_subject
  from public.reject_project_workflow('material_request', v_request_id, 'Smoke reject');
  if v_subject.status <> 'REJECTED' then
    raise exception 'assigned user could not reject workflow';
  end if;

  raise notice 'project workflow phase 3-5 smoke test passed';
end;
$smoke$;

rollback;
