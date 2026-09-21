-- G9 pilot actors use exact project/warehouse grants through the governed
-- authorization command. No fixture survives.
begin;
set local statement_timeout = '20s';

create temporary table g9_permission_fixture (
  admin_actor uuid not null,
  admin_email text not null,
  control_owner uuid not null,
  warehouse_actor uuid not null,
  qc_actor uuid not null,
  manager_actor uuid not null,
  project_id text not null,
  construction_site_id uuid not null,
  warehouse_id text not null,
  other_warehouse_id text not null,
  warehouse_updated_at timestamptz,
  qc_updated_at timestamptz,
  manager_updated_at timestamptz
) on commit drop;

insert into g9_permission_fixture(
  admin_actor,admin_email,control_owner,warehouse_actor,qc_actor,manager_actor,
  project_id,construction_site_id,warehouse_id,other_warehouse_id
)
select
  gen_random_uuid(),'g9-permission-admin-' || gen_random_uuid()::text || '@example.test',
  gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),
  'g9-permission-project-' || gen_random_uuid()::text,gen_random_uuid(),
  'g9-permission-warehouse-' || gen_random_uuid()::text,
  'g9-permission-other-warehouse-' || gen_random_uuid()::text;

grant select on g9_permission_fixture to authenticated;

insert into public.hrm_construction_sites(id,name)
select construction_site_id,'G9 permission smoke site' from g9_permission_fixture;

insert into public.projects(id,code,name,status,construction_site_id)
select project_id,'G9-PERMISSION','G9 permission smoke project','active',construction_site_id
from g9_permission_fixture;

insert into public.warehouse_types(code,name,description,is_system,is_active,sort_order)
values('G9_PERMISSION','G9 permission smoke type','Rollback-only G9 permission fixture',false,true,999);

insert into public.warehouses(id,name,address,type,project_id,construction_site_id)
select warehouse_id,'G9 permission smoke warehouse','Smoke','G9_PERMISSION',project_id,construction_site_id
from g9_permission_fixture
union all
select other_warehouse_id,'G9 permission other warehouse','Smoke','G9_PERMISSION',project_id,construction_site_id
from g9_permission_fixture;

insert into public.users(id,name,email,username,role,is_active,account_status)
select admin_actor,'G9 permission admin',admin_email,admin_actor::text,'ADMIN'::public.user_role,true,'ACTIVE'
from g9_permission_fixture
union all
select control_owner,'G9 permission control owner',control_owner::text || '@vioo.local',control_owner::text,'EMPLOYEE'::public.user_role,true,'ACTIVE'
from g9_permission_fixture
union all
select warehouse_actor,'G9 warehouse actor',warehouse_actor::text || '@vioo.local',warehouse_actor::text,'EMPLOYEE'::public.user_role,true,'ACTIVE'
from g9_permission_fixture
union all
select qc_actor,'G9 QC actor',qc_actor::text || '@vioo.local',qc_actor::text,'EMPLOYEE'::public.user_role,true,'ACTIVE'
from g9_permission_fixture
union all
select manager_actor,'G9 manager actor',manager_actor::text || '@vioo.local',manager_actor::text,'EMPLOYEE'::public.user_role,true,'ACTIVE'
from g9_permission_fixture;

select set_config('request.jwt.claims',jsonb_build_object(
  'sub',admin_actor,'email',admin_email,'role','authenticated'
)::text,true) from g9_permission_fixture;
select set_config('app.account_lifecycle_command','on',true);
update public.users target
set allowed_modules='{}'::text[],admin_modules='{}'::text[],
    allowed_sub_modules='{}'::jsonb,admin_sub_modules='{}'::jsonb
from g9_permission_fixture fixture
where target.id in (
  fixture.admin_actor,fixture.control_owner,fixture.warehouse_actor,
  fixture.qc_actor,fixture.manager_actor
);
select set_config('app.account_lifecycle_command','',true);

-- Bootstrap only the synthetic command actor and one pre-existing target grant.
-- All pilot additions below must pass through update_user_authorization_v2.
select set_config('app.authorization_permission_command','on',true);
insert into public.user_permission_grants(
  user_id,permission_code,scope_type,scope_id,is_active,expires_at,grant_reason
)
select admin_actor,'system.authorization.manage_grants','global','*',true,
       now()+interval '1 hour','G9 pilot permission smoke command actor'
from g9_permission_fixture
union all
select control_owner,'system.authorization.audit','global','*',true,
       now()+interval '1 hour','G9 pilot permission smoke control owner'
from g9_permission_fixture
union all
select warehouse_actor,'wms.inventory.view','warehouse',warehouse_id,true,
       now()+interval '1 hour','G9 pilot permission smoke existing grant'
from g9_permission_fixture
union all
select qc_actor,'wms.master_data.manage','global','*',true,
       now()+interval '1 hour','G9 pilot permission smoke existing SoD grant'
from g9_permission_fixture;

update g9_permission_fixture fixture
set warehouse_updated_at=warehouse_user.updated_at,
    qc_updated_at=qc_user.updated_at,
    manager_updated_at=manager_user.updated_at
from public.users warehouse_user,public.users qc_user,public.users manager_user
where warehouse_user.id=fixture.warehouse_actor
  and qc_user.id=fixture.qc_actor
  and manager_user.id=fixture.manager_actor;

set local role authenticated;

do $$
declare
  fixture g9_permission_fixture%rowtype;
  receipt jsonb;
  preview jsonb;
  grants jsonb;
  warning_acceptances jsonb;
  warning_rejected boolean := false;
  stale_rejected boolean := false;
  expiry timestamptz := now()+interval '1 hour';
begin
  select * into strict fixture from g9_permission_fixture;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',fixture.admin_actor,'email',fixture.admin_email,'role','authenticated'
  )::text,true);

  grants := jsonb_build_array(
      jsonb_build_object('permission_code','wms.inventory.view','scope_type','warehouse','scope_id',fixture.warehouse_id,'is_active',true,'expires_at',expiry),
      jsonb_build_object('permission_code','wms.inventory.edit','scope_type','warehouse','scope_id',fixture.warehouse_id,'is_active',true,'expires_at',expiry),
      jsonb_build_object('permission_code','wms.transaction.complete','scope_type','warehouse','scope_id',fixture.warehouse_id,'is_active',true,'expires_at',expiry)
    );
  preview := public.preview_direct_permission_grants_v3(fixture.warehouse_actor,grants);
  receipt := public.apply_direct_permission_grants_v3(
    fixture.warehouse_actor,grants,
    'G9 pilot warehouse least-privilege grants','[]'::jsonb,preview->>'fingerprint'
  );
  if (receipt->>'activeGrantCount')::integer <> 3 then
    raise exception 'G9 warehouse governed grant count invalid: %',receipt;
  end if;

  grants := jsonb_build_array(
      jsonb_build_object('permission_code','wms.master_data.manage','scope_type','global','scope_id','*','is_active',true,'expires_at',expiry),
      jsonb_build_object('permission_code','wms.transaction.approve','scope_type','warehouse','scope_id',fixture.warehouse_id,'is_active',true,'expires_at',expiry),
      jsonb_build_object('permission_code','project.quality.approve','scope_type','project','scope_id',fixture.project_id,'is_active',true,'expires_at',expiry)
    );
  preview := public.preview_direct_permission_grants_v3(fixture.qc_actor,grants);
  if jsonb_array_length(preview#>'{decision,warnings}') <> 1 then
    raise exception 'G9 QC expected one SoD warning: %',preview;
  end if;
  begin
    perform public.apply_direct_permission_grants_v3(
      fixture.qc_actor,grants,'G9 pilot QC least-privilege grants',
      '[]'::jsonb,preview->>'fingerprint'
    );
  exception when invalid_parameter_value then
    warning_rejected := sqlerrm = 'SoD warning acknowledgement required';
  end;
  if not warning_rejected then
    raise exception 'G9 QC missing SoD evidence was not rejected';
  end if;
  select jsonb_agg(jsonb_build_object(
    'ruleCode',warning->>'ruleCode',
    'scopeType',warning->>'scopeType',
    'scopeId',warning->>'scopeId',
    'reason','G9 pilot QC approval is required for the confirmed receipt journey',
    'controlOwnerUserId',fixture.control_owner,
    'compensatingControls','Exact warehouse scope, time-bound expiry and daily audit review',
    'expiresAt',expiry
  )) into warning_acceptances
  from jsonb_array_elements(preview#>'{decision,warnings}') warning;
  receipt := public.apply_direct_permission_grants_v3(
    fixture.qc_actor,grants,'G9 pilot QC least-privilege grants',
    warning_acceptances,preview->>'fingerprint'
  );
  if (receipt->>'activeGrantCount')::integer <> 3 then
    raise exception 'G9 QC governed grant count invalid: %',receipt;
  end if;

  grants := jsonb_build_array(
      jsonb_build_object('permission_code','project.dashboard.view_progress','scope_type','project','scope_id',fixture.project_id,'is_active',true,'expires_at',expiry),
      jsonb_build_object('permission_code','project.dashboard.view_financials','scope_type','project','scope_id',fixture.project_id,'is_active',true,'expires_at',expiry),
      jsonb_build_object('permission_code','project.report.export','scope_type','project','scope_id',fixture.project_id,'is_active',true,'expires_at',expiry)
    );
  preview := public.preview_direct_permission_grants_v3(fixture.manager_actor,grants);
  receipt := public.apply_direct_permission_grants_v3(
    fixture.manager_actor,grants,
    'G9 pilot manager least-privilege grants','[]'::jsonb,preview->>'fingerprint'
  );
  if (receipt->>'activeGrantCount')::integer <> 3 then
    raise exception 'G9 manager governed grant count invalid: %',receipt;
  end if;
  begin
    perform public.apply_direct_permission_grants_v3(
      fixture.manager_actor,grants,
      'G9 pilot stale fingerprint must fail','[]'::jsonb,preview->>'fingerprint'
    );
  exception when serialization_failure then
    stale_rejected := true;
  end;
  if not stale_rejected then
    raise exception 'G9 stale permission fingerprint was not rejected';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims','{}',true);

do $$
declare fixture g9_permission_fixture%rowtype;
begin
  select * into strict fixture from g9_permission_fixture;

  if not app_private.wms_has_action(
    'wms.inventory.view',null,fixture.warehouse_id,null,null,fixture.warehouse_actor
  ) or not app_private.wms_has_action(
    'wms.inventory.edit',null,fixture.warehouse_id,null,null,fixture.warehouse_actor
  ) or not app_private.wms_has_action(
    'wms.transaction.complete',null,fixture.warehouse_id,null,null,fixture.warehouse_actor
  ) then raise exception 'G9 warehouse actor lacks exact pilot grants or lost an existing grant'; end if;
  if app_private.wms_has_action(
    'wms.transaction.approve',null,fixture.warehouse_id,null,null,fixture.warehouse_actor
  ) or app_private.wms_has_action(
    'wms.inventory.edit',null,fixture.other_warehouse_id,null,null,fixture.warehouse_actor
  ) then raise exception 'G9 warehouse actor grant widened action or warehouse scope'; end if;

  if not app_private.current_user_can_receive_purchase_batch_v2(
    fixture.qc_actor,fixture.warehouse_id
  ) or app_private.current_user_can_receive_purchase_batch_v2(
    fixture.qc_actor,fixture.other_warehouse_id
  ) then raise exception 'G9 QC receipt authority is not exact to the pilot warehouse'; end if;
  if not app_private.project_has_permission_v2(
    fixture.project_id,fixture.construction_site_id::text,
    'project.quality.approve',fixture.qc_actor
  ) then raise exception 'G9 QC project quality approval missing'; end if;

  if not app_private.project_has_permission_v2(
    fixture.project_id,fixture.construction_site_id::text,
    'project.dashboard.view_progress',fixture.manager_actor
  ) or not app_private.project_has_permission_v2(
    fixture.project_id,fixture.construction_site_id::text,
    'project.dashboard.view_financials',fixture.manager_actor
  ) or not app_private.project_has_permission_v2(
    fixture.project_id,fixture.construction_site_id::text,
    'project.report.export',fixture.manager_actor
  ) then raise exception 'G9 manager dataset permissions missing'; end if;
  if app_private.project_has_permission_v2(
    'g9-other-project',null,'project.dashboard.view_progress',fixture.manager_actor
  ) then raise exception 'G9 manager grant widened project scope'; end if;

  if (select count(*) from public.permission_audit_events audit
      where audit.target_user_id in (fixture.warehouse_actor,fixture.qc_actor,fixture.manager_actor)
        and audit.event_type = 'direct_permission_grants_changed') <> 3 then
    raise exception 'G9 governed grant audit trail is incomplete';
  end if;
  if (select count(*) from public.authorization_sod_warning_acceptances acceptance
      where acceptance.target_user_id=fixture.qc_actor
        and acceptance.control_owner_user_id=fixture.control_owner) <> 1 then
    raise exception 'G9 QC SoD control evidence is incomplete';
  end if;
end $$;

select jsonb_build_object(
  'result','g9_pilot_persona_permissions_smoke_passed',
  'governedTargets',3,
  'pilotGrantAdditions',7,
  'existingGrantPreserved',true
) result;

rollback;
