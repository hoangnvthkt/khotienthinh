-- Trợ lý B4 (chủ SP 22/10/2026): bản tin Admin hằng tuần — gộp tín hiệu (Trợ lý lỗi / bị chê / từ chối / chậm, góp ý & sự cố mới, việc duyệt
-- treo, nháp bỏ dở, người được cấp chưa dùng, Jev khớp) thành tối đa 3 việc nên làm; Thứ Hai 07:00 (giờ VN) gửi mọi Admin qua thông báo app
-- + web push (notifications.push_enabled). Không gọi model: xếp việc theo luật có điểm, Admin xem đủ tín hiệu ở Trung tâm AI → Bản tin tuần.

create table if not exists public.ai_admin_digests (
  week_start date primary key,
  week_end date not null,
  generated_at timestamptz not null default now(),
  signals jsonb not null default '{}'::jsonb,
  picks jsonb not null default '[]'::jsonb,
  recipients integer not null default 0,
  sent_at timestamptz,
  created_by uuid
);
alter table public.ai_admin_digests enable row level security;
drop policy if exists ai_admin_digests_admin_select on public.ai_admin_digests;
create policy ai_admin_digests_admin_select on public.ai_admin_digests for select to authenticated using (public.is_admin());
revoke all on public.ai_admin_digests from public, anon;
grant select on public.ai_admin_digests to authenticated;

-- ── Tín hiệu một tuần ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.ai_admin_digest_signals(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := p_from::timestamp at time zone 'Asia/Ho_Chi_Minh'; v_to timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'assistant', (
      with r as (select * from public.ai_runs where created_at >= v_from and created_at < v_to)
      select jsonb_build_object(
        'runs', (select count(*) from r), 'askers', (select count(distinct user_id) from r where skill_code = 'assistant_chat'),
        'questions', (select count(*) from r where skill_code = 'assistant_chat'),
        'errors', (select count(*) from r where status = 'error'),
        'errorCodes', (select coalesce(jsonb_agg(jsonb_build_object('code', e.code, 'n', e.n) order by e.n desc), '[]'::jsonb) from (
            select case when error ilike '%timed out%' then 'AI_TIMEOUT' else coalesce(left(error, 40), 'AI_FAILED') end code, count(*) n from r where status = 'error' group by 1 order by 2 desc limit 3) e),
        'dislikes', (select count(*) from r where accepted = false),
        'dislikeReasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', d.reason, 'n', d.n) order by d.n desc), '[]'::jsonb) from (
            select coalesce(feedback_reason, 'other') reason, count(*) n from r where accepted = false group by 1 order by 2 desc limit 3) d),
        'refusals', (select count(*) from r where summary ~ 'từ chối \('),
        'refusalReasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', x.reason, 'n', x.n) order by x.n desc), '[]'::jsonb) from (
            select substring(summary from 'từ chối \(([a-z_]+)\)') reason, count(*) n from r where summary ~ 'từ chối \(' group by 1 order by 2 desc limit 3) x),
        'slow', (select count(*) from r where status = 'ok' and duration_ms > 30000),
        'slowSkills', (select coalesce(jsonb_agg(jsonb_build_object('skill', s.skill_code, 'n', s.n, 'p95', s.p95) order by s.n desc), '[]'::jsonb) from (
            select skill_code, count(*) n, round(percentile_cont(0.95) within group (order by duration_ms)) p95 from r where status = 'ok' and duration_ms > 30000 group by 1 order by 2 desc limit 3) s),
        'costUsd', (select round(coalesce(sum(cost_usd), 0)::numeric, 2) from r),
        'commands', (select jsonb_build_object('prepared', count(*), 'done', count(*) filter (where status = 'done'), 'cancelled', count(*) filter (where status = 'cancelled'),
            'expired', count(*) filter (where status = 'prepared' and created_at < now() - interval '1 day')) from public.assistant_commands where created_at >= v_from and created_at < v_to),
        'granted', (select count(*) from public.ai_user_grants g join public.users u on u.id = g.user_id where g.enabled and u.is_active and u.account_status = 'ACTIVE'),
        'idle', (select coalesce(jsonb_agg(x.name order by x.name), '[]'::jsonb) from (
            select u.name from public.ai_user_grants g join public.users u on u.id = g.user_id
            where g.enabled and u.is_active and u.account_status = 'ACTIVE' and not exists (select 1 from r where r.user_id = u.id and r.skill_code = 'assistant_chat') order by u.name limit 8) x),
        'idleCount', (select count(*) from public.ai_user_grants g join public.users u on u.id = g.user_id
            where g.enabled and u.is_active and u.account_status = 'ACTIVE' and not exists (select 1 from r where r.user_id = u.id and r.skill_code = 'assistant_chat')),
        'jev', (select jsonb_build_object('n', count(*), 'auto', count(*) filter (where predicted->>'tier' = 'auto'),
            'autoAgree', count(*) filter (where predicted->>'tier' = 'auto' and agree), 'autoDisagree', count(*) filter (where predicted->>'tier' = 'auto' and agree = false))
          from public.ai_decisions where created_at >= v_from and created_at < v_to and status = 'ok')
      )),
    'feedback', (select jsonb_build_object(
        'new', (select count(*) from public.feedback_items where created_at >= v_from and created_at < v_to),
        'fromAssistant', (select count(*) from public.feedback_items where created_at >= v_from and created_at < v_to and metadata->>'source' = 'assistant'),
        'newByType', (select coalesce(jsonb_object_agg(t.type, t.n), '{}'::jsonb) from (select type, count(*) n from public.feedback_items where created_at >= v_from and created_at < v_to group by 1) t),
        'open', (select count(*) from public.feedback_items where status in ('new', 'received')),
        'oldestOpenDays', (select max(v_today - created_at::date) from public.feedback_items where status in ('new', 'received')),
        'urgentOpen', (select count(*) from public.feedback_items where status in ('new', 'received') and (priority = 'urgent' or impact_level = 'urgent')))),
    'stale', (select jsonb_build_object(
        'leavePending3d', (select count(*) from public.hrm_leave_requests where status = 'pending' and "createdAt" < now() - interval '3 days'),
        'wfRunningStale7d', (select count(*) from public.workflow_instances where status::text = 'RUNNING' and updated_at < now() - interval '7 days'),
        'captureUnreceived3d', (select count(*) from public.wms_delivery_captures where status in ('new', 'read') and created_at < now() - interval '3 days'),
        'poDraft7d', (select count(*) from public.purchase_orders where status = 'draft' and created_at < now() - interval '7 days' and created_at > now() - interval '90 days'),
        'requestDraft7d', (select count(*) from public.requests where status::text = 'DRAFT' and created_at < now() - interval '7 days' and created_at > now() - interval '90 days'),
        'dailyLogDraft3d', (select count(*) from public.daily_logs where status = 'draft' and date < to_char(v_today - 3, 'YYYY-MM-DD') and date >= to_char(v_today - 30, 'YYYY-MM-DD')),
        'requestPending3d', (select count(*) from public.requests where status::text = 'PENDING' and coalesce(last_action_at, created_at) < now() - interval '3 days')))
  );
end $$;
revoke all on function app_private.ai_admin_digest_signals(date, date) from public, anon, authenticated;

-- ── 3 việc nên làm từ tín hiệu: luật có điểm, lấy 3 điểm cao nhất ────────────────────────────────────────────────────
create or replace function app_private.ai_admin_digest_picks(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare a jsonb := coalesce(p->'assistant', '{}'::jsonb); f jsonb := coalesce(p->'feedback', '{}'::jsonb); s jsonb := coalesce(p->'stale', '{}'::jsonb);
  picks jsonb := '[]'::jsonb; n int; m int; g int; codes text; reasons text; skills text; auto int; agree int; pct int;
  add_pick text;
begin
  n := coalesce((a->>'errors')::int, 0);
  if n >= 3 then
    select string_agg(x->>'code' || ' ×' || (x->>'n'), ', ') into codes from jsonb_array_elements(a->'errorCodes') x;
    picks := picks || jsonb_build_object('key', 'ai_errors', 'score', 90 + least(n, 30), 'title', format('Kiểm cổng AI: %s lượt lỗi trong tuần', n),
      'detail', coalesce(codes, '') || ' — xem kết nối / model ở Cài đặt → Kết nối, thử lại bộ kiểm.', 'link', '/settings?tab=ai-gateway');
  end if;
  n := coalesce((f->>'new')::int, 0); m := coalesce((f->>'urgentOpen')::int, 0);
  if n >= 1 or m >= 1 then
    picks := picks || jsonb_build_object('key', 'feedback_new', 'score', 85 + least(n * 3, 30) + m * 5, 'title', format('Xử lý %s góp ý / phiếu sự cố mới%s', n, case when m > 0 then format(' (%s khẩn đang mở)', m) else '' end),
      'detail', format('%s từ Trợ lý · tổng %s phiếu đang mở, cũ nhất %s ngày.', coalesce(f->>'fromAssistant', '0'), coalesce(f->>'open', '0'), coalesce(f->>'oldestOpenDays', '0')), 'link', '/feedback');
  end if;
  n := coalesce((a->>'dislikes')::int, 0);
  if n >= 1 then
    select string_agg(x->>'reason' || ' ×' || (x->>'n'), ', ') into reasons from jsonb_array_elements(a->'dislikeReasons') x;
    picks := picks || jsonb_build_object('key', 'ai_dislikes', 'score', 80 + least(n * 5, 30), 'title', format('Xem %s câu Trợ lý bị chê', n),
      'detail', coalesce(reasons, '') || ' — mở Trung tâm AI → Hoạt động, đọc câu hỏi và sửa lời nhắc / sổ tay.', 'link', '/ai');
  end if;
  n := coalesce((s->>'leavePending3d')::int, 0); m := coalesce((s->>'wfRunningStale7d')::int, 0); g := coalesce((s->>'requestPending3d')::int, 0);
  if n >= 1 or m >= 5 or g >= 3 then
    picks := picks || jsonb_build_object('key', 'approvals_stale', 'score', 70 + least(n * 4 + m + g * 2, 30), 'title', 'Nhắc duyệt việc treo',
      'detail', format('%s đơn phép chờ > 3 ngày · %s phiếu quy trình > 7 ngày không động · %s phiếu yêu cầu chờ > 3 ngày.', n, m, g), 'link', '/wf');
  end if;
  n := coalesce((s->>'captureUnreceived3d')::int, 0);
  if n >= 1 then
    picks := picks || jsonb_build_object('key', 'capture_unreceived', 'score', 65 + least(n * 3, 20), 'title', format('Kho: %s phiếu giao chụp > 3 ngày chưa nhận hàng', n),
      'detail', 'Nhắc thủ kho nhận hoặc bỏ phiếu để tồn không lệch.', 'link', '/operations');
  end if;
  n := coalesce((a->>'idleCount')::int, 0); g := coalesce((a->>'granted')::int, 0);
  if n >= 3 and g > 0 then
    select string_agg(x #>> '{}', ', ') into reasons from jsonb_array_elements(a->'idle') x;
    picks := picks || jsonb_build_object('key', 'ai_idle', 'score', 60 + least(n * 2, 20), 'title', format('%s/%s người được cấp chưa hỏi Trợ lý tuần này', n, g),
      'detail', coalesce(reasons, '') || ' — nhắc thử một câu hoặc thu hồi cấp để tiết kiệm.', 'link', '/ai');
  end if;
  n := coalesce((a->>'slow')::int, 0);
  if n >= 3 then
    select string_agg(x->>'skill' || ' ×' || (x->>'n') || ' (p95 ' || round((x->>'p95')::numeric / 1000) || ' s)', ', ') into skills from jsonb_array_elements(a->'slowSkills') x;
    picks := picks || jsonb_build_object('key', 'ai_slow', 'score', 55 + least(n, 20), 'title', format('%s lượt AI chậm hơn 30 giây', n),
      'detail', coalesce(skills, '') || ' — cân nhắc đổi model / kết nối cho skill đó.', 'link', '/settings?tab=connections');
  end if;
  n := coalesce((s->>'poDraft7d')::int, 0); m := coalesce((s->>'requestDraft7d')::int, 0); g := coalesce((s->>'dailyLogDraft3d')::int, 0);
  if n + m >= 5 or g >= 10 then
    picks := picks || jsonb_build_object('key', 'drafts', 'score', 50 + least(n + m + g / 5, 20), 'title', 'Dọn nháp bỏ dở',
      'detail', format('%s đơn mua nháp > 7 ngày · %s yêu cầu nháp > 7 ngày · %s nhật ký nháp > 3 ngày (30 ngày gần đây).', n, m, g), 'link', '/procurement?mode=orders');
  end if;
  auto := coalesce((a->'jev'->>'auto')::int, 0); agree := coalesce((a->'jev'->>'autoAgree')::int, 0);
  if auto >= 10 then
    pct := round(100.0 * agree / auto);
    if pct < 85 then
      picks := picks || jsonb_build_object('key', 'jev_agree', 'score', 45, 'title', format('Jev khớp %s%% ở tầng auto (%s/%s)', pct, agree, auto),
        'detail', 'Dưới 85 % — chưa bật J2 (tự điều hướng); xem shadow-report trước.', 'link', '/settings?tab=connections');
    end if;
  end if;
  return (select coalesce(jsonb_agg(x order by (x->>'score')::int desc), '[]'::jsonb) from (select x from jsonb_array_elements(picks) x order by (x->>'score')::int desc limit 3) t);
end $$;
revoke all on function app_private.ai_admin_digest_picks(jsonb) from public, anon, authenticated;

-- ── Dựng + gửi bản tin một tuần (idempotent theo week_start) ────────────────────────────────────────────────────────────
create or replace function app_private.ai_admin_digest_build(p_week_start date, p_week_end date, p_send boolean, p_actor uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_signals jsonb; v_picks jsonb; v_row public.ai_admin_digests; v_title text; v_msg text; v_n integer := 0; v_link text := '/ai?tab=digest';
begin
  v_signals := app_private.ai_admin_digest_signals(p_week_start, p_week_end);
  v_picks := app_private.ai_admin_digest_picks(v_signals);
  insert into public.ai_admin_digests(week_start, week_end, generated_at, signals, picks, created_by)
    values (p_week_start, p_week_end, now(), v_signals, v_picks, p_actor)
  on conflict (week_start) do update set week_end = excluded.week_end, generated_at = now(), signals = excluded.signals, picks = excluded.picks,
    created_by = coalesce(excluded.created_by, public.ai_admin_digests.created_by)
  returning * into v_row;
  if p_send and v_row.sent_at is null then
    v_title := format('Bản tin Admin tuần %s–%s', to_char(p_week_start, 'DD/MM'), to_char(p_week_end, 'DD/MM'));
    v_msg := case when jsonb_array_length(v_picks) = 0
      then format('Tuần yên: %s câu hỏi Trợ lý, %s lỗi, %s góp ý mới. Không có việc cần làm ngay.', coalesce(v_signals->'assistant'->>'questions', '0'), coalesce(v_signals->'assistant'->>'errors', '0'), coalesce(v_signals->'feedback'->>'new', '0'))
      else (select string_agg((i + 1) || '. ' || (x->>'title'), E'\n') from jsonb_array_elements(v_picks) with ordinality t(x, i)) end;
    insert into public.notifications(user_id, type, category, module, title, message, body, severity, icon, link, action_url,
        source_type, source_id, entity_type, priority, push_enabled, metadata, delivery_reason, delivery_mode)
      select u.id::text, 'info', 'ai', 'ai', v_title, v_msg, v_msg, case when jsonb_array_length(v_picks) > 0 and (v_picks->0->>'score')::int >= 85 then 'warning' else 'info' end, '🧭', v_link, '/#' || v_link,
        'ai_admin_digest', p_week_start::text, 'ai_admin_digest', 'normal', true,
        jsonb_build_object('eventType', 'ai.admin_digest', 'weekStart', p_week_start, 'weekEnd', p_week_end, 'picks', jsonb_array_length(v_picks)), 'system', 'instant'
      from public.users u where u.role = 'ADMIN' and u.is_active and u.account_status = 'ACTIVE';
    get diagnostics v_n = row_count;
    update public.ai_admin_digests set recipients = v_n, sent_at = now() where week_start = p_week_start returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;
revoke all on function app_private.ai_admin_digest_build(date, date, boolean, uuid) from public, anon, authenticated;

-- Cron Thứ Hai 00:00 UTC = 07:00 giờ VN: tuần vừa qua (Thứ Hai → Chủ nhật). Gửi một lần mỗi tuần; chạy lại trong ngày không gửi trùng.
create or replace function app_private.ai_admin_send_digest(p_now timestamptz default now())
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_today date := (coalesce(p_now, now()) at time zone 'Asia/Ho_Chi_Minh')::date; v_start date; v_row jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:ai_admin_digest')) then return 0; end if;
  v_start := date_trunc('week', v_today)::date - 7;
  if exists (select 1 from public.ai_admin_digests d where d.week_start = v_start and d.sent_at is not null) then return 0; end if;
  v_row := app_private.ai_admin_digest_build(v_start, v_start + 6, true, null);
  return coalesce((v_row->>'recipients')::int, 0);
end $$;
revoke all on function app_private.ai_admin_send_digest(timestamptz) from public, anon, authenticated;

do $$ begin perform cron.unschedule('ai-admin-weekly-digest'); exception when others then null; end $$;
select cron.schedule('ai-admin-weekly-digest', '0 0 * * 1', 'select app_private.ai_admin_send_digest();');

-- ── RPC cho Trung tâm AI (Admin) ───────────────────────────────────────────────────────────────────────────────────────
create or replace function public.ai_admin_digest_list_v1(p_limit integer default 8)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not public.is_admin() then null else (
    select coalesce(jsonb_agg(to_jsonb(d) order by d.week_start desc), '[]'::jsonb) from (select * from public.ai_admin_digests order by week_start desc limit greatest(1, least(coalesce(p_limit, 8), 52))) d) end;
$$;
revoke all on function public.ai_admin_digest_list_v1(integer) from public, anon;
grant execute on function public.ai_admin_digest_list_v1(integer) to authenticated;

-- Dựng ngay (xem thử tuần đang chạy hoặc tuần trước); p_send = true thì gửi mọi Admin (chỉ khi tuần đó chưa gửi).
create or replace function public.ai_admin_digest_run_v1(p_week_start date default null, p_send boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_start date; v_end date;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  v_start := coalesce(p_week_start, date_trunc('week', v_today)::date);
  if extract(isodow from v_start) <> 1 then raise exception 'AI_DIGEST_WEEK_START_MONDAY' using errcode = '22023'; end if;
  if v_start > v_today then raise exception 'AI_DIGEST_WEEK_FUTURE' using errcode = '22023'; end if;
  v_end := least(v_start + 6, v_today);
  return app_private.ai_admin_digest_build(v_start, v_end, coalesce(p_send, false), public.current_app_user_id());
end $$;
revoke all on function public.ai_admin_digest_run_v1(date, boolean) from public, anon;
grant execute on function public.ai_admin_digest_run_v1(date, boolean) to authenticated;
