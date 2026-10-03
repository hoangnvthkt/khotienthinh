-- Tài chính đợt 1 (chủ SP duyệt mockup fn-v1 + 5 câu, 03/10/2026): Tổng quan cho TGĐ / GĐTC và Sức khỏe dự án.
--
-- * Chỉ người có quyền Tài chính — Quản trị (hoặc Admin) xem số liệu toàn công ty.
-- * Mỗi dự án: giá trị HĐ chủ đầu tư, tiến độ theo Gantt (giống màn dự án), sản lượng ước tính = tiến độ × HĐ (nhãn "ước tính"),
--   đã thu (đợt thu đã nhận), tạm ứng chủ đầu tư, chi phí ghi nhận theo khoản mục và theo tháng, dự toán vật tư,
--   phải trả NCC (còn nợ / quá hạn / đến hạn 7 ngày). Số chưa có nguồn trả null để giao diện hiện "Chưa có dữ liệu", không hiện 0.
-- * Chi phí = giao dịch chi phí của dự án, trừ dòng ghi sổ chi tiền NCC (đã tách khỏi chi phí).

create or replace function app_private.finance_project_gantt_progress(p_project_id text)
returns numeric
language sql stable security definer set search_path = ''
as $$
  -- Như calculateProjectProgress: việc lá, trọng số = chi phí/ngày × thời lượng, không có thì thời lượng × số nhân lực.
  with leaf as (
    select t.progress, t.is_milestone, t.estimated_cost_per_day, t.resource_count,
      case when coalesce(t.is_milestone, false) then 1 when coalesce(t.duration, 0) > 0 then t.duration
        else greatest(1, coalesce(t.end_date::date - t.start_date::date, 1)) end dur
    from public.project_tasks t
    where t.project_id = p_project_id and not exists (select 1 from public.project_tasks c where c.parent_id = t.id)
  ), w as (
    select least(greatest(coalesce(progress, 0), 0), 100) pr,
      case when coalesce(estimated_cost_per_day, 0) * dur > 0 then estimated_cost_per_day * dur else dur * greatest(1, coalesce(resource_count, 1)) end wt
    from leaf
  )
  select case when sum(wt) > 0 then round(sum(pr * wt) / sum(wt)) end from w;
$$;

create or replace function public.get_finance_overview_v1()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('view') then
    raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  if not app_private.finance_can('manage') then
    return jsonb_build_object('canOverview', false, 'today', v_today, 'projects', '[]'::jsonb);
  end if;
  return (
    with scope as (
      select p.id, p.code, p.name, p.status, p.construction_site_id::text site_id
      from public.projects p
      where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')
        and (exists (select 1 from public.customer_contracts c where c.project_id = p.id)
          or exists (select 1 from public.project_transactions t where t.project_id = p.id))
    ),
    tx as (
      select t.project_id, left(t.date, 7) m, t.type, coalesce(nullif(t.category, ''), 'other') category, sum(t.amount) amount
      from public.project_transactions t join scope s on s.id = t.project_id
      where t.type in ('expense', 'revenue_received') and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
      group by 1, 2, 3, 4
    ),
    ap as (
      select r.project_id, sum(r.outstanding) outstanding,
        sum(r.outstanding) filter (where r.due_date < v_today) overdue,
        sum(r.outstanding) filter (where r.due_date >= v_today and r.due_date <= v_today + 7) soon,
        count(*) filter (where r.outstanding > 0.5) docs
      from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal group by 1
    ),
    recv as (
      select coalesce(ps.project_id, s.id) project_id, jsonb_agg(jsonb_build_object('description', ps.description, 'amount', ps.amount,
        'paidAmount', ps.paid_amount, 'dueDate', ps.due_date, 'paidDate', ps.paid_date, 'status', ps.status,
        'advance', coalesce(ps.milestone_type, '') = 'advance' or ps.description ilike '%tạm ứng%') order by ps.due_date) rows,
        sum(ps.paid_amount) filter (where ps.status = 'paid' and (coalesce(ps.milestone_type, '') = 'advance' or ps.description ilike '%tạm ứng%')) advance
      from public.payment_schedules ps
      join scope s on s.id = ps.project_id or (ps.project_id is null and s.site_id is not null and ps.construction_site_id = s.site_id)
      where ps.type = 'receivable'
      group by 1
    )
    select jsonb_build_object('canOverview', true, 'today', v_today,
      'projects', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'code', s.code, 'name', s.name, 'status', s.status,
        'contractValue', (select nullif(sum(c.value), 0) from public.customer_contracts c where c.project_id = s.id),
        'progress', app_private.finance_project_gantt_progress(s.id),
        'received', coalesce((select sum(x.amount) from tx x where x.project_id = s.id and x.type = 'revenue_received'), 0),
        'advanceReceived', r.advance,
        'cost', coalesce((select sum(x.amount) from tx x where x.project_id = s.id and x.type = 'expense'), 0),
        'costByCategory', coalesce((select jsonb_object_agg(z.category, z.amount) from (select x.category, sum(x.amount) amount from tx x
          where x.project_id = s.id and x.type = 'expense' group by 1) z), '{}'::jsonb),
        'months', coalesce((select jsonb_agg(jsonb_build_object('month', z.m, 'in', z.inn, 'out', z.out) order by z.m) from (
          select x.m, sum(x.amount) filter (where x.type = 'revenue_received') inn, sum(x.amount) filter (where x.type = 'expense') out
          from tx x where x.project_id = s.id group by 1) z), '[]'::jsonb),
        'materialBudget', (select nullif(sum(m.budget_total), 0) from public.material_budget_items m where m.project_id = s.id),
        'payable', jsonb_build_object('outstanding', coalesce(a.outstanding, 0), 'overdue', coalesce(a.overdue, 0), 'soon', coalesce(a.soon, 0), 'docs', coalesce(a.docs, 0)),
        'receivables', coalesce(r.rows, '[]'::jsonb))
        order by coalesce((select sum(x.amount) from tx x where x.project_id = s.id), 0) desc, s.code)
        from scope s left join ap a on a.project_id = s.id left join recv r on r.project_id = s.id), '[]'::jsonb),
      'companyPayable', (select jsonb_build_object('outstanding', coalesce(sum(r.outstanding), 0), 'docs', count(*))
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and r.project_id is null)
    )
  );
end;
$$;

revoke all on function app_private.finance_project_gantt_progress(text) from public, anon, authenticated;
revoke all on function public.get_finance_overview_v1() from public, anon;
grant execute on function public.get_finance_overview_v1() to authenticated;

notify pgrst, 'reload schema';
