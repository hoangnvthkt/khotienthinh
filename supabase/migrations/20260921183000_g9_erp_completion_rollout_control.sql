-- G9: fail-closed, expiring rollout control for the human G4-G7 commands.
-- This migration intentionally seeds no cohort. Reads remain available under
-- their existing RLS; command creation is enabled only by an audited rollout.

create or replace function app_private.erp_completion_command_is_known(p_command text)
returns boolean language sql immutable set search_path = '' as $$
  select p_command = any(array[
    'material_plan.save','material_plan.convert','procurement.assign',
    'procurement.allocate','procurement.po.create','wms.transfer.dispatch',
    'wms.transfer.receive','wms.transfer.dispose','wms.inventory_count.start',
    'wms.inventory_count.post','finance.invoice.record','finance.invoice.reverse',
    'finance.payment.post','finance.payment.reverse'
  ]::text[]);
$$;
revoke all on function app_private.erp_completion_command_is_known(text) from public, anon, authenticated;

create or replace function app_private.erp_completion_command_is_known_all(p_commands text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(bool_and(app_private.erp_completion_command_is_known(command)), true)
  from unnest(coalesce(p_commands, '{}'::text[])) command;
$$;
revoke all on function app_private.erp_completion_command_is_known_all(text[]) from public, anon, authenticated;

create table app_private.erp_completion_rollout_scopes (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null unique check (btrim(scope_key) <> ''),
  project_id text,
  construction_site_id text,
  warehouse_ids text[] not null default '{}'::text[],
  supplier_ids text[] not null default '{}'::text[],
  mode text not null default 'read_only' check (mode in ('read_only','pilot','paused')),
  enabled_commands text[] not null default '{}'::text[],
  completion_commands text[] not null default '{}'::text[],
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  release_id text not null check (btrim(release_id) <> ''),
  owner text not null check (btrim(owner) <> ''),
  support_owner text not null check (btrim(support_owner) <> ''),
  reason text not null check (btrim(reason) <> ''),
  row_version bigint not null default 1 check (row_version > 0),
  created_by uuid references public.users(id) on delete restrict,
  updated_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at),
  check (project_id is not null or construction_site_id is not null
    or cardinality(warehouse_ids) > 0 or cardinality(supplier_ids) > 0),
  check (completion_commands <@ enabled_commands),
  check (app_private.erp_completion_command_is_known_all(enabled_commands)),
  check (app_private.erp_completion_command_is_known_all(completion_commands))
);

create table app_private.erp_completion_rollout_actors (
  scope_id uuid not null references app_private.erp_completion_rollout_scopes(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  persona text not null check (persona in ('buyer','qs','warehouse','qc','accountant','manager')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope_id, user_id, persona),
  unique (scope_id, user_id)
);

create table app_private.erp_completion_rollout_audit (
  id bigint generated always as identity primary key,
  scope_id uuid,
  table_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  before_row jsonb,
  after_row jsonb,
  reason text not null check (btrim(reason) <> ''),
  actor_user_id uuid,
  database_user text not null,
  created_at timestamptz not null default statement_timestamp()
);

create index erp_completion_rollout_scopes_created_by_idx
  on app_private.erp_completion_rollout_scopes(created_by);
create index erp_completion_rollout_scopes_updated_by_idx
  on app_private.erp_completion_rollout_scopes(updated_by);
create index erp_completion_rollout_scopes_active_window_idx
  on app_private.erp_completion_rollout_scopes(mode,starts_at,expires_at);
create index erp_completion_rollout_actors_user_active_idx
  on app_private.erp_completion_rollout_actors(user_id,active,scope_id);
create index erp_completion_rollout_audit_scope_created_idx
  on app_private.erp_completion_rollout_audit(scope_id,created_at desc);

revoke all on app_private.erp_completion_rollout_scopes from public, anon, authenticated;
revoke all on app_private.erp_completion_rollout_actors from public, anon, authenticated;
revoke all on app_private.erp_completion_rollout_audit from public, anon, authenticated;
grant all on app_private.erp_completion_rollout_scopes to service_role;
grant all on app_private.erp_completion_rollout_actors to service_role;
grant select on app_private.erp_completion_rollout_audit to service_role;

create or replace function app_private.audit_erp_completion_rollout_change_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(btrim(current_setting('app.erp_completion_rollout_reason', true)), '');
  v_before jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_scope_id uuid := coalesce(
    v_after ->> 'id', v_before ->> 'id',
    v_after ->> 'scope_id', v_before ->> 'scope_id'
  )::uuid;
begin
  if v_reason is null then
    raise exception using errcode = '22023', message = 'ERP_COMPLETION_ROLLOUT_REASON_REQUIRED';
  end if;
  insert into app_private.erp_completion_rollout_audit(
    scope_id, table_name, operation, before_row, after_row, reason,
    actor_user_id, database_user
  ) values (
    v_scope_id, tg_table_name, tg_op, v_before, v_after, v_reason,
    public.current_app_user_id(), session_user
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.audit_erp_completion_rollout_change_v1() from public, anon, authenticated;

create trigger trg_erp_completion_rollout_scopes_audit
after insert or update or delete on app_private.erp_completion_rollout_scopes
for each row execute function app_private.audit_erp_completion_rollout_change_v1();
create trigger trg_erp_completion_rollout_actors_audit
after insert or update or delete on app_private.erp_completion_rollout_actors
for each row execute function app_private.audit_erp_completion_rollout_change_v1();

create or replace function app_private.assert_erp_completion_rollout_command_v1(
  p_command text,
  p_project_id text default null,
  p_construction_site_id text default null,
  p_warehouse_id text default null,
  p_supplier_id text default null
) returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  scope app_private.erp_completion_rollout_scopes%rowtype;
begin
  if v_actor is null or not app_private.erp_completion_command_is_known(p_command) then
    raise exception using errcode = '42501', message = 'ERP_COMPLETION_PILOT_COMMAND_DISABLED';
  end if;
  for scope in
    select rollout.*
    from app_private.erp_completion_rollout_scopes rollout
    join app_private.erp_completion_rollout_actors actor on actor.scope_id = rollout.id
    where actor.user_id = v_actor and actor.active
      and rollout.starts_at <= statement_timestamp()
      and rollout.expires_at > statement_timestamp()
      and (rollout.project_id is null or rollout.project_id = nullif(p_project_id, ''))
      and (rollout.construction_site_id is null or rollout.construction_site_id = nullif(p_construction_site_id, ''))
      and (nullif(p_warehouse_id, '') is null or cardinality(rollout.warehouse_ids) = 0
        or nullif(p_warehouse_id, '') = any(rollout.warehouse_ids))
      and (nullif(p_supplier_id, '') is null or cardinality(rollout.supplier_ids) = 0
        or nullif(p_supplier_id, '') = any(rollout.supplier_ids))
    order by rollout.starts_at desc, rollout.id
  loop
    if scope.expires_at > statement_timestamp()
       and ((scope.mode = 'pilot' and p_command = any(scope.enabled_commands))
         or (scope.mode = 'paused' and p_command = any(scope.completion_commands))) then
      return;
    end if;
  end loop;
  raise exception using errcode = '42501', message = 'ERP_COMPLETION_PILOT_COMMAND_DISABLED';
end;
$$;
revoke all on function app_private.assert_erp_completion_rollout_command_v1(text,text,text,text,text) from public, anon, authenticated;

create or replace function app_private.assert_erp_completion_demand_v1(p_command text, p_demand_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_demand public.procurement_demands%rowtype;
begin
  select * into v_demand from public.procurement_demands where id = p_demand_id;
  if not found then raise exception 'PROCUREMENT_DEMAND_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.assert_erp_completion_rollout_command_v1(
    p_command, v_demand.project_id, v_demand.construction_site_id, null, null);
end;
$$;

create or replace function app_private.assert_erp_completion_demand_line_v1(p_command text, p_demand_line_id uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_demand public.procurement_demands%rowtype;
begin
  select demand.* into v_demand
  from public.procurement_demand_lines line
  join public.procurement_demands demand on demand.id = line.demand_id
  where line.id = p_demand_line_id;
  if not found then raise exception 'PROCUREMENT_DEMAND_LINE_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.assert_erp_completion_rollout_command_v1(
    p_command, v_demand.project_id, v_demand.construction_site_id, null, null);
end;
$$;

create or replace function app_private.assert_erp_completion_warehouse_v1(p_command text, p_warehouse_id text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_scope record;
begin
  select * into v_scope from app_private.resolve_warehouse_project_scope(p_warehouse_id);
  if not found then raise exception 'WMS_WAREHOUSE_SCOPE_REQUIRED' using errcode = '22023'; end if;
  perform app_private.assert_erp_completion_rollout_command_v1(
    p_command, v_scope.project_id, v_scope.construction_site_id, p_warehouse_id, null);
end;
$$;

create or replace function app_private.assert_erp_completion_transfer_v1(p_command text, p_transaction_id text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_tx public.transactions%rowtype;
begin
  select * into v_tx from public.transactions where id = p_transaction_id;
  if not found then raise exception 'WMS_TRANSFER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_tx.source_warehouse_id is not null then
    perform app_private.assert_erp_completion_warehouse_v1(p_command, v_tx.source_warehouse_id);
  end if;
  if v_tx.target_warehouse_id is not null
     and v_tx.target_warehouse_id is distinct from v_tx.source_warehouse_id then
    perform app_private.assert_erp_completion_warehouse_v1(p_command, v_tx.target_warehouse_id);
  end if;
  if v_tx.source_warehouse_id is null and v_tx.target_warehouse_id is null then
    raise exception 'WMS_WAREHOUSE_SCOPE_REQUIRED' using errcode = '22023';
  end if;
end;
$$;

revoke all on function app_private.assert_erp_completion_demand_v1(text,uuid) from public, anon, authenticated;
revoke all on function app_private.assert_erp_completion_demand_line_v1(text,uuid) from public, anon, authenticated;
revoke all on function app_private.assert_erp_completion_warehouse_v1(text,text) from public, anon, authenticated;
revoke all on function app_private.assert_erp_completion_transfer_v1(text,text) from public, anon, authenticated;

create or replace function public.get_erp_completion_rollout_access_v1(
  p_project_id text default null,
  p_construction_site_id text default null,
  p_warehouse_id text default null,
  p_supplier_id text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_result jsonb;
begin
  if v_actor is null then
    return jsonb_build_object('mode','off','enabledCommands','[]'::jsonb,
      'completionCommands','[]'::jsonb);
  end if;
  select jsonb_build_object(
    'mode', scope.mode,
    'scopeKey', scope.scope_key,
    'releaseId', scope.release_id,
    'persona', actor.persona,
    'enabledCommands', to_jsonb(scope.enabled_commands),
    'completionCommands', to_jsonb(scope.completion_commands),
    'startsAt', scope.starts_at,
    'expiresAt', scope.expires_at
  ) into v_result
  from app_private.erp_completion_rollout_scopes scope
  join app_private.erp_completion_rollout_actors actor on actor.scope_id = scope.id
  where actor.user_id = v_actor and actor.active
    and scope.starts_at <= statement_timestamp()
    and scope.expires_at > statement_timestamp()
    and (scope.project_id is null or scope.project_id = nullif(p_project_id, ''))
    and (scope.construction_site_id is null or scope.construction_site_id = nullif(p_construction_site_id, ''))
    and (nullif(p_warehouse_id, '') is null or cardinality(scope.warehouse_ids) = 0
      or nullif(p_warehouse_id, '') = any(scope.warehouse_ids))
    and (nullif(p_supplier_id, '') is null or cardinality(scope.supplier_ids) = 0
      or nullif(p_supplier_id, '') = any(scope.supplier_ids))
  order by scope.starts_at desc, scope.id, actor.persona
  limit 1;
  return coalesce(v_result, jsonb_build_object('mode','off','enabledCommands','[]'::jsonb,
    'completionCommands','[]'::jsonb));
end;
$$;
revoke all on function public.get_erp_completion_rollout_access_v1(text,text,text,text) from public, anon;
grant execute on function public.get_erp_completion_rollout_access_v1(text,text,text,text) to authenticated, service_role;

create or replace function app_private.assert_erp_completion_invoice_payload_v1(
  p_command text, p_payable_allocations jsonb
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_scope record; v_count integer := 0;
begin
  for v_scope in
    select distinct document.project_id, document.construction_site_id, document.supplier_id
    from jsonb_array_elements(coalesce(p_payable_allocations, '[]'::jsonb)) allocation(value)
    join public.supplier_payable_documents document
      on document.id = nullif(coalesce(
        allocation.value ->> 'payableDocumentId',
        allocation.value ->> 'payable_document_id'
      ), '')::uuid
  loop
    v_count := v_count + 1;
    perform app_private.assert_erp_completion_rollout_command_v1(
      p_command, v_scope.project_id, v_scope.construction_site_id, null, v_scope.supplier_id);
  end loop;
  if v_count = 0 then
    raise exception using errcode = '42501', message = 'ERP_COMPLETION_PILOT_COMMAND_DISABLED';
  end if;
end;
$$;

create or replace function app_private.assert_erp_completion_invoice_v1(
  p_command text, p_invoice_id uuid
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_scope record; v_count integer := 0;
begin
  for v_scope in
    select distinct document.project_id, document.construction_site_id, document.supplier_id
    from public.supplier_invoice_payable_links link
    join public.supplier_payable_documents document on document.id = link.payable_document_id
    where link.invoice_id = p_invoice_id
  loop
    v_count := v_count + 1;
    perform app_private.assert_erp_completion_rollout_command_v1(
      p_command, v_scope.project_id, v_scope.construction_site_id, null, v_scope.supplier_id);
  end loop;
  if v_count = 0 then
    raise exception using errcode = '42501', message = 'ERP_COMPLETION_PILOT_COMMAND_DISABLED';
  end if;
end;
$$;

create or replace function app_private.assert_erp_completion_payment_v1(
  p_command text, p_batch_id uuid
) returns void language plpgsql stable security definer set search_path = '' as $$
declare v_batch public.supplier_payment_batches%rowtype;
begin
  select * into v_batch from public.supplier_payment_batches where id = p_batch_id;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.assert_erp_completion_rollout_command_v1(
    p_command, v_batch.project_id, v_batch.construction_site_id, null, v_batch.supplier_id);
end;
$$;
revoke all on function app_private.assert_erp_completion_invoice_payload_v1(text,jsonb) from public, anon, authenticated;
revoke all on function app_private.assert_erp_completion_invoice_v1(text,uuid) from public, anon, authenticated;
revoke all on function app_private.assert_erp_completion_payment_v1(text,uuid) from public, anon, authenticated;
grant execute on function app_private.assert_erp_completion_rollout_command_v1(text,text,text,text,text) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_demand_v1(text,uuid) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_demand_line_v1(text,uuid) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_warehouse_v1(text,text) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_transfer_v1(text,text) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_invoice_payload_v1(text,jsonb) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_invoice_v1(text,uuid) to authenticated, service_role;
grant execute on function app_private.assert_erp_completion_payment_v1(text,uuid) to authenticated, service_role;

create or replace function public.save_material_plan_v1(
  p_plan_id uuid, p_project_id text, p_construction_site_id text, p_expected_version bigint,
  p_title text, p_period_start date, p_period_end date, p_note text, p_status text,
  p_lines jsonb, p_payload_schema_version integer, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_rollout_command_v1(
    'material_plan.save', p_project_id, nullif(p_construction_site_id,''), null, null);
  return app_private.save_material_plan_v1(
    p_plan_id,p_project_id,nullif(p_construction_site_id,''),p_expected_version,p_title,
    p_period_start,p_period_end,p_note,p_status,p_lines,p_payload_schema_version,p_idempotency_key);
end;
$$;

create or replace function public.convert_material_plan_to_request_v1(
  p_plan_id uuid, p_expected_version bigint, p_site_warehouse_id text,
  p_fulfillment_mode text, p_allocations jsonb, p_payload_schema_version integer,
  p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_plan public.material_plans%rowtype;
begin
  select * into v_plan from public.material_plans where id = p_plan_id;
  if not found then raise exception 'MATERIAL_PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.assert_erp_completion_rollout_command_v1(
    'material_plan.convert',v_plan.project_id,v_plan.construction_site_id,p_site_warehouse_id,null);
  return app_private.convert_material_plan_to_request_v1(
    p_plan_id,p_expected_version,p_site_warehouse_id,p_fulfillment_mode,
    p_allocations,p_payload_schema_version,p_idempotency_key);
end;
$$;

create or replace function public.assign_procurement_demand_v1(
  p_demand_id uuid, p_assignee_user_id uuid, p_expected_version bigint,
  p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_demand_v1('procurement.assign',p_demand_id);
  return app_private.assign_procurement_demand_v1(
    p_demand_id,p_assignee_user_id,p_expected_version,p_reason,p_idempotency_key);
end;
$$;

create or replace function public.save_procurement_allocation_v1(
  p_demand_line_id uuid, p_source_revision_id uuid,
  p_execution_source_line_registry_id uuid, p_method text, p_state text,
  p_reserved_need_qty numeric, p_committed_need_qty numeric, p_need_unit text,
  p_execution_qty numeric, p_execution_unit text,
  p_conversion_numerator numeric, p_conversion_denominator numeric,
  p_expected_demand_line_version bigint, p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_demand_line_v1('procurement.allocate',p_demand_line_id);
  return app_private.save_procurement_allocation_v1(
    p_demand_line_id,p_source_revision_id,p_execution_source_line_registry_id,
    p_method,p_state,p_reserved_need_qty,p_committed_need_qty,p_need_unit,
    p_execution_qty,p_execution_unit,p_conversion_numerator,p_conversion_denominator,
    p_expected_demand_line_version,p_reason,p_idempotency_key);
end;
$$;

create or replace function public.create_procurement_purchase_order_v1(
  p_purchase_order jsonb, p_request_line_links jsonb, p_allocations jsonb,
  p_actor_user_id uuid, p_idempotency_key uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_rollout_command_v1(
    'procurement.po.create',p_purchase_order->>'project_id',
    p_purchase_order->>'construction_site_id',p_purchase_order->>'target_warehouse_id',
    p_purchase_order->>'vendor_id');
  return app_private.create_procurement_purchase_order_v1(
    p_purchase_order,p_request_line_links,p_allocations,p_actor_user_id,p_idempotency_key);
end;
$$;

create or replace function public.dispatch_wms_transfer_v1(
  p_transaction_id text, p_expected_version bigint, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_transfer_v1('wms.transfer.dispatch',p_transaction_id);
  return app_private.dispatch_wms_transfer_v1(p_transaction_id,p_expected_version,p_idempotency_key);
end;
$$;

create or replace function public.receive_wms_transfer_v1(
  p_transaction_id text, p_lines jsonb, p_expected_version bigint,
  p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_transfer_v1('wms.transfer.receive',p_transaction_id);
  return app_private.receive_wms_transfer_v1(p_transaction_id,p_lines,p_expected_version,p_idempotency_key);
end;
$$;

create or replace function public.dispose_wms_transfer_v1(
  p_transaction_id text, p_disposition text, p_lines jsonb, p_reason text,
  p_expected_version bigint, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_transfer_v1('wms.transfer.dispose',p_transaction_id);
  return app_private.dispose_wms_transfer_v1(
    p_transaction_id,p_disposition,p_lines,p_reason,p_expected_version,p_idempotency_key);
end;
$$;

create or replace function public.start_wms_inventory_count_v1(
  p_warehouse_id text, p_item_ids text[], p_reason text, p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_warehouse_v1('wms.inventory_count.start',p_warehouse_id);
  return app_private.start_wms_inventory_count_v1(p_warehouse_id,p_item_ids,p_reason,p_idempotency_key);
end;
$$;

create or replace function public.post_wms_inventory_count_v1(
  p_inventory_count_id uuid, p_lines jsonb, p_expected_version bigint,
  p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_warehouse_id text;
begin
  select warehouse_id into v_warehouse_id
  from public.wms_inventory_counts where id = p_inventory_count_id;
  if not found then raise exception 'WMS_INVENTORY_COUNT_NOT_FOUND' using errcode = 'P0002'; end if;
  perform app_private.assert_erp_completion_warehouse_v1('wms.inventory_count.post',v_warehouse_id);
  return app_private.post_wms_inventory_count_v1(
    p_inventory_count_id,p_lines,p_expected_version,p_idempotency_key);
end;
$$;

create or replace function public.record_supplier_invoice_reconciliation_v3(
  p_invoice jsonb,
  p_payable_allocations jsonb,
  p_receipt_allocations jsonb default '[]'::jsonb,
  p_idempotency_key text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_invoice_payload_v1(
    'finance.invoice.record',p_payable_allocations);
  return app_private.record_supplier_invoice_reconciliation_v3(
    p_invoice,p_payable_allocations,p_receipt_allocations,p_idempotency_key);
end;
$$;

create or replace function public.record_supplier_invoice_reconciliation_v2(
  p_invoice jsonb, p_links jsonb, p_actor_user_id uuid
) returns public.supplier_invoices language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_invoice_payload_v1(
    'finance.invoice.record',p_links);
  return app_private.record_supplier_invoice_reconciliation_v2(
    p_invoice,p_links,p_actor_user_id);
end;
$$;

create or replace function public.reverse_supplier_invoice_v1(
  p_invoice_id uuid, p_expected_row_version bigint,
  p_idempotency_key text, p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_invoice_v1('finance.invoice.reverse',p_invoice_id);
  return app_private.reverse_supplier_invoice_v1(
    p_invoice_id,p_expected_row_version,p_idempotency_key,p_reason);
end;
$$;

create or replace function public.post_supplier_payment_batch_v2(
  p_batch_id uuid,p_expected_row_version bigint,p_idempotency_key text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_payment_v1('finance.payment.post',p_batch_id);
  return app_private.command_supplier_payment_v2(
    'payment_post',p_batch_id,p_expected_row_version,p_idempotency_key,null);
end;
$$;

create or replace function public.reverse_supplier_payment_batch_v2(
  p_batch_id uuid,p_expected_row_version bigint,p_idempotency_key text,p_reason text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform app_private.assert_erp_completion_payment_v1('finance.payment.reverse',p_batch_id);
  return app_private.command_supplier_payment_v2(
    'payment_reverse',p_batch_id,p_expected_row_version,p_idempotency_key,p_reason);
end;
$$;

create function public.get_erp_completion_rollout_health_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_pending_outbox bigint;
  v_oldest_outbox timestamptz;
  v_reconciliation bigint;
  v_source_changed bigint;
  v_incomplete_procurement bigint;
  v_incomplete_po bigint;
  v_incomplete_wms bigint;
  v_active_scopes bigint;
  v_active_actors bigint;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'ERP_COMPLETION_ROLLOUT_HEALTH_FORBIDDEN';
  end if;
  select count(*), min(created_at) into v_pending_outbox, v_oldest_outbox
  from app_private.procurement_events_outbox where delivered_at is null;
  select count(*) into v_reconciliation
  from public.wms_inventory_reconciliation_issues where status = 'open';
  select count(*) into v_source_changed
  from public.procurement_demands
  where intake_state = 'source_changed' or health_state = 'reconciliation_required';
  select count(*) into v_incomplete_procurement
  from app_private.procurement_commands where committed_at is null;
  select count(*) into v_incomplete_po
  from app_private.procurement_purchase_order_commands where committed_at is null;
  select count(*) into v_incomplete_wms
  from app_private.wms_commands where committed_at is null;
  select count(*) into v_active_scopes
  from app_private.erp_completion_rollout_scopes scope
  where scope.starts_at <= statement_timestamp() and scope.expires_at > statement_timestamp()
    and scope.mode in ('pilot','paused');
  select count(*) into v_active_actors
  from app_private.erp_completion_rollout_actors actor
  join app_private.erp_completion_rollout_scopes scope on scope.id = actor.scope_id
  where actor.active and scope.starts_at <= statement_timestamp()
    and scope.expires_at > statement_timestamp() and scope.mode in ('pilot','paused');
  return jsonb_build_object(
    'status',case when v_pending_outbox > 0 or v_reconciliation > 0 or v_source_changed > 0
      or v_incomplete_procurement + v_incomplete_po + v_incomplete_wms > 0
      then 'attention' else 'healthy' end,
    'observedAt',statement_timestamp(),
    'rollout',jsonb_build_object('activeScopes',v_active_scopes,'activeActors',v_active_actors),
    'procurementOutbox',jsonb_build_object('pending',v_pending_outbox,'oldestPendingAt',v_oldest_outbox),
    'reconciliationIssues',jsonb_build_object('wmsOpen',v_reconciliation,'procurementSourceChanged',v_source_changed),
    'incompleteCommands',jsonb_build_object(
      'procurement',v_incomplete_procurement,'purchaseOrder',v_incomplete_po,'wms',v_incomplete_wms),
    'externalEvidence',jsonb_build_object(
      'permissionErrors','external_evidence_required',
      'commandLatency','external_evidence_required',
      'clientReplayConflicts','external_evidence_required')
  );
end;
$$;
revoke all on function public.get_erp_completion_rollout_health_v1() from public, anon;
grant execute on function public.get_erp_completion_rollout_health_v1() to authenticated, service_role;
