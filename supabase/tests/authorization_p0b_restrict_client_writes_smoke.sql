-- Run after authorization_p0b_restrict_client_writes. Rolls back all writes.
begin;

create temporary table p0b_smoke_context (
  employee_id uuid not null,
  employee_auth_id uuid not null,
  employee_email text not null,
  admin_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  payer_id uuid,
  payer_auth_id uuid,
  payer_email text,
  advance_id uuid,
  broadcast_id uuid not null,
  template_id uuid
) on commit drop;
grant select on p0b_smoke_context to authenticated;

do $$
declare
  v_admin public.users%rowtype;
  v_candidate public.users%rowtype;
  v_employee public.users%rowtype;
  v_payer public.users%rowtype;
  v_advance public.advance_payments%rowtype;
  v_broadcast uuid;
  v_template uuid;
begin
  select * into v_admin from public.users
  where role = 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
  order by created_at, id limit 1;
  select * into v_advance from public.advance_payments order by created_at limit 1;
  select id into v_broadcast from public.notifications where user_id is null order by created_at desc limit 1;

  for v_candidate in
    select * from public.users
    where role <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null
    order by created_at, id
  loop
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', v_candidate.auth_id, 'email', v_candidate.email, 'role', 'authenticated')::text, true);
    if v_employee.id is null
      and not app_private.contract_data_actor_can_manage(null)
      and not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')
      and (v_advance.id is null or not app_private.project_finance_side_effect_actor(
        v_advance.project_id, v_advance.construction_site_id::text, false))
    then
      v_employee := v_candidate;
      select template_row.id into v_template from public.workflow_templates template_row
      where not app_private.workflow_template_actor_can_edit(template_row.id, v_candidate.id)
      order by template_row.created_at nulls last, template_row.id limit 1;
    end if;
    if v_payer.id is null and v_advance.id is not null
      and app_private.project_finance_side_effect_actor(v_advance.project_id, v_advance.construction_site_id::text, false)
    then
      v_payer := v_candidate;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);

  if v_admin.id is null or v_employee.id is null or v_broadcast is null then
    raise exception 'P0-B smoke personas are unavailable';
  end if;

  insert into p0b_smoke_context values (
    v_employee.id, v_employee.auth_id, v_employee.email,
    v_admin.id, v_admin.auth_id, v_admin.email,
    v_payer.id, v_payer.auth_id, v_payer.email,
    v_advance.id, v_broadcast, v_template
  );
end $$;

set local role authenticated;

-- Ordinary employee.
do $$
declare
  v_context p0b_smoke_context%rowtype;
  v_rows integer;
  v_blocked boolean;
  v_audit_user text;
  v_metadata jsonb;
  v_before public.notifications%rowtype;
  v_after public.notifications%rowtype;
begin
  select * into v_context from p0b_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.employee_auth_id, 'email', v_context.employee_email, 'role', 'authenticated')::text, true);
  if public.current_app_user_id() is distinct from v_context.employee_id then
    raise exception 'employee impersonation failed';
  end if;

  -- Logs record the real actor.
  insert into public.audit_trail (table_name, record_id, action, user_id, user_name)
  values ('p0b_smoke', 'p0b', 'INSERT', v_context.admin_id::text, 'forged')
  returning user_id into v_audit_user;
  if v_audit_user is distinct from v_context.employee_id::text then
    raise exception 'audit_trail kept a forged actor';
  end if;

  v_blocked := false;
  begin
    insert into public.request_logs (request_id, action, acted_by) values (gen_random_uuid(), 'forged', v_context.employee_id);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee wrote request_logs directly'; end if;

  -- Rows owned by others.
  update public.user_signatures set image_path = image_path where user_id <> v_context.employee_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee changed % signatures of others', v_rows; end if;

  v_blocked := false;
  begin
    insert into public.user_signatures (user_id, image_path) values (v_context.admin_id, 'signatures/forged.png');
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee created a signature for another user'; end if;

  v_blocked := false;
  begin
    insert into public.dashboard_layouts (user_id, name, layout) values (v_context.admin_id::text, 'p0b', '[]'::jsonb);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee created a dashboard layout for another user'; end if;
  insert into public.dashboard_layouts (user_id, name, layout) values (v_context.employee_id::text, 'p0b', '[]'::jsonb);

  update public.user_xp set total_xp = total_xp + 1000;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee changed XP'; end if;

  -- HR configuration.
  update public.salary_3p_settings set value = value;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee changed salary 3P settings'; end if;
  update public.kpi_rating_configs set coefficient = coefficient;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee changed KPI rating configs'; end if;
  update public.ranking_criteria set weight = weight;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee changed ranking criteria'; end if;

  -- Workflow.
  v_blocked := false;
  begin
    insert into public.workflow_step_tasks (instance_id, node_id, title, created_by) values (gen_random_uuid(), 'p0b', 'forged', v_context.employee_id);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee added a task to an unrelated workflow'; end if;

  if v_context.template_id is not null then
    v_blocked := false;
    begin
      insert into public.workflow_print_templates (template_id, name, file_name, storage_path)
      values (v_context.template_id, 'p0b', 'p0b.docx', v_context.template_id || '/p0b.docx');
    exception when insufficient_privilege then v_blocked := true;
    end;
    if not v_blocked then raise exception 'employee added a print template without edit rights'; end if;
  end if;

  -- Contracts and cost library.
  update public.contract_items set unit_price = unit_price;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee edited % contract items', v_rows; end if;
  update public.contract_machine_catalogs set name = name;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee edited the machine catalog'; end if;
  update public.contract_appendices set note = note;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee edited contract appendices'; end if;

  -- Project finance is Admin only.
  update public.advance_payments set note = note;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee edited advance payments'; end if;
  update public.project_cost_items set budget_amount = budget_amount;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'employee edited project cost items'; end if;
  v_blocked := false;
  begin
    insert into public.project_dashboard_snapshots (scope_key, metrics, calculated_at) values ('p0b-smoke', '{}'::jsonb, now());
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee wrote a dashboard snapshot'; end if;

  -- Notifications.
  v_blocked := false;
  begin
    insert into public.notifications (user_id, type, category, title, message, severity, link, push_enabled)
    values (v_context.admin_id::text, 'info', 'system', 'p0b', 'p0b', 'info', 'https://example.invalid/login', false);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee sent a notification with an external link'; end if;

  v_blocked := false;
  begin
    insert into public.notifications (user_id, type, category, title, message, severity, link, push_enabled)
    values (null, 'info', 'system', 'p0b', 'p0b', 'info', '/', false);
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'employee sent a broadcast notification'; end if;

  -- Senders cannot read other people's notifications, so the frontend inserts
  -- without RETURNING; check the stamp on a notification to self.
  insert into public.notifications (user_id, type, category, title, message, severity, link, push_enabled)
  values (v_context.admin_id::text, 'info', 'system', 'p0b', 'p0b', 'info', '/da', false);
  insert into public.notifications (user_id, type, category, title, message, severity, link, push_enabled, metadata)
  values (v_context.employee_id::text, 'info', 'system', 'p0b', 'p0b', 'info', '/da', false, '{"sentByUserId":"forged"}'::jsonb)
  returning metadata into v_metadata;
  if v_metadata ->> 'sentByUserId' is distinct from v_context.employee_id::text then
    raise exception 'notification sender was not stamped';
  end if;

  select * into v_before from public.notifications where id = v_context.broadcast_id;
  update public.notifications set is_read = true, is_dismissed = true where id = v_context.broadcast_id;
  if public.mark_my_notifications('dismiss', array[v_context.broadcast_id]) < 1 then
    raise exception 'mark_my_notifications did not record the broadcast receipt';
  end if;
  if not exists (
    select 1 from public.notification_broadcast_receipts
    where notification_id = v_context.broadcast_id and user_id = v_context.employee_id
      and read_at is not null and dismissed_at is not null
  ) then
    raise exception 'broadcast receipt missing';
  end if;
  perform public.mark_my_notifications('read', null);
end $$;

-- Payment confirmer may record recovery, nothing else.
do $$
declare
  v_context p0b_smoke_context%rowtype;
  v_rows integer;
  v_blocked boolean;
begin
  select * into v_context from p0b_smoke_context;
  if v_context.payer_id is null or v_context.advance_id is null then return; end if;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.payer_auth_id, 'email', v_context.payer_email, 'role', 'authenticated')::text, true);

  update public.advance_payments set recovered_amount = recovered_amount, remaining_amount = remaining_amount
  where id = v_context.advance_id;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'payment confirmer could not record recovery'; end if;

  v_blocked := false;
  begin
    update public.advance_payments set amount = amount + 1 where id = v_context.advance_id;
  exception when insufficient_privilege then v_blocked := true;
  end;
  if not v_blocked then raise exception 'payment confirmer changed the advance amount'; end if;
end $$;

-- System Admin keeps full write access.
do $$
declare
  v_context p0b_smoke_context%rowtype;
  v_rows integer;
begin
  select * into v_context from p0b_smoke_context;
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_context.admin_auth_id, 'email', v_context.admin_email, 'role', 'authenticated')::text, true);
  if not public.is_admin() then raise exception 'admin impersonation failed'; end if;

  update public.project_cost_items set budget_amount = budget_amount;
  get diagnostics v_rows = row_count;
  if v_rows = 0 and exists (select 1 from public.project_cost_items) then
    raise exception 'admin could not edit project cost items';
  end if;
  insert into public.project_dashboard_snapshots (scope_key, metrics, calculated_at) values ('p0b-smoke', '{}'::jsonb, now());
  update public.salary_3p_settings set value = value;
  insert into public.contract_machine_catalogs (code, name) values ('P0B-SMOKE', 'p0b');
  insert into public.notifications (user_id, type, category, title, message, severity, link, push_enabled)
  values (null, 'info', 'system', 'p0b', 'p0b', 'info', '/', false);
end $$;

reset role;
rollback;
