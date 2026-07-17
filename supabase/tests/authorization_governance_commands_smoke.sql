do $$
begin
  if to_regprocedure('public.preview_business_role_change(uuid,jsonb)') is null
    or to_regprocedure('public.save_business_role(uuid,text,text,text,jsonb,text)') is null
    or to_regprocedure('public.preview_business_role_assignment(uuid,uuid,text,text)') is null
    or to_regprocedure('public.assign_business_role(uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,jsonb)') is null
    or to_regprocedure('public.revoke_business_role_assignment(uuid,text)') is null
    or to_regprocedure('public.list_authorization_principals()') is null
    or to_regprocedure('public.set_authorization_rollout_flags(boolean,boolean,boolean,text)') is null
  then
    raise exception 'Authorization governance command contract failed';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.assert_authorization_permission(text)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.assert_and_record_sod_warnings(jsonb,jsonb,text,uuid,uuid,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated can execute owner-only governance helpers';
  end if;

  if has_table_privilege('authenticated', 'public.role_permission_templates', 'INSERT')
    or has_table_privilege('authenticated', 'public.role_permission_templates', 'UPDATE')
    or has_table_privilege('authenticated', 'public.role_permission_templates', 'DELETE')
    or has_table_privilege('authenticated', 'public.role_permission_template_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.role_permission_template_items', 'UPDATE')
    or has_table_privilege('authenticated', 'public.role_permission_template_items', 'DELETE')
    or has_table_privilege('authenticated', 'public.principal_role_assignments', 'INSERT')
    or has_table_privilege('authenticated', 'public.principal_role_assignments', 'UPDATE')
    or has_table_privilege('authenticated', 'public.principal_role_assignments', 'DELETE')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'UPDATE')
    or has_table_privilege('authenticated', 'public.user_permission_grants', 'DELETE')
    or has_table_privilege('authenticated', 'public.permission_audit_events', 'INSERT')
  then
    raise exception 'Authenticated can mutate governance tables directly';
  end if;
end;
$$;

create temporary table phase2_governance_smoke_ids (
  permission_admin_id uuid not null,
  auditor_id uuid not null,
  target_id uuid not null,
  second_target_id uuid not null,
  rollout_admin_id uuid not null,
  unmirrored_admin_id uuid not null,
  permission_admin_email text not null,
  auditor_email text not null,
  rollout_admin_email text not null,
  unmirrored_admin_email text not null,
  creator_role_id uuid,
  warning_role_id uuid,
  sensitive_role_id uuid,
  creator_assignment_id uuid
) on commit drop;

grant select, update on phase2_governance_smoke_ids to authenticated;

insert into phase2_governance_smoke_ids
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-governance-pa-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-governance-auditor-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-governance-admin-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-governance-unmirrored-' || gen_random_uuid()::text || '@vioo.local',
  null,
  null,
  null,
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
select permission_admin_id, 'Phase 2 Permission Admin', permission_admin_email,
       'phase2-governance-pa', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_governance_smoke_ids
union all
select auditor_id, 'Phase 2 Auditor', auditor_email,
       'phase2-governance-auditor', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_governance_smoke_ids
union all
select target_id, 'Phase 2 Target',
       'phase2-governance-target-' || gen_random_uuid()::text || '@vioo.local',
       'phase2-governance-target', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_governance_smoke_ids
union all
select second_target_id, 'Phase 2 Second Target',
       'phase2-governance-target2-' || gen_random_uuid()::text || '@vioo.local',
       'phase2-governance-target2', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_governance_smoke_ids
union all
select rollout_admin_id, 'Phase 2 Rollout Admin', rollout_admin_email,
       'phase2-governance-admin', 'ADMIN'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_governance_smoke_ids
union all
select unmirrored_admin_id, 'Phase 2 Unmirrored Admin', unmirrored_admin_email,
       'phase2-governance-unmirrored', 'ADMIN'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_governance_smoke_ids;

insert into public.principal_role_assignments (
  principal_type,
  principal_id,
  role_template_id,
  scope_type,
  scope_id,
  starts_at,
  status,
  assigned_reason
)
select 'user', permission_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Governance command Permission Admin fixture'
from phase2_governance_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN'
union all
select 'user', auditor_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Governance command Auditor fixture'
from phase2_governance_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'AUDITOR'
union all
select 'user', rollout_admin_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Governance command durable rollout operator fixture'
from phase2_governance_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN';

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key in (
  'business_role_resolver_enabled',
  'legacy_governance_fallback_disabled'
);

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select permission_admin_email from phase2_governance_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_role_id uuid;
  v_preview jsonb;
  v_denied boolean;
begin
  if not exists (
    select 1
    from public.list_authorization_principals() principal_row
    where principal_row.user_id = (
      select target_id from phase2_governance_smoke_ids
    )
  ) then
    raise exception 'Governance principal directory omitted target';
  end if;

  v_preview := public.preview_business_role_change(
    null,
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', '*',
      'sort_order', 10
    ))
  );

  if v_preview ->> 'affectedPrincipalCount' <> '0'
    or jsonb_array_length(v_preview -> 'addedPermissionKeys') <> 1
  then
    raise exception 'Business Role create impact preview contract failed';
  end if;

  v_role_id := public.save_business_role(
    null,
    'project po creator',
    'Project PO Creator',
    'Creates purchase orders in an assigned project',
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', '*',
      'sort_order', 10
    )),
    'Create scoped PO creator role for smoke coverage'
  );

  update phase2_governance_smoke_ids
  set creator_role_id = v_role_id;

  if not exists (
    select 1
    from public.role_permission_templates role_row
    where role_row.id = v_role_id
      and role_row.code = 'PROJECT_PO_CREATOR'
      and not role_row.is_system
  ) then
    raise exception 'Custom Business Role normalization failed';
  end if;

  v_denied := false;
  begin
    perform public.save_business_role(
      null,
      'forbidden identity role',
      'Forbidden Identity Role',
      null,
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'system.settings.manage',
        'scope_type', 'global',
        'scope_id', '*'
      )),
      'Identity permission must remain seed controlled'
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Custom role accepted system.settings.manage';
  end if;

  v_role_id := public.save_business_role(
    null,
    'po maker checker warning',
    'PO Maker Checker Warning',
    null,
    jsonb_build_array(
      jsonb_build_object(
        'permission_code', 'project.material_po.create',
        'scope_type', 'project',
        'scope_id', '*',
        'sort_order', 10
      ),
      jsonb_build_object(
        'permission_code', 'project.material_po.approve',
        'scope_type', 'project',
        'scope_id', '*',
        'sort_order', 20
      )
    ),
    'Create maker checker warning role for smoke coverage'
  );
  update phase2_governance_smoke_ids set warning_role_id = v_role_id;

  v_role_id := public.save_business_role(
    null,
    'sensitive payment approver',
    'Sensitive Payment Approver',
    null,
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.payment.approve',
      'scope_type', 'global',
      'scope_id', '*',
      'sort_order', 10
    )),
    'Create sensitive role for self grant denial coverage'
  );
  update phase2_governance_smoke_ids set sensitive_role_id = v_role_id;
end;
$$;

do $$
declare
  v_target_id uuid := (select target_id from phase2_governance_smoke_ids);
  v_role_id uuid := (select creator_role_id from phase2_governance_smoke_ids);
  v_assignment_id uuid;
  v_preview jsonb;
  v_mutation_preview jsonb;
  v_denied boolean;
begin
  v_preview := public.preview_business_role_assignment(
    v_target_id,
    v_role_id,
    'project',
    'project-1'
  );

  v_assignment_id := public.assign_business_role(
    v_target_id,
    v_role_id,
    'project',
    'project-1',
    now(),
    null,
    'Assign PO creator role for project one smoke test',
    '[]'::jsonb
  );
  update phase2_governance_smoke_ids
  set creator_assignment_id = v_assignment_id;

  v_mutation_preview := public.preview_business_role_assignment(
    (select second_target_id from phase2_governance_smoke_ids),
    v_role_id,
    'project',
    'project-1'
  );
  if v_preview is distinct from v_mutation_preview then
    raise exception 'Role assignment preview is not deterministic';
  end if;

  if not exists (
    select 1
    from public.get_effective_permission_sources(v_target_id) source_row
    where source_row.source_type = 'ROLE'
      and source_row.permission_code = 'project.material_po.create'
      and source_row.scope_type = 'project'
      and source_row.scope_id = 'project-1'
  ) then
    raise exception 'Scoped Business Role did not produce a ROLE source';
  end if;

  v_denied := false;
  begin
    perform public.assign_business_role(
      v_target_id, v_role_id, 'project', 'project-1', now(), null,
      'Duplicate active role assignment must be rejected', '[]'::jsonb
    );
  exception
    when unique_violation then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Duplicate active role assignment was accepted';
  end if;

  v_denied := false;
  begin
    perform public.assign_business_role(
      (select second_target_id from phase2_governance_smoke_ids),
      v_role_id,
      'warehouse',
      'warehouse-1',
      now(),
      null,
      'Reject an incompatible warehouse assignment scope',
      '[]'::jsonb
    );
  exception
    when check_violation then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Incompatible role assignment scope was accepted';
  end if;

  v_denied := false;
  begin
    perform public.assign_business_role(
      (select second_target_id from phase2_governance_smoke_ids),
      v_role_id,
      'project',
      'project-2',
      now() + interval '1 hour',
      null,
      'Future scheduled role assignment must be rejected',
      '[]'::jsonb
    );
  exception
    when invalid_parameter_value then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Future Business Role scheduling was accepted';
  end if;

  v_denied := false;
  begin
    perform public.save_business_role(
      v_role_id,
      'IGNORED_CODE',
      'Project PO Creator Changed',
      null,
      jsonb_build_array(
        jsonb_build_object(
          'permission_code', 'project.material_po.create',
          'scope_type', 'project',
          'scope_id', '*',
          'sort_order', 10
        ),
        jsonb_build_object(
          'permission_code', 'project.material_po.approve',
          'scope_type', 'project',
          'scope_id', '*',
          'sort_order', 20
        )
      ),
      'Assigned role item changes must be rejected'
    );
  exception
    when sqlstate '55000' then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Assigned role permission items were mutated';
  end if;

  perform public.save_business_role(
    v_role_id,
    'IGNORED_CODE',
    'Project PO Creator Renamed',
    'A safe metadata-only rename',
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', '*',
      'sort_order', 10
    )),
    'Allow metadata-only edit after role assignment'
  );

  if public.preview_business_role_change(
    v_role_id,
    jsonb_build_array(jsonb_build_object(
      'permission_code', 'project.material_po.create',
      'scope_type', 'project',
      'scope_id', '*',
      'sort_order', 10
    ))
  ) ->> 'affectedPrincipalCount' <> '1' then
    raise exception 'Role impact preview omitted assignment history';
  end if;
end;
$$;

do $$
declare
  v_denied boolean := false;
  v_decision jsonb;
  v_assignment_id uuid;
begin
  begin
    perform public.assign_business_role(
      (select permission_admin_id from phase2_governance_smoke_ids),
      (select sensitive_role_id from phase2_governance_smoke_ids),
      'global',
      '*',
      now(),
      now() + interval '7 days',
      'Tự cấp quyền nhạy cảm không được phép',
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Sensitive self-role assignment unexpectedly succeeded';
  end if;

  v_decision := public.preview_business_role_assignment(
    (select second_target_id from phase2_governance_smoke_ids),
    (select warning_role_id from phase2_governance_smoke_ids),
    'project',
    '*'
  );
  if jsonb_array_length(v_decision -> 'warnings') <> 1
    or v_decision #>> '{warnings,0,ruleCode}' <> 'PO_CREATE_APPROVE'
    or v_decision #>> '{warnings,0,scopeType}' <> 'project'
    or v_decision #>> '{warnings,0,scopeId}' <> '*'
  then
    raise exception 'Role assignment warning preview contract failed';
  end if;

  v_denied := false;
  begin
    perform public.assign_business_role(
      (select second_target_id from phase2_governance_smoke_ids),
      (select warning_role_id from phase2_governance_smoke_ids),
      'project', '*', now(), now() + interval '7 days',
      'Warning role requires complete acknowledgement',
      '[]'::jsonb
    );
  exception
    when invalid_parameter_value then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Warning role assignment succeeded without acceptance';
  end if;

  v_assignment_id := public.assign_business_role(
    (select second_target_id from phase2_governance_smoke_ids),
    (select warning_role_id from phase2_governance_smoke_ids),
    'project', '*', now(), now() + interval '7 days',
    'Warning role accepted with independent controls',
    jsonb_build_array(jsonb_build_object(
      'ruleCode', 'PO_CREATE_APPROVE',
      'scopeType', 'project',
      'scopeId', '*',
      'reason', 'Independent review is required before approval',
      'controlOwnerUserId', (select auditor_id from phase2_governance_smoke_ids),
      'compensatingControls', 'Auditor reviews purchase orders every business day',
      'expiresAt', (now() + interval '3 days')::text
    ))
  );

  if not exists (
    select 1
    from public.authorization_sod_warning_acceptances acceptance_row
    where acceptance_row.command_type = 'ASSIGN_BUSINESS_ROLE'
      and acceptance_row.command_id = v_assignment_id
      and acceptance_row.rule_code = 'PO_CREATE_APPROVE'
  ) then
    raise exception 'Role warning acceptance was not recorded';
  end if;
end;
$$;

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.assign_business_role(
      (select target_id from phase2_governance_smoke_ids),
      (
        select role_row.id
        from public.role_permission_templates role_row
        where role_row.code = 'SYSTEM_ADMIN'
      ),
      'global', '*', now(), null,
      'System Admin mirror requires ADMIN profile identity',
      '[]'::jsonb
    );
  exception
    when sqlstate '55000' then v_denied := true;
  end;
  if not v_denied then
    raise exception 'SYSTEM_ADMIN was assigned to a non-ADMIN profile';
  end if;
end;
$$;

do $$
declare
  v_assignment_id uuid := (
    select creator_assignment_id from phase2_governance_smoke_ids
  );
  v_event_count bigint;
begin
  perform public.revoke_business_role_assignment(
    v_assignment_id,
    'Revoke PO creator assignment after smoke validation'
  );

  select count(*)
  into v_event_count
  from public.permission_audit_events event_row
  where event_row.event_type = 'business_role_revoked'
    and event_row.metadata ->> 'assignmentId' = v_assignment_id::text;

  perform public.revoke_business_role_assignment(
    v_assignment_id,
    'Revoke PO creator assignment after smoke validation'
  );

  if (
    select count(*)
    from public.permission_audit_events event_row
    where event_row.event_type = 'business_role_revoked'
      and event_row.metadata ->> 'assignmentId' = v_assignment_id::text
  ) <> v_event_count then
    raise exception 'Idempotent Business Role revoke duplicated audit history';
  end if;

  if exists (
    select 1
    from public.get_effective_permission_sources(
      (select target_id from phase2_governance_smoke_ids)
    ) source_row
    where source_row.source_type = 'ROLE'
      and source_row.permission_code = 'project.material_po.create'
      and source_row.scope_type = 'project'
      and source_row.scope_id = 'project-1'
      and source_row.source_id = v_assignment_id::text
  ) then
    raise exception 'Revoked Business Role still grants an effective source';
  end if;

  if not exists (
    select 1
    from public.principal_role_assignments assignment_row
    where assignment_row.id = v_assignment_id
      and assignment_row.status = 'REVOKED'
      and assignment_row.revoked_at is not null
      and assignment_row.revoked_reason is not null
  ) then
    raise exception 'Business Role revoke deleted assignment history';
  end if;

  if not exists (
    select 1
    from public.permission_audit_events event_row
    where event_row.event_type = 'business_role_created'
      and event_row.metadata ->> 'roleTemplateId' = (
        select creator_role_id::text from phase2_governance_smoke_ids
      )
  ) or not exists (
    select 1
    from public.permission_audit_events event_row
    where event_row.event_type = 'business_role_assigned'
      and event_row.metadata ->> 'assignmentId' = v_assignment_id::text
  ) or v_event_count <> 1 then
    raise exception 'Business Role create/assign/revoke audit parity failed';
  end if;
end;
$$;

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.set_authorization_rollout_flags(
      false,
      true,
      false,
      'Invalid cutoff without resolver must fail first'
    );
  exception
    when invalid_parameter_value then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Fallback cutoff was enabled without resolver';
  end if;

  v_denied := false;
  begin
    perform public.set_authorization_rollout_flags(
      true,
      false,
      false,
      'Permission Admin without ADMIN identity cannot toggle flags'
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Non-ADMIN Permission Admin toggled rollout flags';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select unmirrored_admin_email from phase2_governance_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.set_authorization_rollout_flags(
      true,
      false,
      false,
      'Unmirrored ADMIN cannot toggle authorization rollout flags'
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'ADMIN without explicit manage_roles toggled rollout flags';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select rollout_admin_email from phase2_governance_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_after jsonb;
begin
  v_after := public.set_authorization_rollout_flags(
    true,
    false,
    false,
    'Restore compatibility fallbacks through governed command'
  );
  if v_after ->> 'business_role_resolver_enabled' <> 'true'
    or v_after ->> 'legacy_governance_fallback_disabled' <> 'false'
    or v_after ->> 'system_admin_business_approval_bypass_disabled' <> 'false'
  then
    raise exception 'Governed rollout flag result contract failed';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select auditor_email from phase2_governance_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
begin
  if not exists (
    select 1
    from public.permission_audit_events event_row
    where event_row.event_type in (
      'business_role_created',
      'business_role_assigned',
      'business_role_revoked',
      'direct_permission_grants_changed'
    )
  ) then
    raise exception 'Auditor cannot read governance audit events';
  end if;
end;
$$;

reset role;
