-- Trợ lý B2 (chủ SP 21/10/2026): phiếu sự cố từ Trợ lý. Người dùng kể lỗi / gửi ảnh màn hình → Trợ lý CHUẨN BỊ thẻ "issue_report"
-- (assistant_commands) → người dùng bấm Gửi Admin → màn hình tạo góp ý ở module Góp ý sẵn có (feedback_items + ảnh đính kèm + thông báo
-- cho Admin) bằng phiên người dùng. Không bảng mới. Jev (TypeSafe) phân loại loại góp ý + mức khẩn, ghi so sánh vào ai_decisions kind 'issue_class'.

-- 1. Loại thẻ mới
alter table public.assistant_commands drop constraint if exists assistant_commands_kind_check;
alter table public.assistant_commands add constraint assistant_commands_kind_check
  check (kind in ('leave_request', 'material_request', 'purchase_order', 'daily_log', 'memory_note', 'work_task', 'issue_report'));

-- 2. Quyết định Jev loại mới
alter table public.ai_decisions drop constraint if exists ai_decisions_kind_check;
alter table public.ai_decisions add constraint ai_decisions_kind_check check (kind in ('intent_route', 'issue_class'));

create or replace function public.ai_decision_log_v1(p_run_id uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); v_kind text := coalesce(p->>'kind', 'intent_route'); v_status text := coalesce(p->>'status', 'error'); v_id uuid;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_runs r where r.id = p_run_id and r.user_id = a) then raise exception 'AI_RUN_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_kind not in ('intent_route', 'issue_class') then raise exception 'AI_BAD_INPUT' using errcode = '22023'; end if;
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
