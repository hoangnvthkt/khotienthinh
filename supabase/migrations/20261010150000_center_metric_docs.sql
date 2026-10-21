-- ===========================================================================
-- Bảng điều khiển — bấm tới chứng từ (chủ SP 10/10): mọi con số tiền của 3 bảng Tiến độ dự án, Dòng tiền & chi phí, Thu chi & công nợ
-- mở ra đúng các chứng từ tạo nên số đó (hợp đồng, phiếu điều chỉnh, đợt nghiệm thu / thu tiền, giao dịch chi phí, dòng ngân sách,
-- chứng từ công nợ NCC / thầu phụ, tạm ứng), mỗi dòng có liên kết mở đúng màn chứng từ.
-- * Cùng nguồn và cùng điều kiện lọc với get_center_dashboard_v1 → cộng các dòng ra đúng con số trên bảng (total tính trên toàn bộ,
--   rows tối đa 500 dòng mới nhất / lớn nhất).
-- * Quyền: phạm vi dự án như bảng (cdb_actor_scope) và chỉ dự án được xem tài chính (finance_project_visible).
-- * p_month (yyyy-mm) cho số theo tháng: doanh thu nghiệm thu, chi phí, tiền CĐT trả, tiền đã chi NCC.
-- * p_category cho chi phí theo nhóm (materials | labor | machinery | subcontract | overhead | other).
-- ===========================================================================

create function public.get_center_metric_docs_v1(p_metric text, p_project_id text default null, p_month text default null, p_category text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_access text[]; v_ids text[]; v_admin boolean; v_fin text[];
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_m date; v_m_end date;
  v_rows jsonb; v_total numeric; v_count bigint;
begin
  select s.access, s.ids, s.admin into v_access, v_ids, v_admin from app_private.cdb_actor_scope(public.current_app_user_id()) s;
  if cardinality(v_access) = 0 then raise exception using errcode = '42501', message = 'DASHBOARD_DENIED'; end if;
  if p_metric not in ('contract', 'budget', 'accepted', 'received', 'cost', 'cash_in', 'cash_out',
      'ar_requested', 'ar_outstanding', 'ar_overdue', 'ar_retention', 'ar_advance', 'ar_recovered',
      'ap_requested', 'ap_outstanding', 'ap_overdue', 'ap_retention', 'ap_paid', 'ap_advance', 'sub_total', 'sub_paid', 'sup_total', 'sup_paid')
    or (p_month is not null and p_month !~ '^\d{4}-\d{2}$')
    or (p_category is not null and p_category not in ('materials', 'labor', 'machinery', 'subcontract', 'overhead', 'other')) then
    raise exception using errcode = '22023', message = 'DASHBOARD_DOCS_INVALID';
  end if;
  if p_project_id is not null and not (p_project_id = any(v_ids)) then raise exception using errcode = '42501', message = 'DASHBOARD_DENIED'; end if;
  select coalesce(array_agg(x), '{}') into v_fin from unnest(case when p_project_id is null then v_ids else array[p_project_id] end) x
  where v_admin or app_private.finance_project_visible(x);
  if p_project_id is not null and cardinality(v_fin) = 0 then raise exception using errcode = '42501', message = 'DASHBOARD_FINANCE_DENIED'; end if;
  if p_month is not null then v_m := (p_month || '-01')::date; v_m_end := (v_m + interval '1 month')::date; end if;

  -- Mỗi nhánh một loại chứng từ; nhánh không khớp p_metric bị bỏ ngay khi chạy (điều kiện hằng).
  with d (at, id, date, code, title, partner, project_id, amount, due, link_type, link_id) as (
    -- Giá trị HĐ = HĐ CĐT (chưa VAT) + phiếu điều chỉnh CĐT đã duyệt.
    select c.signed_date, c.id, c.signed_date, coalesce(c.code, c.id), coalesce(c.name, 'Hợp đồng chủ đầu tư'), c.customer_name, c.project_id,
      coalesce(c.value, 0), null::date, 'contract', c.id
    from public.customer_contracts c
    where p_metric = 'contract' and c.project_id = any(v_fin) and coalesce(c.status, '') not in ('cancelled', 'draft')
    union all
    select coalesce(v.adjustment_date, v.approved_at::date), v.id::text, coalesce(v.adjustment_date, v.approved_at::date), coalesce(v.code, 'Điều chỉnh'),
      'Phát sinh: ' || coalesce(v.title, ''), null, v.project_id, coalesce(v.total_amount_delta, 0), null, 'project_finance', v.project_id
    from public.contract_variations v
    where p_metric = 'contract' and v.project_id = any(v_fin) and v.contract_type = 'customer' and v.status = 'approved'
    union all
    -- Ngân sách: dòng khoản mục (vật tư = dự toán vật tư sống) như Chi phí & ngân sách.
    select null, p.id || ':' || coalesce(l.cost_item_id::text, '-'), null, coalesce(ci.symbol, '—'), coalesce(ci.name, 'Khoản mục'), null, p.id,
      l.budget, null, 'cost', p.id
    from unnest(v_fin) p(id) cross join lateral app_private.finance_project_cost_lines(p.id, null) l
    left join public.contract_cost_items ci on ci.id = l.cost_item_id
    where p_metric = 'budget' and l.budget is not null
    union all
    -- Đợt phải thu CĐT: doanh thu nghiệm thu, tiền đã thu, đề nghị thanh toán, còn nợ, quá hạn.
    select coalesce(x.confirmed_date, r.sent_date, r.created_at::date), x.id::text,
      case p_metric when 'received' then coalesce(x.last_received, x.confirmed_date)
        when 'accepted' then coalesce(r.confirmed_date, r.legacy_received_date, r.sent_date, r.created_at::date) else coalesce(x.confirmed_date, r.sent_date) end,
      coalesce(c.code, c.id) || ' · đợt ' || x.sequence_no,
      case x.kind when 'advance' then 'Tạm ứng' when 'settlement' then 'Quyết toán' when 'retention' then 'Thu tiền giữ lại' when 'opening' then 'Số dư đầu kỳ'
        when 'progress' then 'Nghiệm thu' else 'Đợt khác' end || coalesce(' — ' || nullif(r.description, ''), ''),
      c.customer_name, c.project_id,
      case p_metric when 'accepted' then r.net_amount when 'received' then x.received when 'ar_requested' then x.gross else x.outstanding end,
      x.due_date, 'receivable', c.id
    from app_private.finance_receivable_round_rows() x
    join public.customer_contracts c on c.id = x.contract_id and c.project_id = any(v_fin)
    join public.finance_receivable_rounds r on r.id = x.id
    where p_metric in ('accepted', 'received', 'ar_requested', 'ar_outstanding', 'ar_overdue')
      and case p_metric
        when 'accepted' then x.status = 'confirmed' and x.kind in ('progress', 'settlement', 'other')
          and (v_m is null or (coalesce(r.confirmed_date, r.legacy_received_date, r.sent_date, r.created_at::date) >= v_m
            and coalesce(r.confirmed_date, r.legacy_received_date, r.sent_date, r.created_at::date) < v_m_end))
        when 'received' then x.received > 0.5
        when 'ar_requested' then x.status in ('sent', 'confirmed') and x.kind in ('progress', 'settlement', 'other')
        when 'ar_outstanding' then x.outstanding > 0.5
        else x.outstanding > 0.5 and x.due_date < v_today end
    union all
    -- Giữ lại / tạm ứng còn lại / tạm ứng đã khấu trừ: theo hợp đồng (có tính số dư đầu kỳ đã chốt).
    select c.signed_date, c.id, c.signed_date, coalesce(c.code, c.id), coalesce(c.name, 'Hợp đồng chủ đầu tư'), c.customer_name, c.project_id,
      (m.x->>case p_metric when 'ar_retention' then 'retentionHeld' when 'ar_advance' then 'advanceRemaining' else 'advanceRecovered' end)::numeric,
      null, 'receivable', c.id
    from public.customer_contracts c cross join lateral (select app_private.finance_customer_contract_metrics(c.id) x) m
    where p_metric in ('ar_retention', 'ar_advance', 'ar_recovered') and c.project_id = any(v_fin) and coalesce(c.status, '') not in ('cancelled', 'draft')
    union all
    -- Sổ giao dịch dự án: chi phí (theo nhóm), tiền CĐT trả, tiền đã chi NCC.
    select left(t.date, 10)::date, t.id, left(t.date, 10)::date, coalesce(nullif(t.invoice_no, ''), nullif(t.contract_cost_item_symbol_snapshot, ''), '—'),
      coalesce(nullif(t.description, ''), case p_metric when 'cash_in' then 'Tiền chủ đầu tư trả' when 'cash_out' then 'Chi trả nhà cung cấp' else 'Chi phí' end),
      t.counterparty_name, t.project_id, t.amount, null, 'project_finance', t.project_id
    from public.project_transactions t
    where p_metric in ('cost', 'cash_in', 'cash_out') and t.project_id = any(v_fin) and t.date ~ '^\d{4}-\d{2}-\d{2}'
      and case p_metric
        when 'cost' then t.type = 'expense' and coalesce(t.source_ref, '') not like 'supplier_payment_batch:%'
          and (p_category is null or case when t.category in ('materials', 'labor', 'machinery', 'subcontract', 'overhead', 'other') then t.category else 'other' end = p_category)
        when 'cash_in' then t.type = 'revenue_received'
        else t.type = 'expense' and t.source_ref like 'supplier_payment_batch:%' end
      and (v_m is null or (left(t.date, 10)::date >= v_m and left(t.date, 10)::date < v_m_end))
    union all
    -- Tạm ứng NCC / thầu phụ chưa khấu trừ.
    select a.paid_date, a.id::text, a.paid_date, a.code, 'Tạm ứng chưa khấu trừ', a.supplier_name, a.project_id, a.remaining, a.repay_due_date,
      'request', a.id::text
    from app_private.finance_advance_rows() a
    where p_metric = 'ap_advance' and a.project_id = any(v_fin) and a.status = 'paid' and a.remaining > 0.5
    union all
    -- Chứng từ công nợ NCC / thầu phụ (không tính đối tác nội bộ); có subcontract_id = thầu phụ.
    select x.document_date, x.id::text, x.document_date, coalesce(nullif(x.document_no, ''), x.code), coalesce(x.contract_code, x.source_type),
      x.supplier_name, x.project_id,
      case when p_metric in ('ap_requested', 'sub_total', 'sup_total') then x.recognized - x.credit when p_metric in ('ap_paid', 'sub_paid', 'sup_paid') then x.paid
        else x.outstanding end,
      x.due_date, case when d.subcontract_id is not null then 'subcontract' when x.supplier_id is not null then 'payable' else 'project_finance' end,
      coalesce(d.subcontract_id, x.supplier_id, x.project_id)
    from app_private.finance_payable_rows() x join public.supplier_payable_documents d on d.id = x.id
    where p_metric in ('ap_requested', 'ap_outstanding', 'ap_overdue', 'ap_retention', 'ap_paid', 'sub_total', 'sub_paid', 'sup_total', 'sup_paid')
      and not x.internal and x.project_id = any(v_fin)
      and case p_metric
        when 'ap_requested' then true
        when 'ap_outstanding' then x.outstanding > 0.5
        when 'ap_overdue' then x.outstanding > 0.5 and x.due_date < v_today
        when 'ap_retention' then x.outstanding > 0.5 and x.source_type = 'subcontract_retention'
        when 'ap_paid' then x.paid > 0.5
        when 'sub_total' then d.subcontract_id is not null
        when 'sub_paid' then d.subcontract_id is not null and x.paid > 0.5
        when 'sup_total' then d.subcontract_id is null
        else d.subcontract_id is null and x.paid > 0.5 end
  ), kept as materialized (select * from d where abs(coalesce(d.amount, 0)) > 0.5)
  select coalesce((select sum(d.amount) from d), 0),
    (select count(*) from kept),
    (select jsonb_agg(z.o) from (
      select jsonb_build_object('id', k.id, 'date', k.date, 'code', k.code, 'title', k.title, 'partner', k.partner, 'projectId', k.project_id,
          'projectCode', p.code, 'amount', k.amount, 'due', k.due, 'linkType', k.link_type, 'linkId', k.link_id) o
      from kept k join public.projects p on p.id = k.project_id
      order by k.at desc nulls last, abs(k.amount) desc limit 500) z)
  into v_total, v_count, v_rows;
  return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'total', v_total, 'count', v_count);
end $$;

revoke all on function public.get_center_metric_docs_v1(text, text, text, text) from public, anon;
grant execute on function public.get_center_metric_docs_v1(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
