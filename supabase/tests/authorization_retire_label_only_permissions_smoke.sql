-- Run after authorization_retire_label_only_permissions. Rolls back.
begin;
do $$
declare v_codes text[] := array['booking.vehicle.trip.execute', 'asset.catalog.manage', 'asset.maintenance.manage', 'request.category.manage'];
begin
  if exists (select 1 from public.permission_actions where permission_code = any(v_codes) and is_active) then
    raise exception 'label-only permission still active';
  end if;
  if exists (select 1 from public.user_permission_grants where permission_code = any(v_codes) and is_active) then
    raise exception 'label-only grant still active';
  end if;
  if exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i where i ->> 'permissionCode' = any(v_codes)) then
    raise exception 'a template still holds a label-only permission';
  end if;
  -- the handover box stays: it opens the handover page for the people assigned to hand over
  if not exists (select 1 from public.permission_actions where permission_code = 'booking.vehicle.handover' and is_active) then
    raise exception 'booking.vehicle.handover was hidden by mistake';
  end if;
  -- every remaining template item is still a valid, active, directly grantable permission
  if exists (select 1 from public.user_permission_templates t, jsonb_array_elements(t.items) i
             left join public.permission_actions a on a.permission_code = i ->> 'permissionCode' and a.is_active and a.direct_grant_allowed
             where t.is_active and a.id is null) then
    raise exception 'a template holds an inactive or non-grantable permission';
  end if;
end $$;
rollback;
