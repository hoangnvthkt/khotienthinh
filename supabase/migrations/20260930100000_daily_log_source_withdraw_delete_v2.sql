-- Daily Log V2 slip withdraw / delete (owner-approved 30/09/2026).
--
-- 1. Withdraw: the author takes back a sent slip (submitted -> draft) while the
--    summarizer has not yet taken this version into a summary. Once a summary
--    holds it, only the summarizer can return it.
-- 2. Delete: the author discards a draft that was never sent and is in no
--    summary. That also frees the area code for the day. Sent slips are kept.
-- Both are checked commands with an idempotent receipt; the receipt is the
-- audit record (a deleted slip keeps its area, date and item count there).

alter table app_private.daily_log_source_command_receipts
  drop constraint daily_log_source_command_receipts_operation_check;
alter table app_private.daily_log_source_command_receipts
  add constraint daily_log_source_command_receipts_operation_check
  check (operation = any (array['create','return','submit','withdraw','delete']));

-- Live definition (30/09) plus the withdraw branch.
create or replace function app_private.daily_log_source_transition_allowed_v2(p_old public.daily_log_contributions,p_new public.daily_log_contributions)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare r app_private.daily_log_source_command_receipts%rowtype; fields text[];
begin
  if current_user is distinct from pg_get_userbyid((select relowner from pg_catalog.pg_class
    where oid='public.daily_log_contributions'::regclass)) then return false; end if;
  if p_old.source_document_version<>2 or p_new.row_version<>p_old.row_version+1 then return false; end if;
  select * into r from app_private.daily_log_source_command_receipts
    where database_transaction_id=pg_current_xact_id() and actor_id=public.current_app_user_id()
      and receipt->>'contributionId'=p_old.id::text and receipt->>'status'=p_new.status
      and (receipt->>'rowVersion')::bigint=p_new.row_version and operation in ('return','submit','withdraw');
  if not found or p_new.last_action_by is distinct from r.actor_id::text then return false; end if;
  fields:=array['status','row_version','last_action_by','last_action_at','updated_at'];
  if r.operation='return' then
    if p_old.status not in ('submitted','included') or p_new.status<>'returned'
      or p_new.returned_by is distinct from r.actor_id::text or nullif(trim(p_new.return_reason),'') is null then return false; end if;
    fields:=fields||array['returned_by','returned_by_name','returned_at','return_reason'];
  elsif r.operation='withdraw' then
    if p_old.status<>'submitted' or p_new.status<>'draft'
      or p_old.author_user_id is distinct from r.actor_id::text then return false; end if;
  else
    if p_old.status not in ('draft','returned') or p_new.status<>'submitted'
      or p_old.author_user_id is distinct from r.actor_id::text then return false; end if;
    fields:=fields||array['submitted_at'];
  end if;
  return (to_jsonb(p_new)-fields)=(to_jsonb(p_old)-fields);
end $$;
revoke all on function app_private.daily_log_source_transition_allowed_v2(public.daily_log_contributions,public.daily_log_contributions) from public,anon;
grant execute on function app_private.daily_log_source_transition_allowed_v2(public.daily_log_contributions,public.daily_log_contributions) to authenticated;

-- A live summary holds exactly this version of the slip.
create function app_private.daily_log_source_in_summary_v2(p_source public.daily_log_contributions)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.daily_log_summary_sources s join public.daily_logs l on l.id=s.daily_log_id
    where s.contribution_id=p_source.id and l.superseded_by_daily_log_id is null
      and s.source_version=p_source.row_version);
$$;
revoke all on function app_private.daily_log_source_in_summary_v2(public.daily_log_contributions) from public,anon,authenticated;

-- What the author may do with the slip now. Mirrors the command checks so the
-- screen only offers actions that will succeed.
create function app_private.daily_log_source_author_actions_v2(p_source public.daily_log_contributions)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=public.current_app_user_id(); rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
  open_period boolean; in_summary boolean;
begin
  if p_source.id is null then return jsonb_build_object('canDeleteSource',false,'canWithdrawSource',false,'sourceInSummary',false); end if;
  in_summary:=app_private.daily_log_source_in_summary_v2(p_source);
  select * into rollout from app_private.daily_log_wbs_rollout_scopes s where s.project_id=p_source.project_id
    and s.construction_site_id is not distinct from p_source.construction_site_id;
  open_period:=rollout.id is not null and rollout.mode in ('pilot','enforced') and p_source.date>=rollout.cutover_date
    and not exists(select 1 from public.project_progress_period_states s where s.project_id=p_source.project_id
      and s.construction_site_id is not distinct from p_source.construction_site_id and s.is_locked
      and ((s.period_type='daily' and s.period_start=p_source.date) or (s.period_type='weekly' and s.period_start=date_trunc('week',p_source.date)::date)));
  return jsonb_build_object(
    'sourceInSummary',in_summary,
    'canDeleteSource',actor is not null and open_period and p_source.source_document_version=2
      and p_source.author_user_id=actor::text and p_source.status='draft' and p_source.submitted_at is null
      and not exists(select 1 from public.daily_log_summary_sources s where s.contribution_id=p_source.id)
      and app_private.current_actor_has_effective_room_action(p_source.project_id,p_source.construction_site_id,'daily_log','edit'),
    'canWithdrawSource',actor is not null and open_period and p_source.source_document_version=2
      and p_source.author_user_id=actor::text and p_source.status='submitted' and not in_summary
      and app_private.current_actor_has_effective_room_action(p_source.project_id,p_source.construction_site_id,'daily_log','submit'));
end $$;
revoke all on function app_private.daily_log_source_author_actions_v2(public.daily_log_contributions) from public,anon,authenticated;

create function app_private.daily_log_source_author_command_impl_v2(p_input jsonb,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.current_app_user_id(); source public.daily_log_contributions%rowtype;
  rollout app_private.daily_log_wbs_rollout_scopes%rowtype; existing app_private.daily_log_source_command_receipts%rowtype;
  v_command_id uuid:=(p_input->>'commandId')::uuid; v_payload_fingerprint text:=md5(p_input::text);
  denied text:=case p_operation when 'withdraw' then 'DAILY_LOG_SOURCE_WITHDRAW_DENIED' else 'DAILY_LOG_SOURCE_DELETE_DENIED' end;
  receipt jsonb; action_at timestamptz:=clock_timestamp(); item_count integer;
begin
  if p_operation not in ('withdraw','delete') then raise exception using errcode='22023',message='DAILY_LOG_SOURCE_OPERATION_INVALID'; end if;
  if actor is null then raise exception using errcode='42501',message=denied; end if;
  if v_command_id is null or p_input->>'expectedRowVersion' is null or p_input->>'contributionId' is null then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_COMMAND_REQUIRED'; end if;
  -- Receipt first: a retried delete must answer after the slip is gone.
  perform pg_advisory_xact_lock(hashtextextended(v_command_id::text,2));
  select * into existing from app_private.daily_log_source_command_receipts r where r.command_id=v_command_id;
  if found then
    if existing.actor_id<>actor or existing.operation<>p_operation or existing.payload_fingerprint<>v_payload_fingerprint then
      raise exception using errcode='22023',message='DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH'; end if;
    return existing.receipt;
  end if;
  select * into source from public.daily_log_contributions where id=(p_input->>'contributionId')::uuid;
  if not found or source.source_document_version<>2 or source.author_user_id is distinct from actor::text
    or not app_private.current_actor_has_effective_room_action(source.project_id,source.construction_site_id,'daily_log',
      case p_operation when 'withdraw' then 'submit' else 'edit' end) then
    raise exception using errcode='42501',message=denied; end if;
  rollout:=app_private.lock_daily_log_rollout_v1(source.project_id,source.construction_site_id);
  if rollout.id is null or rollout.mode not in ('pilot','enforced') or source.date<rollout.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_ROLLOUT_DISABLED'; end if;
  perform app_private.assert_project_progress_scope_period(source.project_id,source.construction_site_id,'daily',source.date);
  if exists(select 1 from public.project_progress_period_states s where s.project_id=source.project_id
    and s.construction_site_id is not distinct from source.construction_site_id and s.is_locked
    and ((s.period_type='daily' and s.period_start=source.date) or (s.period_type='weekly' and s.period_start=date_trunc('week',source.date)::date))) then
    raise exception using errcode='42501',message='PERIOD_LOCKED'; end if;
  -- Same lock order as return: summary cards before the source row.
  perform 1 from public.daily_log_summary_sources s where s.contribution_id=source.id order by s.id for update;
  select * into source from public.daily_log_contributions where id=source.id for update;
  if source.row_version<>(p_input->>'expectedRowVersion')::bigint then raise exception using errcode='PT409',message='ROW_VERSION_CONFLICT'; end if;
  if p_operation='withdraw' then
    if source.status<>'submitted' then raise exception using errcode='PT409',message='SOURCE_CHANGED'; end if;
    if app_private.daily_log_source_in_summary_v2(source) then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_IN_SUMMARY'; end if;
    receipt:=jsonb_build_object('contributionId',source.id,'status','draft','rowVersion',source.row_version+1,
      'updatedAt',action_at,'sourceFingerprint',source.source_fingerprint);
  else
    if source.status<>'draft' or source.submitted_at is not null
      or exists(select 1 from public.daily_log_summary_sources s where s.contribution_id=source.id) then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_DELETE_NOT_DRAFT'; end if;
    select count(*) into item_count from public.daily_log_work_items where contribution_id=source.id;
    receipt:=jsonb_build_object('contributionId',source.id,'deleted',true,'rowVersion',source.row_version,'deletedAt',action_at,
      'date',source.date,'workAreaCode',source.work_area_code,'workAreaName',source.work_area_name,'itemCount',item_count);
  end if;
  insert into app_private.daily_log_source_command_receipts(command_id,actor_id,project_id,construction_site_id,log_date,operation,payload_fingerprint,receipt,database_transaction_id)
    values(v_command_id,actor,source.project_id,source.construction_site_id,source.date,p_operation,v_payload_fingerprint,receipt,pg_current_xact_id());
  if p_operation='withdraw' then
    update public.daily_log_contributions set status='draft',row_version=row_version+1,
      last_action_by=actor::text,last_action_at=action_at,updated_at=now() where id=source.id;
  else
    -- Work items, labor and machine lines cascade.
    delete from public.daily_log_contributions where id=source.id;
  end if;
  return receipt;
end $$;
revoke all on function app_private.daily_log_source_author_command_impl_v2(jsonb,text) from public,anon;
grant execute on function app_private.daily_log_source_author_command_impl_v2(jsonb,text) to authenticated;

create function public.withdraw_daily_log_source_v2(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.daily_log_source_author_command_impl_v2(p_input,'withdraw');
$$;
create function public.delete_daily_log_source_v2(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$
  select app_private.daily_log_source_author_command_impl_v2(p_input,'delete');
$$;
revoke all on function public.withdraw_daily_log_source_v2(jsonb),public.delete_daily_log_source_v2(jsonb) from public,anon;
grant execute on function public.withdraw_daily_log_source_v2(jsonb),public.delete_daily_log_source_v2(jsonb) to authenticated;

-- Live definition (30/09) plus the author's actions on the opened slip.
create or replace function app_private.get_daily_log_document_bundle_impl_v2(p_project_id text, p_construction_site_id text, p_log_date date, p_daily_log_id text, p_contribution_id uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_bundle jsonb; v_contexts jsonb; v_fingerprints jsonb; v_area text; v_source public.daily_log_contributions%rowtype;
begin
  v_bundle:=app_private.get_daily_log_document_selection_impl_v2(p_project_id,p_construction_site_id,p_log_date,p_daily_log_id,p_contribution_id);
  v_area:=v_bundle->'contribution'->>'work_area_code';
  if p_contribution_id is not null and exists(select 1 from public.daily_log_summary_sources s
    join public.daily_logs l on l.id=s.daily_log_id where s.contribution_id=p_contribution_id
      and l.status='verified' and l.superseded_by_daily_log_id is null) then
    v_bundle:=jsonb_set(v_bundle,'{permissions}',v_bundle->'permissions' || jsonb_build_object('canEditSource',false,'canSubmitSource',false));
  end if;
  select * into v_source from public.daily_log_contributions c
    where c.id=app_private.daily_log_uuid(v_bundle->'contribution'->>'id') and c.project_id=p_project_id
      and c.construction_site_id is not distinct from p_construction_site_id;
  v_bundle:=jsonb_set(v_bundle,'{permissions}',coalesce(v_bundle->'permissions','{}'::jsonb)
    || app_private.daily_log_source_author_actions_v2(v_source));
  select coalesce(jsonb_object_agg(t.id,c.context),'{}'::jsonb),coalesce(jsonb_object_agg(t.id,c.context->>'fingerprint'),'{}'::jsonb)
    into v_contexts,v_fingerprints from public.project_tasks t cross join lateral (
      select app_private.daily_log_quantity_context_v2(p_project_id,p_construction_site_id,p_log_date,v_area,t.id) context
    ) c where t.project_id=p_project_id and t.construction_site_id is not distinct from p_construction_site_id;
  return v_bundle || jsonb_build_object('quantityBaselines',v_contexts,'baselineQuantityFingerprints',v_fingerprints);
end $$;

-- Live definition (30/09) plus the withdrawn notice to whoever was told it was sent.
create or replace function app_private.notify_daily_log_source_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status text := case when tg_op = 'UPDATE' then old.status end;
  v_actor uuid := public.current_app_user_id();
  v_date text := to_char(new.date, 'DD/MM/YYYY');
  v_area text := coalesce(nullif(btrim(new.work_area_name), ''), 'chưa đặt tên khu vực');
  v_recipient uuid := app_private.daily_log_uuid(new.submitted_to_user_id);
  v_meta jsonb := jsonb_strip_nulls(jsonb_build_object('projectId', new.project_id,
    'constructionSiteId', new.construction_site_id, 'contributionId', new.id, 'date', new.date));
begin
  if new.status is not distinct from v_old_status then return new; end if;
  if new.status = 'submitted' then
    perform app_private.daily_log_notify(
      case when v_recipient is not null then array[v_recipient]
        else app_private.daily_log_room_recipient_ids(new.project_id, new.construction_site_id, 'verify') end,
      v_actor, case when v_recipient is not null then 'assigned' else 'responsible' end, 'info', 'info',
      case when v_old_status = 'returned' then 'Phiếu nhật ký đã sửa, chờ tổng hợp'
        else 'Phiếu nhật ký mới chờ tổng hợp' end,
      coalesce(nullif(btrim(new.author_name), ''), 'Kỹ sư') || ' gửi phiếu ' || v_area || ' ngày ' || v_date || '.',
      app_private.daily_log_link(new.project_id, new.construction_site_id),
      'dailylog_source_submitted', 'dailylog_source_' || new.id || ':' || new.row_version,
      new.construction_site_id, v_meta);
  elsif new.status = 'returned' then
    perform app_private.daily_log_notify(
      array[app_private.daily_log_uuid(new.author_user_id)], v_actor, 'assigned', 'warning', 'warning',
      'Phiếu nhật ký bị trả, cần sửa',
      'Phiếu ' || v_area || ' ngày ' || v_date || ' bị '
        || coalesce(nullif(btrim(new.returned_by_name), ''), 'người tổng hợp') || ' trả lại'
        || coalesce(': ' || left(nullif(btrim(new.return_reason), ''), 300), '.'),
      app_private.daily_log_link(new.project_id, new.construction_site_id),
      'dailylog_source_returned', 'dailylog_source_' || new.id || ':' || new.row_version,
      new.construction_site_id, v_meta);
  elsif new.status = 'draft' and v_old_status = 'submitted' then
    perform app_private.daily_log_notify(
      case when v_recipient is not null then array[v_recipient]
        else app_private.daily_log_room_recipient_ids(new.project_id, new.construction_site_id, 'verify') end,
      v_actor, case when v_recipient is not null then 'assigned' else 'responsible' end, 'info', 'info',
      'Phiếu nhật ký đã được rút về sửa',
      coalesce(nullif(btrim(new.author_name), ''), 'Kỹ sư') || ' rút phiếu ' || v_area || ' ngày ' || v_date
        || ' về sửa. Chưa cần tổng hợp phiếu này cho tới khi được gửi lại.',
      app_private.daily_log_link(new.project_id, new.construction_site_id),
      'dailylog_source_withdrawn', 'dailylog_source_' || new.id || ':' || new.row_version,
      new.construction_site_id, v_meta);
  end if;
  return new;
end;
$$;
revoke all on function app_private.notify_daily_log_source_change() from public, anon, authenticated;

notify pgrst,'reload schema';
