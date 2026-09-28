-- Notification targeting, step 2 (first slice): the site command (Ban chỉ huy
-- công trường) as a recipient group, and an Admin preview of who an alert
-- reaches.
-- Owner decision 28/09/2026: BCH = Chỉ huy trưởng, Chỉ huy phó, Kỹ thuật
-- trưởng. The positions live in hrm_positions (one per site command, e.g.
-- "Chỉ huy trưởng BCH RICO"); which of them count as BCH is kept here and only
-- Admins change it. A person belongs to a project's BCH when their active
-- project_staff row in that project (and site) holds one of these positions.
-- Rules opt in with recipient_config.includeSiteCommand.

create table if not exists public.notification_site_command_positions (
  position_id uuid primary key references public.hrm_positions(id) on delete cascade,
  added_by uuid references public.users(id),
  added_at timestamptz not null default now()
);
alter table public.notification_site_command_positions enable row level security;
revoke all on public.notification_site_command_positions from anon, authenticated;
grant select on public.notification_site_command_positions to authenticated;
drop policy if exists notification_site_command_positions_select on public.notification_site_command_positions;
create policy notification_site_command_positions_select on public.notification_site_command_positions
  for select to authenticated using (true);

insert into public.notification_site_command_positions (position_id)
select p.id from public.hrm_positions p
where p.code in ('VT015', 'VT016', 'VT024', 'VT025', 'VT076')
on conflict do nothing;

create or replace function app_private.alert_site_command_ids(p_project_id text, p_construction_site_id text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct user_row.id), '{}'::uuid[])
  from public.project_staff staff
  join public.notification_site_command_positions command on command.position_id = staff.position_id
  join public.users user_row on user_row.id::text = staff.user_id
  where staff.end_date is null and staff.project_id = p_project_id
    and (staff.construction_site_id is null or p_construction_site_id is null
         or staff.construction_site_id = p_construction_site_id)
    and user_row.is_active and user_row.account_status = 'ACTIVE' and user_row.auth_id is not null;
$$;

-- Room (or finance switch) each project alert reads its actions from.
create or replace function app_private.alert_room_code(p_alert_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_alert_key
    when 'overdue_payment' then 'payment'
    when 'stale_daily_log' then 'daily_log'
    when 'budget_overrun' then 'finance'
    when 'slow_progress' then 'gantt'
    when 'material_waste' then 'material_planning'
    when 'safety_critical' then 'safety'
  end;
$$;

-- Resolve recipients for one alert occurrence from the rule's recipient_config.
create or replace function app_private.alert_resolve_recipients(
  p_rule public.notification_alert_rules,
  p_room_code text default null,
  p_project_id text default null,
  p_construction_site_id text default null,
  p_employee_user_id uuid default null
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config jsonb := coalesce(p_rule.recipient_config, '{"mode":"admin","fallbackToAdmin":true}'::jsonb);
  v_mode text := coalesce(v_config ->> 'mode', 'admin');
  v_ids uuid[] := '{}';
begin
  if v_mode = 'admin' then
    v_ids := app_private.alert_admin_ids();
  elsif v_mode = 'roles' then
    v_ids := array(select u.id from public.users u
      where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
        and u.role::text = any(array(select jsonb_array_elements_text(coalesce(v_config -> 'roles', '[]'::jsonb)))));
  elsif v_mode = 'broadcast' then
    v_ids := array(select u.id from public.users u
      where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null);
  elsif v_mode = 'module_admins' then
    v_ids := app_private.alert_module_manager_ids(array(select jsonb_array_elements_text(coalesce(v_config -> 'moduleKeys', '[]'::jsonb))));
  elsif v_mode = 'employee_owner' then
    v_ids := case when p_employee_user_id is null then '{}'::uuid[] else array[p_employee_user_id] end;
  elsif v_mode = 'project_permission' and p_room_code = 'finance' and p_project_id is not null then
    v_ids := app_private.alert_finance_recipient_ids(
      p_project_id, array(select jsonb_array_elements_text(coalesce(v_config -> 'projectPermissionCodes', '[]'::jsonb))));
  elsif v_mode = 'project_permission' and p_room_code is not null and p_project_id is not null then
    v_ids := app_private.alert_room_recipient_ids(
      p_project_id, p_construction_site_id, p_room_code,
      array(select jsonb_array_elements_text(coalesce(v_config -> 'projectPermissionCodes', '[]'::jsonb))));
  elsif v_mode = 'users' then
    v_ids := array(select u.id from public.users u
      where u.is_active and u.account_status = 'ACTIVE' and u.auth_id is not null
        and u.id::text = any(array(select jsonb_array_elements_text(coalesce(v_config -> 'userIds', '[]'::jsonb)))));
  end if;

  if coalesce((v_config ->> 'includeSiteCommand')::boolean, false) and p_project_id is not null then
    v_ids := v_ids || app_private.alert_site_command_ids(p_project_id, p_construction_site_id);
  end if;
  if coalesce((v_config ->> 'includeAdmins')::boolean, false) and v_mode not in ('admin') then
    v_ids := v_ids || app_private.alert_admin_ids();
  end if;
  v_ids := array(select distinct unnest(v_ids));
  if cardinality(v_ids) = 0 and coalesce((v_config ->> 'fallbackToAdmin')::boolean, true) then
    v_ids := app_private.alert_admin_ids();
  end if;
  return v_ids;
end;
$$;

-- Admin: choose which positions form the site command.
create or replace function public.set_site_command_positions(p_position_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct unnest(coalesce(p_position_ids, '{}'::uuid[])));
  v_before text[];
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'SITE_COMMAND_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if exists (select 1 from unnest(v_ids) wanted(position_id)
             where not exists (select 1 from public.hrm_positions p where p.id = wanted.position_id)) then
    raise exception 'SITE_COMMAND_POSITION_NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(p.name order by p.name), '{}') into v_before
  from public.notification_site_command_positions c join public.hrm_positions p on p.id = c.position_id;

  delete from public.notification_site_command_positions where position_id <> all(v_ids);
  insert into public.notification_site_command_positions (position_id, added_by)
  select wanted.position_id, public.current_app_user_id() from unnest(v_ids) wanted(position_id)
  on conflict do nothing;
  select count(*) into v_count from public.notification_site_command_positions;

  insert into public.audit_trail (table_name, record_id, action, old_data, new_data, module, description)
  values ('notification_site_command_positions', 'site_command', 'UPDATE',
    jsonb_build_object('positions', v_before),
    jsonb_build_object('positions', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
      from public.notification_site_command_positions c join public.hrm_positions p on p.id = c.position_id)),
    'SETTINGS', 'Cập nhật chức vụ thuộc Ban chỉ huy công trường (' || v_count || ' chức vụ)');
  return v_count;
end;
$$;

-- Admin: who an alert rule would reach for one project, and why. Uses the
-- saved rule, or an unsaved recipient_config being edited in Settings.
create or replace function public.preview_alert_recipients(
  p_alert_key text,
  p_project_id text default null,
  p_recipient_config jsonb default null
)
returns table (user_id uuid, user_name text, sources text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_rule public.notification_alert_rules;
  v_config jsonb;
  v_mode text;
  v_room text := app_private.alert_room_code(p_alert_key);
  v_final uuid[];
  v_base uuid[] := '{}';
  v_command uuid[] := '{}';
  v_admins uuid[] := app_private.alert_admin_ids();
begin
  if not public.is_admin() then
    raise exception 'ALERT_PREVIEW_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  select * into v_rule from public.notification_alert_rules r where r.alert_key = p_alert_key;
  if not found then
    raise exception 'ALERT_RULE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_recipient_config is not null then
    v_rule.recipient_config := p_recipient_config;
  end if;
  v_config := coalesce(v_rule.recipient_config, '{}'::jsonb);
  v_mode := coalesce(v_config ->> 'mode', 'admin');
  v_final := app_private.alert_resolve_recipients(v_rule, v_room, p_project_id, null);

  -- The mode's own group, without Admin add-ons or fallback.
  v_rule.recipient_config := v_config || '{"includeAdmins":false,"includeSiteCommand":false,"fallbackToAdmin":false}'::jsonb;
  if v_mode <> 'admin' then
    v_base := app_private.alert_resolve_recipients(v_rule, v_room, p_project_id, null);
  end if;
  if coalesce((v_config ->> 'includeSiteCommand')::boolean, false) and p_project_id is not null then
    v_command := app_private.alert_site_command_ids(p_project_id, null);
  end if;

  return query
  select u.id, coalesce(nullif(u.name, ''), u.email),
    array_remove(array[
      case when u.id = any(v_base) then v_mode end,
      case when u.id = any(v_command) then 'site_command' end,
      case when u.id = any(v_admins) and (v_mode = 'admin' or coalesce((v_config ->> 'includeAdmins')::boolean, false)) then 'admin' end,
      case when u.id = any(v_admins) and not (u.id = any(v_base) or u.id = any(v_command))
            and v_mode <> 'admin' and not coalesce((v_config ->> 'includeAdmins')::boolean, false) then 'fallback' end
    ], null)
  from public.users u
  where u.id = any(v_final)
  order by 2;
end;
$$;

revoke all on function app_private.alert_site_command_ids(text, text) from public, anon, authenticated;
revoke all on function app_private.alert_room_code(text) from public, anon, authenticated;
revoke all on function app_private.alert_resolve_recipients(public.notification_alert_rules, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.set_site_command_positions(uuid[]) from public, anon;
grant execute on function public.set_site_command_positions(uuid[]) to authenticated;
revoke all on function public.preview_alert_recipients(text, text, jsonb) from public, anon;
grant execute on function public.preview_alert_recipients(text, text, jsonb) to authenticated;

-- Owner decision 28/09/2026: safety alerts go to the Safety Room and the
-- site command only; Admins receive them just as a fallback.
update public.notification_alert_rules
set recipient_config = recipient_config || '{"includeSiteCommand":true,"includeAdmins":false,"fallbackToAdmin":true}'::jsonb, updated_at = now()
where alert_key = 'safety_critical';
