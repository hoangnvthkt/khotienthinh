do $$
begin
  if to_regclass('public.authorization_override_events') is null
    or to_regprocedure('public.record_authorization_override(text,text,text,text,text,text,uuid,timestamp with time zone,uuid)') is null
    or to_regprocedure('app_private.has_valid_authorization_override(uuid,text,uuid,text,text,text,text,timestamp with time zone)') is null
  then
    raise exception 'Authorization override evidence contract failed';
  end if;

  if has_table_privilege(
    'authenticated',
    'public.authorization_override_events',
    'INSERT'
  ) or has_table_privilege(
    'authenticated',
    'public.authorization_override_events',
    'UPDATE'
  ) or has_table_privilege(
    'authenticated',
    'public.authorization_override_events',
    'DELETE'
  ) or has_function_privilege(
    'authenticated',
    'app_private.has_valid_authorization_override(uuid,text,uuid,text,text,text,text,timestamp with time zone)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated can mutate or forge override evidence';
  end if;
end;
$$;

create temporary table phase2_override_smoke_ids (
  plain_user_id uuid not null,
  permission_admin_id uuid not null,
  operator_id uuid not null,
  auditor_id uuid not null,
  other_id uuid not null,
  plain_email text not null,
  permission_admin_email text not null,
  operator_email text not null,
  auditor_email text not null,
  other_email text not null,
  idempotency_key uuid not null,
  expires_at timestamptz not null,
  override_id uuid
) on commit drop;

grant select, update on phase2_override_smoke_ids to authenticated;

insert into phase2_override_smoke_ids
select
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(),
  'phase2-override-plain-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-override-pa-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-override-operator-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-override-auditor-' || gen_random_uuid()::text || '@vioo.local',
  'phase2-override-other-' || gen_random_uuid()::text || '@vioo.local',
  gen_random_uuid(),
  now() + interval '7 days',
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
select plain_user_id, 'Phase 2 Override Plain', plain_email,
       'phase2-override-plain', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_override_smoke_ids
union all
select permission_admin_id, 'Phase 2 Override Permission Admin', permission_admin_email,
       'phase2-override-pa', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_override_smoke_ids
union all
select operator_id, 'Phase 2 Override Operator', operator_email,
       'phase2-override-operator', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_override_smoke_ids
union all
select auditor_id, 'Phase 2 Override Auditor', auditor_email,
       'phase2-override-auditor', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_override_smoke_ids
union all
select other_id, 'Phase 2 Override Other', other_email,
       'phase2-override-other', 'EMPLOYEE'::public.user_role, true, 'ACTIVE',
       '{}'::text[], '{}'::text[], '{}'::jsonb, '{}'::jsonb
from phase2_override_smoke_ids;

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
       'Override smoke Permission Admin fixture'
from phase2_override_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'PERMISSION_ADMIN'
union all
select 'user', auditor_id, role_row.id, 'global', '*', now(), 'ACTIVE',
       'Override smoke Auditor control owner fixture'
from phase2_override_smoke_ids
join public.role_permission_templates role_row on role_row.code = 'AUDITOR';

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
select operator_id, 'system.authorization.override', 'global', '*', true, now(),
       expires_at, 'Override smoke separately authorized operator fixture'
from phase2_override_smoke_ids;

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
    'email', (select plain_email from phase2_override_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.record_authorization_override(
      'WORKFLOW_CONTROLLED_EXCEPTION',
      'workflow_subject',
      'workflow-plain-denied',
      'global',
      '*',
      'Plain user cannot record controlled override evidence',
      (select auditor_id from phase2_override_smoke_ids),
      now() + interval '1 day',
      gen_random_uuid()
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'User without override permission recorded evidence';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select permission_admin_email from phase2_override_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.record_authorization_override(
      'WORKFLOW_CONTROLLED_EXCEPTION',
      'workflow_subject',
      'workflow-pa-denied',
      'global',
      '*',
      'Permission administration does not imply override authority',
      (select auditor_id from phase2_override_smoke_ids),
      now() + interval '1 day',
      gen_random_uuid()
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Permission Admin implicitly received override permission';
  end if;

  v_denied := false;
  begin
    perform public.replace_user_permission_grants_v2(
      (select permission_admin_id from phase2_override_smoke_ids),
      jsonb_build_array(jsonb_build_object(
        'permission_code', 'system.authorization.override',
        'scope_type', 'global',
        'scope_id', '*',
        'is_active', true,
        'expires_at', now() + interval '1 day'
      )),
      'Permission Admin cannot self grant override permission',
      '[]'::jsonb
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Sensitive direct self-grant of override succeeded';
  end if;
end;
$$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'email', (select operator_email from phase2_override_smoke_ids),
    'sub', gen_random_uuid()::text
  )::text,
  true
);

do $$
declare
  v_denied boolean;
  v_message text;
begin
  v_denied := false;
  begin
    perform public.record_authorization_override(
      'WORKFLOW_CONTROLLED_EXCEPTION',
      'project_payment',
      'payment-subject-mismatch',
      'project',
      'project-1',
      'Subject type must match the controlled exception rule',
      (select auditor_id from phase2_override_smoke_ids),
      now() + interval '1 day',
      gen_random_uuid()
    );
  exception
    when invalid_parameter_value then
      v_denied := true;
      get stacked diagnostics v_message = message_text;
  end;
  if not v_denied then
    raise exception 'Override accepted a mismatched subject type';
  end if;
  if lower(coalesce(v_message, '')) like '%auth_id%'
    or lower(coalesce(v_message, '')) like '%service_role%'
    or lower(coalesce(v_message, '')) like '%select %'
    or lower(coalesce(v_message, '')) like '%secret%'
  then
    raise exception 'Override validation error leaked internal details';
  end if;

  v_denied := false;
  begin
    perform public.record_authorization_override(
      'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
      'workflow_subject',
      'workflow-hard-deny',
      'global',
      '*',
      'Hard maker checker rule cannot be overridden',
      (select auditor_id from phase2_override_smoke_ids),
      now() + interval '1 day',
      gen_random_uuid()
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Maker-checker DENY rule produced override evidence';
  end if;

  v_denied := false;
  begin
    perform public.record_authorization_override(
      'PAYMENT_EXECUTOR_FINAL_APPROVAL',
      'project_payment',
      'payment-hard-deny',
      'project',
      'project-1',
      'Hard payment executor rule cannot be overridden',
      (select auditor_id from phase2_override_smoke_ids),
      now() + interval '1 day',
      gen_random_uuid()
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Payment executor DENY rule produced override evidence';
  end if;
end;
$$;

do $$
declare
  v_first_id uuid;
  v_retry_id uuid;
  v_key uuid := (select idempotency_key from phase2_override_smoke_ids);
  v_expires_at timestamptz := (select expires_at from phase2_override_smoke_ids);
  v_denied boolean := false;
begin
  v_first_id := public.record_authorization_override(
    'WORKFLOW_CONTROLLED_EXCEPTION',
    ' workflow_subject ',
    ' workflow-42 ',
    ' project ',
    ' project-42 ',
    '  Controlled exception monitored by an independent auditor  ',
    (select auditor_id from phase2_override_smoke_ids),
    v_expires_at,
    v_key
  );

  v_retry_id := public.record_authorization_override(
    'WORKFLOW_CONTROLLED_EXCEPTION',
    'workflow_subject',
    'workflow-42',
    'project',
    'project-42',
    'Controlled exception monitored by an independent auditor',
    (select auditor_id from phase2_override_smoke_ids),
    v_expires_at,
    v_key
  );

  if v_retry_id is distinct from v_first_id then
    raise exception 'Override idempotent retry returned another ID';
  end if;

  update phase2_override_smoke_ids set override_id = v_first_id;

  begin
    perform public.record_authorization_override(
      'WORKFLOW_CONTROLLED_EXCEPTION',
      'workflow_subject',
      'workflow-changed',
      'project',
      'project-42',
      'Controlled exception monitored by an independent auditor',
      (select auditor_id from phase2_override_smoke_ids),
      v_expires_at,
      v_key
    );
  exception
    when unique_violation then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Changed payload reused an override idempotency key';
  end if;
end;
$$;

reset role;

do $$
declare
  v_override_id uuid := (select override_id from phase2_override_smoke_ids);
  v_actor_id uuid := (select operator_id from phase2_override_smoke_ids);
  v_other_id uuid := (select other_id from phase2_override_smoke_ids);
  v_expires_at timestamptz := (select expires_at from phase2_override_smoke_ids);
  v_denied boolean;
begin
  if (
    select count(*)
    from public.authorization_override_events override_row
    where override_row.id = v_override_id
  ) <> 1 then
    raise exception 'Idempotent override did not create exactly one event';
  end if;

  if (
    select count(*)
    from public.permission_audit_events event_row
    where event_row.event_type = 'authorization_override_recorded'
      and event_row.metadata ->> 'overrideId' = v_override_id::text
  ) <> 1 then
    raise exception 'Idempotent override did not create exactly one audit';
  end if;

  if (
    select count(*)
    from public.notifications notification_row
    where notification_row.source_type = 'authorization_override'
      and notification_row.source_id = v_override_id::text
      and notification_row.user_id = (
        select auditor_id::text from phase2_override_smoke_ids
      )
  ) <> 1 then
    raise exception 'Idempotent override did not create exactly one notification';
  end if;

  if not app_private.has_valid_authorization_override(
    v_override_id,
    'WORKFLOW_CONTROLLED_EXCEPTION',
    v_actor_id,
    'workflow_subject',
    'workflow-42',
    'project',
    'project-42',
    now()
  ) then
    raise exception 'Valid override evidence was not recognized';
  end if;

  if app_private.has_valid_authorization_override(
    v_override_id,
    'WORKFLOW_CONTROLLED_EXCEPTION',
    v_other_id,
    'workflow_subject',
    'workflow-42',
    'project',
    'project-42',
    now()
  ) or app_private.has_valid_authorization_override(
    v_override_id,
    'WORKFLOW_CONTROLLED_EXCEPTION',
    v_actor_id,
    'workflow_subject',
    'workflow-other',
    'project',
    'project-42',
    now()
  ) or app_private.has_valid_authorization_override(
    v_override_id,
    'WORKFLOW_CONTROLLED_EXCEPTION',
    v_actor_id,
    'workflow_subject',
    'workflow-42',
    'project',
    'project-other',
    now()
  ) or app_private.has_valid_authorization_override(
    v_override_id,
    'WORKFLOW_CONTROLLED_EXCEPTION',
    v_actor_id,
    'workflow_subject',
    'workflow-42',
    'project',
    'project-42',
    v_expires_at + interval '1 second'
  ) then
    raise exception 'Invalid actor, subject, scope or expiry matched override evidence';
  end if;

  v_denied := false;
  begin
    perform app_private.assert_subject_sod(
      'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
      v_actor_id,
      v_actor_id,
      v_other_id,
      null
    );
  exception
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Override evidence bypassed maker-checker hard SoD';
  end if;

  perform app_private.assert_subject_sod(
    'WORKFLOW_MAKER_CHECKER_FINAL_APPROVAL',
    v_actor_id,
    v_other_id,
    v_other_id,
    null
  );

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
    when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then
    raise exception 'Override evidence bypassed payment executor hard SoD';
  end if;

  perform app_private.assert_subject_sod(
    'PAYMENT_EXECUTOR_FINAL_APPROVAL',
    v_actor_id,
    null,
    null,
    v_other_id
  );
end;
$$;

delete from public.notifications
where source_type = 'authorization_override'
  and source_id = (select override_id::text from phase2_override_smoke_ids);
delete from public.permission_audit_events
where event_type = 'authorization_override_recorded'
  and metadata ->> 'overrideId' = (
    select override_id::text from phase2_override_smoke_ids
  );
delete from public.authorization_override_events
where id = (select override_id from phase2_override_smoke_ids);
delete from public.user_permission_grants
where user_id in (
  select operator_id from phase2_override_smoke_ids
  union all
  select permission_admin_id from phase2_override_smoke_ids
);
delete from public.principal_role_assignments
where principal_id in (
  select permission_admin_id from phase2_override_smoke_ids
  union all
  select auditor_id from phase2_override_smoke_ids
);
delete from public.users
where id in (
  select plain_user_id from phase2_override_smoke_ids
  union all
  select permission_admin_id from phase2_override_smoke_ids
  union all
  select operator_id from phase2_override_smoke_ids
  union all
  select auditor_id from phase2_override_smoke_ids
  union all
  select other_id from phase2_override_smoke_ids
);
