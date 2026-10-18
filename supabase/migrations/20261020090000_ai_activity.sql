-- Trung tâm AI · tab "Hoạt động" (chủ SP chốt 18/10/2026, mở Trợ lý cho nhóm 15 người): Quản trị AI xem AI có giúp được việc thật không —
-- ai hỏi bao nhiêu, hỏi về gì (theo công cụ Trợ lý đã gọi), thẻ nháp đã GỬI THẬT hay bị bỏ, 👍 / 👎 + lý do, chạm trần, chi phí theo model.
-- Chỉ số liệu tổng hợp + ghi chú người dùng tự viết khi chấm 👎; không đọc nội dung câu hỏi / câu trả lời (quyết định câu 3, 17/10).

-- Chủ đề của một lượt Trợ lý theo công cụ đã gọi (ghi trong summary "… tra a b c, …").
create or replace function app_private.ai_chat_topic(p_summary text, p_error text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_summary like '%từ chối (%' then 'refused'
    when p_summary ~ 'tra [a-z_ ]*chuan_bi_don_mua' then 'purchase_order'
    when p_summary ~ 'tra [a-z_ ]*chuan_bi_de_xuat_vat_tu' then 'material_request'
    when p_summary ~ 'tra [a-z_ ]*chuan_bi_nhat_ky' then 'daily_log'
    when p_summary ~ 'tra [a-z_ ]*chuan_bi_don_nghi_phep' then 'leave_request'
    when p_summary ~ 'tra [a-z_ ]*chuan_bi_ghi_nho' then 'memory_note'
    when p_summary ~ 'tra [a-z_ ]*(tim_ho_so|ton_kho|chi_tiet_don_mua|chi_tiet_de_xuat|viec_cua_toi)' then 'lookup'
    else 'chat' end;
$$;

create or replace function public.get_ai_activity_v1(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 14), 1), 90);
  v_from timestamptz := date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh' - make_interval(days => v_days - 1);
begin
  if not public.is_admin() then raise exception 'AI_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', v_days, 'from', v_from,
    -- Tổng: câu hỏi Trợ lý, người hỏi, chi phí mọi skill, đánh giá.
    'totals', (select jsonb_build_object(
        'questions', count(*) filter (where r.skill_code = 'assistant_chat' and r.status in ('ok', 'error', 'refused')),
        'askers', count(distinct r.user_id) filter (where r.skill_code = 'assistant_chat' and r.status in ('ok', 'error', 'refused')),
        'runs', count(*) filter (where r.status in ('ok', 'error', 'refused')),
        'costUsd', round(coalesce(sum(r.cost_usd), 0), 4),
        'likes', count(*) filter (where r.accepted), 'dislikes', count(*) filter (where r.accepted = false),
        'errors', count(*) filter (where r.status = 'error'),
        'blocked', count(*) filter (where r.status in ('quota', 'denied')),
        'withFiles', count(*) filter (where r.summary ~ '(bảng tính|ảnh)'))
      from public.ai_runs r where r.created_at >= v_from),
    'granted', (select count(*) from public.ai_user_grants g where g.enabled),
    -- Câu hỏi theo ngày (giờ VN).
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'questions', d.n, 'people', d.p) order by d.day)
      from (select (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date as day, count(*) n, count(distinct r.user_id) p from public.ai_runs r
            where r.created_at >= v_from and r.skill_code = 'assistant_chat' and r.status in ('ok', 'error', 'refused') group by 1) d), '[]'::jsonb),
    -- Hỏi về gì.
    'topics', coalesce((select jsonb_agg(jsonb_build_object('topic', t.topic, 'questions', t.n) order by t.n desc)
      from (select app_private.ai_chat_topic(coalesce(r.summary, ''), r.error) topic, count(*) n from public.ai_runs r
            where r.created_at >= v_from and r.skill_code = 'assistant_chat' and r.status in ('ok', 'refused') group by 1) t), '[]'::jsonb),
    -- Thẻ nháp: chuẩn bị → đã gửi thật / bỏ / lỗi / còn treo (quá 24 giờ = hết hạn).
    'commands', coalesce((select jsonb_agg(jsonb_build_object('kind', c.kind, 'prepared', c.n, 'done', c.done, 'cancelled', c.cancelled, 'failed', c.failed,
        'open', c.open, 'expired', c.expired) order by c.n desc)
      from (select kind, count(*) n, count(*) filter (where status = 'done') done, count(*) filter (where status = 'cancelled') cancelled,
              count(*) filter (where status = 'failed') failed,
              count(*) filter (where status = 'prepared' and created_at > now() - interval '24 hours') open,
              count(*) filter (where status = 'prepared' and created_at <= now() - interval '24 hours') expired
            from public.assistant_commands where created_at >= v_from group by kind) c), '[]'::jsonb),
    -- Theo người: người được cấp + người có dùng AI trong kỳ.
    'people', coalesce((select jsonb_agg(p order by (p->>'questions')::int desc, p->>'name') from (
      select jsonb_build_object('userId', u.id, 'name', u.name, 'granted', g.user_id is not null and g.enabled,
        'template', (select t.name from public.ai_grant_templates t where t.id = g.template_id),
        'questions', count(r.id) filter (where r.skill_code = 'assistant_chat' and r.status in ('ok', 'error', 'refused')),
        'runs', count(r.id) filter (where r.status in ('ok', 'error', 'refused')),
        'costUsd', round(coalesce(sum(r.cost_usd), 0), 4),
        'likes', count(r.id) filter (where r.accepted), 'dislikes', count(r.id) filter (where r.accepted = false),
        'blocked', count(r.id) filter (where r.status = 'quota'),
        'lastAt', max(r.created_at) filter (where r.status in ('ok', 'error', 'refused')),
        'commands', (select count(*) from public.assistant_commands c where c.user_id = u.id and c.created_at >= v_from),
        'done', (select count(*) from public.assistant_commands c where c.user_id = u.id and c.created_at >= v_from and c.status = 'done')) p
      from public.users u
      left join public.ai_user_grants g on g.user_id = u.id
      left join public.ai_runs r on r.user_id = u.id and r.created_at >= v_from
      where (g.user_id is not null and g.enabled) or r.id is not null
      group by u.id, u.name, g.user_id, g.enabled, g.template_id) x(p)), '[]'::jsonb),
    -- Theo model (lượt có model ghi lại).
    'models', coalesce((select jsonb_agg(jsonb_build_object('model', m.model, 'runs', m.n, 'costUsd', m.cost) order by m.n desc)
      from (select coalesce(nullif(r.model, ''), '—') model, count(*) n, round(coalesce(sum(r.cost_usd), 0), 4) cost from public.ai_runs r
            where r.created_at >= v_from and r.status in ('ok', 'error', 'refused') group by 1) m), '[]'::jsonb),
    -- 👎 gần đây (lý do + ghi chú người dùng tự viết).
    'dislikes', coalesce((select jsonb_agg(jsonb_build_object('at', d.feedback_at, 'name', d.name, 'skill', d.skill_code, 'reason', d.feedback_reason, 'note', d.feedback_note)
        order by d.feedback_at desc)
      from (select r.feedback_at, u.name, r.skill_code, r.feedback_reason, r.feedback_note from public.ai_runs r join public.users u on u.id = r.user_id
            where r.created_at >= v_from and r.accepted = false and r.feedback_at is not null order by r.feedback_at desc limit 20) d), '[]'::jsonb));
end $$;

revoke all on function app_private.ai_chat_topic(text, text) from public, anon, authenticated;
revoke all on function public.get_ai_activity_v1(integer) from public, anon;
grant execute on function public.get_ai_activity_v1(integer) to authenticated;
