-- Trợ lý: danh sách dự án cho lệnh nháp trả kèm tên chủ đầu tư (client_name) — người công trường gọi dự án theo tên CĐT
-- ("Dự án xinhai" ↔ DA29, CĐT "CÔNG TY TNHH XIN HAI VINA"); chủ SP thử nhật ký 18/10 bị hỏi lại vì tên dự án không có chữ đó.
-- Nhật ký: dự án có nhật ký gần đây xếp đầu (nút hỏi lại dự án ra đúng công trường đang chạy, không phải dự án ghim / mới sửa).

create or replace function public.assistant_mr_projects_v1(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a uuid := public.current_app_user_id();
begin
  if a is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'client', p.client_name, 'siteId', p.construction_site_id, 'status', p.status)
      order by coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last)
    from (
      select p.* from public.projects p
      where coalesce(p.status, '') <> 'cancelled' and not coalesce(p.is_hidden, false)
        and app_private.material_has_action(p.id, p.construction_site_id::text, 'project.material_request.create', a)
      order by coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last
      limit least(greatest(coalesce(p_limit, 200), 1), 200)
    ) p), '[]'::jsonb);
end $$;

create or replace function public.assistant_daily_log_projects_v1(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_app_user_id() is null then raise exception 'AI_DENIED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'client', p.client_name, 'siteId', p.construction_site_id, 'status', p.status)
      order by p.last_log desc nulls last, coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last)
    from (
      select p.*, (select max(l.date) from public.daily_logs l where l.project_id = p.id) last_log from public.projects p
      where coalesce(p.status, '') <> 'cancelled' and not coalesce(p.is_hidden, false)
        and app_private.current_actor_has_effective_room_action(p.id, p.construction_site_id::text, 'daily_log', 'edit')
      order by last_log desc nulls last, coalesce(p.is_pinned, false) desc, (p.status = 'active') desc, p.updated_at desc nulls last
      limit least(greatest(coalesce(p_limit, 200), 1), 200)
    ) p), '[]'::jsonb);
end $$;
