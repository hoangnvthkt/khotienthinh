-- Authorization V2 / Phase 6
-- Stop every runtime write to the four legacy permission columns. The columns
-- and Phase 5 snapshots remain available during the observation window.

do $$
begin
  if not app_private.permission_hardening_flag('legacy_fallback_disabled')
    or not app_private.permission_hardening_flag('legacy_governance_fallback_disabled')
    or app_private.permission_hardening_flag('legacy_projection_enabled')
  then
    raise exception 'Phase 6 requires the completed canonical-only Phase 5 gate';
  end if;

  if exists (
    select 1 from app_private.authorization_legacy_migration_dispositions
    where cutover_id = '6aa37d8c-1d58-4eb4-a5a9-709100333020'
      and disposition = 'manual_review'
  ) then
    raise exception 'Phase 6 cannot start with manual-review dispositions';
  end if;
end $$;

create or replace function app_private.guard_and_audit_legacy_permission_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed_columns text[];
  v_reason text := nullif(btrim(coalesce(
    current_setting('app.authorization_legacy_write_reason', true), ''
  )), '');
  v_lifecycle_clear boolean := false;
begin
  if tg_op = 'INSERT' then
    v_changed_columns := array_remove(array[
      case when new.allowed_modules is not null then 'allowed_modules' end,
      case when new.allowed_sub_modules is not null then 'allowed_sub_modules' end,
      case when new.admin_modules is not null then 'admin_modules' end,
      case when new.admin_sub_modules is not null then 'admin_sub_modules' end
    ], null);
  else
    v_changed_columns := array_remove(array[
      case when old.allowed_modules is distinct from new.allowed_modules then 'allowed_modules' end,
      case when old.allowed_sub_modules is distinct from new.allowed_sub_modules then 'allowed_sub_modules' end,
      case when old.admin_modules is distinct from new.admin_modules then 'admin_modules' end,
      case when old.admin_sub_modules is distinct from new.admin_sub_modules then 'admin_sub_modules' end
    ], null);
  end if;

  if cardinality(v_changed_columns) = 0 then return new; end if;

  if coalesce(current_setting('app.authorization_legacy_migration', true), '') = 'on' then
    return new;
  end if;

  if app_private.permission_hardening_flag('legacy_permission_writes_disabled') then
    v_lifecycle_clear := tg_op = 'UPDATE'
      and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
      and cardinality(coalesce(new.allowed_modules, '{}'::text[])) = 0
      and cardinality(coalesce(new.admin_modules, '{}'::text[])) = 0
      and coalesce(new.allowed_sub_modules, '{}'::jsonb) = '{}'::jsonb
      and coalesce(new.admin_sub_modules, '{}'::jsonb) = '{}'::jsonb;

    if not v_lifecycle_clear then
      if coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on' then
        raise exception 'Account lifecycle may only clear legacy permission columns'
          using errcode = '42501';
      end if;
      raise exception 'Legacy permission writes are disabled'
        using errcode = '42501';
    end if;

    insert into app_private.authorization_legacy_write_audit (
      actor_user_id, target_user_id, changed_columns, reason
    ) values (
      public.current_app_user_id(), new.id, v_changed_columns,
      coalesce(v_reason, 'account_lifecycle_clear_after_legacy_shutdown')
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    insert into app_private.authorization_legacy_write_audit (
      actor_user_id, target_user_id, changed_columns, reason
    ) values (
      public.current_app_user_id(), new.id, v_changed_columns,
      coalesce(v_reason, 'legacy_permission_write')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_users_guard_legacy_permission_writes on public.users;
create trigger trg_users_guard_legacy_permission_writes
before insert or update of allowed_modules, allowed_sub_modules, admin_modules, admin_sub_modules on public.users
for each row execute function app_private.guard_and_audit_legacy_permission_write();

revoke all on function app_private.guard_and_audit_legacy_permission_write() from public, anon, authenticated;

create or replace function public.list_canonical_module_manager_ids(p_module_keys text[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_result uuid[];
begin
  if v_actor_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct user_row.id order by user_row.id), '{}'::uuid[])
    into v_result
  from public.users user_row
  cross join lateral app_private.resolve_effective_permission_sources(
    user_row.id, null, null, null, now()
  ) source_row
  join public.permission_actions action_row
    on action_row.permission_code = source_row.permission_code
   and action_row.is_active
   and action_row.action = 'manage'
  join public.permission_modules module_row
    on module_row.code = action_row.module_code and module_row.is_active
  where user_row.is_active and user_row.account_status = 'ACTIVE'
    and source_row.source_type in ('DIRECT', 'ROLE')
    and coalesce(action_row.legacy_module_key, module_row.legacy_module_key) = any(coalesce(p_module_keys, '{}'::text[]));

  return v_result;
end;
$$;

revoke all on function public.list_canonical_module_manager_ids(text[]) from public, anon;
grant execute on function public.list_canonical_module_manager_ids(text[]) to authenticated, service_role;

create or replace function public.service_authorization_user_has_permission(
  p_user_id uuid,
  p_permission_code text,
  p_scope_type text default 'global',
  p_scope_id text default '*'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.resolve_effective_permission_sources(
      p_user_id, p_permission_code, p_scope_type, p_scope_id, now()
    ) source_row
    where source_row.source_type in ('DIRECT', 'ROLE')
  );
$$;

revoke all on function public.service_authorization_user_has_permission(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.service_authorization_user_has_permission(uuid, text, text, text)
  to service_role;

create or replace function public.get_authorization_phase6_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.assert_project_permission_room_admin();
  return jsonb_build_object(
    'legacyWritesDisabled', app_private.permission_hardening_flag('legacy_permission_writes_disabled'),
    'legacyFallbackDisabled', app_private.permission_hardening_flag('legacy_fallback_disabled'),
    'legacyGovernanceFallbackDisabled', app_private.permission_hardening_flag('legacy_governance_fallback_disabled'),
    'legacyProjectionEnabled', app_private.permission_hardening_flag('legacy_projection_enabled'),
    'legacyWriteAuditEvents', (select count(*) from app_private.authorization_legacy_write_audit),
    'generatedAt', now()
  );
end;
$$;

revoke all on function public.get_authorization_phase6_summary() from public, anon;
grant execute on function public.get_authorization_phase6_summary() to authenticated, service_role;

revoke execute on function public.apply_user_permission_change(uuid, text, jsonb, jsonb, text, jsonb)
  from authenticated, service_role;
revoke execute on function public.preview_user_permission_change(uuid, jsonb, jsonb)
  from authenticated, service_role;

insert into app_private.permission_hardening_settings (key, value, updated_at)
values ('legacy_permission_writes_disabled', 'true'::jsonb, now())
on conflict (key) do update set value = excluded.value, updated_at = now();

do $$
begin
  if not app_private.permission_hardening_flag('legacy_permission_writes_disabled') then
    raise exception 'Phase 6 legacy write guard did not activate';
  end if;
end $$;
