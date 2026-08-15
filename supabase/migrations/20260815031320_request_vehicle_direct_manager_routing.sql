begin;

create or replace function app_private.resolve_active_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select manager.id
  from public.users employee
  join public.users manager on manager.id = employee.manager_id
  where employee.id = p_user_id
    and manager.id <> p_user_id
    and coalesce(manager.is_active, true)
    and coalesce(manager.account_status, 'ACTIVE') = 'ACTIVE';
$$;

create or replace function app_private.resolve_request_direct_manager(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.resolve_active_direct_manager(p_user_id);
$$;

create or replace function app_private.resolve_request_block_approvers(
  p_block_id uuid,
  p_creator_id uuid,
  p_dynamic_user_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block public.request_approval_blocks%rowtype;
  v_source text;
  v_result uuid[] := '{}'::uuid[];
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_manager_id uuid;
  v_minimum integer;
begin
  select * into v_block
  from public.request_approval_blocks
  where id = p_block_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'REQUEST_APPROVAL_BLOCK_NOT_FOUND';
  end if;

  v_source := v_block.approver_source;
  if v_source in ('FIXED_SINGLE', 'FIXED_MULTI') then
    v_ids := coalesce(v_block.fixed_user_ids, '{}'::uuid[]);
  elsif v_source = 'DIRECT_MANAGER' then
    v_manager_id := app_private.resolve_active_direct_manager(p_creator_id);
    if v_manager_id is null then
      raise exception using errcode = '22023', message = 'REQUEST_DIRECT_MANAGER_MISSING';
    end if;
    v_ids := array[v_manager_id];
  elsif v_source = 'DYNAMIC_CREATOR_SELECT' then
    v_ids := coalesce(p_dynamic_user_ids, '{}'::uuid[]);
    v_minimum := coalesce(v_block.minimum_dynamic_approvers, 1);
    if cardinality(v_ids) < v_minimum then
      raise exception using errcode = '22023', message = 'REQUEST_DYNAMIC_APPROVER_REQUIRED';
    end if;
  else
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SOURCE_INVALID';
  end if;

  foreach v_id in array v_ids loop
    if v_id is null or v_id = any(v_result) then
      continue;
    end if;
    if v_id = p_creator_id then
      raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SELF_NOT_ALLOWED';
    end if;
    if not exists (
      select 1
      from public.users app_user
      where app_user.id = v_id
        and coalesce(app_user.is_active, true)
        and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
    ) then
      raise exception using errcode = '22023', message = 'REQUEST_APPROVER_INACTIVE';
    end if;
    v_result := array_append(v_result, v_id);
  end loop;

  if cardinality(v_result) = 0 then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_REQUIRED';
  end if;
  if v_source = 'FIXED_SINGLE' and cardinality(v_result) <> 1 then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SINGLE_REQUIRED';
  end if;
  return v_result;
end;
$$;

create or replace function app_private.enforce_request_approver_not_creator()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_creator_id uuid;
begin
  select request_instance.created_by
  into v_creator_id
  from public.request_instances request_instance
  where request_instance.workflow_subject_id = new.workflow_subject_id;

  if found and new.assignee_user_id = v_creator_id then
    raise exception using errcode = '22023', message = 'REQUEST_APPROVER_SELF_NOT_ALLOWED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_request_approver_not_creator
  on public.workflow_step_assignments;
create trigger trg_request_approver_not_creator
before insert or update of assignee_user_id
on public.workflow_step_assignments
for each row
execute function app_private.enforce_request_approver_not_creator();

revoke all on function app_private.resolve_active_direct_manager(uuid)
  from public, anon, authenticated;
revoke all on function app_private.resolve_request_direct_manager(uuid)
  from public, anon, authenticated;
revoke all on function app_private.resolve_request_block_approvers(uuid, uuid, uuid[])
  from public, anon;
grant execute on function app_private.resolve_request_block_approvers(uuid, uuid, uuid[])
  to authenticated;
revoke all on function app_private.enforce_request_approver_not_creator()
  from public, anon, authenticated;

alter table public.fleet_system_settings
  add column if not exists require_direct_manager_approval boolean not null default true;

alter table public.vehicle_bookings
  add column if not exists manager_approval_route text,
  add column if not exists manager_bypass_confirmed_by_user_id uuid
    references public.users(id) on delete set null,
  add column if not exists manager_bypass_confirmed_at timestamptz;

do $vehicle_manager_route_constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.vehicle_bookings'::regclass
      and conname = 'vehicle_bookings_manager_approval_route_check'
  ) then
    alter table public.vehicle_bookings
      add constraint vehicle_bookings_manager_approval_route_check
      check (
        manager_approval_route is null
        or manager_approval_route in (
          'MANAGER',
          'CONFIG_DISABLED',
          'MISSING_MANAGER_BYPASS',
          'LEGACY'
        )
      );
  end if;
end;
$vehicle_manager_route_constraint$;

update public.vehicle_bookings
set manager_approval_route = 'LEGACY'
where status <> 'DRAFT'
  and manager_approval_route is null;

create index if not exists idx_vehicle_bookings_manager_approval_route
  on public.vehicle_bookings(manager_approval_route, status);

create or replace function app_private.vehicle_active_dispatcher_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct grant_row.user_id)::integer
  from public.user_permission_grants grant_row
  join public.users app_user on app_user.id = grant_row.user_id
  where grant_row.permission_code = 'booking.vehicle.dispatch'
    and grant_row.scope_type = 'global'
    and grant_row.scope_id = '*'
    and grant_row.is_active
    and grant_row.revoked_at is null
    and (grant_row.expires_at is null or grant_row.expires_at > now())
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE';
$$;

create or replace function app_private.vehicle_enqueue_notification(
  p_booking_id uuid,
  p_event_type text,
  p_recipient_user_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_recipient_user_id is null then
    return;
  end if;

  insert into app_private.vehicle_booking_notification_outbox (
    event_key,
    recipient_user_id,
    event_type,
    payload
  ) values (
    'vehicle:' || p_booking_id::text || ':' || p_event_type || ':' || p_recipient_user_id::text,
    p_recipient_user_id,
    coalesce(nullif(trim(p_event_type), ''), 'BOOKING_UPDATED'),
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'booking_id', p_booking_id,
      'event_type', coalesce(nullif(trim(p_event_type), ''), 'BOOKING_UPDATED')
    )
  ) on conflict (event_key, recipient_user_id) do nothing;
end;
$$;

create or replace function app_private.vehicle_enqueue_dispatcher_notifications(
  p_booking_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient record;
  v_count integer := 0;
begin
  for v_recipient in
    select distinct grant_row.user_id
    from public.user_permission_grants grant_row
    join public.users app_user on app_user.id = grant_row.user_id
    where grant_row.permission_code = 'booking.vehicle.dispatch'
      and grant_row.scope_type = 'global'
      and grant_row.scope_id = '*'
      and grant_row.is_active
      and grant_row.revoked_at is null
      and (grant_row.expires_at is null or grant_row.expires_at > now())
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  loop
    perform app_private.vehicle_enqueue_notification(
      p_booking_id,
      p_event_type,
      v_recipient.user_id,
      p_payload
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function app_private.preview_vehicle_booking_submission_route_impl(
  p_actor_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_requires_manager boolean := true;
  v_manager_user_id uuid;
  v_dispatcher_count integer := 0;
begin
  if p_actor_user_id is null
     or p_actor_user_id is distinct from public.current_app_user_id() then
    raise exception using errcode = '42501', message = 'VEHICLE_ACTOR_MISMATCH';
  end if;

  select coalesce(settings.require_direct_manager_approval, true)
  into v_requires_manager
  from public.fleet_system_settings settings
  where settings.id = 1;

  if not coalesce(v_requires_manager, true) then
    v_dispatcher_count := app_private.vehicle_active_dispatcher_count();
    if v_dispatcher_count = 0 then
      raise exception using errcode = '22023', message = 'VEHICLE_DISPATCHER_MISSING';
    end if;
    return jsonb_build_object(
      'route', 'CONFIG_DISABLED',
      'manager_user_id', null,
      'dispatcher_count', v_dispatcher_count
    );
  end if;

  v_manager_user_id := app_private.resolve_active_direct_manager(p_actor_user_id);
  if v_manager_user_id is not null then
    return jsonb_build_object(
      'route', 'MANAGER',
      'manager_user_id', v_manager_user_id,
      'dispatcher_count', app_private.vehicle_active_dispatcher_count()
    );
  end if;

  v_dispatcher_count := app_private.vehicle_active_dispatcher_count();
  if v_dispatcher_count = 0 then
    raise exception using errcode = '22023', message = 'VEHICLE_DISPATCHER_MISSING';
  end if;
  return jsonb_build_object(
    'route', 'MISSING_MANAGER_CONFIRMATION_REQUIRED',
    'manager_user_id', null,
    'dispatcher_count', v_dispatcher_count
  );
end;
$$;

create or replace function public.preview_vehicle_booking_submission_route()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_vehicle_booking_submission_route_impl(
    public.current_app_user_id()
  );
$$;

drop function if exists public.submit_vehicle_booking(uuid);
drop function if exists app_private.command_submit_vehicle_booking(uuid, uuid);

create function app_private.command_submit_vehicle_booking(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_confirm_missing_manager_bypass boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_requires_manager boolean := true;
  v_manager_user_id uuid;
  v_dispatcher_count integer := 0;
  v_route text;
  v_status text;
begin
  select booking.* into v_booking
  from public.vehicle_bookings booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.requester_user_id is distinct from p_actor_user_id
     and not app_private.vehicle_user_has_permission(
       p_actor_user_id,
       'booking.vehicle.admin'
     ) then
    perform app_private.vehicle_raise_permission_denied('Only requester can submit booking');
  end if;
  if v_booking.status <> 'DRAFT' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;

  select coalesce(settings.require_direct_manager_approval, true)
  into v_requires_manager
  from public.fleet_system_settings settings
  where settings.id = 1;

  if coalesce(v_requires_manager, true) then
    v_manager_user_id := app_private.resolve_active_direct_manager(
      v_booking.requester_user_id
    );
  end if;

  if not coalesce(v_requires_manager, true) then
    v_route := 'CONFIG_DISABLED';
    v_status := 'WAITING_DISPATCH';
  elsif v_manager_user_id is not null then
    v_route := 'MANAGER';
    v_status := 'PENDING_APPROVAL';
  elsif not coalesce(p_confirm_missing_manager_bypass, false) then
    raise exception using
      errcode = '22023',
      message = 'VEHICLE_DIRECT_MANAGER_CONFIRMATION_REQUIRED';
  else
    v_route := 'MISSING_MANAGER_BYPASS';
    v_status := 'WAITING_DISPATCH';
  end if;

  if v_status = 'WAITING_DISPATCH' then
    v_dispatcher_count := app_private.vehicle_active_dispatcher_count();
    if v_dispatcher_count = 0 then
      raise exception using errcode = '22023', message = 'VEHICLE_DISPATCHER_MISSING';
    end if;
  end if;

  update public.vehicle_bookings
  set status = v_status,
      submitted_at = now(),
      manager_user_id_snapshot = case when v_route = 'MANAGER' then v_manager_user_id else null end,
      manager_resolution_status = case
        when v_route = 'MISSING_MANAGER_BYPASS' then 'MISSING'
        else 'NORMAL'
      end,
      manager_approval_route = v_route,
      manager_bypass_confirmed_by_user_id = case
        when v_route = 'MISSING_MANAGER_BYPASS' then p_actor_user_id
        else null
      end,
      manager_bypass_confirmed_at = case
        when v_route = 'MISSING_MANAGER_BYPASS' then now()
        else null
      end,
      updated_at = now()
  where id = p_booking_id;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    case
      when v_route = 'MANAGER' then 'BOOKING_SUBMITTED_MANAGER'
      when v_route = 'CONFIG_DISABLED' then 'BOOKING_SUBMITTED_CONFIG_DISABLED'
      else 'BOOKING_SUBMITTED_MANAGER_BYPASS'
    end,
    jsonb_build_object('status', 'DRAFT'),
    jsonb_build_object(
      'status', v_status,
      'manager_approval_route', v_route,
      'manager_user_id_snapshot', v_manager_user_id
    ),
    'Gửi yêu cầu đặt xe'
  );

  if v_route = 'MANAGER' then
    perform app_private.vehicle_enqueue_notification(
      p_booking_id,
      'BOOKING_SUBMITTED',
      v_manager_user_id,
      jsonb_build_object('booking_code', v_booking.booking_code)
    );
  else
    perform app_private.vehicle_enqueue_dispatcher_notifications(
      p_booking_id,
      'BOOKING_WAITING_DISPATCH',
      jsonb_build_object(
        'booking_code', v_booking.booking_code,
        'manager_approval_route', v_route
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'status', v_status,
    'manager_approval_route', v_route,
    'manager_user_id', v_manager_user_id,
    'dispatcher_count', v_dispatcher_count
  );
end;
$$;

create function public.submit_vehicle_booking(
  p_booking_id uuid,
  p_confirm_missing_manager_bypass boolean default false
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_submit_vehicle_booking(
    public.current_app_user_id(),
    p_booking_id,
    p_confirm_missing_manager_bypass
  );
$$;

drop function if exists public.update_fleet_system_settings(
  integer, integer, integer, integer, integer, numeric, integer, boolean, boolean
);
drop function if exists app_private.command_update_fleet_system_settings(
  uuid, integer, integer, integer, integer, integer, numeric, integer, boolean, boolean
);

create function app_private.command_update_fleet_system_settings(
  p_actor_user_id uuid,
  p_booking_buffer_minutes integer,
  p_late_cancellation_cutoff_minutes integer,
  p_feedback_auto_close_hours integer,
  p_home_base_warning_radius_meters integer,
  p_on_time_tolerance_minutes integer,
  p_max_evidence_image_mb numeric,
  p_trip_reminder_minutes integer default 60,
  p_require_handover_for_self_drive boolean default true,
  p_allow_dispatch_approval_override boolean default true,
  p_require_direct_manager_approval boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.admin'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Booking administrator permission required'
    );
  end if;

  update public.fleet_system_settings
  set booking_buffer_minutes = p_booking_buffer_minutes,
      late_cancellation_cutoff_minutes = p_late_cancellation_cutoff_minutes,
      feedback_auto_close_hours = p_feedback_auto_close_hours,
      home_base_warning_radius_meters = p_home_base_warning_radius_meters,
      on_time_tolerance_minutes = p_on_time_tolerance_minutes,
      max_evidence_image_mb = p_max_evidence_image_mb,
      trip_reminder_minutes = p_trip_reminder_minutes,
      require_handover_for_self_drive = p_require_handover_for_self_drive,
      allow_dispatch_approval_override = p_allow_dispatch_approval_override,
      require_direct_manager_approval = p_require_direct_manager_approval,
      updated_at = now()
  where id = 1;

  return jsonb_build_object('success', true);
end;
$$;

create function public.update_fleet_system_settings(
  p_booking_buffer_minutes integer,
  p_late_cancellation_cutoff_minutes integer,
  p_feedback_auto_close_hours integer,
  p_home_base_warning_radius_meters integer,
  p_on_time_tolerance_minutes integer,
  p_max_evidence_image_mb numeric,
  p_trip_reminder_minutes integer default 60,
  p_require_handover_for_self_drive boolean default true,
  p_allow_dispatch_approval_override boolean default true,
  p_require_direct_manager_approval boolean default true
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_update_fleet_system_settings(
    public.current_app_user_id(),
    p_booking_buffer_minutes,
    p_late_cancellation_cutoff_minutes,
    p_feedback_auto_close_hours,
    p_home_base_warning_radius_meters,
    p_on_time_tolerance_minutes,
    p_max_evidence_image_mb,
    p_trip_reminder_minutes,
    p_require_handover_for_self_drive,
    p_allow_dispatch_approval_override,
    p_require_direct_manager_approval
  );
$$;

create or replace function app_private.command_reassign_vehicle_booking_manager(
  p_actor_user_id uuid,
  p_booking_id uuid,
  p_manager_user_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.vehicle_bookings%rowtype;
  v_updated_at timestamptz;
begin
  if not app_private.vehicle_user_has_permission(
    p_actor_user_id,
    'booking.vehicle.admin'
  ) then
    perform app_private.vehicle_raise_permission_denied(
      'Booking administrator permission required'
    );
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'REASSIGN_REASON_REQUIRED';
  end if;

  select booking.* into v_booking
  from public.vehicle_bookings booking
  where booking.id = p_booking_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'BOOKING_NOT_FOUND';
  end if;
  if v_booking.status <> 'PENDING_APPROVAL' then
    raise exception using errcode = 'P0001', message = 'INVALID_STATUS_TRANSITION';
  end if;
  if p_expected_updated_at is null
     or v_booking.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'VEHICLE_BOOKING_STALE_STATE';
  end if;
  if p_manager_user_id is null
     or p_manager_user_id = v_booking.requester_user_id then
    raise exception using errcode = '22023', message = 'VEHICLE_MANAGER_INVALID';
  end if;
  if not exists (
    select 1
    from public.users app_user
    where app_user.id = p_manager_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  ) then
    raise exception using errcode = '22023', message = 'VEHICLE_MANAGER_INVALID';
  end if;

  update public.vehicle_bookings
  set manager_user_id_snapshot = p_manager_user_id,
      manager_resolution_status = 'NORMAL',
      manager_approval_route = 'MANAGER',
      updated_at = now()
  where id = p_booking_id
  returning updated_at into v_updated_at;

  perform app_private.vehicle_record_audit(
    p_actor_user_id,
    p_booking_id,
    'MANAGER_REASSIGNED',
    jsonb_build_object(
      'manager_user_id_snapshot', v_booking.manager_user_id_snapshot
    ),
    jsonb_build_object(
      'manager_user_id_snapshot', p_manager_user_id,
      'reason', trim(p_reason)
    ),
    'Chuyển người duyệt booking: ' || trim(p_reason)
  );

  if v_booking.manager_user_id_snapshot is not null
     and v_booking.manager_user_id_snapshot <> p_manager_user_id then
    perform app_private.vehicle_enqueue_notification(
      p_booking_id,
      'BOOKING_MANAGER_REASSIGNED_AWAY',
      v_booking.manager_user_id_snapshot,
      jsonb_build_object('reason', trim(p_reason))
    );
  end if;
  perform app_private.vehicle_enqueue_notification(
    p_booking_id,
    'BOOKING_MANAGER_REASSIGNED',
    p_manager_user_id,
    jsonb_build_object('reason', trim(p_reason))
  );

  return jsonb_build_object(
    'success', true,
    'status', 'PENDING_APPROVAL',
    'manager_user_id', p_manager_user_id,
    'updated_at', v_updated_at
  );
end;
$$;

create or replace function public.reassign_vehicle_booking_manager(
  p_booking_id uuid,
  p_manager_user_id uuid,
  p_reason text,
  p_expected_updated_at timestamptz
) returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.command_reassign_vehicle_booking_manager(
    public.current_app_user_id(),
    p_booking_id,
    p_manager_user_id,
    p_reason,
    p_expected_updated_at
  );
$$;

create or replace function app_private.vehicle_notification_title(p_event_type text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_event_type
    when 'BOOKING_SUBMITTED' then 'Yêu cầu đặt xe cần duyệt'
    when 'BOOKING_WAITING_DISPATCH' then 'Có yêu cầu đặt xe chờ điều phối'
    when 'BOOKING_MANAGER_REASSIGNED' then 'Bạn được giao duyệt yêu cầu đặt xe'
    when 'BOOKING_MANAGER_REASSIGNED_AWAY' then 'Yêu cầu đặt xe đã chuyển người duyệt'
    when 'BOOKING_REJECTED' then 'Yêu cầu đặt xe bị từ chối'
    when 'BOOKING_ASSIGNED' then 'Đã xếp phương án chuyến xe'
    when 'HANDOVER_ASSIGNED' then 'Bạn được giao bàn giao xe'
    when 'BOOKING_REASSIGNED' then 'Phương án chuyến xe đã thay đổi'
    when 'BOOKING_REASSIGNED_OLD_OPERATOR' then 'Bạn đã được gỡ khỏi chuyến xe'
    when 'BOOKING_REASSIGNED_NEW_OPERATOR' then 'Bạn được phân công chuyến xe'
    when 'ASSIGNMENT_DECLINED' then 'Người lái từ chối chuyến xe'
    when 'TRIP_COMPLETED' then 'Chuyến xe đã hoàn thành'
    when 'VEHICLE_RETURN_REQUIRED' then 'Cần nhận lại xe và chìa khóa'
    when 'BOOKING_CANCELLED' then 'Booking xe đã bị hủy'
    when 'BOOKING_NO_SHOW' then 'Booking xe được ghi nhận no-show'
    when 'FEEDBACK_AUTO_CLOSED' then 'Xác nhận sau chuyến đã tự đóng'
    when 'ISSUE_RESOLVED' then 'Phản ánh chuyến xe đã được xử lý'
    else 'Cập nhật booking xe'
  end;
$$;

with seeded_booking_admins as (
  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at,
    revoked_at,
    revoked_by,
    revoked_reason,
    grant_reason,
    updated_at
  )
  select
    app_user.id,
    'booking.vehicle.admin',
    'global',
    '*',
    true,
    app_user.id,
    now(),
    null,
    null,
    null,
    null,
    'Khởi tạo quyền quản trị Booking khi triển khai duyệt quản lý trực tiếp',
    now()
  from public.users app_user
  where app_user.role::text = 'ADMIN'
    and coalesce(app_user.is_active, true)
    and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = null,
      revoked_at = null,
      revoked_by = null,
      revoked_reason = null,
      grant_reason = excluded.grant_reason,
      updated_at = now()
  returning user_id
)
insert into public.permission_audit_events (
  actor_user_id,
  target_user_id,
  event_type,
  before_grants,
  after_grants,
  metadata
)
select
  seeded.user_id,
  seeded.user_id,
  'booking_admin_seeded',
  '[]'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'permissionCode', 'booking.vehicle.admin',
    'scopeType', 'global',
    'scopeId', '*'
  )),
  jsonb_build_object('source', 'request_vehicle_direct_manager_routing')
from seeded_booking_admins seeded;

revoke all on function app_private.vehicle_active_dispatcher_count()
  from public, anon, authenticated;
revoke all on function app_private.vehicle_enqueue_notification(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.vehicle_enqueue_dispatcher_notifications(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.preview_vehicle_booking_submission_route_impl(uuid)
  from public, anon, authenticated;
revoke all on function app_private.command_submit_vehicle_booking(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function app_private.command_update_fleet_system_settings(
  uuid, integer, integer, integer, integer, integer, numeric, integer, boolean, boolean, boolean
) from public, anon, authenticated;
revoke all on function app_private.command_reassign_vehicle_booking_manager(
  uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function app_private.vehicle_notification_title(text)
  from public, anon, authenticated;

revoke all on function public.preview_vehicle_booking_submission_route()
  from public, anon;
grant execute on function public.preview_vehicle_booking_submission_route()
  to authenticated;
revoke all on function public.submit_vehicle_booking(uuid, boolean)
  from public, anon;
grant execute on function public.submit_vehicle_booking(uuid, boolean)
  to authenticated;
revoke all on function public.update_fleet_system_settings(
  integer, integer, integer, integer, integer, numeric, integer, boolean, boolean, boolean
) from public, anon;
grant execute on function public.update_fleet_system_settings(
  integer, integer, integer, integer, integer, numeric, integer, boolean, boolean, boolean
) to authenticated;
revoke all on function public.reassign_vehicle_booking_manager(
  uuid, uuid, text, timestamptz
) from public, anon;
grant execute on function public.reassign_vehicle_booking_manager(
  uuid, uuid, text, timestamptz
) to authenticated;

notify pgrst, 'reload schema';

commit;
