alter table app_private.daily_log_wbs_rollout_scopes
  add column release_id text,
  add column owner_user_id uuid references public.users(id);

create table app_private.daily_log_shadow_comparisons (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  daily_log_id text not null references public.daily_logs(id) on delete restrict,
  project_id text not null references public.projects(id) on delete restrict,
  construction_site_id text,
  release_id text not null,
  log_version timestamptz not null,
  decision_fingerprint text not null,
  comparisons jsonb not null,
  mismatch_count integer not null check (mismatch_count >= 0),
  actor_user_id uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index daily_log_shadow_scope_idx on app_private.daily_log_shadow_comparisons(project_id,construction_site_id,release_id,created_at);
alter table app_private.daily_log_shadow_comparisons enable row level security;
revoke all on app_private.daily_log_shadow_comparisons from public,anon,authenticated;

create function app_private.daily_log_shadow_rows_v1(p_daily_log_id text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('taskId',decision.task_id,
    'proposedPercent',decision.official_cumulative_percent,'proposedQuantity',decision.official_cumulative_quantity,
    'proposedDailyQuantity',decision.official_daily_quantity,
    'currentPercent',progress.progress_percent,'currentQuantity',progress.quantity_done,
    'currentDailyQuantity',progress.daily_quantity_done,'currentRowId',progress.id,
    'currentUpdatedAt',progress.updated_at,
    'matches',progress.id is not null
      and decision.official_cumulative_percent is not distinct from progress.progress_percent
      and decision.official_cumulative_quantity is not distinct from progress.quantity_done
      and decision.official_daily_quantity is not distinct from progress.daily_quantity_done
    ) order by decision.task_id),'[]'::jsonb)
  from public.daily_logs log join public.daily_log_wbs_decisions decision on decision.daily_log_id=log.id
  left join public.project_daily_task_progress progress on progress.project_id=log.project_id
    and progress.construction_site_id is not distinct from log.construction_site_id
    and progress.task_id=decision.task_id and progress.progress_date=log.date::date
  where log.id=p_daily_log_id;
$$;
revoke all on function app_private.daily_log_shadow_rows_v1(text) from public,anon,authenticated;

alter function public.get_daily_progress_authority_v1(text,text,date) rename to get_daily_progress_authority_base_v1;
alter function public.get_daily_progress_authority_base_v1(text,text,date) set schema app_private;
revoke all on function app_private.get_daily_progress_authority_base_v1(text,text,date) from public,anon,authenticated;
create function public.get_daily_progress_authority_v1(p_project_id text,p_construction_site_id text,p_progress_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_access jsonb;
begin
  v_access := app_private.get_daily_progress_authority_base_v1(p_project_id,p_construction_site_id,p_progress_date);
  return jsonb_set(v_access,'{authoritative}',to_jsonb(coalesce(v_access->>'mode'='enforced'
    and p_progress_date >= (v_access->>'cutoverDate')::date,false)));
end;
$$;
revoke all on function public.get_daily_progress_authority_v1(text,text,date) from public,anon,authenticated;
grant execute on function public.get_daily_progress_authority_v1(text,text,date) to authenticated;

alter function public.publish_daily_log_summary_v1(text,timestamptz,uuid) rename to publish_daily_log_summary_enforced_v1;
alter function public.publish_daily_log_summary_enforced_v1(text,timestamptz,uuid) set schema app_private;
revoke all on function app_private.publish_daily_log_summary_enforced_v1(text,timestamptz,uuid) from public,anon,authenticated;
create function public.publish_daily_log_summary_v1(p_daily_log_id text,p_expected_updated_at timestamptz,p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_log public.daily_logs%rowtype;
  v_scope app_private.daily_log_wbs_rollout_scopes%rowtype;
  v_shadow app_private.daily_log_shadow_comparisons%rowtype;
  v_rows jsonb;
  v_mismatches integer;
begin
  select * into v_log from public.daily_logs where id=p_daily_log_id for update;
  if not found then raise exception using errcode='P0002',message='DAILY_LOG_NOT_FOUND'; end if;
  if p_command_id is null or public.current_app_user_id() is null
    or not app_private.current_actor_has_effective_room_action(v_log.project_id,v_log.construction_site_id,'daily_log','approve')
    or not app_private.current_actor_has_effective_room_action(v_log.project_id,v_log.construction_site_id,'daily_log','publish_progress') then
    raise exception using errcode='42501',message='DAILY_LOG_APPROVE_AND_PUBLISH_REQUIRED';
  end if;
  select * into v_scope from app_private.daily_log_wbs_rollout_scopes
  where project_id=v_log.project_id and construction_site_id is not distinct from v_log.construction_site_id
  for share;
  if not found or v_scope.mode not in ('pilot','enforced') or v_log.date::date<v_scope.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_WBS_ROLLOUT_DISABLED';
  end if;
  if v_scope.mode='enforced' then
    return app_private.publish_daily_log_summary_enforced_v1(p_daily_log_id,p_expected_updated_at,p_command_id)
      || jsonb_build_object('publishedProgress',true,'mode','enforced');
  end if;
  if nullif(trim(v_scope.release_id),'') is null or v_scope.owner_user_id is null then
    raise exception using errcode='55000',message='DAILY_LOG_PILOT_OPERATION_REQUIRED';
  end if;
  if v_log.summary_source_type is distinct from 'member_contributions' or v_log.status is distinct from 'submitted' then
    raise exception using errcode='42501',message='SUBMITTED_SUMMARY_REQUIRED';
  end if;
  if not app_private.can_act_on_subject_impl('daily_log',p_daily_log_id,'approve') then
    raise exception using errcode='42501',message='DAILY_LOG_APPROVAL_ASSIGNMENT_REQUIRED';
  end if;
  if v_log.last_action_at is distinct from p_expected_updated_at then
    raise exception using errcode='40001',message='ROW_VERSION_CONFLICT';
  end if;
  perform app_private.assert_daily_log_summary_ready_v1(p_daily_log_id,true);
  v_rows := app_private.daily_log_shadow_rows_v1(p_daily_log_id);
  if jsonb_array_length(v_rows)=0 then raise exception using errcode='22023',message='SUMMARY_DECISION_INCOMPLETE'; end if;
  select count(*) into v_mismatches from jsonb_array_elements(v_rows) row where not (row->>'matches')::boolean;
  select * into v_shadow from app_private.daily_log_shadow_comparisons where command_id=p_command_id;
  if found and (v_shadow.daily_log_id<>p_daily_log_id or v_shadow.release_id<>v_scope.release_id
    or v_shadow.log_version is distinct from v_log.last_action_at or v_shadow.comparisons is distinct from v_rows) then
    raise exception using errcode='40001',message='SHADOW_COMMAND_INPUT_CHANGED';
  end if;
  if v_shadow.id is null then
    insert into app_private.daily_log_shadow_comparisons(command_id,daily_log_id,project_id,construction_site_id,
      release_id,log_version,decision_fingerprint,comparisons,mismatch_count,actor_user_id)
    values(p_command_id,p_daily_log_id,v_log.project_id,v_log.construction_site_id,v_scope.release_id,
      v_log.last_action_at,md5(v_rows::text),v_rows,v_mismatches,public.current_app_user_id()) returning * into v_shadow;
  end if;
  return jsonb_build_object('commandId',p_command_id,'dailyLogId',p_daily_log_id,'mode','pilot',
    'publishedProgress',false,'shadowId',v_shadow.id,'mismatchCount',v_shadow.mismatch_count,'comparisons',v_shadow.comparisons);
end;
$$;
revoke all on function public.publish_daily_log_summary_v1(text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.publish_daily_log_summary_v1(text,timestamptz,uuid) to authenticated;

-- Operator-only entry point, not exposed through PostgREST. No production scope is hardcoded.
create function app_private.configure_daily_log_pilot_v1(p_project_id text,p_construction_site_id text,
  p_mode text,p_cutover_date date,p_release_id text,p_owner_user_id uuid,p_reason text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_scope app_private.daily_log_wbs_rollout_scopes%rowtype;
begin
  if p_project_id is null or p_cutover_date is null or p_owner_user_id is null
    or nullif(trim(p_release_id),'') is null or nullif(trim(p_reason),'') is null
    or p_mode not in ('pilot','enforced','paused','off') then
    raise exception using errcode='22023',message='PILOT_CONFIGURATION_REQUIRED';
  end if;
  if not exists(select 1 from public.users where id=p_owner_user_id and is_active and account_status='ACTIVE') then
    raise exception using errcode='22023',message='PILOT_ACTIVE_OWNER_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project_id||':'||coalesce(p_construction_site_id,''),0));
  select * into v_scope from app_private.daily_log_wbs_rollout_scopes
    where project_id=p_project_id and construction_site_id is not distinct from p_construction_site_id for update;
  if p_mode in ('pilot','enforced') and (
    not exists(select 1 from public.project_staff staff where staff.project_id=p_project_id and staff.end_date is null
      and app_private.project_actor_has_effective_room_action(staff.user_id::uuid,p_project_id,p_construction_site_id,'daily_log','verify')
      and app_private.project_actor_has_effective_room_action(staff.user_id::uuid,p_project_id,p_construction_site_id,'daily_log','submit'))
    or not exists(select 1 from public.project_staff staff where staff.project_id=p_project_id and staff.end_date is null
      and app_private.project_actor_has_effective_room_action(staff.user_id::uuid,p_project_id,p_construction_site_id,'daily_log','approve')
      and app_private.project_actor_has_effective_room_action(staff.user_id::uuid,p_project_id,p_construction_site_id,'daily_log','publish_progress'))
  ) then raise exception using errcode='42501',message='PILOT_ROOM_RECIPIENTS_REQUIRED'; end if;
  if p_mode='enforced' then
    if v_scope.id is null or v_scope.mode<>'pilot' or v_scope.release_id is distinct from p_release_id
      or v_scope.cutover_date is distinct from p_cutover_date then
      raise exception using errcode='55000',message='PILOT_SHADOW_GATE_REQUIRED';
    end if;
    if not exists(select 1 from app_private.daily_log_shadow_comparisons s
      where s.project_id=p_project_id and s.construction_site_id is not distinct from p_construction_site_id and s.release_id=p_release_id)
      or exists(
        select 1 from (
          select distinct on (daily_log_id) * from app_private.daily_log_shadow_comparisons
          where project_id=p_project_id and construction_site_id is not distinct from p_construction_site_id and release_id=p_release_id
          order by daily_log_id,created_at desc,id
        ) shadow join public.daily_logs log on log.id=shadow.daily_log_id
        where shadow.mismatch_count<>0 or shadow.log_version is distinct from log.last_action_at
          or shadow.comparisons is distinct from app_private.daily_log_shadow_rows_v1(log.id)
      ) then raise exception using errcode='55000',message='PILOT_SHADOW_UNRESOLVED'; end if;
  end if;
  insert into app_private.daily_log_wbs_rollout_scopes(project_id,construction_site_id,mode,cutover_date,release_id,owner_user_id,reason,created_by)
  values(p_project_id,p_construction_site_id,p_mode,p_cutover_date,trim(p_release_id),p_owner_user_id,trim(p_reason),p_owner_user_id)
  on conflict(project_id,construction_site_id) do update set mode=excluded.mode,cutover_date=excluded.cutover_date,
    release_id=excluded.release_id,owner_user_id=excluded.owner_user_id,reason=excluded.reason,updated_at=clock_timestamp();
  return jsonb_build_object('projectId',p_project_id,'constructionSiteId',p_construction_site_id,'mode',p_mode,'releaseId',p_release_id);
end;
$$;
revoke all on function app_private.configure_daily_log_pilot_v1(text,text,text,date,text,uuid,text) from public,anon,authenticated,service_role;
