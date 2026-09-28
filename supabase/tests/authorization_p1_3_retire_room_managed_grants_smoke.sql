-- Run after authorization_p1_3_retire_room_managed_grants. Rolls back.
begin;
do $$ begin
  if exists (
    select 1 from public.user_permission_grants
    where is_active and permission_code like 'project.%'
      and split_part(permission_code, '.', 2) in ('daily_log','gantt','weekly_progress','quality','safety','payment','quantity_acceptance','material_po')
  ) then raise exception 'active Room-managed grants remain'; end if;
  if exists (
    select 1 from public.permission_actions
    where is_active and direct_grant_allowed and permission_code like 'project.%'
      and split_part(permission_code, '.', 2) in ('daily_log','gantt','weekly_progress','quality','safety','payment','quantity_acceptance','material_po')
  ) then raise exception 'Room-managed codes still allow direct grants'; end if;
  if exists (
    select 1 from app_private.permission_application_default_view_grants bundle
    join public.permission_actions action_row on action_row.permission_code = bundle.permission_code
    where bundle.is_active and not action_row.direct_grant_allowed
  ) then raise exception 'a default view bundle is no longer grantable; the admin catalog would fail'; end if;
  if (select count(*) from app_private.p1_3_room_managed_grant_backup_20260927) = 0 then raise exception 'backup is empty'; end if;
  if not exists (
    select 1 from public.user_permission_grants
    where is_active and permission_code like 'project.material_request.%'
  ) then raise exception 'material request grants were touched'; end if;
end $$;
rollback;
