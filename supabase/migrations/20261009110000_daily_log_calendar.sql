-- Nhật ký công trường — trang chính chỉ còn lịch tháng (chủ SP 07/10/2026).
-- Mỗi ngày: số phiếu đã gửi / bị trả / nháp của tôi, số người, trạng thái bản tổng hợp và người được gửi duyệt,
-- để ô lịch hiện đúng việc của từng vai trò (ghi phiếu, tổng hợp, duyệt). Chỉ đọc; cùng quyền Báo cáo ngày.

create or replace function public.get_daily_log_calendar_v1(
  p_project_id text, p_construction_site_id text, p_from date, p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor text := public.current_app_user_id()::text;
begin
  if v_actor is null or not (public.is_admin() or app_private.current_actor_has_effective_room_action(
    p_project_id, nullif(p_construction_site_id, ''), 'daily_log', 'view')) then
    raise exception using errcode = '42501', message = 'DAILY_LOG_VIEW_REQUIRED';
  end if;
  if p_to < p_from or p_to - p_from > 62 then
    raise exception using errcode = '22023', message = 'DAILY_LOG_CALENDAR_RANGE_INVALID';
  end if;
  return coalesce((
    with scoped as (
      select c.id, c.date, c.status, c.author_user_id, nullif(btrim(c.issues), '') issues
      from public.daily_log_contributions c
      where c.project_id = p_project_id
        and (nullif(p_construction_site_id, '') is null or c.construction_site_id = p_construction_site_id)
        and c.date between p_from and p_to
        and (c.status <> 'draft' or c.author_user_id = v_actor)
    ),
    people as (
      select l.contribution_id, sum(coalesce(l.people_count, l.count, 0)) people
      from public.daily_log_labor l
      where l.contribution_id in (select id from scoped) and l.daily_log_id is null
      group by 1
    ),
    slip_days as (
      select s.date,
        count(*) filter (where s.status in ('submitted', 'included')) sent,
        count(*) filter (where s.status = 'returned') returned,
        count(*) filter (where s.status = 'draft') my_drafts,
        coalesce(sum(p.people) filter (where s.status in ('submitted', 'included')), 0) people,
        bool_or(s.status <> 'draft' and s.issues is not null) has_issue
      from scoped s left join people p on p.contribution_id = s.id
      group by s.date
    ),
    summaries as (
      select distinct on (left(d.date, 10)) left(d.date, 10)::date on_day, d.id, d.status, d.submitted_to_user_id,
        d.worker_count, nullif(btrim(d.issues), '') issues
      from public.daily_logs d
      where d.project_id = p_project_id
        and (nullif(p_construction_site_id, '') is null or d.construction_site_id = p_construction_site_id)
        and d.summary_source_type = 'member_contributions' and d.superseded_by_daily_log_id is null
        and left(d.date, 10) between p_from::text and p_to::text
      order by left(d.date, 10), coalesce(d.revision_no, 1) desc, d.created_at desc
    )
    select jsonb_agg(jsonb_build_object(
      'date', coalesce(sd.date, sm.on_day),
      'sent', coalesce(sd.sent, 0), 'returned', coalesce(sd.returned, 0), 'myDrafts', coalesce(sd.my_drafts, 0),
      'people', coalesce(nullif(sd.people, 0), sm.worker_count, 0),
      'summaryId', sm.id, 'summaryStatus', sm.status, 'submittedToUserId', sm.submitted_to_user_id,
      'hasIssue', coalesce(sd.has_issue, false) or sm.issues is not null
    ) order by coalesce(sd.date, sm.on_day))
    from slip_days sd full join summaries sm on sm.on_day = sd.date
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_daily_log_calendar_v1(text, text, date, date) from public, anon;
grant execute on function public.get_daily_log_calendar_v1(text, text, date, date) to authenticated;
