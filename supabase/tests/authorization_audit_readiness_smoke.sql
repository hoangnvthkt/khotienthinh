begin;

do $$
begin
  if to_regclass('pg_temp.authorization_audit_readiness_before') is not null then
    if (
      select count(*)
      from pg_temp.authorization_audit_readiness_before before_row
      join public.permission_actions action_row
        on action_row.permission_code = before_row.permission_code
      where before_row.permission_code in (
          'system.authorization.view',
          'system.authorization.audit'
        )
        and before_row.grant_readiness = 'declared'
        and action_row.grant_readiness = 'verified'
    ) <> 2 then
      raise exception 'Authorization View+Audit did not change from Declared to Verified';
    end if;

    if exists (
      select 1
      from pg_temp.authorization_audit_readiness_before before_row
      join public.permission_actions action_row
        on action_row.permission_code = before_row.permission_code
      where before_row.permission_code not in (
          'system.authorization.view',
          'system.authorization.audit'
        )
        and before_row.grant_readiness is distinct from action_row.grant_readiness
    ) then
      raise exception 'Unexpected authorization readiness change outside View+Audit';
    end if;
  end if;

  if (
    select count(*)
    from public.permission_actions action_row
    where action_row.permission_code in (
        'system.authorization.view',
        'system.authorization.audit'
      )
      and action_row.grant_readiness = 'verified'
      and action_row.scope_modes = array['global']::text[]
      and action_row.is_active
      and not action_row.direct_grant_requires_expiry
  ) <> 2 then
    raise exception 'Authorization View+Audit readiness contract failed';
  end if;

  if exists (
    select 1
    from public.permission_actions action_row
    where action_row.permission_code in (
        'system.authorization.manage_roles',
        'system.authorization.manage_grants',
        'system.authorization.manage_scopes',
        'system.authorization.override'
      )
      and action_row.grant_readiness = 'verified'
  ) then
    raise exception 'Adjacent authorization governance action was promoted';
  end if;
end;
$$;

create temporary table authorization_audit_readiness_smoke_ids (
  audit_user_id uuid not null,
  no_grant_user_id uuid not null,
  unrelated_actor_id uuid not null,
  unrelated_target_id uuid not null,
  audit_user_email text not null,
  no_grant_user_email text not null,
  unrelated_event_id uuid
) on commit drop;

grant select, update on authorization_audit_readiness_smoke_ids to authenticated;

insert into authorization_audit_readiness_smoke_ids
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'authorization-audit-reader-' || gen_random_uuid()::text || '@vioo.local',
  'authorization-audit-denied-' || gen_random_uuid()::text || '@vioo.local',
  null;

insert into public.users (
  id,
  name,
  email,
  username,
  role,
  is_active,
  account_status,
  allowed_modules,
  admin_modules,
  allowed_sub_modules,
  admin_sub_modules
)
select audit_user_id, 'Authorization Audit Reader', audit_user_email,
       'authorization-audit-reader', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from authorization_audit_readiness_smoke_ids
union all
select no_grant_user_id, 'Authorization Audit Denied', no_grant_user_email,
       'authorization-audit-denied', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from authorization_audit_readiness_smoke_ids
union all
select unrelated_actor_id, 'Authorization Audit Unrelated Actor',
       'authorization-audit-actor-' || gen_random_uuid()::text || '@vioo.local',
       'authorization-audit-actor', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from authorization_audit_readiness_smoke_ids
union all
select unrelated_target_id, 'Authorization Audit Unrelated Target',
       'authorization-audit-target-' || gen_random_uuid()::text || '@vioo.local',
       'authorization-audit-target', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from authorization_audit_readiness_smoke_ids;

with inserted_event as (
  insert into public.permission_audit_events (
    actor_user_id,
    target_user_id,
    event_type,
    before_grants,
    after_grants,
    metadata
  )
  select
    unrelated_actor_id,
    unrelated_target_id,
    'authorization_audit_readiness_fixture',
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object('source', 'authorization_audit_readiness_smoke')
  from authorization_audit_readiness_smoke_ids
  returning id
)
update authorization_audit_readiness_smoke_ids
set unrelated_event_id = (select id from inserted_event);

insert into public.user_permission_grants (
  user_id,
  permission_code,
  scope_type,
  scope_id,
  is_active,
  granted_at,
  expires_at,
  grant_reason
)
select
  audit_user_id,
  permission.permission_code,
  'global',
  '*',
  true,
  now(),
  null,
  'Rollback-only authorization audit readiness smoke'
from authorization_audit_readiness_smoke_ids
cross join (values
  ('system.authorization.view'),
  ('system.authorization.audit')
) permission(permission_code);

do $$
begin
  if not app_private.has_permission(
    (select audit_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.view',
    'global',
    '*'
  ) or not app_private.has_permission(
    (select audit_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.audit',
    'global',
    '*'
  ) then
    raise exception 'Authorization View+Audit direct grant did not resolve';
  end if;

  if app_private.has_permission(
    (select audit_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.manage_roles',
    'global',
    '*'
  ) or app_private.has_permission(
    (select audit_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.manage_grants',
    'global',
    '*'
  ) or app_private.has_permission(
    (select audit_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.manage_scopes',
    'global',
    '*'
  ) or app_private.has_permission(
    (select audit_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.override',
    'global',
    '*'
  ) then
    raise exception 'Authorization Audit fixture received adjacent governance permission';
  end if;
end;
$$;

set role authenticated;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select audit_user_email from authorization_audit_readiness_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean;
begin
  if (
    select count(*)
    from public.permission_audit_events event_row
    where event_row.id = (
      select unrelated_event_id from authorization_audit_readiness_smoke_ids
    )
  ) <> 1 then
    raise exception 'Authorization Audit fixture could not read unrelated audit event';
  end if;

  v_denied := false;
  begin
    insert into public.permission_audit_events (
      actor_user_id,
      target_user_id,
      event_type,
      before_grants,
      after_grants,
      metadata
    )
    values (
      (select audit_user_id from authorization_audit_readiness_smoke_ids),
      (select no_grant_user_id from authorization_audit_readiness_smoke_ids),
      'authorization_audit_readiness_forbidden_insert',
      '[]'::jsonb,
      '[]'::jsonb,
      '{}'::jsonb
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Authorization Audit fixture inserted audit rows directly';
  end if;

  v_denied := false;
  begin
    update public.permission_audit_events
    set metadata = metadata || jsonb_build_object('forbidden', true)
    where id = (
      select unrelated_event_id from authorization_audit_readiness_smoke_ids
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Authorization Audit fixture updated audit rows directly';
  end if;

  v_denied := false;
  begin
    delete from public.permission_audit_events
    where id = (
      select unrelated_event_id from authorization_audit_readiness_smoke_ids
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Authorization Audit fixture deleted audit rows directly';
  end if;

  v_denied := false;
  begin
    perform public.preview_business_role_change(null, '[]'::jsonb);
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Authorization Audit fixture previewed Business Role management';
  end if;

  v_denied := false;
  begin
    perform public.preview_direct_grant_replacement(
      (select no_grant_user_id from authorization_audit_readiness_smoke_ids),
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Authorization Audit fixture previewed Direct Grant management';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select no_grant_user_email from authorization_audit_readiness_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  if (
    select count(*)
    from public.permission_audit_events event_row
    where event_row.id = (
      select unrelated_event_id from authorization_audit_readiness_smoke_ids
    )
  ) <> 0 then
    raise exception 'No-grant fixture could read unrelated audit event';
  end if;

  if app_private.has_permission(
    (select no_grant_user_id from authorization_audit_readiness_smoke_ids),
    'system.authorization.audit',
    'global',
    '*'
  ) then
    raise exception 'No-grant fixture unexpectedly resolved Audit permission';
  end if;
end;
$$;

reset role;

select 'authorization_audit_readiness_smoke_passed' as checkpoint;
rollback;
