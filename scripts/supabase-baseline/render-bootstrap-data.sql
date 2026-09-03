select ddl
from (
  select '-- Allowlisted non-secret baseline configuration.'::text as ddl,
    '00:header'::text as sort_key

  union all

  select format(
    'insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types, type, versioning_status) select x.id, x.name, x.public, x.file_size_limit, x.allowed_mime_types, x.type, x.versioning_status from jsonb_populate_record(null::storage.buckets, %L::jsonb) x on conflict (id) do update set name = excluded.name, public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, type = excluded.type, versioning_status = excluded.versioning_status;',
    jsonb_build_object(
      'id', id,
      'name', name,
      'public', public,
      'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types,
      'type', type,
      'versioning_status', versioning_status
    )::text
  ) as ddl, '01:' || id as sort_key
  from storage.buckets

  union all

  select format(
    'insert into public.permission_applications select * from jsonb_populate_record(null::public.permission_applications, %L::jsonb) on conflict (id) do nothing;',
    to_jsonb(item)::text
  ), '02:' || item.code
  from public.permission_applications item

  union all

  select format(
    'insert into public.permission_modules select * from jsonb_populate_record(null::public.permission_modules, %L::jsonb) on conflict (id) do nothing;',
    to_jsonb(item)::text
  ), '03:' || item.code
  from public.permission_modules item

  union all

  select format(
    'insert into public.permission_actions select * from jsonb_populate_record(null::public.permission_actions, %L::jsonb) on conflict (id) do nothing;',
    to_jsonb(item)::text
  ), '04:' || item.permission_code
  from public.permission_actions item

  union all

  select format(
    'insert into app_private.permission_hardening_settings (key, value) values (%L, %L::jsonb) on conflict (key) do update set value = excluded.value;',
    key,
    value::text
  ), '05:' || key
  from app_private.permission_hardening_settings

  union all

  select format(
    'insert into app_private.hrm_manager_scope_settings (singleton, is_enabled, reason) values (%L, %L, %L) on conflict (singleton) do update set is_enabled = excluded.is_enabled, reason = excluded.reason;',
    singleton,
    is_enabled,
    reason
  ), '06:' || singleton::text
  from app_private.hrm_manager_scope_settings

  union all

  select format(
    'insert into public.fleet_system_settings (id, booking_buffer_minutes, late_cancellation_cutoff_minutes, feedback_auto_close_hours, home_base_warning_radius_meters, on_time_tolerance_minutes, max_evidence_image_mb, trip_reminder_minutes, require_handover_for_self_drive, allow_dispatch_approval_override, require_direct_manager_approval) values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L) on conflict (id) do update set booking_buffer_minutes = excluded.booking_buffer_minutes, late_cancellation_cutoff_minutes = excluded.late_cancellation_cutoff_minutes, feedback_auto_close_hours = excluded.feedback_auto_close_hours, home_base_warning_radius_meters = excluded.home_base_warning_radius_meters, on_time_tolerance_minutes = excluded.on_time_tolerance_minutes, max_evidence_image_mb = excluded.max_evidence_image_mb, trip_reminder_minutes = excluded.trip_reminder_minutes, require_handover_for_self_drive = excluded.require_handover_for_self_drive, allow_dispatch_approval_override = excluded.allow_dispatch_approval_override, require_direct_manager_approval = excluded.require_direct_manager_approval;',
    id,
    booking_buffer_minutes,
    late_cancellation_cutoff_minutes,
    feedback_auto_close_hours,
    home_base_warning_radius_meters,
    on_time_tolerance_minutes,
    max_evidence_image_mb,
    trip_reminder_minutes,
    require_handover_for_self_drive,
    allow_dispatch_approval_override,
    require_direct_manager_approval
  ), '07:' || id::text
  from public.fleet_system_settings

  union all

  select format(
    'select cron.schedule(%L, %L, %L);%supdate cron.job set active = false where jobname = %L;',
    jobname,
    schedule,
    command,
    E'\n',
    jobname
  ), '08:' || coalesce(jobname, jobid::text)
  from cron.job
) rendered
order by sort_key;
