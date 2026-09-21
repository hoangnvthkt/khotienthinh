begin;
set local statement_timeout = '20s';

insert into public.users(id,name,email,username,role,is_active,account_status) values
('91111111-1111-4111-8111-111111111111','G9 Pilot Admin','g9-admin@example.test','g9-admin','ADMIN',true,'ACTIVE');

select set_config('request.jwt.claims',jsonb_build_object(
  'sub','91111111-1111-4111-8111-111111111111',
  'email','g9-admin@example.test','role','authenticated'
)::text,true);

set local role authenticated;
do $$
begin
  begin
    perform public.save_material_plan_v1(
      gen_random_uuid(),'g9-project-a',null,0,'Blocked',current_date,current_date,
      null,'draft','[]'::jsonb,1,'g9-blocked');
    raise exception 'G9_UNCONFIGURED_COMMAND_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'ERP_COMPLETION_PILOT_COMMAND_DISABLED' then raise; end if;
  end;
  begin
    perform public.record_supplier_invoice_reconciliation_v2(
      '{}'::jsonb,'[]'::jsonb,'91111111-1111-4111-8111-111111111111');
    raise exception 'G9_LEGACY_INVOICE_COMMAND_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'ERP_COMPLETION_PILOT_COMMAND_DISABLED' then raise; end if;
  end;
end;
$$;

reset role;
select set_config('app.erp_completion_rollout_reason','G9 rollback smoke setup',true);
insert into app_private.erp_completion_rollout_scopes(
  id,scope_key,project_id,warehouse_ids,supplier_ids,mode,
  enabled_commands,completion_commands,starts_at,expires_at,
  release_id,owner,support_owner,reason,created_by,updated_by
) values (
  '92222222-2222-4222-8222-222222222222','g9-pilot-smoke','g9-project-a',
  array['g9-warehouse-a'],array['g9-supplier-a'],'pilot',
  array['material_plan.save','wms.transfer.receive','wms.transfer.dispose',
    'wms.inventory_count.post','finance.invoice.reverse','finance.payment.reverse'],
  array['wms.transfer.receive','wms.transfer.dispose','wms.inventory_count.post',
    'finance.invoice.reverse','finance.payment.reverse'],
  statement_timestamp()-interval '1 hour',statement_timestamp()+interval '1 hour',
  'g9-smoke','release-owner','support-owner','rollback smoke',
  '91111111-1111-4111-8111-111111111111','91111111-1111-4111-8111-111111111111'
);
insert into app_private.erp_completion_rollout_actors(scope_id,user_id,persona)
values('92222222-2222-4222-8222-222222222222','91111111-1111-4111-8111-111111111111','buyer');

set local role authenticated;
do $$
declare v_access jsonb;
begin
  v_access := public.get_erp_completion_rollout_access_v1(
    'g9-project-a',null,'g9-warehouse-a','g9-supplier-a');
  if v_access->>'mode' <> 'pilot'
     or v_access->>'scopeKey' <> 'g9-pilot-smoke'
     or v_access->>'persona' <> 'buyer' then
    raise exception 'G9_PILOT_ACCESS_INVALID: %',v_access;
  end if;
end;
$$;

reset role;
do $$
begin
  perform app_private.assert_erp_completion_rollout_command_v1(
    'material_plan.save','g9-project-a',null,null,null);
  begin
    perform app_private.assert_erp_completion_rollout_command_v1(
      'material_plan.save','g9-project-b',null,null,null);
    raise exception 'G9_CROSS_PROJECT_COMMAND_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'ERP_COMPLETION_PILOT_COMMAND_DISABLED' then raise; end if;
  end;
  begin
    perform app_private.assert_erp_completion_rollout_command_v1(
      'material_plan.save','g9-project-a',null,'g9-warehouse-b',null);
    raise exception 'G9_CROSS_WAREHOUSE_COMMAND_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'ERP_COMPLETION_PILOT_COMMAND_DISABLED' then raise; end if;
  end;
end;
$$;

select set_config('app.erp_completion_rollout_reason','Pause G9 smoke cohort',true);
update app_private.erp_completion_rollout_scopes
set mode='paused',row_version=row_version+1,updated_at=now(),
  updated_by='91111111-1111-4111-8111-111111111111'
where id='92222222-2222-4222-8222-222222222222';

do $$
begin
  begin
    perform app_private.assert_erp_completion_rollout_command_v1(
      'material_plan.save','g9-project-a',null,null,null);
    raise exception 'G9_PAUSED_CREATION_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'ERP_COMPLETION_PILOT_COMMAND_DISABLED' then raise; end if;
  end;
  perform app_private.assert_erp_completion_rollout_command_v1(
    'wms.transfer.receive','g9-project-a',null,'g9-warehouse-a',null);
  perform app_private.assert_erp_completion_rollout_command_v1(
    'wms.inventory_count.post','g9-project-a',null,'g9-warehouse-a',null);
  perform app_private.assert_erp_completion_rollout_command_v1(
    'finance.invoice.reverse','g9-project-a',null,null,'g9-supplier-a');
end;
$$;

reset role;
select set_config('app.erp_completion_rollout_reason','Expire G9 smoke cohort',true);
update app_private.erp_completion_rollout_scopes
set starts_at=statement_timestamp()-interval '2 hours',
  expires_at=statement_timestamp()-interval '1 hour',row_version=row_version+1,updated_at=now(),
  updated_by='91111111-1111-4111-8111-111111111111'
where id='92222222-2222-4222-8222-222222222222';

set local role authenticated;
do $$
declare v_access jsonb; v_health jsonb;
begin
  v_access := public.get_erp_completion_rollout_access_v1('g9-project-a',null,null,null);
  if v_access->>'mode' <> 'off' then raise exception 'G9_EXPIRED_SCOPE_VISIBLE: %',v_access; end if;
  v_health := public.get_erp_completion_rollout_health_v1();
  if v_health #>> '{externalEvidence,commandLatency}' <> 'external_evidence_required'
     or v_health->'procurementOutbox' is null
     or v_health->'reconciliationIssues' is null then
    raise exception 'G9_HEALTH_EVIDENCE_INVALID: %',v_health;
  end if;
end;
$$;

reset role;
do $$
begin
  begin
    perform app_private.assert_erp_completion_rollout_command_v1(
      'wms.transfer.receive','g9-project-a',null,'g9-warehouse-a',null);
    raise exception 'G9_EXPIRED_COMPLETION_ALLOWED';
  exception when insufficient_privilege then
    if sqlerrm <> 'ERP_COMPLETION_PILOT_COMMAND_DISABLED' then raise; end if;
  end;
  if (select count(*) from app_private.erp_completion_rollout_audit
      where scope_id='92222222-2222-4222-8222-222222222222') <> 4 then
    raise exception 'G9_AUDIT_COUNT_INVALID';
  end if;
  begin
    perform set_config('app.erp_completion_rollout_reason','',true);
    update app_private.erp_completion_rollout_scopes set reason='must fail'
    where id='92222222-2222-4222-8222-222222222222';
    raise exception 'G9_UNAUDITED_CHANGE_ALLOWED';
  exception when invalid_parameter_value then
    if sqlerrm <> 'ERP_COMPLETION_ROLLOUT_REASON_REQUIRED' then raise; end if;
  end;
end;
$$;

rollback;
