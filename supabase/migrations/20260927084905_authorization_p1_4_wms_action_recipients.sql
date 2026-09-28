-- P1.4: choose WMS approvers and notification recipients by what the server
-- actually lets them do, not by the WAREHOUSE_KEEPER role alone.
-- app_private.wms_user_has_action mirrors app_private.wms_has_action for any
-- user (that one only knows the current actor): canonical capability at the
-- warehouse, WMS module admin, or warehouse keeper (global or of that store).
-- p_include_legacy_admin = false leaves out the legacy WMS module-admin flag
-- (17 employees, cohort P1.5) so notifications are not sent to all of them.

create or replace function app_private.wms_user_has_action(
  p_user_id uuid,
  p_permission_code text,
  p_source_warehouse_id text default null,
  p_target_warehouse_id text default null,
  p_include_legacy_admin boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app_private.wms_has_canonical_action(p_permission_code, p_source_warehouse_id, p_target_warehouse_id, null, null, p_user_id)
    or (
      p_permission_code <> 'wms.transaction.reverse'
      and exists (
        select 1 from public.permission_actions action_row
        where action_row.permission_code = p_permission_code and action_row.permission_code like 'wms.%' and action_row.is_active
      )
      and exists (
        select 1 from public.users user_row
        where user_row.id = p_user_id and coalesce(user_row.is_active, true)
          and (
            user_row.role = 'ADMIN'
            or (p_include_legacy_admin and (
              'WMS' = any(coalesce(user_row.admin_modules, '{}'::text[]))
              or coalesce(user_row.admin_sub_modules, '{}'::jsonb) ? 'WMS'
            ))
            or (user_row.role::text = 'WAREHOUSE_KEEPER' and user_row.assigned_warehouse_id is null)
            or (user_row.role::text = 'WAREHOUSE_KEEPER' and user_row.assigned_warehouse_id is not null
                and user_row.assigned_warehouse_id in (p_source_warehouse_id, p_target_warehouse_id))
          )
      )
    ),
    false
  );
$$;
revoke all on function app_private.wms_user_has_action(uuid, text, text, text, boolean) from public, anon, authenticated;

-- Active users who should handle a WMS action at any of the given warehouses:
-- capability holders, warehouse keepers and Admins. warehouse_specific marks people tied to one of those stores (preferred as
-- the default handler); system Admins come last.
create or replace function public.list_wms_action_recipients(
  p_permission_code text,
  p_warehouse_ids text[] default '{}'::text[]
)
returns table (user_id uuid, user_name text, warehouse_specific boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_user_id() is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;
  if p_permission_code is null or p_permission_code not like 'wms.%' then
    raise exception 'WMS_PERMISSION_CODE_REQUIRED' using errcode = '22023';
  end if;

  return query
  with warehouses as (
    select distinct nullif(btrim(value), '') as warehouse_id
    from unnest(coalesce(p_warehouse_ids, '{}'::text[])) as value
  ), candidates as (
    select user_row.id, user_row.name, user_row.role::text as role, user_row.assigned_warehouse_id
    from public.users user_row
    where coalesce(user_row.is_active, true) and user_row.account_status = 'ACTIVE'
  )
  select candidate.id, candidate.name,
    exists (
      select 1 from warehouses w
      where w.warehouse_id is not null and (
        candidate.assigned_warehouse_id = w.warehouse_id
        or app_private.has_permission(candidate.id, p_permission_code, 'warehouse', w.warehouse_id)
      )
    )
  from candidates candidate
  where case
    when not exists (select 1 from warehouses where warehouse_id is not null)
      then app_private.wms_user_has_action(candidate.id, p_permission_code, null, null, false)
    else exists (
      select 1 from warehouses w
      where w.warehouse_id is not null
        and app_private.wms_user_has_action(candidate.id, p_permission_code, w.warehouse_id, null, false)
    )
  end
  order by 3 desc, (candidate.role = 'ADMIN'), candidate.name;
end;
$$;
revoke all on function public.list_wms_action_recipients(text, text[]) from public, anon;
grant execute on function public.list_wms_action_recipients(text, text[]) to authenticated;
