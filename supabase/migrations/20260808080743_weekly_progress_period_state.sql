-- Authoritative daily/weekly progress period state and Room pilot.
-- Direct Data API writes are removed; authenticated clients use the public
-- SECURITY INVOKER wrappers backed by app_private SECURITY DEFINER routines.

-- Retire only obsolete Room assignments/bindings. Legacy PBAC definitions and
-- grants remain unchanged as a temporary, exact-code compatibility fallback.
delete from public.project_permission_room_member_actions action
using public.project_permission_room_members member
where action.room_member_id = member.id
  and member.room_code = 'weekly_progress'
  and action.action_code in ('submit', 'verify', 'approve');

delete from app_private.project_permission_room_action_bindings
where room_code = 'weekly_progress'
  and action_code in ('submit', 'verify', 'approve');

update public.project_permission_rooms
set description = 'Nhập liệu và chốt/mở chốt tiến độ ngày hoặc tuần.',
    allowed_actions = array['view', 'edit', 'confirm']::text[],
    required_actions = '{}'::text[],
    updated_at = now()
where code = 'weekly_progress';

insert into app_private.project_permission_room_action_bindings (
  room_code,
  action_code,
  legacy_permission_codes,
  enforcement_status,
  relationship_description,
  verified_at,
  verified_source,
  updated_at,
  pbac_fallback_enabled,
  prerequisite_action_codes
)
values
  (
    'weekly_progress', 'view', array['project.weekly_progress.view']::text[], 'pilot',
    'Xem tiến độ và trạng thái kỳ trong đúng project/site.',
    now(), 'weekly_progress_period_state_2026_08_08', now(), true, '{}'::text[]
  ),
  (
    'weekly_progress', 'edit',
    array['project.weekly_progress.create', 'project.weekly_progress.edit_all']::text[], 'pilot',
    'Nhập tiến độ ngày/tuần khi kỳ tương ứng đang mở.',
    now(), 'weekly_progress_period_state_2026_08_08', now(), true, array['view']::text[]
  ),
  (
    'weekly_progress', 'confirm', array['project.weekly_progress.lock']::text[], 'pilot',
    'Chốt hoặc mở chốt kỳ tiến độ ngày/tuần.',
    now(), 'weekly_progress_period_state_2026_08_08', now(), true, array['view']::text[]
  )
on conflict (room_code, action_code) do update
set legacy_permission_codes = excluded.legacy_permission_codes,
    enforcement_status = excluded.enforcement_status,
    relationship_description = excluded.relationship_description,
    verified_at = excluded.verified_at,
    verified_source = excluded.verified_source,
    updated_at = excluded.updated_at,
    pbac_fallback_enabled = excluded.pbac_fallback_enabled,
    prerequisite_action_codes = excluded.prerequisite_action_codes;

create table public.project_progress_period_states (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  project_id text not null references public.projects(id) on delete cascade,
  construction_site_id text,
  period_type text not null,
  period_start date not null,
  is_locked boolean not null default false,
  locked_by uuid references public.users(id),
  locked_at timestamptz,
  unlocked_by uuid references public.users(id),
  unlocked_at timestamptz,
  unlock_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_progress_period_states_period_type_check
    check (period_type in ('daily', 'weekly')),
  constraint project_progress_period_states_week_start_check
    check (period_type <> 'weekly' or extract(isodow from period_start) = 1),
  constraint project_progress_period_states_scope_key_check
    check (
      (construction_site_id is null or nullif(btrim(construction_site_id), '') is not null)
      and scope_key = project_id || case
        when construction_site_id is null then ''
        else '_' || construction_site_id
      end
    ),
  constraint project_progress_period_states_transition_check
    check (
      (
        is_locked
        and locked_by is not null
        and locked_at is not null
        and unlocked_by is null
        and unlocked_at is null
        and unlock_reason is null
      )
      or (
        not is_locked
        and locked_by is null
        and locked_at is null
        and unlocked_by is null
        and unlocked_at is null
        and unlock_reason is null
      )
      or (
        not is_locked
        and locked_by is not null
        and locked_at is not null
        and unlocked_by is not null
        and unlocked_at is not null
        and nullif(btrim(unlock_reason), '') is not null
      )
    ),
  constraint project_progress_period_states_scope_period_unique
    unique (scope_key, period_type, period_start)
);

create index project_progress_period_states_project_period_idx
  on public.project_progress_period_states (
    project_id, construction_site_id, period_type, period_start desc
  );

alter table public.project_progress_period_states enable row level security;

alter table public.project_opening_balances
  add column if not exists progress_snapshot_status text not null default 'pending',
  add column if not exists progress_snapshot_payload jsonb,
  add column if not exists progress_snapshot_refreshed_at timestamptz;

alter table public.project_opening_balances
  drop constraint if exists project_opening_balances_progress_snapshot_status_check;
alter table public.project_opening_balances
  add constraint project_opening_balances_progress_snapshot_status_check
  check (progress_snapshot_status in ('pending', 'synced'));

create or replace function app_private.project_progress_scope_key(
  p_project_id text,
  p_construction_site_id text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select nullif(btrim(p_project_id), '') || case
    when nullif(btrim(coalesce(p_construction_site_id, '')), '') is null then ''
    else '_' || btrim(p_construction_site_id)
  end;
$$;

create or replace function app_private.assert_project_progress_scope_period(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
begin
  if nullif(btrim(coalesce(p_project_id, '')), '') is null then
    raise exception 'projectId is required' using errcode = '23514';
  end if;

  if p_project_id <> btrim(p_project_id) then
    raise exception 'projectId must not contain surrounding whitespace'
      using errcode = '23514';
  end if;

  select project_row.* into v_project
  from public.projects project_row
  where project_row.id = btrim(p_project_id);

  if not found then
    raise exception 'Project scope does not exist: %', p_project_id using errcode = '23514';
  end if;

  if v_site_id is not null then
    if not exists (
      select 1
      from public.hrm_construction_sites site
      where site.id::text = v_site_id
    ) then
      raise exception 'Construction site scope does not exist: %', v_site_id
        using errcode = '23514';
    end if;

    if v_project.construction_site_id is null
      or v_project.construction_site_id::text <> v_site_id then
      raise exception 'Construction site does not belong to project scope'
        using errcode = '23514';
    end if;
  end if;

  if p_period_type is null or p_period_type not in ('daily', 'weekly') then
    raise exception 'periodType must be daily or weekly' using errcode = '23514';
  end if;

  if p_period_start is null then
    raise exception 'periodStart is required' using errcode = '23514';
  end if;

  if p_period_type = 'weekly' and extract(isodow from p_period_start) <> 1 then
    raise exception 'weekly periodStart must be a Monday' using errcode = '23514';
  end if;

  return app_private.project_progress_scope_key(v_project.id, v_site_id);
end;
$$;

create or replace function app_private.assert_project_progress_action(
  p_actor_id uuid,
  p_project_id text,
  p_construction_site_id text,
  p_action_code text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;

  if p_action_code not in ('view', 'edit', 'confirm') then
    raise exception 'Unsupported weekly_progress Room action: %', p_action_code
      using errcode = '22023';
  end if;

  if not app_private.project_actor_has_effective_room_action(
    p_actor_id,
    p_project_id,
    nullif(p_construction_site_id, ''),
    'weekly_progress',
    p_action_code
  ) or (
    p_action_code <> 'view'
    and not app_private.project_actor_has_effective_room_action(
      p_actor_id,
      p_project_id,
      nullif(p_construction_site_id, ''),
      'weekly_progress',
      'view'
    )
  ) then
    if p_action_code = 'edit' then
      raise exception 'Bạn không có quyền Sửa/Nhập liệu tiến độ.' using errcode = '42501';
    elsif p_action_code = 'confirm' then
      raise exception 'Bạn không có quyền Chốt/Mở chốt kỳ tiến độ.' using errcode = '42501';
    else
      raise exception 'Bạn không có quyền Xem tiến độ.' using errcode = '42501';
    end if;
  end if;
end;
$$;

create or replace function app_private.project_progress_period_state_json(
  p_state public.project_progress_period_states
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_state.id,
    'scopeKey', p_state.scope_key,
    'projectId', p_state.project_id,
    'constructionSiteId', p_state.construction_site_id,
    'periodType', p_state.period_type,
    'periodStart', p_state.period_start,
    'isLocked', p_state.is_locked,
    'lockedBy', p_state.locked_by,
    'lockedAt', p_state.locked_at,
    'unlockedBy', p_state.unlocked_by,
    'unlockedAt', p_state.unlocked_at,
    'unlockReason', p_state.unlock_reason,
    'createdAt', p_state.created_at,
    'updatedAt', p_state.updated_at
  );
$$;

create or replace function app_private.assert_project_progress_rows(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_rows jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_site_id text := nullif(p_construction_site_id, '');
  v_row jsonb;
  v_task_id text;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
    or jsonb_array_length(p_rows) = 0 then
    raise exception 'rows must be a non-empty JSON array' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'every progress row must be a JSON object' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) item(value)
    cross join lateral jsonb_object_keys(item.value) item_key(key)
    where not (
      item_key.key = any(case when p_period_type = 'daily'
        then array[
          'taskId', 'progressPercent', 'quantityDone', 'dailyQuantityDone',
          'note', 'attachments', 'sourceDailyLogId'
        ]::text[]
        else array[
          'taskId', 'progressPercent', 'quantityDone', 'note', 'attachments'
        ]::text[]
      end)
    )
  ) then
    raise exception 'progress row contains an unsupported field for periodType %', p_period_type
      using errcode = '23514';
  end if;

  if exists (
    select item.value ->> 'taskId'
    from jsonb_array_elements(p_rows) item(value)
    group by item.value ->> 'taskId'
    having count(*) > 1
  ) then
    raise exception 'rows must contain each taskId at most once' using errcode = '23514';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_task_id := nullif(btrim(coalesce(v_row ->> 'taskId', '')), '');
    if v_task_id is null or jsonb_typeof(v_row -> 'taskId') <> 'string' then
      raise exception 'every progress row requires a string taskId' using errcode = '23514';
    end if;

    if not (v_row ? 'progressPercent')
      or jsonb_typeof(v_row -> 'progressPercent') <> 'number'
      or (v_row ->> 'progressPercent')::numeric < 0 then
      raise exception 'progressPercent must be a non-negative number for task %', v_task_id
        using errcode = '23514';
    end if;

    if v_row ? 'quantityDone' and (
      jsonb_typeof(v_row -> 'quantityDone') <> 'number'
      or (v_row ->> 'quantityDone')::numeric < 0
    ) then
      raise exception 'quantityDone must be a non-negative number for task %', v_task_id
        using errcode = '23514';
    end if;

    if v_row ? 'dailyQuantityDone'
      and jsonb_typeof(v_row -> 'dailyQuantityDone') <> 'number' then
      raise exception 'dailyQuantityDone must be numeric for task %', v_task_id
        using errcode = '23514';
    end if;

    if v_row ? 'attachments'
      and jsonb_typeof(v_row -> 'attachments') <> 'array' then
      raise exception 'attachments must be a JSON array for task %', v_task_id
        using errcode = '23514';
    end if;

    if v_row ? 'note'
      and jsonb_typeof(v_row -> 'note') not in ('string', 'null') then
      raise exception 'note must be a string or null for task %', v_task_id
        using errcode = '23514';
    end if;

    if v_row ? 'sourceDailyLogId'
      and jsonb_typeof(v_row -> 'sourceDailyLogId') not in ('string', 'null') then
      raise exception 'sourceDailyLogId must be a string or null for task %', v_task_id
        using errcode = '23514';
    end if;

    if not exists (
      select 1
      from public.project_tasks task
      where task.id = v_task_id
        and task.project_id is not distinct from p_project_id
        and nullif(task.construction_site_id::text, '') is not distinct from v_site_id
    ) then
      raise exception 'Task % does not belong to the requested project/site scope', v_task_id
        using errcode = '23514';
    end if;

    if exists (
      select 1
      from public.project_tasks child
      where child.parent_id = v_task_id
    ) then
      raise exception 'Only leaf tasks may be submitted; task % is derived from children', v_task_id
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function app_private.assert_project_progress_snapshot(
  p_snapshot jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if jsonb_typeof(coalesce(p_snapshot, 'null'::jsonb)) <> 'object' then
    raise exception 'snapshot must be a JSON object' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_snapshot) item(key)
    where not (item.key = any(array[
      'constructionProgressPercent', 'valueProgressPercent', 'progressMode',
      'suppliedValue', 'contractTotalValue', 'purchasedValue', 'issuedValue',
      'recognizedValue', 'ganttPercent', 'calculatedAt'
    ]::text[]))
  ) then
    raise exception 'snapshot contains an unsupported field' using errcode = '23514';
  end if;

  if not (p_snapshot ? 'constructionProgressPercent')
    or jsonb_typeof(p_snapshot -> 'constructionProgressPercent') <> 'number'
    or (p_snapshot ->> 'constructionProgressPercent')::numeric < 0 then
    raise exception 'snapshot.constructionProgressPercent must be a non-negative number'
      using errcode = '23514';
  end if;

  if not (p_snapshot ? 'valueProgressPercent')
    or jsonb_typeof(p_snapshot -> 'valueProgressPercent') <> 'number'
    or (p_snapshot ->> 'valueProgressPercent')::numeric < 0 then
    raise exception 'snapshot.valueProgressPercent must be a non-negative number'
      using errcode = '23514';
  end if;

  if nullif(btrim(coalesce(p_snapshot ->> 'progressMode', '')), '') is null
    or jsonb_typeof(p_snapshot -> 'progressMode') <> 'string' then
    raise exception 'snapshot.progressMode is required' using errcode = '23514';
  end if;

  foreach v_key in array array[
    'suppliedValue', 'contractTotalValue', 'purchasedValue', 'issuedValue',
    'recognizedValue', 'ganttPercent'
  ]::text[] loop
    if p_snapshot ? v_key and (
      jsonb_typeof(p_snapshot -> v_key) not in ('number', 'null')
      or (
        jsonb_typeof(p_snapshot -> v_key) = 'number'
        and (p_snapshot ->> v_key)::numeric < 0
      )
    ) then
      raise exception 'snapshot.% must be a non-negative number or null', v_key
        using errcode = '23514';
    end if;
  end loop;

  if p_snapshot ? 'calculatedAt'
    and jsonb_typeof(p_snapshot -> 'calculatedAt') not in ('string', 'null') then
    raise exception 'snapshot.calculatedAt must be an ISO timestamp string or null'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function app_private.upsert_project_progress_snapshot(
  p_scope_key text,
  p_project_id text,
  p_construction_site_id text,
  p_week_start date,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_snapshot public.weekly_progress_snapshots%rowtype;
begin
  perform app_private.assert_project_progress_snapshot(p_snapshot);

  insert into public.weekly_progress_snapshots (
    scope_key,
    project_id,
    construction_site_id,
    week_label,
    week_start,
    progress_percent,
    progress_mode,
    supplied_value,
    contract_total_value,
    gantt_percent,
    construction_progress_percent,
    value_progress_percent,
    purchased_value,
    issued_value,
    recognized_value,
    calculated_at,
    updated_at
  ) values (
    p_scope_key,
    p_project_id,
    nullif(p_construction_site_id, ''),
    'W' || to_char(p_week_start, 'IW') || '/' || to_char(p_week_start, 'IYYY'),
    p_week_start,
    (p_snapshot ->> 'constructionProgressPercent')::numeric,
    btrim(p_snapshot ->> 'progressMode'),
    nullif(p_snapshot ->> 'suppliedValue', '')::numeric,
    nullif(p_snapshot ->> 'contractTotalValue', '')::numeric,
    nullif(p_snapshot ->> 'ganttPercent', '')::numeric,
    (p_snapshot ->> 'constructionProgressPercent')::numeric,
    (p_snapshot ->> 'valueProgressPercent')::numeric,
    coalesce(nullif(p_snapshot ->> 'purchasedValue', '')::numeric, 0),
    coalesce(nullif(p_snapshot ->> 'issuedValue', '')::numeric, 0),
    coalesce(nullif(p_snapshot ->> 'recognizedValue', '')::numeric, 0),
    coalesce(nullif(p_snapshot ->> 'calculatedAt', '')::timestamptz, now()),
    now()
  )
  on conflict (scope_key, week_start) do update
  set project_id = excluded.project_id,
      construction_site_id = excluded.construction_site_id,
      week_label = excluded.week_label,
      progress_percent = excluded.progress_percent,
      progress_mode = excluded.progress_mode,
      supplied_value = excluded.supplied_value,
      contract_total_value = excluded.contract_total_value,
      gantt_percent = excluded.gantt_percent,
      construction_progress_percent = excluded.construction_progress_percent,
      value_progress_percent = excluded.value_progress_percent,
      purchased_value = excluded.purchased_value,
      issued_value = excluded.issued_value,
      recognized_value = excluded.recognized_value,
      calculated_at = excluded.calculated_at,
      updated_at = now()
  returning * into v_snapshot;

  return jsonb_build_object(
    'id', v_snapshot.id,
    'scopeKey', v_snapshot.scope_key,
    'projectId', v_snapshot.project_id,
    'constructionSiteId', v_snapshot.construction_site_id,
    'weekLabel', v_snapshot.week_label,
    'weekStart', v_snapshot.week_start,
    'progressPercent', v_snapshot.progress_percent,
    'constructionProgressPercent', v_snapshot.construction_progress_percent,
    'valueProgressPercent', v_snapshot.value_progress_percent,
    'progressMode', v_snapshot.progress_mode,
    'suppliedValue', v_snapshot.supplied_value,
    'contractTotalValue', v_snapshot.contract_total_value,
    'purchasedValue', v_snapshot.purchased_value,
    'issuedValue', v_snapshot.issued_value,
    'recognizedValue', v_snapshot.recognized_value,
    'ganttPercent', v_snapshot.gantt_percent,
    'calculatedAt', v_snapshot.calculated_at,
    'createdAt', v_snapshot.created_at,
    'updatedAt', v_snapshot.updated_at
  );
end;
$$;

create or replace function app_private.write_project_progress_period_payload(
  p_actor_id uuid,
  p_scope_key text,
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_rows jsonb,
  p_snapshot jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site_id text := nullif(p_construction_site_id, '');
  v_week_start date := case
    when p_period_type = 'weekly' then p_period_start
    else p_period_start - (extract(isodow from p_period_start)::integer - 1)
  end;
  v_week_state public.project_progress_period_states%rowtype;
  v_weekly_frozen boolean := false;
  v_parent_depth integer := 0;
  v_max_parent_depth integer := 0;
begin
  perform app_private.assert_project_progress_rows(
    p_project_id, v_site_id, p_period_type, p_rows
  );
  perform app_private.assert_project_progress_snapshot(p_snapshot);

  if p_period_type = 'daily' then
    insert into public.project_progress_period_states (
      scope_key, project_id, construction_site_id, period_type, period_start
    ) values (
      p_scope_key, p_project_id, v_site_id, 'weekly', v_week_start
    ) on conflict (scope_key, period_type, period_start) do nothing;

    select state.* into v_week_state
    from public.project_progress_period_states state
    where state.scope_key = p_scope_key
      and state.period_type = 'weekly'
      and state.period_start = v_week_start
    for update;

    v_weekly_frozen := v_week_state.is_locked;

    insert into public.project_daily_task_progress (
      scope_key, project_id, construction_site_id, task_id,
      progress_date, week_start, progress_percent, quantity_done,
      daily_quantity_done, note, attachments, source_daily_log_id,
      updated_by, updated_at
    )
    select
      p_scope_key,
      p_project_id,
      v_site_id,
      item.value ->> 'taskId',
      p_period_start,
      v_week_start,
      (item.value ->> 'progressPercent')::numeric,
      coalesce(nullif(item.value ->> 'quantityDone', '')::numeric, 0),
      coalesce(nullif(item.value ->> 'dailyQuantityDone', '')::numeric, 0),
      nullif(btrim(item.value ->> 'note'), ''),
      coalesce(item.value -> 'attachments', '[]'::jsonb),
      nullif(btrim(item.value ->> 'sourceDailyLogId'), ''),
      p_actor_id::text,
      now()
    from jsonb_array_elements(p_rows) item(value)
    on conflict (scope_key, task_id, progress_date) do update
    set project_id = excluded.project_id,
        construction_site_id = excluded.construction_site_id,
        week_start = excluded.week_start,
        progress_percent = excluded.progress_percent,
        quantity_done = excluded.quantity_done,
        daily_quantity_done = excluded.daily_quantity_done,
        note = excluded.note,
        attachments = excluded.attachments,
        source_daily_log_id = excluded.source_daily_log_id,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    if not v_weekly_frozen then
      insert into public.project_weekly_task_progress (
        scope_key, project_id, construction_site_id, task_id, week_start,
        progress_percent, quantity_done, note, attachments, updated_by, updated_at
      )
      select distinct on (daily.task_id)
        p_scope_key,
        p_project_id,
        v_site_id,
        daily.task_id,
        v_week_start,
        daily.progress_percent,
        daily.quantity_done,
        daily.note,
        daily.attachments,
        p_actor_id::text,
        now()
      from public.project_daily_task_progress daily
      where daily.scope_key = p_scope_key
        and daily.week_start = v_week_start
        and daily.task_id in (
          select item.value ->> 'taskId'
          from jsonb_array_elements(p_rows) item(value)
        )
      order by daily.task_id, daily.progress_date desc, daily.updated_at desc
      on conflict (scope_key, task_id, week_start) do update
      set project_id = excluded.project_id,
          construction_site_id = excluded.construction_site_id,
          progress_percent = excluded.progress_percent,
          quantity_done = excluded.quantity_done,
          note = excluded.note,
          attachments = excluded.attachments,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;

      perform app_private.upsert_project_progress_snapshot(
        p_scope_key, p_project_id, v_site_id, v_week_start, p_snapshot
      );
    end if;
  else
    insert into public.project_weekly_task_progress (
      scope_key, project_id, construction_site_id, task_id, week_start,
      progress_percent, quantity_done, note, attachments, updated_by, updated_at
    )
    select
      p_scope_key,
      p_project_id,
      v_site_id,
      item.value ->> 'taskId',
      p_period_start,
      (item.value ->> 'progressPercent')::numeric,
      coalesce(nullif(item.value ->> 'quantityDone', '')::numeric, 0),
      nullif(btrim(item.value ->> 'note'), ''),
      coalesce(item.value -> 'attachments', '[]'::jsonb),
      p_actor_id::text,
      now()
    from jsonb_array_elements(p_rows) item(value)
    on conflict (scope_key, task_id, week_start) do update
    set project_id = excluded.project_id,
        construction_site_id = excluded.construction_site_id,
        progress_percent = excluded.progress_percent,
        quantity_done = excluded.quantity_done,
        note = excluded.note,
        attachments = excluded.attachments,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

    perform app_private.upsert_project_progress_snapshot(
      p_scope_key, p_project_id, v_site_id, p_period_start, p_snapshot
    );
  end if;

  with submitted_tasks as (
    select item.value ->> 'taskId' as task_id
    from jsonb_array_elements(p_rows) item(value)
  ), daily_ranked as (
    select
      daily.task_id,
      daily.progress_percent,
      daily.progress_date as effective_date,
      row_number() over (
        partition by daily.task_id
        order by daily.progress_date desc, daily.updated_at desc
      ) as recency_rank
    from public.project_daily_task_progress daily
    join submitted_tasks submitted on submitted.task_id = daily.task_id
    where p_period_type = 'daily'
      and daily.scope_key = p_scope_key
  ), authoritative_progress as (
    select ranked.task_id, ranked.progress_percent, ranked.effective_date
    from daily_ranked ranked
    where ranked.recency_rank = 1
    union all
    select weekly.task_id, weekly.progress_percent, weekly.week_start
    from public.project_weekly_task_progress weekly
    join submitted_tasks submitted on submitted.task_id = weekly.task_id
    where p_period_type = 'weekly'
      and weekly.scope_key = p_scope_key
      and weekly.week_start = p_period_start
  )
  update public.project_tasks task
  set progress = authoritative.progress_percent,
      progress_mode = 'weekly_report',
      actual_start_date = case
        when authoritative.progress_percent > 0
          then coalesce(task.actual_start_date, authoritative.effective_date)
        else task.actual_start_date
      end,
      actual_end_date = case
        when authoritative.progress_percent >= 100
          then coalesce(task.actual_end_date, authoritative.effective_date)
        else task.actual_end_date
      end,
      gate_status = case
        when authoritative.progress_percent >= 100 then 'approved'
        when task.gate_status in ('pending', 'approved') then 'none'
        else task.gate_status
      end,
      gate_approved_by = case
        when authoritative.progress_percent < 100
          and task.gate_status in ('pending', 'approved') then null
        else task.gate_approved_by
      end,
      gate_approved_at = case
        when authoritative.progress_percent < 100
          and task.gate_status in ('pending', 'approved') then null
        else task.gate_approved_at
      end
  from authoritative_progress authoritative
  where task.id = authoritative.task_id
    and task.project_id is not distinct from p_project_id
    and nullif(task.construction_site_id::text, '') is not distinct from v_site_id;

  -- Recompute changed tasks' ancestors from the bottom up, matching the
  -- existing children_auto rule: quantity-weighted when every child has a
  -- provisional quantity, otherwise a simple average. Parent progress is
  -- clamped to 0..100 even though leaf over-completion remains supported.
  with recursive ancestors(task_id, depth) as (
    select task.parent_id, 1
    from public.project_tasks task
    where task.id in (
      select item.value ->> 'taskId'
      from jsonb_array_elements(p_rows) item(value)
    )
      and task.project_id is not distinct from p_project_id
      and nullif(task.construction_site_id::text, '') is not distinct from v_site_id
      and task.parent_id is not null
    union all
    select parent.parent_id, ancestors.depth + 1
    from ancestors
    join public.project_tasks parent on parent.id = ancestors.task_id
    where parent.project_id is not distinct from p_project_id
      and nullif(parent.construction_site_id::text, '') is not distinct from v_site_id
      and parent.parent_id is not null
      and ancestors.depth < 100
  )
  select coalesce(max(ancestors.depth), 0)
  into v_max_parent_depth
  from ancestors;

  for v_parent_depth in 1..v_max_parent_depth loop
    with recursive ancestors(task_id, depth) as (
      select task.parent_id, 1
      from public.project_tasks task
      where task.id in (
        select item.value ->> 'taskId'
        from jsonb_array_elements(p_rows) item(value)
      )
        and task.project_id is not distinct from p_project_id
        and nullif(task.construction_site_id::text, '') is not distinct from v_site_id
        and task.parent_id is not null
      union all
      select parent.parent_id, ancestors.depth + 1
      from ancestors
      join public.project_tasks parent on parent.id = ancestors.task_id
      where parent.project_id is not distinct from p_project_id
        and nullif(parent.construction_site_id::text, '') is not distinct from v_site_id
        and parent.parent_id is not null
        and ancestors.depth < 100
    ), target_parent as (
      select distinct ancestors.task_id
      from ancestors
      where ancestors.depth = v_parent_depth
    ), derived as (
      select
        parent.id,
        least(100, greatest(0, case
          when bool_and(coalesce(child.provisional_quantity, 0) > 0)
            then round(
              sum(least(100, greatest(0, child.progress)) * child.provisional_quantity)
              / nullif(sum(child.provisional_quantity), 0)
            )
          else round(avg(least(100, greatest(0, child.progress))))
        end)) as progress
      from target_parent target
      join public.project_tasks parent on parent.id = target.task_id
      join public.project_tasks child on child.parent_id = parent.id
      where parent.project_id is not distinct from p_project_id
        and nullif(parent.construction_site_id::text, '') is not distinct from v_site_id
        and child.project_id is not distinct from p_project_id
        and nullif(child.construction_site_id::text, '') is not distinct from v_site_id
      group by parent.id
    )
    update public.project_tasks task
    set progress = derived.progress,
        progress_mode = 'children_auto',
        gate_status = case
          when derived.progress >= 100 then 'approved'
          when task.gate_status in ('pending', 'approved') then 'none'
          else task.gate_status
        end,
        gate_approved_by = case
          when derived.progress < 100 and task.gate_status in ('pending', 'approved') then null
          else task.gate_approved_by
        end,
        gate_approved_at = case
          when derived.progress < 100 and task.gate_status in ('pending', 'approved') then null
          else task.gate_approved_at
        end,
        actual_end_date = case
          when derived.progress >= 100 then coalesce(task.actual_end_date, p_period_start)
          else task.actual_end_date
        end
    from derived
    where task.id = derived.id;
  end loop;

  return v_weekly_frozen;
end;
$$;

create or replace function app_private.get_project_progress_period_state_impl(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_scope_key text;
  v_state public.project_progress_period_states%rowtype;
begin
  v_scope_key := app_private.assert_project_progress_scope_period(
    p_project_id, v_site_id, p_period_type, p_period_start
  );
  perform app_private.assert_project_progress_action(
    v_actor_id, p_project_id, v_site_id, 'view'
  );

  select state.* into v_state
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = p_period_type
    and state.period_start = p_period_start;

  if found then
    return app_private.project_progress_period_state_json(v_state);
  end if;

  return jsonb_build_object(
    'id', null,
    'scopeKey', v_scope_key,
    'projectId', p_project_id,
    'constructionSiteId', v_site_id,
    'periodType', p_period_type,
    'periodStart', p_period_start,
    'isLocked', false,
    'lockedBy', null,
    'lockedAt', null,
    'unlockedBy', null,
    'unlockedAt', null,
    'unlockReason', null,
    'createdAt', null,
    'updatedAt', null
  );
end;
$$;

create or replace function app_private.save_project_progress_period_impl(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_rows jsonb,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_scope_key text;
  v_state public.project_progress_period_states%rowtype;
  v_weekly_frozen boolean;
begin
  v_scope_key := app_private.assert_project_progress_scope_period(
    p_project_id, v_site_id, p_period_type, p_period_start
  );
  perform app_private.assert_project_progress_action(
    v_actor_id, p_project_id, v_site_id, 'edit'
  );
  perform app_private.assert_project_progress_rows(
    p_project_id, v_site_id, p_period_type, p_rows
  );
  perform app_private.assert_project_progress_snapshot(p_snapshot);

  insert into public.project_progress_period_states (
    scope_key, project_id, construction_site_id, period_type, period_start
  ) values (
    v_scope_key, p_project_id, v_site_id, p_period_type, p_period_start
  ) on conflict (scope_key, period_type, period_start) do nothing;

  select state.* into v_state
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = p_period_type
    and state.period_start = p_period_start
  for update;

  if v_state.is_locked then
    raise exception 'Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.'
      using errcode = '23514';
  end if;

  v_weekly_frozen := app_private.write_project_progress_period_payload(
    v_actor_id, v_scope_key, p_project_id, v_site_id,
    p_period_type, p_period_start, p_rows, p_snapshot
  );

  select state.* into v_state
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = p_period_type
    and state.period_start = p_period_start;

  return jsonb_build_object(
    'state', app_private.project_progress_period_state_json(v_state),
    'savedRowCount', jsonb_array_length(p_rows),
    'weeklyAggregateFrozen', v_weekly_frozen
  );
end;
$$;

create or replace function app_private.close_project_progress_period_impl(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_rows jsonb,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_scope_key text;
  v_before public.project_progress_period_states%rowtype;
  v_after public.project_progress_period_states%rowtype;
begin
  v_scope_key := app_private.assert_project_progress_scope_period(
    p_project_id, v_site_id, p_period_type, p_period_start
  );
  perform app_private.assert_project_progress_action(
    v_actor_id, p_project_id, v_site_id, 'confirm'
  );

  if p_rows is null then
    if p_snapshot is not null then
      raise exception 'snapshot is accepted only with a non-empty rows draft'
        using errcode = '23514';
    end if;
  elsif jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'close draft rows must be null or a non-empty JSON array'
      using errcode = '23514';
  end if;

  insert into public.project_progress_period_states (
    scope_key, project_id, construction_site_id, period_type, period_start
  ) values (
    v_scope_key, p_project_id, v_site_id, p_period_type, p_period_start
  ) on conflict (scope_key, period_type, period_start) do nothing;

  select state.* into v_before
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = p_period_type
    and state.period_start = p_period_start
  for update;

  if v_before.is_locked then
    raise exception 'Kỳ tiến độ đã được chốt.' using errcode = '23514';
  end if;

  if p_rows is not null then
    perform app_private.assert_project_progress_action(
      v_actor_id, p_project_id, v_site_id, 'edit'
    );
    perform app_private.assert_project_progress_rows(
      p_project_id, v_site_id, p_period_type, p_rows
    );
    perform app_private.assert_project_progress_snapshot(p_snapshot);
    perform app_private.write_project_progress_period_payload(
      v_actor_id, v_scope_key, p_project_id, v_site_id,
      p_period_type, p_period_start, p_rows, p_snapshot
    );
  end if;

  update public.project_progress_period_states state
  set is_locked = true,
      locked_by = v_actor_id,
      locked_at = now(),
      unlocked_by = null,
      unlocked_at = null,
      unlock_reason = null,
      updated_at = now()
  where state.id = v_before.id
  returning state.* into v_after;

  insert into public.permission_audit_events (
    actor_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor_id,
    'weekly_progress_period_locked',
    jsonb_build_array(app_private.project_progress_period_state_json(v_before)),
    jsonb_build_array(app_private.project_progress_period_state_json(v_after)),
    jsonb_build_object(
      'scope_key', v_scope_key,
      'project_id', p_project_id,
      'construction_site_id', v_site_id,
      'period_type', p_period_type,
      'period_start', p_period_start,
      'event', 'locked',
      'occurred_at', v_after.locked_at,
      'draft_saved', p_rows is not null
    )
  );

  return app_private.project_progress_period_state_json(v_after);
end;
$$;

create or replace function app_private.reopen_project_progress_period_impl(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_scope_key text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_before public.project_progress_period_states%rowtype;
  v_after public.project_progress_period_states%rowtype;
begin
  v_scope_key := app_private.assert_project_progress_scope_period(
    p_project_id, v_site_id, p_period_type, p_period_start
  );
  perform app_private.assert_project_progress_action(
    v_actor_id, p_project_id, v_site_id, 'confirm'
  );

  if v_reason is null then
    raise exception 'Vui lòng nhập lý do mở chốt.' using errcode = '23514';
  end if;

  select state.* into v_before
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = p_period_type
    and state.period_start = p_period_start
  for update;

  if not found or not v_before.is_locked then
    raise exception 'Kỳ tiến độ chưa được chốt.' using errcode = '23514';
  end if;

  update public.project_progress_period_states state
  set is_locked = false,
      unlocked_by = v_actor_id,
      unlocked_at = now(),
      unlock_reason = v_reason,
      updated_at = now()
  where state.id = v_before.id
  returning state.* into v_after;

  insert into public.permission_audit_events (
    actor_user_id, event_type, before_grants, after_grants, metadata
  ) values (
    v_actor_id,
    'weekly_progress_period_unlocked',
    jsonb_build_array(app_private.project_progress_period_state_json(v_before)),
    jsonb_build_array(app_private.project_progress_period_state_json(v_after)),
    jsonb_build_object(
      'scope_key', v_scope_key,
      'project_id', p_project_id,
      'construction_site_id', v_site_id,
      'period_type', p_period_type,
      'period_start', p_period_start,
      'event', 'unlocked',
      'occurred_at', v_after.unlocked_at,
      'reason', v_reason
    )
  );

  return app_private.project_progress_period_state_json(v_after);
end;
$$;

create or replace function app_private.preflight_project_progress_snapshot_impl(
  p_project_id text,
  p_construction_site_id text,
  p_week_start date,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_scope_key text;
begin
  v_scope_key := app_private.assert_project_progress_scope_period(
    p_project_id, v_site_id, 'weekly', p_week_start
  );
  if v_actor_id is null or not (
    public.is_admin()
    or app_private.current_user_is_global_wms_keeper()
  ) then
    raise exception 'Chỉ System Admin hoặc thủ kho tổng được cập nhật snapshot đầu kỳ.'
      using errcode = '42501';
  end if;
  perform app_private.assert_project_progress_snapshot(p_snapshot);

  if p_snapshot ->> 'progressMode' <> 'opening_balance' then
    raise exception 'Opening Balance snapshot refresh requires progressMode opening_balance'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.project_progress_period_states state
    where state.scope_key = v_scope_key
      and state.period_type = 'weekly'
      and state.period_start = p_week_start
      and state.is_locked
  ) then
    raise exception 'Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.'
      using errcode = '23514';
  end if;

  return jsonb_build_object(
    'allowed', true,
    'scopeKey', v_scope_key,
    'weekStart', p_week_start
  );
end;
$$;

create or replace function public.preflight_project_progress_snapshot(
  p_project_id text,
  p_construction_site_id text,
  p_week_start date,
  p_snapshot jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.preflight_project_progress_snapshot_impl(
    p_project_id, p_construction_site_id, p_week_start, p_snapshot
  );
$$;

create or replace function app_private.refresh_project_progress_snapshot_impl(
  p_project_id text,
  p_construction_site_id text,
  p_week_start date,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site_id text := nullif(btrim(coalesce(p_construction_site_id, '')), '');
  v_preflight jsonb;
  v_scope_key text;
  v_state public.project_progress_period_states%rowtype;
begin
  v_preflight := app_private.preflight_project_progress_snapshot_impl(
    p_project_id, v_site_id, p_week_start, p_snapshot
  );
  v_scope_key := v_preflight ->> 'scopeKey';

  insert into public.project_progress_period_states (
    scope_key, project_id, construction_site_id, period_type, period_start
  ) values (
    v_scope_key, p_project_id, v_site_id, 'weekly', p_week_start
  ) on conflict (scope_key, period_type, period_start) do nothing;

  select state.*
  into v_state
  from public.project_progress_period_states state
  where state.scope_key = v_scope_key
    and state.period_type = 'weekly'
    and state.period_start = p_week_start
  for update;

  if v_state.is_locked then
    raise exception 'Kỳ tiến độ đã được chốt. Hãy mở chốt trước khi sửa.'
      using errcode = '23514';
  end if;

  return app_private.upsert_project_progress_snapshot(
    v_scope_key, p_project_id, v_site_id, p_week_start, p_snapshot
  );
end;
$$;

-- SECURITY INVOKER is deliberate: callers retain their authenticated role;
-- the minimum privileged operation is isolated in the app_private routine.
create or replace function public.get_project_progress_period_state(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.get_project_progress_period_state_impl(
    p_project_id, p_construction_site_id, p_period_type, p_period_start
  );
$$;

create or replace function public.save_project_progress_period(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_rows jsonb,
  p_snapshot jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.save_project_progress_period_impl(
    p_project_id, p_construction_site_id, p_period_type, p_period_start,
    p_rows, p_snapshot
  );
$$;

create or replace function public.close_project_progress_period(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_rows jsonb,
  p_snapshot jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.close_project_progress_period_impl(
    p_project_id, p_construction_site_id, p_period_type, p_period_start,
    p_rows, p_snapshot
  );
$$;

create or replace function public.reopen_project_progress_period(
  p_project_id text,
  p_construction_site_id text,
  p_period_type text,
  p_period_start date,
  p_reason text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.reopen_project_progress_period_impl(
    p_project_id, p_construction_site_id, p_period_type, p_period_start, p_reason
  );
$$;

create or replace function public.refresh_project_progress_snapshot(
  p_project_id text,
  p_construction_site_id text,
  p_week_start date,
  p_snapshot jsonb
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select app_private.refresh_project_progress_snapshot_impl(
    p_project_id, p_construction_site_id, p_week_start, p_snapshot
  );
$$;

-- Scoped reads require weekly_progress.view. No authenticated mutation policy
-- or table grant remains; all writes cross the validated RPC boundary above.
drop policy if exists project_daily_task_progress_all
  on public.project_daily_task_progress;
drop policy if exists project_daily_task_progress_select
  on public.project_daily_task_progress;
create policy project_daily_task_progress_select
  on public.project_daily_task_progress
  for select
  to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id, 'weekly_progress', 'view'
    )
  );

drop policy if exists project_weekly_task_progress_all
  on public.project_weekly_task_progress;
drop policy if exists project_weekly_task_progress_select
  on public.project_weekly_task_progress;
create policy project_weekly_task_progress_select
  on public.project_weekly_task_progress
  for select
  to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id, 'weekly_progress', 'view'
    )
  );

drop policy if exists "weekly_progress_snapshots_all"
  on public.weekly_progress_snapshots;
drop policy if exists weekly_progress_snapshots_select
  on public.weekly_progress_snapshots;
create policy weekly_progress_snapshots_select
  on public.weekly_progress_snapshots
  for select
  to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id, 'weekly_progress', 'view'
    )
  );

drop policy if exists project_progress_period_states_select
  on public.project_progress_period_states;
create policy project_progress_period_states_select
  on public.project_progress_period_states
  for select
  to authenticated
  using (
    app_private.current_actor_has_effective_room_action(
      project_id, construction_site_id, 'weekly_progress', 'view'
    )
  );

revoke all on table public.project_daily_task_progress from public, anon, authenticated;
revoke all on table public.project_weekly_task_progress from public, anon, authenticated;
revoke all on table public.weekly_progress_snapshots from public, anon, authenticated;
revoke all on table public.project_progress_period_states from public, anon, authenticated;

grant select on table public.project_daily_task_progress to authenticated;
grant select on table public.project_weekly_task_progress to authenticated;
grant select on table public.weekly_progress_snapshots to authenticated;
grant select on table public.project_progress_period_states to authenticated;

revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

revoke all on function app_private.project_progress_scope_key(text, text)
  from public, anon, authenticated;
revoke all on function app_private.assert_project_progress_scope_period(text, text, text, date)
  from public, anon, authenticated;
revoke all on function app_private.assert_project_progress_action(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function app_private.project_progress_period_state_json(public.project_progress_period_states)
  from public, anon, authenticated;
revoke all on function app_private.assert_project_progress_rows(text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.assert_project_progress_snapshot(jsonb)
  from public, anon, authenticated;
revoke all on function app_private.upsert_project_progress_snapshot(text, text, text, date, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.write_project_progress_period_payload(uuid, text, text, text, text, date, jsonb, jsonb)
  from public, anon, authenticated;

revoke all on function app_private.get_project_progress_period_state_impl(text, text, text, date)
  from public, anon, authenticated;
revoke all on function app_private.save_project_progress_period_impl(text, text, text, date, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.close_project_progress_period_impl(text, text, text, date, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.reopen_project_progress_period_impl(text, text, text, date, text)
  from public, anon, authenticated;
revoke all on function app_private.refresh_project_progress_snapshot_impl(text, text, date, jsonb)
  from public, anon, authenticated;
revoke all on function app_private.preflight_project_progress_snapshot_impl(text, text, date, jsonb)
  from public, anon, authenticated;

grant execute on function app_private.get_project_progress_period_state_impl(text, text, text, date)
  to authenticated;
grant execute on function app_private.save_project_progress_period_impl(text, text, text, date, jsonb, jsonb)
  to authenticated;
grant execute on function app_private.close_project_progress_period_impl(text, text, text, date, jsonb, jsonb)
  to authenticated;
grant execute on function app_private.reopen_project_progress_period_impl(text, text, text, date, text)
  to authenticated;
grant execute on function app_private.refresh_project_progress_snapshot_impl(text, text, date, jsonb)
  to authenticated;
grant execute on function app_private.preflight_project_progress_snapshot_impl(text, text, date, jsonb)
  to authenticated;

revoke all on function public.get_project_progress_period_state(text, text, text, date)
  from public, anon, authenticated;
revoke all on function public.save_project_progress_period(text, text, text, date, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.close_project_progress_period(text, text, text, date, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.reopen_project_progress_period(text, text, text, date, text)
  from public, anon, authenticated;
revoke all on function public.refresh_project_progress_snapshot(text, text, date, jsonb)
  from public, anon, authenticated;
revoke all on function public.preflight_project_progress_snapshot(text, text, date, jsonb)
  from public, anon, authenticated;

grant execute on function public.get_project_progress_period_state(text, text, text, date)
  to authenticated;
grant execute on function public.save_project_progress_period(text, text, text, date, jsonb, jsonb)
  to authenticated;
grant execute on function public.close_project_progress_period(text, text, text, date, jsonb, jsonb)
  to authenticated;
grant execute on function public.reopen_project_progress_period(text, text, text, date, text)
  to authenticated;
grant execute on function public.refresh_project_progress_snapshot(text, text, date, jsonb)
  to authenticated;
grant execute on function public.preflight_project_progress_snapshot(text, text, date, jsonb)
  to authenticated;

notify pgrst, 'reload schema';
