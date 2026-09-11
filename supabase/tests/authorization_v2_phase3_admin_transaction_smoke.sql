begin;

do $$
begin
  if to_regprocedure(
    'public.update_user_authorization_v2(uuid,jsonb,jsonb,text,timestamp with time zone)'
  ) is null then
    raise exception 'AUTH_V2_PHASE3_RPC_MISSING';
  end if;
end;
$$;

create temporary table authorization_v2_phase3_smoke_context (
  admin_id uuid not null,
  admin_auth_id uuid not null,
  admin_email text not null,
  ordinary_id uuid not null,
  ordinary_auth_id uuid not null,
  ordinary_email text not null,
  target_id uuid not null
) on commit drop;

grant select on authorization_v2_phase3_smoke_context to authenticated;

do $$
declare
  v_target_id uuid := gen_random_uuid();
begin
  insert into public.users (
    id, name, email, username, role, is_active, account_status
  ) values (
    v_target_id, 'Authorization V2 Phase 3 Target',
    'auth-v2-phase3-target-' || v_target_id || '@invalid.local',
    'auth-v2-phase3-target-' || v_target_id, 'EMPLOYEE', true, 'ACTIVE'
  );

  insert into authorization_v2_phase3_smoke_context
  select
    admin_user.id, admin_user.auth_id, admin_user.email,
    ordinary_user.id, ordinary_user.auth_id, ordinary_user.email,
    v_target_id
  from lateral (
    select account.*
    from public.users account
    where account.auth_id is not null
      and account.is_active
      and account.account_status = 'ACTIVE'
      and app_private.has_permission(
        account.id,
        'system.authorization.manage_grants',
        'global',
        '*'
      )
    order by account.id
    limit 1
  ) admin_user
  cross join lateral (
    select account.*
    from public.users account
    where account.auth_id is not null
      and account.is_active
      and account.account_status = 'ACTIVE'
      and not app_private.has_permission(
        account.id,
        'system.authorization.manage_grants',
        'global',
        '*'
      )
    order by account.id
    limit 1
  ) ordinary_user;

  if (select count(*) from authorization_v2_phase3_smoke_context) <> 1 then
    raise exception 'AUTH_V2_PHASE3_CLOUD_PERSONAS_NOT_FOUND';
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  v_context authorization_v2_phase3_smoke_context%rowtype;
  v_denied boolean := false;
begin
  select * into v_context from authorization_v2_phase3_smoke_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_context.ordinary_auth_id,
      'email', v_context.ordinary_email,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.update_user_authorization_v2(
      v_context.target_id,
      '{}'::jsonb,
      '[]'::jsonb,
      'Ordinary user must not update authorization',
      (select updated_at from public.users where id = v_context.target_id)
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'AUTH_V2_PHASE3_NON_MANAGER_NOT_DENIED';
  end if;
end;
$$;

do $$
declare
  v_context authorization_v2_phase3_smoke_context%rowtype;
  v_blank_reason_denied boolean := false;
  v_short_reason_denied boolean := false;
  v_error_detail text;
  v_stale_denied boolean := false;
begin
  select * into v_context from authorization_v2_phase3_smoke_context;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_context.admin_auth_id,
      'email', v_context.admin_email,
      'role', 'authenticated'
    )::text,
    true
  );

  begin
    perform public.update_user_authorization_v2(
      v_context.target_id,
      '{}'::jsonb,
      '[]'::jsonb,
      '   ',
      (select updated_at from public.users where id = v_context.target_id)
    );
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_error_detail = pg_exception_detail;
      v_blank_reason_denied := (v_error_detail::jsonb ->> 'code') = 'reason_too_short';
  end;

  if not v_blank_reason_denied then
    raise exception 'AUTH_V2_PHASE3_BLANK_REASON_NOT_DENIED';
  end if;

  begin
    perform public.update_user_authorization_v2(
      v_context.target_id,
      '{}'::jsonb,
      '[]'::jsonb,
      'Cấp TS',
      (select updated_at from public.users where id = v_context.target_id)
    );
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_error_detail = pg_exception_detail;
      v_short_reason_denied := (v_error_detail::jsonb ->> 'code') = 'reason_too_short';
  end;

  if not v_short_reason_denied then
    raise exception 'AUTH_V2_PHASE3_SHORT_REASON_DETAIL_MISSING';
  end if;

  begin
    perform public.update_user_authorization_v2(
      v_context.target_id,
      '{}'::jsonb,
      '[]'::jsonb,
      'Reject stale authorization update',
      now() - interval '1 day'
    );
  exception
    when serialization_failure then
      v_stale_denied := true;
  end;

  if not v_stale_denied then
    raise exception 'AUTH_V2_PHASE3_STALE_VERSION_NOT_DENIED';
  end if;
end;
$$;

do $$
declare
  v_context authorization_v2_phase3_smoke_context%rowtype;
  v_before_name text;
  v_invalid_denied boolean := false;
  v_error_detail text;
begin
  select * into v_context from authorization_v2_phase3_smoke_context;
  select name into v_before_name from public.users where id = v_context.target_id;

  begin
    perform public.update_user_authorization_v2(
      v_context.target_id,
      jsonb_build_object('name', 'This update must roll back'),
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'invalid.permission.code',
        'scope_type', 'global',
        'scope_id', '*',
        'is_active', true
      )),
      'Invalid grant must roll back profile',
      (select updated_at from public.users where id = v_context.target_id)
    );
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_error_detail = pg_exception_detail;
      v_invalid_denied := (v_error_detail::jsonb ->> 'code') = 'unknown_permission';
  end;

  if not v_invalid_denied then
    raise exception 'AUTH_V2_PHASE3_INVALID_GRANT_NOT_DENIED';
  end if;

  if (select name from public.users where id = v_context.target_id) is distinct from v_before_name then
    raise exception 'AUTH_V2_PHASE3_INVALID_GRANT_DID_NOT_ROLL_BACK_PROFILE';
  end if;
end;
$$;

do $$
declare
  v_context authorization_v2_phase3_smoke_context%rowtype;
  v_permission_code text;
  v_expiry_denied boolean := false;
  v_error_detail text;
begin
  select * into v_context from authorization_v2_phase3_smoke_context;
  select action_row.permission_code
  into v_permission_code
  from public.permission_actions action_row
  where action_row.is_active
    and action_row.direct_grant_allowed
    and action_row.direct_grant_requires_expiry
    and 'global' = any(action_row.scope_modes)
  order by action_row.permission_code
  limit 1;

  if v_permission_code is null then
    raise exception 'AUTH_V2_PHASE3_EXPIRY_FIXTURE_MISSING';
  end if;

  begin
    perform public.update_user_authorization_v2(
      v_context.target_id,
      '{}'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'permission_code', v_permission_code,
        'scope_type', 'global',
        'scope_id', '*',
        'is_active', true
      )),
      'Kiểm tra quyền cần ngày hết hạn',
      (select updated_at from public.users where id = v_context.target_id)
    );
  exception
    when sqlstate '23514' then
      get stacked diagnostics v_error_detail = pg_exception_detail;
      v_expiry_denied := (v_error_detail::jsonb ->> 'code') = 'expiry_required'
        and (v_error_detail::jsonb ->> 'permissionCode') = v_permission_code;
  end;

  if not v_expiry_denied then
    raise exception 'AUTH_V2_PHASE3_EXPIRY_DETAIL_MISSING';
  end if;
end;
$$;

do $$
declare
  v_context authorization_v2_phase3_smoke_context%rowtype;
  v_result jsonb;
begin
  select * into v_context from authorization_v2_phase3_smoke_context;

  v_result := public.update_user_authorization_v2(
    v_context.target_id,
    jsonb_build_object(
      'name', 'Authorization V2 Phase 3 Updated',
      'phone', '0900000000'
    ),
    (
      select jsonb_agg(jsonb_build_object(
        'permission_code', permission_code,
        'scope_type', 'global',
        'scope_id', '*',
        'is_active', true
      ) order by permission_code)
      from unnest(array[
        'asset.catalog.view',
        'asset.assignment.view',
        'asset.maintenance.view',
        'asset.audit.view'
      ]::text[]) permission_code
    ),
    'Valid atomic authorization smoke update',
    (select updated_at from public.users where id = v_context.target_id)
  );

  if v_result ->> 'userId' is distinct from v_context.target_id::text
    or (v_result ->> 'activeGrantCount')::integer <> 4
    or nullif(v_result ->> 'updatedAt', '') is null
    or nullif(v_result ->> 'auditEventId', '') is null
  then
    raise exception 'AUTH_V2_PHASE3_RECEIPT_INVALID: %', v_result;
  end if;

  if not exists (
    select 1
    from public.users target
    where target.id = v_context.target_id
      and target.name = 'Authorization V2 Phase 3 Updated'
      and target.phone = '0900000000'
  ) then
    raise exception 'AUTH_V2_PHASE3_PROFILE_NOT_UPDATED';
  end if;

  if not exists (
    select 1
    from public.user_permission_grants grant_row
    where grant_row.user_id = v_context.target_id
      and grant_row.permission_code = any(array[
        'asset.catalog.view',
        'asset.assignment.view',
        'asset.maintenance.view',
        'asset.audit.view'
      ]::text[])
      and grant_row.scope_type = 'global'
      and grant_row.scope_id = '*'
      and grant_row.is_active
    group by grant_row.user_id
    having count(*) = 4
  ) then
    raise exception 'AUTH_V2_PHASE3_GRANTS_NOT_UPDATED';
  end if;

  if not exists (
    select 1
    from public.permission_audit_events audit_row
    where audit_row.id = (v_result ->> 'auditEventId')::uuid
      and audit_row.actor_user_id = v_context.admin_id
      and audit_row.target_user_id = v_context.target_id
      and audit_row.event_type = 'user_authorization_v2_updated'
  ) then
    raise exception 'AUTH_V2_PHASE3_AUDIT_EVENT_MISSING';
  end if;
end;
$$;

select jsonb_build_object(
  'authorizationAdminTransaction', 'ok',
  'transaction', 'rollback'
) as authorization_v2_phase3_smoke;

rollback;
