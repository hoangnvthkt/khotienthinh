-- Task 12.4.2 / E29: make the warehouse-operator blueprint executable.
-- WMS request lifecycle writes are authorized by the exact business action;
-- transaction creation linked to a WMS request additionally requires export.

create or replace function app_private.wms_request_has_action(
  p_permission_code text,
  p_source_warehouse_id text,
  p_site_warehouse_id text,
  p_fulfillment_mode text,
  p_requester_id uuid,
  p_submitted_to_user_id text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_permission_code
    when 'wms.request.export' then
      app_private.wms_has_action(
        p_permission_code,
        p_source_warehouse_id,
        null,
        p_requester_id,
        nullif(p_submitted_to_user_id, '')::uuid
      )
    when 'wms.request.receive' then
      app_private.wms_has_action(
        p_permission_code,
        case
          when coalesce(p_fulfillment_mode, 'RECEIVE_TO_STOCK') = 'DIRECT_CONSUMPTION'
            then p_source_warehouse_id
          else null
        end,
        p_site_warehouse_id,
        p_requester_id,
        nullif(p_submitted_to_user_id, '')::uuid
      )
    else
      app_private.wms_has_action(
        p_permission_code,
        p_source_warehouse_id,
        p_site_warehouse_id,
        p_requester_id,
        nullif(p_submitted_to_user_id, '')::uuid
      )
  end;
$$;

revoke all on function app_private.wms_request_has_action(text, text, text, text, uuid, text) from public;
revoke all on function app_private.wms_request_has_action(text, text, text, text, uuid, text) from anon;
revoke all on function app_private.wms_request_has_action(text, text, text, text, uuid, text) from authenticated;

create or replace function app_private.assert_wms_request_lifecycle_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_required_action text;
  v_old_status text := case when tg_op = 'UPDATE' then upper(coalesce(old.status::text, '')) else null end;
  v_new_status text := upper(coalesce(new.status::text, ''));
begin
  if coalesce(new.request_origin, 'wms') <> 'wms'
    or public.current_app_user_id() is null
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_required_action := 'wms.request.create';
  elsif v_old_status is distinct from v_new_status then
    v_required_action := case
      when v_new_status = 'PENDING' and v_old_status in ('DRAFT', 'REJECTED')
        then 'wms.request.create'
      when v_new_status in ('APPROVED', 'REJECTED') and v_old_status in ('PENDING', 'APPROVED')
        then 'wms.request.approve'
      when v_new_status = 'IN_TRANSIT' and v_old_status = 'APPROVED'
        then 'wms.request.export'
      when v_new_status = 'COMPLETED' and v_old_status = 'IN_TRANSIT'
        then 'wms.request.receive'
      when v_new_status = 'COMPLETED' and v_old_status = 'APPROVED'
        then 'wms.request.export'
      else null
    end;
  else
    v_required_action := case
      when v_new_status in ('DRAFT', 'REJECTED') then 'wms.request.create'
      when v_new_status = 'PENDING' then 'wms.request.approve'
      when v_new_status = 'APPROVED' then 'wms.request.export'
      when v_new_status in ('IN_TRANSIT', 'COMPLETED') then 'wms.request.receive'
      else null
    end;
  end if;

  if v_required_action is null
    or not app_private.wms_request_has_action(
      v_required_action,
      new.source_warehouse_id,
      new.site_warehouse_id,
      new.fulfillment_mode::text,
      new.requester_id,
      new.submitted_to_user_id
    )
  then
    raise exception 'WMS_REQUEST_ACTION_REQUIRED: %', coalesce(v_required_action, 'unsupported_transition')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.assert_wms_request_lifecycle_action() from public;
revoke all on function app_private.assert_wms_request_lifecycle_action() from anon;
revoke all on function app_private.assert_wms_request_lifecycle_action() from authenticated;

drop trigger if exists trg_requests_wms_lifecycle_action on public.requests;
create trigger trg_requests_wms_lifecycle_action
before insert or update on public.requests
for each row execute function app_private.assert_wms_request_lifecycle_action();

create or replace function app_private.transaction_can_insert(
  p_type text,
  p_requester_id uuid,
  p_approver_id uuid,
  p_source_warehouse_id text,
  p_target_warehouse_id text,
  p_related_request_id text,
  p_items jsonb
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (
      app_private.wms_has_action(
        'wms.transaction.create',
        p_source_warehouse_id,
        p_target_warehouse_id,
        p_requester_id,
        p_approver_id
      )
      and not exists (
        select 1
        from public.requests r
        where r.id = p_related_request_id
          and coalesce(r.request_origin, 'wms') = 'wms'
          and not app_private.wms_request_has_action(
            'wms.request.export',
            coalesce(p_source_warehouse_id, r.source_warehouse_id),
            coalesce(p_target_warehouse_id, r.site_warehouse_id),
            r.fulfillment_mode::text,
            r.requester_id,
            r.submitted_to_user_id
          )
      )
    )
    or exists (
      select 1
      from public.requests r
      where r.id = p_related_request_id
        and coalesce(r.request_origin, 'wms') = 'project'
        and r.submitted_to_user_id = public.current_app_user_id()::text
        and r.status::text in ('APPROVED', 'IN_TRANSIT')
        and exists (
          select 1
          from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
          where coalesce(item->>'materialRequestId', item->>'material_request_id') = r.id
        )
    );
$$;

revoke all on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) from public;
revoke all on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) from anon;
grant execute on function app_private.transaction_can_insert(text, uuid, uuid, text, text, text, jsonb) to authenticated;

update public.permission_actions
set grant_readiness = 'enforced',
    updated_at = now()
where permission_code in (
  'wms.inventory.view',
  'wms.request.view',
  'wms.request.create',
  'wms.request.approve',
  'wms.request.export',
  'wms.request.receive',
  'wms.transaction.view',
  'wms.transaction.create',
  'wms.transaction.approve',
  'wms.transaction.complete'
);
