-- Trợ lý v2 · T2d "nhật ký từ báo cáo Zalo" (chủ SP duyệt 18/10/2026): người lập dán tin Zalo vào khung chat → Trợ lý ghi lệnh nháp
-- 'daily_log' (dự án + nguyên văn báo cáo); thẻ đọc báo cáo bằng ĐÚNG bộ của màn Nhật ký (skill daily_log_from_report, cửa sổ kế hoạch,
-- trí nhớ cách gọi) → người dùng sửa hạng mục, bấm "Tạo phiếu nháp" → phiếu kỹ sư nháp bằng đúng RPC phiếu (create_daily_log_source_v2 …).
--   * assistant_daily_log_projects_v1: dự án người hỏi được ghi nhật ký — đúng quyền Room daily_log · edit như lệnh tạo phiếu.
--   * assistant_command_create_v1: nháp tới 20.000 ký tự (báo cáo Zalo nhiều ngày); xem trước giữ 8.000.

alter table public.assistant_commands drop constraint if exists assistant_commands_kind_check;
alter table public.assistant_commands add constraint assistant_commands_kind_check
  check (kind in ('leave_request', 'material_request', 'purchase_order', 'daily_log'));

create or replace function public.assistant_command_create_v1(p_run_id uuid, p_kind text, p_title text, p_payload jsonb, p_preview jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); c public.assistant_commands;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  if not exists (select 1 from public.ai_runs r where r.id = p_run_id and r.user_id = a and r.skill_code = 'assistant_chat' and r.status = 'started') then
    raise exception 'ASSISTANT_COMMAND_RUN_INVALID' using errcode = '42501';
  end if;
  if (select count(*) from public.assistant_commands where run_id = p_run_id) >= 3 then
    raise exception 'ASSISTANT_COMMAND_TOO_MANY' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_preview) <> 'object' or length(p_payload::text) > 20000 or length(p_preview::text) > 8000 then
    raise exception 'ASSISTANT_COMMAND_BAD_INPUT' using errcode = '22023';
  end if;
  insert into public.assistant_commands (user_id, run_id, kind, title, payload, preview, created_at)
    values (a, p_run_id, p_kind, left(btrim(coalesce(p_title, '')), 160), p_payload, p_preview, clock_timestamp()) returning * into c;
  return app_private.assistant_command_row(c);
end $$;

create or replace function public.assistant_daily_log_projects_v1(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_app_user_id() is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'siteId', p.construction_site_id, 'status', p.status)
      order by coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last)
    from (
      select p.* from public.projects p
      where coalesce(p.status, '') <> 'cancelled' and not coalesce(p.is_hidden, false)
        and app_private.current_actor_has_effective_room_action(p.id, p.construction_site_id::text, 'daily_log', 'edit')
      order by coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last
      limit least(greatest(coalesce(p_limit, 200), 1), 200)
    ) p), '[]'::jsonb);
end $$;

revoke all on function public.assistant_daily_log_projects_v1(integer) from public, anon;
grant execute on function public.assistant_daily_log_projects_v1(integer) to authenticated;
