-- Checkpoint B: complete direct-grant history snapshots include expired active rows.

create or replace function app_private.replace_user_permission_grants_v2_impl(
  p_user_id uuid,
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
  v_grants jsonb := coalesce(p_grants, '[]'::jsonb);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_decision jsonb;
  v_command_id uuid := gen_random_uuid();
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  if jsonb_typeof(v_grants) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023';
  end if;

  select *
  into v_target
  from public.users
  where id = p_user_id
  for update;

  if v_target.id is null
    or not v_target.is_active
    or v_target.account_status <> 'ACTIVE'
  then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  v_decision := app_private.evaluate_direct_grant_replacement_impl(
    v_actor_user_id,
    p_user_id,
    v_grants
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at
      )
      order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id
    ),
    '[]'::jsonb
  )
  into v_before
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id,
        'expiresAt', normalized.expires_at
      )
      order by normalized.permission_code, normalized.scope_type, normalized.scope_id
    ),
    '[]'::jsonb
  )
  into v_after
  from (
    select
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id,
      grant_row.expires_at
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
  ) normalized;

  if v_before is not distinct from v_after then
    return v_after;
  end if;

  if char_length(v_reason) < 10 then
    raise exception 'Direct permission grant change reason required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      is_active boolean
    )
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where coalesce(grant_row.is_active, true)
      and action_row.risk_level in ('important', 'sensitive')
      and char_length(v_reason) < 10
  ) then
    raise exception 'Important direct permission grant requires a reason'
      using errcode = '23514';
  end if;

  perform app_private.assert_and_record_sod_warnings(
    v_decision,
    p_warning_acceptances,
    'REPLACE_DIRECT_GRANTS',
    v_command_id,
    v_actor_user_id,
    p_user_id
  );

  update public.user_permission_grants existing
  set is_active = false,
      revoked_at = coalesce(existing.revoked_at, now()),
      revoked_by = coalesce(existing.revoked_by, v_actor_user_id),
      revoked_reason = coalesce(existing.revoked_reason, v_reason),
      updated_at = now()
  where existing.user_id = p_user_id
    and existing.is_active
    and not exists (
      select 1
      from jsonb_to_recordset(v_grants) desired(
        permission_code text,
        scope_type text,
        scope_id text,
        is_active boolean,
        expires_at timestamptz
      )
      where coalesce(desired.is_active, true)
        and desired.permission_code = existing.permission_code
        and coalesce(nullif(desired.scope_type, ''), 'global') = existing.scope_type
        and coalesce(nullif(desired.scope_id, ''), '*') = existing.scope_id
    );

  insert into public.user_permission_grants (
    user_id,
    permission_code,
    scope_type,
    scope_id,
    is_active,
    granted_by,
    granted_at,
    expires_at,
    grant_reason,
    revoked_at,
    revoked_by,
    revoked_reason
  )
  select
    p_user_id,
    desired.permission_code,
    coalesce(nullif(desired.scope_type, ''), 'global'),
    coalesce(nullif(desired.scope_id, ''), '*'),
    true,
    v_actor_user_id,
    now(),
    desired.expires_at,
    nullif(v_reason, ''),
    null,
    null,
    null
  from jsonb_to_recordset(v_grants) desired(
    permission_code text,
    scope_type text,
    scope_id text,
    is_active boolean,
    expires_at timestamptz
  )
  where coalesce(desired.is_active, true)
  on conflict (user_id, permission_code, scope_type, scope_id) do update
  set is_active = true,
      granted_by = excluded.granted_by,
      granted_at = excluded.granted_at,
      expires_at = excluded.expires_at,
      grant_reason = excluded.grant_reason,
      revoked_at = null,
      revoked_by = null,
      revoked_reason = null,
      updated_at = now();

  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  values (
    v_actor_user_id,
    p_user_id,
    'direct_permission_grants_changed',
    v_before,
    v_after,
    jsonb_build_object(
      'commandId', v_command_id,
      'reason', v_reason,
      'decision', v_decision
    )
  );

  if app_private.permission_hardening_flag('legacy_projection_enabled') then
    perform app_private.sync_legacy_permission_projection(p_user_id);
  end if;

  return v_after;
end;
$$;

revoke all on function app_private.replace_user_permission_grants_v2_impl(
  uuid,jsonb,text,jsonb
) from public, anon;
grant execute on function app_private.replace_user_permission_grants_v2_impl(
  uuid,jsonb,text,jsonb
) to authenticated;
