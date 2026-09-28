-- Rollback for notification_site_command_recipients: restores the P2.2
-- group-2 resolver (no site command), removes the BCH definition and the
-- preview RPCs, and takes the flag off the safety rule. Roll the Settings
-- screen back too; it calls these RPCs.
begin;
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
revoke all on function app_private.alert_resolve_recipients(public.notification_alert_rules, text, text, text, uuid) from public, anon, authenticated;
drop function if exists public.preview_alert_recipients(text, text, jsonb);
drop function if exists public.set_site_command_positions(uuid[]);
drop function if exists app_private.alert_room_code(text);
drop function if exists app_private.alert_site_command_ids(text, text);
drop table if exists public.notification_site_command_positions;
update public.notification_alert_rules
set recipient_config = recipient_config - 'includeSiteCommand', updated_at = now()
where recipient_config ? 'includeSiteCommand';
commit;
