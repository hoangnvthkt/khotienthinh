-- Run only on the authorized Cloud test branch, inside an explicit transaction.
-- Set app.resource_evidence_operation to JSON with projectId, constructionSiteId,
-- fromDate, toDate, releaseId, ownerUserId, reason, expiresAt and mode.
-- mode = pilot enables the read-only evidence action; audit_only pauses it.
-- This operation never creates a payment, accrual or project transaction.
do $$
declare
  v_config jsonb := nullif(current_setting('app.resource_evidence_operation', true), '')::jsonb;
  v_project text;
  v_site text;
  v_from date;
  v_to date;
  v_mode text;
  v_owner uuid;
  v_expires timestamptz;
  v_missing int;
  v_duplicate int;
  v_recipients int;
  v_other_scope int;
begin
  if v_config is null or v_config->>'projectId' is null
    or not (v_config ? 'constructionSiteId')
    or v_config->>'fromDate' is null or v_config->>'toDate' is null
    or nullif(trim(v_config->>'releaseId'), '') is null
    or nullif(trim(v_config->>'reason'), '') is null
    or v_config->>'ownerUserId' is null or v_config->>'expiresAt' is null
    or v_config->>'mode' not in ('pilot', 'audit_only') then
    raise exception 'RESOURCE_EVIDENCE_OPERATION_PARAMETERS_REQUIRED';
  end if;
  v_project := v_config->>'projectId';
  v_site := nullif(v_config->>'constructionSiteId', '');
  v_from := (v_config->>'fromDate')::date;
  v_to := (v_config->>'toDate')::date;
  v_mode := v_config->>'mode';
  v_owner := (v_config->>'ownerUserId')::uuid;
  v_expires := (v_config->>'expiresAt')::timestamptz;
  if v_from > v_to or v_to - v_from > 366
    or v_expires <= now() or v_expires > now() + interval '30 days'
    or not exists(select 1 from public.projects where id = v_project)
    or not exists(select 1 from public.users where id = v_owner and is_active) then
    raise exception 'RESOURCE_EVIDENCE_OPERATION_SCOPE_INVALID';
  end if;

  select count(*) into v_missing from (
    select labor.id from public.daily_log_labor labor
    join public.daily_logs log on log.id = labor.daily_log_id
    where log.project_id = v_project and log.construction_site_id is not distinct from v_site
      and log.date between v_from::text and v_to::text and log.status = 'verified'
      and log.summary_source_type = 'member_contributions'
      and labor.resource_semantics_version = 2
      and (labor.summary_source_id is null or labor.daily_log_work_item_id is null
        or labor.provider_entry_mode is null
        or (labor.provider_entry_mode = 'catalog' and (labor.partner_id is null or labor.provider_name_snapshot is null))
        or (labor.provider_entry_mode = 'manual' and (labor.manual_provider_type is null or labor.manual_provider_name is null)))
    union all
    select machine.id from public.daily_log_machines machine
    join public.daily_logs log on log.id = machine.daily_log_id
    where log.project_id = v_project and log.construction_site_id is not distinct from v_site
      and log.date between v_from::text and v_to::text and log.status = 'verified'
      and log.summary_source_type = 'member_contributions'
      and machine.resource_semantics_version = 2
      and (machine.summary_source_id is null or machine.daily_log_work_item_id is null
        or machine.provider_entry_mode is null
        or (machine.provider_entry_mode = 'catalog' and (machine.partner_id is null or machine.provider_name_snapshot is null))
        or (machine.provider_entry_mode = 'manual' and (machine.manual_provider_type is null or machine.manual_provider_name is null)))
  ) invalid_rows;

  select count(*) into v_duplicate from (
    select source_id from (
      select 'labor:' || labor.source_labor_line_id as source_id
      from public.daily_log_labor labor join public.daily_logs log on log.id = labor.daily_log_id
      where log.project_id = v_project and log.construction_site_id is not distinct from v_site
        and log.date between v_from::text and v_to::text and log.status = 'verified'
        and log.superseded_by_daily_log_id is null and labor.resource_semantics_version = 2
      union all
      select 'machine:' || machine.source_machine_line_id
      from public.daily_log_machines machine join public.daily_logs log on log.id = machine.daily_log_id
      where log.project_id = v_project and log.construction_site_id is not distinct from v_site
        and log.date between v_from::text and v_to::text and log.status = 'verified'
        and log.superseded_by_daily_log_id is null and machine.resource_semantics_version = 2
    ) source_rows where source_id is not null
    group by source_id having count(*) > 1
  ) duplicates;

  select count(*) into v_recipients
  from public.project_permission_room_member_actions action
  join public.project_permission_room_members member on member.id = action.room_member_id
  join public.project_staff staff on staff.id = member.project_staff_id
  join public.users actor on actor.id::text = staff.user_id
  where member.project_id = v_project and member.construction_site_id is not distinct from v_site
    and member.room_code = 'payment' and member.is_active
    and action.action_code = 'view_resource_evidence' and action.is_active
    and actor.is_active;
  select count(*) into v_other_scope
  from public.project_permission_room_member_actions action
  join public.project_permission_room_members member on member.id = action.room_member_id
  where member.room_code = 'payment' and action.action_code = 'view_resource_evidence'
    and member.is_active and action.is_active
    and (member.project_id <> v_project
      or member.construction_site_id is distinct from v_site);

  if v_missing <> 0 or v_duplicate <> 0 or v_other_scope <> 0
    or (v_mode = 'pilot' and v_recipients = 0) then
    raise exception 'RESOURCE_EVIDENCE_PREFLIGHT_FAILED: missing %, duplicate %, recipients %, other_scope %',
      v_missing, v_duplicate, v_recipients, v_other_scope;
  end if;
  update app_private.project_permission_room_action_bindings
  set enforcement_status = v_mode, pbac_fallback_enabled = false,
      verified_at = now(), verified_source = 'resource_evidence:' || (v_config->>'releaseId'),
      updated_at = now()
  where room_code = 'payment' and action_code = 'view_resource_evidence';
  if not found then raise exception 'RESOURCE_EVIDENCE_BINDING_MISSING'; end if;
end;
$$;

-- Query-plan sample for the exact configured scope/date. The operator stores
-- the returned JSON in the release evidence; it must not contain user tokens.
explain (analyze, buffers, format json)
select labor.id
from public.daily_log_labor labor
join public.daily_logs log on log.id = labor.daily_log_id
where log.project_id = (current_setting('app.resource_evidence_operation')::jsonb->>'projectId')
  and log.construction_site_id is not distinct from
    nullif((current_setting('app.resource_evidence_operation')::jsonb->>'constructionSiteId'), '')
  and log.date between (current_setting('app.resource_evidence_operation')::jsonb->>'fromDate')
    and (current_setting('app.resource_evidence_operation')::jsonb->>'toDate')
  and log.status = 'verified' and log.summary_source_type = 'member_contributions'
  and log.superseded_by_daily_log_id is null and labor.resource_semantics_version = 2;
