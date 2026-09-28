create table public.daily_progress_exception_audit (
  id uuid primary key default gen_random_uuid(),
  progress_row_id uuid not null references public.project_daily_task_progress(id) on delete restrict,
  project_id text not null references public.projects(id) on delete restrict,
  construction_site_id text,
  task_id text not null references public.project_tasks(id) on delete restrict,
  progress_date date not null,
  source_daily_log_id text not null references public.daily_logs(id) on delete restrict,
  before_data jsonb not null,
  after_data jsonb not null,
  reason text not null check (nullif(trim(reason), '') is not null),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint daily_progress_exception_audit_payload_check check (
    jsonb_typeof(before_data) = 'object' and jsonb_typeof(after_data) = 'object'
  )
);

create index daily_progress_exception_audit_scope_idx
  on public.daily_progress_exception_audit (project_id, construction_site_id, progress_date, task_id);

alter table public.daily_progress_exception_audit enable row level security;
create policy daily_progress_exception_audit_select
  on public.daily_progress_exception_audit for select to authenticated
  using (app_private.current_actor_has_effective_room_action(
    project_id, construction_site_id, 'weekly_progress', 'view'
  ));
revoke insert, update, delete on public.daily_progress_exception_audit from authenticated;
grant select on public.daily_progress_exception_audit to authenticated;

create function public.get_daily_progress_authority_v1(
  p_project_id text,
  p_construction_site_id text,
  p_progress_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_mode text := 'off';
  v_cutover_date date;
  v_can_edit_exception boolean := false;
begin
  if v_actor_id is null or not app_private.current_actor_has_effective_room_action(
    p_project_id, p_construction_site_id, 'weekly_progress', 'view'
  ) then
    raise exception using errcode = '42501', message = 'WEEKLY_PROGRESS_VIEW_REQUIRED';
  end if;

  select rollout.mode, rollout.cutover_date
  into v_mode, v_cutover_date
  from app_private.daily_log_wbs_rollout_scopes rollout
  where (rollout.project_id is null or rollout.project_id = p_project_id)
    and (
      rollout.construction_site_id is null
      or rollout.construction_site_id = nullif(p_construction_site_id, '')
    )
  order by
    (rollout.project_id is not null) desc,
    (rollout.construction_site_id is not null) desc,
    rollout.updated_at desc
  limit 1;

  v_mode := coalesce(v_mode, 'off');
  v_can_edit_exception := app_private.current_actor_has_effective_room_action(
      p_project_id, p_construction_site_id, 'weekly_progress', 'edit'
    ) and app_private.current_actor_has_effective_room_action(
      p_project_id, p_construction_site_id, 'daily_log', 'publish_progress'
    );

  return jsonb_build_object(
    'mode', v_mode,
    'cutoverDate', v_cutover_date,
    'authoritative', v_mode in ('pilot', 'enforced')
      and v_cutover_date is not null and p_progress_date >= v_cutover_date,
    'canEditException', v_can_edit_exception
  );
end;
$$;

create function public.save_daily_progress_exception_v1(
  p_progress_row_id uuid,
  p_expected_updated_at timestamptz,
  p_progress_percent numeric,
  p_quantity_done numeric,
  p_daily_quantity_done numeric,
  p_note text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_row public.project_daily_task_progress%rowtype;
  v_previous public.project_daily_task_progress%rowtype;
  v_next public.project_daily_task_progress%rowtype;
  v_rollout app_private.daily_log_wbs_rollout_scopes%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_audit_id uuid;
  v_snapshot jsonb;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'DAILY_PROGRESS_EXCEPTION_REASON_REQUIRED';
  end if;
  if p_progress_percent is null or p_progress_percent < 0
    or (p_quantity_done is not null and p_quantity_done < 0)
    or (p_daily_quantity_done is not null and p_daily_quantity_done < 0) then
    raise exception using errcode = '22023', message = 'DAILY_PROGRESS_EXCEPTION_VALUES_INVALID';
  end if;

  select progress.* into v_row
  from public.project_daily_task_progress progress
  where progress.id = p_progress_row_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_PROGRESS_ROW_NOT_FOUND'; end if;
  if v_actor_id is null
    or not app_private.current_actor_has_effective_room_action(
      v_row.project_id, v_row.construction_site_id, 'weekly_progress', 'edit'
    )
    or not app_private.current_actor_has_effective_room_action(
      v_row.project_id, v_row.construction_site_id, 'daily_log', 'publish_progress'
    ) then
    raise exception using errcode = '42501', message = 'DAILY_PROGRESS_EXCEPTION_DUAL_PERMISSION_REQUIRED';
  end if;
  if v_row.source_daily_log_id is null then
    raise exception using errcode = '42501', message = 'DAILY_LOG_PROGRESS_NOT_AUTHORITATIVE';
  end if;
  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT';
  end if;

  select rollout.* into v_rollout
  from app_private.daily_log_wbs_rollout_scopes rollout
  where (rollout.project_id is null or rollout.project_id = v_row.project_id)
    and (
      rollout.construction_site_id is null
      or rollout.construction_site_id = v_row.construction_site_id
    )
  order by
    (rollout.project_id is not null) desc,
    (rollout.construction_site_id is not null) desc,
    rollout.updated_at desc
  limit 1;
  if not found or v_rollout.mode not in ('pilot', 'enforced')
    or v_row.progress_date < v_rollout.cutover_date then
    raise exception using errcode = '42501', message = 'DAILY_LOG_PROGRESS_NOT_AUTHORITATIVE';
  end if;

  perform 1 from public.project_progress_period_states state
  where state.scope_key = v_row.scope_key
    and (
      (state.period_type = 'daily' and state.period_start = v_row.progress_date)
      or (state.period_type = 'weekly' and state.period_start = v_row.week_start)
    )
  for update;
  if exists (
    select 1 from public.project_progress_period_states state
    where state.scope_key = v_row.scope_key and state.is_locked
      and (
        (state.period_type = 'daily' and state.period_start = v_row.progress_date)
        or (state.period_type = 'weekly' and state.period_start = v_row.week_start)
      )
  ) then raise exception using errcode = '55000', message = 'PERIOD_LOCKED'; end if;

  select progress.* into v_previous
  from public.project_daily_task_progress progress
  where progress.scope_key = v_row.scope_key and progress.task_id = v_row.task_id
    and progress.progress_date < v_row.progress_date
  order by progress.progress_date desc, progress.updated_at desc limit 1
  for update;
  select progress.* into v_next
  from public.project_daily_task_progress progress
  where progress.scope_key = v_row.scope_key and progress.task_id = v_row.task_id
    and progress.progress_date > v_row.progress_date
  order by progress.progress_date, progress.updated_at desc limit 1
  for update;
  if v_previous.id is not null and p_progress_percent < v_previous.progress_percent then
    raise exception using errcode = '22023', message = 'PREVIOUS_PROGRESS_CONFLICT';
  end if;
  if v_next.id is not null and p_progress_percent > v_next.progress_percent then
    raise exception using errcode = '22023', message = 'NEXT_PROGRESS_CONFLICT';
  end if;

  v_before := to_jsonb(v_row);
  select jsonb_build_object(
    'constructionProgressPercent', coalesce(snapshot.construction_progress_percent, p_progress_percent),
    'valueProgressPercent', coalesce(snapshot.value_progress_percent, 0),
    'progressMode', coalesce(snapshot.progress_mode, 'daily_log_summary_exception'),
    'suppliedValue', snapshot.supplied_value,
    'contractTotalValue', snapshot.contract_total_value,
    'purchasedValue', coalesce(snapshot.purchased_value, 0),
    'issuedValue', coalesce(snapshot.issued_value, 0),
    'recognizedValue', coalesce(snapshot.recognized_value, 0),
    'ganttPercent', coalesce(snapshot.gantt_percent, p_progress_percent),
    'calculatedAt', clock_timestamp()
  ) into v_snapshot
  from (select 1) seed
  left join lateral (
    select weekly.* from public.weekly_progress_snapshots weekly
    where weekly.scope_key = v_row.scope_key and weekly.week_start = v_row.week_start
    limit 1
  ) snapshot on true;

  perform app_private.write_project_progress_period_payload(
    v_actor_id, v_row.scope_key, v_row.project_id, v_row.construction_site_id,
    'daily', v_row.progress_date,
    jsonb_build_array(jsonb_build_object(
      'taskId', v_row.task_id,
      'progressPercent', p_progress_percent,
      'quantityDone', coalesce(p_quantity_done, 0),
      'dailyQuantityDone', coalesce(p_daily_quantity_done, 0),
      'note', nullif(trim(coalesce(p_note, '')), ''),
      'attachments', v_row.attachments,
      'sourceDailyLogId', v_row.source_daily_log_id
    )),
    v_snapshot
  );

  update public.project_daily_task_progress progress
  set quantity_done = p_quantity_done,
      daily_quantity_done = p_daily_quantity_done
  where progress.id = v_row.id;
  select progress.* into v_row from public.project_daily_task_progress progress where progress.id = v_row.id;
  v_after := to_jsonb(v_row);

  insert into public.daily_progress_exception_audit (
    progress_row_id, project_id, construction_site_id, task_id, progress_date,
    source_daily_log_id, before_data, after_data, reason, actor_user_id
  ) values (
    v_row.id, v_row.project_id, v_row.construction_site_id, v_row.task_id, v_row.progress_date,
    v_row.source_daily_log_id, v_before, v_after, trim(p_reason), v_actor_id
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'auditId', v_audit_id,
    'progressRow', v_after,
    'reason', trim(p_reason)
  );
end;
$$;

revoke all on function public.get_daily_progress_authority_v1(text, text, date)
  from public, anon, authenticated;
revoke all on function public.save_daily_progress_exception_v1(uuid, timestamptz, numeric, numeric, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.get_daily_progress_authority_v1(text, text, date) to authenticated;
grant execute on function public.save_daily_progress_exception_v1(uuid, timestamptz, numeric, numeric, numeric, text, text) to authenticated;
