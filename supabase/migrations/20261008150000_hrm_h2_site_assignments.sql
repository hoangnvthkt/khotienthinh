-- H2 Điều động công trường (owner decisions 03/10/2026):
--   * One record per person per attendance site: Chính (primary) / Kiêm nhiệm (concurrent) / Tạm thời (temporary, must end;
--     during it it is the primary site, afterwards the previous primary applies again).
--   * Created by HR, the site approver / chỉ huy trưởng of the site, or the person's direct manager; approved by HR Manage / Admin
--     (hrm.master_data.manage). Start date may go back at most 7 days.
--   * Approved records apply on their start date: employees.construction_site_id follows the primary site (check-in site and the
--     leave approver read it), check-in prefers the assigned sites, and the person joins the site's project team with "Xem".
--   * Before H2, HR confirms where people really work (review); office people listed in a project only to view it are not moved.
--   * Pending can be cancelled; approved but not started can be cancelled by HR Manage; started ones can only end early / extend.

-- ── Tables ─────────────────────────────────────────────────────────────────
create table if not exists public.hrm_site_assignments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  employee_id uuid not null references public.employees(id) on delete cascade,
  site_id uuid not null references public.hrm_construction_sites(id),
  kind text not null check (kind in ('primary', 'concurrent', 'temporary')),
  start_date date not null,
  end_date date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text not null check (char_length(btrim(reason)) >= 5),
  source text not null default 'request' check (source in ('request', 'baseline')),
  from_site_id uuid references public.hrm_construction_sites(id),
  replaced_assignment_id uuid references public.hrm_site_assignments(id),
  replaced_end_date date,
  project_staff_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  ended_early_reason text,
  updated_at timestamptz not null default now(),
  constraint hrm_site_assignments_period_check check (end_date is null or end_date >= start_date),
  constraint hrm_site_assignments_temporary_end_check check (kind <> 'temporary' or end_date is not null)
);
create index if not exists hrm_site_assignments_employee_idx on public.hrm_site_assignments (employee_id, status, start_date);
create index if not exists hrm_site_assignments_site_idx on public.hrm_site_assignments (site_id, status);
alter table public.hrm_site_assignments enable row level security;
revoke all on public.hrm_site_assignments from anon, authenticated;

create table if not exists public.hrm_site_assignment_events (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.hrm_site_assignments(id) on delete cascade,
  action text not null check (action in ('create', 'approve', 'reject', 'cancel', 'end_early', 'extend', 'baseline')),
  actor uuid,
  note text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists hrm_site_assignment_events_assignment_idx on public.hrm_site_assignment_events (assignment_id, created_at);
alter table public.hrm_site_assignment_events enable row level security;
revoke all on public.hrm_site_assignment_events from anon, authenticated;

-- HR's answer for "where does this person really work" before H2 (site null = office, not assigned).
create table if not exists public.hrm_site_assignment_reviews (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  site_id uuid references public.hrm_construction_sites(id),
  confirmed_by uuid,
  confirmed_at timestamptz not null default now()
);
alter table public.hrm_site_assignment_reviews enable row level security;
revoke all on public.hrm_site_assignment_reviews from anon, authenticated;

-- ── Helpers ────────────────────────────────────────────────────────────────
create or replace function app_private.hrm_vn_today()
returns date
language sql
stable
set search_path = ''
as $function$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$function$;
revoke all on function app_private.hrm_vn_today() from public, anon;
grant execute on function app_private.hrm_vn_today() to authenticated, service_role;

-- Project whose team list a site's people join.
create or replace function app_private.hrm_site_project_id(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select project.id::text from public.projects project
  where project.construction_site_id = p_site_id and coalesce(project.status, '') not in ('completed', 'cancelled', 'archived')
  order by (project.status = 'active') desc, project.created_at
  limit 1;
$function$;
revoke all on function app_private.hrm_site_project_id(uuid) from public, anon, authenticated;

-- Primary site on a day: a temporary assignment wins, then the primary one.
create or replace function app_private.hrm_employee_primary_site_on(p_employee_id uuid, p_day date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select assignment.site_id from public.hrm_site_assignments assignment
  where assignment.employee_id = p_employee_id and assignment.status = 'approved' and assignment.kind in ('primary', 'temporary')
    and assignment.start_date <= p_day and (assignment.end_date is null or assignment.end_date >= p_day)
  order by (assignment.kind = 'temporary') desc, assignment.start_date desc
  limit 1;
$function$;
revoke all on function app_private.hrm_employee_primary_site_on(uuid, date) from public, anon, authenticated;

create or replace function app_private.hrm_employee_sites_on(p_employee_id uuid, p_day date)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(distinct assignment.site_id), '{}') from public.hrm_site_assignments assignment
  where assignment.employee_id = p_employee_id and assignment.status = 'approved'
    and assignment.start_date <= p_day and (assignment.end_date is null or assignment.end_date >= p_day);
$function$;
revoke all on function app_private.hrm_employee_sites_on(uuid, date) from public, anon, authenticated;

create or replace function app_private.hrm_site_assignment_is_approver(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and app_private.has_hrm_template_permission(p_user_id, 'hrm.master_data.manage');
$function$;
revoke all on function app_private.hrm_site_assignment_is_approver(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_site_assignment_is_hr(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and (app_private.has_hrm_template_permission(p_user_id, 'hrm.employee.view_sensitive')
    or app_private.has_hrm_template_permission(p_user_id, 'hrm.master_data.manage'));
$function$;
revoke all on function app_private.hrm_site_assignment_is_hr(uuid) from public, anon, authenticated;

-- Site leader: the site's approver, or the chỉ huy trưởng in the team list of the site's project.
create or replace function app_private.hrm_is_site_leader(p_user_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and p_site_id is not null and (
    exists (select 1 from public.hrm_construction_sites site where site.id = p_site_id and site."managerId" = p_user_id::text)
    or exists (
      select 1 from public.project_staff staff
      join public.hrm_positions position on position.id = staff.position_id
      join public.projects project on project.id::text = staff.project_id
      where staff.user_id = p_user_id::text and position.name ilike 'Chỉ huy trưởng%'
        and (staff.end_date is null or staff.end_date >= app_private.hrm_vn_today())
        and (project.construction_site_id = p_site_id or staff.construction_site_id = p_site_id::text)
    )
  );
$function$;
revoke all on function app_private.hrm_is_site_leader(uuid, uuid) from public, anon, authenticated;

create or replace function app_private.hrm_site_assignment_can_create(p_user_id uuid, p_employee_id uuid, p_site_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_employee public.employees%rowtype;
begin
  if p_user_id is null then return false; end if;
  if app_private.hrm_site_assignment_is_hr(p_user_id) then return true; end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then return false; end if;
  -- coalesce: no direct manager gives NULL, which must mean "no".
  return coalesce(app_private.hrm_is_site_leader(p_user_id, p_site_id)
    or app_private.hrm_is_site_leader(p_user_id, app_private.hrm_employee_primary_site_on(v_employee.id, app_private.hrm_vn_today()))
    or app_private.hrm_is_site_leader(p_user_id, v_employee.construction_site_id)
    or (v_employee.user_id is not null and app_private.resolve_active_direct_manager(v_employee.user_id) = p_user_id), false);
end;
$function$;
revoke all on function app_private.hrm_site_assignment_can_create(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function app_private.hrm_site_assignment_can_create_any(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and (
    app_private.hrm_site_assignment_is_hr(p_user_id)
    or exists (select 1 from public.hrm_construction_sites site where app_private.hrm_is_site_leader(p_user_id, site.id))
    or exists (select 1 from public.employees employee where employee.status = 'Đang làm việc' and employee.user_id is not null
               and app_private.resolve_active_direct_manager(employee.user_id) = p_user_id)
  );
$function$;
revoke all on function app_private.hrm_site_assignment_can_create_any(uuid) from public, anon, authenticated;

-- employees.construction_site_id follows the primary site once HR has reviewed the person or they have an approved record.
create or replace function app_private.hrm_sync_employee_site(p_employee_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_site uuid;
begin
  -- Only once HR reviewed the person or an approved record has started; a future record does not clear today's site.
  if not exists (select 1 from public.hrm_site_assignment_reviews review where review.employee_id = p_employee_id)
     and not exists (select 1 from public.hrm_site_assignments assignment where assignment.employee_id = p_employee_id
                     and assignment.status = 'approved' and assignment.start_date <= app_private.hrm_vn_today()) then
    return;
  end if;
  v_site := app_private.hrm_employee_primary_site_on(p_employee_id, app_private.hrm_vn_today());
  update public.employees set construction_site_id = v_site
  where id = p_employee_id and construction_site_id is distinct from v_site;
end;
$function$;
revoke all on function app_private.hrm_sync_employee_site(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_site_assignment_daily_sync()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_employee uuid;
  v_count integer := 0;
begin
  for v_employee in
    select employee_id from public.hrm_site_assignments where status = 'approved'
    union select employee_id from public.hrm_site_assignment_reviews
  loop
    perform app_private.hrm_sync_employee_site(v_employee);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function app_private.hrm_site_assignment_daily_sync() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'hrm-site-assignment-daily-sync') then
    perform cron.unschedule('hrm-site-assignment-daily-sync');
  end if;
  perform cron.schedule('hrm-site-assignment-daily-sync', '10 17 * * *', 'select app_private.hrm_site_assignment_daily_sync()');
end;
$cron$;

create or replace function app_private.notify_hrm_site_assignment(p_user_ids uuid[], p_title text, p_body text, p_entity_id uuid)
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
  select distinct recipient::text, p_title, p_body, 'info', 'normal', 'HRM', '/hrm/assignments?id=' || p_entity_id,
    jsonb_build_object('entityId', p_entity_id), 'hrm_site_assignment', p_body, 'info', 'hrm_site_assignment',
    p_entity_id::text, true, '/hrm/assignments?id=' || p_entity_id, 'hrm_site_assignment', p_entity_id, 'responsible'
  from unnest(p_user_ids) recipient
  where recipient is not null and recipient is distinct from public.current_app_user_id();
end;
$function$;
revoke all on function app_private.notify_hrm_site_assignment(uuid[], text, text, uuid) from public, anon, authenticated;

create or replace function app_private.hrm_site_assignment_approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(u.id), '{}') from public.users u
  where coalesce(u.is_active, true) and app_private.has_hrm_template_permission(u.id, 'hrm.master_data.manage');
$function$;
revoke all on function app_private.hrm_site_assignment_approver_ids() from public, anon, authenticated;

create or replace function app_private.hrm_site_name(p_site_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select name from public.hrm_construction_sites where id = p_site_id;
$function$;
revoke all on function app_private.hrm_site_name(uuid) from public, anon, authenticated;

create or replace function app_private.hrm_date_vi(p_day date)
returns text
language sql
immutable
set search_path = ''
as $function$
  select to_char(p_day, 'DD/MM/YYYY');
$function$;
revoke all on function app_private.hrm_date_vi(date) from public, anon, authenticated;

-- ── Checks shared by preview, submit and approve ───────────────────────────
create or replace function app_private.hrm_site_assignment_check(p_user_id uuid, p_payload jsonb, p_ignore_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_today date := app_private.hrm_vn_today();
  v_site public.hrm_construction_sites%rowtype;
  v_kind text := coalesce(p_payload ->> 'kind', '');
  v_start date := nullif(p_payload ->> 'startDate', '')::date;
  v_end date := nullif(p_payload ->> 'endDate', '')::date;
  v_ids uuid[];
  v_id uuid;
  v_employee public.employees%rowtype;
  v_current uuid;
  v_other public.hrm_site_assignments%rowtype;
  v_leave text;
  v_problems jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_effects jsonb := '[]'::jsonb;
  v_project text;
  v_project_code text;
  v_name text;
begin
  select coalesce(array_agg(distinct value::uuid), '{}') into v_ids
  from jsonb_array_elements_text(coalesce(p_payload -> 'employeeIds', '[]'::jsonb)) value;
  select * into v_site from public.hrm_construction_sites where id = nullif(p_payload ->> 'siteId', '')::uuid;

  if cardinality(v_ids) = 0 then v_problems := v_problems || jsonb_build_array('Chọn người được điều động.'); end if;
  if cardinality(v_ids) > 50 then v_problems := v_problems || jsonb_build_array('Mỗi lần tối đa 50 người.'); end if;
  if v_site.id is null then v_problems := v_problems || jsonb_build_array('Chọn công trường đến.'); end if;
  if v_kind not in ('primary', 'concurrent', 'temporary') then v_problems := v_problems || jsonb_build_array('Chọn loại điều động.'); end if;
  if v_start is null then
    v_problems := v_problems || jsonb_build_array('Chọn ngày bắt đầu.');
  elsif v_start < v_today - 7 then
    v_problems := v_problems || jsonb_build_array(format('Chỉ được lùi ngày tối đa 7 ngày (từ %s).', app_private.hrm_date_vi(v_today - 7)));
  elsif v_start < v_today and v_site.id is not null then
    v_warnings := v_warnings || jsonb_build_array(format('Lùi ngày: lượt chấm từ %s sẽ được tính cho %s.', app_private.hrm_date_vi(v_start), v_site.name));
  end if;
  if v_kind = 'temporary' and v_end is null then v_problems := v_problems || jsonb_build_array('Tạm thời phải có ngày kết thúc.'); end if;
  if v_end is not null and v_start is not null and v_end < v_start then v_problems := v_problems || jsonb_build_array('Ngày kết thúc trước ngày bắt đầu.'); end if;
  if v_site.id is not null then
    if v_site.latitude is null or v_site.longitude is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có tọa độ chấm công — nhập ở Cài đặt → Địa điểm chấm công trước ngày bắt đầu.', v_site.name));
    end if;
    if nullif(v_site."managerId", '') is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có người duyệt — đơn nghỉ và chấm công bù sẽ về Phòng HCNS.', v_site.name));
    end if;
  end if;
  if jsonb_array_length(v_problems) > 0 then
    return jsonb_build_object('problems', v_problems, 'warnings', v_warnings, 'effects', v_effects);
  end if;

  foreach v_id in array v_ids loop
    select * into v_employee from public.employees where id = v_id;
    v_name := coalesce(v_employee.full_name, 'Nhân viên');
    if v_employee.id is null or v_employee.status <> 'Đang làm việc' then
      v_problems := v_problems || jsonb_build_array(format('%s không còn làm việc.', v_name)); continue;
    end if;
    if not app_private.hrm_site_assignment_can_create(p_user_id, v_id, v_site.id) then
      v_problems := v_problems || jsonb_build_array(format('Bạn chưa được lập điều động cho %s (HR, chỉ huy trưởng hoặc quản lý trực tiếp).', v_name)); continue;
    end if;
    select * into v_other from public.hrm_site_assignments
    where employee_id = v_id and status = 'pending' and id is distinct from p_ignore_id limit 1;
    if v_other.id is not null then
      v_problems := v_problems || jsonb_build_array(format('%s đã có phiếu chờ duyệt %s.', v_name, v_other.code)); continue;
    end if;
    v_current := app_private.hrm_employee_primary_site_on(v_id, v_start);
    if v_kind in ('primary', 'temporary') then
      if v_current = v_site.id then
        v_problems := v_problems || jsonb_build_array(format('%s đang làm chính tại %s.', v_name, v_site.name)); continue;
      end if;
      select * into v_other from public.hrm_site_assignments
      where employee_id = v_id and status = 'approved' and kind in ('primary', 'temporary') and start_date >= v_start
        and id is distinct from p_ignore_id
      order by start_date limit 1;
      if v_other.id is not null then
        v_problems := v_problems || jsonb_build_array(format('%s đã có điều động %s từ %s; hủy phiếu đó trước.', v_name, v_other.code, app_private.hrm_date_vi(v_other.start_date))); continue;
      end if;
      select * into v_other from public.hrm_site_assignments
      where employee_id = v_id and status = 'approved' and kind = 'temporary' and start_date <= v_start and end_date >= v_start
        and id is distinct from p_ignore_id limit 1;
      if v_other.id is not null then
        v_problems := v_problems || jsonb_build_array(format('%s đang tăng cường tại %s đến %s.', v_name, app_private.hrm_site_name(v_other.site_id), app_private.hrm_date_vi(v_other.end_date))); continue;
      end if;
    else
      select * into v_other from public.hrm_site_assignments
      where employee_id = v_id and status = 'approved' and site_id = v_site.id
        and start_date <= coalesce(v_end, 'infinity'::date) and (end_date is null or end_date >= v_start)
        and id is distinct from p_ignore_id limit 1;
      if v_other.id is not null then
        v_problems := v_problems || jsonb_build_array(format('%s đã làm tại %s (%s).', v_name, v_site.name, v_other.code)); continue;
      end if;
    end if;

    select request.code into v_leave from public.hrm_leave_requests request
    join public.hrm_leave_types leave_type on leave_type.code = request.type and leave_type.unit = 'day'
    where request."employeeId" = v_id and request.status in ('pending', 'approved')
      and request."startDate"::date <= coalesce(v_end, v_start + 30) and request."endDate"::date >= v_start
    limit 1;
    if v_leave is not null then
      v_warnings := v_warnings || jsonb_build_array(format('%s có đơn nghỉ %s trong thời gian này.', v_name, coalesce(v_leave, '')));
    end if;
    if v_employee.user_id is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có tài khoản Vioo — chưa chấm công trên điện thoại được.', v_name));
    elsif v_employee.position_id is null then
      v_warnings := v_warnings || jsonb_build_array(format('%s chưa có vị trí — không tự thêm vào Tổ chức dự án được, HR thêm sau.', v_name));
    end if;

    v_effects := v_effects || jsonb_build_array(case v_kind
      when 'primary' then format('%s: %s%s (chính) từ %s.', v_name,
        case when v_current is not null then format('%s kết thúc %s → ', app_private.hrm_site_name(v_current), app_private.hrm_date_vi(v_start - 1)) else '' end,
        v_site.name, app_private.hrm_date_vi(v_start))
      when 'temporary' then format('%s: tăng cường %s %s → %s, sau đó về %s.', v_name, v_site.name, app_private.hrm_date_vi(v_start), app_private.hrm_date_vi(v_end),
        coalesce(app_private.hrm_site_name(v_current), 'chưa có nơi chính'))
      else format('%s: kiêm nhiệm %s; nơi chính %s giữ nguyên.', v_name, v_site.name, coalesce(app_private.hrm_site_name(v_current), '(chưa có)'))
    end);
  end loop;

  v_project := app_private.hrm_site_project_id(v_site.id);
  if v_project is null then
    v_warnings := v_warnings || jsonb_build_array(format('%s chưa gắn dự án — không thêm vào Tổ chức dự án.', v_site.name));
  else
    select code into v_project_code from public.projects where id::text = v_project;
    v_effects := v_effects || jsonb_build_array(format('Thêm vào Tổ chức dự án %s với quyền Xem (nếu chưa có): %s người.', coalesce(v_project_code, ''), cardinality(v_ids)));
  end if;
  return jsonb_build_object('problems', v_problems, 'warnings', v_warnings, 'effects', v_effects);
end;
$function$;
revoke all on function app_private.hrm_site_assignment_check(uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function public.preview_hrm_site_assignment(p_payload jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  return app_private.hrm_site_assignment_check(v_user, p_payload, null);
end;
$function$;
revoke all on function public.preview_hrm_site_assignment(jsonb) from public, anon;
grant execute on function public.preview_hrm_site_assignment(jsonb) to authenticated;

create or replace function app_private.hrm_site_assignment_next_code()
returns text
language sql
volatile
security definer
set search_path = ''
as $function$
  select 'DD-' || to_char(app_private.hrm_vn_today(), 'YYYY') || '-' || lpad((
    coalesce(max(nullif(split_part(code, '-', 3), '')::integer), 0) + 1)::text, 4, '0')
  from public.hrm_site_assignments where code like 'DD-' || to_char(app_private.hrm_vn_today(), 'YYYY') || '-%';
$function$;
revoke all on function app_private.hrm_site_assignment_next_code() from public, anon, authenticated;

create or replace function public.submit_hrm_site_assignment(p_payload jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_check jsonb;
  v_reason text := btrim(coalesce(p_payload ->> 'reason', ''));
  v_site uuid := nullif(p_payload ->> 'siteId', '')::uuid;
  v_start date := nullif(p_payload ->> 'startDate', '')::date;
  v_end date := nullif(p_payload ->> 'endDate', '')::date;
  v_kind text := p_payload ->> 'kind';
  v_id uuid;
  v_row public.hrm_site_assignments;
  v_codes text[] := '{}';
  v_names text[] := '{}';
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if char_length(v_reason) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).'; end if;
  v_check := app_private.hrm_site_assignment_check(v_user, p_payload, null);
  if jsonb_array_length(v_check -> 'problems') > 0 then
    raise exception using errcode = '23514', message = v_check -> 'problems' ->> 0;
  end if;
  for v_id in select distinct value::uuid from jsonb_array_elements_text(p_payload -> 'employeeIds') value loop
    insert into public.hrm_site_assignments (code, employee_id, site_id, kind, start_date, end_date, status, reason, source, from_site_id, created_by)
    values (app_private.hrm_site_assignment_next_code(), v_id, v_site, v_kind, v_start, v_end, 'pending', v_reason, 'request',
            app_private.hrm_employee_primary_site_on(v_id, v_start), v_user)
    returning * into v_row;
    insert into public.hrm_site_assignment_events (assignment_id, action, actor, note) values (v_row.id, 'create', v_user, v_reason);
    v_codes := v_codes || v_row.code;
    v_names := v_names || (select full_name from public.employees where id = v_id);
    perform app_private.notify_hrm_site_assignment(app_private.hrm_site_assignment_approver_ids(), 'Phiếu điều động chờ duyệt',
      format('%s · %s → %s từ %s', v_row.code, (select full_name from public.employees where id = v_id), app_private.hrm_site_name(v_site), app_private.hrm_date_vi(v_start)), v_row.id);
  end loop;
  return v_codes;
end;
$function$;
revoke all on function public.submit_hrm_site_assignment(jsonb) from public, anon;
grant execute on function public.submit_hrm_site_assignment(jsonb) to authenticated;

-- Add the person to the site's project team with "Xem" (legacy view permission) if they are not on it yet.
create or replace function app_private.hrm_site_assignment_join_project(p_assignment_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.hrm_site_assignments%rowtype;
  v_employee public.employees%rowtype;
  v_project text;
  v_staff uuid;
begin
  select * into v_row from public.hrm_site_assignments where id = p_assignment_id;
  select * into v_employee from public.employees where id = v_row.employee_id;
  v_project := app_private.hrm_site_project_id(v_row.site_id);
  if v_project is null or v_employee.user_id is null or v_employee.position_id is null then return null; end if;
  if exists (select 1 from public.project_staff staff where staff.user_id = v_employee.user_id::text and staff.project_id = v_project
             and (staff.end_date is null or staff.end_date >= v_row.start_date)) then
    return null;
  end if;
  insert into public.project_staff (construction_site_id, user_id, position_id, start_date, end_date, note, project_id)
  values (v_row.site_id::text, v_employee.user_id::text, v_employee.position_id, v_row.start_date,
          case when v_row.kind = 'temporary' then v_row.end_date end, 'Điều động ' || v_row.code, v_project)
  returning id into v_staff;
  insert into public.project_staff_permissions (staff_id, permission_type_id, is_active, granted_by, granted_at)
  select v_staff, permission_type.id, true, p_actor::text, now() from public.project_permission_types permission_type where permission_type.code = 'view'
  on conflict (staff_id, permission_type_id) do nothing;
  return v_staff;
end;
$function$;
revoke all on function app_private.hrm_site_assignment_join_project(uuid, uuid) from public, anon, authenticated;

create or replace function public.decide_hrm_site_assignment(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_row public.hrm_site_assignments%rowtype;
  v_employee public.employees%rowtype;
  v_check jsonb;
  v_previous public.hrm_site_assignments%rowtype;
  v_staff uuid;
  v_recipients uuid[];
begin
  if not app_private.hrm_site_assignment_is_approver(v_user) then
    raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được duyệt điều động.';
  end if;
  select * into v_row from public.hrm_site_assignments where id = p_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy phiếu điều động.'; end if;
  if v_row.status <> 'pending' then raise exception using errcode = '23514', message = 'Phiếu này đã được xử lý.'; end if;
  select * into v_employee from public.employees where id = v_row.employee_id;
  if v_employee.user_id = v_user then raise exception using errcode = '42501', message = 'Không tự duyệt điều động của chính mình.'; end if;

  if not p_approve then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do từ chối (ít nhất 5 ký tự).'; end if;
    update public.hrm_site_assignments set status = 'rejected', decided_by = v_user, decided_at = now(), decision_note = btrim(p_note), updated_at = now() where id = p_id;
    insert into public.hrm_site_assignment_events (assignment_id, action, actor, note) values (p_id, 'reject', v_user, btrim(p_note));
    perform app_private.notify_hrm_site_assignment(array[v_row.created_by, v_employee.user_id], 'Điều động bị từ chối',
      format('%s · %s → %s: %s', v_row.code, v_employee.full_name, app_private.hrm_site_name(v_row.site_id), btrim(p_note)), p_id);
    return;
  end if;

  if v_row.start_date < app_private.hrm_vn_today() - 7 then
    raise exception using errcode = '23514', message = 'Ngày bắt đầu đã quá 7 ngày; người lập cần hủy và lập phiếu mới.';
  end if;
  v_check := app_private.hrm_site_assignment_check(v_user, jsonb_build_object(
    'employeeIds', jsonb_build_array(v_row.employee_id), 'siteId', v_row.site_id, 'kind', v_row.kind,
    'startDate', v_row.start_date, 'endDate', v_row.end_date), p_id);
  if jsonb_array_length(v_check -> 'problems') > 0 then
    raise exception using errcode = '23514', message = v_check -> 'problems' ->> 0;
  end if;

  -- A new primary site closes the current primary the day before.
  if v_row.kind = 'primary' then
    select * into v_previous from public.hrm_site_assignments
    where employee_id = v_row.employee_id and status = 'approved' and kind = 'primary' and id <> p_id
      and start_date < v_row.start_date and (end_date is null or end_date >= v_row.start_date)
    order by start_date desc limit 1;
    if v_previous.id is not null then
      update public.hrm_site_assignments set end_date = v_row.start_date - 1, updated_at = now() where id = v_previous.id;
    end if;
  end if;

  v_staff := app_private.hrm_site_assignment_join_project(p_id, v_user);
  update public.hrm_site_assignments set status = 'approved', decided_by = v_user, decided_at = now(),
    decision_note = nullif(btrim(coalesce(p_note, '')), ''), from_site_id = app_private.hrm_employee_primary_site_on(v_row.employee_id, v_row.start_date - 1),
    replaced_assignment_id = v_previous.id, replaced_end_date = v_previous.end_date, project_staff_id = v_staff, updated_at = now()
  where id = p_id;
  insert into public.hrm_site_assignment_events (assignment_id, action, actor, note, data)
  values (p_id, 'approve', v_user, nullif(btrim(coalesce(p_note, '')), ''), jsonb_build_object('closedAssignment', v_previous.id, 'projectStaffId', v_staff));
  perform app_private.hrm_sync_employee_site(v_row.employee_id);

  select array_agg(distinct recipient) into v_recipients from unnest(array[
    v_row.created_by, v_employee.user_id,
    nullif((select "managerId" from public.hrm_construction_sites where id = v_row.site_id), '')::uuid,
    nullif((select "managerId" from public.hrm_construction_sites where id = v_row.from_site_id), '')::uuid,
    nullif((select "managerId" from public.hrm_construction_sites where id = v_previous.site_id), '')::uuid
  ]) recipient where recipient is not null;
  perform app_private.notify_hrm_site_assignment(v_recipients, 'Điều động đã được duyệt',
    format('%s · %s → %s (%s) từ %s', v_row.code, v_employee.full_name, app_private.hrm_site_name(v_row.site_id),
      case v_row.kind when 'primary' then 'chính' when 'temporary' then 'tạm thời đến ' || app_private.hrm_date_vi(v_row.end_date) else 'kiêm nhiệm' end,
      app_private.hrm_date_vi(v_row.start_date)), p_id);
end;
$function$;
revoke all on function public.decide_hrm_site_assignment(uuid, boolean, text) from public, anon;
grant execute on function public.decide_hrm_site_assignment(uuid, boolean, text) to authenticated;

create or replace function public.cancel_hrm_site_assignment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_row public.hrm_site_assignments%rowtype;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do hủy (ít nhất 5 ký tự).'; end if;
  select * into v_row from public.hrm_site_assignments where id = p_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy phiếu điều động.'; end if;
  if v_row.status = 'pending' then
    if v_row.created_by is distinct from v_user and not app_private.hrm_site_assignment_is_approver(v_user) then
      raise exception using errcode = '42501', message = 'Chỉ người lập phiếu, HR Manage hoặc Admin được hủy.';
    end if;
  elsif v_row.status = 'approved' then
    if not app_private.hrm_site_assignment_is_approver(v_user) then
      raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được hủy điều động đã duyệt.';
    end if;
    if v_row.start_date <= app_private.hrm_vn_today() then
      raise exception using errcode = '23514', message = 'Điều động đã có hiệu lực — dùng Kết thúc sớm.';
    end if;
    if v_row.replaced_assignment_id is not null then
      update public.hrm_site_assignments set end_date = v_row.replaced_end_date, updated_at = now() where id = v_row.replaced_assignment_id;
    end if;
    if v_row.project_staff_id is not null then
      delete from public.project_staff where id = v_row.project_staff_id;
    end if;
  else
    raise exception using errcode = '23514', message = 'Phiếu này đã đóng.';
  end if;
  update public.hrm_site_assignments set status = 'cancelled', decided_by = coalesce(decided_by, v_user), decided_at = coalesce(decided_at, now()),
    decision_note = btrim(p_reason), project_staff_id = null, updated_at = now()
  where id = p_id;
  insert into public.hrm_site_assignment_events (assignment_id, action, actor, note) values (p_id, 'cancel', v_user, btrim(p_reason));
  perform app_private.hrm_sync_employee_site(v_row.employee_id);
  perform app_private.notify_hrm_site_assignment(array[v_row.created_by, (select user_id from public.employees where id = v_row.employee_id)],
    'Điều động đã hủy', format('%s: %s', v_row.code, btrim(p_reason)), p_id);
end;
$function$;
revoke all on function public.cancel_hrm_site_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_hrm_site_assignment(uuid, text) to authenticated;

create or replace function public.change_hrm_site_assignment_end(p_id uuid, p_end date, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_today date := app_private.hrm_vn_today();
  v_row public.hrm_site_assignments%rowtype;
  v_next public.hrm_site_assignments%rowtype;
  v_shorter boolean;
begin
  if not app_private.hrm_site_assignment_is_approver(v_user) then
    raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được kết thúc sớm hoặc gia hạn.';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 5 ký tự).'; end if;
  select * into v_row from public.hrm_site_assignments where id = p_id for update;
  if v_row.id is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy phiếu điều động.'; end if;
  if v_row.status <> 'approved' or v_row.start_date > v_today or (v_row.end_date is not null and v_row.end_date < v_today) then
    raise exception using errcode = '23514', message = 'Chỉ đổi ngày kết thúc cho điều động đang có hiệu lực.';
  end if;
  if p_end is null and v_row.kind = 'temporary' then raise exception using errcode = '22023', message = 'Tạm thời phải có ngày kết thúc.'; end if;
  if p_end is not null and (p_end < v_today or p_end < v_row.start_date) then
    raise exception using errcode = '22023', message = 'Ngày kết thúc không được trước hôm nay.';
  end if;
  if p_end is not distinct from v_row.end_date then return; end if;
  v_shorter := v_row.end_date is null or (p_end is not null and p_end < v_row.end_date);
  if not v_shorter and v_row.kind in ('primary', 'temporary') then
    select * into v_next from public.hrm_site_assignments
    where employee_id = v_row.employee_id and status = 'approved' and kind in ('primary', 'temporary') and id <> p_id
      and start_date > v_row.start_date and start_date <= coalesce(p_end, 'infinity'::date)
    order by start_date limit 1;
    if v_next.id is not null then
      raise exception using errcode = '23514', message = format('Đã có điều động %s từ %s; không gia hạn chồng lên được.', v_next.code, app_private.hrm_date_vi(v_next.start_date));
    end if;
  end if;
  update public.hrm_site_assignments set end_date = p_end, ended_early_reason = case when v_shorter then btrim(p_reason) end, updated_at = now()
  where id = p_id;
  if v_row.kind = 'temporary' and v_row.project_staff_id is not null then
    update public.project_staff set end_date = p_end, updated_at = now() where id = v_row.project_staff_id;
  end if;
  insert into public.hrm_site_assignment_events (assignment_id, action, actor, note, data)
  values (p_id, case when v_shorter then 'end_early' else 'extend' end, v_user, btrim(p_reason), jsonb_build_object('from', v_row.end_date, 'to', p_end));
  perform app_private.hrm_sync_employee_site(v_row.employee_id);
  perform app_private.notify_hrm_site_assignment(array[v_row.created_by, (select user_id from public.employees where id = v_row.employee_id),
      nullif((select "managerId" from public.hrm_construction_sites where id = v_row.site_id), '')::uuid],
    case when v_shorter then 'Điều động kết thúc sớm' else 'Điều động được gia hạn' end,
    format('%s · %s đến %s: %s', v_row.code, app_private.hrm_site_name(v_row.site_id), coalesce(app_private.hrm_date_vi(p_end), 'không thời hạn'), btrim(p_reason)), p_id);
end;
$function$;
revoke all on function public.change_hrm_site_assignment_end(uuid, date, text) from public, anon;
grant execute on function public.change_hrm_site_assignment_end(uuid, date, text) to authenticated;

-- ── Review before H2 ───────────────────────────────────────────────────────
create or replace function app_private.hrm_site_assignment_review_rows()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_today date := app_private.hrm_vn_today();
  v_site_roles text[] := array['chỉ huy trưởng', 'chỉ huy phó', 'kĩ thuật trưởng', 'kỹ thuật trưởng', 'nhân viên kĩ thuật', 'nhân viên kỹ thuật',
    'cán bộ qs/qc', 'cán bộ trắc đạc', 'cán bộ hse', 'cán bộ me', 'nhân viên thủ kho', 'thợ điện', 'nhân viên bảo vệ', 'đội trưởng đội xe', 'trợ lý dự án'];
  v_office_titles text := '(giám đốc|chủ tịch|kế toán|trưởng phòng|hành chính|nhân sự|hcns)';
  v_employee record;
  v_sites jsonb;
  v_site_role_rows jsonb;
  v_suggested uuid;
  v_note text;
  v_office boolean;
  v_rows jsonb := '[]'::jsonb;
begin
  for v_employee in
    select employee.id, employee.full_name, employee.employee_code, employee.title, employee.user_id, employee.construction_site_id
    from public.employees employee
    where employee.status = 'Đang làm việc'
      and not exists (select 1 from public.hrm_site_assignment_reviews review where review.employee_id = employee.id)
      and not exists (select 1 from public.hrm_site_assignments assignment where assignment.employee_id = employee.id and assignment.status = 'approved')
      and (employee.construction_site_id is not null or exists (
        select 1 from public.project_staff staff left join public.projects project on project.id::text = staff.project_id
        where staff.user_id = employee.user_id::text and (staff.end_date is null or staff.end_date >= v_today)
          and coalesce(nullif(staff.construction_site_id, '')::uuid, project.construction_site_id) is not null))
    order by employee.full_name
  loop
    select coalesce(jsonb_agg(item order by item ->> 'since' desc nulls last), '[]'::jsonb) into v_sites from (
      select distinct on (site.id) jsonb_build_object('siteId', site.id, 'siteName', site.name, 'role', position.name, 'since', staff.start_date) item
      from public.project_staff staff
      left join public.projects project on project.id::text = staff.project_id
      join public.hrm_construction_sites site on site.id = coalesce(nullif(staff.construction_site_id, '')::uuid, project.construction_site_id)
      left join public.hrm_positions position on position.id = staff.position_id
      where staff.user_id = v_employee.user_id::text and (staff.end_date is null or staff.end_date >= v_today)
      order by site.id, (lower(coalesce(position.name, '')) = any(v_site_roles)) desc, staff.start_date desc
    ) picked;
    if v_employee.construction_site_id is not null and not exists (select 1 from jsonb_array_elements(v_sites) item where (item ->> 'siteId')::uuid = v_employee.construction_site_id) then
      v_sites := v_sites || jsonb_build_array(jsonb_build_object('siteId', v_employee.construction_site_id,
        'siteName', app_private.hrm_site_name(v_employee.construction_site_id), 'role', 'Hồ sơ nhân viên', 'since', null));
    end if;
    select coalesce(jsonb_agg(item order by item ->> 'since' desc nulls last), '[]'::jsonb) into v_site_role_rows
    from jsonb_array_elements(v_sites) item where lower(coalesce(item ->> 'role', '')) = any(v_site_roles);

    v_office := false;
    if v_employee.construction_site_id is not null then
      v_suggested := v_employee.construction_site_id;
      v_note := format('Hồ sơ nhân viên ghi %s.', app_private.hrm_site_name(v_employee.construction_site_id))
        || case when jsonb_array_length(v_sites) > 1 then ' Tổ chức dự án ghi thêm nơi khác — HR xác nhận.' else '' end;
    elsif lower(coalesce(v_employee.title, '')) ~ v_office_titles or jsonb_array_length(v_site_role_rows) = 0 then
      v_suggested := null; v_office := true;
      v_note := 'Vai trò văn phòng — có mặt trong dự án để xem dự án; gợi ý không điều động.';
    elsif jsonb_array_length(v_site_role_rows) = 1 then
      v_suggested := (v_site_role_rows -> 0 ->> 'siteId')::uuid;
      v_note := format('Gợi ý từ vai trò công trường: %s.', v_site_role_rows -> 0 ->> 'role');
    else
      v_suggested := (v_site_role_rows -> 0 ->> 'siteId')::uuid;
      v_note := format('Đang có vai trò công trường ở %s nơi; gợi ý nơi gần nhất.', jsonb_array_length(v_site_role_rows));
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'employeeId', v_employee.id, 'employeeName', v_employee.full_name, 'employeeCode', v_employee.employee_code, 'jobTitle', v_employee.title,
      'sites', v_sites, 'suggestedSiteId', v_suggested, 'suggestionNote', v_note, 'office', v_office));
  end loop;
  return v_rows;
end;
$function$;
revoke all on function app_private.hrm_site_assignment_review_rows() from public, anon, authenticated;

create or replace function public.confirm_hrm_site_assignment_review(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_item jsonb;
  v_employee public.employees%rowtype;
  v_site uuid;
  v_since date;
  v_row public.hrm_site_assignments;
  v_made integer := 0;
begin
  if not app_private.hrm_site_assignment_is_approver(v_user) then
    raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được xác nhận hiện trạng.';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then
    raise exception using errcode = '22023', message = 'Danh sách xác nhận không hợp lệ.';
  end if;
  for v_item in select value from jsonb_array_elements(p_rows) loop
    select * into v_employee from public.employees where id = (v_item ->> 'employeeId')::uuid and status = 'Đang làm việc';
    continue when v_employee.id is null;
    continue when exists (select 1 from public.hrm_site_assignment_reviews where employee_id = v_employee.id);
    continue when exists (select 1 from public.hrm_site_assignments where employee_id = v_employee.id and status = 'approved');
    v_site := nullif(v_item ->> 'siteId', '')::uuid;
    if v_site is not null and not exists (select 1 from public.hrm_construction_sites where id = v_site) then
      raise exception using errcode = '22023', message = 'Công trường không hợp lệ.';
    end if;
    insert into public.hrm_site_assignment_reviews (employee_id, site_id, confirmed_by) values (v_employee.id, v_site, v_user);
    if v_site is not null then
      select min(staff.start_date) into v_since from public.project_staff staff
      left join public.projects project on project.id::text = staff.project_id
      where staff.user_id = v_employee.user_id::text and (staff.end_date is null or staff.end_date >= app_private.hrm_vn_today())
        and coalesce(nullif(staff.construction_site_id, '')::uuid, project.construction_site_id) = v_site;
      insert into public.hrm_site_assignments (code, employee_id, site_id, kind, start_date, status, reason, source, created_by, decided_by, decided_at)
      values (app_private.hrm_site_assignment_next_code(), v_employee.id, v_site, 'primary', least(coalesce(v_since, app_private.hrm_vn_today()), app_private.hrm_vn_today()),
              'approved', 'Ghi nhận hiện trạng trước khi bật điều động (HR xác nhận).', 'baseline', v_user, v_user, now())
      returning * into v_row;
      insert into public.hrm_site_assignment_events (assignment_id, action, actor) values (v_row.id, 'baseline', v_user);
      v_made := v_made + 1;
    end if;
    perform app_private.hrm_sync_employee_site(v_employee.id);
  end loop;
  return v_made;
end;
$function$;
revoke all on function public.confirm_hrm_site_assignment_review(jsonb) from public, anon;
grant execute on function public.confirm_hrm_site_assignment_review(jsonb) to authenticated;

-- ── Board ──────────────────────────────────────────────────────────────────
create or replace function public.get_hrm_site_assignment_board()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_hr boolean;
  v_approver boolean;
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  v_hr := app_private.hrm_site_assignment_is_hr(v_user);
  v_approver := app_private.hrm_site_assignment_is_approver(v_user);
  return jsonb_build_object(
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', assignment.id, 'code', assignment.code, 'employeeId', assignment.employee_id, 'employeeName', employee.full_name,
        'employeeCode', employee.employee_code, 'jobTitle', employee.title, 'siteId', assignment.site_id, 'siteName', site.name,
        'projectCode', (select code from public.projects where id::text = app_private.hrm_site_project_id(assignment.site_id)),
        'kind', assignment.kind, 'startDate', assignment.start_date, 'endDate', assignment.end_date, 'status', assignment.status,
        'reason', assignment.reason, 'source', assignment.source, 'fromSiteName', app_private.hrm_site_name(assignment.from_site_id),
        'createdByName', creator.name, 'createdAt', assignment.created_at, 'decidedByName', decider.name, 'decidedAt', assignment.decided_at,
        'decisionNote', assignment.decision_note, 'endedEarlyReason', assignment.ended_early_reason,
        'mine', assignment.created_by = v_user
      ) order by assignment.created_at desc)
      from public.hrm_site_assignments assignment
      join public.employees employee on employee.id = assignment.employee_id
      join public.hrm_construction_sites site on site.id = assignment.site_id
      left join public.users creator on creator.id = assignment.created_by
      left join public.users decider on decider.id = assignment.decided_by
      where v_hr or employee.user_id = v_user or assignment.created_by = v_user
        or app_private.hrm_is_site_leader(v_user, assignment.site_id) or app_private.hrm_is_site_leader(v_user, assignment.from_site_id)
        or (employee.user_id is not null and app_private.resolve_active_direct_manager(employee.user_id) = v_user)
    ), '[]'::jsonb),
    'sites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', site.id, 'name', site.name,
        'projectCode', project.code, 'projectName', project.name,
        'approverName', approver.name, 'hasCoordinates', site.latitude is not null and site.longitude is not null
      ) order by site.name)
      from public.hrm_construction_sites site
      left join public.projects project on project.id::text = app_private.hrm_site_project_id(site.id)
      left join public.users approver on approver.id::text = nullif(site."managerId", '')
    ), '[]'::jsonb),
    'review', case when v_approver then app_private.hrm_site_assignment_review_rows() else '[]'::jsonb end,
    'can', jsonb_build_object('create', app_private.hrm_site_assignment_can_create_any(v_user), 'approve', v_approver)
  );
end;
$function$;
revoke all on function public.get_hrm_site_assignment_board() from public, anon;
grant execute on function public.get_hrm_site_assignment_board() to authenticated;

-- ── Check-in prefers the assigned sites (project team list only as fallback) ──
create or replace function app_private.get_my_checkin_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_actor_user_id uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_assigned uuid[];
begin
  if (select auth.uid()) is null or v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'HRM_CHECKIN_SESSION_REQUIRED';
  end if;

  select employee.* into v_employee
  from public.employees employee
  where employee.user_id = v_actor_user_id and employee.status = 'Đang làm việc'
  order by employee.updated_at desc nulls last, employee.created_at desc nulls last
  limit 1;

  if v_employee.id is null then
    return jsonb_build_object('employee', null, 'attendanceRecords', '[]'::jsonb,
      'constructionSites', '[]'::jsonb, 'offices', '[]'::jsonb, 'assignedSiteIds', '[]'::jsonb);
  end if;

  v_assigned := app_private.hrm_employee_sites_on(v_employee.id, app_private.hrm_vn_today());

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'id', v_employee.id,
      'employee_code', v_employee.employee_code,
      'full_name', v_employee.full_name,
      'title', v_employee.title,
      'status', v_employee.status,
      'user_id', v_employee.user_id,
      'office_id', v_employee.office_id,
      'construction_site_id', v_employee.construction_site_id,
      'avatar_url', v_employee.avatar_url
    ),
    'attendanceRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', attendance.id,
        'employeeId', attendance."employeeId",
        'date', attendance.date,
        'status', attendance.status,
        'checkIn', attendance."checkIn",
        'checkOut', attendance."checkOut",
        'checkInPhoto', attendance."checkInPhoto",
        'overtimeHours', attendance."overtimeHours",
        'note', attendance.note,
        'events', attendance.events,
        'eventCount', attendance."eventCount",
        'approvalStatus', attendance."approvalStatus",
        'locationName', attendance."locationName",
        'locationType', attendance."locationType",
        'isOutOfRange', attendance."isOutOfRange",
        'createdAt', attendance."createdAt"
      ) order by attendance.date desc)
      from public.hrm_attendance attendance
      where attendance."employeeId" = v_employee.id
        and attendance.date >= to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date - 62, 'YYYY-MM-DD')
    ), '[]'::jsonb),
    'constructionSites', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', site.id,
        'name', site.name,
        'latitude', site.latitude,
        'longitude', site.longitude,
        'checkInRadius', coalesce(site."checkInRadius", 300)
      ) order by site.name)
      from public.hrm_construction_sites site
    ), '[]'::jsonb),
    'offices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', office.id,
        'name', office.name,
        'latitude', office.latitude,
        'longitude', office.longitude,
        'checkInRadius', coalesce(office."checkInRadius", 150)
      ) order by office.name)
      from public.hrm_offices office
    ), '[]'::jsonb),
    -- Sites the person is assigned to today (H2); before H2 review, the project team list. Used when several areas overlap.
    'assignedSiteIds', case when cardinality(v_assigned) > 0 then to_jsonb(v_assigned) else coalesce((
      select jsonb_agg(distinct staff.construction_site_id)
      from public.project_staff staff
      where staff.user_id = v_actor_user_id::text
        and staff.construction_site_id is not null
        and (staff.end_date is null or staff.end_date >= current_date)
    ), '[]'::jsonb) end
  );
end;
$function$;
