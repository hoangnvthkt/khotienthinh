do $$
begin
  if to_regclass('public.authorization_sod_rules') is null
    or to_regclass('public.authorization_sod_warning_acceptances') is null
    or to_regprocedure('app_private.evaluate_authorization_change(uuid,uuid,text[],text,text,text)') is null
    or to_regprocedure('app_private.evaluate_authorization_change_set(uuid,uuid,jsonb,text)') is null
    or to_regprocedure('public.preview_authorization_change(uuid,text[],text,text,text)') is null
    or to_regprocedure('app_private.assert_subject_sod(text,uuid,uuid,uuid,uuid)') is null
  then
    raise exception 'Minimal SoD function/schema contract failed';
  end if;

  if (
    select count(*)
    from public.authorization_sod_rules rule_row
    where rule_row.rule_code in (
      'AUTHZ_SENSITIVE_SELF_GRANT',
      'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
      'PAYMENT_EXECUTOR_FINAL_APPROVAL',
      'VENDOR_MAINTAIN_PAYMENT_APPROVE',
      'PO_CREATE_APPROVE',
      'PO_RECEIVE_PAYMENT_APPROVE',
      'WAREHOUSE_MANAGE_ADJUST_APPROVE',
      'WORKFLOW_CONTROLLED_EXCEPTION'
    )
      and rule_row.is_active
  ) <> 8 then
    raise exception 'Minimal SoD typed seed contract failed';
  end if;

  if exists (
    select 1
    from public.authorization_sod_rules rule_row
    where rule_row.effect = 'DENY'
      and rule_row.overridable
  ) then
    raise exception 'Hard-deny SoD rule is overridable';
  end if;

  if has_table_privilege('authenticated', 'public.authorization_sod_rules', 'INSERT')
    or has_table_privilege('authenticated', 'public.authorization_sod_rules', 'UPDATE')
    or has_table_privilege('authenticated', 'public.authorization_sod_rules', 'DELETE')
    or has_table_privilege('authenticated', 'public.authorization_sod_warning_acceptances', 'INSERT')
    or has_table_privilege('authenticated', 'public.authorization_sod_warning_acceptances', 'UPDATE')
    or has_table_privilege('authenticated', 'public.authorization_sod_warning_acceptances', 'DELETE')
  then
    raise exception 'Authenticated role can mutate SoD registry/evidence directly';
  end if;

  if has_function_privilege(
    'authenticated',
    'app_private.assert_subject_sod(text,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.evaluate_authorization_change_set(uuid,uuid,jsonb,text)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role can execute owner-only SoD helper';
  end if;
end;
$$;

create temporary table phase2_sod_smoke_ids (
  actor_id uuid not null,
  target_id uuid not null,
  other_id uuid not null,
  actor_email text not null,
  target_email text not null,
  other_email text not null
) on commit drop;

grant select on phase2_sod_smoke_ids to authenticated;

insert into phase2_sod_smoke_ids
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-sod-actor-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-sod-target-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-sod-other-' || gen_random_uuid()::text || '@vioo.local';

insert into public.users (
  id, name, email, username, role, is_active, account_status,
  allowed_modules, admin_modules, allowed_sub_modules, admin_sub_modules
)
select actor_id, 'Phase 2 SoD Actor', actor_email, 'phase2-sod-actor',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_sod_smoke_ids
union all
select target_id, 'Phase 2 SoD Target', target_email, 'phase2-sod-target',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_sod_smoke_ids
union all
select other_id, 'Phase 2 SoD Other', other_email, 'phase2-sod-other',
       'EMPLOYEE'::public.user_role, true, 'ACTIVE', '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_sod_smoke_ids;

insert into public.principal_role_assignments (
  principal_type, principal_id, role_template_id, scope_type, scope_id,
  starts_at, status, assigned_reason
)
select 'user', actor_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Test Permission Admin SoD evaluation'
from phase2_sod_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN';

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, granted_at, grant_reason
)
select target_id, 'project.daily_log.view', 'project', 'project-1', true, now(),
       'Test concrete point for broad SoD warning suppression'
from phase2_sod_smoke_ids;

update app_private.permission_hardening_settings
set value = 'true'::jsonb,
    updated_at = now()
where key in ('business_role_resolver_enabled', 'legacy_governance_fallback_disabled');

set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select actor_email from phase2_sod_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_actor_id uuid := (select actor_id from phase2_sod_smoke_ids);
  v_target_id uuid := (select target_id from phase2_sod_smoke_ids);
  v_other_id uuid := (select other_id from phase2_sod_smoke_ids);
  v_decision jsonb;
  v_denied boolean := false;
begin
  v_decision := public.preview_authorization_change(
    v_target_id,
    array['contract.supplier.manage', 'project.payment.approve'],
    'global',
    '*',
    'ADD'
  );

  if jsonb_array_length(v_decision -> 'warnings') <> 1
    or v_decision #>> '{warnings,0,ruleCode}' <> 'VENDOR_MAINTAIN_PAYMENT_APPROVE'
  then
    raise exception 'Permission-pair warning decision contract failed';
  end if;

  v_decision := public.preview_authorization_change(
    v_actor_id,
    array['project.payment.approve'],
    'global',
    '*',
    'ADD'
  );

  if jsonb_array_length(v_decision -> 'hardDenies') <> 1
    or v_decision #>> '{hardDenies,0,ruleCode}' <> 'AUTHZ_SENSITIVE_SELF_GRANT'
  then
    raise exception 'Sensitive self-grant hard-deny contract failed';
  end if;

  begin
    perform app_private.evaluate_authorization_change(
      v_other_id,
      v_target_id,
      array['project.payment.approve'],
      'global',
      '*',
      'ADD'
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'Forged SoD preview actor was accepted';
  end if;
end;
$$;

reset role;

do $$
declare
  v_actor_id uuid := (select actor_id from phase2_sod_smoke_ids);
  v_target_id uuid := (select target_id from phase2_sod_smoke_ids);
  v_other_id uuid := (select other_id from phase2_sod_smoke_ids);
  v_decision jsonb;
  v_denied boolean := false;
begin

  v_decision := app_private.evaluate_authorization_change_set(
    v_actor_id,
    v_target_id,
    jsonb_build_array(
      jsonb_build_object(
        'permissionCode', 'project.material_po.create',
        'scopeType', 'project',
        'scopeId', '*'
      ),
      jsonb_build_object(
        'permissionCode', 'project.material_po.approve',
        'scopeType', 'project',
        'scopeId', '*'
      )
    ),
    'ADD'
  );

  if jsonb_array_length(v_decision -> 'warnings') <> 1
    or v_decision #>> '{warnings,0,ruleCode}' <> 'PO_CREATE_APPROVE'
    or v_decision #>> '{warnings,0,scopeType}' <> 'project'
    or v_decision #>> '{warnings,0,scopeId}' <> '*'
  then
    raise exception 'Multi-scope SoD warning aggregation/suppression contract failed';
  end if;

  begin
    perform app_private.assert_subject_sod(
      'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
      v_actor_id,
      v_actor_id,
      v_other_id,
      null
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'Maker-checker creator relation was not denied';
  end if;

  v_denied := false;
  begin
    perform app_private.assert_subject_sod(
      'PAYMENT_EXECUTOR_FINAL_APPROVAL',
      v_actor_id,
      null,
      null,
      v_actor_id
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'Payment executor relation was not denied';
  end if;

  perform app_private.assert_subject_sod(
    'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
    v_actor_id,
    v_other_id,
    v_target_id,
    null
  );

  perform app_private.assert_subject_sod(
    'PAYMENT_EXECUTOR_FINAL_APPROVAL',
    v_actor_id,
    null,
    null,
    v_other_id
  );

  v_denied := false;
  begin
    perform app_private.assert_subject_sod(
      'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
      v_other_id,
      v_actor_id,
      v_target_id,
      null
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;

  if not v_denied then
    raise exception 'Forged subject-guard actor was accepted';
  end if;
end;
$$;

delete from public.principal_role_assignments
where principal_id = (select actor_id from phase2_sod_smoke_ids);

delete from public.user_permission_grants
where user_id = (select target_id from phase2_sod_smoke_ids);

delete from public.users
where id in (
  select actor_id from phase2_sod_smoke_ids
  union all
  select target_id from phase2_sod_smoke_ids
  union all
  select other_id from phase2_sod_smoke_ids
);

select 'authorization_sod_smoke_passed' as checkpoint;
