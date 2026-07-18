alter table public.permission_actions
  add column if not exists grant_readiness text not null default 'declared';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'permission_actions_grant_readiness_check'
      and conrelid = 'public.permission_actions'::regclass
  ) then
    alter table public.permission_actions
      add constraint permission_actions_grant_readiness_check
      check (grant_readiness in ('legacy', 'declared', 'enforced', 'verified'));
  end if;
end;
$$;

update public.permission_actions
set grant_readiness = 'legacy',
    updated_at = now()
where action = 'manage'
  and legacy_admin_only;

update public.permission_actions
set grant_readiness = 'verified',
    updated_at = now()
where permission_code = any(array[
  'project.daily_log.view',
  'project.daily_log.create',
  'project.daily_log.edit_own',
  'project.daily_log.edit_all',
  'project.daily_log.delete_own',
  'project.daily_log.delete_all',
  'project.daily_log.submit',
  'project.daily_log.return',
  'project.daily_log.verify',
  'project.daily_log.approve',
  'project.daily_log.summarize'
]::text[]);

create or replace function app_private.normalize_legacy_permission_state(p_state jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_allowed_modules jsonb;
  v_admin_modules jsonb;
  v_allowed_sub_modules jsonb;
  v_admin_sub_modules jsonb;
  v_module_count integer;
  v_route_count integer;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object'
    or jsonb_typeof(p_state -> 'allowedModules') <> 'array'
    or jsonb_typeof(p_state -> 'adminModules') <> 'array'
    or jsonb_typeof(p_state -> 'allowedSubModules') <> 'object'
    or jsonb_typeof(p_state -> 'adminSubModules') <> 'object'
  then
    raise exception 'Legacy permission state must contain module arrays and submodule objects'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_state -> 'allowedModules') item
    where jsonb_typeof(item) <> 'string'
  ) or exists (
    select 1
    from jsonb_array_elements(p_state -> 'adminModules') item
    where jsonb_typeof(item) <> 'string'
  ) or exists (
    select 1
    from jsonb_each(p_state -> 'allowedSubModules') entry
    where jsonb_typeof(entry.value) <> 'array'
       or exists (
         select 1
         from jsonb_array_elements(entry.value) item
         where jsonb_typeof(item) <> 'string'
       )
  ) or exists (
    select 1
    from jsonb_each(p_state -> 'adminSubModules') entry
    where jsonb_typeof(entry.value) <> 'array'
       or exists (
         select 1
         from jsonb_array_elements(entry.value) item
         where jsonb_typeof(item) <> 'string'
       )
  ) then
    raise exception 'Legacy permission values must be strings'
      using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  into v_allowed_modules
  from (
    select distinct btrim(item #>> '{}') as value
    from jsonb_array_elements(p_state -> 'allowedModules') item
    where btrim(item #>> '{}') <> ''
  ) normalized;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  into v_admin_modules
  from (
    select distinct btrim(item #>> '{}') as value
    from jsonb_array_elements(p_state -> 'adminModules') item
    where btrim(item #>> '{}') <> ''
  ) normalized;

  select coalesce(jsonb_object_agg(module_key, routes order by module_key), '{}'::jsonb)
  into v_allowed_sub_modules
  from (
    select
      btrim(entry.key) as module_key,
      (
        select coalesce(jsonb_agg(route order by route), '[]'::jsonb)
        from (
          select distinct btrim(item #>> '{}') as route
          from jsonb_array_elements(entry.value) item
          where btrim(item #>> '{}') <> ''
        ) normalized_routes
      ) as routes
    from jsonb_each(p_state -> 'allowedSubModules') entry
    where btrim(entry.key) <> ''
  ) normalized;

  select coalesce(jsonb_object_agg(module_key, routes order by module_key), '{}'::jsonb)
  into v_admin_sub_modules
  from (
    select
      btrim(entry.key) as module_key,
      (
        select coalesce(jsonb_agg(route order by route), '[]'::jsonb)
        from (
          select distinct btrim(item #>> '{}') as route
          from jsonb_array_elements(entry.value) item
          where btrim(item #>> '{}') <> ''
        ) normalized_routes
      ) as routes
    from jsonb_each(p_state -> 'adminSubModules') entry
    where btrim(entry.key) <> ''
  ) normalized;

  select count(*)
  into v_module_count
  from (
    select value from jsonb_array_elements_text(v_allowed_modules)
    union
    select value from jsonb_array_elements_text(v_admin_modules)
    union
    select key from jsonb_object_keys(v_allowed_sub_modules) key
    union
    select key from jsonb_object_keys(v_admin_sub_modules) key
  ) modules;

  select count(*)
  into v_route_count
  from (
    select entry.key, route.value
    from jsonb_each(v_allowed_sub_modules) entry
    cross join lateral jsonb_array_elements_text(entry.value) route
    union all
    select entry.key, route.value
    from jsonb_each(v_admin_sub_modules) entry
    cross join lateral jsonb_array_elements_text(entry.value) route
  ) routes;

  if v_module_count > 100 or v_route_count > 1000 then
    raise exception 'Legacy permission state exceeds bounded limits'
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'allowedModules', v_allowed_modules,
    'allowedSubModules', v_allowed_sub_modules,
    'adminModules', v_admin_modules,
    'adminSubModules', v_admin_sub_modules
  );
end;
$$;

create or replace function app_private.direct_permission_state_for_user(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at
      )
      order by grant_row.permission_code, grant_row.scope_type,
        grant_row.scope_id, grant_row.expires_at
    ),
    '[]'::jsonb
  )
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active
    and (grant_row.expires_at is null or grant_row.expires_at > now());
$$;

create or replace function app_private.normalize_direct_permission_state(p_grants jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id,
        'expiresAt', normalized.expires_at
      )
      order by normalized.permission_code, normalized.scope_type,
        normalized.scope_id, normalized.expires_at
    ),
    '[]'::jsonb
  )
  from (
    select
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id,
      grant_row.expires_at
    from jsonb_to_recordset(coalesce(p_grants, '[]'::jsonb)) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
      and (grant_row.expires_at is null or grant_row.expires_at > now())
  ) normalized;
$$;

create or replace function app_private.permission_state_fingerprint_for_values(
  p_legacy_state jsonb,
  p_direct_state jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'legacy', app_private.normalize_legacy_permission_state(p_legacy_state),
    'direct', coalesce(p_direct_state, '[]'::jsonb)
  )::text);
$$;

create or replace function app_private.user_permission_state_fingerprint(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.permission_state_fingerprint_for_values(
    jsonb_build_object(
      'allowedModules', to_jsonb(user_row.allowed_modules),
      'allowedSubModules', user_row.allowed_sub_modules,
      'adminModules', to_jsonb(user_row.admin_modules),
      'adminSubModules', user_row.admin_sub_modules
    ),
    app_private.direct_permission_state_for_user(user_row.id)
  )
  from public.users user_row
  where user_row.id = p_user_id;
$$;

create or replace function app_private.legacy_admin_state_is_subset(
  p_before jsonb,
  p_after jsonb
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements_text(p_after -> 'adminModules') module_key
    where not (p_before -> 'adminModules' @> jsonb_build_array(module_key.value))
  ) and not exists (
    select 1
    from jsonb_each(p_after -> 'adminSubModules') module_entry
    cross join lateral jsonb_array_elements_text(module_entry.value) route
    where not (
      p_before -> 'adminModules' @> jsonb_build_array(module_entry.key)
      or coalesce(p_before -> 'adminSubModules' -> module_entry.key, '[]'::jsonb)
        @> jsonb_build_array(route.value)
    )
  );
$$;

create or replace function app_private.assert_unified_direct_grant_readiness(
  p_user_id uuid,
  p_grants jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_grants, '[]'::jsonb)) proposed(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    join public.permission_actions action_row
      on action_row.permission_code = proposed.permission_code
     and action_row.is_active
    where coalesce(proposed.is_active, true)
      and action_row.grant_readiness not in ('enforced', 'verified')
      and not exists (
        select 1
        from public.user_permission_grants existing
        where existing.user_id = p_user_id
          and existing.permission_code = proposed.permission_code
          and existing.scope_type = coalesce(nullif(proposed.scope_type, ''), 'global')
          and existing.scope_id = coalesce(nullif(proposed.scope_id, ''), '*')
          and existing.expires_at is not distinct from proposed.expires_at
          and existing.is_active
          and (existing.expires_at is null or existing.expires_at > now())
      )
  ) then
    raise exception 'Direct permission action is not enforced or verified'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function app_private.preview_user_permission_change_impl(
  p_user_id uuid,
  p_legacy_state jsonb,
  p_grants jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_legacy_before jsonb;
  v_legacy_after jsonb;
  v_direct_before jsonb;
  v_direct_after jsonb;
  v_decision jsonb;
  v_before_fingerprint text;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  select *
  into v_target
  from public.users
  where id = p_user_id;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
    or v_target.role = 'ADMIN'::public.user_role
  then
    raise exception 'Active non-Admin target user required'
      using errcode = '23514';
  end if;

  v_legacy_before := app_private.normalize_legacy_permission_state(
    jsonb_build_object(
      'allowedModules', to_jsonb(v_target.allowed_modules),
      'allowedSubModules', v_target.allowed_sub_modules,
      'adminModules', to_jsonb(v_target.admin_modules),
      'adminSubModules', v_target.admin_sub_modules
    )
  );
  v_legacy_after := case
    when p_legacy_state is null then v_legacy_before
    else app_private.normalize_legacy_permission_state(p_legacy_state)
  end;

  if not app_private.legacy_admin_state_is_subset(v_legacy_before, v_legacy_after) then
    raise exception 'Unified editor cannot add Legacy administration umbrellas'
      using errcode = '42501';
  end if;

  if v_actor_user_id = p_user_id
    and v_legacy_before is distinct from v_legacy_after
  then
    raise exception 'Self-directed Legacy permission change is not allowed'
      using errcode = '42501';
  end if;

  v_decision := app_private.evaluate_direct_grant_replacement_impl(
    v_actor_user_id,
    p_user_id,
    p_grants
  );
  perform app_private.assert_unified_direct_grant_readiness(p_user_id, p_grants);

  v_direct_before := app_private.direct_permission_state_for_user(p_user_id);
  v_direct_after := app_private.normalize_direct_permission_state(p_grants);
  v_before_fingerprint := app_private.permission_state_fingerprint_for_values(
    v_legacy_before,
    v_direct_before
  );

  return jsonb_build_object(
    'beforeFingerprint', v_before_fingerprint,
    'decision', v_decision,
    'legacyBefore', v_legacy_before,
    'legacyAfter', v_legacy_after,
    'directBefore', v_direct_before,
    'directAfter', v_direct_after
  );
end;
$$;

create or replace function public.preview_user_permission_change(
  p_user_id uuid,
  p_legacy_state jsonb,
  p_grants jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preview_user_permission_change_impl(
    p_user_id,
    p_legacy_state,
    p_grants
  );
$$;

create or replace function app_private.prevent_users_privilege_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid;
begin
  if session_user = 'supabase_auth_admin' then
    return new;
  end if;

  if auth.role() = 'service_role'
    and coalesce(current_setting('app.account_lifecycle_command', true), '') = 'on'
  then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  current_user_id := public.current_app_user_id();

  if coalesce(current_setting('app.authorization_permission_command', true), '') = 'on'
    and current_user_id is not null
    and app_private.has_permission(
      current_user_id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  then
    return new;
  end if;

  if current_user_id is null
    or old.id is distinct from current_user_id
    or new.id is distinct from current_user_id
  then
    raise exception 'Only admins can update other user rows'
      using errcode = '42501';
  end if;

  if old.role is distinct from new.role
    or old.auth_id is distinct from new.auth_id
    or old.email is distinct from new.email
    or old.username is distinct from new.username
    or old.assigned_warehouse_id is distinct from new.assigned_warehouse_id
    or old.allowed_modules is distinct from new.allowed_modules
    or old.admin_modules is distinct from new.admin_modules
    or old.allowed_sub_modules is distinct from new.allowed_sub_modules
    or old.admin_sub_modules is distinct from new.admin_sub_modules
    or old.is_active is distinct from new.is_active
  then
    raise exception 'Self profile updates cannot change protected permission fields'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function app_private.apply_user_permission_change_impl(
  p_user_id uuid,
  p_expected_fingerprint text,
  p_legacy_state jsonb,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_preview jsonb;
  v_before_fingerprint text;
  v_after_fingerprint text;
  v_legacy_before jsonb;
  v_legacy_after jsonb;
  v_direct_before jsonb;
  v_direct_after jsonb;
  v_decision jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_previous_command_context text;
  v_changed boolean;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  select *
  into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
    or v_target.role = 'ADMIN'::public.user_role
  then
    raise exception 'Active non-Admin target user required'
      using errcode = '23514';
  end if;

  v_before_fingerprint := app_private.user_permission_state_fingerprint(p_user_id);
  if p_expected_fingerprint is null
    or p_expected_fingerprint is distinct from v_before_fingerprint
  then
    raise exception 'Permission state changed after Preview'
      using errcode = '40001';
  end if;

  v_preview := app_private.preview_user_permission_change_impl(
    p_user_id,
    p_legacy_state,
    p_grants
  );
  v_legacy_before := v_preview -> 'legacyBefore';
  v_legacy_after := v_preview -> 'legacyAfter';
  v_direct_before := v_preview -> 'directBefore';
  v_direct_after := v_preview -> 'directAfter';
  v_decision := v_preview -> 'decision';
  v_changed := v_legacy_before is distinct from v_legacy_after
    or v_direct_before is distinct from v_direct_after;

  if v_changed and char_length(v_reason) < 10 then
    raise exception 'Unified permission change reason required'
      using errcode = '22023';
  end if;

  if v_changed and app_private.permission_hardening_flag('legacy_projection_enabled') then
    raise exception 'Legacy projection must be disabled before unified permission Save'
      using errcode = '55000';
  end if;

  if v_changed then
    perform app_private.replace_user_permission_grants_v2_impl(
      p_user_id,
      p_grants,
      v_reason,
      p_warning_acceptances
    );

    if v_legacy_before is distinct from v_legacy_after then
      v_previous_command_context := current_setting(
        'app.authorization_permission_command',
        true
      );
      perform set_config('app.authorization_permission_command', 'on', true);

      update public.users
      set allowed_modules = array(
            select value
            from jsonb_array_elements_text(v_legacy_after -> 'allowedModules') value
          ),
          allowed_sub_modules = v_legacy_after -> 'allowedSubModules',
          admin_modules = array(
            select value
            from jsonb_array_elements_text(v_legacy_after -> 'adminModules') value
          ),
          admin_sub_modules = v_legacy_after -> 'adminSubModules',
          updated_at = now()
      where id = p_user_id;

      perform set_config(
        'app.authorization_permission_command',
        coalesce(v_previous_command_context, ''),
        true
      );

      insert into public.permission_audit_events (
        actor_user_id,
        target_user_id,
        event_type,
        before_grants,
        after_grants,
        metadata
      ) values (
        v_actor_user_id,
        p_user_id,
        'unified_legacy_permissions_changed',
        v_legacy_before,
        v_legacy_after,
        jsonb_build_object(
          'reason', v_reason,
          'decision', v_decision
        )
      );
    end if;
  end if;

  v_after_fingerprint := app_private.permission_state_fingerprint_for_values(
    v_legacy_after,
    v_direct_after
  );

  return jsonb_build_object(
    'beforeFingerprint', v_before_fingerprint,
    'afterFingerprint', v_after_fingerprint,
    'decision', v_decision,
    'legacyBefore', v_legacy_before,
    'legacyAfter', v_legacy_after,
    'directAfter', v_direct_after
  );
end;
$$;

create or replace function public.apply_user_permission_change(
  p_user_id uuid,
  p_expected_fingerprint text,
  p_legacy_state jsonb,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.apply_user_permission_change_impl(
    p_user_id,
    p_expected_fingerprint,
    p_legacy_state,
    p_grants,
    p_reason,
    p_warning_acceptances
  );
$$;

revoke all on function app_private.normalize_legacy_permission_state(jsonb)
  from public, anon, authenticated;
revoke all on function app_private.direct_permission_state_for_user(uuid)
  from public, anon, authenticated;
revoke all on function app_private.normalize_direct_permission_state(jsonb)
  from public, anon, authenticated;
revoke all on function app_private.permission_state_fingerprint_for_values(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function app_private.user_permission_state_fingerprint(uuid)
  from public, anon, authenticated;
revoke all on function app_private.legacy_admin_state_is_subset(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function app_private.assert_unified_direct_grant_readiness(uuid,jsonb)
  from public, anon, authenticated;
revoke all on function app_private.prevent_users_privilege_self_update()
  from public, anon, authenticated;

revoke all on function app_private.preview_user_permission_change_impl(uuid,jsonb,jsonb)
  from public, anon;
grant execute on function app_private.preview_user_permission_change_impl(uuid,jsonb,jsonb)
  to authenticated;
revoke all on function public.preview_user_permission_change(uuid,jsonb,jsonb)
  from public, anon;
grant execute on function public.preview_user_permission_change(uuid,jsonb,jsonb)
  to authenticated;

revoke all on function app_private.apply_user_permission_change_impl(
  uuid,text,jsonb,jsonb,text,jsonb
) from public, anon;
grant execute on function app_private.apply_user_permission_change_impl(
  uuid,text,jsonb,jsonb,text,jsonb
) to authenticated;
revoke all on function public.apply_user_permission_change(
  uuid,text,jsonb,jsonb,text,jsonb
) from public, anon;
grant execute on function public.apply_user_permission_change(
  uuid,text,jsonb,jsonb,text,jsonb
) to authenticated;
