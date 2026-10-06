-- ===========================================================================
-- Dự báo dòng tiền 1 / 3 / 6 tháng (05–06/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/15-lo-trinh-tai-chinh-toan-dien.md mục 4, mockup .superpowers/cost/fc-v1.html.
-- Chủ SP duyệt 8 câu (phương án a):
--  1. Tiền CĐT về = cuối tháng nghiệm thu + số ngày CĐT duyệt (mặc định 15) + hạn thanh toán trên HĐ (mặc định 30) — mỗi HĐ sửa hạn được.
--  2. Sản lượng tương lai theo kế hoạch Gantt của phần việc chưa xong; việc trễ hạn dồn vào 30 ngày tới.
--  3. Vật tư dự toán chưa đặt: rải theo Gantt, trả sau số ngày trả NCC (mặc định 30).
--  4. Nhân công khi chưa có HĐ thầu phụ: ước theo % giá trị HĐ (mặc định 11,1% — tỷ lệ SMB), ghi rõ "ước tính".
--  5. Đơn mua quá hẹn > 30 ngày vẫn tính (dòng riêng); Mua hàng "Kết thúc thiếu" đơn NCC không giao là tự bỏ.
--  6. 3 kịch bản: Cơ sở / Thận trọng (CĐT trả chậm thêm 30 ngày + tiến độ chậm 20%) / Thuận lợi (CĐT trả sớm 15 ngày); Quản trị sửa được.
--  7. Xem: Quản trị Tài chính + Admin xem toàn công ty; người xem tài chính theo dự án chỉ thấy dự án của mình.
--  8. Khoản vay + khoản dự kiến: khai một lần hoặc import Excel; khoản định kỳ (đã có) tự lặp hằng tháng.
-- Dữ liệu còn thiếu → dòng "Chưa khai" + danh sách việc cần khai, không che bằng 0.
-- ===========================================================================

alter table public.finance_settings
  add column forecast_approval_days integer not null default 15 check (forecast_approval_days between 0 and 180),
  add column forecast_pay_days integer not null default 30 check (forecast_pay_days between 0 and 180),
  add column forecast_labor_percent numeric(6, 2) not null default 11.1 check (forecast_labor_percent between 0 and 100),
  add column forecast_material_vat_percent numeric(5, 2) not null default 8 check (forecast_material_vat_percent between 0 and 20),
  add column forecast_safe_delay_days integer not null default 30 check (forecast_safe_delay_days between 0 and 180),
  add column forecast_safe_slip_percent numeric(5, 2) not null default 20 check (forecast_safe_slip_percent between 0 and 200),
  add column forecast_good_early_days integer not null default 15 check (forecast_good_early_days between 0 and 90);

-- Khoản vay: lãi trả hằng tháng trên dư nợ; gốc trả một lần khi đáo hạn hoặc chia đều hằng tháng.
create table public.finance_loans (
  id uuid primary key default gen_random_uuid(),
  lender text not null check (length(btrim(lender)) > 0),
  contract_no text,
  project_id text references public.projects(id),
  outstanding numeric(18, 2) not null check (outstanding >= 0),
  interest_rate numeric(6, 3) not null default 0 check (interest_rate between 0 and 100),
  repay_kind text not null check (repay_kind in ('bullet', 'monthly')),
  maturity_date date not null,
  pay_day integer not null default 25 check (pay_day between 1 and 28),
  is_active boolean not null default true,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Khoản thu / chi dự kiến một lần (kế hoạch, chưa có chứng từ): nhập tay hoặc import Excel.
create table public.finance_forecast_items (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('in', 'out')),
  name text not null check (length(btrim(name)) > 0),
  category text not null default 'other',
  project_id text references public.projects(id),
  amount numeric(18, 2) not null check (amount > 0),
  expected_date date not null,
  confidence text not null default 'plan' check (confidence in ('sure', 'plan', 'est')),
  note text,
  import_batch uuid,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text
);
create index finance_forecast_items_active_idx on public.finance_forecast_items (expected_date) where is_active;

alter table public.finance_loans enable row level security;
alter table public.finance_forecast_items enable row level security;
create policy finance_loans_select on public.finance_loans for select to authenticated using (app_private.finance_can('view'));
create policy finance_forecast_items_select on public.finance_forecast_items for select to authenticated using (app_private.finance_can('view'));
revoke all on public.finance_loans, public.finance_forecast_items from anon;
grant select on public.finance_loans, public.finance_forecast_items to authenticated;

-- Phần giá trị dự án (0..1) sẽ làm trong từng tháng, theo việc lá Gantt còn dở (trọng số như finance_project_gantt_progress).
-- Việc trễ hạn: phần còn lại dồn vào 30 ngày tới. p_slip = % chậm tiến độ (kéo giãn thời gian còn lại).
create function app_private.finance_forecast_progress_months(p_project text, p_slip numeric)
returns table(month date, share numeric) language sql stable security definer set search_path = '' as $$
  with today as (select (now() at time zone 'Asia/Ho_Chi_Minh')::date d),
  leaf as (
    select least(greatest(coalesce(t.progress, 0), 0), 100) pr,
      case when coalesce(t.start_date, '') ~ '^\d{4}-\d{2}-\d{2}' then left(t.start_date, 10)::date end s,
      case when coalesce(t.end_date, '') ~ '^\d{4}-\d{2}-\d{2}' then left(t.end_date, 10)::date end e,
      case when coalesce(t.estimated_cost_per_day, 0) * (case when coalesce(t.is_milestone, false) then 1 when coalesce(t.duration, 0) > 0 then t.duration
          else greatest(1, coalesce(left(t.end_date, 10)::date - left(t.start_date, 10)::date, 1)) end) > 0
        then t.estimated_cost_per_day * (case when coalesce(t.is_milestone, false) then 1 when coalesce(t.duration, 0) > 0 then t.duration
          else greatest(1, coalesce(left(t.end_date, 10)::date - left(t.start_date, 10)::date, 1)) end)
        else (case when coalesce(t.is_milestone, false) then 1 when coalesce(t.duration, 0) > 0 then t.duration
          else greatest(1, coalesce(left(t.end_date, 10)::date - left(t.start_date, 10)::date, 1)) end) * greatest(1, coalesce(t.resource_count, 1)) end wt
    from public.project_tasks t
    where t.project_id = p_project and not exists (select 1 from public.project_tasks c where c.parent_id = t.id)
  ),
  tot as (select sum(wt) w from leaf),
  rem as (
    select l.wt * (1 - l.pr / 100.0) / nullif(tot.w, 0) v,
      case when coalesce(l.e, today.d) < today.d then today.d else greatest(coalesce(l.s, today.d), today.d) end s0,
      case when coalesce(l.e, today.d) < today.d then today.d + 29 else greatest(l.e, greatest(coalesce(l.s, today.d), today.d)) end e0, today.d td
    from leaf l cross join tot cross join today where l.pr < 100
  ),
  str as (
    select v, td + round((s0 - td) * (1 + coalesce(p_slip, 0) / 100.0))::integer s1,
      td + round((e0 - td + 1) * (1 + coalesce(p_slip, 0) / 100.0))::integer - 1 e1
    from rem where v > 0
  ),
  m as (select generate_series(date_trunc('month', (select d from today)), date_trunc('month', coalesce((select max(e1) from str), (select d from today))), interval '1 month')::date mon)
  select m.mon, sum(str.v * greatest(0, least(str.e1, (m.mon + interval '1 month')::date - 1) - greatest(str.s1, m.mon) + 1)::numeric / greatest(1, str.e1 - str.s1 + 1))
  from m cross join str group by m.mon having sum(str.v) > 0 order by m.mon;
$$;

-- Các dòng tiền dự kiến (ngày, số tiền) của mọi nguồn. p_delay = số ngày CĐT trả chậm thêm (âm = sớm), p_slip = % chậm tiến độ.
create function app_private.finance_forecast_events(p_delay integer, p_slip numeric)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; s public.finance_settings%rowtype; v jsonb := '[]'::jsonb;
  c record; m record; sb record; p record; met jsonb; v_left numeric; v_val numeric; v_rec numeric; v_net numeric; v_term integer;
  v_rem numeric; v_mat numeric; v_sub numeric; v_lab numeric; cs jsonb; v_pay record; i integer; v_mon date; v_d date; v_out numeric; v_n integer;
begin
  select * into s from public.finance_settings where id = 1;
  -- Tiền vào chắc chắn: đợt CĐT đã xác nhận còn phải thu, theo hạn (quá hạn → hôm nay).
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', 'in_receivable', 'dir', 'in', 'conf', 'sure', 'project', x.project_id,
      'd', greatest(coalesce(x.due_date, v_today) + greatest(p_delay, 0), v_today), 'amount', x.outstanding))
    from app_private.finance_receivable_round_rows() x where x.outstanding > 0.5 and x.status = 'confirmed'), '[]'::jsonb);
  -- Đã gửi CĐT, chờ xác nhận.
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', 'in_sent', 'dir', 'in', 'conf', 'sent', 'project', r.project_id,
      'd', greatest(r.sent_date + s.forecast_approval_days + coalesce(cc.payment_term_days, 30) + p_delay, v_today), 'amount', r.receivable))
    from public.finance_receivable_rounds r join public.customer_contracts cc on cc.id = r.contract_id
    where r.status = 'sent' and r.receivable > 0.5), '[]'::jsonb);
  -- Theo HĐ CĐT: tiền còn phải thu đến khi xong HĐ = giá trị gồm VAT × (1 − % giữ lại) − đã thu − đã xác nhận chưa thu − đã gửi.
  -- Chia phần còn lại theo sản lượng: đã làm chưa đề nghị (ước tính, về sau 1 kỳ duyệt + hạn) và sản lượng tương lai theo Gantt (theo tiến độ).
  -- Cách chia này tự trải thu hồi tạm ứng đều trên phần còn lại, không phụ thuộc các đợt cũ đã tách tạm ứng hay chưa.
  for c in select cc.id, cc.project_id from public.customer_contracts cc
    where cc.project_id is not null and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0 loop
    met := app_private.finance_customer_contract_metrics(c.id);
    v_term := s.forecast_approval_days + (met->>'paymentTermDays')::integer + p_delay;
    select coalesce(sum(r.receivable), 0) into v_val from public.finance_receivable_rounds r where r.contract_id = c.id and r.status = 'sent';
    v_left := (met->>'gross')::numeric * (1 - (met->>'retentionPercent')::numeric / 100) - (met->>'received')::numeric - (met->>'outstanding')::numeric - v_val;
    select coalesce(sum(x.share), 0) into v_rem from app_private.finance_forecast_progress_months(c.project_id, p_slip) x;
    v_out := coalesce((met->>'unbilled')::numeric, 0) + (met->>'gross')::numeric * v_rem;
    continue when v_left <= 0.5 or v_out <= 0.5;
    v_net := coalesce((met->>'unbilled')::numeric, 0) * v_left / v_out;
    if v_net > 0.5 then v := v || jsonb_build_array(jsonb_build_object('key', 'in_unbilled', 'dir', 'in', 'conf', 'est', 'project', c.project_id,
      'd', greatest(v_today + v_term, v_today), 'amount', round(v_net, 2))); end if;
    for m in select * from app_private.finance_forecast_progress_months(c.project_id, p_slip) loop
      v_net := (met->>'gross')::numeric * m.share * v_left / v_out;
      if v_net > 0.5 then v := v || jsonb_build_array(jsonb_build_object('key', 'in_progress', 'dir', 'in', 'conf', 'plan', 'project', c.project_id,
        'd', greatest((m.month + interval '1 month')::date - 1 + v_term, v_today), 'amount', round(v_net, 2))); end if;
    end loop;
  end loop;
  -- Tiền ra chắc chắn: công nợ NCC / thầu phụ đã ghi nhận, theo hạn.
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', 'out_payable', 'dir', 'out', 'conf', 'sure', 'project', x.project_id,
      'd', greatest(coalesce(x.due_date, v_today), v_today), 'amount', x.outstanding - x.pending_external))
    from app_private.finance_payable_rows() x where x.outstanding - x.pending_external > 0.5 and not x.internal), '[]'::jsonb);
  -- Tạm ứng NCC / chi khác đã lập, chưa chi.
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', 'out_request', 'dir', 'out', 'conf', 'sent', 'project', r.project_id,
      'd', greatest(coalesce(r.planned_date, v_today), v_today), 'amount', r.amount))
    from public.finance_payment_requests r where r.kind in ('advance', 'expense') and r.status in ('pending', 'returned', 'approved')), '[]'::jsonb);
  -- Đơn mua đã đặt chưa giao (gồm VAT): trả sau ngày hẹn giao + số ngày trả NCC. Quá hẹn > 30 ngày tách dòng riêng.
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', case when x.stale then 'out_po_stale' else 'out_po' end, 'dir', 'out',
      'conf', case when x.stale then 'est' else 'sent' end, 'project', x.project_id,
      'd', greatest(coalesce(x.expected_date, v_today), v_today) + s.forecast_pay_days,
      'amount', round(x.open_net * (1 + coalesce(o.vat_rate, 0) / 100), 2)))
    from app_private.finance_po_commitments(null) x join public.purchase_orders o on o.id = x.po_id where x.open_net > 0.5), '[]'::jsonb);
  -- Theo tiến độ từng dự án: vật tư dự toán chưa đặt, thầu phụ còn lại, nhân công chưa có HĐ (ước).
  for p in select distinct cc.project_id id from public.customer_contracts cc
    where cc.project_id is not null and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0 loop
    select coalesce(sum(x.share), 0) into v_rem from app_private.finance_forecast_progress_months(p.id, p_slip) x;
    continue when v_rem <= 0;
    cs := app_private.finance_project_cost_summary(p.id);
    v_mat := greatest(coalesce((cs->>'materialBudget')::numeric, 0) - coalesce((cs->>'materialActual')::numeric, 0) - coalesce((cs->>'materialCommitted')::numeric, 0), 0)
      * (1 + s.forecast_material_vat_percent / 100);
    select coalesce(sum(greatest(greatest((sm->>'grossValue')::numeric - coalesce((sm->>'acceptedGross')::numeric, 0), 0)
        * (1 - coalesce((sm->>'retentionPercent')::numeric, 5) / 100) - coalesce((sm->>'advanceRemaining')::numeric, 0), 0)), 0),
      coalesce(sum(greatest((sm->>'grossValue')::numeric - coalesce((sm->>'acceptedGross')::numeric, 0), 0)), 0)
      into v_sub, v_out
    from (select app_private.finance_subcontract_metrics(sc.id) sm from public.subcontractor_contracts sc
      where sc.project_id = p.id and coalesce(sc.status, '') not in ('cancelled', 'draft', 'completed', 'terminated')) q;
    select greatest(s.forecast_labor_percent / 100 * coalesce(sum(coalesce(cc.value, 0) * (1 + coalesce(cc.vat_percent, 0) / 100)), 0) * v_rem - v_out, 0)
      into v_lab from public.customer_contracts cc
    where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft');
    for m in select * from app_private.finance_forecast_progress_months(p.id, p_slip) loop
      v_d := greatest(m.month + 14 + s.forecast_pay_days, v_today);
      if v_mat * m.share / v_rem > 0.5 then v := v || jsonb_build_array(jsonb_build_object('key', 'out_material', 'dir', 'out', 'conf', 'plan', 'project', p.id,
        'd', v_d, 'amount', round(v_mat * m.share / v_rem, 2))); end if;
      if v_sub * m.share / v_rem > 0.5 then v := v || jsonb_build_array(jsonb_build_object('key', 'out_subcontract', 'dir', 'out', 'conf', 'plan', 'project', p.id,
        'd', v_d, 'amount', round(v_sub * m.share / v_rem, 2))); end if;
      if v_lab * m.share / v_rem > 0.5 then v := v || jsonb_build_array(jsonb_build_object('key', 'out_labor', 'dir', 'out', 'conf', 'est', 'project', p.id,
        'd', v_d, 'amount', round(v_lab * m.share / v_rem, 2))); end if;
    end loop;
  end loop;
  -- Lương: bảng lương gần nhất (tổng lương gộp), trả ngày 10 tháng sau.
  select h.year, h.month, sum(coalesce(h."grossSalary", 0)) total, count(*) n, bool_or(h.status = 'draft') draft into v_pay
  from public.hrm_payrolls h group by h.year, h.month order by h.year desc, h.month desc limit 1;
  if v_pay.total > 0 then
    for i in 0..12 loop
      v_d := (date_trunc('month', v_today) + make_interval(months => i))::date + 9;
      if v_d >= v_today then v := v || jsonb_build_array(jsonb_build_object('key', 'out_payroll', 'dir', 'out', 'conf', case when v_pay.draft then 'est' else 'plan' end,
        'project', null, 'd', v_d, 'amount', v_pay.total)); end if;
    end loop;
  end if;
  -- Khoản định kỳ (Thu chi & quỹ).
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', case when pl.direction = 'in' then 'in_recurring' else 'out_recurring' end, 'dir', pl.direction,
      'conf', 'plan', 'project', null, 'd', (mm.mon + (pl.day_of_month - 1) * interval '1 day')::date, 'amount', pl.amount))
    from public.finance_cash_plans pl
    cross join lateral generate_series(date_trunc('month', v_today), date_trunc('month', v_today) + interval '12 months', interval '1 month') mm(mon)
    where pl.is_active and mm.mon::date >= pl.start_month and (pl.end_month is null or mm.mon::date <= pl.end_month)
      and (mm.mon + (pl.day_of_month - 1) * interval '1 day')::date >= v_today), '[]'::jsonb);
  -- Khoản vay: lãi hằng tháng trên dư nợ; gốc một lần lúc đáo hạn hoặc chia đều đến đáo hạn.
  for p in select * from public.finance_loans l where l.is_active and l.outstanding > 0.5 loop
    v_left := p.outstanding;
    v_n := greatest(1, (extract(year from age(date_trunc('month', p.maturity_date), date_trunc('month', v_today))) * 12
      + extract(month from age(date_trunc('month', p.maturity_date), date_trunc('month', v_today))))::integer + 1);
    for i in 0..least(v_n - 1, 24) loop
      v_mon := (date_trunc('month', v_today) + make_interval(months => i))::date;
      v_d := least(v_mon + p.pay_day - 1, greatest(p.maturity_date, v_today));
      continue when v_d < v_today;
      if p.interest_rate > 0 then v := v || jsonb_build_array(jsonb_build_object('key', 'out_loan_interest', 'dir', 'out', 'conf', 'sure', 'project', p.project_id,
        'd', v_d, 'amount', round(v_left * p.interest_rate / 100 / 12, 2))); end if;
      v_out := case when i = v_n - 1 then v_left when p.repay_kind = 'monthly' then round(p.outstanding / v_n, 2) else 0 end;
      if v_out > 0.5 then v := v || jsonb_build_array(jsonb_build_object('key', 'out_loan_principal', 'dir', 'out', 'conf', 'sure', 'project', p.project_id,
        'd', v_d, 'amount', least(v_out, v_left))); v_left := v_left - least(v_out, v_left); end if;
    end loop;
  end loop;
  -- Khoản dự kiến một lần.
  v := v || coalesce((select jsonb_agg(jsonb_build_object('key', case when f.direction = 'in' then 'in_item' else 'out_item' end, 'dir', f.direction,
      'conf', f.confidence, 'project', f.project_id, 'd', greatest(f.expected_date, v_today), 'amount', f.amount))
    from public.finance_forecast_items f where f.is_active), '[]'::jsonb);
  return v;
end $$;

create function public.get_finance_forecast_v1(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; s public.finance_settings%rowtype; v_project text := nullif(p_input->>'projectId', '');
  v_company boolean := app_private.finance_can('manage'); v_sc text := coalesce(nullif(p_input->>'scenario', ''), 'base'); v_delay integer; v_slip numeric;
  v_m0 date := date_trunc('month', v_today)::date; v_w0 date := date_trunc('week', v_today)::date; v_ev jsonb; v_rows jsonb; v_missing jsonb := '[]'::jsonb;
  v_start numeric; v_known boolean; v_accounts integer; v_pay record;
begin
  if v_sc not in ('base', 'safe', 'good') then raise exception using errcode = '22023', message = 'FINANCE_FORECAST_SCENARIO'; end if;
  if v_project is not null then
    if not exists (select 1 from public.projects where id = v_project) then raise exception using errcode = 'PT404', message = 'FINANCE_PROJECT_NOT_FOUND'; end if;
    if not (v_company or app_private.finance_project_visible(v_project)) then raise exception using errcode = '42501', message = 'FINANCE_PROJECT_VIEW_DENIED'; end if;
  elsif not v_company then raise exception using errcode = '42501', message = 'FINANCE_FORECAST_DENIED'; end if;
  select * into s from public.finance_settings where id = 1;
  v_delay := case v_sc when 'safe' then s.forecast_safe_delay_days when 'good' then -s.forecast_good_early_days else 0 end
    + coalesce(nullif(p_input->>'extraDelayDays', '')::integer, 0);
  v_slip := case when v_sc = 'safe' then s.forecast_safe_slip_percent else 0 end;
  v_ev := app_private.finance_forecast_events(v_delay, v_slip);
  with e as (select x.* from jsonb_to_recordset(v_ev) x(key text, dir text, conf text, project text, d date, amount numeric)
      where v_project is null or x.project = v_project),
    e2 as (select e.*, (extract(year from e.d)::integer * 12 + extract(month from e.d)::integer)
        - (extract(year from v_m0)::integer * 12 + extract(month from v_m0)::integer) mi, (e.d - v_w0) / 7 wi from e),
    k as (select distinct key, dir, conf, project from e2),
    g as (select k.key, k.dir, k.conf, k.project,
        (select array_agg(coalesce(b.v, 0) order by i) from generate_series(0, 5) i left join (select x.mi, sum(x.amount) v from e2 x
          where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project group by x.mi) b on b.mi = i) mo,
        (select array_agg(coalesce(b.v, 0) order by i) from generate_series(0, 12) i left join (select x.wi, sum(x.amount) v from e2 x
          where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project group by x.wi) b on b.wi = i) wk,
        (select sum(x.amount) from e2 x where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project and x.mi >= 6) beyond,
        (select count(*) from e2 x where x.key = k.key and x.dir = k.dir and x.conf = k.conf and x.project is not distinct from k.project) n
      from k)
  select coalesce(jsonb_agg(jsonb_build_object('key', g.key || ':' || coalesce(g.project, 'company'), 'source', g.key, 'dir', g.dir, 'conf', g.conf,
      'projectId', g.project, 'projectCode', pr.code, 'months', to_jsonb(g.mo), 'weeks', to_jsonb(g.wk), 'beyond', coalesce(g.beyond, 0), 'count', g.n)
      order by g.dir, pr.code nulls last, g.key), '[]'::jsonb)
    into v_rows from g left join public.projects pr on pr.id = g.project;
  -- Số dư tiền hiện có (chỉ cho xem toàn công ty).
  select coalesce(sum(app_private.finance_cash_balance(f.id)), 0), count(*),
    bool_and(exists (select 1 from public.finance_cash_openings o where o.account_id = f.id and o.status = 'confirmed'))
    into v_start, v_accounts, v_known from public.cash_funds f where f.is_active;
  -- Việc cần khai để dự báo đủ.
  if v_project is null then
    if v_accounts = 0 then v_missing := v_missing || jsonb_build_object('code', 'cash_accounts', 'target', 'cash', 'text', 'Chưa khai tài khoản ngân hàng, tiền mặt — chưa biết tiền đang có.');
    elsif not v_known then v_missing := v_missing || jsonb_build_object('code', 'cash_openings', 'target', 'cash', 'text', 'Còn tài khoản tiền chưa chốt số dư đầu kỳ 30/09.'); end if;
    if not exists (select 1 from public.finance_cash_plans where is_active and direction = 'out') then
      v_missing := v_missing || jsonb_build_object('code', 'recurring', 'target', 'cash', 'text', 'Chưa khai chi phí định kỳ (thuê văn phòng, điện nước, bảo hiểm…).'); end if;
    if not exists (select 1 from public.finance_loans where is_active) then
      v_missing := v_missing || jsonb_build_object('code', 'loans', 'target', 'loans', 'text', 'Chưa khai khoản vay (nếu công ty không vay thì bỏ qua).'); end if;
    if not exists (select 1 from public.finance_cash_plans where is_active and direction = 'out' and category = 'tax')
      and not exists (select 1 from public.finance_forecast_items where is_active and direction = 'out' and category = 'tax') then
      v_missing := v_missing || jsonb_build_object('code', 'tax', 'target', 'items', 'text', 'Chưa khai thuế phải nộp (VAT, TNDN, TNCN) — thêm khoản dự kiến hoặc khoản định kỳ.'); end if;
    select h.year, h.month, count(*) n, bool_or(h.status = 'draft') draft into v_pay from public.hrm_payrolls h group by h.year, h.month order by h.year desc, h.month desc limit 1;
    if v_pay.n is null then v_missing := v_missing || jsonb_build_object('code', 'payroll', 'target', 'payroll', 'text', 'Chưa có bảng lương — chưa tính được tiền lương.');
    elsif v_pay.draft then v_missing := v_missing || jsonb_build_object('code', 'payroll_draft', 'target', 'payroll',
      'text', 'Lương lấy theo bảng lương tháng ' || v_pay.month || '/' || v_pay.year || ' còn nháp — duyệt bảng lương mới nhất để số chắc hơn.'); end if;
  end if;
  v_missing := v_missing || coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('code', 'no_gantt', 'projectId', p.id, 'target', 'project', 'text', p.code || ': chưa có tiến độ Gantt — chưa dự báo được thu, chi theo tiến độ.') x
      from public.projects p where exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0)
        and not exists (select 1 from public.project_tasks t where t.project_id = p.id) and (v_project is null or p.id = v_project)
    union all
    select jsonb_build_object('code', 'receivable_opening', 'projectId', cc.project_id, 'target', 'receivables', 'text', p.code || ' · ' || cc.code || ': chưa đối chiếu đầu kỳ phải thu — phần đã làm chưa thu đang là ước tính.')
      from public.customer_contracts cc join public.projects p on p.id = cc.project_id
      where coalesce(cc.status, '') not in ('cancelled', 'draft') and app_private.finance_customer_contract_metrics(cc.id)->>'opening' = 'todo' and (v_project is null or cc.project_id = v_project)
    union all
    select jsonb_build_object('code', 'material_budget', 'projectId', p.id, 'target', 'cost', 'text', p.code || ': chưa có dự toán vật tư — chưa dự báo được tiền mua vật tư còn lại.')
      from public.projects p where exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0)
        and exists (select 1 from public.project_tasks t where t.project_id = p.id)
        and app_private.finance_project_cost_summary(p.id)->>'materialBudget' is null and (v_project is null or p.id = v_project)
    union all
    select jsonb_build_object('code', 'no_subcontract', 'projectId', p.id, 'target', 'subcontracts', 'text', p.code || ': chưa có HĐ thầu phụ — nhân công đang ước theo ' || replace(to_char(s.forecast_labor_percent, 'FM990.0'), '.', ',') || '% giá trị HĐ.')
      from public.projects p where exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft') and coalesce(cc.value, 0) > 0)
        and not exists (select 1 from public.subcontractor_contracts sc where sc.project_id = p.id and coalesce(sc.status, '') not in ('cancelled', 'draft') and coalesce(sc.value, 0) > 0)
        and (v_project is null or p.id = v_project)
    union all
    select jsonb_build_object('code', 'subcontract_opening', 'projectId', p.id, 'target', 'subcontracts', 'text', p.code || ': ' || count(*) || ' HĐ thầu phụ chưa chốt đầu kỳ — phần còn phải trả đang tính cả khối lượng đã làm trước 01/10.')
      from public.subcontractor_contracts sc join public.projects p on p.id = sc.project_id
      where coalesce(sc.status, '') not in ('cancelled', 'draft') and coalesce(sc.value, 0) > 0 and app_private.finance_subcontract_metrics(sc.id)->>'opening' = 'todo'
        and (v_project is null or p.id = v_project) group by p.id, p.code
    union all
    select jsonb_build_object('code', 'stale_po', 'projectId', null, 'target', 'procurement', 'text', count(*) || ' đơn mua quá hẹn giao > 30 ngày (' || replace(to_char(round(sum(x.open_net) / 1e9, 2), 'FM999990.00'), '.', ',') || ' tỷ trước VAT) — Mua hàng "Kết thúc thiếu" đơn NCC không giao để bỏ khỏi dự báo.')
      from app_private.finance_po_commitments(v_project) x where x.stale and x.open_net > 0.5 having count(*) > 0
  ) q), '[]'::jsonb);
  return jsonb_build_object('today', v_today, 'scenario', v_sc, 'projectId', v_project, 'companyView', v_project is null,
    'months', (select jsonb_agg((v_m0 + make_interval(months => k))::date order by k) from generate_series(0, 5) k),
    'weeks', (select jsonb_agg(v_w0 + 7 * k order by k) from generate_series(0, 12) k),
    'params', jsonb_build_object('approvalDays', s.forecast_approval_days, 'payDays', s.forecast_pay_days, 'laborPercent', s.forecast_labor_percent,
      'materialVatPercent', s.forecast_material_vat_percent, 'safeDelayDays', s.forecast_safe_delay_days, 'safeSlipPercent', s.forecast_safe_slip_percent,
      'goodEarlyDays', s.forecast_good_early_days, 'delayDays', v_delay, 'slipPercent', v_slip, 'minBalance', s.cash_min_balance),
    'cash', case when v_project is null then jsonb_build_object('start', v_start, 'known', coalesce(v_known, false) and v_accounts > 0, 'accounts', v_accounts) end,
    'rows', v_rows, 'missing', v_missing,
    'can', jsonb_build_object('manage', v_company, 'record', app_private.finance_can('record')),
    'loans', case when v_project is null then coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lender', l.lender, 'contractNo', l.contract_no, 'projectId', l.project_id,
        'outstanding', l.outstanding, 'interestRate', l.interest_rate, 'repayKind', l.repay_kind, 'maturityDate', l.maturity_date, 'payDay', l.pay_day, 'note', l.note, 'active', l.is_active)
        order by l.is_active desc, l.maturity_date) from public.finance_loans l), '[]'::jsonb) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'direction', f.direction, 'name', f.name, 'category', f.category, 'projectId', f.project_id,
        'projectCode', pr.code, 'amount', f.amount, 'expectedDate', f.expected_date, 'confidence', f.confidence, 'note', f.note)
        order by f.expected_date) from public.finance_forecast_items f left join public.projects pr on pr.id = f.project_id
      where f.is_active and (v_project is null or f.project_id = v_project)), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code) from public.projects p
      where (v_project is null or p.id = v_project) and (exists (select 1 from public.customer_contracts cc where cc.project_id = p.id and coalesce(cc.status, '') not in ('cancelled', 'draft'))
        or exists (select 1 from public.finance_forecast_items f where f.project_id = p.id and f.is_active))), '[]'::jsonb));
end $$;

create function public.save_finance_forecast_settings_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_before jsonb;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if nullif(btrim(p_input->>'reason'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select to_jsonb(s) into v_before from public.finance_settings s where id = 1;
  begin
    update public.finance_settings set
      forecast_approval_days = coalesce((p_input->>'approvalDays')::integer, forecast_approval_days),
      forecast_pay_days = coalesce((p_input->>'payDays')::integer, forecast_pay_days),
      forecast_labor_percent = coalesce((p_input->>'laborPercent')::numeric, forecast_labor_percent),
      forecast_material_vat_percent = coalesce((p_input->>'materialVatPercent')::numeric, forecast_material_vat_percent),
      forecast_safe_delay_days = coalesce((p_input->>'safeDelayDays')::integer, forecast_safe_delay_days),
      forecast_safe_slip_percent = coalesce((p_input->>'safeSlipPercent')::numeric, forecast_safe_slip_percent),
      forecast_good_early_days = coalesce((p_input->>'goodEarlyDays')::integer, forecast_good_early_days),
      updated_by = v_actor, updated_at = now()
    where id = 1;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'FINANCE_FORECAST_SETTINGS_INVALID';
  end;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, payload)
  values ('settings', '1', 'forecast_settings', v_actor, btrim(p_input->>'reason'), v_before, p_input - 'reason');
  return jsonb_build_object('ok', true);
end $$;

create function public.save_finance_loan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_id uuid := nullif(p_input->>'id', '')::uuid;
  v_out numeric := round(nullif(p_input->>'outstanding', '')::numeric, 2); v_rate numeric := coalesce(nullif(p_input->>'interestRate', '')::numeric, 0);
  v_mat date := nullif(p_input->>'maturityDate', '')::date; v_kind text := coalesce(p_input->>'repayKind', 'bullet'); v_day integer := coalesce(nullif(p_input->>'payDay', '')::integer, 25);
  v_proj text := nullif(p_input->>'projectId', '');
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if nullif(btrim(p_input->>'lender'), '') is null or v_out is null or v_out < 0 or v_mat is null or v_rate not between 0 and 100
    or v_kind not in ('bullet', 'monthly') or v_day not between 1 and 28 or (v_proj is not null and not exists (select 1 from public.projects where id = v_proj)) then
    raise exception using errcode = '22023', message = 'FINANCE_LOAN_INVALID'; end if;
  if v_id is null then
    insert into public.finance_loans (lender, contract_no, project_id, outstanding, interest_rate, repay_kind, maturity_date, pay_day, is_active, note, created_by, updated_by)
    values (btrim(p_input->>'lender'), nullif(btrim(p_input->>'contractNo'), ''), v_proj, v_out, v_rate, v_kind, v_mat, v_day,
      coalesce((p_input->>'active')::boolean, true), nullif(btrim(p_input->>'note'), ''), v_actor, v_actor) returning id into v_id;
  else
    update public.finance_loans set lender = btrim(p_input->>'lender'), contract_no = nullif(btrim(p_input->>'contractNo'), ''), project_id = v_proj,
      outstanding = v_out, interest_rate = v_rate, repay_kind = v_kind, maturity_date = v_mat, pay_day = v_day,
      is_active = coalesce((p_input->>'active')::boolean, true), note = nullif(btrim(p_input->>'note'), ''), updated_by = v_actor, updated_at = now()
    where id = v_id;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_LOAN_INVALID'; end if;
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('loan', v_id::text, 'loan_save', v_actor, p_input);
  return jsonb_build_object('id', v_id);
end $$;

-- Khoản dự kiến: lưu 1 dòng (thêm / sửa) hoặc cả file import (p_input.rows). Kiểm hết rồi mới ghi; lỗi trả về dòng nào.
create function public.save_finance_forecast_items_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_rows jsonb := coalesce(p_input->'rows', jsonb_build_array(p_input)); r jsonb; v_n integer := 0;
  v_bad text; v_batch uuid := case when p_input ? 'rows' then gen_random_uuid() end; v_id uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if jsonb_typeof(v_rows) <> 'array' or jsonb_array_length(v_rows) = 0 or jsonb_array_length(v_rows) > 2000 then
    raise exception using errcode = '22023', message = 'FINANCE_FORECAST_ITEM_INVALID'; end if;
  select string_agg('dòng ' || coalesce(x->>'row', (o)::text), ', ') into v_bad
  from jsonb_array_elements(v_rows) with ordinality t(x, o)
  where nullif(btrim(x->>'name'), '') is null or coalesce(x->>'direction', '') not in ('in', 'out')
    or case when coalesce(x->>'amount', '') ~ '^\d+(\.\d+)?$' then (x->>'amount')::numeric <= 0 else true end
    or coalesce(x->>'expectedDate', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(x->>'confidence', 'plan') not in ('sure', 'plan', 'est')
    or (nullif(x->>'projectId', '') is not null and not exists (select 1 from public.projects p where p.id = x->>'projectId'));
  if v_bad is not null then raise exception using errcode = '22023', message = 'FINANCE_FORECAST_ITEM_INVALID', detail = v_bad; end if;
  for r in select value from jsonb_array_elements(v_rows) loop
    v_id := nullif(r->>'id', '')::uuid;
    if v_id is not null then
      update public.finance_forecast_items set direction = r->>'direction', name = btrim(r->>'name'), category = coalesce(nullif(r->>'category', ''), 'other'),
        project_id = nullif(r->>'projectId', ''), amount = round((r->>'amount')::numeric, 2), expected_date = (r->>'expectedDate')::date,
        confidence = coalesce(nullif(r->>'confidence', ''), 'plan'), note = nullif(btrim(r->>'note'), '')
      where id = v_id and is_active;
      if not found then raise exception using errcode = 'PT404', message = 'FINANCE_FORECAST_ITEM_INVALID'; end if;
    else
      insert into public.finance_forecast_items (direction, name, category, project_id, amount, expected_date, confidence, note, import_batch, created_by)
      values (r->>'direction', btrim(r->>'name'), coalesce(nullif(r->>'category', ''), 'other'), nullif(r->>'projectId', ''), round((r->>'amount')::numeric, 2),
        (r->>'expectedDate')::date, coalesce(nullif(r->>'confidence', ''), 'plan'), nullif(btrim(r->>'note'), ''), v_batch, v_actor);
    end if;
    v_n := v_n + 1;
  end loop;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('forecast_item', coalesce(v_batch::text, v_id::text, 'new'), case when v_batch is not null then 'forecast_items_import' else 'forecast_item_save' end, v_actor,
    jsonb_build_object('rows', v_n));
  return jsonb_build_object('saved', v_n, 'batchId', v_batch);
end $$;

create function public.cancel_finance_forecast_item_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_reason text := nullif(btrim(p_input->>'reason'), '');
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  update public.finance_forecast_items set is_active = false, cancelled_by = v_actor, cancelled_at = now(), cancel_reason = v_reason
  where id = nullif(p_input->>'id', '')::uuid and is_active;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_FORECAST_ITEM_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason) values ('forecast_item', p_input->>'id', 'forecast_item_cancel', v_actor, v_reason);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function app_private.finance_forecast_progress_months(text, numeric) from public, anon, authenticated;
revoke all on function app_private.finance_forecast_events(integer, numeric) from public, anon, authenticated;
revoke all on function public.get_finance_forecast_v1(jsonb) from public, anon;
revoke all on function public.save_finance_forecast_settings_v1(jsonb) from public, anon;
revoke all on function public.save_finance_loan_v1(jsonb) from public, anon;
revoke all on function public.save_finance_forecast_items_v1(jsonb) from public, anon;
revoke all on function public.cancel_finance_forecast_item_v1(jsonb) from public, anon;
grant execute on function public.get_finance_forecast_v1(jsonb) to authenticated;
grant execute on function public.save_finance_forecast_settings_v1(jsonb) to authenticated;
grant execute on function public.save_finance_loan_v1(jsonb) to authenticated;
grant execute on function public.save_finance_forecast_items_v1(jsonb) to authenticated;
grant execute on function public.cancel_finance_forecast_item_v1(jsonb) to authenticated;
