-- Trợ lý · báo cáo đợt A2 (chủ SP 22/10/2026): 7 RPC tổng hợp cho công cụ bao_cao — tiến độ dự án theo tuần + lý do chậm, tài chính
-- (thu / chi theo kỳ, chi theo hạng mục, công nợ NCC), chấm công, nghỉ phép theo phòng, yêu cầu theo mẫu / dự án, đặt xe, văn bản.
--   * SECURITY INVOKER (chạy dưới RLS của người hỏi) cho các bảng có RLS theo người: mỗi người chỉ thấy số trong phạm vi mình được xem.
--   * Tài chính: SECURITY DEFINER + app_private.finance_can('view') như module Tài chính (bảng giao dịch không tách quyền theo dòng);
--     công nợ NCC chỉ khi finance_can('manage') (như Tổng quan Tài chính).
--   * Không ghi gì. Khoảng tối đa ~13 tháng; nhóm theo tuần hoặc tháng. Ngày ở các bảng cũ là text 'YYYY-MM-DD' → so sánh chuỗi.

-- ── 1. Tiến độ dự án theo kỳ + hạng mục chậm + lý do chậm ─────────────────────────────────────────────────────────────────
create or replace function public.assistant_report_progress_v1(p_from date, p_to date, p_group text default 'week', p_project_id text default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval; v_project record; v_today text := to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  if p_project_id is null then raise exception using errcode = '22023', message = 'REPORT_PROJECT_REQUIRED'; end if;
  select p.id, p.code, p.name, p.construction_site_id::text as site_id into v_project from public.projects p where p.id = p_project_id;
  if v_project.id is null then return null; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with tasks as (
      select t.id, t.name, t.start_date, t.end_date, t.progress, t.is_milestone, t.delay_category, t.delay_reason,
        greatest(1, coalesce(nullif(t.end_date, '')::date - nullif(t.start_date, '')::date, 0) + 1) as w,
        not exists (select 1 from public.project_tasks c where c.parent_id = t.id) as leaf
      from public.project_tasks t
      where t.project_id = v_project.id or (v_project.site_id is not null and t.construction_site_id = v_project.site_id)
    ),
    logs as (
      select l.id, l.date, l.status from public.daily_logs l
      where (l.project_id = v_project.id or (v_project.site_id is not null and l.construction_site_id = v_project.site_id))
        and l.date >= to_char(p_from, 'YYYY-MM-DD') and l.date <= to_char(p_to, 'YYYY-MM-DD')
    ),
    items as (
      select w.task_id, l.date, w.cumulative_progress_percent as pct, w.daily_quantity_done as dq
      from public.daily_log_work_items w join public.daily_logs l on l.id = w.daily_log_id
      where (w.project_id = v_project.id or (v_project.site_id is not null and w.construction_site_id = v_project.site_id)) and l.status = 'verified' and l.date <= to_char(p_to, 'YYYY-MM-DD')
    ),
    buckets as (select b::date as b_start, (b + v_step)::date as b_end from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'project', jsonb_build_object('id', v_project.id, 'code', v_project.code, 'name', v_project.name),
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'logs', (select count(*) from logs where logs.date >= to_char(b.b_start, 'YYYY-MM-DD') and logs.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'logsVerified', (select count(*) from logs where logs.status = 'verified' and logs.date >= to_char(b.b_start, 'YYYY-MM-DD') and logs.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'tasksUpdated', (select count(distinct task_id) from items where items.date >= to_char(b.b_start, 'YYYY-MM-DD') and items.date < to_char(b.b_end, 'YYYY-MM-DD')),
          -- % cuối kỳ: hạng mục lá có nhật ký duyệt tới cuối kỳ, lấy % tích lũy mới nhất, trọng số = số ngày kế hoạch (#288).
          'progressEnd', (select round(sum(x.pct * t.w) / nullif(sum(t.w), 0), 1) from (
              select distinct on (i.task_id) i.task_id, i.pct from items i where i.date < to_char(b.b_end, 'YYYY-MM-DD') order by i.task_id, i.date desc) x
            join tasks t on t.id = x.task_id where t.leaf)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'now', jsonb_build_object(
        'tasks', (select count(*) from tasks where leaf and is_milestone is not true),
        'done', (select count(*) from tasks where leaf and is_milestone is not true and coalesce(progress, 0) >= 100),
        'late', (select count(*) from tasks where leaf and is_milestone is not true and coalesce(progress, 0) < 100 and end_date < v_today),
        'progress', (select round(sum(coalesce(progress, 0) * w) / nullif(sum(w), 0), 1) from tasks where leaf and is_milestone is not true),
        'tracked', (select count(distinct task_id) from items)),
      'lateTasks', (select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'end', t.end_date, 'progress', coalesce(t.progress, 0), 'days', (v_today::date - t.end_date::date),
          'reason', coalesce(t.delay_reason, t.delay_category)) order by t.end_date, t.name), '[]'::jsonb)
        from (select * from tasks where leaf and is_milestone is not true and coalesce(progress, 0) < 100 and end_date < v_today and end_date ~ '^\d{4}-\d{2}-\d{2}$' order by end_date limit 6) t),
      'delays', (select coalesce(jsonb_agg(jsonb_build_object('category', d.category, 'count', d.n, 'days', d.days) order by d.n desc), '[]'::jsonb) from (
          select coalesce(e.category, 'khac') category, count(*) n, coalesce(sum(e.impact_days), 0) days from public.project_delay_events e
          where (e.project_id = v_project.id or (v_project.site_id is not null and e.construction_site_id = v_project.site_id)) and e.occurred_on >= p_from and e.occurred_on <= p_to
          group by 1 order by n desc limit 8) d)
    ));
end $$;
revoke all on function public.assistant_report_progress_v1(date, date, text, text) from public, anon;
grant execute on function public.assistant_report_progress_v1(date, date, text, text) to authenticated;

-- ── 2. Tài chính: thu / chi theo kỳ, chi theo hạng mục, theo dự án, công nợ NCC hiện tại ───────────────────────────────
create or replace function public.assistant_report_finance_v1(p_from date, p_to date, p_group text default 'month', p_project_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_step interval; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_manage boolean;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_manage := app_private.finance_can('manage');
  v_step := ('1 ' || p_group)::interval;
  return (
    with tx as (
      select t.project_id, t.date, t.type, coalesce(nullif(t.category, ''), 'other') category, t.amount
      from public.project_transactions t
      where t.type in ('expense', 'revenue_received') and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
        and t.date >= to_char(p_from, 'YYYY-MM-DD') and t.date <= to_char(p_to, 'YYYY-MM-DD')
        and (p_project_id is null or t.project_id = p_project_id)
    ),
    buckets as (select b::date as b_start, (b + v_step)::date as b_end from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group, 'canManage', v_manage,
      'project', (select jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) from public.projects p where p.id = p_project_id),
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'in', (select coalesce(sum(amount), 0) from tx where type = 'revenue_received' and tx.date >= to_char(b.b_start, 'YYYY-MM-DD') and tx.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'out', (select coalesce(sum(amount), 0) from tx where type = 'expense' and tx.date >= to_char(b.b_start, 'YYYY-MM-DD') and tx.date < to_char(b.b_end, 'YYYY-MM-DD'))
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'totalIn', (select coalesce(sum(amount), 0) from tx where type = 'revenue_received'),
      'totalOut', (select coalesce(sum(amount), 0) from tx where type = 'expense'),
      'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('name', c.category, 'amount', c.amount) order by c.amount desc), '[]'::jsonb)
        from (select category, sum(amount) amount from tx where type = 'expense' group by 1 order by 2 desc limit 8) c),
      'byProject', (select coalesce(jsonb_agg(jsonb_build_object('code', coalesce(p.code, 'Khác'), 'in', c.inn, 'out', c.outt) order by c.outt desc), '[]'::jsonb)
        from (select project_id, sum(amount) filter (where type = 'revenue_received') inn, sum(amount) filter (where type = 'expense') outt from tx group by 1 order by 3 desc nulls last limit 8) c
        left join public.projects p on p.id = c.project_id),
      'payable', case when v_manage then (select jsonb_build_object('outstanding', coalesce(sum(r.outstanding), 0), 'overdue', coalesce(sum(r.outstanding) filter (where r.due_date < v_today), 0),
          'soon', coalesce(sum(r.outstanding) filter (where r.due_date >= v_today and r.due_date <= v_today + 7), 0), 'docs', count(*),
          'top', (select coalesce(jsonb_agg(jsonb_build_object('name', s.supplier_name, 'outstanding', s.o) order by s.o desc), '[]'::jsonb) from (
              select x.supplier_name, sum(x.outstanding) o from app_private.finance_payable_rows() x where x.outstanding > 0.5 and not x.internal and (p_project_id is null or x.project_id = p_project_id)
              group by 1 order by 2 desc limit 6) s))
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and (p_project_id is null or r.project_id = p_project_id)) else null end
    ));
end $$;
revoke all on function public.assistant_report_finance_v1(date, date, text, text) from public, anon;
grant execute on function public.assistant_report_finance_v1(date, date, text, text) to authenticated;

-- ── 3. Chấm công theo kỳ (RLS hrm_attendance: của mình / người quản lý / HR) ───────────────────────────────────────────
create or replace function public.assistant_report_attendance_v1(p_from date, p_to date, p_group text default 'week')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with att as (
      select a."employeeId" as emp, a.date, coalesce(a.status, 'present') status, a."constructionSiteId" as site_id, a."locationName" as loc, coalesce(a."isOutOfRange", false) oor
      from public.hrm_attendance a where a.date >= to_char(p_from, 'YYYY-MM-DD') and a.date <= to_char(p_to, 'YYYY-MM-DD')
    ),
    buckets as (select b::date as b_start, (b + v_step)::date as b_end from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'present', (select count(*) from att where status = 'present' and att.date >= to_char(b.b_start, 'YYYY-MM-DD') and att.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'people', (select count(distinct emp) from att where status = 'present' and att.date >= to_char(b.b_start, 'YYYY-MM-DD') and att.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'leave', (select count(*) from att where status = 'leave' and att.date >= to_char(b.b_start, 'YYYY-MM-DD') and att.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'trip', (select count(*) from att where status = 'business_trip' and att.date >= to_char(b.b_start, 'YYYY-MM-DD') and att.date < to_char(b.b_end, 'YYYY-MM-DD')),
          'outOfRange', (select count(*) from att where oor and att.date >= to_char(b.b_start, 'YYYY-MM-DD') and att.date < to_char(b.b_end, 'YYYY-MM-DD'))
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'people', (select count(distinct emp) from att),
      'records', (select count(*) from att),
      'bySite', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'count', s.n) order by s.n desc), '[]'::jsonb) from (
          select coalesce(cs.name, nullif(att.loc, ''), 'Chưa rõ') name, count(*) n from att left join public.hrm_construction_sites cs on cs.id::text = att.site_id
          where att.status = 'present' group by 1 order by 2 desc limit 8) s)
    ));
end $$;
revoke all on function public.assistant_report_attendance_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_attendance_v1(date, date, text) to authenticated;

-- ── 4. Nghỉ phép theo kỳ, theo loại, theo đơn vị (RLS hrm_leave_requests: của mình / duyệt / HR) ──────────────────────
-- Bảng employees không mở cho authenticated (HRM đi qua RPC): tên đơn vị lấy qua hàm definer chỉ trả (mã NV → tên đơn vị) cho đúng các mã đưa vào.
create or replace function app_private.assistant_employee_unit_names(p_ids uuid[])
returns table (employee_id uuid, unit_name text) language sql stable security definer set search_path = '' as $$
  select e.id, o.name from public.employees e left join public.org_units o on o.id = e.org_unit_id where e.id = any(coalesce(p_ids, '{}'::uuid[]));
$$;
revoke all on function app_private.assistant_employee_unit_names(uuid[]) from public, anon;
grant execute on function app_private.assistant_employee_unit_names(uuid[]) to authenticated;
create or replace function public.assistant_report_leave_v1(p_from date, p_to date, p_group text default 'month')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with lv as (
      select r.id, r."employeeId" as emp, r.type, r.status, r."startDate" as d, coalesce(r."totalDays", 0) days
      from public.hrm_leave_requests r where r."startDate" >= to_char(p_from, 'YYYY-MM-DD') and r."startDate" <= to_char(p_to, 'YYYY-MM-DD')
    ),
    buckets as (select b::date as b_start, (b + v_step)::date as b_end from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'requests', (select count(*) from lv where lv.d >= to_char(b.b_start, 'YYYY-MM-DD') and lv.d < to_char(b.b_end, 'YYYY-MM-DD')),
          'approvedDays', (select coalesce(sum(days), 0) from lv where status = 'approved' and lv.d >= to_char(b.b_start, 'YYYY-MM-DD') and lv.d < to_char(b.b_end, 'YYYY-MM-DD')),
          'pending', (select count(*) from lv where status = 'pending' and lv.d >= to_char(b.b_start, 'YYYY-MM-DD') and lv.d < to_char(b.b_end, 'YYYY-MM-DD'))
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'total', (select count(*) from lv), 'people', (select count(distinct emp) from lv),
      'byStatus', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from lv group by 1) s),
      'byType', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(t.name, c.type), 'count', c.n, 'days', c.days) order by c.n desc), '[]'::jsonb)
        from (select type, count(*) n, sum(days) filter (where status = 'approved') days from lv group by 1 order by 2 desc limit 8) c left join public.hrm_leave_types t on t.code = c.type),
      'byUnit', (select coalesce(jsonb_agg(jsonb_build_object('name', u.name, 'count', u.n, 'days', u.days) order by u.days desc nulls last), '[]'::jsonb) from (
          select coalesce(un.unit_name, 'Chưa xếp đơn vị') name, count(*) n, sum(lv.days) filter (where lv.status = 'approved') days
          from lv left join app_private.assistant_employee_unit_names((select array_agg(distinct emp) from lv)) un on un.employee_id = lv.emp group by 1 order by 3 desc nulls last limit 8) u),
      'pendingNow', (select count(*) from public.hrm_leave_requests r where r.status = 'pending')
    ));
end $$;
revoke all on function public.assistant_report_leave_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_leave_v1(date, date, text) to authenticated;

-- ── 5. Yêu cầu (module Yêu cầu / đề xuất): theo kỳ, mẫu, dự án (RLS requests) ───────────────────────────────────────────
create or replace function public.assistant_report_requests_v1(p_from date, p_to date, p_group text default 'month')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with rq as (
      select r.id, r.status::text status, coalesce(r.created_date, r.created_at) at, r.workflow_template_id tpl, r.project_id
      from public.requests r where coalesce(r.created_date, r.created_at) >= p_from and coalesce(r.created_date, r.created_at) < p_to + 1
    ),
    buckets as (select b::date as b_start from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'created', (select count(*) from rq where rq.at >= b.b_start and rq.at < b.b_start + v_step),
          'approved', (select count(*) from rq where status in ('APPROVED', 'IN_TRANSIT', 'COMPLETED') and rq.at >= b.b_start and rq.at < b.b_start + v_step),
          'rejected', (select count(*) from rq where status = 'REJECTED' and rq.at >= b.b_start and rq.at < b.b_start + v_step),
          'pending', (select count(*) from rq where status = 'PENDING' and rq.at >= b.b_start and rq.at < b.b_start + v_step)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'total', (select count(*) from rq),
      'byStatus', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from rq group by 1) s),
      'byTemplate', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(t.name, 'Không qua mẫu'), 'count', c.n) order by c.n desc), '[]'::jsonb)
        from (select tpl, count(*) n from rq group by 1 order by 2 desc limit 8) c left join public.workflow_templates t on t.id = c.tpl),
      'byProject', (select coalesce(jsonb_agg(jsonb_build_object('code', coalesce(p.code, 'Khác'), 'count', c.n) order by c.n desc), '[]'::jsonb)
        from (select project_id, count(*) n from rq group by 1 order by 2 desc limit 8) c left join public.projects p on p.id = c.project_id),
      'pendingNow', (select count(*) from public.requests r where r.status::text = 'PENDING'),
      'pendingStale', (select count(*) from public.requests r where r.status::text = 'PENDING' and coalesce(r.last_action_at, r.created_at) < now() - interval '3 days')
    ));
end $$;
revoke all on function public.assistant_report_requests_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_requests_v1(date, date, text) to authenticated;

-- ── 6. Đặt xe: theo kỳ, trạng thái, đơn vị, loại chuyến (RLS vehicle_bookings) ─────────────────────────────────────────
create or replace function public.assistant_report_vehicle_v1(p_from date, p_to date, p_group text default 'month')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with vb as (
      select b.id, coalesce(b.status, 'DRAFT') status, coalesce(b.requested_pickup_at, b.created_at) at, b.department_id_snapshot unit_id, coalesce(b.trip_type, 'KHAC') trip, coalesce(b.passenger_count, 0) pax
      from public.vehicle_bookings b where coalesce(b.requested_pickup_at, b.created_at) >= p_from and coalesce(b.requested_pickup_at, b.created_at) < p_to + 1
    ),
    buckets as (select b::date as b_start from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'bookings', (select count(*) from vb where vb.at >= b.b_start and vb.at < b.b_start + v_step),
          'completed', (select count(*) from vb where status = 'COMPLETED' and vb.at >= b.b_start and vb.at < b.b_start + v_step),
          'cancelled', (select count(*) from vb where status in ('CANCELLED', 'REJECTED') and vb.at >= b.b_start and vb.at < b.b_start + v_step)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'total', (select count(*) from vb), 'passengers', (select coalesce(sum(pax), 0) from vb where status not in ('CANCELLED', 'REJECTED', 'DRAFT')),
      'byStatus', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from vb group by 1) s),
      'byUnit', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(o.name, 'Chưa rõ đơn vị'), 'count', c.n) order by c.n desc), '[]'::jsonb)
        from (select unit_id, count(*) n from vb group by 1 order by 2 desc limit 8) c left join public.org_units o on o.id = c.unit_id),
      'byTrip', (select coalesce(jsonb_agg(jsonb_build_object('name', c.trip, 'count', c.n) order by c.n desc), '[]'::jsonb) from (select trip, count(*) n from vb group by 1) c),
      'openNow', (select count(*) from public.vehicle_bookings b where coalesce(b.status, '') in ('SUBMITTED', 'PENDING', 'PENDING_MANAGER', 'APPROVED', 'ASSIGNED'))
    ));
end $$;
revoke all on function public.assistant_report_vehicle_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_vehicle_v1(date, date, text) to authenticated;

-- ── 7. Văn bản: đến / đi / thông báo theo kỳ, trạng thái, loại, quá hạn xử lý (RLS office_documents) ────────────────────
create or replace function public.assistant_report_office_v1(p_from date, p_to date, p_group text default 'month')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_step interval; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if public.current_app_user_id() is null then raise exception using errcode = '42501', message = 'AI_DENIED'; end if;
  if p_from is null or p_to is null or p_from > p_to then raise exception using errcode = '22023', message = 'REPORT_RANGE_INVALID'; end if;
  if p_group not in ('week', 'month') then raise exception using errcode = '22023', message = 'REPORT_GROUP_INVALID'; end if;
  if p_to - p_from > 400 then raise exception using errcode = '22023', message = 'REPORT_RANGE_TOO_LONG'; end if;
  v_step := ('1 ' || p_group)::interval;
  return (
    with od as (
      select d.id, coalesce(d.document_group, 'KHAC') grp, coalesce(d.status, 'DRAFT') status, coalesce(d.document_date, d.received_date, d.created_at::date) at, d.document_type_id type_id,
        (d.due_date is not null and d.due_date < v_today and d.processing_completed_at is null and coalesce(d.status, '') not in ('ARCHIVED', 'REVOKED')) overdue
      from public.office_documents d where coalesce(d.document_date, d.received_date, d.created_at::date) >= p_from and coalesce(d.document_date, d.received_date, d.created_at::date) <= p_to
    ),
    buckets as (select b::date as b_start, (b + v_step)::date as b_end from generate_series(date_trunc(p_group, p_from::timestamp)::date, p_to, v_step) b)
    select jsonb_build_object(
      'from', p_from, 'to', p_to, 'group', p_group,
      'buckets', (select coalesce(jsonb_agg(jsonb_build_object(
          'start', b.b_start,
          'incoming', (select count(*) from od where grp = 'INCOMING' and od.at >= b.b_start and od.at < b.b_end),
          'outgoing', (select count(*) from od where grp = 'OUTGOING' and od.at >= b.b_start and od.at < b.b_end),
          'other', (select count(*) from od where grp not in ('INCOMING', 'OUTGOING') and od.at >= b.b_start and od.at < b.b_end)
        ) order by b.b_start), '[]'::jsonb) from buckets b),
      'total', (select count(*) from od),
      'byStatus', (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select status, count(*) n from od group by 1) s),
      'byGroup', (select coalesce(jsonb_object_agg(s.grp, s.n), '{}'::jsonb) from (select grp, count(*) n from od group by 1) s),
      'byType', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(t.name, 'Chưa phân loại'), 'count', c.n) order by c.n desc), '[]'::jsonb)
        from (select type_id, count(*) n from od group by 1 order by 2 desc limit 8) c left join public.office_document_types t on t.id = c.type_id),
      'overdue', (select count(*) from od where overdue),
      'processingNow', (select count(*) from public.office_documents d where d.processing_completed_at is null and d.assigned_to is not null and coalesce(d.status, '') not in ('ARCHIVED', 'REVOKED', 'DRAFT'))
    ));
end $$;
revoke all on function public.assistant_report_office_v1(date, date, text) from public, anon;
grant execute on function public.assistant_report_office_v1(date, date, text) to authenticated;
