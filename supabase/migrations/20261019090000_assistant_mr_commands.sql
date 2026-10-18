-- Trợ lý v2 · T2b "đề xuất vật tư" (chủ SP duyệt 18/10/2026). Trợ lý tách câu thành dòng vật tư + chọn dự án rồi ghi lệnh nháp
-- 'material_request'; thẻ nháp mở ĐÚNG form Đề xuất vật tư của dự án (Gõ nhanh điền sẵn các dòng) — người dùng khớp mã, kiểm, tự bấm
-- Lưu / Gửi như form thường. Lưu xong form ghi biên nhận (mã phiếu) vào lệnh. AI không có đường nào tự lập hay gửi phiếu.
--   * assistant_command_get_v1: form đọc lệnh nháp của chính người dùng (mở từ thẻ, tải lại trang vẫn mở được).
--   * assistant_mr_projects_v1: dự án người hỏi được lập đề xuất vật tư (đúng quyền project.material_request.create như RLS insert).

alter table public.assistant_commands drop constraint if exists assistant_commands_kind_check;
alter table public.assistant_commands add constraint assistant_commands_kind_check check (kind in ('leave_request', 'material_request'));

create or replace function public.assistant_command_get_v1(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id(); c public.assistant_commands;
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  select * into c from public.assistant_commands where id = p_id and user_id = a;
  if c.id is null then raise exception 'ASSISTANT_COMMAND_NOT_FOUND' using errcode = 'P0002'; end if;
  return app_private.assistant_command_row(c);
end $$;

-- Dự án đang chạy (không hủy, không ẩn) mà người hỏi được lập đề xuất vật tư; ghim / đang thi công lên trước. Cổng AI tự khớp tên.
create or replace function public.assistant_mr_projects_v1(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id();
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'siteId', p.construction_site_id, 'status', p.status)
      order by coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last)
    from (
      select p.* from public.projects p
      where coalesce(p.status, '') <> 'cancelled' and not coalesce(p.is_hidden, false)
        and app_private.material_has_action(p.id, p.construction_site_id::text, 'project.material_request.create', a)
      order by coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last
      limit least(greatest(coalesce(p_limit, 200), 1), 200)
    ) p), '[]'::jsonb);
end $$;

revoke all on function public.assistant_command_get_v1(uuid), public.assistant_mr_projects_v1(integer) from public, anon;
grant execute on function public.assistant_command_get_v1(uuid), public.assistant_mr_projects_v1(integer) to authenticated;
