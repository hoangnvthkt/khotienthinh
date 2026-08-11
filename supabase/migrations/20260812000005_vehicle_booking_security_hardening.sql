-- Vehicle Booking Phase 1.1A: security containment.
-- Cloud-only additive migration; safe to re-run.

begin;

create or replace function app_private.vehicle_user_has_scoped_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_active boolean := false;
begin
  if p_user_id is null or nullif(trim(p_permission_code), '') is null then
    return false;
  end if;

  select
    coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
  into v_is_active
  from public.users u
  where u.id = p_user_id;

  if not coalesce(v_is_active, false) then
    return false;
  end if;

  if p_permission_code in ('booking.vehicle.create', 'booking.vehicle.view_own') then
    return true;
  end if;

  -- Sensitive booking powers always require an explicit, live grant. This
  -- intentionally avoids the legacy module fallback, including for ADMIN.
  return exists (
    select 1
    from public.user_permission_grants g
    where g.user_id = p_user_id
      and g.permission_code in (p_permission_code, 'booking.vehicle.admin')
      and coalesce(g.is_active, false)
      and g.revoked_at is null
      and (g.expires_at is null or g.expires_at > now())
      and (
        g.scope_type = 'global'
        or (
          g.scope_type = coalesce(p_scope_type, 'global')
          and (g.scope_id = '*' or g.scope_id = coalesce(p_scope_id, '*'))
        )
      )
  );
end;
$$;

create or replace function app_private.vehicle_user_has_permission(
  p_user_id uuid,
  p_permission_code text
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.vehicle_user_has_scoped_permission(
    p_user_id,
    p_permission_code,
    'global',
    '*'
  );
$$;

create or replace function app_private.vehicle_user_can_view_booking(
  p_user_id uuid,
  p_booking_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and p_booking_id is not null
    and (
      app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.dispatch')
      or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.manage_fleet')
      or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.view_reports')
      or exists (
        select 1
        from public.vehicle_bookings b
        where b.id = p_booking_id
          and p_user_id in (
            b.requester_user_id,
            coalesce(b.trip_owner_user_id, b.requester_user_id),
            coalesce(b.manager_user_id_snapshot, b.requester_user_id)
          )
      )
      or exists (
        select 1
        from public.vehicle_booking_participants participant
        where participant.booking_id = p_booking_id
          and participant.user_id = p_user_id
      )
      or exists (
        select 1
        from public.vehicle_booking_assignments assignment
        where assignment.booking_id = p_booking_id
          and assignment.is_active
          and p_user_id in (
            coalesce(assignment.operator_user_id, p_user_id),
            coalesce(assignment.handover_officer_user_id, p_user_id)
          )
          and (
            assignment.operator_user_id = p_user_id
            or assignment.handover_officer_user_id = p_user_id
          )
      )
    );
$$;

create or replace function app_private.vehicle_user_can_view_issue(
  p_user_id uuid,
  p_booking_id uuid,
  p_reporter_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and (
      p_user_id = p_reporter_user_id
      or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.view_sensitive_feedback')
      or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.dispatch')
      or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.manage_fleet')
      or exists (
        select 1
        from public.vehicle_bookings b
        where b.id = p_booking_id
          and b.manager_user_id_snapshot = p_user_id
      )
    );
$$;

create or replace function app_private.vehicle_user_can_access_evidence(
  p_user_id uuid,
  p_object_name text,
  p_operation text
) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[] := storage.foldername(p_object_name);
  v_booking_id uuid;
  v_subject_user_id uuid;
  v_namespace text;
begin
  if p_user_id is null or coalesce(array_length(v_parts, 1), 0) < 2 then
    return false;
  end if;

  v_namespace := v_parts[1];

  if v_namespace = 'licenses' then
    begin
      v_subject_user_id := v_parts[2]::uuid;
    exception when invalid_text_representation then
      return false;
    end;

    if p_operation = 'SELECT' then
      return p_user_id = v_subject_user_id
        or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.manage_authorizations');
    end if;

    return app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.manage_authorizations');
  end if;

  if v_namespace = 'fleet' then
    return app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.manage_fleet')
      or (
        p_operation = 'SELECT'
        and app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.dispatch')
      );
  end if;

  begin
    v_booking_id := v_namespace::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  if v_parts[2] not in ('trips', 'external') then
    return false;
  end if;

  if p_operation = 'SELECT' then
    return app_private.vehicle_user_can_view_booking(p_user_id, v_booking_id);
  end if;

  if v_parts[2] = 'external' then
    return exists (
      select 1
      from public.vehicle_bookings b
      where b.id = v_booking_id
        and (b.requester_user_id = p_user_id or b.trip_owner_user_id = p_user_id)
    ) or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.dispatch');
  end if;

  return exists (
    select 1
    from public.vehicle_booking_assignments a
    where a.booking_id = v_booking_id
      and a.is_active
      and (a.operator_user_id = p_user_id or a.handover_officer_user_id = p_user_id)
  ) or app_private.vehicle_user_has_permission(p_user_id, 'booking.vehicle.dispatch');
end;
$$;

revoke all on function app_private.vehicle_user_has_scoped_permission(uuid, text, text, text) from public, anon;
revoke all on function app_private.vehicle_user_has_permission(uuid, text) from public, anon;
revoke all on function app_private.vehicle_user_can_view_booking(uuid, uuid) from public, anon;
revoke all on function app_private.vehicle_user_can_view_issue(uuid, uuid, uuid) from public, anon;
revoke all on function app_private.vehicle_user_can_access_evidence(uuid, text, text) from public, anon;
grant execute on function app_private.vehicle_user_has_scoped_permission(uuid, text, text, text) to authenticated;
grant execute on function app_private.vehicle_user_has_permission(uuid, text) to authenticated;
grant execute on function app_private.vehicle_user_can_view_booking(uuid, uuid) to authenticated;
grant execute on function app_private.vehicle_user_can_view_issue(uuid, uuid, uuid) to authenticated;
grant execute on function app_private.vehicle_user_can_access_evidence(uuid, text, text) to authenticated;

drop policy if exists p_vehicle_driver_authorizations_select on public.vehicle_driver_authorizations;
create policy p_vehicle_driver_authorizations_select
on public.vehicle_driver_authorizations
for select
to authenticated
using (
  user_id = (select public.current_app_user_id())
  or app_private.vehicle_user_has_permission(
    (select public.current_app_user_id()),
    'booking.vehicle.manage_authorizations'
  )
);

drop policy if exists p_operator_unavailability_periods_select on public.operator_unavailability_periods;
create policy p_operator_unavailability_periods_select
on public.operator_unavailability_periods
for select
to authenticated
using (
  operator_user_id = (select public.current_app_user_id())
  or app_private.vehicle_user_has_permission(
    (select public.current_app_user_id()),
    'booking.vehicle.manage_authorizations'
  )
);

drop policy if exists p_vehicle_booking_issues_select on public.vehicle_booking_issues;
create policy p_vehicle_booking_issues_select
on public.vehicle_booking_issues
for select
to authenticated
using (
  app_private.vehicle_user_can_view_issue(
    (select public.current_app_user_id()),
    booking_id,
    reporter_user_id
  )
);

create or replace view public.vehicle_driver_authorizations_eligible_v
with (security_barrier = true) as
select
  vda.id,
  vda.user_id,
  vda.employee_id,
  vda.authorization_type,
  vda.license_class,
  vda.license_expiry,
  vda.allowed_vehicle_types,
  vda.status,
  (
    vda.status = 'ACTIVE'
    and vda.license_expiry >= current_date
    and (
      vda.health_check_expiry_date is null
      or vda.health_check_expiry_date >= current_date
    )
    and exists (
      select 1
      from public.users u
      where u.id = vda.user_id
        and coalesce(u.is_active, true)
        and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
    )
  ) as is_eligible
from public.vehicle_driver_authorizations vda
where vda.user_id = public.current_app_user_id()
   or app_private.vehicle_user_has_permission(
     public.current_app_user_id(),
     'booking.vehicle.dispatch'
   )
   or app_private.vehicle_user_has_permission(
     public.current_app_user_id(),
     'booking.vehicle.manage_authorizations'
   );

grant select on public.vehicle_driver_authorizations_eligible_v to authenticated;

create or replace view public.operator_unavailability_calendar_v
with (security_barrier = true) as
select
  period.id,
  period.operator_user_id,
  period.start_at,
  period.end_at,
  period.created_at
from public.operator_unavailability_periods period
where period.operator_user_id = public.current_app_user_id()
   or app_private.vehicle_user_has_permission(
     public.current_app_user_id(),
     'booking.vehicle.dispatch'
   )
   or app_private.vehicle_user_has_permission(
     public.current_app_user_id(),
     'booking.vehicle.manage_authorizations'
   );

grant select on public.operator_unavailability_calendar_v to authenticated;

drop policy if exists p_storage_vehicle_evidence_select on storage.objects;
drop policy if exists p_storage_vehicle_evidence_insert on storage.objects;

create policy p_storage_vehicle_evidence_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'vehicle-trip-evidence'
  and app_private.vehicle_user_can_access_evidence(
    (select public.current_app_user_id()),
    name,
    'SELECT'
  )
);

create policy p_storage_vehicle_evidence_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'vehicle-trip-evidence'
  and app_private.vehicle_user_can_access_evidence(
    (select public.current_app_user_id()),
    name,
    'INSERT'
  )
);

-- Restore table privileges that the Phase 1 migration revoked globally.
-- Bucket-specific RLS policies remain the authority for each operation.
grant update, delete on storage.objects to authenticated, anon;

-- Contain unsafe mutations until the command-hardening migration replaces them.
revoke execute on function public.reject_vehicle_booking(uuid, text) from authenticated;
revoke execute on function public.dispatch_vehicle_booking(uuid, text, text, uuid, uuid, boolean, text, text, text, text, text, text, numeric, text, text, text) from authenticated;
revoke execute on function public.confirm_vehicle_handover(uuid, text, text, text) from authenticated;
revoke execute on function public.record_vehicle_trip_checkpoint(uuid, text) from authenticated;
revoke execute on function public.start_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text) from authenticated;
revoke execute on function public.finish_vehicle_trip(uuid, numeric, text, numeric, numeric, numeric, boolean, text, text, text) from authenticated;
revoke execute on function public.confirm_vehicle_return(uuid, text) from authenticated;
revoke execute on function public.submit_vehicle_feedback(uuid, boolean, integer, text[], text, text) from authenticated;
revoke execute on function public.cancel_vehicle_booking(uuid, text) from authenticated;
revoke execute on function public.process_vehicle_feedback_auto_close() from authenticated;

do $harden_public_wrappers$
declare
  v_function record;
begin
  for v_function in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'upsert_fleet_vehicle_profile',
        'upsert_driver_authorization',
        'upsert_fleet_location',
        'create_vehicle_unavailability',
        'update_fleet_system_settings',
        'create_vehicle_booking',
        'submit_vehicle_booking',
        'approve_vehicle_booking',
        'reject_vehicle_booking',
        'dispatch_vehicle_booking',
        'confirm_vehicle_handover',
        'record_vehicle_trip_checkpoint',
        'start_vehicle_trip',
        'finish_vehicle_trip',
        'confirm_vehicle_return',
        'submit_vehicle_feedback',
        'cancel_vehicle_booking',
        'process_vehicle_feedback_auto_close'
      )
  loop
    execute format('alter function %s set search_path = ''''', v_function.signature);
  end loop;
end;
$harden_public_wrappers$;

commit;
