-- UX commands plus the explicitly approved legacy uniqueness/lookup split.
-- No historical area/quantity inference, no publication/workflow changes.
create table app_private.daily_log_source_command_receipts (
  command_id uuid primary key,
  actor_id uuid not null references public.users(id),
  project_id text not null references public.projects(id),
  construction_site_id text,
  log_date date not null,
  operation text not null check (operation in ('create','return','submit')),
  payload_fingerprint text not null,
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  created_at timestamptz not null default now()
);
alter table app_private.daily_log_source_command_receipts enable row level security;
revoke all on table app_private.daily_log_source_command_receipts from public, anon, authenticated;

-- Existing rows retain the legacy contract; this is a format discriminator,
-- not an inference about their physical resource semantics or work areas.
alter table public.daily_log_contributions
  add column source_document_version smallint not null default 1
  check (source_document_version in (1,2));
drop index public.ux_daily_log_contrib_scope_day_author;
create unique index ux_daily_log_contrib_scope_day_author on public.daily_log_contributions
  (coalesce(project_id,''),coalesce(construction_site_id,''),date,author_user_id)
  where source_document_version = 1;

create function app_private.guard_daily_log_source_document_version_v2() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP='UPDATE' then
    if new.source_document_version is distinct from old.source_document_version then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_DOCUMENT_VERSION_IMMUTABLE';
    end if;
  elsif new.source_document_version=2 then
    -- The checked private command runs as the receipt-table owner. An ordinary
    -- client cannot use a GUC, a claim or an old receipt to mark a new row v2.
    if current_user is distinct from pg_get_userbyid((select c.relowner from pg_catalog.pg_class c
      where c.oid='app_private.daily_log_source_command_receipts'::regclass)) then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_V2_CREATION_COMMAND_REQUIRED';
    end if;
    if not exists(select 1 from app_private.daily_log_source_command_receipts r
      where r.operation='create' and r.receipt->>'contributionId'=new.id::text
        and r.actor_id=public.current_app_user_id() and new.author_user_id=r.actor_id::text
        and r.project_id=new.project_id and r.construction_site_id is not distinct from new.construction_site_id
        and r.log_date=new.date and r.payload_fingerprint=md5(jsonb_build_object(
          'projectId',new.project_id,'constructionSiteId',new.construction_site_id,'date',new.date,
          'workAreaCode',new.work_area_code,'workAreaName',new.work_area_name)::text)) then
      raise exception using errcode='42501',message='DAILY_LOG_SOURCE_V2_CREATION_COMMAND_REQUIRED';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.guard_daily_log_source_document_version_v2() from public, anon, authenticated;
create trigger guard_daily_log_source_document_version_v2 before insert or update on public.daily_log_contributions
  for each row execute function app_private.guard_daily_log_source_document_version_v2();

create function app_private.create_daily_log_source_impl_v2(
  p_command_id uuid, p_project_id text, p_construction_site_id text,
  p_log_date date, p_work_area_code text, p_work_area_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_existing app_private.daily_log_source_command_receipts%rowtype;
  v_fingerprint text;
  v_source public.daily_log_contributions%rowtype;
  v_area text := upper(trim(p_work_area_code));
  v_name text := trim(p_work_area_name);
  v_author_name text;
  v_rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
  v_receipt jsonb;
  v_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not app_private.current_actor_has_effective_room_action(
    p_project_id,p_construction_site_id,'daily_log','edit') then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_CREATE_DENIED';
  end if;
  if p_command_id is null or p_log_date is null or nullif(trim(p_project_id),'') is null then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_SCOPE_REQUIRED';
  end if;
  if nullif(v_area,'') is null or nullif(v_name,'') is null then
    raise exception using errcode='22023',message='DAILY_LOG_SOURCE_AREA_REQUIRED';
  end if;
  -- Project-wide grants do not validate that an arbitrary site belongs to it.
  begin
    perform app_private.assert_project_progress_scope_period(p_project_id,p_construction_site_id,'daily',p_log_date);
  exception when check_violation then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_SCOPE_DENIED';
  end;
  v_fingerprint := md5(jsonb_build_object('projectId',p_project_id,'constructionSiteId',p_construction_site_id,
    'date',p_log_date,'workAreaCode',v_area,'workAreaName',v_name)::text);
  -- Receipt first, then rollout/scope/area locks. All v2 commands use this namespace.
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,2));
  select * into v_existing from app_private.daily_log_source_command_receipts where command_id=p_command_id;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.operation<>'create'
      or v_existing.payload_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='DAILY_LOG_SOURCE_COMMAND_REUSE_MISMATCH';
    end if;
    return v_existing.receipt;
  end if;
  v_rollout := app_private.lock_daily_log_rollout_v1(p_project_id,p_construction_site_id);
  if v_rollout.id is null or v_rollout.mode not in ('pilot','enforced') or p_log_date<v_rollout.cutover_date then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_ROLLOUT_DISABLED';
  end if;
  if exists(select 1 from public.project_progress_period_states s where s.project_id=p_project_id
    and s.construction_site_id is not distinct from p_construction_site_id and s.is_locked
    and ((s.period_type='daily' and s.period_start=p_log_date)
      or (s.period_type='weekly' and s.period_start=date_trunc('week',p_log_date)::date))) then
    raise exception using errcode='42501',message='PERIOD_LOCKED';
  end if;
  -- No uniqueness constraint or backfill on historical area rows.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
    p_project_id,p_construction_site_id,v_actor,p_log_date,v_area)::text,3));
  select * into v_source from public.daily_log_contributions c where c.project_id=p_project_id
    and c.construction_site_id is not distinct from p_construction_site_id and c.date=p_log_date
    and c.author_user_id=v_actor::text and upper(trim(c.work_area_code))=v_area
    order by c.created_at,c.id limit 1;
  if found then
    raise exception using errcode='23505',message='DAILY_LOG_SOURCE_AREA_EXISTS',
      detail=jsonb_build_object('contributionId',v_source.id)::text;
  end if;
  select name into v_author_name from public.users where id=v_actor;
  v_receipt := jsonb_build_object('contributionId',v_id,'rowVersion',1,'updatedAt',v_now);
  insert into app_private.daily_log_source_command_receipts(command_id,actor_id,project_id,construction_site_id,
    log_date,operation,payload_fingerprint,receipt)
  values(p_command_id,v_actor,p_project_id,p_construction_site_id,p_log_date,'create',v_fingerprint,v_receipt);
  insert into public.daily_log_contributions(id,project_id,construction_site_id,date,author_user_id,author_name,
    work_area_code,work_area_name,content,status,last_action_by,last_action_at,created_at,updated_at,source_document_version)
  values(v_id,p_project_id,p_construction_site_id,p_log_date,v_actor::text,v_author_name,
    v_area,v_name,'','draft',v_actor::text,v_now,v_now,v_now,2) returning * into v_source;
  return v_receipt;
end $$;
revoke all on function app_private.create_daily_log_source_impl_v2(uuid,text,text,date,text,text) from public, anon;
grant execute on function app_private.create_daily_log_source_impl_v2(uuid,text,text,date,text,text) to authenticated;
create function public.create_daily_log_source_v2(p_command_id uuid,p_project_id text,p_construction_site_id text,
  p_log_date date,p_work_area_code text,p_work_area_name text) returns jsonb
language sql security invoker set search_path = '' as $$
  select app_private.create_daily_log_source_impl_v2(p_command_id,p_project_id,p_construction_site_id,p_log_date,p_work_area_code,p_work_area_name);
$$;
revoke all on function public.create_daily_log_source_v2(uuid,text,text,date,text,text) from public, anon;
grant execute on function public.create_daily_log_source_v2(uuid,text,text,date,text,text) to authenticated;

create function app_private.get_daily_log_document_bundle_impl_v2(
  p_project_id text,p_construction_site_id text,p_log_date date,p_daily_log_id text,p_contribution_id uuid
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_bundle jsonb;
  v_selected public.daily_log_contributions%rowtype;
  v_ids uuid[];
  v_baselines jsonb;
  v_locked boolean;
  v_enabled boolean;
  v_permissions jsonb;
begin
  if v_actor is null or not (app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','view')
    or app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','edit')
    or app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','verify')
    or app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','approve')) then
    raise exception using errcode='42501',message='DAILY_LOG_WBS_BUNDLE_ACCESS_DENIED';
  end if;
  if p_contribution_id is not null then
    select * into v_selected from public.daily_log_contributions c where c.id=p_contribution_id
      and c.project_id=p_project_id and c.construction_site_id is not distinct from p_construction_site_id
      and c.date=p_log_date and c.author_user_id=v_actor::text;
    if not found then raise exception using errcode='42501',message='DAILY_LOG_SOURCE_SELECTION_DENIED'; end if;
  end if;
  begin
    perform app_private.assert_project_progress_scope_period(p_project_id,p_construction_site_id,'daily',p_log_date);
  exception when check_violation then
    raise exception using errcode='42501',message='DAILY_LOG_SOURCE_SCOPE_DENIED';
  end;
  if p_daily_log_id is not null and not exists(select 1 from public.daily_logs l where l.id=p_daily_log_id
    and l.project_id=p_project_id and l.construction_site_id is not distinct from p_construction_site_id
    and l.date=p_log_date::text and l.summary_source_type='member_contributions') then
    raise exception using errcode='42501',message='DAILY_LOG_SUMMARY_SELECTION_DENIED';
  end if;
  -- Reuse the physical-only V1 data projection, but never its latest-source selection
  -- or its unfiltered draft resources. No modification to any V1 command.
  v_bundle := public.get_daily_log_wbs_bundle_v1(p_project_id,p_construction_site_id,p_log_date,p_daily_log_id);
  select coalesce(array_agg(c.id),'{}'::uuid[]) into v_ids from public.daily_log_contributions c
    where c.project_id=p_project_id and c.construction_site_id is not distinct from p_construction_site_id
      and c.date=p_log_date and (c.id=p_contribution_id or (p_contribution_id is null and c.status in ('submitted','included','returned')));
  v_bundle := v_bundle || jsonb_build_object(
    'contribution',case when p_contribution_id is null then 'null'::jsonb else to_jsonb(v_selected) end,
    'myContributions',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.daily_log_contributions c
      where c.project_id=p_project_id and c.construction_site_id is not distinct from p_construction_site_id
        and c.date=p_log_date and c.author_user_id=v_actor::text),'[]'::jsonb),
    'contributionsForSummary',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.daily_log_contributions c
      where c.id=any(v_ids) and c.status in ('submitted','included','returned')),'[]'::jsonb)
  );
  v_bundle := jsonb_set(v_bundle,'{workItems}',coalesce((select jsonb_agg(item) from jsonb_array_elements(v_bundle->'workItems') item
    where (item->>'contribution_id')::uuid=any(v_ids) or item->>'daily_log_id'=v_bundle->'summaryLog'->>'id'),'[]'::jsonb));
  v_bundle := jsonb_set(v_bundle,'{labor}',coalesce((select jsonb_agg(line) from jsonb_array_elements(v_bundle->'labor') line
    where (line->>'contribution_id')::uuid=any(v_ids) or line->>'daily_log_id'=v_bundle->'summaryLog'->>'id'),'[]'::jsonb));
  v_bundle := jsonb_set(v_bundle,'{machines}',coalesce((select jsonb_agg(line) from jsonb_array_elements(v_bundle->'machines') line
    where (line->>'contribution_id')::uuid=any(v_ids) or line->>'daily_log_id'=v_bundle->'summaryLog'->>'id'),'[]'::jsonb));
  select coalesce(jsonb_object_agg(t.id,case when prior.id is null then 'none'
    when prior.quantity_done is null then 'unknown' else 'known' end),'{}'::jsonb) into v_baselines
  from public.project_tasks t left join lateral (
    select p.id,p.quantity_done from public.project_daily_task_progress p where p.task_id=t.id
      and p.project_id=p_project_id and p.construction_site_id is not distinct from p_construction_site_id
      and p.progress_date<p_log_date order by p.progress_date desc,p.updated_at desc limit 1
  ) prior on true where t.project_id=p_project_id and t.construction_site_id is not distinct from p_construction_site_id;
  v_locked := coalesce((v_bundle->'periodState'->>'is_locked')::boolean,false);
  v_enabled := coalesce((v_bundle->'rollout'->>'enabled')::boolean,false);
  v_permissions := v_bundle->'permissions' || jsonb_build_object(
    'canCreateSource',v_enabled and not v_locked and app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','edit'),
    'canEditSource',p_contribution_id is not null and v_selected.status in ('draft','returned') and v_enabled and not v_locked
      and app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','edit'),
    'canSubmitSource',p_contribution_id is not null and v_selected.status in ('draft','returned') and v_enabled and not v_locked
      and app_private.current_actor_has_effective_room_action(p_project_id,p_construction_site_id,'daily_log','submit')
  );
  return v_bundle || jsonb_build_object('baselineQuantityStates',v_baselines,'permissions',v_permissions);
end $$;
revoke all on function app_private.get_daily_log_document_bundle_impl_v2(text,text,date,text,uuid) from public, anon;
grant execute on function app_private.get_daily_log_document_bundle_impl_v2(text,text,date,text,uuid) to authenticated;
create function public.get_daily_log_document_bundle_v2(p_project_id text,p_construction_site_id text,p_log_date date,
  p_daily_log_id text default null,p_contribution_id uuid default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select app_private.get_daily_log_document_bundle_impl_v2(p_project_id,p_construction_site_id,p_log_date,p_daily_log_id,p_contribution_id);
$$;
revoke all on function public.get_daily_log_document_bundle_v2(text,text,date,text,uuid) from public, anon;
grant execute on function public.get_daily_log_document_bundle_v2(text,text,date,text,uuid) to authenticated;
