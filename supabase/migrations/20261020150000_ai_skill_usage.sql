-- Trung tâm AI · tab Skill · ngăn "Xem bên trong" (chủ SP 19/10/2026): lượt dùng N ngày theo skill, theo công cụ Trợ lý, theo loại thẻ.
-- Lời dặn / mô tả công cụ lấy từ mã cổng AI đang chạy (ai-gateway action "catalog"), không chép vào bảng.
-- Công cụ đọc từ summary của lượt Trợ lý: "…, tra tim_ho_so chuan_bi_don_mua, …" (cùng cách app_private.ai_chat_topic). Chỉ Quản trị AI (Admin).
create or replace function public.get_ai_skill_usage_v1(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 90);
  v_since timestamptz;
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  v_since := now() - make_interval(days => v_days);
  return jsonb_build_object(
    'days', v_days,
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', s.code, 'name', s.name, 'description', s.description, 'tier', s.tier, 'mode', s.mode, 'modelClass', s.model_class,
        'enabled', s.enabled, 'access', s.access, 'dailyLimit', s.daily_limit,
        'runs', u.runs, 'people', u.people, 'ok', u.ok, 'errors', u.errors, 'blocked', u.blocked,
        'costUsd', round(u.cost, 4), 'likes', u.likes, 'dislikes', u.dislikes, 'lastAt', u.last_at
      ) order by s.name)
      from public.ai_skills s
      cross join lateral (
        select count(*) as runs, count(distinct r.user_id) as people,
          count(*) filter (where r.status = 'ok') as ok,
          count(*) filter (where r.status in ('error', 'no_provider')) as errors,
          count(*) filter (where r.status in ('denied', 'quota', 'refused')) as blocked,
          coalesce(sum(r.cost_usd), 0) as cost,
          count(*) filter (where r.accepted) as likes, count(*) filter (where r.accepted = false) as dislikes,
          max(r.created_at) as last_at
        from public.ai_runs r
        where r.skill_code = s.code and r.created_at >= v_since
      ) u
    ), '[]'::jsonb),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('tool', t.tool, 'runs', t.runs, 'people', t.people, 'lastAt', t.last_at) order by t.runs desc, t.tool)
      from (
        select x.tool, count(distinct r.id) as runs, count(distinct r.user_id) as people, max(r.created_at) as last_at
        from public.ai_runs r
        cross join lateral regexp_split_to_table(substring(r.summary from '(?:^|, )tra ([a-z_]+(?: [a-z_]+)*)'), ' ') as x(tool)
        where r.skill_code = 'assistant_chat' and r.created_at >= v_since and x.tool <> ''
        group by x.tool
      ) t
    ), '[]'::jsonb),
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object('kind', c.kind, 'prepared', c.prepared, 'done', c.done) order by c.kind)
      from (
        select command.kind, count(*) as prepared, count(*) filter (where command.status = 'done') as done
        from public.assistant_commands command
        where command.created_at >= v_since
        group by command.kind
      ) c
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.get_ai_skill_usage_v1(integer) from public, anon;
grant execute on function public.get_ai_skill_usage_v1(integer) to authenticated;
