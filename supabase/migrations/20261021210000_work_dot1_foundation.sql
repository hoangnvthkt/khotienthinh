-- Vioo Work · Đợt 1 PR-1 (chủ SP duyệt 20/10/2026): nền giao việc + hạ tầng AI. Chỉ THÊM, không đổi chữ ký RPC cũ.
-- Kế hoạch: docs/work/2026-10-20-ke-hoach-dot-1-giao-viec-ai.md (mục 4, 6).
--   1) Trưởng đơn vị theo sơ đồ tổ chức xem việc của người trong đơn vị (trừ việc "hạn chế"); người được nêu là người giao (việc giao miệng / chỉ đạo) xem được việc đó.
--   2) Cập nhật tiến độ có cấu trúc: work_task_updates + lệnh progress_report (Đã làm / Đang làm / Sẽ làm / Vướng, % trước → sau, tệp, lượt AI).
--   3) Sổ chỉ đạo + việc giao miệng: work_meetings, work_task_origins; RPC ghi nguồn, BLĐ xác nhận một chạm.
--   4) Dấu vết AI: work_task_ai_links + work_ai_link_v1 (nháp AI đã được người dùng gửi → ai_runs.accepted).
--   5) RPC đọc gọn cho màn hình và AI: work_task_brief_v1, work_team_board_v1, work_company_board_v1, work_assignable_people_v1.
--   6) Skill AI Vioo Work (tắt, PR-3 bật) + biệt danh người (ai_memory_aliases.kind 'person').
-- Mức A / B / C dùng priority sẵn có: A = urgent, B = important, C = normal (chỉ đổi nhãn ở giao diện).

-- ── 1. Sơ đồ tổ chức: đơn vị của một người, đơn vị một người làm trưởng ─────────────────────────────
create function app_private.work_user_org_unit(p_user uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select e.org_unit_id from public.employees e
  where e.user_id = p_user and e.org_unit_id is not null and coalesce(e.status, '') <> 'Đã nghỉ việc'
  order by e.updated_at desc nulls last limit 1;
$$;

-- Đơn vị người này đang giữ ghế trưởng (PRIMARY hoặc ACTING, đang hiệu lực) — cùng điều kiện với resolve_slot_direct_manager.
create function app_private.work_direct_headed_units(p_user uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct ou.id from public.org_units ou
  join public.hrm_employee_slot_assignments sa on sa.slot_id = ou.manager_slot_id
  join public.employees e on e.id = sa.employee_id
  where p_user is not null and e.user_id = p_user and coalesce(ou.is_active, true)
    and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.status = 'ACTIVE'
    and sa.effective_from <= current_date and (sa.effective_to is null or sa.effective_to >= current_date);
$$;

-- Đơn vị đang làm trưởng + mọi đơn vị con.
create function app_private.work_headed_units(p_user uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive tree as (
    select h as id from app_private.work_direct_headed_units(p_user) h
    union
    select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
  )
  select id from tree;
$$;

create function app_private.work_user_heads_user(p_manager uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_manager is not null and p_member is not null and p_manager <> p_member
    and exists (select 1 from app_private.work_headed_units(p_manager) h where h = app_private.work_user_org_unit(p_member));
$$;

revoke all on function app_private.work_user_org_unit(uuid) from public, anon, authenticated;
revoke all on function app_private.work_direct_headed_units(uuid) from public, anon, authenticated;
revoke all on function app_private.work_headed_units(uuid) from public, anon, authenticated;
revoke all on function app_private.work_user_heads_user(uuid, uuid) from public, anon, authenticated;

-- ── 2. Sổ chỉ đạo + nguồn việc (chỉ đạo / giao miệng) ────────────────────────────────────────────────
create table public.work_meetings (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  held_on date not null,
  recorder_user_id uuid not null references public.users(id) on delete restrict,
  org_unit_id uuid references public.org_units(id) on delete set null,
  created_at timestamptz not null default now()
);
create index work_meetings_held_idx on public.work_meetings(held_on desc, id);
create index work_meetings_recorder_idx on public.work_meetings(recorder_user_id);

-- Một việc có tối đa một nguồn. directive: ghi từ họp / theo chỉ đạo (không cần xác nhận);
-- oral_claim: người nhận tự ghi việc được giao miệng, chờ người giao xác nhận (chỉ tính KPI khi đã xác nhận).
create table public.work_task_origins (
  task_id uuid primary key references public.work_tasks(id) on delete restrict,
  origin text not null check (origin in ('directive', 'oral_claim')),
  meeting_id uuid references public.work_meetings(id) on delete restrict,
  claimed_giver_user_id uuid references public.users(id) on delete restrict,
  claim_status text not null check (claim_status in ('not_needed', 'pending', 'confirmed', 'rejected')),
  decided_by uuid references public.users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((origin = 'oral_claim' and claimed_giver_user_id is not null and claim_status in ('pending', 'confirmed', 'rejected'))
      or (origin = 'directive' and claim_status = 'not_needed')),
  check ((claim_status in ('confirmed', 'rejected')) = (decided_at is not null and decided_by is not null))
);
create index work_task_origins_giver_idx on public.work_task_origins(claimed_giver_user_id, claim_status) where claimed_giver_user_id is not null;
create index work_task_origins_meeting_idx on public.work_task_origins(meeting_id) where meeting_id is not null;
create index work_task_origins_decided_by_idx on public.work_task_origins(decided_by) where decided_by is not null;
create index work_task_origins_created_by_idx on public.work_task_origins(created_by);

-- ── 3. Cập nhật tiến độ có cấu trúc + dấu vết AI ─────────────────────────────────────────────────────
create table public.work_task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  author_user_id uuid not null references public.users(id) on delete restrict,
  done_text text check (done_text is null or char_length(done_text) <= 2000),
  doing_text text check (doing_text is null or char_length(doing_text) <= 2000),
  next_text text check (next_text is null or char_length(next_text) <= 2000),
  blocked_text text check (blocked_text is null or char_length(blocked_text) <= 2000),
  progress_before integer not null check (progress_before between 0 and 100),
  progress_after integer not null check (progress_after between 0 and 100),
  attachment_ids uuid[] not null default '{}' check (cardinality(attachment_ids) <= 10),
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  check (coalesce(done_text, doing_text, next_text, blocked_text) is not null)
);
create index work_task_updates_task_idx on public.work_task_updates(task_id, created_at desc);
create index work_task_updates_author_idx on public.work_task_updates(author_user_id, created_at desc);
create index work_task_updates_ai_run_idx on public.work_task_updates(ai_run_id) where ai_run_id is not null;

-- Nháp AI đã được người dùng dùng thật trên một việc (đo AI có ích không, dòng thời gian ghi "AI soạn").
create table public.work_task_ai_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks(id) on delete restrict,
  ai_run_id uuid not null references public.ai_runs(id) on delete cascade,
  kind text not null check (kind in ('task_draft', 'meeting_tasks', 'update_draft', 'task_writer', 'task_brief', 'week_report', 'assistant')),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (task_id, ai_run_id)
);
create index work_task_ai_links_run_idx on public.work_task_ai_links(ai_run_id);
create index work_task_ai_links_actor_idx on public.work_task_ai_links(actor_user_id, created_at desc);

alter table public.work_meetings enable row level security;
alter table public.work_task_origins enable row level security;
alter table public.work_task_updates enable row level security;
alter table public.work_task_ai_links enable row level security;
revoke all on public.work_meetings, public.work_task_origins, public.work_task_updates, public.work_task_ai_links from public, anon, authenticated;

-- ── 4. Quyền xem việc: thêm trưởng đơn vị + người được nêu là người giao ──────────────────────────────
create or replace function app_private.work_task_user_can_view(p_task_id uuid, p_user_id uuid)
 returns boolean language plpgsql stable security definer set search_path to '' as $function$
declare t public.work_tasks%rowtype; v_workspace uuid; v_creator boolean; v_assignee boolean; v_participant boolean;
  v_related boolean; v_scope boolean; v_restricted boolean; v_ctx text; v_id text; v_head boolean; v_giver boolean;
begin
  if p_user_id is null or not exists(select 1 from public.users where id=p_user_id and is_active and account_status='ACTIVE')
    or not app_private.has_permission(p_user_id,'work.module.access','global','*') then return false; end if;
  select * into t from public.work_tasks where id=p_task_id;
  if t.id is null then return false; end if;
  v_workspace:=app_private.work_task_workspace_id(t.id);
  if v_workspace is not null and app_private.work_workspace_member_role(v_workspace,p_user_id) is null then return false; end if;
  v_creator:=t.created_by=p_user_id;
  v_assignee:=exists(select 1 from public.work_task_assignments a where a.task_id=t.id and a.user_id=p_user_id);
  v_participant:=exists(select 1 from public.work_task_participants p where p.task_id=t.id and p.user_id=p_user_id and p.ended_at is null);
  v_ctx:=case when v_workspace is not null then 'work_workspace' when t.scope_type='direct' then 'global' else t.scope_type end;
  v_id:=coalesce(v_workspace::text,t.department_id::text,t.project_id,'*');
  v_related:=(v_creator and app_private.has_permission(p_user_id,'work.task.view_related','own','*'))
    or ((v_assignee or v_participant) and app_private.has_permission(p_user_id,'work.task.view_related','assigned','*'))
    or (v_workspace is null and t.scope_type='direct' and (v_creator or v_assignee or v_participant)
      and app_private.has_permission(p_user_id,'work.task.view_related','global','*'))
    or ((v_creator or v_assignee or v_participant) and v_workspace is null and t.scope_type in('department','project')
      and app_private.has_permission(p_user_id,'work.task.view_related',t.scope_type,v_id))
    or (v_workspace is not null and (v_creator or v_assignee or v_participant)
      and app_private.has_permission(p_user_id,'work.task.view_related',v_ctx,v_id));
  v_scope:=app_private.has_permission(p_user_id,'work.task.view_scope',v_ctx,v_id);
  v_restricted:=t.privacy='standard' or v_creator or v_assignee or v_participant
    or app_private.has_permission(p_user_id,'work.task.view_restricted',v_ctx,v_id);
  -- Đợt 1: trưởng đơn vị theo sơ đồ tổ chức xem việc của người trong đơn vị (việc "hạn chế" vẫn theo v_restricted).
  v_head:=exists(select 1 from public.work_task_assignments a where a.task_id=t.id and app_private.work_user_heads_user(p_user_id,a.user_id));
  -- Người được nêu là người giao (việc giao miệng / chỉ đạo) cần xem để xác nhận.
  v_giver:=exists(select 1 from public.work_task_origins o where o.task_id=t.id and o.claimed_giver_user_id=p_user_id);
  return ((v_related or v_scope or v_head) and v_restricted) or v_giver;
end $function$;

-- ── 5. Lệnh progress_report (qua command_work_task_collaboration) ─────────────────────────────────────
create function app_private.work_command_progress_report(p_task_id uuid, p_payload jsonb, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_task public.work_tasks%rowtype;
  v_prior app_private.work_command_idempotency%rowtype;
  v_allowed constant text[] := array['done', 'doing', 'next', 'blocked', 'progressPercent', 'attachmentIds', 'expectedLockVersion', 'aiRunId'];
  v_hash text := md5(jsonb_build_object('taskId', p_task_id, 'command', 'progress_report', 'payload', p_payload)::text);
  v_done text; v_doing text; v_next text; v_blocked text; v_progress integer; v_before integer;
  v_files uuid[] := '{}'; v_run uuid; v_update_id uuid; v_event_id uuid; v_caps jsonb; v_response jsonb;
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if p_idempotency_key is null or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload - v_allowed <> '{}'::jsonb or not (p_payload ? 'progressPercent')
    or octet_length(p_payload::text) > 20000
    or (p_payload ? 'expectedLockVersion' and jsonb_typeof(p_payload->'expectedLockVersion') is distinct from 'number')
    or exists (select 1 from unnest(array['done', 'doing', 'next', 'blocked']) k
               where p_payload ? k and jsonb_typeof(p_payload->k) not in ('string', 'null')) then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  v_done := nullif(btrim(coalesce(p_payload->>'done', '')), '');
  v_doing := nullif(btrim(coalesce(p_payload->>'doing', '')), '');
  v_next := nullif(btrim(coalesce(p_payload->>'next', '')), '');
  v_blocked := nullif(btrim(coalesce(p_payload->>'blocked', '')), '');
  if greatest(char_length(v_done), char_length(v_doing), char_length(v_next), char_length(v_blocked)) > 2000 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  if v_done is null and v_doing is null and v_next is null and v_blocked is null then
    raise exception 'WORK_PROGRESS_REPORT_EMPTY' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'progressPercent') is distinct from 'number'
    or (p_payload->>'progressPercent') !~ '^(0|[1-9][0-9]?|100)$' then
    raise exception 'WORK_INVALID_PROGRESS' using errcode = '22023';
  end if;
  v_progress := (p_payload->>'progressPercent')::integer;
  begin
    if p_payload ? 'attachmentIds' and jsonb_typeof(p_payload->'attachmentIds') <> 'null' then
      if jsonb_typeof(p_payload->'attachmentIds') <> 'array' or jsonb_array_length(p_payload->'attachmentIds') > 10 then
        raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
      end if;
      select coalesce(array_agg(distinct x::uuid), '{}') into v_files from jsonb_array_elements_text(p_payload->'attachmentIds') x;
    end if;
    if p_payload ? 'aiRunId' and jsonb_typeof(p_payload->'aiRunId') <> 'null' then
      v_run := (p_payload->>'aiRunId')::uuid;
    end if;
  exception when invalid_text_representation then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end;
  if v_run is not null and not exists (select 1 from public.ai_runs r where r.id = v_run and r.user_id = v_actor) then
    raise exception 'WORK_AI_RUN_INVALID' using errcode = '22023';
  end if;

  insert into app_private.work_command_idempotency(actor_user_id, idempotency_key, command_name, request_hash)
    values (v_actor, p_idempotency_key, 'command_work_task_progress_report', v_hash) on conflict do nothing;
  select * into strict v_prior from app_private.work_command_idempotency
    where actor_user_id = v_actor and idempotency_key = p_idempotency_key for update;
  if v_prior.command_name <> 'command_work_task_progress_report' or v_prior.request_hash <> v_hash then
    raise exception 'WORK_IDEMPOTENCY_CONFLICT';
  end if;
  if v_prior.response_payload is not null then return v_prior.response_payload; end if;

  select * into strict v_task from public.work_tasks where id = p_task_id for update;
  if v_task.status in ('completed', 'cancelled') then raise exception 'WORK_TASK_TERMINAL'; end if;
  -- Người làm đã nhận việc gửi được khi việc chưa bắt đầu (tự chuyển sang Đang làm bằng lệnh start sẵn có), đang làm,
  -- đang vướng (vẫn báo được) hoặc cần chỉnh sửa. Người khác (kể cả người giao, trưởng đơn vị) không cập nhật thay.
  v_caps := app_private.work_task_capabilities(v_task.id);
  if not (coalesce((v_caps->>'canUpdateProgress')::boolean, false) or coalesce((v_caps->>'canStart')::boolean, false)
      or coalesce((v_caps->>'canUnblock')::boolean, false)) then
    raise exception 'WORK_COMMAND_DENIED' using errcode = '42501';
  end if;
  if v_task.status = 'not_started' then
    perform app_private.work_command_task(v_task.id, 'start', '{}'::jsonb, v_task.lock_version, gen_random_uuid());
    select * into strict v_task from public.work_tasks where id = p_task_id for update;
  end if;
  if cardinality(v_files) > 0 and exists (
    select 1 from unnest(v_files) f
    where not exists (select 1 from public.work_task_attachments w where w.id = f and w.task_id = v_task.id and w.deleted_at is null)) then
    raise exception 'WORK_ATTACHMENT_NOT_FOUND' using errcode = '22023';
  end if;
  v_before := v_task.progress_percent;
  if v_progress <> v_before then
    if p_payload ? 'expectedLockVersion' and (p_payload->>'expectedLockVersion')::bigint <> v_task.lock_version then
      raise exception 'WORK_VERSION_CONFLICT';
    end if;
    update public.work_tasks set progress_percent = v_progress, lock_version = lock_version + 1, updated_at = now()
      where id = v_task.id returning * into v_task;
    insert into public.work_task_versions(task_id, version, snapshot, actor_user_id, idempotency_key)
      values (v_task.id, v_task.lock_version,
        jsonb_build_object('task', to_jsonb(v_task), 'change', jsonb_build_object('before', jsonb_build_object('progressPercent', v_before),
          'after', jsonb_build_object('progressPercent', v_progress))),
        v_actor, p_idempotency_key);
  end if;
  insert into public.work_task_updates(task_id, author_user_id, done_text, doing_text, next_text, blocked_text,
      progress_before, progress_after, attachment_ids, ai_run_id, idempotency_key)
    values (v_task.id, v_actor, v_done, v_doing, v_next, v_blocked, v_before, v_progress, v_files, v_run, p_idempotency_key)
    returning id into v_update_id;
  insert into public.work_task_events(task_id, actor_user_id, event_type, payload, correlation_id, idempotency_key)
    values (v_task.id, v_actor, 'task.progress_reported',
      jsonb_build_object('updateId', v_update_id, 'before', v_before, 'after', v_progress, 'blocked', v_blocked is not null,
        'files', cardinality(v_files), 'aiRunId', v_run),
      p_idempotency_key, p_idempotency_key) returning id into v_event_id;
  insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
    values (v_event_id, v_task.id, 'task.progress_reported', jsonb_build_object('taskId', v_task.id));
  if v_run is not null then
    insert into public.work_task_ai_links(task_id, ai_run_id, kind, actor_user_id) values (v_task.id, v_run, 'update_draft', v_actor)
      on conflict (task_id, ai_run_id) do nothing;
    update public.ai_runs set accepted = true, feedback_at = now() where id = v_run and user_id = v_actor and accepted is null;
  end if;
  v_response := jsonb_build_object('taskId', v_task.id, 'taskLockVersion', v_task.lock_version, 'progressPercent', v_task.progress_percent,
    'status', v_task.status, 'updateId', v_update_id, 'suggestBlock', v_blocked is not null and v_task.status in ('in_progress', 'changes_requested'));
  update app_private.work_command_idempotency set response_payload = v_response, completed_at = now()
    where actor_user_id = v_actor and idempotency_key = p_idempotency_key;
  return v_response;
end $$;
revoke all on function app_private.work_command_progress_report(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function app_private.work_command_progress_report(uuid, jsonb, uuid) to authenticated;

create or replace function public.command_work_task_collaboration(p_task_id uuid, p_command text, p_payload jsonb, p_idempotency_key uuid)
 returns jsonb language plpgsql set search_path to '' as $function$
begin
  perform app_private.work_guard_task_command(p_task_id, true);
  if p_command = 'progress_report' then
    return app_private.work_command_progress_report(p_task_id, p_payload, p_idempotency_key);
  end if;
  if p_command in ('description_update', 'result_draft_update', 'progress_update') then
    return app_private.work_command_content_progress(p_task_id, p_command, p_payload, p_idempotency_key);
  end if;
  return app_private.work_command_collaboration(p_task_id, p_command, p_payload, p_idempotency_key);
end $function$;
revoke all on function public.command_work_task_collaboration(uuid, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.command_work_task_collaboration(uuid, text, jsonb, uuid) to authenticated;

-- Lần gần nhất việc có chuyển động thật (cập nhật, bắt đầu, nộp, vướng / gỡ vướng); chưa có thì lúc nhận việc, rồi lúc giao.
create function app_private.work_task_last_progress_at(p_task_id uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select greatest(
    (select max(u.created_at) from public.work_task_updates u where u.task_id = p_task_id),
    (select max(e.created_at) from public.work_task_events e where e.task_id = p_task_id
      and e.event_type in ('task.progress_updated', 'task.result_draft_updated', 'task.review_submitted', 'task.started', 'task.blocked', 'task.unblocked')),
    (select min(a.acknowledged_at) from public.work_task_assignments a where a.task_id = p_task_id),
    (select t.created_at from public.work_tasks t where t.id = p_task_id));
$$;
revoke all on function app_private.work_task_last_progress_at(uuid) from public, anon, authenticated;

create function app_private.work_level(p_priority text) returns text language sql immutable set search_path = '' as $$
  select case p_priority when 'urgent' then 'A' when 'important' then 'B' else 'C' end;
$$;
revoke all on function app_private.work_level(text) from public, anon, authenticated;

-- ── 6. Nguồn việc: ghi chỉ đạo / việc giao miệng, BLĐ xác nhận ─────────────────────────────────────────
create function public.work_meeting_create_v1(p_title text, p_held_on date, p_org_unit_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_id uuid;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*')
    or not app_private.has_permission(v_actor, 'work.task.assign_user', 'own', '*') then
    raise exception 'WORK_COMMAND_DENIED' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 2 and 200 or p_held_on is null
    or p_held_on > current_date + 7 or p_held_on < current_date - 60 then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  insert into public.work_meetings(title, held_on, recorder_user_id, org_unit_id)
    values (btrim(p_title), p_held_on, v_actor, p_org_unit_id) returning id into v_id;
  return jsonb_build_object('meetingId', v_id, 'title', btrim(p_title), 'heldOn', p_held_on);
end $$;

create function public.work_task_set_origin_v1(p_task_id uuid, p_origin text, p_meeting_id uuid default null, p_giver_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); t public.work_tasks%rowtype; v_event uuid; v_status text;
begin
  select * into t from public.work_tasks where id = p_task_id for update;
  if v_actor is null or t.id is null or t.created_by <> v_actor or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if p_origin not in ('directive', 'oral_claim') or (p_origin = 'oral_claim' and (p_giver_user_id is null or p_giver_user_id = v_actor))
    or (p_meeting_id is not null and not exists (select 1 from public.work_meetings m where m.id = p_meeting_id)) then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  if p_giver_user_id is not null and not exists (select 1 from public.users u where u.id = p_giver_user_id and u.is_active and u.account_status = 'ACTIVE'
      and app_private.has_permission(u.id, 'work.module.access', 'global', '*')) then
    raise exception 'WORK_GIVER_INELIGIBLE' using errcode = '22023';
  end if;
  if exists (select 1 from public.work_task_origins o where o.task_id = p_task_id) then
    raise exception 'WORK_ORIGIN_ALREADY_SET' using errcode = '22023';
  end if;
  v_status := case when p_origin = 'oral_claim' then 'pending' else 'not_needed' end;
  insert into public.work_task_origins(task_id, origin, meeting_id, claimed_giver_user_id, claim_status, created_by)
    values (p_task_id, p_origin, p_meeting_id, p_giver_user_id, v_status, v_actor);
  -- Người giao theo dõi việc để nhận thông báo và thấy tiến độ.
  if p_giver_user_id is not null and not exists (select 1 from public.work_task_participants p
      where p.task_id = p_task_id and p.user_id = p_giver_user_id and p.ended_at is null) then
    insert into public.work_task_participants(task_id, user_id, participant_role, added_by, started_at)
      values (p_task_id, p_giver_user_id, 'watcher', v_actor, now());
  end if;
  insert into public.work_task_events(task_id, actor_user_id, event_type, payload)
    values (p_task_id, v_actor, case when p_origin = 'oral_claim' then 'task.claim_recorded' else 'task.directive_recorded' end,
      jsonb_strip_nulls(jsonb_build_object('origin', p_origin, 'meetingId', p_meeting_id, 'giverUserId', p_giver_user_id)))
    returning id into v_event;
  insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
    values (v_event, p_task_id, case when p_origin = 'oral_claim' then 'task.claim_recorded' else 'task.directive_recorded' end, jsonb_build_object('taskId', p_task_id));
  return jsonb_build_object('taskId', p_task_id, 'origin', p_origin, 'claimStatus', v_status);
end $$;

create function public.work_task_claim_decide_v1(p_task_id uuid, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); o public.work_task_origins%rowtype; v_event uuid; v_type text;
begin
  select * into o from public.work_task_origins where task_id = p_task_id for update;
  if v_actor is null or o.task_id is null or o.claimed_giver_user_id is distinct from v_actor then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if p_decision not in ('confirm', 'reject') or (p_note is not null and char_length(p_note) > 500)
    or (p_decision = 'reject' and nullif(btrim(coalesce(p_note, '')), '') is null) then
    raise exception 'WORK_INVALID_COMMAND' using errcode = '22023';
  end if;
  if o.claim_status <> 'pending' then raise exception 'WORK_CLAIM_ALREADY_DECIDED' using errcode = '22023'; end if;
  update public.work_task_origins set claim_status = case p_decision when 'confirm' then 'confirmed' else 'rejected' end,
    decided_by = v_actor, decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where task_id = p_task_id;
  v_type := case p_decision when 'confirm' then 'task.claim_confirmed' else 'task.claim_rejected' end;
  insert into public.work_task_events(task_id, actor_user_id, event_type, payload)
    values (p_task_id, v_actor, v_type, jsonb_strip_nulls(jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''))))
    returning id into v_event;
  insert into app_private.work_notification_outbox(event_id, task_id, event_type, payload)
    values (v_event, p_task_id, v_type, jsonb_build_object('taskId', p_task_id));
  return jsonb_build_object('taskId', p_task_id, 'claimStatus', case p_decision when 'confirm' then 'confirmed' else 'rejected' end);
end $$;

-- ── 7. Dấu vết AI cho lệnh khác (tạo việc, viết yêu cầu, giao từ biên bản, thẻ Trợ lý) ───────────────
create function public.work_ai_link_v1(p_task_id uuid, p_run_id uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id();
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  if p_kind not in ('task_draft', 'meeting_tasks', 'update_draft', 'task_writer', 'task_brief', 'week_report', 'assistant')
    or not exists (select 1 from public.ai_runs r where r.id = p_run_id and r.user_id = v_actor) then
    raise exception 'WORK_AI_RUN_INVALID' using errcode = '22023';
  end if;
  insert into public.work_task_ai_links(task_id, ai_run_id, kind, actor_user_id) values (p_task_id, p_run_id, p_kind, v_actor)
    on conflict (task_id, ai_run_id) do nothing;
  update public.ai_runs set accepted = true, feedback_at = now() where id = p_run_id and user_id = v_actor and accepted is null;
  return jsonb_build_object('taskId', p_task_id, 'runId', p_run_id, 'kind', p_kind);
end $$;

-- ── 8. Đọc gọn: một việc (màn chi tiết, Trợ lý, skill tóm tắt) ───────────────────────────────────────
create function public.work_task_brief_v1(p_task_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); t public.work_tasks%rowtype;
begin
  if v_actor is null or not app_private.work_task_actor_can_view(p_task_id) then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  select * into strict t from public.work_tasks where id = p_task_id;
  return jsonb_build_object(
    'task', jsonb_build_object('id', t.id, 'code', t.task_code, 'title', t.title, 'status', t.status, 'level', app_private.work_level(t.priority),
      'privacy', t.privacy, 'deadlineAt', t.deadline_at, 'plannedStartAt', t.planned_start_at, 'progressPercent', t.progress_percent,
      'labels', to_jsonb(t.labels), 'description', left(coalesce(t.description_text, ''), 2000), 'createdAt', t.created_at,
      'completedAt', t.completed_at, 'lastProgressAt', app_private.work_task_last_progress_at(t.id),
      'createdBy', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = t.created_by),
      'reviewer', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = t.reviewer_user_id)),
    'origin', (select jsonb_build_object('origin', o.origin, 'claimStatus', o.claim_status, 'decidedAt', o.decided_at,
        'giver', (select jsonb_build_object('id', u.id, 'name', u.name) from public.users u where u.id = o.claimed_giver_user_id),
        'meeting', (select jsonb_build_object('id', m.id, 'title', m.title, 'heldOn', m.held_on) from public.work_meetings m where m.id = o.meeting_id))
      from public.work_task_origins o where o.task_id = t.id),
    'assignees', coalesce((select jsonb_agg(jsonb_build_object('userId', a.user_id, 'name', u.name, 'state', a.state,
        'acknowledgedAt', a.acknowledged_at, 'completedAt', a.completed_at) order by a.assigned_at)
      from public.work_task_assignments a join public.users u on u.id = a.user_id where a.task_id = t.id and a.ended_at is null), '[]'::jsonb),
    'checklist', (select jsonb_build_object('done', count(*) filter (where c.completed_at is not null), 'total', count(*))
      from public.work_task_checklist_items c where c.task_id = t.id and c.deleted_at is null),
    'children', (select jsonb_build_object('open', count(*) filter (where k.status not in ('completed', 'cancelled')), 'total', count(*))
      from public.work_tasks k where k.parent_task_id = t.id and k.status <> 'draft'),
    'updates', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_strip_nulls(jsonb_build_object('at', u.created_at, 'author', au.name, 'done', u.done_text, 'doing', u.doing_text,
          'next', u.next_text, 'blocked', u.blocked_text, 'progressBefore', u.progress_before, 'progressAfter', u.progress_after,
          'files', cardinality(u.attachment_ids), 'ai', u.ai_run_id is not null)) x
        from public.work_task_updates u join public.users au on au.id = u.author_user_id
        where u.task_id = t.id order by u.created_at desc limit 5) s), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', e.created_at, 'type', e.event_type, 'actor', coalesce(eu.name, 'Hệ thống')) x
        from public.work_task_events e left join public.users eu on eu.id = e.actor_user_id
        where e.task_id = t.id order by e.created_at desc limit 10) s), '[]'::jsonb));
end $$;

-- ── 9. Đọc gọn: Phòng tôi (trưởng đơn vị) ────────────────────────────────────────────────────────────
-- Đơn vị được xem: đơn vị mình làm trưởng (+ đơn vị con); BLĐ (work.task.view_scope global) xem mọi đơn vị.
-- Tuần trước theo giờ VN (thứ 2 → chủ nhật). Việc tự ghi chưa được xác nhận không vào số đúng hạn (quyết định 3, 20/10).
create function public.work_team_board_v1(p_org_unit_id uuid default null, p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_global boolean; v_unit uuid; v_units uuid[]; v_ws date; v_from timestamptz; v_to timestamptz;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
  v_members jsonb;
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_global := app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*');
  v_unit := coalesce(p_org_unit_id, (select h from app_private.work_direct_headed_units(v_actor) h limit 1));
  if v_unit is null or not (v_global or v_unit in (select h from app_private.work_headed_units(v_actor) h)) then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  with recursive tree as (
    select id from public.org_units where id = v_unit
    union select c.id from public.org_units c join tree on c.parent_id = tree.id where coalesce(c.is_active, true)
  ) select array_agg(id) into v_units from tree;
  v_ws := coalesce(p_week_start, (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 day')::date);
  v_from := v_ws::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (v_ws + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh';

  with members as (
    select distinct on (u.id) u.id as user_id, u.name, e.title, e.org_unit_id
    from public.employees e join public.users u on u.id = e.user_id
    where e.org_unit_id = any(v_units) and coalesce(e.status, '') <> 'Đã nghỉ việc' and u.is_active and u.account_status = 'ACTIVE'
    order by u.id, e.updated_at desc nulls last
  ), work as (
    select a.user_id, t.id, t.status, t.priority, t.deadline_at, t.completed_at, a.acknowledged_at, a.ended_at,
      coalesce(o.origin, 'normal') as origin, o.claim_status
    from public.work_task_assignments a
    join public.work_tasks t on t.id = a.task_id
    left join public.work_task_origins o on o.task_id = t.id
    where a.user_id in (select user_id from members) and t.status <> 'draft'
  ), stats as (
    select m.user_id,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active)) as active,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.priority = 'urgent') as a_count,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.priority = 'important') as b_count,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.priority = 'normal') as c_count,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_active) and w.deadline_at < now()) as overdue,
      count(distinct w.id) filter (where w.ended_at is null and w.status = any(v_workable)
        and app_private.work_task_last_progress_at(w.id) < now() - interval '48 hours') as stale,
      count(distinct w.id) filter (where w.ended_at is null and w.status = 'pending_acknowledgement' and w.acknowledged_at is null) as unack,
      count(distinct w.id) filter (where w.deadline_at >= v_from and w.deadline_at < v_to and w.status <> 'cancelled'
        and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as due,
      count(distinct w.id) filter (where w.deadline_at >= v_from and w.deadline_at < v_to and w.status = 'completed'
        and w.completed_at <= w.deadline_at and (w.origin <> 'oral_claim' or w.claim_status = 'confirmed')) as ontime
    from members m left join work w on w.user_id = m.user_id
    group by m.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', m.name, 'title', m.title, 'orgUnitId', m.org_unit_id,
      'isHead', m.user_id in (select e.user_id from public.org_units ou join public.hrm_employee_slot_assignments sa on sa.slot_id = ou.manager_slot_id
        join public.employees e on e.id = sa.employee_id where ou.id = v_unit and sa.status = 'ACTIVE' and sa.assignment_type in ('PRIMARY', 'ACTING')
        and sa.effective_from <= current_date and (sa.effective_to is null or sa.effective_to >= current_date)),
      'active', s.active, 'levels', jsonb_build_object('A', s.a_count, 'B', s.b_count, 'C', s.c_count),
      'load', 3 * s.a_count + 2 * s.b_count + s.c_count, 'overdue', s.overdue, 'stale', s.stale, 'unack', s.unack,
      'due', s.due, 'ontime', s.ontime) order by m.name), '[]'::jsonb)
  into v_members
  from members m join stats s on s.user_id = m.user_id;

  return jsonb_build_object(
    'unit', (select jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) from public.org_units ou where ou.id = v_unit),
    'myUnits', coalesce((select jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) order by ou.name)
      from public.org_units ou where ou.id in (select h from app_private.work_direct_headed_units(v_actor) h)), '[]'::jsonb),
    'weekStart', v_ws, 'canViewAll', v_global,
    'reviewWaiting', (select count(*) from public.work_tasks t where t.reviewer_user_id = v_actor and t.status = 'awaiting_review'),
    'members', v_members);
end $$;

-- ── 10. Đọc gọn: Toàn công ty (BLĐ) ──────────────────────────────────────────────────────────────────
create function public.work_company_board_v1(p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_ws date; v_from timestamptz; v_to timestamptz; v_month timestamptz; v_units jsonb;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
  v_workable constant text[] := array['not_started', 'in_progress', 'blocked', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*')
    or not app_private.has_permission(v_actor, 'work.task.view_scope', 'global', '*') then
    raise exception 'WORK_BOARD_DENIED' using errcode = '42501';
  end if;
  v_ws := coalesce(p_week_start, (date_trunc('week', now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 day')::date);
  v_from := v_ws::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_to := (v_ws + 7)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_month := date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh';

  with people as (
    select distinct on (u.id) u.id as user_id, e.org_unit_id
    from public.employees e join public.users u on u.id = e.user_id
    where e.org_unit_id is not null and coalesce(e.status, '') <> 'Đã nghỉ việc' and u.is_active and u.account_status = 'ACTIVE'
    order by u.id, e.updated_at desc nulls last
  ), work as (
    select p.org_unit_id, t.id, t.status, t.deadline_at, t.completed_at, a.ended_at,
      coalesce(o.origin, 'normal') as origin, o.claim_status
    from people p
    join public.work_task_assignments a on a.user_id = p.user_id
    join public.work_tasks t on t.id = a.task_id
    left join public.work_task_origins o on o.task_id = t.id
    where t.status <> 'draft'
  ), stats as (
    select org_unit_id,
      count(distinct id) filter (where ended_at is null and status = any(v_active)) as active,
      count(distinct id) filter (where ended_at is null and status = any(v_active) and deadline_at < now()) as overdue,
      count(distinct id) filter (where ended_at is null and status = any(v_workable)
        and app_private.work_task_last_progress_at(id) < now() - interval '48 hours') as stale,
      count(distinct id) filter (where deadline_at >= v_from and deadline_at < v_to and status <> 'cancelled'
        and (origin <> 'oral_claim' or claim_status = 'confirmed')) as due,
      count(distinct id) filter (where deadline_at >= v_from and deadline_at < v_to and status = 'completed' and completed_at <= deadline_at
        and (origin <> 'oral_claim' or claim_status = 'confirmed')) as ontime,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and ended_at is null and status = any(v_active)) as directive_open,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and ended_at is null and status = any(v_active) and deadline_at < now()) as directive_late,
      count(distinct id) filter (where (origin = 'directive' or (origin = 'oral_claim' and claim_status = 'confirmed'))
        and status = 'completed' and completed_at >= v_month) as directive_done_month,
      count(distinct id) filter (where origin = 'oral_claim' and claim_status = 'pending') as claims_pending
    from work group by org_unit_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name, 'type', ou.type,
      'parent', (select jsonb_build_object('id', pu.id, 'code', pu.code, 'name', pu.name) from public.org_units pu where pu.id = ou.parent_id),
      'people', pc.people,
      'hasHead', exists (select 1 from public.hrm_employee_slot_assignments sa where sa.slot_id = ou.manager_slot_id and sa.status = 'ACTIVE'
        and sa.assignment_type in ('PRIMARY', 'ACTING') and sa.effective_from <= current_date and (sa.effective_to is null or sa.effective_to >= current_date)),
      'active', coalesce(s.active, 0), 'overdue', coalesce(s.overdue, 0), 'stale', coalesce(s.stale, 0),
      'due', coalesce(s.due, 0), 'ontime', coalesce(s.ontime, 0),
      'directives', jsonb_build_object('open', coalesce(s.directive_open, 0), 'late', coalesce(s.directive_late, 0), 'doneThisMonth', coalesce(s.directive_done_month, 0)),
      'claimsPending', coalesce(s.claims_pending, 0)) order by ou.order_index nulls last, ou.name), '[]'::jsonb)
  into v_units
  from public.org_units ou
  join (select org_unit_id, count(*) as people from people group by org_unit_id) pc on pc.org_unit_id = ou.id
  left join stats s on s.org_unit_id = ou.id
  where coalesce(ou.is_active, true);

  return jsonb_build_object('weekStart', v_ws, 'units', v_units,
    'claimsWaitingMe', (select count(*) from public.work_task_origins o where o.claimed_giver_user_id = v_actor and o.claim_status = 'pending'));
end $$;

-- ── 11. Người giao được (giao nhanh, khớp tên của AI) ────────────────────────────────────────────────
create function public.work_assignable_people_v1(p_query text default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id(); v_unit uuid; v_q text;
  v_active constant text[] := array['pending_acknowledgement', 'clarification_requested', 'not_started', 'in_progress', 'blocked', 'awaiting_review', 'changes_requested'];
begin
  if v_actor is null or not app_private.has_permission(v_actor, 'work.module.access', 'global', '*') then
    raise exception 'WORK_TASK_NOT_FOUND' using errcode = '42501';
  end if;
  v_unit := app_private.work_user_org_unit(v_actor);
  v_q := nullif(lower(public.unaccent(btrim(coalesce(p_query, '')))), '');
  return jsonb_build_object('canAssignOthers', app_private.has_permission(v_actor, 'work.task.assign_user', 'own', '*'), 'people', coalesce((
    select jsonb_agg(jsonb_build_object('userId', q.id, 'name', q.name, 'title', q.title,
        'unit', (select jsonb_build_object('id', ou.id, 'code', ou.code, 'name', ou.name) from public.org_units ou where ou.id = q.org_unit_id),
        'myTeam', q.my_team, 'sameUnit', q.same_unit, 'isMe', q.id = v_actor,
        'canReceive', app_private.has_permission(q.id, 'work.task.view_related', 'assigned', '*'),
        'load', (select coalesce(sum(case t.priority when 'urgent' then 3 when 'important' then 2 else 1 end), 0)
          from public.work_task_assignments a join public.work_tasks t on t.id = a.task_id
          where a.user_id = q.id and a.ended_at is null and t.status = any(v_active)),
        'aliases', coalesce((select jsonb_agg(al.alias_text order by al.hits desc) from (
            select m.alias_text, m.hits from public.ai_memory_aliases m
            where m.kind = 'person' and m.scope_type = 'company' and m.target_key = q.id::text order by m.hits desc limit 5) al), '[]'::jsonb))
      order by q.my_team desc, q.same_unit desc, q.name)
    from (
      select u.id, u.name, e.title, e.org_unit_id, app_private.work_user_heads_user(v_actor, u.id) as my_team,
        (v_unit is not null and e.org_unit_id is not distinct from v_unit) as same_unit
      from public.users u
      left join lateral (select e2.title, e2.org_unit_id from public.employees e2
        where e2.user_id = u.id and coalesce(e2.status, '') <> 'Đã nghỉ việc' order by e2.updated_at desc nulls last limit 1) e on true
      where u.is_active and u.account_status = 'ACTIVE' and app_private.has_permission(u.id, 'work.module.access', 'global', '*')
        and (v_q is null or lower(public.unaccent(u.name)) like '%' || v_q || '%'
          or exists (select 1 from public.ai_memory_aliases m where m.kind = 'person' and m.scope_type = 'company'
            and m.target_key = u.id::text and m.alias_norm like '%' || v_q || '%'))
      order by 5 desc, 6 desc, u.name
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) q), '[]'::jsonb));
end $$;

revoke all on function public.work_meeting_create_v1(text, date, uuid) from public, anon, authenticated;
revoke all on function public.work_task_set_origin_v1(uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.work_task_claim_decide_v1(uuid, text, text) from public, anon, authenticated;
revoke all on function public.work_ai_link_v1(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.work_task_brief_v1(uuid) from public, anon, authenticated;
revoke all on function public.work_team_board_v1(uuid, date) from public, anon, authenticated;
revoke all on function public.work_company_board_v1(date) from public, anon, authenticated;
revoke all on function public.work_assignable_people_v1(text, integer) from public, anon, authenticated;
grant execute on function public.work_meeting_create_v1(text, date, uuid) to authenticated;
grant execute on function public.work_task_set_origin_v1(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.work_task_claim_decide_v1(uuid, text, text) to authenticated;
grant execute on function public.work_ai_link_v1(uuid, uuid, text) to authenticated;
grant execute on function public.work_task_brief_v1(uuid) to authenticated;
grant execute on function public.work_team_board_v1(uuid, date) to authenticated;
grant execute on function public.work_company_board_v1(date) to authenticated;
grant execute on function public.work_assignable_people_v1(text, integer) to authenticated;

-- ── 12. AI: biệt danh người + skill Vioo Work (tắt, PR-3 bật) ────────────────────────────────────────
alter table public.ai_memory_aliases drop constraint ai_memory_aliases_kind_check;
alter table public.ai_memory_aliases add constraint ai_memory_aliases_kind_check
  check (kind in ('task', 'crew', 'area', 'item', 'vendor', 'person'));

insert into public.ai_skills (code, name, description, tier, mode, enabled, daily_limit, model_class) values
  ('work_task_draft', 'Giao việc từ câu nói', 'Vioo Work: câu nói / tin Zalo / ảnh → một việc nháp (tên, người làm, hạn, mức A/B/C, yêu cầu, checklist, thẻ); người giao xem lại rồi bấm Giao.', 'base', 'draft', false, 20, 'fast'),
  ('work_meeting_tasks', 'Giao việc từ biên bản họp', 'Vioo Work: biên bản / tin nhắn / ảnh sổ họp → danh sách việc (người, hạn, mức) cho Sổ chỉ đạo; thư ký kiểm rồi bấm Giao.', 'base', 'draft', false, 20, 'fast'),
  ('work_update_draft', 'Viết giúp cập nhật tiến độ', 'Vioo Work: ghi chú / ảnh → Đã làm, Đang làm, Sẽ làm, Vướng và % gợi ý; người làm sửa rồi bấm Gửi.', 'base', 'draft', false, 20, 'fast'),
  ('work_task_writer', 'Viết yêu cầu công việc', 'Vioo Work: từ tên việc → yêu cầu, checklist, bằng chứng cần nộp; người giao sửa rồi bấm Giao.', 'base', 'draft', false, 20, 'fast'),
  ('work_task_brief', 'Tóm tắt một việc', 'Vioo Work: 2–3 câu một việc đang ở đâu, vướng gì, có kịp hạn không (số liệu từ work_task_brief_v1).', 'base', 'read', false, 40, 'fast')
on conflict (code) do nothing;

-- ── 13. Tự giao việc cho chính mình không cần quyền "giao cho người dùng" (tự giao, ghi việc được giao miệng) ──
-- Bản R1A chặn mọi nguồn người dùng khi thiếu work.task.assign_user, kể cả chính mình. Chỉ đổi điều kiện đó; giao cho người khác vẫn cần quyền.
CREATE OR REPLACE FUNCTION app_private.work_preview_recipients(p_sources jsonb, p_scope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a uuid:=app_private.work_assert_create_scope(p_scope); v_scope jsonb:=app_private.work_resolve_workspace_scope(p_scope);
  s text:=v_scope->>'type'; k text:=coalesce(v_scope->>'workspaceId',v_scope->>'departmentId',v_scope->>'projectId','*');
  v_workspace uuid:=(v_scope->>'workspaceId')::uuid; sources jsonb; valid jsonb; invalid jsonb; result jsonb;
begin
  if jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
  if jsonb_array_length(p_sources)>100 or exists(select 1 from jsonb_array_elements(p_sources) x
    where jsonb_typeof(x)<>'object' or coalesce(x->>'type','') not in('user','work_group')
      or nullif(btrim(x->>'id'),'') is null or length(x->>'id')>200) then raise exception 'WORK_INVALID_RECIPIENT_SOURCES' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) x where x->>'type'='user' and x->>'id' is distinct from a::text)
    and not app_private.has_permission(a,'work.task.assign_user',case when v_workspace is not null then 'work_workspace' when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_ASSIGN_USER_DENIED' using errcode='42501'; end if;
  if exists(select 1 from jsonb_array_elements(p_sources) x where x->>'type'='work_group')
    and not app_private.has_permission(a,'work.task.assign_group',case when v_workspace is not null then 'work_workspace' when s='direct' then 'own' else s end,k) then
    raise exception 'WORK_ASSIGN_GROUP_DENIED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'type',x->>'id'),'[]') into sources
  from(select distinct jsonb_build_object('type',x->>'type','id',x->>'id') x from jsonb_array_elements(p_sources) x)q;
  with src as(select x->>'type' type,x->>'id' id from jsonb_array_elements(sources)x), expanded as(
    select src.type,src.id,src.id user_id,null::text reason from src where type='user'
    union all select src.type,src.id,m.user_id,case when g.id is null then 'GROUP_NOT_FOUND' when not g.is_active then 'GROUP_INACTIVE' when m.id is null then 'NO_ACTIVE_MEMBERS' end
    from src left join public.work_groups g on g.id::text=src.id left join public.work_group_members m on m.group_id=g.id and m.is_active and g.is_active where src.type='work_group'
  ),resolved as(
    select e.*,u.name,coalesce(e.reason,case when u.id is null then 'NO_APP_ACCOUNT' when not u.is_active then 'INACTIVE_USER'
      when u.account_status<>'ACTIVE' then 'ACCOUNT_NOT_ACTIVE' when not app_private.has_permission(u.id,'work.module.access','global','*') then 'NO_MODULE_ACCESS'
      when v_workspace is not null and app_private.work_workspace_member_role(v_workspace,u.id) is null then 'NOT_WORKSPACE_MEMBER' end) exclusion
    from expanded e left join public.users u on e.user_id=u.id::text
  ),grouped as(select user_id,max(name) name,exclusion,jsonb_agg(jsonb_build_object('type',type,'id',id) order by type,id) sources from resolved group by user_id,exclusion)
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'name',name,'sources',grouped.sources) order by user_id)filter(where exclusion is null),'[]'),
    coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'reason',exclusion,'sources',grouped.sources) order by user_id,exclusion)filter(where exclusion is not null),'[]')
  into valid,invalid from grouped;
  if jsonb_array_length(valid)>500 or jsonb_array_length(invalid)>1000 then raise exception 'WORK_RECIPIENT_LIMIT' using errcode='22023'; end if;
  result:=jsonb_build_object('sources',sources,'validRecipients',valid,'invalidRecipients',invalid,'validCount',jsonb_array_length(valid),'invalidCount',jsonb_array_length(invalid));
  return result||jsonb_build_object('fingerprint',md5(jsonb_build_object('scope',v_scope,'preview',result)::text));
end $function$;

-- ── 14. Lịch làm việc mặc định của công ty + SLA chung ───────────────────────────────────────────────
-- Cloud chỉ có lịch của Workspace thử QLDA (07/09) → việc giao trực tiếp báo WORK_CALENDAR_NOT_CONFIGURED.
-- Lịch công ty theo runbook R1A: thứ 2 – thứ 7, 08:00–12:00 và 13:00–17:00; xác nhận nhận việc A 1 giờ, B 4 giờ, C 8 giờ làm việc
-- (bằng mức Workspace QLDA đang dùng). Không đè lịch / chính sách đã có.
do $$
declare v_by uuid; v_cal uuid;
begin
  if exists (select 1 from public.work_sla_calendars where scope_type = 'global' and is_default and is_active) then return; end if;
  v_by := coalesce((select created_by from public.work_sla_calendars order by created_at limit 1),
    (select id from public.users where role = 'ADMIN' and is_active order by created_at limit 1));
  if v_by is null then return; end if;
  insert into public.work_sla_calendars(name, timezone, working_weekdays, workday_start, workday_end, working_intervals, is_default, is_active, scope_type, created_by)
    values ('Công ty — Thứ 2 đến Thứ 7', 'Asia/Ho_Chi_Minh', array[1,2,3,4,5,6]::smallint[], '08:00', '17:00',
      '[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"17:00"}]'::jsonb, true, true, 'global', v_by)
    returning id into v_cal;
  insert into public.work_sla_policies(name, scope_type, calendar_id, priority, acknowledgement_minutes, created_by)
  select 'Công ty — mức ' || l.level, 'global', v_cal, l.priority, l.minutes, v_by
  from (values ('A', 'urgent', 60), ('B', 'important', 240), ('C', 'normal', 480)) l(level, priority, minutes)
  where not exists (select 1 from public.work_sla_policies p where p.scope_type = 'global' and p.priority = l.priority and p.is_active and p.effective_to is null);
end $$;
