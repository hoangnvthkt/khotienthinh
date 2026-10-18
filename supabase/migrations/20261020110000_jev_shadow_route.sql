-- Trợ lý v2 · J1 (chủ SP 18/10/2026): Jev (TypeSafe AI) chạy bóng cạnh hội thoại.
--   * Kết nối loại 'typesafe' (Cài đặt → Kết nối) và tính năng 'ai.decisions' ("Trợ lý · điều hướng Jev") để gán kết nối đó.
--   * Bảng ai_decisions: mỗi lượt hội thoại một dòng — Jev dự đoán ý định / câu đòi thao tác cấm (+ xác suất) cạnh việc model chính
--     thực làm (công cụ đã gọi, từ chối). KHÔNG lưu nội dung câu hỏi. Chỉ Admin đọc; cổng ghi bằng JWT người hỏi qua RPC.
--   * Kết nối typesafe không phải model hội thoại → không hiện trong danh sách model Trung tâm AI chọn cho người dùng.
--   J0 (scripts/jev-evals, 18/10): ý định 87 %, lệnh cấm 15/15, conf ≥ 0,85 đúng 100 %.

alter table public.integration_connections drop constraint if exists integration_connections_kind_check;
alter table public.integration_connections add constraint integration_connections_kind_check
  check (kind in ('anthropic', 'gemini', 'openai', 'openai_compatible', 'typesafe'));

alter table public.integration_assignments drop constraint if exists integration_assignments_feature_check;
alter table public.integration_assignments add constraint integration_assignments_feature_check
  check (feature in ('ai.fast', 'ai.reasoning', 'wms.doc_reader', 'ai.assistant', 'ai.decisions'));
insert into public.integration_assignments (feature) values ('ai.decisions') on conflict (feature) do nothing;

create table if not exists public.ai_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_runs(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('intent_route')),
  status text not null check (status in ('ok', 'error')),
  model text,
  error text check (error is null or char_length(error) <= 200),
  duration_ms integer,
  tokens_in integer,
  predicted jsonb check (predicted is null or jsonb_typeof(predicted) = 'object'),
  actual jsonb not null default '{}'::jsonb check (jsonb_typeof(actual) = 'object'),
  agree boolean,
  cam_agree boolean,
  created_at timestamptz not null default now()
);
comment on table public.ai_decisions is 'J1 Jev chạy bóng: dự đoán có kiểu (ý định, câu đòi thao tác cấm, xác suất) cạnh việc model chính thực làm. Không lưu nội dung câu hỏi.';
create index if not exists ai_decisions_created_idx on public.ai_decisions (created_at desc);
create index if not exists ai_decisions_run_idx on public.ai_decisions (run_id);
alter table public.ai_decisions enable row level security;
drop policy if exists ai_decisions_admin_select on public.ai_decisions;
create policy ai_decisions_admin_select on public.ai_decisions for select to authenticated using (public.is_admin());
grant select on public.ai_decisions to authenticated;

-- Cổng ghi một dòng cho lượt của chính người hỏi (lượt phải tồn tại và thuộc người đó); mỗi lượt tối đa một dòng mỗi loại.
create or replace function public.ai_decision_log_v1(p_run_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); v_kind text := coalesce(p->>'kind', 'intent_route'); v_status text := coalesce(p->>'status', 'error'); v_id uuid;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_runs r where r.id = p_run_id and r.user_id = a) then raise exception 'AI_RUN_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_kind not in ('intent_route') then raise exception 'AI_BAD_INPUT' using errcode = '22023'; end if;
  if v_status not in ('ok', 'error') then v_status := 'error'; end if;
  if exists (select 1 from public.ai_decisions d where d.run_id = p_run_id and d.kind = v_kind) then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  insert into public.ai_decisions (run_id, user_id, kind, status, model, error, duration_ms, tokens_in, predicted, actual, agree, cam_agree)
  values (p_run_id, a, v_kind, v_status, left(p->>'model', 120), left(p->>'error', 200), (p->>'durationMs')::integer, (p->>'tokensIn')::integer,
    case when jsonb_typeof(p->'predicted') = 'object' then p->'predicted' end,
    case when jsonb_typeof(p->'actual') = 'object' then p->'actual' else '{}'::jsonb end,
    (p->>'agree')::boolean, (p->>'camAgree')::boolean)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function public.ai_decision_log_v1(uuid, jsonb) to authenticated;

-- Admin: tổng kết chạy bóng N ngày — số lượt, khớp ý định theo tầng confidence (auto ≥ 0,85 / verify ≥ 0,6 / ask), lệnh cấm, lỗi, thời gian.
create or replace function public.get_ai_decisions_summary_v1(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 14), 1));
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', greatest(coalesce(p_days, 14), 1),
    'runs', (select count(*) from public.ai_decisions d where d.created_at >= v_from),
    'errors', (select count(*) from public.ai_decisions d where d.created_at >= v_from and d.status = 'error'),
    'compared', (select count(*) from public.ai_decisions d where d.created_at >= v_from and d.agree is not null),
    'agree', (select count(*) from public.ai_decisions d where d.created_at >= v_from and d.agree),
    'avgMs', (select round(avg(d.duration_ms)) from public.ai_decisions d where d.created_at >= v_from and d.status = 'ok'),
    'tiers', coalesce((select jsonb_object_agg(t.tier, jsonb_build_object('runs', t.n, 'compared', t.c, 'agree', t.a)) from (
        select coalesce(d.predicted->>'tier', 'n/a') tier, count(*) n, count(*) filter (where d.agree is not null) c, count(*) filter (where d.agree) a
        from public.ai_decisions d where d.created_at >= v_from and d.status = 'ok' group by 1) t), '{}'::jsonb),
    'byIntent', coalesce((select jsonb_object_agg(t.intent, jsonb_build_object('runs', t.n, 'compared', t.c, 'agree', t.a)) from (
        select coalesce(d.predicted->>'intent', 'n/a') intent, count(*) n, count(*) filter (where d.agree is not null) c, count(*) filter (where d.agree) a
        from public.ai_decisions d where d.created_at >= v_from and d.status = 'ok' group by 1) t), '{}'::jsonb),
    'cam', jsonb_build_object(
      'flagged', (select count(*) from public.ai_decisions d where d.created_at >= v_from and (d.predicted->>'cam')::numeric >= 0.5),
      'refused', (select count(*) from public.ai_decisions d where d.created_at >= v_from and d.actual->>'refusal' = 'thao_tac_cam'),
      'compared', (select count(*) from public.ai_decisions d where d.created_at >= v_from and d.cam_agree is not null),
      'agree', (select count(*) from public.ai_decisions d where d.created_at >= v_from and d.cam_agree)),
    'models', coalesce((select jsonb_agg(distinct d.model) from public.ai_decisions d where d.created_at >= v_from and d.model is not null), '[]'::jsonb));
end $$;
grant execute on function public.get_ai_decisions_summary_v1(integer) to authenticated;

-- Trung tâm AI: danh sách kết nối để Admin chọn model cho người dùng — bỏ loại typesafe (không phải model hội thoại).
create or replace function public.get_ai_admin_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'templates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'connectionId', t.connection_id, 'monthlyCostCapUsd', t.monthly_cost_cap_usd,
        'dailyQuestionCap', t.daily_question_cap, 'skills', to_jsonb(t.skills), 'note', t.note, 'extraConnectionIds', to_jsonb(t.extra_connection_ids),
        'users', (select count(*) from public.ai_user_grants g where g.template_id = t.id)) order by t.name) from public.ai_grant_templates t), '[]'::jsonb),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('userId', g.user_id, 'name', u.name, 'email', u.email, 'role', u.role, 'active', coalesce(u.is_active, true),
        'enabled', g.enabled, 'templateId', g.template_id, 'connectionId', g.connection_id, 'monthlyCostCapUsd', g.monthly_cost_cap_usd,
        'dailyQuestionCap', g.daily_question_cap, 'skills', to_jsonb(g.skills), 'note', g.note, 'updatedAt', g.updated_at, 'extraConnectionIds', to_jsonb(g.extra_connection_ids),
        'effective', app_private.ai_effective_grant(g.user_id), 'usage', app_private.ai_user_usage(g.user_id)) order by u.name)
      from public.ai_user_grants g join public.users u on u.id = g.user_id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'access', s.access, 'enabled', s.enabled, 'dailyLimit', s.daily_limit) order by s.name)
      from public.ai_skills s where s.code <> 'gateway_check'), '[]'::jsonb),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'model', c.model, 'enabled', c.enabled, 'pricePerCall', c.price_per_call,
        'displayName', c.display_name, 'blurb', c.blurb, 'icon', c.icon, 'vision', c.vision) order by c.name)
      from public.integration_connections c where c.kind <> 'typesafe'), '[]'::jsonb),
    'settings', (select jsonb_build_object('monthlyCostCapUsd', st.monthly_cost_cap_usd, 'monthlyRunCap', st.monthly_run_cap) from public.ai_settings st where st.id = 1),
    'month', (select jsonb_build_object('runs', count(*), 'costUsd', round(coalesce(sum(r.cost_usd), 0), 4)) from public.ai_runs r
      where r.created_at >= date_trunc('month', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' and r.status in ('started', 'ok', 'error', 'refused')));
end $$;
