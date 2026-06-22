-- Attendance v2:
-- - Direct hrm_attendance edits are admin-only.
-- - Employees still check in through the camera RPC.
-- - Location managers approve attendance proposals for their own site/office.
-- - Each employee/date keeps at most 6 camera events while preserving legacy
--   checkIn/checkOut columns as earliest check-in and latest check-out.

create schema if not exists app_private;
revoke all on schema app_private from anon, authenticated;

alter table public.hrm_attendance
  add column if not exists "events" jsonb not null default '[]'::jsonb,
  add column if not exists "eventCount" integer not null default 0,
  add column if not exists "approvalStatus" text not null default 'approved',
  add column if not exists "approvedBy" text,
  add column if not exists "approvedAt" timestamp with time zone,
  add column if not exists "submittedToUserId" text;

update public.hrm_attendance
set "events" = coalesce(
    nullif("events", '[]'::jsonb),
    (
      select coalesce(jsonb_agg(event_payload), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'action', 'check_in',
          'time', "checkIn",
          'source', 'legacy',
          'image_url', "checkInPhoto",
          'lat', "checkInLat",
          'lng', "checkInLng",
          'location_type', "locationType",
          'location_id', "constructionSiteId",
          'location_name', "locationName",
          'is_out_of_range', coalesce("isOutOfRange", false)
        ) as event_payload,
        1 as sort_order
        where "checkIn" is not null
        union all
        select jsonb_build_object(
          'action', 'check_out',
          'time', "checkOut",
          'source', 'legacy',
          'image_url', "checkOutPhoto",
          'lat', "checkOutLat",
          'lng', "checkOutLng",
          'location_type', "locationType",
          'location_id', "constructionSiteId",
          'location_name', "locationName",
          'is_out_of_range', coalesce("isOutOfRange", false)
        ) as event_payload,
        2 as sort_order
        where "checkOut" is not null
        order by sort_order
      ) events_to_seed
    )
  )
where "events" = '[]'::jsonb
  and ("checkIn" is not null or "checkOut" is not null);

update public.hrm_attendance
set "eventCount" = least(jsonb_array_length("events"), 6)
where jsonb_typeof("events") = 'array';

alter table public.hrm_attendance
  drop constraint if exists hrm_attendance_event_count_check;

alter table public.hrm_attendance
  add constraint hrm_attendance_event_count_check
  check (
    jsonb_typeof("events") = 'array'
    and jsonb_array_length("events") = "eventCount"
    and "eventCount" between 0 and 6
  ) not valid;

alter table public.hrm_attendance
  validate constraint hrm_attendance_event_count_check;

alter table public.hrm_attendance_proposals
  add column if not exists "submittedToUserId" text,
  add column if not exists "submittedToName" text,
  add column if not exists "locationName" text;

update public.hrm_attendance_proposals p
set "locationName" = coalesce(p."locationName", s.name),
    "submittedToUserId" = coalesce(p."submittedToUserId", nullif(s."managerId", ''))
from public.hrm_construction_sites s
where p."locationType" = 'construction_site'
  and p."locationId" = s.id::text;

update public.hrm_attendance_proposals p
set "locationName" = coalesce(p."locationName", o.name),
    "submittedToUserId" = coalesce(p."submittedToUserId", nullif(o."managerId", ''))
from public.hrm_offices o
where p."locationType" = 'office'
  and p."locationId" = o.id::text;

update public.hrm_attendance_proposals p
set "submittedToName" = coalesce(p."submittedToName", u.name)
from public.users u
where p."submittedToUserId" = u.id::text;

create index if not exists idx_hrm_attendance_event_count
  on public.hrm_attendance ("eventCount");

create index if not exists idx_hrm_attendance_proposals_submitted_to
  on public.hrm_attendance_proposals ("submittedToUserId", "proposalStatus");

create or replace function app_private.hrm_current_email()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select lower(coalesce(
    auth.jwt() ->> 'email',
    current_setting('request.jwt.claim.email', true),
    ''
  ));
$$;

create or replace function app_private.hrm_employee_is_current_user(p_employee_id text)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private, pg_temp
as $$
  select exists (
    select 1
    from public.employees e
    where e.id::text = p_employee_id
      and (
        e.user_id = public.current_app_user_id()
        or lower(coalesce(e.email, '')) = app_private.hrm_current_email()
      )
  );
$$;

create or replace function app_private.hrm_location_manager_id(
  p_location_type text,
  p_location_id text
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_location_type = 'construction_site' then (
      select nullif(s."managerId", '')
      from public.hrm_construction_sites s
      where s.id::text = p_location_id
      limit 1
    )
    when p_location_type = 'office' then (
      select nullif(o."managerId", '')
      from public.hrm_offices o
      where o.id::text = p_location_id
      limit 1
    )
    else null
  end;
$$;

create or replace function app_private.hrm_location_name(
  p_location_type text,
  p_location_id text,
  p_fallback text default null
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    case
      when p_location_type = 'construction_site' then (
        select s.name
        from public.hrm_construction_sites s
        where s.id::text = p_location_id
        limit 1
      )
      when p_location_type = 'office' then (
        select o.name
        from public.hrm_offices o
        where o.id::text = p_location_id
        limit 1
      )
      else null
    end,
    nullif(trim(coalesce(p_fallback, '')), '')
  );
$$;

create or replace function app_private.hrm_is_location_manager(
  p_location_type text,
  p_location_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, app_private, pg_temp
as $$
  select app_private.hrm_location_manager_id(p_location_type, p_location_id) = public.current_app_user_id()::text;
$$;

create or replace function app_private.employee_camera_checkin_v1(
  p_action text,
  p_employee_id uuid,
  p_work_date text,
  p_event_time text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_location_type text default null,
  p_location_id text default null,
  p_location_name text default null,
  p_distance_m integer default null,
  p_in_range boolean default null,
  p_image_url text default null,
  p_device_info jsonb default '{}'::jsonb
)
returns public.hrm_attendance
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_row public.hrm_attendance;
  v_existing public.hrm_attendance;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_app_user_id uuid := public.current_app_user_id();
  v_event jsonb;
  v_events jsonb;
  v_event_count integer;
  v_location_name text;
  v_location_note text;
  v_is_out_of_range boolean := coalesce(not p_in_range, false);
  v_check_in_is_earliest boolean := false;
  v_check_out_is_latest boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Phiên đăng nhập Supabase không hợp lệ.'
      using errcode = '28000';
  end if;

  if v_app_user_id is null then
    raise exception 'Không tìm thấy tài khoản ứng dụng tương ứng.'
      using errcode = '28000';
  end if;

  if v_action not in ('check_in', 'check_out') then
    raise exception 'Hành động chấm công không hợp lệ: %', coalesce(p_action, '<null>')
      using errcode = '22023';
  end if;

  if p_employee_id is null then
    raise exception 'Thiếu employee_id.'
      using errcode = '22023';
  end if;

  if not public.is_admin() and not app_private.hrm_employee_is_current_user(p_employee_id::text) then
    raise exception 'Bạn không có quyền chấm công cho nhân viên này.'
      using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_work_date, '')), '') is null then
    raise exception 'Thiếu ngày chấm công.'
      using errcode = '22023';
  end if;

  if nullif(trim(coalesce(p_event_time, '')), '') is null then
    raise exception 'Thiếu giờ chấm công.'
      using errcode = '22023';
  end if;

  if p_event_time !~ '^\d{2}:\d{2}$' then
    raise exception 'Giờ chấm công phải có định dạng HH:mm.'
      using errcode = '22023';
  end if;

  if p_lat is not null and (p_lat < -90 or p_lat > 90) then
    raise exception 'Latitude không hợp lệ: %', p_lat
      using errcode = '22023';
  end if;

  if p_lng is not null and (p_lng < -180 or p_lng > 180) then
    raise exception 'Longitude không hợp lệ: %', p_lng
      using errcode = '22023';
  end if;

  if p_location_type is not null and p_location_type not in ('construction_site', 'office') then
    raise exception 'Loại địa điểm không hợp lệ: %', p_location_type
      using errcode = '22023';
  end if;

  v_location_name := app_private.hrm_location_name(p_location_type, p_location_id, p_location_name);

  if p_location_type is not null and p_location_id is not null and v_location_name is null then
    raise exception 'Không tìm thấy địa điểm chấm công.'
      using errcode = '22023';
  end if;

  v_location_note := concat_ws(
    ' | ',
    'event=' || v_action || ':' || p_event_time,
    case when p_distance_m is not null then 'distance=' || p_distance_m::text || 'm' end,
    case when p_in_range is not null then 'in_range=' || p_in_range::text end
  );

  v_event := jsonb_build_object(
    'action', v_action,
    'time', p_event_time,
    'recorded_at', now(),
    'source', 'camera',
    'lat', p_lat,
    'lng', p_lng,
    'location_type', p_location_type,
    'location_id', p_location_id,
    'location_name', v_location_name,
    'distance_m', p_distance_m,
    'in_range', p_in_range,
    'is_out_of_range', v_is_out_of_range,
    'image_url', p_image_url,
    'device_info', coalesce(p_device_info, '{}'::jsonb)
  );

  select *
  into v_existing
  from public.hrm_attendance
  where "employeeId" = p_employee_id
    and date = p_work_date
  for update;

  if v_existing.id is null then
    if v_action = 'check_out' then
      raise exception 'Chưa có check-in ngày %, không thể check-out.', p_work_date
        using errcode = '23514';
    end if;

    insert into public.hrm_attendance (
      id,
      "employeeId",
      date,
      status,
      "checkIn",
      "checkOut",
      "checkInPhoto",
      "checkOutPhoto",
      "checkInLat",
      "checkInLng",
      "checkOutLat",
      "checkOutLng",
      "constructionSiteId",
      "locationName",
      "locationType",
      "isOutOfRange",
      note,
      "events",
      "eventCount",
      "approvalStatus",
      "submittedToUserId",
      "createdAt"
    )
    values (
      gen_random_uuid(),
      p_employee_id,
      p_work_date,
      'present',
      p_event_time,
      null,
      p_image_url,
      null,
      p_lat,
      p_lng,
      null,
      null,
      case when p_location_type = 'construction_site' then p_location_id else null end,
      v_location_name,
      p_location_type,
      v_is_out_of_range,
      nullif(v_location_note, ''),
      jsonb_build_array(v_event),
      1,
      'approved',
      app_private.hrm_location_manager_id(p_location_type, p_location_id),
      now()
    )
    returning * into v_row;

    return v_row;
  end if;

  v_events := case
    when jsonb_typeof(coalesce(v_existing."events", '[]'::jsonb)) = 'array'
      then coalesce(v_existing."events", '[]'::jsonb)
    else '[]'::jsonb
  end;
  v_event_count := jsonb_array_length(v_events);

  if v_event_count >= 6 then
    raise exception 'Hệ thống chỉ ghi nhận tối đa 6 lần chấm công trong ngày.'
      using errcode = '23514';
  end if;

  v_check_in_is_earliest := v_action = 'check_in'
    and (v_existing."checkIn" is null or p_event_time < v_existing."checkIn");

  v_check_out_is_latest := v_action = 'check_out'
    and (v_existing."checkOut" is null or p_event_time > v_existing."checkOut");

  update public.hrm_attendance
    set status = case when status = 'absent' then 'present' else status end,
        "checkIn" = case
          when v_action = 'check_in' and ("checkIn" is null or p_event_time < "checkIn") then p_event_time
          else "checkIn"
        end,
        "checkOut" = case
          when v_action = 'check_out' and ("checkOut" is null or p_event_time > "checkOut") then p_event_time
          else "checkOut"
        end,
        "checkInPhoto" = case
          when v_check_in_is_earliest then p_image_url
          else "checkInPhoto"
        end,
        "checkOutPhoto" = case
          when v_check_out_is_latest then p_image_url
          else "checkOutPhoto"
        end,
        "checkInLat" = case
          when v_check_in_is_earliest then p_lat
          else "checkInLat"
        end,
        "checkInLng" = case
          when v_check_in_is_earliest then p_lng
          else "checkInLng"
        end,
        "checkOutLat" = case
          when v_check_out_is_latest then p_lat
          else "checkOutLat"
        end,
        "checkOutLng" = case
          when v_check_out_is_latest then p_lng
          else "checkOutLng"
        end,
        "constructionSiteId" = coalesce(case when p_location_type = 'construction_site' then p_location_id end, "constructionSiteId"),
        "locationName" = coalesce(v_location_name, "locationName"),
        "locationType" = coalesce(p_location_type, "locationType"),
        "isOutOfRange" = coalesce("isOutOfRange", false) or v_is_out_of_range,
        note = left(concat_ws(E'\n', nullif(note, ''), nullif(v_location_note, '')), 1000),
        "events" = v_events || jsonb_build_array(v_event),
        "eventCount" = v_event_count + 1,
        "submittedToUserId" = coalesce("submittedToUserId", app_private.hrm_location_manager_id(p_location_type, p_location_id))
  where id = v_existing.id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.employee_camera_checkin_v1(
  p_action text,
  p_employee_id uuid,
  p_work_date text,
  p_event_time text,
  p_lat double precision default null,
  p_lng double precision default null,
  p_location_type text default null,
  p_location_id text default null,
  p_location_name text default null,
  p_distance_m integer default null,
  p_in_range boolean default null,
  p_image_url text default null,
  p_device_info jsonb default '{}'::jsonb
)
returns public.hrm_attendance
language sql
security invoker
set search_path = public, app_private, pg_temp
as $$
  select app_private.employee_camera_checkin_v1(
    p_action,
    p_employee_id,
    p_work_date,
    p_event_time,
    p_lat,
    p_lng,
    p_location_type,
    p_location_id,
    p_location_name,
    p_distance_m,
    p_in_range,
    p_image_url,
    p_device_info
  );
$$;

create or replace function app_private.review_attendance_proposal_v1(
  p_proposal_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare
  v_proposal public.hrm_attendance_proposals;
  v_updated_proposal public.hrm_attendance_proposals;
  v_attendance public.hrm_attendance;
  v_app_user_id uuid := public.current_app_user_id();
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_location_name text;
  v_can_review boolean;
begin
  if auth.uid() is null then
    raise exception 'Phiên đăng nhập Supabase không hợp lệ.'
      using errcode = '28000';
  end if;

  if v_app_user_id is null then
    raise exception 'Không tìm thấy tài khoản ứng dụng tương ứng.'
      using errcode = '28000';
  end if;

  if v_decision not in ('approved', 'rejected') then
    raise exception 'Quyết định duyệt đề xuất không hợp lệ.'
      using errcode = '22023';
  end if;

  select *
  into v_proposal
  from public.hrm_attendance_proposals
  where id = p_proposal_id
  for update;

  if v_proposal.id is null then
    raise exception 'Không tìm thấy đề xuất chấm công.'
      using errcode = 'P0002';
  end if;

  if v_proposal."proposalStatus" <> 'pending' then
    raise exception 'Đề xuất này đã được xử lý.'
      using errcode = '23514';
  end if;

  v_can_review := public.is_admin()
    or app_private.hrm_is_location_manager(v_proposal."locationType", v_proposal."locationId");

  if not v_can_review then
    raise exception 'Bạn không phải người quản lý địa điểm của đề xuất này.'
      using errcode = '42501';
  end if;

  v_location_name := app_private.hrm_location_name(
    v_proposal."locationType",
    v_proposal."locationId",
    v_proposal."locationName"
  );

  if v_decision = 'rejected' then
    update public.hrm_attendance_proposals
      set "proposalStatus" = 'rejected',
          "approvedBy" = v_app_user_id::text,
          "approvedAt" = now(),
          "rejectionReason" = coalesce(nullif(trim(p_rejection_reason), ''), 'Từ chối'),
          "submittedToUserId" = coalesce("submittedToUserId", app_private.hrm_location_manager_id("locationType", "locationId")),
          "submittedToName" = coalesce(
            "submittedToName",
            (select u.name from public.users u where u.id::text = app_private.hrm_location_manager_id("locationType", "locationId"))
          ),
          "locationName" = coalesce("locationName", v_location_name)
    where id = v_proposal.id
    returning * into v_updated_proposal;

    return jsonb_build_object(
      'proposal', to_jsonb(v_updated_proposal),
      'attendance', null
    );
  end if;

  update public.hrm_attendance_proposals
    set "proposalStatus" = 'approved',
        "approvedBy" = v_app_user_id::text,
        "approvedAt" = now(),
        "rejectionReason" = null,
        "submittedToUserId" = coalesce("submittedToUserId", app_private.hrm_location_manager_id("locationType", "locationId")),
        "submittedToName" = coalesce(
          "submittedToName",
          (select u.name from public.users u where u.id::text = app_private.hrm_location_manager_id("locationType", "locationId"))
        ),
        "locationName" = coalesce("locationName", v_location_name)
  where id = v_proposal.id
  returning * into v_updated_proposal;

  insert into public.hrm_attendance (
    id,
    "employeeId",
    date,
    status,
    "checkIn",
    "checkOut",
    "constructionSiteId",
    "locationName",
    "locationType",
    note,
    "approvalStatus",
    "approvedBy",
    "approvedAt",
    "submittedToUserId",
    "createdAt"
  )
  values (
    gen_random_uuid(),
    v_proposal."targetEmployeeId"::uuid,
    v_proposal.date::text,
    v_proposal.status,
    nullif(v_proposal."checkIn", ''),
    nullif(v_proposal."checkOut", ''),
    case when v_proposal."locationType" = 'construction_site' then v_proposal."locationId" else null end,
    v_location_name,
    v_proposal."locationType",
    left('Bù công từ đề xuất ' || v_proposal.id::text || ': ' || v_proposal.reason, 1000),
    'approved',
    v_app_user_id::text,
    now(),
    app_private.hrm_location_manager_id(v_proposal."locationType", v_proposal."locationId"),
    now()
  )
  on conflict ("employeeId", date) do update
    set status = excluded.status,
        "checkIn" = case
          when excluded."checkIn" is null then public.hrm_attendance."checkIn"
          when public.hrm_attendance."checkIn" is null then excluded."checkIn"
          when excluded."checkIn" < public.hrm_attendance."checkIn" then excluded."checkIn"
          else public.hrm_attendance."checkIn"
        end,
        "checkOut" = case
          when excluded."checkOut" is null then public.hrm_attendance."checkOut"
          when public.hrm_attendance."checkOut" is null then excluded."checkOut"
          when excluded."checkOut" > public.hrm_attendance."checkOut" then excluded."checkOut"
          else public.hrm_attendance."checkOut"
        end,
        "constructionSiteId" = coalesce(excluded."constructionSiteId", public.hrm_attendance."constructionSiteId"),
        "locationName" = coalesce(excluded."locationName", public.hrm_attendance."locationName"),
        "locationType" = coalesce(excluded."locationType", public.hrm_attendance."locationType"),
        note = left(concat_ws(E'\n', nullif(public.hrm_attendance.note, ''), excluded.note), 1000),
        "approvalStatus" = 'approved',
        "approvedBy" = excluded."approvedBy",
        "approvedAt" = excluded."approvedAt",
        "submittedToUserId" = coalesce(excluded."submittedToUserId", public.hrm_attendance."submittedToUserId")
  returning * into v_attendance;

  return jsonb_build_object(
    'proposal', to_jsonb(v_updated_proposal),
    'attendance', to_jsonb(v_attendance)
  );
end;
$$;

create or replace function public.review_attendance_proposal_v1(
  p_proposal_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = public, app_private, pg_temp
as $$
  select app_private.review_attendance_proposal_v1(
    p_proposal_id,
    p_decision,
    p_rejection_reason
  );
$$;

grant usage on schema app_private to authenticated;
grant execute on function app_private.employee_camera_checkin_v1(
  text,
  uuid,
  text,
  text,
  double precision,
  double precision,
  text,
  text,
  text,
  integer,
  boolean,
  text,
  jsonb
) to authenticated;
grant execute on function public.employee_camera_checkin_v1(
  text,
  uuid,
  text,
  text,
  double precision,
  double precision,
  text,
  text,
  text,
  integer,
  boolean,
  text,
  jsonb
) to authenticated;
grant execute on function app_private.review_attendance_proposal_v1(uuid, text, text) to authenticated;
grant execute on function public.review_attendance_proposal_v1(uuid, text, text) to authenticated;

alter table public.hrm_attendance enable row level security;
drop policy if exists attendance_select on public.hrm_attendance;
drop policy if exists attendance_insert on public.hrm_attendance;
drop policy if exists attendance_update on public.hrm_attendance;
drop policy if exists attendance_delete on public.hrm_attendance;
drop policy if exists attendance_write on public.hrm_attendance;

create policy attendance_select on public.hrm_attendance
for select
to authenticated
using (true);

create policy attendance_insert on public.hrm_attendance
for insert
to authenticated
with check (public.is_admin());

create policy attendance_update on public.hrm_attendance
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy attendance_delete on public.hrm_attendance
for delete
to authenticated
using (public.is_admin());

alter table public.hrm_attendance_proposals enable row level security;
drop policy if exists attendance_proposals_all_access on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_select on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_insert on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_update on public.hrm_attendance_proposals;
drop policy if exists attendance_proposals_delete on public.hrm_attendance_proposals;

create policy attendance_proposals_select on public.hrm_attendance_proposals
for select
to authenticated
using (
  public.is_admin()
  or app_private.hrm_employee_is_current_user("proposerEmployeeId")
  or app_private.hrm_employee_is_current_user("targetEmployeeId")
  or app_private.hrm_is_location_manager("locationType", "locationId")
);

create policy attendance_proposals_insert on public.hrm_attendance_proposals
for insert
to authenticated
with check (
  public.is_admin()
  or (
    "proposalStatus" = 'pending'
    and app_private.hrm_employee_is_current_user("proposerEmployeeId")
    and "targetEmployeeId" = "proposerEmployeeId"
  )
);

create policy attendance_proposals_update on public.hrm_attendance_proposals
for update
to authenticated
using (
  public.is_admin()
  or app_private.hrm_is_location_manager("locationType", "locationId")
)
with check (
  public.is_admin()
  or app_private.hrm_is_location_manager("locationType", "locationId")
);

create policy attendance_proposals_delete on public.hrm_attendance_proposals
for delete
to authenticated
using (public.is_admin());
