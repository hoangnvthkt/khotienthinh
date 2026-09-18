-- E30: the V2 role-template command boundary must enforce technical readiness,
-- not rely on the wizard hiding declared/legacy actions.

create or replace function app_private.assert_business_role_payload_grantable(p_items jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) supplied(permission_code text)
    left join public.permission_actions action_row
      on action_row.permission_code = supplied.permission_code
     and action_row.is_active
    where action_row.permission_code is null
       or action_row.grant_readiness not in ('enforced', 'verified')
  ) then
    raise exception 'Business Role contains a permission that is not enforced or verified'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function app_private.assert_business_role_template_grantable(p_role_template_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  select code into v_code
  from public.role_permission_templates
  where id = p_role_template_id and is_active;

  if v_code is null then
    raise exception 'Valid Business Role required' using errcode = '23514';
  end if;

  -- SUPER_ADMIN is deliberately dynamic and governed by its protected command.
  if v_code <> 'SUPER_ADMIN' and exists (
    select 1
    from public.role_permission_template_items item
    left join public.permission_actions action_row
      on action_row.permission_code = item.permission_code
     and action_row.is_active
    where item.template_id = p_role_template_id
      and (
        action_row.permission_code is null
        or action_row.grant_readiness not in ('enforced', 'verified')
      )
  ) then
    raise exception 'Business Role contains a permission that is not enforced or verified'
      using errcode = '23514';
  end if;
end;
$$;

revoke all on function app_private.assert_business_role_payload_grantable(jsonb) from public, anon;
revoke all on function app_private.assert_business_role_template_grantable(uuid) from public, anon;
grant execute on function app_private.assert_business_role_payload_grantable(jsonb) to authenticated, service_role;
grant execute on function app_private.assert_business_role_template_grantable(uuid) to authenticated, service_role;

create or replace function public.preview_business_role_assignment_v2(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_scope_type text,
  p_scope_id text
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app_private.assert_business_role_template_grantable(p_role_template_id);
  return app_private.preview_business_role_assignment_impl(
    p_target_user_id, p_role_template_id, p_scope_type, p_scope_id
  );
end;
$$;

create or replace function app_private.save_business_role_v2_impl(
  p_role_template_id uuid,
  p_expected_role_version integer,
  p_code text,
  p_name text,
  p_description text,
  p_items jsonb,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_current_version integer;
  v_role_id uuid;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_roles');

  if p_role_template_id is null then
    if p_expected_role_version is not null and p_expected_role_version <> 0 then
      raise exception 'AUTHORIZATION_STALE_ROLE_VERSION' using errcode = '40001';
    end if;
  else
    select version into v_current_version
    from public.role_permission_templates
    where id = p_role_template_id
    for update;
    if v_current_version is null then
      raise exception 'Business Role does not exist' using errcode = '23503';
    end if;
    if p_expected_role_version is null or p_expected_role_version <> v_current_version then
      raise exception 'AUTHORIZATION_STALE_ROLE_VERSION' using errcode = '40001';
    end if;
  end if;

  perform app_private.assert_business_role_payload_grantable(p_items);
  v_role_id := app_private.save_business_role_impl(
    p_role_template_id, p_code, p_name, p_description, p_items, p_reason
  );
  select version into v_current_version
  from public.role_permission_templates
  where id = v_role_id;

  return jsonb_build_object(
    'roleTemplateId', v_role_id,
    'version', v_current_version,
    'savedAt', now(),
    'actorUserId', v_actor
  );
end;
$$;

create or replace function app_private.assign_business_role_v2_impl(
  p_target_user_id uuid,
  p_role_template_id uuid,
  p_expected_role_version integer,
  p_scope_type text,
  p_scope_id text,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_reason text,
  p_warning_acceptances jsonb,
  p_expected_preview_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_role_version integer;
  v_preview jsonb;
  v_assignment_id uuid;
begin
  v_actor := app_private.assert_authorization_permission('system.authorization.manage_roles');
  perform 1 from public.users where id = p_target_user_id for update;
  select version into v_role_version
  from public.role_permission_templates
  where id = p_role_template_id
  for update;

  if v_role_version is null then
    raise exception 'Business Role does not exist' using errcode = '23503';
  end if;
  if p_expected_role_version is null or p_expected_role_version <> v_role_version then
    raise exception 'AUTHORIZATION_STALE_ROLE_VERSION' using errcode = '40001';
  end if;

  perform app_private.assert_business_role_template_grantable(p_role_template_id);
  v_preview := app_private.evaluate_business_role_assignment_impl(
    v_actor, p_target_user_id, p_role_template_id, p_scope_type, p_scope_id
  );
  if nullif(p_expected_preview_fingerprint, '') is null
     or p_expected_preview_fingerprint is distinct from v_preview->>'fingerprint' then
    raise exception 'AUTHORIZATION_STALE_ASSIGNMENT_PREVIEW' using errcode = '40001';
  end if;

  v_assignment_id := app_private.assign_business_role_impl(
    p_target_user_id, p_role_template_id, p_scope_type, p_scope_id,
    p_starts_at, p_expires_at, p_reason, p_warning_acceptances
  );
  return jsonb_build_object(
    'assignmentId', v_assignment_id,
    'roleTemplateId', p_role_template_id,
    'roleVersion', v_role_version,
    'previewFingerprint', v_preview->>'fingerprint',
    'assignedAt', now(),
    'actorUserId', v_actor
  );
end;
$$;

revoke all on function public.preview_business_role_assignment_v2(uuid, uuid, text, text) from public, anon;
grant execute on function public.preview_business_role_assignment_v2(uuid, uuid, text, text) to authenticated, service_role;
revoke all on function app_private.save_business_role_v2_impl(uuid, integer, text, text, text, jsonb, text) from public, anon;
grant execute on function app_private.save_business_role_v2_impl(uuid, integer, text, text, text, jsonb, text) to authenticated, service_role;
revoke all on function app_private.assign_business_role_v2_impl(uuid, uuid, integer, text, text, timestamptz, timestamptz, text, jsonb, text) from public, anon;
grant execute on function app_private.assign_business_role_v2_impl(uuid, uuid, integer, text, text, timestamptz, timestamptz, text, jsonb, text) to authenticated, service_role;
