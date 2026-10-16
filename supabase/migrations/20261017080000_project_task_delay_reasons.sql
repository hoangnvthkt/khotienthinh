-- PR-3b: lý do chậm theo việc + ngày, ghi ở Nhật ký (chủ SP duyệt mockup 16/10/2026).
--
-- - Việc chậm quá 3 ngày so với tiến độ tổng (cách tính lib/projectScheduleVariance.ts, PR #195) mà không phải do
--   việc trước chậm phải có lý do chọn từ danh mục project_plan_change_reasons (dùng chung với KH tháng/tuần và phiếu
--   điều chỉnh tiến độ) + bên chịu trách nhiệm CĐT / Công ty / Khách quan. Việc chậm theo việc trước lấy lý do việc
--   trước khi hiển thị, không lưu.
-- - Người tổng hợp điền sẵn (nháp theo bản tổng hợp); CHT xem lại và bắt buộc đủ lý do khi Duyệt & công bố
--   (publish_daily_log_summary_v2 = lưu lý do + gọi v1 trong cùng giao dịch; v1 giữ nguyên, không đổi tên).
-- - Danh sách việc bắt buộc tính ở trình duyệt (thuật toán TS); máy chủ kiểm việc thuộc dự án, mã lý do, bên chịu
--   trách nhiệm và trạng thái phiếu.

create table public.project_task_delay_reasons (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  construction_site_id text,
  daily_log_id text not null references public.daily_logs(id) on delete cascade,
  log_date date not null,
  task_id text not null references public.project_tasks(id) on delete cascade,
  reason_code text not null references public.project_plan_change_reasons(code),
  responsible_party text not null check (responsible_party in ('owner', 'company', 'objective')),
  note text check (note is null or char_length(note) <= 500),
  lag_days integer check (lag_days is null or lag_days between 0 and 3650),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_log_id, task_id)
);
create index project_task_delay_reasons_latest_idx
  on public.project_task_delay_reasons (project_id, task_id, log_date desc) where status = 'published';
alter table public.project_task_delay_reasons enable row level security;
revoke all on public.project_task_delay_reasons from public, anon, authenticated;

-- Kiểm danh sách lý do: việc thuộc dự án, mã lý do còn dùng (trừ "Đẩy nhanh"), bên chịu trách nhiệm, không trùng việc.
create function app_private.assert_delay_reasons_v1(p_project_id text, p_reasons jsonb)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_reasons is null or jsonb_typeof(p_reasons) <> 'array' then
    raise exception using errcode = '22023', message = 'DELAY_REASONS_INVALID';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_reasons) x(j)
    where jsonb_typeof(x.j) <> 'object'
      or nullif(x.j->>'taskId', '') is null
      or not exists (select 1 from public.project_tasks t where t.id = x.j->>'taskId' and t.project_id = p_project_id)
      or not exists (select 1 from public.project_plan_change_reasons r where r.code = x.j->>'reasonCode' and r.is_active and r.code <> 'speedup')
      or coalesce(x.j->>'responsibleParty', '') not in ('owner', 'company', 'objective')
      or char_length(coalesce(x.j->>'note', '')) > 500
      or (x.j ? 'lagDays' and jsonb_typeof(x.j->'lagDays') <> 'null'
        and (jsonb_typeof(x.j->'lagDays') <> 'number' or (x.j->>'lagDays')::numeric not between 0 and 3650))
  ) or (select count(*) <> count(distinct x.j->>'taskId') from jsonb_array_elements(p_reasons) x(j)) then
    raise exception using errcode = '22023', message = 'DELAY_REASONS_INVALID';
  end if;
end;
$$;
revoke all on function app_private.assert_delay_reasons_v1(text, jsonb) from public, anon, authenticated;

-- Thay toàn bộ lý do của một bản tổng hợp (đã khóa dòng daily_logs ở hàm gọi).
create function app_private.replace_daily_log_delay_reasons_v1(p_log public.daily_logs, p_reasons jsonb, p_status text, p_actor uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform app_private.assert_delay_reasons_v1(p_log.project_id, p_reasons);
  delete from public.project_task_delay_reasons d where d.daily_log_id = p_log.id;
  insert into public.project_task_delay_reasons (project_id, construction_site_id, daily_log_id, log_date, task_id, reason_code,
    responsible_party, note, lag_days, status, created_by, updated_by)
  select p_log.project_id, p_log.construction_site_id, p_log.id, p_log.date::date, x.j->>'taskId', x.j->>'reasonCode',
    x.j->>'responsibleParty', nullif(btrim(coalesce(x.j->>'note', '')), ''),
    case when jsonb_typeof(x.j->'lagDays') = 'number' then round((x.j->>'lagDays')::numeric)::integer end,
    p_status, p_actor, p_actor
  from jsonb_array_elements(p_reasons) x(j);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app_private.replace_daily_log_delay_reasons_v1(public.daily_logs, jsonb, text, uuid) from public, anon, authenticated;

-- Người tổng hợp lưu nháp khi bản còn nháp / bị trả; CHT sửa khi bản đang chờ duyệt.
create function public.save_daily_log_delay_reasons_v1(p_daily_log_id text, p_reasons jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_log public.daily_logs%rowtype; v_count integer;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'DAILY_LOG_PERMISSION_DENIED'; end if;
  select * into v_log from public.daily_logs where id = p_daily_log_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'DAILY_LOG_NOT_FOUND'; end if;
  if v_log.status in ('draft', 'rejected') then
    if not app_private.current_actor_has_effective_room_action(v_log.project_id, v_log.construction_site_id, 'daily_log', 'verify') then
      raise exception using errcode = '42501', message = 'DAILY_LOG_PERMISSION_DENIED';
    end if;
  elsif v_log.status = 'submitted' then
    if not app_private.current_actor_has_effective_room_action(v_log.project_id, v_log.construction_site_id, 'daily_log', 'approve') then
      raise exception using errcode = '42501', message = 'DAILY_LOG_PERMISSION_DENIED';
    end if;
  else
    raise exception using errcode = 'PT409', message = 'DAILY_LOG_ALREADY_PUBLISHED';
  end if;
  v_count := app_private.replace_daily_log_delay_reasons_v1(v_log, p_reasons, 'draft', v_actor);
  return jsonb_build_object('dailyLogId', v_log.id, 'count', v_count);
end;
$$;

-- Duyệt & công bố kèm lý do chậm: v1 kiểm quyền (approve + publish_progress) và công bố; lý do ghi trong cùng giao dịch.
create function public.publish_daily_log_summary_v2(p_daily_log_id text, p_expected_updated_at timestamptz, p_command_id uuid, p_delay_reasons jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_receipt jsonb; v_log public.daily_logs%rowtype; v_count integer;
begin
  perform app_private.assert_delay_reasons_v1((select l.project_id from public.daily_logs l where l.id = p_daily_log_id), p_delay_reasons);
  v_receipt := public.publish_daily_log_summary_v1(p_daily_log_id, p_expected_updated_at, p_command_id);
  select * into v_log from public.daily_logs where id = p_daily_log_id for update;
  v_count := app_private.replace_daily_log_delay_reasons_v1(v_log, p_delay_reasons,
    case when v_log.status = 'verified' then 'published' else 'draft' end, public.current_app_user_id());
  return coalesce(v_receipt, '{}'::jsonb) || jsonb_build_object('delayReasonCount', v_count);
end;
$$;

-- Đọc: danh mục lý do, lý do mới nhất đã công bố theo việc (trước ngày của bản tổng hợp nếu có), nháp của bản tổng hợp.
create function public.get_project_delay_reasons_v1(p_project_id text, p_construction_site_id text, p_daily_log_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_before date;
begin
  if public.current_app_user_id() is null or not (
    app_private.project_gantt_can_view(p_project_id, p_construction_site_id)
    or app_private.daily_log_can_select(p_project_id, p_construction_site_id, public.current_app_user_id())
  ) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_PERMISSION_DENIED';
  end if;
  if p_daily_log_id is not null then
    select l.date::date into v_before from public.daily_logs l where l.id = p_daily_log_id and l.project_id = p_project_id;
  end if;
  return jsonb_build_object(
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'label', r.label, 'defaultParty', r.default_party,
      'needsDocument', r.needs_document) order by r.sort_order) from public.project_plan_change_reasons r where r.is_active and r.code <> 'speedup'), '[]'::jsonb),
    'latest', coalesce((select jsonb_agg(app_private.delay_reason_json_v1(d) order by d.task_id) from public.project_task_delay_reasons d
      where d.id in (select distinct on (x.task_id) x.id from public.project_task_delay_reasons x
        where x.project_id = p_project_id and x.status = 'published' and (v_before is null or x.log_date < v_before)
        order by x.task_id, x.log_date desc, x.updated_at desc)), '[]'::jsonb),
    'draft', coalesce((select jsonb_agg(app_private.delay_reason_json_v1(d) order by d.task_id) from public.project_task_delay_reasons d
      where p_daily_log_id is not null and d.daily_log_id = p_daily_log_id and d.project_id = p_project_id), '[]'::jsonb)
  );
end;
$$;

create function app_private.delay_reason_json_v1(d public.project_task_delay_reasons)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('taskId', d.task_id, 'dailyLogId', d.daily_log_id, 'logDate', d.log_date, 'reasonCode', d.reason_code,
    'responsibleParty', d.responsible_party, 'note', d.note, 'lagDays', d.lag_days, 'status', d.status,
    'updatedByName', (select u.name from public.users u where u.id = d.updated_by), 'updatedAt', d.updated_at);
$$;
revoke all on function app_private.delay_reason_json_v1(public.project_task_delay_reasons) from public, anon, authenticated;

revoke all on function public.save_daily_log_delay_reasons_v1(text, jsonb) from public, anon;
revoke all on function public.publish_daily_log_summary_v2(text, timestamptz, uuid, jsonb) from public, anon;
revoke all on function public.get_project_delay_reasons_v1(text, text, text) from public, anon;
grant execute on function public.save_daily_log_delay_reasons_v1(text, jsonb) to authenticated;
grant execute on function public.publish_daily_log_summary_v2(text, timestamptz, uuid, jsonb) to authenticated;
grant execute on function public.get_project_delay_reasons_v1(text, text, text) to authenticated;
