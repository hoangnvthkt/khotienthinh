-- HRM G2 — leave policy and approval (owner decisions 02/10/2026, docs/audits/hrm-attendance-leave-2026-10-02 §4.2, §11):
--   * Step 1 approver is found by the system: site staff → the construction site's approver;
--     everyone else → their manager in the org chart (fallback: the account's direct manager, then HR).
--   * Annual / unpaid leave over 3 working days adds step 2: CEO Dương Xuân Thịnh (Admin can change it).
--   * Days are working days (Sunday, holidays and — if configured — Saturday excluded); half days allowed.
--   * Late arrival / early leave: up to 60 minutes per request; approved → full credit.
--   * Probation has no annual leave. Balance moves only when a request is finally approved or cancelled.
--   * All writes go through these RPCs; the approval log is append-only.

-- ── Settings ───────────────────────────────────────────────────────────────
create table if not exists public.hrm_leave_settings (
  singleton boolean primary key default true check (singleton),
  second_step_threshold_days numeric(4,1) not null default 3 check (second_step_threshold_days >= 0),
  second_step_approver_user_id uuid references public.users(id),
  second_step_label text not null default 'Tổng giám đốc',
  late_early_max_minutes integer not null default 60 check (late_early_max_minutes between 5 and 480),
  saturday_is_workday boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.hrm_leave_settings (singleton, second_step_approver_user_id)
select true, (select u.id from public.users u where lower(u.email) = 'thinhdx@tienthinhjsc.vn' limit 1)
on conflict (singleton) do nothing;
alter table public.hrm_leave_settings enable row level security;
revoke all on public.hrm_leave_settings from anon;
drop policy if exists hrm_leave_settings_select on public.hrm_leave_settings;
create policy hrm_leave_settings_select on public.hrm_leave_settings for select to authenticated using (true);
drop policy if exists hrm_leave_settings_update on public.hrm_leave_settings;
create policy hrm_leave_settings_update on public.hrm_leave_settings for update to authenticated
  using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
  with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));

-- ── Leave types ────────────────────────────────────────────────────────────
create table if not exists public.hrm_leave_types (
  code text primary key,
  name text not null,
  description text,
  paid_by text not null check (paid_by in ('company', 'social_insurance', 'none')),
  deducts_annual boolean not null default false,
  unit text not null default 'day' check (unit in ('day', 'minute')),
  needs_second_step boolean not null default false,
  requires_official boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100
);
insert into public.hrm_leave_types (code, name, description, paid_by, deducts_annual, unit, needs_second_step, requires_official, sort_order) values
  ('annual', 'Phép năm', 'Trừ vào số ngày phép năm.', 'company', true, 'day', true, true, 10),
  ('personal', 'Việc riêng có lương', 'Kết hôn 3 ngày; con kết hôn 1 ngày; bố mẹ (hai bên), vợ/chồng, con mất 3 ngày (Điều 115 BLLĐ).', 'company', false, 'day', false, false, 20),
  ('personal_unpaid', 'Việc riêng không lương', 'Ông bà, anh chị em ruột mất; bố mẹ, anh chị em kết hôn: 1 ngày (Điều 115 BLLĐ).', 'none', false, 'day', false, false, 30),
  ('unpaid', 'Nghỉ không lương', 'Khi chưa có hoặc đã hết phép năm, theo thỏa thuận.', 'none', false, 'day', true, false, 40),
  ('sick', 'Ốm đau (BHXH)', 'Quỹ BHXH chi trả; nộp giấy nghỉ hưởng BHXH cho HCNS.', 'social_insurance', false, 'day', false, false, 50),
  ('maternity', 'Thai sản (BHXH)', 'Khám thai, sinh con, vợ sinh con — quỹ BHXH chi trả.', 'social_insurance', false, 'day', false, false, 60),
  ('late_early', 'Đi muộn / về sớm có lý do', 'Tối đa theo hạn mức mỗi lần; được duyệt thì tính đủ công.', 'company', false, 'minute', false, false, 70),
  ('business_trip', 'Công tác', 'Làm việc ngoài địa điểm, vẫn tính công.', 'company', false, 'day', false, false, 80),
  ('other', 'Khác', 'Loại cũ, không dùng cho đơn mới.', 'none', false, 'day', false, false, 999)
on conflict (code) do nothing;
update public.hrm_leave_types set is_active = false where code = 'other';
alter table public.hrm_leave_types enable row level security;
revoke all on public.hrm_leave_types from anon;
drop policy if exists hrm_leave_types_select on public.hrm_leave_types;
create policy hrm_leave_types_select on public.hrm_leave_types for select to authenticated using (true);
drop policy if exists hrm_leave_types_write on public.hrm_leave_types;
create policy hrm_leave_types_write on public.hrm_leave_types for update to authenticated
  using ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')))
  with check ((select app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')));

-- ── Request columns ────────────────────────────────────────────────────────
alter table public.hrm_leave_requests
  add column if not exists start_session text not null default 'full',
  add column if not exists end_session text not null default 'full',
  add column if not exists minutes integer,
  add column if not exists subtype text,
  add column if not exists current_step integer,
  add column if not exists created_by uuid,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;
alter table public.hrm_leave_requests drop constraint if exists hrm_leave_requests_sessions_check;
alter table public.hrm_leave_requests add constraint hrm_leave_requests_sessions_check
  check (start_session in ('full', 'morning', 'afternoon') and end_session in ('full', 'morning', 'afternoon'));
-- Late / early requests are measured in minutes and count 0 days.
alter table public.hrm_leave_requests drop constraint if exists hrm_leave_requests_total_days_half_step;
alter table public.hrm_leave_requests add constraint hrm_leave_requests_total_days_half_step
  check ("totalDays" >= 0 and "totalDays" * 2 = floor("totalDays" * 2));
create index if not exists hrm_leave_requests_employee_idx on public.hrm_leave_requests ("employeeId", "createdAt" desc);
create index if not exists hrm_leave_requests_approvers_idx on public.hrm_leave_requests using gin (approvers jsonb_path_ops);

-- ── Working days ───────────────────────────────────────────────────────────
create or replace function app_private.hrm_leave_working_days(
  p_start date, p_end date, p_start_session text default 'full', p_end_session text default 'full'
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_saturday boolean := coalesce((select saturday_is_workday from public.hrm_leave_settings where singleton), true);
  v_days numeric := 0;
  v_day date;
  v_is_workday boolean;
begin
  if p_start is null or p_end is null or p_end < p_start then return 0; end if;
  for v_day in select generate_series(p_start, p_end, interval '1 day')::date loop
    v_is_workday := extract(isodow from v_day) <> 7
      and (v_saturday or extract(isodow from v_day) <> 6)
      and not exists (select 1 from public.hrm_holidays holiday where holiday.date = v_day);
    if v_is_workday then
      if p_start = p_end and p_start_session in ('morning', 'afternoon') then
        v_days := v_days + 0.5;
      elsif v_day = p_start and p_start_session = 'afternoon' then
        v_days := v_days + 0.5;
      elsif v_day = p_end and p_end_session = 'morning' then
        v_days := v_days + 0.5;
      else
        v_days := v_days + 1;
      end if;
    end if;
  end loop;
  return v_days;
end;
$function$;
revoke all on function app_private.hrm_leave_working_days(date, date, text, text) from public, anon;
grant execute on function app_private.hrm_leave_working_days(date, date, text, text) to authenticated, service_role;

-- ── Approval chain ─────────────────────────────────────────────────────────
create or replace function app_private.hrm_leave_approval_chain(p_employee_id uuid, p_type text, p_days numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_settings public.hrm_leave_settings%rowtype;
  v_step1_user uuid;
  v_step1_label text;
  v_step1_kind text := 'manager';
  v_steps jsonb := '[]'::jsonb;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  select * into v_type from public.hrm_leave_types where code = p_type;
  select * into v_settings from public.hrm_leave_settings where singleton;

  -- Site staff: the person Admin assigned to approve for that construction site.
  if v_employee.construction_site_id is not null then
    select nullif(site."managerId", '')::uuid into v_step1_user
    from public.hrm_construction_sites site where site.id = v_employee.construction_site_id;
    v_step1_label := 'Quản lý công trường';
  end if;
  -- Everyone else: their manager in the org chart, then the account's direct manager.
  if v_step1_user is null then
    v_step1_user := app_private.resolve_slot_direct_manager(v_employee.user_id);
    v_step1_label := 'Quản lý trong sơ đồ tổ chức';
  end if;
  if v_step1_user is null then
    select u.manager_id into v_step1_user from public.users u where u.id = v_employee.user_id;
    v_step1_label := 'Quản lý trực tiếp';
  end if;
  -- Nobody approves their own request: the step moves up to the second-step approver.
  if v_step1_user = v_employee.user_id then
    v_step1_user := v_settings.second_step_approver_user_id;
    v_step1_label := v_settings.second_step_label;
  end if;
  if v_step1_user is null or v_step1_user = v_employee.user_id then
    v_step1_user := null;
    v_step1_kind := 'hr';
    v_step1_label := 'Phòng Hành chính - Nhân sự';
  end if;

  v_steps := jsonb_build_array(jsonb_build_object(
    'order', 1, 'kind', v_step1_kind, 'userId', v_step1_user, 'label', v_step1_label, 'status', 'waiting'));

  if coalesce(v_type.needs_second_step, false)
    and p_days > v_settings.second_step_threshold_days
    and v_settings.second_step_approver_user_id is not null
    and v_settings.second_step_approver_user_id is distinct from v_step1_user
    and v_settings.second_step_approver_user_id <> v_employee.user_id
  then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'order', 2, 'kind', 'director', 'userId', v_settings.second_step_approver_user_id,
      'label', v_settings.second_step_label, 'status', 'waiting'));
  end if;
  return v_steps;
end;
$function$;
revoke all on function app_private.hrm_leave_approval_chain(uuid, text, numeric) from public, anon, authenticated;

-- ── Notifications ──────────────────────────────────────────────────────────
create or replace function app_private.notify_hrm_leave(p_request_id uuid, p_user_ids uuid[], p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.notifications (
    user_id, title, body, type, priority, module, link, metadata, category, message, severity,
    source_type, source_id, push_enabled, action_url, entity_type, entity_id, delivery_reason
  )
  select distinct recipient::text, p_title, p_body, 'info', 'normal', 'HRM',
    '/hrm/leave?request=' || p_request_id, jsonb_build_object('leaveRequestId', p_request_id),
    'hrm_leave', p_body, 'info', 'hrm_leave', p_request_id::text, true,
    '/hrm/leave?request=' || p_request_id, 'hrm_leave_request', p_request_id, 'assigned'
  from unnest(p_user_ids) recipient
  where recipient is not null;
end;
$function$;
revoke all on function app_private.notify_hrm_leave(uuid, uuid[], text, text) from public, anon, authenticated;

create or replace function app_private.hrm_leave_hr_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(u.id), '{}')
  from public.users u
  where coalesce(u.is_active, true)
    and app_private.has_hrm_template_permission(u.id, 'hrm.employee.view_sensitive');
$function$;
revoke all on function app_private.hrm_leave_hr_user_ids() from public, anon, authenticated;

-- ── Preview ────────────────────────────────────────────────────────────────
create or replace function app_private.hrm_leave_annual_remaining(p_employee_id uuid, p_year integer, p_exclude_request uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((
    select balance."accruedDays" - balance."usedPaidDays"
    from public.hrm_leave_balances balance
    where balance."employeeId" = p_employee_id and balance.year = p_year
    limit 1
  ), 0) - coalesce((
    select sum(request."totalDays") from public.hrm_leave_requests request
    where request."employeeId" = p_employee_id and request.type = 'annual' and request.status = 'pending'
      and left(request."startDate", 4)::integer = p_year
      and request.id is distinct from p_exclude_request
  ), 0);
$function$;
revoke all on function app_private.hrm_leave_annual_remaining(uuid, integer, uuid) from public, anon, authenticated;

create or replace function public.preview_my_leave_request(
  p_type text, p_start date, p_end date, p_start_session text default 'full', p_end_session text default 'full', p_minutes integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_settings public.hrm_leave_settings%rowtype;
  v_days numeric := 0;
  v_steps jsonb;
  v_remaining numeric;
  v_problems jsonb := '[]'::jsonb;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  select * into v_employee from public.employees
  where user_id = v_user and status = 'Đang làm việc' order by updated_at desc nulls last limit 1;
  if v_employee.id is null then raise exception using errcode = '42501', message = 'Tài khoản chưa liên kết hồ sơ nhân sự.'; end if;
  select * into v_type from public.hrm_leave_types where code = p_type and is_active;
  if v_type.code is null then raise exception using errcode = '22023', message = 'Loại đơn không hợp lệ.'; end if;
  select * into v_settings from public.hrm_leave_settings where singleton;

  if p_start is null or (v_type.unit = 'day' and (p_end is null or p_end < p_start)) then
    v_problems := v_problems || jsonb_build_array('Chọn ngày bắt đầu và ngày kết thúc hợp lệ.');
  end if;

  if v_type.unit = 'minute' then
    if p_minutes is null or p_minutes < 1 or p_minutes > v_settings.late_early_max_minutes then
      v_problems := v_problems || jsonb_build_array(format('Số phút từ 1 đến %s.', v_settings.late_early_max_minutes));
    end if;
  else
    v_days := app_private.hrm_leave_working_days(p_start, p_end, coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'));
    if p_start is not null and p_end is not null and v_days = 0 then
      v_problems := v_problems || jsonb_build_array('Khoảng ngày này không có ngày làm việc nào.');
    end if;
  end if;

  if v_type.requires_official and v_employee.official_date is not null and v_employee.official_date > coalesce(p_start, current_date) then
    v_problems := v_problems || jsonb_build_array('Nhân sự đang thử việc chưa có phép năm. Chọn "Nghỉ không lương" hoặc loại phù hợp.');
  end if;

  if v_type.deducts_annual and p_start is not null then
    v_remaining := app_private.hrm_leave_annual_remaining(v_employee.id, extract(year from p_start)::integer);
    if v_days > v_remaining then
      v_problems := v_problems || jsonb_build_array(format('Không đủ phép năm: còn %s ngày, đơn này cần %s ngày.', v_remaining, v_days));
    end if;
  end if;

  v_steps := app_private.hrm_leave_approval_chain(v_employee.id, p_type, v_days);
  select coalesce(jsonb_agg(step || jsonb_build_object('name', coalesce(u.name, 'Phòng Hành chính - Nhân sự')) order by (step ->> 'order')::int), '[]'::jsonb)
  into v_steps
  from jsonb_array_elements(v_steps) step
  left join public.users u on u.id::text = step ->> 'userId';

  return jsonb_build_object(
    'days', v_days,
    'minutes', p_minutes,
    'annualRemaining', v_remaining,
    'steps', v_steps,
    'problems', v_problems,
    'paidBy', v_type.paid_by
  );
end;
$function$;
revoke all on function public.preview_my_leave_request(text, date, date, text, text, integer) from public, anon;
grant execute on function public.preview_my_leave_request(text, date, date, text, text, integer) to authenticated;

-- ── Submit ─────────────────────────────────────────────────────────────────
create or replace function public.submit_my_leave_request(
  p_type text, p_start date, p_end date, p_start_session text, p_end_session text,
  p_minutes integer, p_subtype text, p_reason text
)
returns public.hrm_leave_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_preview jsonb;
  v_steps jsonb;
  v_row public.hrm_leave_requests;
  v_code text;
  v_first jsonb;
  v_recipients uuid[];
  v_type_name text;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 3 ký tự).';
  end if;
  v_preview := public.preview_my_leave_request(p_type, p_start, coalesce(p_end, p_start), p_start_session, p_end_session, p_minutes);
  if jsonb_array_length(v_preview -> 'problems') > 0 then
    raise exception using errcode = '23514', message = v_preview -> 'problems' ->> 0;
  end if;
  select * into v_employee from public.employees
  where user_id = v_user and status = 'Đang làm việc' order by updated_at desc nulls last limit 1;

  -- Overlapping requests for the same days are refused (late/early may coexist with day leave).
  if (select unit from public.hrm_leave_types where code = p_type) = 'day' and exists (
    select 1 from public.hrm_leave_requests request
    join public.hrm_leave_types existing_type on existing_type.code = request.type and existing_type.unit = 'day'
    where request."employeeId" = v_employee.id and request.status in ('pending', 'approved')
      and request."startDate"::date <= coalesce(p_end, p_start) and request."endDate"::date >= p_start
  ) then
    raise exception using errcode = '23514', message = 'Bạn đã có đơn nghỉ trùng những ngày này.';
  end if;

  v_steps := app_private.hrm_leave_approval_chain(v_employee.id, p_type, (v_preview ->> 'days')::numeric);
  v_code := 'NP-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-' || lpad((
    select count(*) + 1 from public.hrm_leave_requests where code like 'NP-' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'YYYY') || '-%'
  )::text, 4, '0');

  insert into public.hrm_leave_requests (
    id, "employeeId", type, "startDate", "endDate", "totalDays", reason, status, code, approvers,
    start_session, end_session, minutes, subtype, current_step, created_by, "createdAt", priority
  ) values (
    gen_random_uuid(), v_employee.id, p_type, p_start::text, coalesce(p_end, p_start)::text,
    (v_preview ->> 'days')::numeric, trim(p_reason), 'pending', v_code, v_steps,
    coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'), p_minutes, nullif(trim(coalesce(p_subtype, '')), ''),
    1, v_user, now(), 'medium'
  )
  returning * into v_row;

  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, 'create', v_user, 'Tạo đơn');

  v_first := v_steps -> 0;
  v_recipients := case when v_first ->> 'kind' = 'hr' then app_private.hrm_leave_hr_user_ids()
                       else array[(v_first ->> 'userId')::uuid] end;
  select name into v_type_name from public.hrm_leave_types where code = p_type;
  perform app_private.notify_hrm_leave(v_row.id, v_recipients, 'Đơn chờ bạn duyệt',
    format('%s · %s · %s', v_employee.full_name, v_type_name,
      case when p_minutes is not null then p_minutes || ' phút ngày ' || to_char(p_start, 'DD/MM')
           else (v_preview ->> 'days') || ' ngày từ ' || to_char(p_start, 'DD/MM') end));
  return v_row;
end;
$function$;
revoke all on function public.submit_my_leave_request(text, date, date, text, text, integer, text, text) from public, anon;
grant execute on function public.submit_my_leave_request(text, date, date, text, text, integer, text, text) to authenticated;

-- ── Decide ─────────────────────────────────────────────────────────────────
create or replace function public.decide_leave_request(p_request_id uuid, p_decision text, p_comment text default null)
returns public.hrm_leave_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_is_hr boolean := app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive');
  v_row public.hrm_leave_requests;
  v_step jsonb;
  v_index integer;
  v_is_assigned boolean;
  v_next jsonb;
  v_type public.hrm_leave_types%rowtype;
  v_employee public.employees%rowtype;
  v_year integer;
  v_day date;
  v_recipients uuid[];
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if p_decision not in ('approve', 'reject') then raise exception using errcode = '22023', message = 'Quyết định không hợp lệ.'; end if;

  select * into v_row from public.hrm_leave_requests where id = p_request_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đơn.'; end if;
  if v_row.status <> 'pending' then raise exception using errcode = '23514', message = 'Đơn này đã được xử lý.'; end if;
  select * into v_employee from public.employees where id = v_row."employeeId";
  if v_employee.user_id = v_user then raise exception using errcode = '42501', message = 'Không tự duyệt đơn của chính mình.'; end if;

  v_index := coalesce(v_row.current_step, 1) - 1;
  v_step := v_row.approvers -> v_index;
  if v_step is null then raise exception using errcode = '23514', message = 'Đơn không có bước duyệt hợp lệ.'; end if;
  v_is_assigned := (v_step ->> 'userId') = v_user::text or (v_step ->> 'kind' = 'hr' and v_is_hr);
  if not v_is_assigned and not v_is_hr then
    raise exception using errcode = '42501', message = 'Bạn không phải người duyệt bước này.';
  end if;
  -- HR acting for someone else's step must say why; rejecting always needs a reason.
  if (not v_is_assigned or p_decision = 'reject') and length(trim(coalesce(p_comment, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 3 ký tự).';
  end if;

  v_step := v_step || jsonb_build_object(
    'status', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'decidedBy', v_user, 'decidedAt', now(), 'comment', nullif(trim(coalesce(p_comment, '')), ''),
    'onBehalf', not v_is_assigned);
  v_row.approvers := jsonb_set(v_row.approvers, array[v_index::text], v_step);

  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, case when p_decision = 'approve' then 'approve' else 'reject' end, v_user,
    concat_ws(' · ', 'Bước ' || (v_index + 1), case when not v_is_assigned then 'HR duyệt thay' end, nullif(trim(coalesce(p_comment, '')), '')));

  if p_decision = 'reject' then
    update public.hrm_leave_requests
    set approvers = v_row.approvers, status = 'rejected', "rejectionReason" = trim(p_comment),
        "approvedBy" = v_user::text, "approvedAt" = now()::text
    where id = v_row.id returning * into v_row;
    perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'Đơn bị từ chối', trim(p_comment));
    return v_row;
  end if;

  v_next := v_row.approvers -> (v_index + 1);
  if v_next is not null then
    update public.hrm_leave_requests set approvers = v_row.approvers, current_step = v_index + 2
    where id = v_row.id returning * into v_row;
    v_recipients := case when v_next ->> 'kind' = 'hr' then app_private.hrm_leave_hr_user_ids()
                         else array[(v_next ->> 'userId')::uuid] end;
    perform app_private.notify_hrm_leave(v_row.id, v_recipients, 'Đơn chờ bạn duyệt',
      format('%s · %s ngày từ %s (đã qua bước %s)', v_employee.full_name, v_row."totalDays", v_row."startDate", v_index + 1));
    return v_row;
  end if;

  -- Final approval: balance and timesheet follow.
  update public.hrm_leave_requests
  set approvers = v_row.approvers, status = 'approved', "approvedBy" = v_user::text, "approvedAt" = now()::text
  where id = v_row.id returning * into v_row;

  select * into v_type from public.hrm_leave_types where code = v_row.type;
  v_year := left(v_row."startDate", 4)::integer;
  if v_type.deducts_annual then
    update public.hrm_leave_balances set "usedPaidDays" = "usedPaidDays" + v_row."totalDays"
    where "employeeId" = v_row."employeeId" and year = v_year;
  elsif v_type.paid_by = 'none' and v_type.unit = 'day' then
    update public.hrm_leave_balances set "usedUnpaidDays" = "usedUnpaidDays" + v_row."totalDays"
    where "employeeId" = v_row."employeeId" and year = v_year;
  end if;

  -- Full leave days appear on the timesheet; days with punches or half days keep their punches.
  if v_type.unit = 'day' and v_row.type <> 'business_trip' then
    for v_day in select generate_series(v_row."startDate"::date, v_row."endDate"::date, interval '1 day')::date loop
      continue when app_private.hrm_leave_working_days(v_day, v_day,
        case when v_day = v_row."startDate"::date then v_row.start_session else 'full' end,
        case when v_day = v_row."endDate"::date then v_row.end_session else 'full' end) <> 1;
      insert into public.hrm_attendance (id, "employeeId", date, status, note, "approvalStatus", "createdAt")
      values (gen_random_uuid(), v_row."employeeId", v_day::text, 'leave', 'leave:' || v_row.id, 'approved', now())
      on conflict ("employeeId", date) do update
        set status = 'leave', note = left(concat_ws(E'\n', nullif(public.hrm_attendance.note, ''), 'leave:' || v_row.id), 1000)
        where public.hrm_attendance."checkIn" is null;
    end loop;
  end if;

  perform app_private.notify_hrm_leave(v_row.id, array[v_employee.user_id], 'Đơn đã được duyệt',
    format('%s · %s', (select name from public.hrm_leave_types where code = v_row.type),
      case when v_row.minutes is not null then v_row.minutes || ' phút' else v_row."totalDays" || ' ngày' end));
  return v_row;
end;
$function$;
revoke all on function public.decide_leave_request(uuid, text, text) from public, anon;
grant execute on function public.decide_leave_request(uuid, text, text) to authenticated;

-- ── Cancel ─────────────────────────────────────────────────────────────────
create or replace function public.cancel_leave_request(p_request_id uuid, p_reason text)
returns public.hrm_leave_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_is_hr boolean := app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive');
  v_row public.hrm_leave_requests;
  v_owner uuid;
  v_type public.hrm_leave_types%rowtype;
  v_year integer;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception using errcode = '22023', message = 'Nhập lý do hủy (ít nhất 3 ký tự).'; end if;
  select * into v_row from public.hrm_leave_requests where id = p_request_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy đơn.'; end if;
  select user_id into v_owner from public.employees where id = v_row."employeeId";

  -- The requester withdraws a pending request; an approved one is cancelled by HR (it changes balance and timesheet).
  if v_row.status = 'pending' then
    if v_owner <> v_user and not v_is_hr then raise exception using errcode = '42501', message = 'Chỉ người tạo đơn hoặc HR được hủy.'; end if;
  elsif v_row.status = 'approved' then
    if not v_is_hr then raise exception using errcode = '42501', message = 'Đơn đã duyệt chỉ HR được hủy. Liên hệ phòng HCNS.'; end if;
    select * into v_type from public.hrm_leave_types where code = v_row.type;
    v_year := left(v_row."startDate", 4)::integer;
    if v_type.deducts_annual then
      update public.hrm_leave_balances set "usedPaidDays" = greatest(0, "usedPaidDays" - v_row."totalDays")
      where "employeeId" = v_row."employeeId" and year = v_year;
    elsif v_type.paid_by = 'none' and v_type.unit = 'day' then
      update public.hrm_leave_balances set "usedUnpaidDays" = greatest(0, "usedUnpaidDays" - v_row."totalDays")
      where "employeeId" = v_row."employeeId" and year = v_year;
    end if;
    delete from public.hrm_attendance
    where "employeeId" = v_row."employeeId" and status = 'leave' and "checkIn" is null and note = 'leave:' || v_row.id;
  else
    raise exception using errcode = '23514', message = 'Đơn này đã kết thúc.';
  end if;

  update public.hrm_leave_requests
  set status = 'cancelled', cancelled_by = v_user, cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = v_row.id returning * into v_row;
  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, 'cancel', v_user, trim(p_reason));
  if v_owner <> v_user then
    perform app_private.notify_hrm_leave(v_row.id, array[v_owner], 'Đơn đã bị hủy', trim(p_reason));
  end if;
  return v_row;
end;
$function$;
revoke all on function public.cancel_leave_request(uuid, text) from public, anon;
grant execute on function public.cancel_leave_request(uuid, text) to authenticated;

-- ── Access: approvers see what they approve; writes only through the RPCs ──
drop policy if exists hrm_leave_requests_approver_select on public.hrm_leave_requests;
create policy hrm_leave_requests_approver_select on public.hrm_leave_requests for select to authenticated
  using (approvers @> jsonb_build_array(jsonb_build_object('userId', (select public.current_app_user_id())::text)));
drop policy if exists hrm_leave_requests_subject_insert on public.hrm_leave_requests;
drop policy if exists hrm_leave_requests_approve_update on public.hrm_leave_requests;
drop policy if exists hrm_leave_requests_approve_delete on public.hrm_leave_requests;

drop policy if exists hrm_leave_logs_approver_select on public.hrm_leave_logs;
create policy hrm_leave_logs_approver_select on public.hrm_leave_logs for select to authenticated
  using (exists (
    select 1 from public.hrm_leave_requests request
    where request.id = leave_request_id
      and request.approvers @> jsonb_build_array(jsonb_build_object('userId', (select public.current_app_user_id())::text))
  ));
drop policy if exists hrm_leave_logs_subject_insert on public.hrm_leave_logs;
