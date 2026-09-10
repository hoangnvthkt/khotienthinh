create or replace function app_private.update_user_authorization_v2_impl(
  p_user_id uuid,
  p_profile jsonb,
  p_grants jsonb,
  p_reason text,
  p_expected_updated_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_unsupported_fields text[];
  v_profile_before jsonb;
  v_profile_after jsonb;
  v_grants_before jsonb := '[]'::jsonb;
  v_grants_after jsonb := '[]'::jsonb;
  v_updated_at timestamp with time zone;
  v_active_grant_count integer;
  v_audit_event_id uuid;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  if p_user_id is null then
    raise exception 'Target user required'
      using errcode = '22023';
  end if;

  if jsonb_typeof(v_profile) <> 'object' then
    raise exception 'User profile payload must be an object'
      using errcode = '22023';
  end if;

  select array_agg(profile_key order by profile_key)
  into v_unsupported_fields
  from jsonb_object_keys(v_profile) profile_key
  where profile_key <> all (array[
    'name',
    'phone',
    'avatar',
    'manager_id',
    'assigned_warehouse_id'
  ]::text[]);

  if coalesce(cardinality(v_unsupported_fields), 0) > 0 then
    raise exception 'Unsupported user profile fields: %', array_to_string(v_unsupported_fields, ', ')
      using errcode = '22023';
  end if;

  if v_reason = '' then
    raise exception 'Authorization change reason required'
      using errcode = '22023';
  end if;

  if p_expected_updated_at is null then
    raise exception 'Expected user updated_at required'
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

  if v_target.updated_at is distinct from p_expected_updated_at then
    raise exception 'User authorization changed after it was loaded'
      using errcode = '40001';
  end if;

  if v_profile ? 'name' and btrim(coalesce(v_profile ->> 'name', '')) = '' then
    raise exception 'User name cannot be blank'
      using errcode = '22023';
  end if;

  v_profile_before := jsonb_build_object(
    'name', v_target.name,
    'phone', v_target.phone,
    'avatar', v_target.avatar,
    'manager_id', v_target.manager_id,
    'assigned_warehouse_id', v_target.assigned_warehouse_id
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', grant_row.permission_code,
        'scopeType', grant_row.scope_type,
        'scopeId', grant_row.scope_id,
        'expiresAt', grant_row.expires_at
      ) order by grant_row.permission_code, grant_row.scope_type, grant_row.scope_id
    ),
    '[]'::jsonb
  )
  into v_grants_before
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;

  update public.users
  set name = case when v_profile ? 'name' then v_profile ->> 'name' else name end,
      phone = case when v_profile ? 'phone' then v_profile ->> 'phone' else phone end,
      avatar = case when v_profile ? 'avatar' then v_profile ->> 'avatar' else avatar end,
      manager_id = case
        when v_profile ? 'manager_id' then nullif(v_profile ->> 'manager_id', '')::uuid
        else manager_id
      end,
      assigned_warehouse_id = case
        when v_profile ? 'assigned_warehouse_id' then v_profile ->> 'assigned_warehouse_id'
        else assigned_warehouse_id
      end,
      updated_at = now()
  where id = p_user_id
  returning updated_at into v_updated_at;

  v_grants_after := app_private.replace_user_permission_grants_v2_impl(
    p_user_id,
    p_grants,
    v_reason,
    '[]'::jsonb
  );

  select jsonb_build_object(
    'name', target.name,
    'phone', target.phone,
    'avatar', target.avatar,
    'manager_id', target.manager_id,
    'assigned_warehouse_id', target.assigned_warehouse_id
  ), target.updated_at
  into v_profile_after, v_updated_at
  from public.users target
  where target.id = p_user_id;

  select count(*)::integer
  into v_active_grant_count
  from public.user_permission_grants grant_row
  where grant_row.user_id = p_user_id
    and grant_row.is_active;

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
    'user_authorization_v2_updated',
    jsonb_build_object('profile', v_profile_before, 'grants', v_grants_before),
    jsonb_build_object('profile', v_profile_after, 'grants', v_grants_after),
    jsonb_build_object('reason', v_reason)
  )
  returning id into v_audit_event_id;

  return jsonb_build_object(
    'userId', p_user_id,
    'updatedAt', v_updated_at,
    'activeGrantCount', v_active_grant_count,
    'auditEventId', v_audit_event_id
  );
end;
$$;

create or replace function public.update_user_authorization_v2(
  p_user_id uuid,
  p_profile jsonb,
  p_grants jsonb,
  p_reason text,
  p_expected_updated_at timestamp with time zone
)
returns jsonb
language sql
set search_path to ''
as $$
  select app_private.update_user_authorization_v2_impl(
    p_user_id,
    p_profile,
    p_grants,
    p_reason,
    p_expected_updated_at
  );
$$;

revoke all on function app_private.update_user_authorization_v2_impl(
  uuid, jsonb, jsonb, text, timestamp with time zone
) from public;
revoke all on function app_private.update_user_authorization_v2_impl(
  uuid, jsonb, jsonb, text, timestamp with time zone
) from anon;
grant execute on function app_private.update_user_authorization_v2_impl(
  uuid, jsonb, jsonb, text, timestamp with time zone
) to authenticated;

revoke all on function public.update_user_authorization_v2(
  uuid, jsonb, jsonb, text, timestamp with time zone
) from public;
revoke all on function public.update_user_authorization_v2(
  uuid, jsonb, jsonb, text, timestamp with time zone
) from anon;
grant execute on function public.update_user_authorization_v2(
  uuid, jsonb, jsonb, text, timestamp with time zone
) to authenticated;
