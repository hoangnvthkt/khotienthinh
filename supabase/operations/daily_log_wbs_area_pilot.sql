-- Operator SQL, not an application RPC. Run inside BEGIN with transaction-local
-- app.daily_log_operation JSON supplied by the caller. Dry-run caller ROLLBACKs;
-- commit only after checking the exact Cloud target and receiving authorization.
-- Required: projectId, constructionSiteId (null is explicit), mode,
-- cutoverDate, releaseId, ownerUserId, reason. No production IDs are embedded.
do $$
declare
  config jsonb := nullif(current_setting('app.daily_log_operation',true),'')::jsonb;
  before_state jsonb;
  after_state jsonb;
  receipt jsonb;
begin
  if config is null or not (config ?& array['projectId','constructionSiteId','mode','cutoverDate','releaseId','ownerUserId','reason'])
    or config->>'mode' is null then
    raise exception using errcode='22023',message='DAILY_LOG_OPERATION_PARAMETERS_REQUIRED';
  end if;
  select to_jsonb(scope) into before_state from app_private.daily_log_wbs_rollout_scopes scope
    where project_id=config->>'projectId' and construction_site_id is not distinct from nullif(config->>'constructionSiteId','');
  receipt := app_private.configure_daily_log_pilot_v1(config->>'projectId',nullif(config->>'constructionSiteId',''),
    config->>'mode',(config->>'cutoverDate')::date,config->>'releaseId',(config->>'ownerUserId')::uuid,config->>'reason');
  select to_jsonb(scope) into after_state from app_private.daily_log_wbs_rollout_scopes scope
    where project_id=config->>'projectId' and construction_site_id is not distinct from nullif(config->>'constructionSiteId','');
  insert into public.permission_audit_events(actor_user_id,event_type,before_grants,after_grants,metadata)
  values((config->>'ownerUserId')::uuid,'daily_log_rollout_changed',jsonb_build_array(before_state),jsonb_build_array(after_state),
    jsonb_build_object('release_id',config->>'releaseId','reason',config->>'reason','operator_role',current_user,'receipt',receipt));
end;
$$;
select project_id,construction_site_id,mode,cutover_date,release_id,owner_user_id,reason,updated_at
from app_private.daily_log_wbs_rollout_scopes
where project_id=current_setting('app.daily_log_operation')::jsonb->>'projectId'
  and construction_site_id is not distinct from nullif(current_setting('app.daily_log_operation')::jsonb->>'constructionSiteId','');
