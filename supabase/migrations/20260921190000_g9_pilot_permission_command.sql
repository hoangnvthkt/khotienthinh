-- A direct-grant replacement needs both optimistic state and explicit SoD
-- warning evidence. update_user_authorization_v2 cannot carry warning
-- acceptances, so it is not safe for the confirmed G9 QC grant set.
create or replace function app_private.preview_direct_permission_grants_v3_impl(
  p_user_id uuid,
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
  v_fingerprint text;
  v_decision jsonb;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  select * into v_target
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

  v_fingerprint := app_private.user_permission_state_fingerprint(p_user_id);
  v_decision := app_private.evaluate_direct_grant_replacement_impl(
    v_actor_user_id,
    p_user_id,
    p_grants
  );

  return jsonb_build_object(
    'userId', p_user_id,
    'fingerprint', v_fingerprint,
    'activeGrantCount', (
      select count(*)::integer
      from public.user_permission_grants grant_row
      where grant_row.user_id = p_user_id
        and grant_row.is_active
    ),
    'decision', v_decision
  );
end;
$$;

create or replace function app_private.apply_direct_permission_grants_v3_impl(
  p_user_id uuid,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb,
  p_expected_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid;
  v_target public.users%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_before_fingerprint text;
  v_after_fingerprint text;
  v_grants_after jsonb;
  v_updated_at timestamptz;
begin
  v_actor_user_id := app_private.assert_authorization_permission(
    'system.authorization.manage_grants'
  );

  if char_length(v_reason) < 10 then
    raise exception 'Direct permission grant change reason required'
      using errcode = '22023';
  end if;

  select * into v_target
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
  if nullif(p_expected_fingerprint, '') is null
    or p_expected_fingerprint is distinct from v_before_fingerprint
  then
    raise exception 'Permission state changed after Preview'
      using errcode = '40001';
  end if;

  v_grants_after := app_private.replace_user_permission_grants_v2_impl(
    p_user_id,
    p_grants,
    v_reason,
    coalesce(p_warning_acceptances, '[]'::jsonb)
  );

  update public.users
  set updated_at = now()
  where id = p_user_id
  returning updated_at into v_updated_at;

  v_after_fingerprint := app_private.user_permission_state_fingerprint(p_user_id);

  return jsonb_build_object(
    'userId', p_user_id,
    'updatedAt', v_updated_at,
    'beforeFingerprint', v_before_fingerprint,
    'afterFingerprint', v_after_fingerprint,
    'activeGrantCount', jsonb_array_length(v_grants_after)
  );
end;
$$;

create or replace function public.preview_direct_permission_grants_v3(
  p_user_id uuid,
  p_grants jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.preview_direct_permission_grants_v3_impl(
    p_user_id,
    p_grants
  );
$$;

create or replace function public.apply_direct_permission_grants_v3(
  p_user_id uuid,
  p_grants jsonb,
  p_reason text,
  p_warning_acceptances jsonb,
  p_expected_fingerprint text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app_private.apply_direct_permission_grants_v3_impl(
    p_user_id,
    p_grants,
    p_reason,
    p_warning_acceptances,
    p_expected_fingerprint
  );
$$;

revoke all on function app_private.preview_direct_permission_grants_v3_impl(uuid,jsonb)
  from public, anon, authenticated;
revoke all on function app_private.apply_direct_permission_grants_v3_impl(uuid,jsonb,text,jsonb,text)
  from public, anon, authenticated;

revoke all on function public.preview_direct_permission_grants_v3(uuid,jsonb)
  from public, anon;
revoke all on function public.apply_direct_permission_grants_v3(uuid,jsonb,text,jsonb,text)
  from public, anon;
grant execute on function public.preview_direct_permission_grants_v3(uuid,jsonb)
  to authenticated;
grant execute on function public.apply_direct_permission_grants_v3(uuid,jsonb,text,jsonb,text)
  to authenticated;

notify pgrst, 'reload schema';
