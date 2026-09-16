-- E29 forward fix: Postgres fires BEFORE INSERT before resolving an UPSERT.
-- Existing rows must reach the UPDATE branch, which checks the lifecycle action.
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

  -- Supabase upsert fires the INSERT trigger before ON CONFLICT switches to UPDATE.
  -- The subsequent UPDATE trigger is authoritative for an existing request.
  if tg_op = 'INSERT' and exists (
    select 1 from public.requests request_row where request_row.id = new.id
  ) then
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
