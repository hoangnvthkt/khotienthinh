begin;

do $$
begin
  if to_regprocedure('public.preview_user_permission_change(uuid,jsonb,jsonb)') is null
    or to_regprocedure('public.apply_user_permission_change(uuid,text,jsonb,jsonb,text,jsonb)') is null
    or to_regprocedure('app_private.preview_user_permission_change_impl(uuid,jsonb,jsonb)') is null
    or to_regprocedure('app_private.apply_user_permission_change_impl(uuid,text,jsonb,jsonb,text,jsonb)') is null
  then
    raise exception 'Unified permission change command contract failed';
  end if;

  if has_function_privilege(
    'anon',
    'public.apply_user_permission_change(uuid,text,jsonb,jsonb,text,jsonb)',
    'EXECUTE'
  ) or has_function_privilege(
    'anon',
    'app_private.apply_user_permission_change_impl(uuid,text,jsonb,jsonb,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous role can execute unified permission Save';
  end if;
end;
$$;

create temporary table unified_permission_smoke_ids (
  permission_admin_id uuid not null,
  auditor_id uuid not null,
  target_id uuid not null,
  warning_target_id uuid not null,
  permission_admin_email text not null,
  auditor_email text not null
) on commit drop;

grant select on unified_permission_smoke_ids to authenticated;

insert into unified_permission_smoke_ids
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'unified-permission-admin-' || gen_random_uuid()::text || '@vioo.local',
  'unified-permission-auditor-' || gen_random_uuid()::text || '@vioo.local';

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select permission_admin_id, 'Unified Permission Admin', permission_admin_email,
       'unified-permission-admin', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from unified_permission_smoke_ids
union all
select auditor_id, 'Unified Permission Auditor', auditor_email,
       'unified-permission-auditor', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from unified_permission_smoke_ids
union all
select target_id, 'Unified Permission Target',
       'unified-permission-target-' || gen_random_uuid()::text || '@vioo.local',
       'unified-permission-target', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from unified_permission_smoke_ids
union all
select warning_target_id, 'Unified Permission Warning Target',
       'unified-permission-warning-' || gen_random_uuid()::text || '@vioo.local',
       'unified-permission-warning', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from unified_permission_smoke_ids;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_reason
)
select 'user', permission_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Unified permission command admin fixture'
from unified_permission_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN'
union all
select 'user', auditor_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Unified permission command auditor fixture'
from unified_permission_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'AUDITOR';

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active,
  granted_at, expires_at, grant_reason
)
select warning_target_id, permission_code, 'project', 'project-warning', true,
       now(), now() + interval '30 days', 'Existing declared warning fixture'
from unified_permission_smoke_ids
cross join (values
  ('project.material_po.create'),
  ('project.material_po.approve')
) permission(permission_code);

update app_private.permission_hardening_settings
set value = case
      when key = 'legacy_projection_enabled' then 'false'::jsonb
      else 'true'::jsonb
    end,
    updated_at = now()
where key in (
  'legacy_projection_enabled',
  'business_role_resolver_enabled',
  'legacy_governance_fallback_disabled'
);

create temporary table unified_permission_flag_snapshot on commit drop as
select key, value
from app_private.permission_hardening_settings
where key in (
  'legacy_projection_enabled',
  'business_role_resolver_enabled',
  'legacy_governance_fallback_disabled',
  'system_admin_business_approval_bypass_disabled'
);

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select auditor_email from unified_permission_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform app_private.preview_user_permission_change_impl(
      (select target_id from unified_permission_smoke_ids),
      null,
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;

  if not v_denied then
    raise exception 'Authenticated non-admin executed private unified helper';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select permission_admin_email from unified_permission_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_target_id uuid := (select target_id from unified_permission_smoke_ids);
  v_preview jsonb;
  v_apply jsonb;
  v_legacy jsonb := jsonb_build_object(
    'allowedModules', jsonb_build_array('WMS'),
    'allowedSubModules', '{}'::jsonb,
    'adminModules', '[]'::jsonb,
    'adminSubModules', '{}'::jsonb
  );
  v_grants jsonb := jsonb_build_array(
    jsonb_build_object(
      'permission_code', 'project.daily_log.view',
      'scope_type', 'project',
      'scope_id', 'project-1',
      'is_active', true,
      'expires_at', null
    ),
    jsonb_build_object(
      'permission_code', 'project.daily_log.edit_own',
      'scope_type', 'project',
      'scope_id', 'project-1',
      'is_active', true,
      'expires_at', null
    )
  );
  v_audit_before bigint;
  v_grants_before bigint;
  v_denied boolean;
begin
  select count(*) into v_audit_before
  from public.permission_audit_events
  where target_user_id = v_target_id;
  select count(*) into v_grants_before
  from public.user_permission_grants
  where user_id = v_target_id and is_active;

  v_preview := public.preview_user_permission_change(v_target_id, v_legacy, v_grants);

  if coalesce(v_preview ->> 'beforeFingerprint', '') = ''
    or v_preview -> 'legacyAfter' is distinct from v_legacy
  then
    raise exception 'Unified Preview fingerprint/Legacy contract failed';
  end if;

  if (select count(*) from public.permission_audit_events where target_user_id = v_target_id) <> v_audit_before
    or (select count(*) from public.user_permission_grants where user_id = v_target_id and is_active) <> v_grants_before
    or exists (
      select 1 from public.users
      where id = v_target_id and allowed_modules <> '{}'::text[]
    )
  then
    raise exception 'Unified Preview performed a write';
  end if;

  v_apply := public.apply_user_permission_change(
    v_target_id,
    v_preview ->> 'beforeFingerprint',
    v_legacy,
    v_grants,
    'Grant bounded Daily Log access',
    '[]'::jsonb
  );

  if v_apply -> 'legacyAfter' is distinct from v_preview -> 'legacyAfter'
    or v_apply ->> 'afterFingerprint' = v_apply ->> 'beforeFingerprint'
    or jsonb_array_length(v_apply -> 'directAfter') <> 2
    or not exists (
      select 1 from public.users
      where id = v_target_id and allowed_modules = array['WMS']::text[]
    )
    or (
      select count(*) from public.user_permission_grants
      where user_id = v_target_id
        and is_active
        and permission_code in (
          'project.daily_log.view',
          'project.daily_log.edit_own'
        )
    ) <> 2
  then
    raise exception 'Unified Apply atomic result contract failed';
  end if;

  v_denied := false;
  begin
    perform public.apply_user_permission_change(
      v_target_id,
      v_preview ->> 'beforeFingerprint',
      v_legacy,
      v_grants,
      'Reuse stale permission preview',
      '[]'::jsonb
    );
  exception
    when serialization_failure then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Unified Apply accepted stale fingerprint';
  end if;
end;
$$;

do $$
declare
  v_target_id uuid := (select target_id from unified_permission_smoke_ids);
  v_current_legacy jsonb := jsonb_build_object(
    'allowedModules', jsonb_build_array('WMS'),
    'allowedSubModules', '{}'::jsonb,
    'adminModules', '[]'::jsonb,
    'adminSubModules', '{}'::jsonb
  );
  v_current_grants jsonb := jsonb_build_array(
    jsonb_build_object(
      'permission_code', 'project.daily_log.view',
      'scope_type', 'project',
      'scope_id', 'project-1',
      'is_active', true,
      'expires_at', null
    ),
    jsonb_build_object(
      'permission_code', 'project.daily_log.edit_own',
      'scope_type', 'project',
      'scope_id', 'project-1',
      'is_active', true,
      'expires_at', null
    )
  );
  v_preview jsonb;
  v_denied boolean;
begin
  v_denied := false;
  begin
    perform public.preview_user_permission_change(
      v_target_id,
      jsonb_build_object(
        'allowedModules', jsonb_build_array('WMS'),
        'allowedSubModules', '{}'::jsonb,
        'adminModules', jsonb_build_array('WMS'),
        'adminSubModules', '{}'::jsonb
      ),
      v_current_grants
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Unified Preview added a Legacy administration umbrella';
  end if;

  v_denied := false;
  begin
    perform public.preview_user_permission_change(
      (select permission_admin_id from unified_permission_smoke_ids),
      jsonb_build_object(
        'allowedModules', jsonb_build_array('WMS'),
        'allowedSubModules', '{}'::jsonb,
        'adminModules', '[]'::jsonb,
        'adminSubModules', '{}'::jsonb
      ),
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Unified Preview accepted self-directed Legacy change';
  end if;

  v_denied := false;
  begin
    perform public.preview_user_permission_change(
      (select permission_admin_id from unified_permission_smoke_ids),
      null,
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'project.daily_log.approve',
        'scope_type', 'project',
        'scope_id', 'project-self',
        'is_active', true,
        'expires_at', now() + interval '30 days'
      ))
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Unified Preview bypassed sensitive self-grant hard deny';
  end if;

  v_preview := public.preview_user_permission_change(
    v_target_id,
    v_current_legacy,
    v_current_grants
  );
  v_denied := false;
  begin
    perform public.apply_user_permission_change(
      v_target_id,
      v_preview ->> 'beforeFingerprint',
      jsonb_build_object(
        'allowedModules', jsonb_build_array('HRM', 'WMS'),
        'allowedSubModules', '{}'::jsonb,
        'adminModules', '[]'::jsonb,
        'adminSubModules', '{}'::jsonb
      ),
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'project.not_registered.edit',
        'scope_type', 'project',
        'scope_id', 'project-1',
        'is_active', true,
        'expires_at', null
      )),
      'Invalid direct code must rollback',
      '[]'::jsonb
    );
  exception
    when check_violation then v_denied := true;
  end;
  if not v_denied
    or exists (
      select 1 from public.users
      where id = v_target_id and 'HRM' = any(allowed_modules)
    )
  then
    raise exception 'Invalid Direct code did not roll back Legacy proposal';
  end if;

  v_denied := false;
  begin
    perform public.preview_user_permission_change(
      v_target_id,
      v_current_legacy,
      v_current_grants || jsonb_build_array(jsonb_build_object(
        'permission_code', 'project.daily_log.confirm',
        'scope_type', 'project',
        'scope_id', 'project-1',
        'is_active', true,
        'expires_at', now() + interval '30 days'
      ))
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Unified Preview accepted a new Declared Direct Grant';
  end if;
end;
$$;

do $$
declare
  v_target_id uuid := (select warning_target_id from unified_permission_smoke_ids);
  v_expiry timestamptz;
  v_grants jsonb;
  v_preview jsonb;
begin
  select expires_at into v_expiry
  from public.user_permission_grants
  where user_id = v_target_id
    and permission_code = 'project.material_po.approve'
    and is_active;

  v_grants := jsonb_build_array(
    jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', 'project-warning',
      'is_active', true,
      'expires_at', v_expiry
    ),
    jsonb_build_object(
      'permission_code', 'project.material_po.approve',
      'scope_type', 'project',
      'scope_id', 'project-warning',
      'is_active', true,
      'expires_at', v_expiry
    )
  );
  v_preview := public.preview_user_permission_change(v_target_id, null, v_grants);

  if jsonb_array_length(v_preview #> '{decision,warnings}') <> 1
    or v_preview #>> '{decision,warnings,0,ruleCode}' <> 'PO_CREATE_APPROVE'
  then
    raise exception 'Unified Preview did not reuse typed SoD warning behavior';
  end if;

  perform public.preview_user_permission_change(v_target_id, null, '[]'::jsonb);
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from unified_permission_flag_snapshot snapshot
    join app_private.permission_hardening_settings current_setting
      using (key)
    where snapshot.value is distinct from current_setting.value
  ) then
    raise exception 'Unified command changed authorization rollout flags';
  end if;
end;
$$;

rollback;
