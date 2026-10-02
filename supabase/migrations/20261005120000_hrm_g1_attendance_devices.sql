-- HRM G1 — anti buddy punching (owner decision 02/10/2026, docs/audits/hrm-attendance-leave-2026-10-02 §12):
--   1. Each punch is unlocked with the fingerprint / Face ID of the person's own phone (WebAuthn passkey,
--      verified by the hrm-attendance-passkey worker; only the public key is stored, no biometric data).
--   2. One person, one phone: a new phone waits for HR approval.
--   3. Suspicion flags: one phone or one GPS fix used for several people.

-- ── Settings & exemptions ─────────────────────────────────────────────────
create table if not exists public.hrm_attendance_settings (
  singleton boolean primary key default true check (singleton),
  require_device_passkey boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.hrm_attendance_settings (singleton) values (true) on conflict do nothing;
alter table public.hrm_attendance_settings enable row level security;
revoke all on public.hrm_attendance_settings from anon;
drop policy if exists hrm_attendance_settings_select on public.hrm_attendance_settings;
create policy hrm_attendance_settings_select on public.hrm_attendance_settings
  for select to authenticated using (true);
drop policy if exists hrm_attendance_settings_update on public.hrm_attendance_settings;
create policy hrm_attendance_settings_update on public.hrm_attendance_settings
  for update to authenticated
  using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
  with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));

-- Phones that cannot hold a passkey (old Android/iOS, no screen lock): HR exempts the person for a while.
create table if not exists public.hrm_attendance_passkey_exemptions (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 5),
  valid_until date,
  granted_by uuid,
  granted_at timestamptz not null default now()
);
alter table public.hrm_attendance_passkey_exemptions enable row level security;
revoke all on public.hrm_attendance_passkey_exemptions from anon;
drop policy if exists hrm_passkey_exemptions_select on public.hrm_attendance_passkey_exemptions;
create policy hrm_passkey_exemptions_select on public.hrm_attendance_passkey_exemptions
  for select to authenticated
  using (app_private.hrm_can_access_employee_subject(employee_id, 'hrm.attendance.view'::text));
drop policy if exists hrm_passkey_exemptions_write on public.hrm_attendance_passkey_exemptions;
create policy hrm_passkey_exemptions_write on public.hrm_attendance_passkey_exemptions
  for all to authenticated
  using ((select app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')))
  with check ((select app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')));

-- ── Devices (passkeys) ────────────────────────────────────────────────────
create table if not exists public.hrm_attendance_devices (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  user_id uuid not null,
  credential_id text not null unique,
  public_key text not null,
  sign_count bigint not null default 0,
  transports text[] not null default '{}',
  device_local_id text,
  device_label text,
  status text not null check (status in ('ACTIVE', 'PENDING', 'REVOKED')),
  pending_reason text,
  registered_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  last_used_at timestamptz
);
create unique index if not exists hrm_attendance_devices_one_active
  on public.hrm_attendance_devices (employee_id) where status = 'ACTIVE';
create index if not exists hrm_attendance_devices_local_idx
  on public.hrm_attendance_devices (device_local_id) where device_local_id is not null;
alter table public.hrm_attendance_devices enable row level security;
revoke all on public.hrm_attendance_devices from anon;
-- Read only (own devices, or HR); every change goes through the RPCs below.
drop policy if exists hrm_attendance_devices_select on public.hrm_attendance_devices;
create policy hrm_attendance_devices_select on public.hrm_attendance_devices
  for select to authenticated
  using (
    app_private.hrm_employee_is_current_user(employee_id::text)
    or (select app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive'))
  );
revoke insert, update, delete on public.hrm_attendance_devices from authenticated;

-- One-time WebAuthn challenges and the short-lived token a verified passkey yields. Worker only.
create table if not exists public.hrm_attendance_challenges (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  purpose text not null check (purpose in ('register', 'punch')),
  challenge text not null,
  expires_at timestamptz not null default now() + interval '5 minutes',
  used_at timestamptz
);
alter table public.hrm_attendance_challenges enable row level security;
revoke all on public.hrm_attendance_challenges from anon, authenticated;

create table if not exists public.hrm_attendance_punch_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  device_id uuid not null references public.hrm_attendance_devices(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '2 minutes',
  used_at timestamptz
);
alter table public.hrm_attendance_punch_tokens enable row level security;
revoke all on public.hrm_attendance_punch_tokens from anon, authenticated;

alter table public.hrm_attendance add column if not exists "suspicionFlags" jsonb not null default '[]'::jsonb;

-- ── Worker functions (service role) ───────────────────────────────────────
-- Registers a verified passkey. The first phone of a person is active at once unless the
-- phone already belongs to someone else; any later phone waits for HR.
create or replace function app_private.hrm_register_attendance_device(
  p_employee_id uuid, p_user_id uuid, p_credential_id text, p_public_key text,
  p_sign_count bigint, p_transports text[], p_device_local_id text, p_device_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_has_device boolean;
  v_shared boolean;
  v_status text;
  v_reason text;
  v_row public.hrm_attendance_devices;
begin
  select exists (select 1 from public.hrm_attendance_devices where employee_id = p_employee_id and status <> 'REVOKED')
  into v_has_device;
  select p_device_local_id is not null and exists (
    select 1 from public.hrm_attendance_devices
    where device_local_id = p_device_local_id and employee_id <> p_employee_id and status <> 'REVOKED'
  ) into v_shared;

  if v_shared then
    v_status := 'PENDING'; v_reason := 'shared_device';
  elsif v_has_device then
    v_status := 'PENDING'; v_reason := 'new_device';
  else
    v_status := 'ACTIVE';
  end if;

  insert into public.hrm_attendance_devices (
    employee_id, user_id, credential_id, public_key, sign_count, transports,
    device_local_id, device_label, status, pending_reason
  ) values (
    p_employee_id, p_user_id, p_credential_id, p_public_key, coalesce(p_sign_count, 0), coalesce(p_transports, '{}'),
    nullif(trim(p_device_local_id), ''), left(nullif(trim(p_device_label), ''), 120), v_status, v_reason
  )
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'pendingReason', v_row.pending_reason);
end;
$function$;

-- Records a verified assertion (sign counter) and returns a single-use punch token.
create or replace function app_private.hrm_issue_attendance_punch_token(
  p_employee_id uuid, p_credential_id text, p_new_sign_count bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device public.hrm_attendance_devices;
  v_token uuid;
begin
  select * into v_device from public.hrm_attendance_devices
  where credential_id = p_credential_id and employee_id = p_employee_id
  for update;
  if v_device.id is null then
    raise exception using errcode = '42501', message = 'HRM_PASSKEY_UNKNOWN_DEVICE';
  end if;
  if v_device.status <> 'ACTIVE' then
    raise exception using errcode = '42501', message = 'HRM_PASSKEY_DEVICE_NOT_ACTIVE';
  end if;
  -- A counter that goes backwards means a cloned authenticator (0 = authenticator without counter).
  if coalesce(p_new_sign_count, 0) > 0 and p_new_sign_count <= v_device.sign_count then
    raise exception using errcode = '42501', message = 'HRM_PASSKEY_COUNTER_REPLAY';
  end if;
  update public.hrm_attendance_devices
  set sign_count = greatest(sign_count, coalesce(p_new_sign_count, 0)), last_used_at = now()
  where id = v_device.id;
  insert into public.hrm_attendance_punch_tokens (employee_id, device_id) values (p_employee_id, v_device.id)
  returning id into v_token;
  delete from public.hrm_attendance_punch_tokens where expires_at < now() - interval '1 day';
  delete from public.hrm_attendance_challenges where expires_at < now() - interval '1 day';
  return v_token;
end;
$function$;

create or replace function public.hrm_register_attendance_device(
  p_employee_id uuid, p_user_id uuid, p_credential_id text, p_public_key text,
  p_sign_count bigint, p_transports text[], p_device_local_id text, p_device_label text
)
returns jsonb language sql set search_path = ''
as $function$
  select app_private.hrm_register_attendance_device(p_employee_id, p_user_id, p_credential_id, p_public_key,
    p_sign_count, p_transports, p_device_local_id, p_device_label);
$function$;

create or replace function public.hrm_issue_attendance_punch_token(p_employee_id uuid, p_credential_id text, p_new_sign_count bigint)
returns uuid language sql set search_path = ''
as $function$
  select app_private.hrm_issue_attendance_punch_token(p_employee_id, p_credential_id, p_new_sign_count);
$function$;

revoke all on function app_private.hrm_register_attendance_device(uuid, uuid, text, text, bigint, text[], text, text) from public, anon, authenticated;
revoke all on function app_private.hrm_issue_attendance_punch_token(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.hrm_register_attendance_device(uuid, uuid, text, text, bigint, text[], text, text) from public, anon, authenticated;
revoke all on function public.hrm_issue_attendance_punch_token(uuid, text, bigint) from public, anon, authenticated;
grant execute on function app_private.hrm_register_attendance_device(uuid, uuid, text, text, bigint, text[], text, text) to service_role;
grant execute on function app_private.hrm_issue_attendance_punch_token(uuid, text, bigint) to service_role;
grant execute on function public.hrm_register_attendance_device(uuid, uuid, text, text, bigint, text[], text, text) to service_role;
grant execute on function public.hrm_issue_attendance_punch_token(uuid, text, bigint) to service_role;

-- ── HR decisions on phones ────────────────────────────────────────────────
create or replace function public.decide_hrm_attendance_device(p_device_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_device public.hrm_attendance_devices;
begin
  if v_actor is null or not app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive') then
    raise exception using errcode = '42501', message = 'Chỉ HR được duyệt hoặc thu hồi thiết bị chấm công.';
  end if;
  if p_decision not in ('approve', 'revoke') then
    raise exception using errcode = '22023', message = 'Quyết định không hợp lệ.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).';
  end if;
  select * into v_device from public.hrm_attendance_devices where id = p_device_id for update;
  if v_device.id is null then
    raise exception using errcode = 'P0002', message = 'Không tìm thấy thiết bị.';
  end if;
  if v_device.user_id = v_actor then
    raise exception using errcode = '42501', message = 'Không tự duyệt thiết bị của chính mình. Nhờ HR khác duyệt.';
  end if;

  if p_decision = 'approve' then
    if v_device.status <> 'PENDING' then
      raise exception using errcode = '23514', message = 'Chỉ duyệt được thiết bị đang chờ.';
    end if;
    -- The approved phone replaces the person's previous one.
    update public.hrm_attendance_devices
    set status = 'REVOKED', decided_by = v_actor, decided_at = now(), decision_reason = 'Thay bằng thiết bị mới được duyệt'
    where employee_id = v_device.employee_id and status = 'ACTIVE';
    update public.hrm_attendance_devices
    set status = 'ACTIVE', decided_by = v_actor, decided_at = now(), decision_reason = trim(p_reason)
    where id = v_device.id
    returning * into v_device;
  else
    update public.hrm_attendance_devices
    set status = 'REVOKED', decided_by = v_actor, decided_at = now(), decision_reason = trim(p_reason)
    where id = v_device.id
    returning * into v_device;
  end if;
  return jsonb_build_object('id', v_device.id, 'status', v_device.status);
end;
$function$;
revoke all on function public.decide_hrm_attendance_device(uuid, text, text) from public, anon;
grant execute on function public.decide_hrm_attendance_device(uuid, text, text) to authenticated, service_role;

-- ── Punch with passkey token ──────────────────────────────────────────────
drop function if exists public.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb);
drop function if exists app_private.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb);

create or replace function app_private.employee_attendance_punch_v2(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_location_type text,
  p_location_id text,
  p_image_url text,
  p_device_info jsonb default '{}'::jsonb,
  p_punch_token uuid default null
)
returns public.hrm_attendance
language plpgsql
security definer
set search_path = ''
as $function$
declare
  c_max_accuracy_m constant double precision := 100;
  c_max_events constant integer := 10;
  v_app_user_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_local timestamp := (now() at time zone 'Asia/Ho_Chi_Minh');
  v_work_date text := to_char(v_local, 'YYYY-MM-DD');
  v_time text := to_char(v_local, 'HH24:MI');
  v_location_name text;
  v_location_lat double precision;
  v_location_lng double precision;
  v_radius integer;
  v_manager_id text;
  v_distance integer;
  v_image_path text;
  v_existing public.hrm_attendance;
  v_row public.hrm_attendance;
  v_action text;
  v_event jsonb;
  v_events jsonb;
  v_require_passkey boolean;
  v_exempt boolean;
  v_token public.hrm_attendance_punch_tokens;
  v_device public.hrm_attendance_devices;
  v_flags jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null or v_app_user_id is null then
    raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.';
  end if;

  select employee.* into v_employee
  from public.employees employee
  where employee.user_id = v_app_user_id and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;
  if v_employee.id is null then
    raise exception using errcode = '42501', message = 'Tài khoản chưa được liên kết hồ sơ nhân sự. Liên hệ phòng HCNS.';
  end if;

  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception using errcode = '22023', message = 'Chưa lấy được vị trí GPS của điện thoại.';
  end if;
  if p_accuracy_m is null or p_accuracy_m <= 0 then
    raise exception using errcode = '22023', message = 'Chưa xác định được độ chính xác GPS. Hãy thử lại.';
  end if;
  if p_accuracy_m > c_max_accuracy_m then
    raise exception using errcode = '22023',
      message = format('GPS chưa đủ chính xác (sai số ±%s m, cần ≤ %s m). Hãy ra chỗ thoáng, bật định vị chính xác rồi thử lại.',
        round(p_accuracy_m), c_max_accuracy_m);
  end if;

  if p_location_type = 'construction_site' then
    select site.name, site.latitude, site.longitude, coalesce(site."checkInRadius", 300), nullif(site."managerId", '')
    into v_location_name, v_location_lat, v_location_lng, v_radius, v_manager_id
    from public.hrm_construction_sites site where site.id::text = p_location_id;
  elsif p_location_type = 'office' then
    select office.name, office.latitude, office.longitude, coalesce(office."checkInRadius", 150), nullif(office."managerId", '')
    into v_location_name, v_location_lat, v_location_lng, v_radius, v_manager_id
    from public.hrm_offices office where office.id::text = p_location_id;
  else
    raise exception using errcode = '22023', message = 'Địa điểm chấm công không hợp lệ.';
  end if;

  if v_location_name is null then
    raise exception using errcode = '22023', message = 'Không tìm thấy địa điểm chấm công.';
  end if;
  if v_location_lat is null or v_location_lng is null then
    raise exception using errcode = '22023',
      message = format('"%s" chưa được cấu hình tọa độ. Liên hệ người quản lý địa điểm.', v_location_name);
  end if;

  v_distance := round(6371000 * 2 * asin(sqrt(
    power(sin(radians(p_lat - v_location_lat) / 2), 2)
    + cos(radians(v_location_lat)) * cos(radians(p_lat)) * power(sin(radians(p_lng - v_location_lng) / 2), 2)
  )));

  if v_distance > v_radius then
    raise exception using errcode = '23514',
      message = format('Bạn đang ngoài phạm vi chấm công của "%s" (cách %s m, cho phép %s m). Nếu đang làm việc tại đây, hãy gửi Đề xuất chấm công bù.',
        v_location_name, v_distance, v_radius);
  end if;

  -- The photo must be the caller's own object, already uploaded to the private bucket.
  v_image_path := substring(coalesce(p_image_url, '') from '/storage/v1/object/public/checkin-photos/(.+)$');
  if v_image_path is null
    or split_part(v_image_path, '/', 1) <> v_employee.id::text
    or not exists (
      select 1 from storage.objects object_row
      where object_row.bucket_id = 'checkin-photos' and object_row.name = v_image_path
    )
  then
    raise exception using errcode = '22023', message = 'Chưa tải được ảnh chấm công. Hãy chụp lại.';
  end if;

  -- G1: the punch must come from the person's own registered phone, unlocked with
  -- its fingerprint / Face ID (passkey verified by the hrm-attendance-passkey worker).
  select coalesce((select setting.require_device_passkey from public.hrm_attendance_settings setting where setting.singleton), true)
  into v_require_passkey;
  select exists (
    select 1 from public.hrm_attendance_passkey_exemptions exemption
    where exemption.employee_id = v_employee.id
      and (exemption.valid_until is null or exemption.valid_until >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)
  ) into v_exempt;

  if p_punch_token is not null then
    update public.hrm_attendance_punch_tokens token_row
    set used_at = now()
    where token_row.id = p_punch_token
      and token_row.employee_id = v_employee.id
      and token_row.used_at is null
      and token_row.expires_at > now()
    returning * into v_token;
    if v_token.id is null then
      raise exception using errcode = '42501', message = 'Xác thực vân tay / Face ID đã hết hạn. Hãy bấm chấm công lại.';
    end if;
    select device.* into v_device from public.hrm_attendance_devices device
    where device.id = v_token.device_id and device.status = 'ACTIVE';
    if v_device.id is null then
      raise exception using errcode = '42501', message = 'Thiết bị chấm công chưa được duyệt hoặc đã bị thu hồi. Liên hệ phòng HCNS.';
    end if;
  elsif v_require_passkey and not v_exempt then
    raise exception using errcode = '42501',
      message = 'Cần xác thực vân tay / Face ID trên điện thoại đã đăng ký. Vui lòng tải lại trang rồi chấm công lại.';
  else
    v_flags := v_flags || jsonb_build_array('no_passkey');
  end if;

  -- Layer 3: signs that one phone or one GPS fix is used for several people.
  if v_device.id is not null and v_device.device_local_id is not null and exists (
    select 1 from public.hrm_attendance_devices other_device
    where other_device.device_local_id = v_device.device_local_id
      and other_device.employee_id <> v_employee.id
  ) then
    v_flags := v_flags || jsonb_build_array('shared_device');
  end if;
  if exists (
    select 1
    from public.hrm_attendance other_day, jsonb_array_elements(coalesce(other_day.events, '[]'::jsonb)) other_event
    where other_day.date = v_work_date
      and other_day."employeeId" <> v_employee.id
      and (other_event ->> 'recorded_at')::timestamptz > now() - interval '60 seconds'
      and round((other_event ->> 'lat')::numeric, 6) = round(p_lat::numeric, 6)
      and round((other_event ->> 'lng')::numeric, 6) = round(p_lng::numeric, 6)
  ) then
    v_flags := v_flags || jsonb_build_array('same_gps_fix');
  end if;

  select attendance.* into v_existing
  from public.hrm_attendance attendance
  where attendance."employeeId" = v_employee.id and attendance.date = v_work_date
  for update;

  v_events := case
    when jsonb_typeof(coalesce(v_existing."events", '[]'::jsonb)) = 'array' then coalesce(v_existing."events", '[]'::jsonb)
    else '[]'::jsonb
  end;
  if jsonb_array_length(v_events) >= c_max_events then
    raise exception using errcode = '23514',
      message = format('Hôm nay đã ghi nhận %s lượt chấm công, không ghi thêm.', c_max_events);
  end if;

  -- First punch of the day is "vào"; any later punch moves "ra".
  v_action := case when v_existing.id is null or v_existing."checkIn" is null then 'check_in' else 'check_out' end;

  v_event := jsonb_build_object(
    'action', v_action,
    'time', v_time,
    'recorded_at', now(),
    'source', 'camera_v2',
    'lat', p_lat,
    'lng', p_lng,
    'accuracy_m', round(p_accuracy_m),
    'location_type', p_location_type,
    'location_id', p_location_id,
    'location_name', v_location_name,
    'distance_m', v_distance,
    'radius_m', v_radius,
    'in_range', true,
    'is_out_of_range', false,
    'image_url', p_image_url,
    'device_info', coalesce(p_device_info, '{}'::jsonb),
    'device_id', v_device.id,
    'passkey', v_device.id is not null,
    'flags', v_flags
  );

  if v_existing.id is null then
    insert into public.hrm_attendance (
      id, "employeeId", date, status, "checkIn", "checkInPhoto", "checkInLat", "checkInLng",
      "constructionSiteId", "locationName", "locationType", "isOutOfRange", note,
      "events", "eventCount", "approvalStatus", "submittedToUserId", "createdAt", "suspicionFlags"
    ) values (
      gen_random_uuid(), v_employee.id, v_work_date, 'present', v_time, p_image_url, p_lat, p_lng,
      case when p_location_type = 'construction_site' then p_location_id end, v_location_name, p_location_type, false,
      format('event=%s:%s | distance=%sm | accuracy=%sm', v_action, v_time, v_distance, round(p_accuracy_m)),
      jsonb_build_array(v_event), 1, 'approved', v_manager_id, now(), v_flags
    )
    returning * into v_row;
    return v_row;
  end if;

  update public.hrm_attendance
  set status = case when status = 'absent' then 'present' else status end,
      "checkIn" = case when v_action = 'check_in' then v_time else "checkIn" end,
      "checkInPhoto" = case when v_action = 'check_in' then p_image_url else "checkInPhoto" end,
      "checkInLat" = case when v_action = 'check_in' then p_lat else "checkInLat" end,
      "checkInLng" = case when v_action = 'check_in' then p_lng else "checkInLng" end,
      "checkOut" = case when v_action = 'check_out' then v_time else "checkOut" end,
      "checkOutPhoto" = case when v_action = 'check_out' then p_image_url else "checkOutPhoto" end,
      "checkOutLat" = case when v_action = 'check_out' then p_lat else "checkOutLat" end,
      "checkOutLng" = case when v_action = 'check_out' then p_lng else "checkOutLng" end,
      "constructionSiteId" = coalesce(case when p_location_type = 'construction_site' then p_location_id end, "constructionSiteId"),
      "locationName" = v_location_name,
      "locationType" = p_location_type,
      note = left(concat_ws(E'\n', nullif(note, ''),
        format('event=%s:%s | distance=%sm | accuracy=%sm', v_action, v_time, v_distance, round(p_accuracy_m))), 1000),
      "events" = v_events || jsonb_build_array(v_event),
      "eventCount" = jsonb_array_length(v_events) + 1,
      "submittedToUserId" = coalesce("submittedToUserId", v_manager_id),
      "suspicionFlags" = (
        select coalesce(jsonb_agg(distinct flag), '[]'::jsonb)
        from jsonb_array_elements(coalesce("suspicionFlags", '[]'::jsonb) || v_flags) flag
      )
  where id = v_existing.id
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.employee_attendance_punch_v2(
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_location_type text,
  p_location_id text,
  p_image_url text,
  p_device_info jsonb default '{}'::jsonb,
  p_punch_token uuid default null
)
returns public.hrm_attendance
language sql
set search_path = ''
as $function$
  select app_private.employee_attendance_punch_v2(
    p_lat, p_lng, p_accuracy_m, p_location_type, p_location_id, p_image_url, p_device_info, p_punch_token
  );
$function$;

revoke all on function app_private.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb, uuid) from public, anon;
grant execute on function app_private.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb, uuid) to authenticated, service_role;
revoke all on function public.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.employee_attendance_punch_v2(double precision, double precision, double precision, text, text, text, jsonb, uuid) to authenticated, service_role;
