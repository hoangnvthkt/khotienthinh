-- Rollback for 20261004120000_authorization_p3_own_scope_no_expiry.
-- Restores the previous functions and re-adds the 365-day default to the own-scope items.
CREATE OR REPLACE FUNCTION app_private.evaluate_direct_grant_replacement_impl(p_actor_user_id uuid, p_target_user_id uuid, p_grants jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    if v_action.direct_grant_requires_expiry
      and v_grant.expires_at is null
      -- A grant that is already active without an expiry (for example one converted
      -- from a role) may be kept unchanged. Any new grant, or a change of scope,
      -- still needs an expiry.
      and not exists (
        select 1
        from public.user_permission_grants existing
        where existing.user_id = p_target_user_id
          and existing.permission_code = v_grant.permission_code
          and existing.scope_type = v_grant.scope_type
          and existing.scope_id = v_grant.scope_id
          and existing.is_active
          and existing.revoked_at is null
          and existing.expires_at is null
      )
    then
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
$function$;

CREATE OR REPLACE FUNCTION app_private.normalize_user_permission_template_items(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_item record;
  v_action public.permission_actions%rowtype;
  v_result jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_days integer;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'PERMISSION_TEMPLATE_INVALID' using errcode = '22023';
  end if;
  for v_item in
    select x."permissionCode" code, coalesce(nullif(x."scopeType", ''), 'global') scope, x."expiresInDays" days
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) x("permissionCode" text, "scopeType" text, "expiresInDays" integer)
  loop
    select a.* into v_action from public.permission_actions a
    where a.permission_code = v_item.code and a.is_active;
    if v_action.id is null then
      raise exception 'PERMISSION_TEMPLATE_UNKNOWN: %', v_item.code using errcode = '22023';
    end if;
    if not v_action.direct_grant_allowed or v_item.code = 'system.settings.manage' then
      raise exception 'PERMISSION_TEMPLATE_NOT_DIRECT: %', v_item.code using errcode = '22023';
    end if;
    if v_item.scope <> all(array['global', 'own', 'assigned']) or v_item.scope <> all(v_action.scope_modes) then
      raise exception 'PERMISSION_TEMPLATE_SCOPE: %@%', v_item.code, v_item.scope using errcode = '22023';
    end if;
    continue when (v_item.code || '@' || v_item.scope) = any(v_seen);
    v_seen := v_seen || (v_item.code || '@' || v_item.scope);
    v_days := case when v_action.direct_grant_requires_expiry
      then least(greatest(coalesce(v_item.days, 365), 1), 730) end;
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'permissionCode', v_item.code, 'scopeType', v_item.scope, 'expiresInDays', v_days)));
  end loop;
  return coalesce((
    select jsonb_agg(e order by e->>'permissionCode', e->>'scopeType')
    from jsonb_array_elements(v_result) e), '[]'::jsonb);
end;
$function$;

update public.user_permission_templates t
set items = app_private.normalize_user_permission_template_items(t.items)
where t.items is distinct from app_private.normalize_user_permission_template_items(t.items);
delete from supabase_migrations.schema_migrations where version = '20261004120000';
