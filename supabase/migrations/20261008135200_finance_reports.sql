-- ===========================================================================
-- Báo cáo Tài chính (06/10/2026) — doc 15 mục 2 dòng "Báo cáo": tuổi nợ phải trả / phải thu, lãi lỗ theo dự án và theo tháng.
-- Một hàm đọc cho màn Tài chính → Báo cáo (quyền Tài chính — Xem). Số lấy từ cùng nguồn với các màn đã có
-- (công nợ: finance_payable_rows; phải thu: finance_receivable_round_rows; chi phí: project_transactions như Chi phí & ngân sách).
-- Nhóm tuổi nợ theo số ngày quá hạn so với hôm nay: chưa đến hạn, 1–30, 31–60, 61–90, trên 90, chưa có hạn.
-- ===========================================================================

create function public.get_finance_reports_v1(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_m0 date := (date_trunc('month', v_today) - interval '11 months')::date;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('today', v_today,
    'months', (select jsonb_agg((v_m0 + make_interval(months => k))::date order by k) from generate_series(0, 11) k),
    -- Tuổi nợ phải trả: theo NCC × dự án (màn cộng theo NCC hoặc theo dự án). Không tính đối tác nội bộ.
    'ap', coalesce((select jsonb_agg(jsonb_build_object('supplierId', x.supplier_id, 'supplierName', x.supplier_name, 'projectId', x.project_id, 'projectCode', x.project_code,
        'docs', x.n, 'outstanding', x.total, 'notDue', x.not_due, 'd30', x.d30, 'd60', x.d60, 'd90', x.d90, 'over90', x.over90, 'noDue', x.no_due,
        'pending', x.pending, 'oldestDue', x.oldest) order by x.total desc)
      from (select r.supplier_id, max(r.supplier_name) supplier_name, r.project_id, max(r.project_code) project_code, count(*) n, sum(r.outstanding) total,
          coalesce(sum(r.outstanding) filter (where r.due_date >= v_today), 0) not_due,
          coalesce(sum(r.outstanding) filter (where v_today - r.due_date between 1 and 30), 0) d30,
          coalesce(sum(r.outstanding) filter (where v_today - r.due_date between 31 and 60), 0) d60,
          coalesce(sum(r.outstanding) filter (where v_today - r.due_date between 61 and 90), 0) d90,
          coalesce(sum(r.outstanding) filter (where v_today - r.due_date > 90), 0) over90,
          coalesce(sum(r.outstanding) filter (where r.due_date is null), 0) no_due,
          coalesce(sum(r.pending_external + app_private.finance_doc_reserved(r.id, null)), 0) pending,
          min(r.due_date) filter (where r.due_date < v_today) oldest
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and r.status in ('open', 'partial')
        group by r.supplier_id, r.project_id) x), '[]'::jsonb),
    -- Tuổi nợ phải thu: theo HĐ CĐT; đợt đã gửi chờ xác nhận và tiền giữ lại bảo hành tách cột riêng.
    'ar', coalesce((select jsonb_agg(jsonb_build_object('contractId', c.id, 'contractCode', c.code, 'customerName', c.customer_name, 'projectId', c.project_id,
        'projectCode', p.code, 'outstanding', a.total, 'notDue', a.not_due, 'd30', a.d30, 'd60', a.d60, 'd90', a.d90, 'over90', a.over90, 'noDue', a.no_due,
        'sent', coalesce(s.sent, 0), 'retention', coalesce((m.met->>'retentionHeld')::numeric, 0), 'opening', m.met->>'opening', 'oldestDue', a.oldest)
        order by a.total desc nulls last, c.code)
      from public.customer_contracts c left join public.projects p on p.id = c.project_id
      cross join lateral (select app_private.finance_customer_contract_metrics(c.id) met) m
      left join lateral (select coalesce(sum(x.outstanding), 0) total,
          coalesce(sum(x.outstanding) filter (where x.due_date >= v_today), 0) not_due,
          coalesce(sum(x.outstanding) filter (where v_today - x.due_date between 1 and 30), 0) d30,
          coalesce(sum(x.outstanding) filter (where v_today - x.due_date between 31 and 60), 0) d60,
          coalesce(sum(x.outstanding) filter (where v_today - x.due_date between 61 and 90), 0) d90,
          coalesce(sum(x.outstanding) filter (where v_today - x.due_date > 90), 0) over90,
          coalesce(sum(x.outstanding) filter (where x.due_date is null), 0) no_due,
          min(x.due_date) filter (where x.due_date < v_today and x.outstanding > 0.5) oldest
        from app_private.finance_receivable_round_rows() x where x.contract_id = c.id and x.status = 'confirmed') a on true
      left join lateral (select sum(r.receivable) sent from public.finance_receivable_rounds r where r.contract_id = c.id and r.status = 'sent') s on true
      where coalesce(c.status, '') not in ('cancelled', 'draft')), '[]'::jsonb),
    -- Lãi lỗ theo dự án (chưa VAT). Doanh thu theo sản lượng = giá trị HĐ × tiến độ Gantt; theo nghiệm thu = đợt CĐT đã xác nhận (không gồm tạm ứng).
    'pl', coalesce((select jsonb_agg(jsonb_build_object('projectId', p.id, 'code', p.code, 'name', p.name, 'status', p.status,
        'contractNet', h.net, 'progress', cs->'progress', 'outputNet', case when (cs->>'progress') is not null then round(h.net * (cs->>'progress')::numeric / 100, 2) end,
        'acceptedNet', h.accepted, 'received', h.received, 'cost', (cs->>'actual')::numeric, 'committed', (cs->>'committed')::numeric, 'eac', cs->'eac',
        'budget', cs->'budget', 'byCategory', coalesce((select jsonb_object_agg(q.category, q.v) from (select coalesce(t.category, 'other') category, sum(t.amount) v
          from public.project_transactions t where t.project_id = p.id and t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
          group by 1) q), '{}'::jsonb)) order by h.net desc nulls last, p.code)
      from public.projects p cross join lateral (select app_private.finance_project_cost_summary(p.id) cs) z(cs)
      cross join lateral (select nullif(sum(coalesce(c.value, 0)), 0) net,
          (select coalesce(sum(r.net_amount), 0) from public.finance_receivable_rounds r join public.customer_contracts c2 on c2.id = r.contract_id
            where c2.project_id = p.id and r.status = 'confirmed' and r.kind in ('progress', 'settlement', 'other')) accepted,
          (select coalesce(sum(x.received), 0) from app_private.finance_receivable_round_rows() x where x.project_id = p.id) received
        from public.customer_contracts c where c.project_id = p.id and coalesce(c.status, '') not in ('cancelled', 'draft')) h
      where h.net is not null or (cs->>'actual')::numeric > 0.5), '[]'::jsonb),
    -- Theo tháng (12 tháng gần nhất): doanh thu nghiệm thu (chưa VAT), chi phí ghi nhận, tiền CĐT trả.
    'plMonths', coalesce((select jsonb_agg(jsonb_build_object('projectId', q.project_id, 'month', q.mon, 'accepted', q.accepted, 'cost', q.cost, 'cashIn', q.cash_in) order by q.project_id, q.mon)
      from (select coalesce(a.project_id, b.project_id, d.project_id) project_id, coalesce(a.mon, b.mon, d.mon) mon,
          coalesce(a.v, 0) accepted, coalesce(b.v, 0) cost, coalesce(d.v, 0) cash_in
        from (select c.project_id, date_trunc('month', coalesce(r.confirmed_date, r.legacy_received_date, r.sent_date, r.created_at::date))::date mon, sum(r.net_amount) v
            from public.finance_receivable_rounds r join public.customer_contracts c on c.id = r.contract_id
            where r.status = 'confirmed' and r.kind in ('progress', 'settlement', 'other') and c.project_id is not null group by 1, 2) a
        full join (select t.project_id, date_trunc('month', left(t.date, 10)::date)::date mon, sum(t.amount) v from public.project_transactions t
            where t.type = 'expense' and t.project_id is not null and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%' and t.date ~ '^\d{4}-\d{2}-\d{2}' group by 1, 2) b
          on b.project_id = a.project_id and b.mon = a.mon
        full join (select t.project_id, date_trunc('month', left(t.date, 10)::date)::date mon, sum(t.amount) v from public.project_transactions t
            where t.type = 'revenue_received' and t.project_id is not null and t.date ~ '^\d{4}-\d{2}-\d{2}' group by 1, 2) d
          on d.project_id = coalesce(a.project_id, b.project_id) and d.mon = coalesce(a.mon, b.mon)) q
      where q.mon >= v_m0 and q.mon <= v_today), '[]'::jsonb));
end $$;

revoke all on function public.get_finance_reports_v1(jsonb) from public, anon;
grant execute on function public.get_finance_reports_v1(jsonb) to authenticated;
