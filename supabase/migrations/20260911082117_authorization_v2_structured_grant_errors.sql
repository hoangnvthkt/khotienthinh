-- Task 12.4: structured, catalog-backed validation for direct grants.

create or replace function app_private.evaluate_direct_grant_replacement_impl(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_grants jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_grants jsonb := coalesce(p_grants, '[]'::jsonb);
  v_proposed jsonb := '[]'::jsonb;
  v_grant record;
  v_action public.permission_actions%rowtype;
begin
  if p_actor_user_id is null
    or p_actor_user_id is distinct from public.current_app_user_id()
    or not app_private.has_permission(
      p_actor_user_id,
      'system.authorization.manage_grants',
      'global',
      '*'
    )
  then
    raise exception 'Authorization administration permission required'
      using errcode = '42501';
  end if;

  if jsonb_typeof(v_grants) <> 'array' then
    raise exception 'Permission grants payload must be an array'
      using errcode = '22023',
        detail = jsonb_build_object(
          'code', 'invalid_payload',
          'field', 'grants',
          'message', 'Danh sách quyền không đúng định dạng.'
        )::text;
  end if;

  if not exists (
    select 1
    from public.users target_row
    where target_row.id = p_target_user_id
      and target_row.is_active
      and target_row.account_status = 'ACTIVE'
  ) then
    raise exception 'Active target user required'
      using errcode = '23514';
  end if;

  select duplicate_row.*
  into v_grant
  from (
    select
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
    group by 1, 2, 3
    having count(*) > 1
    limit 1
  ) duplicate_row;

  if found then
    raise exception 'Duplicate direct permission grant key'
      using errcode = '23505',
        detail = jsonb_build_object(
          'code', 'duplicate_grant',
          'permissionCode', v_grant.permission_code,
          'field', 'permissionCode',
          'message', 'Quyền bị trùng cùng phạm vi.'
        )::text;
  end if;

  for v_grant in
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
  loop
    select action_row.*
    into v_action
    from public.permission_actions action_row
    where action_row.permission_code = v_grant.permission_code
      and action_row.is_active;

    if v_action.id is null then
      raise exception 'Unknown direct permission grant'
        using errcode = '23514',
          detail = jsonb_build_object(
            'code', 'unknown_permission',
            'permissionCode', v_grant.permission_code,
            'field', 'permissionCode',
            'message', 'Quyền không còn trong danh mục hiện hành.'
          )::text;
    end if;

    if not v_action.direct_grant_allowed
      or v_grant.permission_code = 'system.settings.manage'
    then
      raise exception 'Direct permission grant is not allowed'
        using errcode = '42501',
          detail = jsonb_build_object(
            'code', 'direct_grant_denied',
            'permissionCode', v_grant.permission_code,
            'field', 'permissionCode',
            'message', 'Quyền này chỉ được cấp qua template nghiệp vụ.'
          )::text;
    end if;

    if v_grant.scope_type <> all(v_action.scope_modes) then
      raise exception 'Unsupported direct permission scope'
        using errcode = '23514',
          detail = jsonb_build_object(
            'code', 'scope_denied',
            'permissionCode', v_grant.permission_code,
            'field', 'scopeType',
            'message', 'Quyền không hỗ trợ phạm vi đã chọn.'
          )::text;
    end if;

    if (
      v_grant.scope_type = any(array['global', 'own', 'assigned']::text[])
      and v_grant.scope_id <> '*'
    ) or (
      v_grant.scope_type = any(array[
        'project', 'construction_site', 'warehouse', 'department',
        'direct_reports', 'org_unit', 'work_workspace'
      ]::text[])
      and (btrim(v_grant.scope_id) = '' or v_grant.scope_id = '*')
    ) then
      raise exception 'Invalid direct permission scope identifier'
        using errcode = '23514',
          detail = jsonb_build_object(
            'code', 'scope_required',
            'permissionCode', v_grant.permission_code,
            'field', 'scopeId',
            'message', 'Quyền cần một phạm vi cụ thể.'
          )::text;
    end if;

    if v_grant.expires_at is not null and v_grant.expires_at <= now() then
      raise exception 'Direct permission grant expiry must be in the future'
        using errcode = '23514',
          detail = jsonb_build_object(
            'code', 'expiry_invalid',
            'permissionCode', v_grant.permission_code,
            'field', 'expiresAt',
            'message', 'Ngày hết hạn phải ở tương lai.'
          )::text;
    end if;

    if v_action.direct_grant_requires_expiry and v_grant.expires_at is null then
      raise exception 'Direct permission grant expiry required'
        using errcode = '23514',
          detail = jsonb_build_object(
            'code', 'expiry_required',
            'permissionCode', v_grant.permission_code,
            'field', 'expiresAt',
            'message', 'Quyền này cần ngày hết hạn trong tương lai.'
          )::text;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    join public.permission_actions action_row
      on action_row.permission_code = grant_row.permission_code
     and action_row.is_active
    where p_target_user_id = p_actor_user_id
      and coalesce(grant_row.is_active, true)
      and action_row.risk_level = 'sensitive'
      and not exists (
        select 1
        from public.user_permission_grants existing
        where existing.user_id = p_target_user_id
          and existing.permission_code = grant_row.permission_code
          and existing.scope_type = coalesce(nullif(grant_row.scope_type, ''), 'global')
          and existing.scope_id = coalesce(nullif(grant_row.scope_id, ''), '*')
          and existing.is_active
          and existing.expires_at is not distinct from grant_row.expires_at
      )
  ) then
    raise exception 'Sensitive self-grant is not allowed'
      using errcode = '42501',
        detail = jsonb_build_object(
          'code', 'sensitive_self_grant_denied',
          'field', 'permissionCode',
          'message', 'Không thể tự cấp thêm quyền nhạy cảm.'
        )::text;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'permissionCode', normalized.permission_code,
        'scopeType', normalized.scope_type,
        'scopeId', normalized.scope_id
      ) order by normalized.permission_code, normalized.scope_type, normalized.scope_id
    ),
    '[]'::jsonb
  )
  into v_proposed
  from (
    select distinct
      grant_row.permission_code,
      coalesce(nullif(grant_row.scope_type, ''), 'global') as scope_type,
      coalesce(nullif(grant_row.scope_id, ''), '*') as scope_id
    from jsonb_to_recordset(v_grants) grant_row(
      permission_code text,
      scope_type text,
      scope_id text,
      is_active boolean,
      expires_at timestamptz
    )
    where coalesce(grant_row.is_active, true)
  ) normalized;

  return app_private.evaluate_authorization_change_set(
    p_actor_user_id,
    p_target_user_id,
    v_proposed,
    'REPLACE_DIRECT'
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
language plpgsql
set search_path to ''
as $$
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Authorization change reason must contain at least 10 characters'
      using errcode = '23514',
        detail = jsonb_build_object(
          'code', 'reason_too_short',
          'field', 'reason',
          'message', 'Lý do thay đổi phải có ít nhất 10 ký tự.'
        )::text;
  end if;

  return app_private.update_user_authorization_v2_impl(
    p_user_id,
    p_profile,
    p_grants,
    p_reason,
    p_expected_updated_at
  );
end;
$$;

revoke all on function public.update_user_authorization_v2(
  uuid, jsonb, jsonb, text, timestamp with time zone
) from public;
revoke all on function public.update_user_authorization_v2(
  uuid, jsonb, jsonb, text, timestamp with time zone
) from anon;
grant execute on function public.update_user_authorization_v2(
  uuid, jsonb, jsonb, text, timestamp with time zone
) to authenticated;
