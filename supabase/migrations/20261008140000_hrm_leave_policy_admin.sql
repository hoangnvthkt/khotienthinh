-- Thiết lập nghỉ phép (owner decision 03/10/2026):
--   1. The director step threshold is set per leave type (second_step_after_days; null = never).
--   2. Each type may list reasons (subtypes) with a day limit; staff must pick one, longer requests are refused.
--   3. A type may require papers (photos / PDF) attached when the request is sent.
--   4. HR Manage / Admin may add new types; types are switched off, never deleted.
--   5. Every policy change goes through RPCs and is written to hrm_leave_policy_log.
-- Changes apply to new requests only: a request keeps the approval chain stored when it was sent.

-- ── Leave type columns ─────────────────────────────────────────────────────
alter table public.hrm_leave_types
  add column if not exists second_step_after_days numeric(4,1),
  add column if not exists subtypes jsonb not null default '[]'::jsonb,
  add column if not exists requires_attachment boolean not null default false,
  add column if not exists attachment_hint text,
  add column if not exists is_system boolean not null default false,
  add column if not exists updated_by uuid,
  add column if not exists updated_at timestamptz not null default now();
alter table public.hrm_leave_types drop constraint if exists hrm_leave_types_second_step_after_days_check;
alter table public.hrm_leave_types add constraint hrm_leave_types_second_step_after_days_check
  check (second_step_after_days is null or (second_step_after_days >= 0 and second_step_after_days * 2 = floor(second_step_after_days * 2)));
alter table public.hrm_leave_types drop constraint if exists hrm_leave_types_subtypes_array_check;
alter table public.hrm_leave_types add constraint hrm_leave_types_subtypes_array_check check (jsonb_typeof(subtypes) = 'array');

-- Today's rule: types marked for step 2 add it above the shared threshold (3 working days).
update public.hrm_leave_types leave_type
set second_step_after_days = settings.second_step_threshold_days
from public.hrm_leave_settings settings
where settings.singleton and leave_type.needs_second_step and leave_type.second_step_after_days is null;

-- Sổ phép and bảng công read these types by code / pay source.
update public.hrm_leave_types set is_system = true where code in ('annual', 'late_early', 'overtime', 'business_trip', 'other');

-- Reasons that were written in the app (Điều 115 BLLĐ 2019; late/early reasons are read by the timesheet).
update public.hrm_leave_types set subtypes = '[
  {"name": "Kết hôn", "maxDays": 3},
  {"name": "Con đẻ, con nuôi kết hôn", "maxDays": 1},
  {"name": "Bố mẹ (hai bên), vợ/chồng, con mất", "maxDays": 3}
]'::jsonb where code = 'personal' and subtypes = '[]'::jsonb;
update public.hrm_leave_types set subtypes = '[
  {"name": "Ông bà, anh chị em ruột mất", "maxDays": 1},
  {"name": "Bố/mẹ, anh chị em ruột kết hôn", "maxDays": 1}
]'::jsonb where code = 'personal_unpaid' and subtypes = '[]'::jsonb;
update public.hrm_leave_types set subtypes = '[
  {"name": "Đi muộn", "maxDays": null},
  {"name": "Về sớm", "maxDays": null},
  {"name": "Ra ngoài trong giờ", "maxDays": null}
]'::jsonb where code = 'late_early' and subtypes = '[]'::jsonb;

-- Writes only through the RPCs below.
drop policy if exists hrm_leave_types_write on public.hrm_leave_types;
drop policy if exists hrm_leave_settings_update on public.hrm_leave_settings;

-- ── Papers on a request ────────────────────────────────────────────────────
alter table public.hrm_leave_requests add column if not exists attachment_paths text[] not null default '{}';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hrm-leave-evidence', 'hrm-leave-evidence', false, 5242880,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Approvers on the request (and HR) may open its papers.
create or replace function app_private.hrm_leave_attachment_visible(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.hrm_leave_requests request
    where p_path = any(request.attachment_paths)
      and (
        exists (select 1 from jsonb_array_elements(request.approvers) step where step ->> 'userId' = public.current_app_user_id()::text)
        or public.current_app_user_id() = any(app_private.hrm_leave_hr_user_ids())
      )
  );
$function$;
revoke all on function app_private.hrm_leave_attachment_visible(text) from public, anon;
grant execute on function app_private.hrm_leave_attachment_visible(text) to authenticated;

drop policy if exists hrm_leave_evidence_insert on storage.objects;
create policy hrm_leave_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'hrm-leave-evidence'
    and app_private.hrm_employee_is_current_user(split_part(name, '/', 1))
  );
drop policy if exists hrm_leave_evidence_select on storage.objects;
create policy hrm_leave_evidence_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'hrm-leave-evidence'
    and (
      app_private.hrm_employee_is_current_user(split_part(name, '/', 1))
      or app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')
      or app_private.hrm_leave_attachment_visible(name)
    )
  );

-- ── Change history ─────────────────────────────────────────────────────────
create table if not exists public.hrm_leave_policy_log (
  id uuid primary key default gen_random_uuid(),
  target text not null,
  action text not null check (action in ('create', 'update', 'activate', 'deactivate')),
  changes jsonb not null default '{}'::jsonb,
  actor uuid,
  created_at timestamptz not null default now()
);
create index if not exists hrm_leave_policy_log_created_idx on public.hrm_leave_policy_log (created_at desc);
alter table public.hrm_leave_policy_log enable row level security;
revoke all on public.hrm_leave_policy_log from anon, authenticated;

-- One leave type as the settings screen sees it (camelCase, same keys as the change log).
create or replace function app_private.hrm_leave_type_json(p_type public.hrm_leave_types)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select jsonb_build_object(
    'name', p_type.name,
    'description', coalesce(p_type.description, ''),
    'paidBy', p_type.paid_by,
    'secondStepAfterDays', p_type.second_step_after_days,
    'hrStep', p_type.second_step_hr,
    'requiresOfficial', p_type.requires_official,
    'subtypes', p_type.subtypes,
    'requiresAttachment', p_type.requires_attachment,
    'attachmentHint', coalesce(p_type.attachment_hint, '')
  );
$function$;
revoke all on function app_private.hrm_leave_type_json(public.hrm_leave_types) from public, anon, authenticated;

-- Only the keys whose value changed: {"key": {"from": …, "to": …}}.
create or replace function app_private.hrm_leave_policy_diff(p_before jsonb, p_after jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_object_agg(key, jsonb_build_object('from', p_before -> key, 'to', p_after -> key)), '{}'::jsonb)
  from jsonb_object_keys(p_after) key
  where (p_before -> key) is distinct from (p_after -> key);
$function$;
revoke all on function app_private.hrm_leave_policy_diff(jsonb, jsonb) from public, anon, authenticated;

create or replace function app_private.hrm_leave_policy_require_manage()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
begin
  if v_user is null then raise exception using errcode = '28000', message = 'Phiên đăng nhập không hợp lệ.'; end if;
  if not app_private.current_user_has_hrm_template_permission('hrm.master_data.manage') then
    raise exception using errcode = '42501', message = 'Chỉ HR Manage và Admin được sửa thiết lập nghỉ phép.';
  end if;
  return v_user;
end;
$function$;
revoke all on function app_private.hrm_leave_policy_require_manage() from public, anon, authenticated;

-- ── Save a leave type (create when p_code is null) ─────────────────────────
create or replace function public.save_hrm_leave_type(p_code text, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := app_private.hrm_leave_policy_require_manage();
  v_type public.hrm_leave_types%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_name text := btrim(coalesce(p_payload ->> 'name', ''));
  v_description text := nullif(btrim(coalesce(p_payload ->> 'description', '')), '');
  v_paid_by text := coalesce(p_payload ->> 'paidBy', 'none');
  v_after_days numeric := (p_payload ->> 'secondStepAfterDays')::numeric;
  v_hr_step boolean := coalesce((p_payload ->> 'hrStep')::boolean, false);
  v_official boolean := coalesce((p_payload ->> 'requiresOfficial')::boolean, false);
  v_attach boolean := coalesce((p_payload ->> 'requiresAttachment')::boolean, false);
  v_hint text := nullif(btrim(coalesce(p_payload ->> 'attachmentHint', '')), '');
  v_subtypes jsonb := '[]'::jsonb;
  v_item jsonb;
  v_item_name text;
  v_item_max numeric;
  v_code text;
  v_after jsonb;
begin
  if p_code is not null then
    select * into v_type from public.hrm_leave_types where code = p_code for update;
    if v_type.code is null or v_type.code = 'other' then
      raise exception using errcode = 'P0002', message = 'Không tìm thấy loại đơn.';
    end if;
    v_before := app_private.hrm_leave_type_json(v_type);
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception using errcode = '22023', message = 'Tên loại đơn từ 2 đến 60 ký tự.';
  end if;
  if exists (select 1 from public.hrm_leave_types other where lower(other.name) = lower(v_name) and other.code is distinct from p_code) then
    raise exception using errcode = '23505', message = format('Đã có loại đơn tên "%s".', v_name);
  end if;
  if char_length(coalesce(v_description, '')) > 300 then
    raise exception using errcode = '22023', message = 'Mô tả tối đa 300 ký tự.';
  end if;
  if v_paid_by not in ('company', 'social_insurance', 'none') then
    raise exception using errcode = '22023', message = 'Chọn hưởng lương hợp lệ.';
  end if;
  if v_type.code in ('annual', 'late_early', 'overtime', 'business_trip') and v_paid_by <> v_type.paid_by then
    raise exception using errcode = '42501', message = 'Loại hệ thống: không đổi được hưởng lương vì sổ phép và bảng công đang tính theo cách này.';
  end if;

  if coalesce(v_type.unit, 'day') = 'minute' then
    v_after_days := null;
  elsif v_after_days is not null and (v_after_days < 0 or v_after_days > 365 or v_after_days * 2 <> floor(v_after_days * 2)) then
    raise exception using errcode = '22023', message = 'Ngưỡng thêm bước duyệt là số ngày từ 0 đến 365, bước 0,5.';
  end if;

  if jsonb_typeof(coalesce(p_payload -> 'subtypes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_payload -> 'subtypes', '[]'::jsonb)) > 20 then
    raise exception using errcode = '22023', message = 'Tối đa 20 lý do cho một loại đơn.';
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_payload -> 'subtypes', '[]'::jsonb)) loop
    v_item_name := btrim(coalesce(v_item ->> 'name', ''));
    continue when v_item_name = '';
    v_item_max := case when coalesce(v_type.unit, 'day') = 'minute' then null else (v_item ->> 'maxDays')::numeric end;
    if char_length(v_item_name) > 80 then
      raise exception using errcode = '22023', message = 'Tên lý do tối đa 80 ký tự.';
    end if;
    if exists (select 1 from jsonb_array_elements(v_subtypes) seen where lower(seen ->> 'name') = lower(v_item_name)) then
      raise exception using errcode = '22023', message = format('Lý do "%s" bị trùng.', v_item_name);
    end if;
    if v_item_max is not null and (v_item_max <= 0 or v_item_max > 365 or v_item_max * 2 <> floor(v_item_max * 2)) then
      raise exception using errcode = '22023', message = format('Số ngày tối đa của "%s" phải lớn hơn 0, bước 0,5.', v_item_name);
    end if;
    v_subtypes := v_subtypes || jsonb_build_array(jsonb_build_object('name', v_item_name, 'maxDays', v_item_max));
  end loop;
  if v_type.code in ('late_early', 'overtime') and v_subtypes is distinct from v_type.subtypes then
    raise exception using errcode = '42501', message = 'Bảng công đọc các lý do đi muộn / về sớm nên không đổi được.';
  end if;

  if v_attach and char_length(coalesce(v_hint, '')) < 3 then
    raise exception using errcode = '22023', message = 'Ghi rõ giấy tờ cần nộp để nhân viên biết chụp gì.';
  end if;
  if char_length(coalesce(v_hint, '')) > 200 then
    raise exception using errcode = '22023', message = 'Mô tả giấy tờ tối đa 200 ký tự.';
  end if;

  if p_code is null then
    v_code := 'custom_' || substr(md5(gen_random_uuid()::text), 1, 8);
    insert into public.hrm_leave_types (
      code, name, description, paid_by, deducts_annual, unit, needs_second_step, second_step_after_days, second_step_hr,
      requires_official, subtypes, requires_attachment, attachment_hint, is_system, is_active, sort_order, updated_by, updated_at
    ) values (
      v_code, v_name, v_description, v_paid_by, false, 'day', v_after_days is not null, v_after_days, v_hr_step,
      v_official, v_subtypes, v_attach, v_hint, false, true,
      least(990, coalesce((select max(sort_order) from public.hrm_leave_types where code <> 'other'), 100) + 10), v_user, now()
    )
    returning * into v_type;
  else
    update public.hrm_leave_types set
      name = v_name, description = v_description, paid_by = v_paid_by,
      needs_second_step = v_after_days is not null, second_step_after_days = v_after_days, second_step_hr = v_hr_step,
      requires_official = v_official, subtypes = v_subtypes, requires_attachment = v_attach, attachment_hint = v_hint,
      updated_by = v_user, updated_at = now()
    where code = p_code
    returning * into v_type;
  end if;

  v_after := app_private.hrm_leave_type_json(v_type);
  if p_code is null or v_after is distinct from v_before then
    insert into public.hrm_leave_policy_log (target, action, changes, actor)
    values (v_type.code, case when p_code is null then 'create' else 'update' end, app_private.hrm_leave_policy_diff(v_before, v_after), v_user);
  end if;
  return v_type.code;
end;
$function$;
revoke all on function public.save_hrm_leave_type(text, jsonb) from public, anon;
grant execute on function public.save_hrm_leave_type(text, jsonb) to authenticated;

create or replace function public.set_hrm_leave_type_active(p_code text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := app_private.hrm_leave_policy_require_manage();
  v_before boolean;
begin
  select is_active into v_before from public.hrm_leave_types where code = p_code and code <> 'other' for update;
  if v_before is null then raise exception using errcode = 'P0002', message = 'Không tìm thấy loại đơn.'; end if;
  if v_before = p_active then return; end if;
  if not p_active and (select count(*) from public.hrm_leave_types where is_active and code <> p_code) = 0 then
    raise exception using errcode = '23514', message = 'Phải còn ít nhất một loại đơn đang dùng.';
  end if;
  update public.hrm_leave_types set is_active = p_active, updated_by = v_user, updated_at = now() where code = p_code;
  insert into public.hrm_leave_policy_log (target, action, changes, actor)
  values (p_code, case when p_active then 'activate' else 'deactivate' end,
          jsonb_build_object('isActive', jsonb_build_object('from', v_before, 'to', p_active)), v_user);
end;
$function$;
revoke all on function public.set_hrm_leave_type_active(text, boolean) from public, anon;
grant execute on function public.set_hrm_leave_type_active(text, boolean) to authenticated;

create or replace function public.save_hrm_leave_settings(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := app_private.hrm_leave_policy_require_manage();
  v_settings public.hrm_leave_settings%rowtype;
  v_approver uuid := nullif(p_payload ->> 'secondStepApproverUserId', '')::uuid;
  v_label text := btrim(coalesce(p_payload ->> 'secondStepLabel', ''));
  v_minutes integer := (p_payload ->> 'lateEarlyMaxMinutes')::integer;
  v_saturday boolean := coalesce((p_payload ->> 'saturdayIsWorkday')::boolean, true);
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_settings from public.hrm_leave_settings where singleton for update;
  if char_length(v_label) < 2 or char_length(v_label) > 60 then
    raise exception using errcode = '22023', message = 'Tên bước duyệt từ 2 đến 60 ký tự.';
  end if;
  if v_minutes is null or v_minutes < 5 or v_minutes > 480 then
    raise exception using errcode = '22023', message = 'Đi muộn / về sớm tối đa từ 5 đến 480 phút.';
  end if;
  if v_approver is not null and not exists (select 1 from public.users u where u.id = v_approver and coalesce(u.is_active, true)) then
    raise exception using errcode = '22023', message = 'Người duyệt không còn hoạt động.';
  end if;
  v_before := jsonb_build_object('secondStepApproverUserId', v_settings.second_step_approver_user_id, 'secondStepLabel', v_settings.second_step_label,
    'lateEarlyMaxMinutes', v_settings.late_early_max_minutes, 'saturdayIsWorkday', v_settings.saturday_is_workday);
  v_after := jsonb_build_object('secondStepApproverUserId', v_approver, 'secondStepLabel', v_label,
    'lateEarlyMaxMinutes', v_minutes, 'saturdayIsWorkday', v_saturday);
  if v_after = v_before then return; end if;
  update public.hrm_leave_settings set
    second_step_approver_user_id = v_approver, second_step_label = v_label, late_early_max_minutes = v_minutes,
    saturday_is_workday = v_saturday, updated_by = v_user, updated_at = now()
  where singleton;
  insert into public.hrm_leave_policy_log (target, action, changes, actor)
  values ('settings', 'update', app_private.hrm_leave_policy_diff(v_before, v_after), v_user);
end;
$function$;
revoke all on function public.save_hrm_leave_settings(jsonb) from public, anon;
grant execute on function public.save_hrm_leave_settings(jsonb) to authenticated;

create or replace function public.list_hrm_leave_policy_log(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not (app_private.current_user_has_hrm_template_permission('hrm.employee.view_sensitive')
          or app_private.current_user_has_hrm_template_permission('hrm.master_data.manage')) then
    raise exception using errcode = '42501', message = 'Chỉ HR xem được lịch sử thiết lập nghỉ phép.';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', log.id, 'target', log.target, 'action', log.action, 'changes', log.changes,
      'actorName', u.name, 'createdAt', log.created_at) order by log.created_at desc)
    from (select * from public.hrm_leave_policy_log order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) log
    left join public.users u on u.id = log.actor
  ), '[]'::jsonb);
end;
$function$;
revoke all on function public.list_hrm_leave_policy_log(integer) from public, anon;
grant execute on function public.list_hrm_leave_policy_log(integer) to authenticated;

-- ── Approval chain: director step by the type's own threshold ──────────────
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

  if v_type.unit = 'day'
    and v_type.second_step_after_days is not null
    and p_days > v_type.second_step_after_days
    and v_settings.second_step_approver_user_id is not null
    and v_settings.second_step_approver_user_id is distinct from v_step1_user
    and v_settings.second_step_approver_user_id <> v_employee.user_id
  then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'order', 2, 'kind', 'director', 'userId', v_settings.second_step_approver_user_id,
      'label', v_settings.second_step_label, 'status', 'waiting'));
  end if;
  -- Late/early explanations and overtime confirmations are also checked by HR (owner decision 02/10/2026).
  if coalesce(v_type.second_step_hr, false) and v_step1_kind <> 'hr' then
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'order', jsonb_array_length(v_steps) + 1, 'kind', 'hr', 'userId', null,
      'label', 'Phòng Hành chính - Nhân sự', 'status', 'waiting'));
  end if;
  return v_steps;
end;
$function$;

-- ── Preview: also checks the chosen reason and its day limit ───────────────
drop function if exists public.preview_my_leave_request(text, date, date, text, text, integer);
create or replace function public.preview_my_leave_request(
  p_type text, p_start date, p_end date, p_start_session text default 'full', p_end_session text default 'full',
  p_minutes integer default null, p_subtype text default null
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
  v_unclaimed integer;
  v_month_claimed integer;
  v_subtype jsonb;
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

  if v_type.code = 'overtime' and p_start is not null then
    v_unclaimed := app_private.hrm_overtime_unclaimed_minutes(v_employee.id, p_start);
    v_month_claimed := app_private.hrm_overtime_claimed_minutes(v_employee.id, p_start);
    if p_minutes is null or p_minutes < 1 then
      v_problems := v_problems || jsonb_build_array('Nhập số phút làm thêm cần xác nhận.');
    elsif p_minutes > v_unclaimed then
      v_problems := v_problems || jsonb_build_array(format('Tháng %s chỉ còn %s phút dư chưa xác nhận.', to_char(p_start, 'MM/YYYY'), v_unclaimed));
    elsif v_month_claimed + p_minutes > 2400 then
      v_problems := v_problems || jsonb_build_array('Vượt trần làm thêm 40 giờ/tháng (Bộ luật Lao động, Nghị định 145/2020).');
    end if;
  elsif v_type.unit = 'minute' then
    if p_minutes is null or p_minutes < 1 or p_minutes > v_settings.late_early_max_minutes then
      v_problems := v_problems || jsonb_build_array(format('Số phút từ 1 đến %s.', v_settings.late_early_max_minutes));
    end if;
  else
    v_days := app_private.hrm_leave_working_days(p_start, p_end, coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'));
    if p_start is not null and p_end is not null and v_days = 0 then
      v_problems := v_problems || jsonb_build_array('Khoảng ngày này không có ngày làm việc nào.');
    end if;
  end if;

  -- A reason that is given must be one of the type's reasons and fit its day limit (submit also requires one).
  if nullif(btrim(coalesce(p_subtype, '')), '') is not null and jsonb_array_length(v_type.subtypes) > 0 then
    select value into v_subtype from jsonb_array_elements(v_type.subtypes) where value ->> 'name' = btrim(p_subtype) limit 1;
    if v_subtype is null then
      v_problems := v_problems || jsonb_build_array('Lý do nghỉ không còn trong danh sách. Chọn lại lý do.');
    elsif v_type.unit = 'day' and (v_subtype ->> 'maxDays') is not null and v_days > (v_subtype ->> 'maxDays')::numeric then
      v_problems := v_problems || jsonb_build_array(format('"%s" được nghỉ tối đa %s ngày, đơn này %s ngày.',
        v_subtype ->> 'name', trim_scale((v_subtype ->> 'maxDays')::numeric), trim_scale(v_days)));
    end if;
  end if;

  if v_type.requires_official and v_employee.official_date is not null and v_employee.official_date > coalesce(p_start, current_date) then
    v_problems := v_problems || jsonb_build_array('Nhân sự đang thử việc chưa có phép năm. Chọn "Nghỉ không lương" hoặc loại phù hợp.');
  end if;

  if v_type.deducts_annual and p_start is not null then
    -- Carried days only cover leave starting on or before 31/03 (G2b).
    v_remaining := app_private.hrm_leave_annual_available(v_employee.id, p_start);
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
    'paidBy', v_type.paid_by,
    'unclaimedMinutes', v_unclaimed
  );
end;
$function$;
revoke all on function public.preview_my_leave_request(text, date, date, text, text, integer, text) from public, anon;
grant execute on function public.preview_my_leave_request(text, date, date, text, text, integer, text) to authenticated;

-- ── Submit: reason required when the type lists reasons; papers when required ──
drop function if exists public.submit_my_leave_request(text, date, date, text, text, integer, text, text);
create or replace function public.submit_my_leave_request(
  p_type text, p_start date, p_end date, p_start_session text, p_end_session text, p_minutes integer, p_subtype text, p_reason text,
  p_attachment_paths text[] default '{}'
)
returns public.hrm_leave_requests
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := public.current_app_user_id();
  v_employee public.employees%rowtype;
  v_type public.hrm_leave_types%rowtype;
  v_preview jsonb;
  v_steps jsonb;
  v_row public.hrm_leave_requests;
  v_code text;
  v_first jsonb;
  v_recipients uuid[];
  v_paths text[] := coalesce(p_attachment_paths, '{}');
  v_path text;
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Nhập lý do (ít nhất 3 ký tự).';
  end if;
  v_preview := public.preview_my_leave_request(p_type, p_start, coalesce(p_end, p_start), p_start_session, p_end_session, p_minutes, p_subtype);
  if jsonb_array_length(v_preview -> 'problems') > 0 then
    raise exception using errcode = '23514', message = v_preview -> 'problems' ->> 0;
  end if;
  select * into v_employee from public.employees
  where user_id = v_user and status = 'Đang làm việc' order by updated_at desc nulls last limit 1;
  select * into v_type from public.hrm_leave_types where code = p_type;

  if jsonb_array_length(v_type.subtypes) > 0 and nullif(btrim(coalesce(p_subtype, '')), '') is null then
    raise exception using errcode = '23514', message = 'Chọn lý do nghỉ.';
  end if;
  if cardinality(v_paths) > 4 then
    raise exception using errcode = '22023', message = 'Đính kèm tối đa 4 giấy tờ.';
  end if;
  if v_type.requires_attachment and cardinality(v_paths) = 0 then
    raise exception using errcode = '23514', message = format('Đính kèm giấy tờ: %s.', coalesce(v_type.attachment_hint, 'giấy tờ chứng minh'));
  end if;
  foreach v_path in array v_paths loop
    if split_part(v_path, '/', 1) <> v_employee.id::text
      or not exists (select 1 from storage.objects object where object.bucket_id = 'hrm-leave-evidence' and object.name = v_path) then
      raise exception using errcode = '22023', message = 'Giấy tờ đính kèm không hợp lệ. Tải lại rồi gửi đơn.';
    end if;
  end loop;

  -- Overlapping requests for the same days are refused (late/early may coexist with day leave).
  if v_type.unit = 'day' and exists (
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
    start_session, end_session, minutes, subtype, current_step, created_by, "createdAt", priority, attachment_paths
  ) values (
    gen_random_uuid(), v_employee.id, p_type, p_start::text, coalesce(p_end, p_start)::text,
    (v_preview ->> 'days')::numeric, trim(p_reason), 'pending', v_code, v_steps,
    coalesce(p_start_session, 'full'), coalesce(p_end_session, 'full'), p_minutes, nullif(trim(coalesce(p_subtype, '')), ''),
    1, v_user, now(), 'medium', v_paths
  )
  returning * into v_row;

  insert into public.hrm_leave_logs (leave_request_id, action, acted_by, comment)
  values (v_row.id, 'create', v_user, 'Tạo đơn');

  v_first := v_steps -> 0;
  v_recipients := case when v_first ->> 'kind' = 'hr' then app_private.hrm_leave_hr_user_ids()
                       else array[(v_first ->> 'userId')::uuid] end;
  perform app_private.notify_hrm_leave(v_row.id, v_recipients, 'Đơn chờ bạn duyệt',
    format('%s · %s · %s', v_employee.full_name, v_type.name,
      case when p_minutes is not null then p_minutes || ' phút ngày ' || to_char(p_start, 'DD/MM')
           else (v_preview ->> 'days') || ' ngày từ ' || to_char(p_start, 'DD/MM') end));
  return v_row;
end;
$function$;
revoke all on function public.submit_my_leave_request(text, date, date, text, text, integer, text, text, text[]) from public, anon;
grant execute on function public.submit_my_leave_request(text, date, date, text, text, integer, text, text, text[]) to authenticated;
