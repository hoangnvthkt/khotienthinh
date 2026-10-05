-- ===========================================================================
-- Tài chính F4 — Thầu phụ (05/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 20; mockup .superpowers/cost/sc-v1.html
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 11 câu 05/10, đều phương án a):
-- * Kế toán dự án (Tài chính — Ghi nhận) lập đợt nghiệm thu thanh toán theo biên bản CHT / QS gửi (bắt buộc file); người khác có quyền
--   Xác nhận ghi nhận; người thứ ba xác nhận đã chi (đề nghị chi như NCC).
-- * Nhập số tổng LŨY KẾ đến kỳ (trước VAT), Vioo tự trừ lũy kế các đợt trước; không bắt buộc BOQ. Lũy kế vượt giá trị HĐ → bắt buộc lý do.
-- * Ghi nhận đợt: chi phí dự án khoản mục CPNC = giá trị kỳ này gồm VAT (như vật tư); công nợ phải trả (nguồn "Nghiệm thu thầu phụ",
--   hạn = ngày ghi nhận + số ngày trên HĐ, mặc định 30) + khoản giữ lại bảo hành tách riêng (hạn = ngày hoàn thành HĐ + tháng bảo hành;
--   chưa đến hạn thì không lập đề nghị chi được).
-- * Tổ đội cá nhân: HĐ đánh dấu khấu trừ thuế TNCN (mặc định 10% trên giá trị kỳ này); phần thuế không trả cho tổ, theo dõi riêng.
-- * Tạm ứng thầu phụ = đề nghị chi loại tạm ứng gắn HĐ thầu phụ (dùng chung ma trận duyệt, xác nhận chi). Mỗi đợt thu hồi theo % trên HĐ
--   (để trống = tạm ứng ÷ giá trị HĐ), tạm ứng trước mốc (đầu kỳ MISA) thu hồi trước; khác gợi ý phải ghi lý do.
-- * Khấu trừ khác (vật tư công ty cấp, chi hộ, phạt, khác): từng dòng có loại, số tiền, lý do.
-- * Đầu kỳ 30/09 theo MISA từng HĐ (lũy kế nghiệm thu, đã trả, còn nợ, giữ lại, tạm ứng chưa thu hồi): người lập ≠ người chốt; không sinh
--   chi phí. Phải chốt đầu kỳ (khai 0 nếu không có) trước khi lập đợt đầu tiên.
-- * Chi phí nhân công ghi tay (có thể trùng MISA) vào "cần soát xét": không trùng → ghi nhận; trùng → ghi dòng đảo phần trùng, có lý do.
-- * Dự án chỉ xem phần thầu phụ: máy chủ chặn ghi chứng từ thanh toán, lịch thanh toán, tạm ứng, nghiệm thu của HĐ thầu phụ ngoài Tài chính.
-- * Luồng ngược: trả lại đợt (có lý do), hủy nháp, đảo đợt đã ghi nhận (đợt cuối, chưa chi tiền) → hủy công nợ, giữ lại, đảo chi phí,
--   trả lại phần tạm ứng đã cấn trừ.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.subcontractor_contracts
  add column vat_percent numeric(5,2) check (vat_percent between 0 and 100),
  add column advance_recovery_percent numeric(7,3) check (advance_recovery_percent between 0 and 100),
  add column payment_term_days integer check (payment_term_days between 0 and 365),
  add column warranty_months integer check (warranty_months between 0 and 120),
  add column withhold_pit boolean not null default false,
  add column pit_percent numeric(5,2) not null default 10 check (pit_percent between 0 and 100);

alter table public.supplier_payable_documents add column subcontract_id text references public.subcontractor_contracts(id);
create index supplier_payable_documents_subcontract_idx on public.supplier_payable_documents (subcontract_id) where subcontract_id is not null;
alter table public.supplier_payable_documents drop constraint supplier_payable_documents_source_type_check;
alter table public.supplier_payable_documents add constraint supplier_payable_documents_source_type_check check (source_type = any (array[
  'purchase_order', 'purchase_delivery_receipt', 'supplier_invoice_adjustment', 'site_direct_purchase', 'supplier_delivery_statement',
  'supplier_return_credit', 'opening_balance', 'manual_adjustment', 'direct_supplier_receipt',
  'subcontract_round', 'subcontract_retention', 'subcontract_opening']));

alter table public.finance_payment_requests add column subcontract_id text references public.subcontractor_contracts(id);
alter table public.finance_payment_requests drop constraint finance_payment_requests_advance_check;
alter table public.finance_payment_requests add constraint finance_payment_requests_advance_check check (kind <> 'advance'
  or (num_nonnulls(purchase_order_id, supplier_contract_id, subcontract_id) = 1 and repay_due_date is not null));
create index finance_payment_requests_subcontract_idx on public.finance_payment_requests (subcontract_id) where subcontract_id is not null;

create table public.finance_subcontract_rounds (
  id uuid primary key default gen_random_uuid(),
  subcontract_id text not null references public.subcontractor_contracts(id),
  project_id text,
  construction_site_id text,
  supplier_id text,
  sequence_no integer not null,
  kind text not null default 'progress' check (kind in ('progress', 'opening')),
  period_start date,
  period_end date,
  description text not null check (length(btrim(description)) > 0),
  cumulative_net numeric(18,2) not null check (cumulative_net >= 0),
  previous_net numeric(18,2) not null default 0,
  net_amount numeric(18,2) not null,
  vat_percent numeric(5,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  gross_amount numeric(18,2) not null check (gross_amount >= 0),
  advance_recovery numeric(18,2) not null default 0 check (advance_recovery >= 0),
  advance_recovery_opening numeric(18,2) not null default 0 check (advance_recovery_opening >= 0),
  retention numeric(18,2) not null default 0 check (retention >= 0),
  pit_amount numeric(18,2) not null default 0 check (pit_amount >= 0),
  other_deduction numeric(18,2) not null default 0 check (other_deduction >= 0),
  deductions jsonb not null default '[]'::jsonb,
  payable numeric(18,2) generated always as (gross_amount - advance_recovery - retention - pit_amount - other_deduction) stored,
  suggested_recovery numeric(18,2),
  suggested_retention numeric(18,2),
  suggested_pit numeric(18,2),
  adjust_reason text,
  over_contract_reason text,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'recognized', 'cancelled')),
  submitted_by uuid references public.users(id),
  submitted_at timestamptz,
  return_reason text,
  returned_by uuid references public.users(id),
  returned_at timestamptz,
  recognized_date date,
  recognized_by uuid references public.users(id),
  recognized_at timestamptz,
  due_date date,
  retention_due_date date,
  payable_document_id uuid references public.supplier_payable_documents(id),
  retention_document_id uuid references public.supplier_payable_documents(id),
  attachments jsonb not null default '[]'::jsonb,
  note text,
  cancel_reason text,
  cancelled_by uuid references public.users(id),
  cancelled_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  check (gross_amount >= advance_recovery + retention + pit_amount + other_deduction),
  check (advance_recovery_opening <= advance_recovery),
  check (kind = 'opening' or net_amount > 0)
);
create index finance_subcontract_rounds_sub_idx on public.finance_subcontract_rounds (subcontract_id, status);
-- Số đợt duy nhất trong các đợt còn hiệu lực (đầu kỳ bị hủy rồi chốt lại vẫn là đợt 0).
create unique index finance_subcontract_rounds_seq on public.finance_subcontract_rounds (subcontract_id, sequence_no) where status <> 'cancelled';
-- Mỗi HĐ chỉ một đợt đang lập / chờ ghi nhận (lũy kế tính theo đợt trước).
create unique index finance_subcontract_rounds_one_open on public.finance_subcontract_rounds (subcontract_id) where status in ('draft', 'submitted');

create table public.finance_subcontract_openings (
  id uuid primary key default gen_random_uuid(),
  subcontract_id text not null references public.subcontractor_contracts(id),
  cutover_date date not null,
  cumulative_net numeric(18,2) not null check (cumulative_net >= 0),
  paid_total numeric(18,2) not null default 0 check (paid_total >= 0),
  outstanding numeric(18,2) not null check (outstanding >= 0),
  outstanding_due_date date,
  retention_held numeric(18,2) not null check (retention_held >= 0),
  retention_due_date date,
  advance_remaining numeric(18,2) not null check (advance_remaining >= 0),
  note text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'cancelled')),
  opening_round_id uuid references public.finance_subcontract_rounds(id),
  payable_document_id uuid references public.supplier_payable_documents(id),
  retention_document_id uuid references public.supplier_payable_documents(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_subcontract_openings_one_active on public.finance_subcontract_openings (subcontract_id) where status in ('submitted', 'confirmed');

do $$ declare t text; begin
  foreach t in array array['finance_subcontract_rounds', 'finance_subcontract_openings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Trợ giúp
-- ---------------------------------------------------------------------------
create function app_private.finance_sub_cost_item()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.contract_cost_items where symbol = 'CPNC' and status = 'active' order by created_at limit 1;
$$;

create function app_private.finance_notify_sub(p_users uuid[], p_title text, p_message text, p_sub text, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.finance_notify_link(p_users, p_title, p_message, '/#/finance?section=subcontracts&subcontract=' || p_sub, 'subcontract', p_actor);
end $$;

-- Hạn trả tiền giữ lại = ngày hoàn thành HĐ + số tháng bảo hành (thiếu một trong hai → chưa có hạn).
create function app_private.finance_sub_retention_due(p_sub text)
returns date language sql stable security definer set search_path = '' as $$
  select case when c.completion_date is not null and coalesce(c.warranty_months, 0) > 0
    then (c.completion_date + make_interval(months => c.warranty_months))::date end
  from public.subcontractor_contracts c where c.id = p_sub;
$$;

-- Tạm ứng Vioo của HĐ thầu phụ còn lại (đã chi, chưa cấn trừ / hoàn), chi trước đứng trước.
create function app_private.finance_sub_vioo_advances(p_sub text)
returns table (id uuid, code text, remaining numeric, paid_date date)
language sql stable security definer set search_path = '' as $$
  select a.id, a.code, a.remaining, a.paid_date
  from app_private.finance_advance_rows() a join public.finance_payment_requests r on r.id = a.id
  where r.subcontract_id = p_sub and a.status = 'paid' and a.remaining > 0.004
  order by a.paid_date, a.code;
$$;

-- Số liệu một HĐ thầu phụ.
create function app_private.finance_subcontract_metrics(p_sub text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.subcontractor_contracts%rowtype; o public.finance_subcontract_openings%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_vat numeric; v_gross_value numeric; v_cum numeric; v_accepted numeric; v_out numeric; v_overdue numeric; v_ret numeric; v_ret_due date; v_paid numeric;
  v_adv_open numeric; v_adv_vioo numeric; v_adv_given numeric; v_pit numeric; v_cost numeric; v_pct numeric; v_opening text; v_open_round text;
begin
  select * into c from public.subcontractor_contracts where id = p_sub;
  if not found then return null; end if;
  select * into o from public.finance_subcontract_openings where subcontract_id = p_sub and status = 'confirmed';
  v_opening := case when o.id is not null then 'confirmed'
    when exists (select 1 from public.finance_subcontract_openings x where x.subcontract_id = p_sub and x.status = 'submitted') then 'submitted' else 'todo' end;
  v_vat := coalesce(c.vat_percent, 0);
  v_gross_value := case when coalesce(c.value, 0) > 0 then round(c.value * (1 + v_vat / 100), 2) end;
  select r.cumulative_net into v_cum from public.finance_subcontract_rounds r where r.subcontract_id = p_sub and r.status = 'recognized'
    order by r.sequence_no desc limit 1;
  select coalesce(sum(r.gross_amount) filter (where r.kind = 'progress'), 0), coalesce(sum(r.pit_amount), 0),
    coalesce(sum(r.advance_recovery_opening), 0)
    into v_accepted, v_pit, v_adv_open
  from public.finance_subcontract_rounds r where r.subcontract_id = p_sub and r.status = 'recognized';
  v_adv_open := greatest(coalesce(o.advance_remaining, 0) - v_adv_open, 0);
  select coalesce(sum(x.outstanding) filter (where x.source_type <> 'subcontract_retention'), 0),
    coalesce(sum(x.outstanding) filter (where x.source_type <> 'subcontract_retention' and x.due_date < v_today), 0),
    coalesce(sum(x.outstanding) filter (where x.source_type = 'subcontract_retention'), 0),
    min(x.due_date) filter (where x.source_type = 'subcontract_retention' and x.outstanding > 0.5), coalesce(sum(x.paid), 0)
    into v_out, v_overdue, v_ret, v_ret_due, v_paid
  from app_private.finance_payable_rows() x join public.supplier_payable_documents d on d.id = x.id where d.subcontract_id = p_sub;
  select coalesce(sum(remaining), 0) into v_adv_vioo from app_private.finance_sub_vioo_advances(p_sub);
  select coalesce(sum(a.amount), 0) into v_adv_given from app_private.finance_advance_rows() a join public.finance_payment_requests r on r.id = a.id
    where r.subcontract_id = p_sub and a.status = 'paid';
  select coalesce(sum(t.amount), 0) into v_cost from public.finance_subcontract_rounds r join public.project_transactions t
    on t.source_ref in ('finance_subcontract_round:' || r.id::text, 'finance_subcontract_round:' || r.id::text || ':reversal') where r.subcontract_id = p_sub;
  v_pct := coalesce(c.advance_recovery_percent, case when v_gross_value > 0
    then round((coalesce(o.advance_remaining, 0) + v_adv_given) * 100 / v_gross_value, 3) end, 0);
  select r.status into v_open_round from public.finance_subcontract_rounds r where r.subcontract_id = p_sub and r.status in ('draft', 'submitted') limit 1;
  return jsonb_build_object('grossValue', v_gross_value, 'vatPercent', v_vat, 'vatSource', case when c.vat_percent is not null then 'contract' else 'default' end,
    'cumulativeNet', coalesce(v_cum, 0), 'hasRounds', v_cum is not null,
    'cumulativePercent', case when coalesce(c.value, 0) > 0 and v_cum is not null then round(v_cum * 100 / c.value, 1) end,
    'acceptedGross', v_accepted, 'outstanding', v_out, 'overdue', v_overdue, 'retentionHeld', v_ret, 'retentionDue', v_ret_due, 'paid', v_paid,
    'advanceRemaining', v_adv_open + v_adv_vioo, 'advanceRemainingOpening', v_adv_open, 'advanceRemainingVioo', v_adv_vioo, 'pitWithheld', v_pit, 'cost', v_cost,
    'recoveryPercent', v_pct, 'recoveryPercentSource', case when c.advance_recovery_percent is not null then 'contract' else 'auto' end,
    'retentionPercent', coalesce(c.retention_percent, 0), 'withholdPit', c.withhold_pit, 'pitPercent', c.pit_percent,
    'paymentTermDays', coalesce(c.payment_term_days, (select default_payment_days from public.finance_settings where id = 1), 30),
    'paymentTermSource', case when c.payment_term_days is not null then 'contract' else 'default' end,
    'warrantyMonths', c.warranty_months, 'retentionDueDate', app_private.finance_sub_retention_due(p_sub),
    'opening', v_opening, 'openRound', v_open_round,
    'issues', to_jsonb(array_remove(array[
      case when c.partner_id is null then 'no_partner' end,
      case when coalesce(c.value, 0) = 0 then 'zero_value' end,
      case when c.signed_date is null then 'no_signed_date' when c.signed_date > v_today then 'signed_future' end,
      case when c.project_id is null then 'no_project' end,
      case when coalesce(c.status, '') not in ('signed', 'active', 'completed') then 'status' end,
      case when coalesce(c.retention_percent, 0) > 0 and app_private.finance_sub_retention_due(p_sub) is null then 'no_retention_due' end,
      case when coalesce(c.value, 0) > 0 and v_cum > c.value + 0.5 then 'over_contract' end,
      case when c.partner_id is not null and not exists (select 1 from public.business_partners b where b.id = c.partner_id
        and nullif(btrim(coalesce(b.bank_account, '')), '') is not null) then 'no_bank' end], null)));
end $$;

-- Gợi ý khấu trừ một đợt: thu hồi tạm ứng (% × giá trị gồm VAT, không quá tạm ứng còn lại), giữ lại (% × gồm VAT), TNCN (% × trước VAT).
create function app_private.finance_sub_suggest(p_sub text, p_net numeric, p_gross numeric)
returns table (recovery numeric, retention numeric, pit numeric) language plpgsql stable security definer set search_path = '' as $$
declare m jsonb := app_private.finance_subcontract_metrics(p_sub);
begin
  recovery := least(round(p_gross * coalesce((m->>'recoveryPercent')::numeric, 0) / 100, 2), coalesce((m->>'advanceRemaining')::numeric, 0));
  retention := round(p_gross * coalesce((m->>'retentionPercent')::numeric, 0) / 100, 2);
  pit := case when (m->>'withholdPit')::boolean then round(p_net * coalesce((m->>'pitPercent')::numeric, 10) / 100, 2) else 0 end;
  return next;
end $$;

-- Lũy kế (trước VAT) của đợt đứng trước (đầu kỳ hoặc đợt đã ghi nhận gần nhất).
create function app_private.finance_sub_previous_net(p_sub text)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select r.cumulative_net from public.finance_subcontract_rounds r where r.subcontract_id = p_sub and r.status = 'recognized'
    order by r.sequence_no desc limit 1), 0);
$$;

-- Chặn ghi chứng từ thanh toán / lịch / tạm ứng / nghiệm thu của HĐ thầu phụ ngoài Tài chính (Dự án chỉ xem).
create function app_private.guard_subcontract_finance_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path', true), ''); j jsonb;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or v_path = '' or v_path like '/rpc/%' then
    return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if tg_table_name = 'acceptance_records' or j->>'contract_type' = 'subcontractor' then
    raise exception using errcode = '42501', message = 'SUBCONTRACT_FINANCE_ONLY';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_guard_subcontract_certificate before insert or update or delete on public.payment_certificates
  for each row execute function app_private.guard_subcontract_finance_write();
create trigger trg_guard_subcontract_schedule before insert or update or delete on public.payment_schedules
  for each row execute function app_private.guard_subcontract_finance_write();
create trigger trg_guard_subcontract_advance before insert or update or delete on public.advance_payments
  for each row execute function app_private.guard_subcontract_finance_write();
create trigger trg_guard_subcontract_acceptance before insert or update or delete on public.quantity_acceptances
  for each row execute function app_private.guard_subcontract_finance_write();
create trigger trg_guard_subcontract_acceptance_record before insert or update or delete on public.acceptance_records
  for each row execute function app_private.guard_subcontract_finance_write();

-- ---------------------------------------------------------------------------
-- 3. Đọc
-- ---------------------------------------------------------------------------
-- Chi phí nhân công ghi tay chưa soát xét + gợi ý dòng MISA đã nhập cho cùng tổ đội (khớp 2 chữ cuối của tên).
create function app_private.finance_sub_cost_reviews()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'projectId', t.project_id, 'projectCode', p.code, 'date', t.date, 'amount', t.amount,
      'description', t.description, 'counterparty', t.counterparty_name, 'createdByName', app_private.finance_user_name(nullif(t."createdBy", '')::uuid),
      'createdAt', t."createdAt",
      'misa', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'date', m.date, 'amount', m.amount, 'description', m.description) order by m.date), '[]'::jsonb)
        from public.project_transactions m where k.key is not null and m.project_id = t.project_id and m.type = 'expense' and m.source = 'import'
          and m.amount > 0 and m.date <= t.date and replace(lower(m.description), ' ', '') like '%' || k.key || '%'))
      order by t.date desc, t.amount desc), '[]'::jsonb)
  from public.project_transactions t join public.projects p on p.id = t.project_id
  cross join lateral (select case when array_length(w, 1) >= 2 then w[array_length(w, 1) - 1] || w[array_length(w, 1)] end key
    from (select regexp_split_to_array(lower(btrim(coalesce(t.counterparty_name, ''))), '\s+') w) q) k
  where t.type = 'expense' and t.source = 'manual' and t.amount > 0
    and (t.contract_cost_item_symbol_snapshot = 'CPNC' or t.category in ('labor', 'subcontract'))
    and not exists (select 1 from public.finance_events e where e.entity_type = 'cost_review' and e.entity_id = t.id);
$$;

create function public.get_finance_subcontracts_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); v_confirm boolean := app_private.finance_can('confirm');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return (with cs as (
      select c.*, p.code project_code, b.name partner_name, app_private.finance_subcontract_metrics(c.id) m
      from public.subcontractor_contracts c left join public.projects p on p.id = c.project_id left join public.business_partners b on b.id = c.partner_id
      where coalesce(c.status, '') not in ('draft', 'negotiating', 'cancelled') or exists (select 1 from public.finance_subcontract_rounds r where r.subcontract_id = c.id))
    select jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
      'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
      'totals', jsonb_build_object('contracts', (select count(*) from cs),
        'value', coalesce((select sum(coalesce((m->>'grossValue')::numeric, 0)) from cs), 0),
        'outstanding', coalesce((select sum((m->>'outstanding')::numeric) from cs), 0),
        'overdue', coalesce((select sum((m->>'overdue')::numeric) from cs), 0),
        'retentionHeld', coalesce((select sum((m->>'retentionHeld')::numeric) from cs), 0),
        'advanceRemaining', coalesce((select sum((m->>'advanceRemaining')::numeric) from cs), 0),
        'pitWithheld', coalesce((select sum((m->>'pitWithheld')::numeric) from cs), 0),
        'openingsTodo', (select count(*) from cs where m->>'opening' = 'todo'),
        'openingsPending', (select count(*) from public.finance_subcontract_openings where status = 'submitted'),
        'openingsPendingMe', case when v_confirm then (select count(*) from public.finance_subcontract_openings where status = 'submitted' and created_by is distinct from v_actor) else 0 end,
        'roundsSubmitted', (select count(*) from public.finance_subcontract_rounds where status = 'submitted'),
        'roundsWaitingMe', case when v_confirm then (select count(*) from public.finance_subcontract_rounds where status = 'submitted' and created_by is distinct from v_actor) else 0 end,
        'roundsDraft', (select count(*) from public.finance_subcontract_rounds where status = 'draft'),
        'retentionDue', (select count(*) from app_private.finance_payable_rows() x where x.source_type = 'subcontract_retention' and x.outstanding > 0.5 and x.due_date <= v_today + 30)),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', cs.id, 'code', cs.code, 'name', cs.name, 'subcontractorName', cs.subcontractor_name,
          'partnerId', cs.partner_id, 'partnerName', cs.partner_name, 'projectId', cs.project_id, 'projectCode', cs.project_code, 'value', cs.value,
          'status', cs.status, 'signedDate', cs.signed_date, 'completionDate', cs.completion_date, 'withholdPit', cs.withhold_pit,
          'lastRound', (select jsonb_build_object('sequenceNo', r.sequence_no, 'status', r.status, 'periodEnd', r.period_end) from public.finance_subcontract_rounds r
            where r.subcontract_id = cs.id and r.status <> 'cancelled' and r.kind = 'progress' order by r.sequence_no desc limit 1),
          'metrics', cs.m) order by (cs.m->>'outstanding')::numeric desc, cs.project_code nulls last, cs.code)
        from cs), '[]'::jsonb),
      'reviewCosts', app_private.finance_sub_cost_reviews(),
      -- Đối tác có chi phí nhân công trong dự án nhưng chưa có HĐ thầu phụ trong Vioo (gợi ý lập HĐ ở module Hợp đồng).
      'withoutContract', coalesce((select jsonb_agg(jsonb_build_object('name', q.name, 'projectCode', q.code, 'amount', q.amount) order by q.amount desc)
        from (select t.counterparty_name name, p.code, sum(t.amount) amount from public.project_transactions t join public.projects p on p.id = t.project_id
          where t.type = 'expense' and t.amount > 0 and t.contract_cost_item_symbol_snapshot = 'CPNC' and nullif(btrim(t.counterparty_name), '') is not null
            and not exists (select 1 from public.subcontractor_contracts c where c.project_id = t.project_id
              and (upper(btrim(c.subcontractor_name)) = upper(btrim(t.counterparty_name))
                or exists (select 1 from public.business_partners b where b.id = c.partner_id and upper(btrim(b.name)) = upper(btrim(t.counterparty_name)))))
          group by 1, 2) q), '[]'::jsonb)));
end $$;

create function public.get_finance_subcontract_v1(p_subcontract_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); c public.subcontractor_contracts%rowtype;
  v_record boolean := app_private.finance_can('record'); v_confirm boolean := app_private.finance_can('confirm'); v_item uuid := app_private.finance_sub_cost_item();
  v_budget jsonb;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into c from public.subcontractor_contracts where id = p_subcontract_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if c.project_id is not null then
    select jsonb_build_object('item', b.item_name, 'budget', b.budget, 'projected', b.projected) into v_budget from app_private.finance_budget_check(c.project_id, v_item, 0, null) b;
  end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'contract', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'subcontractorName', c.subcontractor_name, 'taxCode', c.subcontractor_tax_code,
      'scopeOfWork', c.scope_of_work, 'projectId', c.project_id, 'projectCode', (select code from public.projects where id = c.project_id),
      'partnerId', c.partner_id, 'partner', (select jsonb_build_object('id', p.id, 'name', p.name, 'taxCode', p.tax_code, 'bankName', p.bank_name, 'bankAccount', p.bank_account)
        from public.business_partners p where p.id = c.partner_id),
      'value', c.value, 'status', c.status, 'signedDate', c.signed_date, 'completionDate', c.completion_date, 'retentionPercent', c.retention_percent,
      'vatPercent', c.vat_percent, 'advanceRecoveryPercent', c.advance_recovery_percent, 'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months,
      'withholdPit', c.withhold_pit, 'pitPercent', c.pit_percent),
    'metrics', app_private.finance_subcontract_metrics(c.id),
    'budget', v_budget,
    'manDays', (select jsonb_build_object('lines', count(*), 'people', coalesce(sum(coalesce(l.people_count, l.count)), 0), 'lastDate', max(dl.date))
      from public.daily_log_labor l join public.daily_logs dl on dl.id = l.daily_log_id where l.subcontract_id = c.id),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sequenceNo', r.sequence_no, 'kind', r.kind, 'periodStart', r.period_start, 'periodEnd', r.period_end,
        'description', r.description, 'cumulativeNet', r.cumulative_net, 'previousNet', r.previous_net, 'netAmount', r.net_amount, 'vatPercent', r.vat_percent,
        'vatAmount', r.vat_amount, 'gross', r.gross_amount, 'advanceRecovery', r.advance_recovery, 'retention', r.retention, 'pit', r.pit_amount,
        'otherDeduction', r.other_deduction, 'deductions', r.deductions, 'payable', r.payable, 'suggestedRecovery', r.suggested_recovery,
        'suggestedRetention', r.suggested_retention, 'suggestedPit', r.suggested_pit, 'adjustReason', r.adjust_reason, 'overContractReason', r.over_contract_reason,
        'status', r.status, 'submittedAt', r.submitted_at, 'returnReason', r.return_reason, 'returnedByName', app_private.finance_user_name(r.returned_by),
        'recognizedDate', r.recognized_date, 'recognizedByName', app_private.finance_user_name(r.recognized_by), 'dueDate', r.due_date,
        'retentionDueDate', r.retention_due_date, 'attachments', r.attachments, 'note', r.note, 'cancelReason', r.cancel_reason,
        'createdBy', r.created_by, 'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'rowVersion', r.row_version,
        'paid', (select coalesce(sum(x.paid), 0) from app_private.finance_payable_rows() x where x.id in (r.payable_document_id, r.retention_document_id)),
        'outstanding', (select coalesce(sum(x.outstanding), 0) from app_private.finance_payable_rows() x where x.id = r.payable_document_id),
        'canEdit', v_record and r.status = 'draft' and r.kind = 'progress',
        'canSubmit', v_record and r.status = 'draft' and r.kind = 'progress',
        'canWithdraw', r.status = 'submitted' and r.created_by = v_actor,
        'canDecide', v_confirm and r.status = 'submitted' and r.created_by is distinct from v_actor,
        'canCancel', v_record and r.status in ('draft', 'submitted') and r.kind = 'progress',
        'canReverse', v_confirm and r.status = 'recognized' and r.kind = 'progress'
          and not exists (select 1 from public.finance_subcontract_rounds y where y.subcontract_id = r.subcontract_id and y.sequence_no > r.sequence_no and y.status = 'recognized'))
        order by r.sequence_no)
      from public.finance_subcontract_rounds r where r.subcontract_id = c.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'cutoverDate', o.cutover_date, 'cumulativeNet', o.cumulative_net, 'paidTotal', o.paid_total,
        'outstanding', o.outstanding, 'outstandingDueDate', o.outstanding_due_date, 'retentionHeld', o.retention_held, 'retentionDueDate', o.retention_due_date,
        'advanceRemaining', o.advance_remaining, 'note', o.note, 'attachments', o.attachments, 'status', o.status, 'createdBy', o.created_by,
        'createdByName', app_private.finance_user_name(o.created_by), 'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by),
        'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor,
        'canCancel', o.status = 'confirmed' and v_confirm) order by o.created_at desc)
      from public.finance_subcontract_openings o where o.subcontract_id = c.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'documentNo', x.document_no, 'sourceType', x.source_type,
        'documentDate', x.document_date, 'dueDate', x.due_date, 'recognized', x.recognized, 'paid', x.paid, 'outstanding', x.outstanding,
        'pendingExternal', x.pending_external, 'status', x.status) order by x.document_date, x.code)
      from app_private.finance_payable_rows() x join public.supplier_payable_documents d on d.id = x.id where d.subcontract_id = c.id), '[]'::jsonb),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'status', a.status, 'amount', a.amount, 'offset', a.offset_amount,
        'refunded', a.refunded, 'remaining', a.remaining, 'repayDueDate', a.repay_due_date, 'paidDate', a.paid_date) order by a.created_at)
      from app_private.finance_advance_rows() a join public.finance_payment_requests r on r.id = a.id where r.subcontract_id = c.id
        and r.status not in ('rejected', 'withdrawn', 'cancelled')), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', app_private.finance_user_name(e.actor_id), 'reason', e.reason,
        'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where entity_type in ('subcontract_round', 'subcontract_opening', 'subcontract_terms')
        and payload->>'subcontractId' = c.id order by created_at desc limit 100) e), '[]'::jsonb),
    'partners', case when app_private.finance_can('manage') then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'taxCode', p.tax_code) order by p.name)
      from public.business_partners p where coalesce(p.is_active, true) and p.classifications && array['contractor', 'crew', 'supplier']::text[]), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Điều khoản tài chính HĐ thầu phụ (Quản trị Tài chính)
-- ---------------------------------------------------------------------------
create function public.save_finance_subcontract_terms_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.subcontractor_contracts%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_vat numeric := nullif(p_input->>'vatPercent', '')::numeric; v_rec numeric := nullif(p_input->>'advanceRecoveryPercent', '')::numeric;
  v_ret numeric := coalesce(nullif(p_input->>'retentionPercent', '')::numeric, 0); v_days integer := nullif(p_input->>'paymentTermDays', '')::integer;
  v_war integer := nullif(p_input->>'warrantyMonths', '')::integer; v_pit boolean := coalesce((p_input->>'withholdPit')::boolean, false);
  v_pitp numeric := coalesce(nullif(p_input->>'pitPercent', '')::numeric, 10); v_partner text := nullif(p_input->>'partnerId', '');
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if (v_vat is not null and (v_vat < 0 or v_vat > 100)) or (v_rec is not null and (v_rec < 0 or v_rec > 100)) or v_ret < 0 or v_ret > 100
    or (v_days is not null and (v_days < 0 or v_days > 365)) or (v_war is not null and (v_war < 0 or v_war > 120)) or v_pitp < 0 or v_pitp > 100 then
    raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into c from public.subcontractor_contracts where id = p_input->>'subcontractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if v_partner is not null and not exists (select 1 from public.business_partners where id = v_partner) then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  -- Đổi đối tác khi đã có đợt / tạm ứng làm lệch công nợ → chặn.
  if c.partner_id is not null and v_partner is distinct from c.partner_id and (exists (select 1 from public.finance_subcontract_rounds r where r.subcontract_id = c.id and r.status <> 'cancelled')
    or exists (select 1 from public.finance_payment_requests r where r.subcontract_id = c.id and r.status not in ('rejected', 'withdrawn', 'cancelled'))) then
    raise exception using errcode = '22023', message = 'FINANCE_SUB_PARTNER_LOCKED'; end if;
  update public.subcontractor_contracts set vat_percent = v_vat, advance_recovery_percent = v_rec, retention_percent = v_ret, payment_term_days = v_days,
    warranty_months = v_war, withhold_pit = v_pit, pit_percent = v_pitp, partner_id = coalesce(v_partner, c.partner_id), updated_at = now() where id = c.id;
  -- Hạn giữ lại của các đợt đã ghi nhận đi theo HĐ (ngày hoàn thành + tháng bảo hành).
  update public.supplier_payable_documents set due_date = app_private.finance_sub_retention_due(c.id), updated_at = now()
  where subcontract_id = c.id and source_type = 'subcontract_retention' and due_date_source = 'contract' and status in ('open', 'partial');
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, before, after, payload)
  values ('subcontract_terms', c.id, coalesce(v_partner, c.partner_id), 'subcontract_terms_save', v_actor, v_reason,
    jsonb_build_object('vatPercent', c.vat_percent, 'advanceRecoveryPercent', c.advance_recovery_percent, 'retentionPercent', c.retention_percent,
      'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months, 'withholdPit', c.withhold_pit, 'pitPercent', c.pit_percent, 'partnerId', c.partner_id),
    jsonb_build_object('vatPercent', v_vat, 'advanceRecoveryPercent', v_rec, 'retentionPercent', v_ret, 'paymentTermDays', v_days, 'warrantyMonths', v_war,
      'withholdPit', v_pit, 'pitPercent', v_pitp, 'partnerId', coalesce(v_partner, c.partner_id)),
    jsonb_build_object('subcontractId', c.id, 'code', c.code));
  return jsonb_build_object('subcontractId', c.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Đầu kỳ theo MISA
-- ---------------------------------------------------------------------------
create function public.save_finance_subcontract_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.subcontractor_contracts%rowtype; v_id uuid; v_cut date;
  v_cum numeric := round(coalesce(nullif(p_input->>'cumulativeNet', '')::numeric, -1), 2); v_out numeric := round(coalesce(nullif(p_input->>'outstanding', '')::numeric, -1), 2);
  v_ret numeric := round(coalesce(nullif(p_input->>'retentionHeld', '')::numeric, 0), 2); v_adv numeric := round(coalesce(nullif(p_input->>'advanceRemaining', '')::numeric, 0), 2);
  v_paid numeric := round(coalesce(nullif(p_input->>'paidTotal', '')::numeric, 0), 2);
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into c from public.subcontractor_contracts where id = p_input->>'subcontractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if c.partner_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_PARTNER_REQUIRED'; end if;
  if v_cum < 0 or v_out < 0 or v_ret < 0 or v_adv < 0 or v_paid < 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if jsonb_array_length(coalesce(p_input->'attachments', '[]'::jsonb)) = 0 then raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.finance_subcontract_openings where subcontract_id = c.id and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_SUB_OPENING_EXISTS'; end if;
  if exists (select 1 from public.finance_subcontract_rounds where subcontract_id = c.id and status <> 'cancelled' and kind = 'progress') then
    raise exception using errcode = '22023', message = 'FINANCE_SUB_OPENING_HAS_ROUNDS'; end if;
  select ap_cutover_date into v_cut from public.finance_settings where id = 1;
  insert into public.finance_subcontract_openings (subcontract_id, cutover_date, cumulative_net, paid_total, outstanding, outstanding_due_date, retention_held,
    retention_due_date, advance_remaining, note, attachments, created_by)
  values (c.id, v_cut, v_cum, v_paid, v_out, nullif(p_input->>'outstandingDueDate', '')::date, v_ret,
    coalesce(nullif(p_input->>'retentionDueDate', '')::date, app_private.finance_sub_retention_due(c.id)), v_adv,
    nullif(btrim(p_input->>'note'), ''), p_input->'attachments', v_actor)
  returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('subcontract_opening', v_id::text, c.partner_id, 'subcontract_opening_submit', v_actor,
    jsonb_build_object('subcontractId', c.id, 'code', c.code, 'cumulativeNet', v_cum, 'outstanding', v_out, 'retentionHeld', v_ret, 'advanceRemaining', v_adv));
  perform app_private.finance_notify_sub(app_private.finance_users_with('confirm'), 'Đầu kỳ thầu phụ chờ chốt',
    c.code || ' · còn nợ ' || to_char(v_out, 'FM999G999G999G990') || ' đ', c.id, v_actor);
  return jsonb_build_object('id', v_id);
end $$;

create function public.decide_finance_subcontract_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  o public.finance_subcontract_openings%rowtype; c public.subcontractor_contracts%rowtype; v_round uuid; v_doc uuid; v_rdoc uuid; v_name text;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into o from public.finance_subcontract_openings where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_OPENING_NOT_FOUND'; end if;
  select * into c from public.subcontractor_contracts where id = o.subcontract_id;
  select name into v_name from public.business_partners where id = c.partner_id;
  if v_action in ('confirm', 'reject') then
    if o.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if o.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
  end if;
  if v_action = 'reject' then
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_subcontract_openings set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = o.id;
    perform app_private.finance_notify_sub(array[o.created_by], 'Đầu kỳ thầu phụ bị trả lại', c.code || ' · ' || v_reason, c.id, v_actor);
  elsif v_action = 'confirm' then
    if c.partner_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_PARTNER_REQUIRED'; end if;
    insert into public.finance_subcontract_rounds (subcontract_id, project_id, construction_site_id, supplier_id, sequence_no, kind, period_end, description,
      cumulative_net, previous_net, net_amount, gross_amount, status, recognized_date, recognized_by, recognized_at, attachments, note, created_by, submitted_by, submitted_at)
    values (c.id, c.project_id, c.construction_site_id, c.partner_id, 0, 'opening', o.cutover_date - 1, 'Số dư đầu kỳ theo MISA',
      o.cumulative_net, 0, o.cumulative_net, 0, 'recognized', o.cutover_date - 1, v_actor, now(), o.attachments, o.note, o.created_by, o.created_by, o.created_at)
    returning id into v_round;
    if o.outstanding > 0 then
      insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
        document_no, document_date, due_date, due_date_source, committed_amount, recognized_amount, status, metadata, created_by, subcontract_id)
      values ('AP-TP-DK-' || upper(left(replace(o.id::text, '-', ''), 8)), 'subcontract_opening', o.id::text, c.project_id, c.construction_site_id, c.partner_id,
        coalesce(v_name, c.subcontractor_name), c.code || ' · số dư đầu kỳ', o.cutover_date - 1,
        coalesce(o.outstanding_due_date, o.cutover_date + coalesce(c.payment_term_days, (select default_payment_days from public.finance_settings where id = 1), 30)), 'manual',
        o.outstanding, o.outstanding, 'open', jsonb_build_object('subcontractCode', c.code, 'origin', 'subcontract_opening'), o.created_by, c.id)
      returning id into v_doc;
    end if;
    if o.retention_held > 0 then
      insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
        document_no, document_date, due_date, due_date_source, committed_amount, recognized_amount, status, metadata, created_by, subcontract_id)
      values ('AP-TP-GL-' || upper(left(replace(o.id::text, '-', ''), 8)), 'subcontract_retention', o.id::text, c.project_id, c.construction_site_id, c.partner_id,
        coalesce(v_name, c.subcontractor_name), c.code || ' · giữ lại bảo hành đầu kỳ', o.cutover_date - 1, o.retention_due_date, 'manual',
        o.retention_held, o.retention_held, 'open', jsonb_build_object('subcontractCode', c.code, 'origin', 'subcontract_opening'), o.created_by, c.id)
      returning id into v_rdoc;
    end if;
    update public.finance_subcontract_openings set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason,
      opening_round_id = v_round, payable_document_id = v_doc, retention_document_id = v_rdoc where id = o.id;
    perform app_private.finance_notify_sub(array[o.created_by], 'Đã chốt đầu kỳ thầu phụ', c.code, c.id, v_actor);
  elsif v_action = 'cancel' then
    if o.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if exists (select 1 from public.finance_subcontract_rounds where subcontract_id = c.id and kind = 'progress' and status <> 'cancelled') then
      raise exception using errcode = '22023', message = 'FINANCE_SUB_OPENING_HAS_ROUNDS'; end if;
    if exists (select 1 from app_private.finance_payable_rows() x where x.id in (o.payable_document_id, o.retention_document_id) and (x.paid > 0 or x.pending_external > 0))
      or exists (select 1 from public.finance_payment_request_lines l join public.finance_payment_requests r on r.id = l.request_id
        where l.payable_document_id in (o.payable_document_id, o.retention_document_id) and r.status in ('pending', 'returned', 'approved')) then
      raise exception using errcode = '22023', message = 'FINANCE_OPENING_HAS_PAYMENTS'; end if;
    update public.supplier_payable_documents set status = 'cancelled', updated_at = now() where id in (o.payable_document_id, o.retention_document_id);
    update public.finance_subcontract_rounds set status = 'cancelled', cancel_reason = v_reason, cancelled_by = v_actor, cancelled_at = now(),
      updated_at = now(), row_version = row_version + 1 where id = o.opening_round_id;
    update public.finance_subcontract_openings set status = 'cancelled', decision_note = v_reason where id = o.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('subcontract_opening', o.id::text, c.partner_id, 'subcontract_opening_' || v_action, v_actor, v_reason,
    jsonb_build_object('subcontractId', c.id, 'code', c.code, 'outstanding', o.outstanding, 'retentionHeld', o.retention_held, 'advanceRemaining', o.advance_remaining));
  return jsonb_build_object('id', o.id, 'status', (select status from public.finance_subcontract_openings where id = o.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Đợt nghiệm thu thanh toán
-- ---------------------------------------------------------------------------
-- Kiểm tra + tính một đợt từ dữ liệu nhập (dùng cho lưu nháp và xem trước).
create function app_private.finance_sub_round_calc(p_input jsonb, p_round uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.subcontractor_contracts%rowtype; m jsonb; s record; d jsonb; v_prev numeric; v_cum numeric := round(nullif(p_input->>'cumulativeNet', '')::numeric, 2);
  v_net numeric; v_vat numeric; v_vat_amt numeric; v_gross numeric; v_rec numeric; v_ret numeric; v_pit numeric; v_other numeric := 0;
  v_deductions jsonb := '[]'::jsonb; v_reason text := nullif(btrim(p_input->>'adjustReason'), ''); v_over text := nullif(btrim(p_input->>'overContractReason'), '');
  v_ps date := nullif(p_input->>'periodStart', '')::date; v_pe date := nullif(p_input->>'periodEnd', '')::date;
begin
  select * into c from public.subcontractor_contracts where id = p_input->>'subcontractId';
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  m := app_private.finance_subcontract_metrics(c.id);
  if m->>'opening' <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_SUB_OPENING_REQUIRED'; end if;
  if c.partner_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_PARTNER_REQUIRED'; end if;
  if c.project_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_PROJECT_REQUIRED'; end if;
  if coalesce(c.status, '') not in ('signed', 'active', 'completed') then raise exception using errcode = '22023', message = 'FINANCE_SUB_CONTRACT_STATE'; end if;
  if v_pe is null or (v_ps is not null and v_ps > v_pe) then raise exception using errcode = '22023', message = 'FINANCE_SUB_PERIOD_INVALID'; end if;
  if nullif(btrim(p_input->>'description'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_ROUND_DESCRIPTION_REQUIRED'; end if;
  v_prev := app_private.finance_sub_previous_net(c.id);
  if v_cum is null or v_cum <= v_prev then raise exception using errcode = '22023', message = 'FINANCE_SUB_CUMULATIVE_INVALID'; end if;
  if coalesce(c.value, 0) > 0 and v_cum > c.value + 0.5 and v_over is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_OVER_CONTRACT'; end if;
  v_net := v_cum - v_prev;
  v_vat := coalesce(nullif(p_input->>'vatPercent', '')::numeric, c.vat_percent, 0);
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  v_vat_amt := round(v_net * v_vat / 100, 2); v_gross := v_net + v_vat_amt;
  select * into s from app_private.finance_sub_suggest(c.id, v_net, v_gross);
  v_rec := coalesce(round(nullif(p_input->>'advanceRecovery', '')::numeric, 2), s.recovery);
  v_ret := coalesce(round(nullif(p_input->>'retention', '')::numeric, 2), s.retention);
  v_pit := coalesce(round(nullif(p_input->>'pit', '')::numeric, 2), s.pit);
  for d in select value from jsonb_array_elements(coalesce(p_input->'deductions', '[]'::jsonb)) loop
    if coalesce(d->>'kind', '') not in ('material', 'service', 'penalty', 'other') or coalesce(nullif(d->>'amount', '')::numeric, 0) <= 0
      or nullif(btrim(d->>'reason'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_DEDUCTION_INVALID'; end if;
    v_other := v_other + round((d->>'amount')::numeric, 2);
    v_deductions := v_deductions || jsonb_build_array(jsonb_build_object('kind', d->>'kind', 'amount', round((d->>'amount')::numeric, 2), 'reason', btrim(d->>'reason')));
  end loop;
  if v_rec < 0 or v_ret < 0 or v_pit < 0 or v_rec + v_ret + v_pit + v_other > v_gross then
    raise exception using errcode = '22023', message = 'FINANCE_ROUND_DEDUCTION_INVALID'; end if;
  if v_rec > coalesce((m->>'advanceRemaining')::numeric, 0) + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_SUB_RECOVERY_OVER'; end if;
  if (abs(v_rec - s.recovery) > 1 or abs(v_ret - s.retention) > 1 or abs(v_pit - s.pit) > 1) and v_reason is null then
    raise exception using errcode = '22023', message = 'FINANCE_ROUND_ADJUST_REASON'; end if;
  return jsonb_build_object('subcontractId', c.id, 'previousNet', v_prev, 'cumulativeNet', v_cum, 'netAmount', v_net, 'vatPercent', v_vat, 'vatAmount', v_vat_amt,
    'gross', v_gross, 'advanceRecovery', v_rec, 'retention', v_ret, 'pit', v_pit, 'otherDeduction', v_other, 'deductions', v_deductions,
    'payable', v_gross - v_rec - v_ret - v_pit - v_other, 'suggestedRecovery', s.recovery, 'suggestedRetention', s.retention, 'suggestedPit', s.pit,
    'adjustReason', v_reason, 'overContractReason', v_over, 'periodStart', v_ps, 'periodEnd', v_pe,
    'overContract', coalesce(c.value, 0) > 0 and v_cum > c.value + 0.5,
    'cumulativePercent', case when coalesce(c.value, 0) > 0 then round(v_cum * 100 / c.value, 1) end);
end $$;

create function public.preview_finance_subcontract_round_v1(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; c public.subcontractor_contracts%rowtype; b record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  v := app_private.finance_sub_round_calc(p_input, nullif(p_input->>'id', '')::uuid);
  select * into c from public.subcontractor_contracts where id = p_input->>'subcontractId';
  select * into b from app_private.finance_budget_check(c.project_id, app_private.finance_sub_cost_item(), (v->>'gross')::numeric, null);
  return v || jsonb_build_object('budget', jsonb_build_object('over', b.over, 'budget', b.budget, 'projected', b.projected, 'item', b.item_name));
end $$;

create function public.save_finance_subcontract_round_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); r public.finance_subcontract_rounds%rowtype; c public.subcontractor_contracts%rowtype; v jsonb; v_id uuid; v_seq integer;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if nullif(p_input->>'id', '') is not null then
    select * into r from public.finance_subcontract_rounds where id = (p_input->>'id')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ROUND_NOT_FOUND'; end if;
    if r.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if r.status <> 'draft' or r.kind <> 'progress' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    p_input := p_input || jsonb_build_object('subcontractId', r.subcontract_id);
  end if;
  select * into c from public.subcontractor_contracts where id = p_input->>'subcontractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if r.id is null and exists (select 1 from public.finance_subcontract_rounds where subcontract_id = c.id and status in ('draft', 'submitted')) then
    raise exception using errcode = '22023', message = 'FINANCE_SUB_ROUND_OPEN_EXISTS'; end if;
  v := app_private.finance_sub_round_calc(p_input, r.id);
  if r.id is null then
    select coalesce(max(sequence_no), 0) + 1 into v_seq from public.finance_subcontract_rounds where subcontract_id = c.id;
    insert into public.finance_subcontract_rounds (subcontract_id, project_id, construction_site_id, supplier_id, sequence_no, kind, period_start, period_end, description,
      cumulative_net, previous_net, net_amount, vat_percent, vat_amount, gross_amount, advance_recovery, retention, pit_amount, other_deduction, deductions,
      suggested_recovery, suggested_retention, suggested_pit, adjust_reason, over_contract_reason, attachments, note, created_by)
    values (c.id, c.project_id, c.construction_site_id, c.partner_id, v_seq, 'progress', (v->>'periodStart')::date, (v->>'periodEnd')::date, btrim(p_input->>'description'),
      (v->>'cumulativeNet')::numeric, (v->>'previousNet')::numeric, (v->>'netAmount')::numeric, (v->>'vatPercent')::numeric, (v->>'vatAmount')::numeric,
      (v->>'gross')::numeric, (v->>'advanceRecovery')::numeric, (v->>'retention')::numeric, (v->>'pit')::numeric, (v->>'otherDeduction')::numeric, v->'deductions',
      (v->>'suggestedRecovery')::numeric, (v->>'suggestedRetention')::numeric, (v->>'suggestedPit')::numeric, v->>'adjustReason', v->>'overContractReason',
      coalesce(p_input->'attachments', '[]'::jsonb), nullif(btrim(p_input->>'note'), ''), v_actor)
    returning id into v_id;
  else
    v_id := r.id;
    update public.finance_subcontract_rounds set period_start = (v->>'periodStart')::date, period_end = (v->>'periodEnd')::date, description = btrim(p_input->>'description'),
      cumulative_net = (v->>'cumulativeNet')::numeric, previous_net = (v->>'previousNet')::numeric, net_amount = (v->>'netAmount')::numeric,
      vat_percent = (v->>'vatPercent')::numeric, vat_amount = (v->>'vatAmount')::numeric, gross_amount = (v->>'gross')::numeric,
      advance_recovery = (v->>'advanceRecovery')::numeric, retention = (v->>'retention')::numeric, pit_amount = (v->>'pit')::numeric,
      other_deduction = (v->>'otherDeduction')::numeric, deductions = v->'deductions', suggested_recovery = (v->>'suggestedRecovery')::numeric,
      suggested_retention = (v->>'suggestedRetention')::numeric, suggested_pit = (v->>'suggestedPit')::numeric, adjust_reason = v->>'adjustReason',
      over_contract_reason = v->>'overContractReason', attachments = coalesce(p_input->'attachments', '[]'::jsonb), note = nullif(btrim(p_input->>'note'), ''),
      supplier_id = c.partner_id, updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  select * into r from public.finance_subcontract_rounds where id = v_id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('subcontract_round', v_id::text, c.partner_id, case when p_input->>'id' is null then 'subcontract_round_create' else 'subcontract_round_update' end, v_actor,
    coalesce(r.adjust_reason, r.over_contract_reason),
    jsonb_build_object('subcontractId', c.id, 'code', c.code, 'sequenceNo', r.sequence_no, 'cumulativeNet', r.cumulative_net, 'gross', r.gross_amount, 'payable', r.payable));
  return jsonb_build_object('id', v_id, 'sequenceNo', r.sequence_no, 'payable', r.payable, 'rowVersion', r.row_version);
end $$;

create function public.transition_finance_subcontract_round_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  r public.finance_subcontract_rounds%rowtype; c public.subcontractor_contracts%rowtype; m jsonb; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_date date := coalesce(nullif(p_input->>'date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_cut date; v_name text;
  v_open_rec numeric; v_vioo_rec numeric; v_doc_amt numeric; v_doc uuid; v_rdoc uuid; v_due date; v_rdue date; a record; v_left numeric; v_took numeric;
begin
  select * into r from public.finance_subcontract_rounds where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ROUND_NOT_FOUND'; end if;
  if r.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if r.kind <> 'progress' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
  select * into c from public.subcontractor_contracts where id = r.subcontract_id for update;
  select name into v_name from public.business_partners where id = r.supplier_id;
  select ap_cutover_date into v_cut from public.finance_settings where id = 1;

  if v_action = 'submit' then
    if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
    if r.status <> 'draft' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if jsonb_array_length(r.attachments) = 0 then raise exception using errcode = '22023', message = 'FINANCE_SUB_ATTACHMENT_REQUIRED'; end if;
    -- Số đầu vào có thể đã đổi (đợt trước bị đảo, tạm ứng vừa cấn trừ): tính lại trước khi gửi.
    perform app_private.finance_sub_round_calc(jsonb_build_object('subcontractId', r.subcontract_id, 'cumulativeNet', r.cumulative_net, 'vatPercent', r.vat_percent,
      'advanceRecovery', r.advance_recovery, 'retention', r.retention, 'pit', r.pit_amount, 'deductions', r.deductions, 'adjustReason', r.adjust_reason,
      'overContractReason', r.over_contract_reason, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'description', r.description), r.id);
    if r.previous_net <> app_private.finance_sub_previous_net(r.subcontract_id) then raise exception using errcode = '22023', message = 'FINANCE_SUB_ROUND_STALE'; end if;
    update public.finance_subcontract_rounds set status = 'submitted', submitted_by = v_actor, submitted_at = now(), return_reason = null,
      updated_at = now(), row_version = row_version + 1 where id = r.id;
    perform app_private.finance_notify_sub(app_private.finance_users_with('confirm'), 'Đợt thầu phụ chờ ghi nhận',
      c.code || ' · đợt ' || r.sequence_no || ' · phải trả ' || to_char(r.payable, 'FM999G999G999G990') || ' đ', c.id, v_actor);
  elsif v_action = 'withdraw' then
    if r.status <> 'submitted' or r.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.finance_subcontract_rounds set status = 'draft', updated_at = now(), row_version = row_version + 1 where id = r.id;
  elsif v_action = 'return' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if r.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if r.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_subcontract_rounds set status = 'draft', return_reason = v_reason, returned_by = v_actor, returned_at = now(),
      updated_at = now(), row_version = row_version + 1 where id = r.id;
    perform app_private.finance_notify_sub(array[r.created_by], 'Đợt thầu phụ bị trả lại', c.code || ' · đợt ' || r.sequence_no || ' · ' || v_reason, c.id, v_actor);
  elsif v_action = 'cancel' then
    if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
    if r.status not in ('draft', 'submitted') then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_subcontract_rounds set status = 'cancelled', cancel_reason = v_reason, cancelled_by = v_actor, cancelled_at = now(),
      updated_at = now(), row_version = row_version + 1 where id = r.id;
  elsif v_action = 'recognize' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if r.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if r.created_by = v_actor or r.submitted_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_DATE_FUTURE'; end if;
    if v_date < v_cut then raise exception using errcode = '22023', message = 'FINANCE_CASH_BEFORE_CUTOVER'; end if;
    if r.previous_net <> app_private.finance_sub_previous_net(r.subcontract_id) then raise exception using errcode = '22023', message = 'FINANCE_SUB_ROUND_STALE'; end if;
    if r.supplier_id is distinct from c.partner_id then raise exception using errcode = '22023', message = 'FINANCE_SUB_ROUND_STALE'; end if;
    m := app_private.finance_subcontract_metrics(c.id);
    if r.advance_recovery > coalesce((m->>'advanceRemaining')::numeric, 0) + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_SUB_RECOVERY_OVER'; end if;
    -- Thu hồi tạm ứng: phần tạm ứng trước mốc (MISA) trước, phần tạm ứng chi qua Vioo cấn trừ vào chứng từ của đợt.
    v_open_rec := least(r.advance_recovery, coalesce((m->>'advanceRemainingOpening')::numeric, 0));
    v_vioo_rec := round(r.advance_recovery - v_open_rec, 2);
    v_doc_amt := round(r.payable + v_vioo_rec, 2);
    v_due := v_date + coalesce((m->>'paymentTermDays')::integer, 30);
    v_rdue := app_private.finance_sub_retention_due(c.id);
    if v_doc_amt > 0 then
      insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
        document_no, document_date, due_date, due_date_source, committed_amount, recognized_amount, status, metadata, created_by, subcontract_id)
      values ('AP-TP-' || to_char(v_date, 'YYYYMM') || '-' || upper(left(replace(r.id::text, '-', ''), 6)), 'subcontract_round', r.id::text, r.project_id,
        r.construction_site_id, r.supplier_id, coalesce(v_name, c.subcontractor_name), c.code || ' · đợt ' || r.sequence_no, v_date, v_due,
        case when c.payment_term_days is not null then 'contract' else 'default' end, v_doc_amt, v_doc_amt, 'open',
        jsonb_build_object('subcontractCode', c.code, 'roundNo', r.sequence_no, 'origin', 'subcontract_round'), r.created_by, c.id)
      returning id into v_doc;
    end if;
    if r.retention > 0 then
      insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
        document_no, document_date, due_date, due_date_source, committed_amount, recognized_amount, status, metadata, created_by, subcontract_id)
      values ('AP-TP-GL-' || to_char(v_date, 'YYYYMM') || '-' || upper(left(replace(r.id::text, '-', ''), 6)), 'subcontract_retention', r.id::text, r.project_id,
        r.construction_site_id, r.supplier_id, coalesce(v_name, c.subcontractor_name), c.code || ' · giữ lại đợt ' || r.sequence_no, v_date, v_rdue, 'contract',
        r.retention, r.retention, 'open', jsonb_build_object('subcontractCode', c.code, 'roundNo', r.sequence_no, 'origin', 'subcontract_round'), r.created_by, c.id)
      returning id into v_rdoc;
    end if;
    v_left := v_vioo_rec;
    for a in select * from app_private.finance_sub_vioo_advances(c.id) loop
      exit when v_left <= 0.004;
      v_took := app_private.finance_advance_apply(a.id, v_doc, least(v_left, a.remaining), 'manual', v_actor);
      v_left := round(v_left - v_took, 2);
    end loop;
    if v_left > 0.5 then raise exception using errcode = '22023', message = 'FINANCE_SUB_RECOVERY_OVER'; end if;
    perform app_private.finance_post_project_cost('fsc-' || r.id::text, r.project_id, app_private.finance_sub_cost_item(), r.gross_amount, v_date,
      'Nghiệm thu thầu phụ ' || c.code || ' đợt ' || r.sequence_no || ' · ' || coalesce(v_name, c.subcontractor_name),
      'finance_subcontract_round:' || r.id::text, coalesce(v_name, c.subcontractor_name), r.attachments, v_actor);
    update public.finance_subcontract_rounds set status = 'recognized', recognized_date = v_date, recognized_by = v_actor, recognized_at = now(),
      advance_recovery_opening = v_open_rec, due_date = v_due, retention_due_date = v_rdue, payable_document_id = v_doc, retention_document_id = v_rdoc,
      updated_at = now(), row_version = row_version + 1 where id = r.id;
    perform app_private.finance_notify_sub(array[r.created_by], 'Đợt thầu phụ đã ghi nhận',
      c.code || ' · đợt ' || r.sequence_no || ' · phải trả ' || to_char(r.payable, 'FM999G999G999G990') || ' đ, hạn ' || to_char(v_due, 'DD/MM/YYYY'), c.id, v_actor);
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if r.status <> 'recognized' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if exists (select 1 from public.finance_subcontract_rounds y where y.subcontract_id = r.subcontract_id and y.sequence_no > r.sequence_no and y.status = 'recognized') then
      raise exception using errcode = '22023', message = 'FINANCE_SUB_ROUND_NOT_LAST'; end if;
    if exists (select 1 from public.supplier_payment_allocations x join public.supplier_payment_batches b on b.id = x.payment_batch_id
        where x.payable_document_id in (r.payable_document_id, r.retention_document_id) and b.status in ('submitted', 'paid')
          and coalesce(b.metadata->>'kind', '') <> 'advance')
      or exists (select 1 from public.finance_payment_request_lines l join public.finance_payment_requests q on q.id = l.request_id
        where l.payable_document_id in (r.payable_document_id, r.retention_document_id) and q.status in ('pending', 'returned', 'approved')) then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_HAS_PAYMENTS'; end if;
    -- Hủy chứng từ → trigger trả lại phần tạm ứng đã cấn trừ.
    update public.supplier_payable_documents set status = 'cancelled', updated_at = now() where id in (r.payable_document_id, r.retention_document_id);
    perform app_private.finance_reverse_project_cost('finance_subcontract_round:' || r.id::text, v_reason, v_actor);
    update public.finance_subcontract_rounds set status = 'cancelled', cancel_reason = v_reason, cancelled_by = v_actor, cancelled_at = now(),
      updated_at = now(), row_version = row_version + 1 where id = r.id;
    perform app_private.finance_notify_sub(array[r.created_by, r.recognized_by], 'Đợt thầu phụ đã bị đảo', c.code || ' · đợt ' || r.sequence_no || ' · ' || v_reason, c.id, v_actor);
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  select 'subcontract_round', r.id::text, r.supplier_id, 'subcontract_round_' || v_action, v_actor, v_reason,
    jsonb_build_object('subcontractId', c.id, 'code', c.code, 'sequenceNo', r.sequence_no, 'gross', x.gross_amount, 'payable', x.payable,
      'retention', x.retention, 'date', case when v_action = 'recognize' then v_date end, 'dueDate', x.due_date)
  from public.finance_subcontract_rounds x where x.id = r.id;
  return (select jsonb_build_object('id', x.id, 'status', x.status, 'payable', x.payable, 'dueDate', x.due_date, 'rowVersion', x.row_version)
    from public.finance_subcontract_rounds x where x.id = r.id);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Tạm ứng thầu phụ (đề nghị chi loại tạm ứng gắn HĐ thầu phụ)
-- ---------------------------------------------------------------------------
create function app_private.finance_sub_advance_target(p_sub text, p_exclude uuid)
returns table (subcontract_id text, supplier_id text, project_id text, construction_site_id text, base numeric, other numeric, code text, expected_date date)
language plpgsql stable security definer set search_path = '' as $$
declare c public.subcontractor_contracts%rowtype;
begin
  select * into c from public.subcontractor_contracts where id = p_sub;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUBCONTRACT_NOT_FOUND'; end if;
  if c.partner_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_PARTNER_REQUIRED'; end if;
  if c.project_id is null then raise exception using errcode = '22023', message = 'FINANCE_SUB_PROJECT_REQUIRED'; end if;
  if coalesce(c.status, '') not in ('signed', 'active') then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_CLOSED'; end if;
  subcontract_id := c.id; supplier_id := c.partner_id; project_id := c.project_id; construction_site_id := c.construction_site_id;
  base := case when coalesce(c.value, 0) > 0 then round(c.value * (1 + coalesce(c.vat_percent, 0) / 100), 2) end;
  other := (select coalesce(sum(r.amount), 0) from public.finance_payment_requests r where r.kind = 'advance' and r.subcontract_id = c.id
    and r.status in ('pending', 'returned', 'approved', 'paid') and r.id is distinct from p_exclude);
  code := c.code; expected_date := c.completion_date;
  return next;
end $$;

create function public.preview_finance_subcontract_advance_v1(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_req uuid := nullif(p_input->>'requestId', '')::uuid;
  v_amount numeric := greatest(coalesce(round(nullif(p_input->>'amount', '')::numeric, 2), 0), 0.01); t record; v_bp record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into t from app_private.finance_sub_advance_target(p_input->>'subcontractId', v_req);
  select bank_name, bank_account into v_bp from public.business_partners where id = t.supplier_id;
  return jsonb_build_object(
    'route', app_private.finance_route_extras(app_private.finance_advance_route(t.supplier_id, v_amount, case when t.base > 0 then round(v_amount * 100 / t.base, 3) end, v_actor, v_req),
      jsonb_build_array(jsonb_build_object('projectId', t.project_id, 'amount', v_amount)), v_actor, v_req),
    'target', jsonb_build_object('base', t.base, 'other', t.other, 'contractCode', t.code, 'expectedDate', t.expected_date, 'projectId', t.project_id,
      'available', case when t.base is not null then greatest(t.base - t.other, 0) end),
    'bank', case when nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then null else jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
    'canRecord', app_private.finance_can('record'));
end $$;

create function public.save_finance_subcontract_advance_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype;
  v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer'); v_date date := nullif(p_input->>'plannedDate', '')::date;
  v_due date := nullif(p_input->>'repayDueDate', '')::date; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_note text := nullif(btrim(p_input->>'note'), ''); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_bp record; t record; v_percent numeric; v_route jsonb; v_id uuid; v_code text; v_submission integer := 1;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_method not in ('bank_transfer', 'cash') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if v_date is null or v_date < v_today - 30 then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_note is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_due is null or v_due < v_today then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_DUE_INVALID'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.kind <> 'advance' or v_req.status <> 'returned' or v_req.created_by is distinct from v_actor or v_req.subcontract_id is distinct from p_input->>'subcontractId' then
      raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;
  perform 1 from public.subcontractor_contracts where id = p_input->>'subcontractId' for update;
  select * into t from app_private.finance_sub_advance_target(p_input->>'subcontractId', v_req.id);
  if exists (select 1 from public.finance_internal_partners where supplier_id = t.supplier_id) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  select id, name, bank_name, bank_account into v_bp from public.business_partners where id = t.supplier_id;
  if v_method = 'bank_transfer' and nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_BANK_REQUIRED'; end if;
  if t.base is not null and v_amount + t.other > t.base + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER_ORDER'; end if;
  v_percent := case when t.base > 0 then round(v_amount * 100 / t.base, 3) end;
  v_route := app_private.finance_advance_route(t.supplier_id, v_amount, v_percent, v_actor, v_req.id);
  v_route := app_private.finance_route_extras(v_route, jsonb_build_array(jsonb_build_object('projectId', t.project_id, 'amount', v_amount)), v_actor, v_req.id);
  if v_route->>'problemStep' is not null then
    raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;
  if v_req.id is null then
    v_code := 'TU-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_advance_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, bank_snapshot, planned_date, amount, note, status,
      matrix_version_id, threshold_amount, prior_requests, route, current_step, created_by, kind, subcontract_id,
      project_id, construction_site_id, advance_base, advance_percent, repay_due_date)
    values (v_code, t.supplier_id, v_bp.name, v_method,
      case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      v_date, v_amount, v_note, 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor, 'advance', t.subcontract_id, t.project_id, t.construction_site_id, t.base, v_percent, v_due)
    returning id into v_id;
  else
    v_id := v_req.id; v_code := v_req.code;
    update public.finance_payment_requests set method = v_method,
      bank_snapshot = case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      planned_date = v_date, amount = v_amount, note = v_note, status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null,
      advance_base = t.base, advance_percent = v_percent, repay_due_date = v_due, updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập đề nghị tạm ứng thầu phụ và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_amount, 'percent', v_percent, 'thresholdAmount', v_route->'thresholdAmount', 'tierNo', v_route->'tierNo'));
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Đề nghị tạm ứng chờ bạn duyệt', v_code || ' · ' || v_bp.name || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_id::text, t.supplier_id, 'advance_submit', v_actor,
    jsonb_build_object('code', v_code, 'amount', v_amount, 'percent', v_percent, 'contract', t.code, 'subcontractId', t.subcontract_id, 'submission', v_submission));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_amount, 'route', v_route);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Soát xét chi phí nhân công ghi tay
-- ---------------------------------------------------------------------------
create function public.review_finance_manual_cost_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); t public.project_transactions%rowtype; v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2); v_rev text;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into t from public.project_transactions where id = p_input->>'transactionId' for update;
  if not found or t.type <> 'expense' or t.source <> 'manual' or t.amount <= 0 then raise exception using errcode = 'PT404', message = 'FINANCE_COST_REVIEW_NOT_FOUND'; end if;
  if exists (select 1 from public.finance_events e where e.entity_type = 'cost_review' and e.entity_id = t.id) then
    raise exception using errcode = '22023', message = 'FINANCE_COST_REVIEW_DONE'; end if;
  if v_action = 'reverse' then
    if v_amount is null or v_amount <= 0 or v_amount > t.amount then raise exception using errcode = '22023', message = 'FINANCE_COST_REVIEW_AMOUNT'; end if;
    if app_private.finance_period_is_locked(t.project_id, null, 'VND', left(t.date, 10)::date) then
      raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
    v_rev := t.id || '-review';
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name,
      contract_cost_item_id, contract_cost_item_symbol_snapshot, contract_cost_item_name_snapshot, cost_classification_status)
    values (v_rev, t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
      'expense', t.category, -v_amount, 'Đảo phần trùng MISA: ' || t.description || ' — ' || v_reason, t.date, 'workflow',
      'finance_cost_review:' || t.id, 'finance_cost_review:' || t.id, coalesce(p_input->'attachments', '[]'::jsonb), v_actor::text, now(), t.counterparty_name,
      t.contract_cost_item_id, t.contract_cost_item_symbol_snapshot, t.contract_cost_item_name_snapshot, 'manual');
  elsif v_action <> 'keep' then
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('cost_review', t.id, case when v_action = 'reverse' then 'cost_review_reverse' else 'cost_review_keep' end, v_actor, v_reason,
    jsonb_build_object('projectId', t.project_id, 'amount', t.amount, 'reversed', case when v_action = 'reverse' then v_amount end,
      'description', t.description, 'misaIds', p_input->'misaIds'));
  return jsonb_build_object('transactionId', t.id, 'reversed', case when v_action = 'reverse' then v_amount else 0 end);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Quyền gọi hàm
-- ---------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array['public.get_finance_subcontracts_v1()', 'public.get_finance_subcontract_v1(text)', 'public.save_finance_subcontract_terms_v1(jsonb)',
    'public.save_finance_subcontract_opening_v1(jsonb)', 'public.decide_finance_subcontract_opening_v1(jsonb)', 'public.preview_finance_subcontract_round_v1(jsonb)',
    'public.save_finance_subcontract_round_v1(jsonb)', 'public.transition_finance_subcontract_round_v1(jsonb)', 'public.preview_finance_subcontract_advance_v1(jsonb)',
    'public.save_finance_subcontract_advance_v1(jsonb)', 'public.review_finance_manual_cost_v1(jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['app_private.finance_sub_cost_item()', 'app_private.finance_notify_sub(uuid[],text,text,text,uuid)', 'app_private.finance_sub_retention_due(text)',
    'app_private.finance_sub_vioo_advances(text)', 'app_private.finance_subcontract_metrics(text)', 'app_private.finance_sub_suggest(text,numeric,numeric)',
    'app_private.finance_sub_previous_net(text)', 'app_private.finance_sub_cost_reviews()', 'app_private.finance_sub_round_calc(jsonb,uuid)',
    'app_private.finance_sub_advance_target(text,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Vá hàm đang chạy
-- ---------------------------------------------------------------------------
-- Hạn công nợ: khoản giữ lại thầu phụ chưa có hạn thì để trống.
CREATE OR REPLACE FUNCTION app_private.trg_supplier_payable_due()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record;
begin
  if new.document_date is null or (new.source_type = 'subcontract_retention' and new.due_date is null) then return new; end if;
  if tg_op = 'INSERT' then
    if new.due_date is null then
      select * into r from app_private.finance_due_for(new.supplier_id, new.supplier_contract_id, new.document_date);
      new.due_date := r.due_date; new.due_date_source := r.source;
    elsif new.due_date_source is null then
      new.due_date_source := 'manual';
    end if;
  elsif coalesce(new.due_date_source, '') <> 'manual'
    and (new.document_date is distinct from old.document_date or new.supplier_id is distinct from old.supplier_id
      or new.supplier_contract_id is distinct from old.supplier_contract_id or new.due_date is null) then
    select * into r from app_private.finance_due_for(new.supplier_id, new.supplier_contract_id, new.document_date);
    new.due_date := r.due_date; new.due_date_source := r.source;
  end if;
  return new;
end $function$;
-- Đề nghị chi: không trả tiền giữ lại bảo hành trước hạn.
CREATE OR REPLACE FUNCTION app_private.finance_check_request_lines(p_supplier text, p_lines jsonb, p_exclude uuid)
 RETURNS TABLE(doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric, source_type text, source_id text, recognized numeric, paid numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a jsonb; d record; v_amount numeric; v_seen uuid[] := '{}';
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATIONS_REQUIRED'; end if;
  for a in select value from jsonb_array_elements(p_lines) loop
    v_amount := round(nullif(a->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    select r.* into d from app_private.finance_payable_rows() r where r.id = (a->>'documentId')::uuid;
    if not found or d.supplier_id is distinct from p_supplier or d.status not in ('open', 'partial') then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if d.source_type = 'subcontract_retention' and (d.due_date is null or d.due_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date) then
      raise exception using errcode = '22023', message = 'FINANCE_RETENTION_NOT_DUE'; end if;
    if d.id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
    v_seen := v_seen || d.id;
    perform 1 from public.supplier_payable_documents where id = d.id for update;
    if v_amount > d.outstanding - d.pending_external - app_private.finance_doc_reserved(d.id, p_exclude) + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_OVER_OUTSTANDING'; end if;
    doc_id := d.id; amount := v_amount; project_id := d.project_id; site_id := d.construction_site_id; document_no := d.document_no;
    outstanding := d.outstanding; source_type := d.source_type; source_id := d.source_id; recognized := d.recognized; paid := d.paid;
    return next;
  end loop;
end $function$;
-- Tạm ứng thầu phụ: đích đã kết thúc khi HĐ hoàn thành / hết hạn / hủy.
CREATE OR REPLACE FUNCTION app_private.finance_advance_rows()
 RETURNS TABLE(id uuid, code text, supplier_id text, supplier_name text, project_id text, construction_site_id text, status text, purchase_order_id text, supplier_contract_id text, amount numeric, offset_amount numeric, refunded numeric, remaining numeric, repay_due_date date, batch_id uuid, target_closed boolean, paid_date date, created_by uuid, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select r.id, r.code, r.supplier_id, r.supplier_name, r.project_id, r.construction_site_id, r.status, r.purchase_order_id, r.supplier_contract_id,
    r.amount, coalesce(o.amt, 0), coalesce(f.amt, 0),
    case when r.status = 'paid' then greatest(round(r.amount - coalesce(o.amt, 0) - coalesce(f.amt, 0), 2), 0) else 0 end,
    r.repay_due_date, nullif(r.paid->'batches'->0->>'batchId', '')::uuid,
    coalesce((select po.status in ('delivered', 'closed', 'returned', 'cancelled') or po.archived_at is not null
        from public.purchase_orders po where po.id = r.purchase_order_id),
      (select coalesce(c.status, '') in ('cancelled', 'completed') from public.supplier_contracts c where c.id = r.supplier_contract_id),
      (select coalesce(sc.status, '') in ('cancelled', 'completed', 'expired') from public.subcontractor_contracts sc where sc.id = r.subcontract_id), false),
    nullif(r.paid->>'paymentDate', '')::date, r.created_by, r.created_at
  from public.finance_payment_requests r
  left join lateral (select sum(x.amount - x.released_amount) amt from public.supplier_advance_offsets x where x.request_id = r.id and x.status = 'active') o on true
  left join lateral (select sum(a.amount) amt from public.supplier_advance_adjustments a where a.request_id = r.id and a.kind = 'refund' and a.status = 'confirmed') f on true
  where r.kind = 'advance';
$function$;
-- Cấn trừ tạm ứng: chứng từ cùng HĐ thầu phụ.
CREATE OR REPLACE FUNCTION app_private.finance_advance_apply(p_request uuid, p_doc uuid, p_amount numeric, p_mode text, p_actor uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; d record; v_doc public.supplier_payable_documents%rowtype; v_avail numeric; v_amt numeric;
begin
  perform 1 from public.finance_payment_requests where id = p_request for update;
  select * into r from app_private.finance_advance_rows() x where x.id = p_request;
  if not found or r.status <> 'paid' or r.batch_id is null then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_STATE'; end if;
  select * into v_doc from public.supplier_payable_documents where id = p_doc for update;
  select * into d from app_private.finance_payable_rows() x where x.id = p_doc;
  if not found or d.supplier_id is distinct from r.supplier_id or d.status not in ('open', 'partial') or d.internal
    or app_private.finance_scope_key(d.project_id, d.construction_site_id) <> app_private.finance_scope_key(r.project_id, r.construction_site_id)
    or not ((r.purchase_order_id is not null and app_private.finance_doc_purchase_order(v_doc.source_type, v_doc.source_id, v_doc.metadata) = r.purchase_order_id)
      or (r.supplier_contract_id is not null and v_doc.supplier_contract_id = r.supplier_contract_id)
      or (v_doc.subcontract_id is not null and v_doc.subcontract_id = (select q.subcontract_id from public.finance_payment_requests q where q.id = p_request))) then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_DOCUMENT_SCOPE'; end if;
  v_avail := greatest(d.outstanding - d.pending_external - app_private.finance_doc_reserved(p_doc, null), 0);
  if p_amount is not null and (p_amount <= 0 or p_amount > least(r.remaining, v_avail) + 0.005) then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER'; end if;
  v_amt := round(least(coalesce(p_amount, r.remaining), r.remaining, v_avail), 2);
  if v_amt <= 0 then return 0; end if;
  insert into public.supplier_payment_allocations (payment_batch_id, payable_document_id, source_type, source_id, document_no_snapshot,
    recognized_amount_snapshot, paid_before_snapshot, outstanding_before_snapshot, allocated_amount, allocation_mode, note)
  values (r.batch_id, p_doc, v_doc.source_type, v_doc.source_id, v_doc.document_no, d.recognized, d.paid, d.outstanding, v_amt, 'manual', 'Cấn trừ tạm ứng ' || r.code)
  on conflict (payment_batch_id, payable_document_id) do update
    set allocated_amount = public.supplier_payment_allocations.allocated_amount + excluded.allocated_amount,
      outstanding_before_snapshot = public.supplier_payment_allocations.outstanding_before_snapshot + excluded.allocated_amount;
  insert into public.supplier_advance_offsets (request_id, payment_batch_id, payable_document_id, amount, mode, created_by)
  values (p_request, r.batch_id, p_doc, v_amt, p_mode, p_actor);
  update public.supplier_payable_documents set status = case when round(d.outstanding - v_amt, 2) <= 0 then 'paid' else 'partial' end, updated_at = now()
  where id = p_doc;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('advance', p_request::text, r.supplier_id, 'advance_offset', p_actor,
    jsonb_build_object('code', r.code, 'documentId', p_doc, 'documentNo', v_doc.document_no, 'amount', v_amt, 'mode', p_mode));
  return v_amt;
end $function$;
-- Danh sách tạm ứng: đích là HĐ thầu phụ.
CREATE OR REPLACE FUNCTION public.list_finance_advances_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_record boolean := app_private.finance_can('record'); v_confirm boolean := app_private.finance_can('confirm');
  v_supplier text := nullif(p_filter->>'supplierId', '');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return (with a as (
      select x.*, case when x.status in ('pending', 'returned') then 'approving' when x.status = 'approved' then 'to_pay'
          when x.status = 'reversed' then 'reversed' when x.status in ('rejected', 'withdrawn', 'cancelled') then 'closed'
          when x.remaining <= 0.004 then 'settled' when x.target_closed then 'refund_due' else 'open' end state
      from app_private.finance_advance_rows() x where v_supplier is null or x.supplier_id = v_supplier)
    select jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
      'totals', (select jsonb_build_object(
        'remaining', coalesce(sum(remaining), 0), 'openCount', count(*) filter (where state in ('open', 'refund_due')),
        'overdue', coalesce(sum(remaining) filter (where state = 'open' and repay_due_date < v_today), 0),
        'overdueCount', count(*) filter (where state = 'open' and repay_due_date < v_today),
        'refundDue', coalesce(sum(remaining) filter (where state = 'refund_due'), 0), 'refundDueCount', count(*) filter (where state = 'refund_due'),
        'approving', count(*) filter (where state in ('approving', 'to_pay')), 'approvingAmount', coalesce(sum(amount) filter (where state in ('approving', 'to_pay')), 0),
        'adjustmentsWaiting', (select count(*) from public.supplier_advance_adjustments j join a on a.id = j.request_id where j.status = 'submitted'),
        'adjustmentsWaitingMe', case when v_confirm then (select count(*) from public.supplier_advance_adjustments j join a on a.id = j.request_id
          where j.status = 'submitted' and j.created_by is distinct from v_actor) else 0 end) from a),
      'advances', coalesce((select jsonb_agg(jsonb_build_object(
          'id', a.id, 'code', a.code, 'status', a.status, 'state', a.state, 'supplierId', a.supplier_id, 'supplierName', a.supplier_name,
          'projectId', a.project_id, 'projectCode', (select p.code from public.projects p where p.id = a.project_id),
          'purchaseOrderId', a.purchase_order_id, 'supplierContractId', a.supplier_contract_id,
          'target', coalesce((select jsonb_build_object('kind', 'po', 'no', po.po_number, 'status', po.status, 'expectedDate', po.expected_delivery_date,
              'base', round(coalesce(po.total_amount, 0) * (1 + coalesce(po.vat_rate, 0) / 100), 2),
              'received', (select coalesce(sum(b.accepted_gross_amount), 0) from public.purchase_order_delivery_batches b
                where b.purchase_order_id::text = po.id and b.status in ('received', 'received_short', 'received_over')))
            from public.purchase_orders po where po.id = a.purchase_order_id),
            (select jsonb_build_object('kind', 'contract', 'no', c.code, 'status', c.status, 'expectedDate', c.expiry_date, 'base', nullif(c.value, 0), 'received', null)
              from public.supplier_contracts c where c.id = a.supplier_contract_id),
            (select jsonb_build_object('kind', 'subcontract', 'no', sc.code, 'status', sc.status, 'expectedDate', sc.completion_date, 'base', r.advance_base, 'received', null)
              from public.subcontractor_contracts sc where sc.id = r.subcontract_id)),
          'amount', a.amount, 'percent', r.advance_percent, 'base', r.advance_base, 'offset', a.offset_amount, 'refunded', a.refunded, 'remaining', a.remaining,
          'repayDueDate', a.repay_due_date, 'overdue', a.state = 'open' and a.repay_due_date < v_today, 'note', r.note,
          'createdByName', app_private.finance_user_name(a.created_by), 'createdAt', a.created_at, 'rowVersion', r.row_version,
          'paid', case when r.paid is not null then jsonb_build_object('paymentDate', r.paid->>'paymentDate', 'documentRef', r.paid->>'documentRef',
            'byName', r.paid->>'byName', 'attachments', r.paid->'attachments', 'reversal', r.paid->'reversal') end,
          'currentStepLabel', case when a.status = 'pending' then r.route->r.current_step->>'label' end,
          'offsets', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'documentId', o.payable_document_id, 'documentNo', d.document_no,
              'amount', o.amount, 'released', o.released_amount, 'mode', o.mode, 'status', o.status, 'at', o.created_at,
              'byName', app_private.finance_user_name(o.created_by), 'releasedAt', o.released_at, 'releasedByName', app_private.finance_user_name(o.released_by),
              'releaseKind', o.release_kind, 'releaseReason', o.release_reason) order by o.created_at), '[]'::jsonb)
            from public.supplier_advance_offsets o join public.supplier_payable_documents d on d.id = o.payable_document_id where o.request_id = a.id),
          'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'kind', j.kind, 'amount', j.amount, 'status', j.status,
              'targetPoNumber', (select po.po_number from public.purchase_orders po where po.id = j.target_purchase_order_id),
              'sourcePoNumber', (select po.po_number from public.purchase_orders po where po.id = j.source_purchase_order_id),
              'paymentDate', j.payment_date, 'documentRef', j.document_ref, 'attachments', j.attachments, 'reason', j.reason,
              'createdBy', j.created_by, 'createdByName', app_private.finance_user_name(j.created_by), 'createdAt', j.created_at,
              'decidedByName', app_private.finance_user_name(j.decided_by), 'decidedAt', j.decided_at, 'decisionNote', j.decision_note,
              'canDecide', j.status = 'submitted' and v_confirm and j.created_by is distinct from v_actor,
              'canWithdraw', j.status = 'submitted' and j.created_by = v_actor,
              'canReverse', j.status = 'confirmed' and j.kind = 'refund' and v_confirm) order by j.created_at), '[]'::jsonb)
            from public.supplier_advance_adjustments j where j.request_id = a.id),
          -- Chứng từ cùng đích, cùng dự án còn nợ: cấn trừ tay được.
          'candidates', case when a.status = 'paid' and a.remaining > 0.004 then (select coalesce(jsonb_agg(jsonb_build_object('documentId', pr.id, 'documentNo', pr.document_no,
              'documentDate', pr.document_date, 'available', greatest(pr.outstanding - pr.pending_external - app_private.finance_doc_reserved(pr.id, null), 0)) order by pr.document_date), '[]'::jsonb)
            from app_private.finance_payable_rows() pr join public.supplier_payable_documents sd on sd.id = pr.id
            where pr.supplier_id = a.supplier_id and pr.status in ('open', 'partial') and pr.outstanding > 0.004
              and app_private.finance_scope_key(pr.project_id, pr.construction_site_id) = app_private.finance_scope_key(a.project_id, a.construction_site_id)
              and ((a.purchase_order_id is not null and app_private.finance_doc_purchase_order(sd.source_type, sd.source_id, sd.metadata) = a.purchase_order_id)
                or (a.supplier_contract_id is not null and sd.supplier_contract_id = a.supplier_contract_id))) else '[]'::jsonb end,
          'transferTargets', case when a.status = 'paid' and a.remaining > 0.004 and a.purchase_order_id is not null then (select coalesce(jsonb_agg(jsonb_build_object(
              'id', po.id, 'poNumber', po.po_number, 'expectedDate', po.expected_delivery_date,
              'base', round(coalesce(po.total_amount, 0) * (1 + coalesce(po.vat_rate, 0) / 100), 2)) order by po.po_number), '[]'::jsonb)
            from public.purchase_orders po where po.vendor_id = a.supplier_id and po.id <> a.purchase_order_id and po.supplier_contract_id is null
              and po.status in ('sent', 'confirmed', 'in_transit', 'partial') and po.archived_at is null
              and app_private.finance_scope_key(po.project_id, po.construction_site_id) = app_private.finance_scope_key(a.project_id, a.construction_site_id)) else '[]'::jsonb end,
          'canAct', v_record and a.status = 'paid' and a.remaining > 0.004,
          'canRelease', v_record)
          order by case a.state when 'refund_due' then 0 when 'open' then 1 when 'approving' then 2 when 'to_pay' then 2 when 'settled' then 3 else 4 end,
            a.repay_due_date, a.created_at desc)
        from a join public.finance_payment_requests r on r.id = a.id), '[]'::jsonb)));
end $function$;
-- Danh sách đề nghị chi: tạm ứng gắn HĐ thầu phụ.
CREATE OR REPLACE FUNCTION public.list_finance_payment_requests_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_stage text := coalesce(nullif(p_filter->>'stage', ''), 'request');
  v_confirm boolean := app_private.finance_can('confirm'); v_record boolean := app_private.finance_can('record');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
      'request', count(*) filter (where status in ('pending', 'returned')),
      'approved', count(*) filter (where status = 'approved'),
      'approvedAmount', coalesce(sum(amount) filter (where status = 'approved'), 0),
      'paid', count(*) filter (where status in ('paid', 'reversed')),
      'waitingMe', count(*) filter (where status = 'pending' and v_actor is distinct from created_by
        and v_actor::text in (select jsonb_array_elements_text(route->current_step->'eligibleIds'))
        and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
          and s.action = 'approve' and s.actor_id = v_actor)))
      from public.finance_payment_requests r),
    'requests', coalesce((select jsonb_agg(x order by (x->>'createdAt') desc) from (
      select jsonb_build_object('id', r.id, 'code', r.code, 'supplierId', r.supplier_id, 'supplierName', r.supplier_name, 'method', r.method,
        'bank', r.bank_snapshot, 'plannedDate', r.planned_date, 'amount', r.amount, 'note', r.note, 'status', r.status, 'route', r.route,
        'currentStep', r.current_step, 'thresholdAmount', r.threshold_amount, 'priorRequests', r.prior_requests, 'paid', r.paid,
        'createdBy', r.created_by, 'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'rowVersion', r.row_version,
        'submissionNo', r.submission_no, 'kind', r.kind,
        'expense', case when r.kind = 'expense' then jsonb_build_object('category', r.expense_category, 'costCategory', r.cost_category, 'projectId', r.project_id,
          'projectCode', (select p.code from public.projects p where p.id = r.project_id)) end,
        'cashEntry', (select jsonb_build_object('accountName', f.name, 'date', e.entry_date) from public.finance_cash_entries e join public.cash_funds f on f.id = e.account_id
          where e.source_type = 'payment_request' and e.source_id = r.id::text and e.reversal_of is null order by e.created_at limit 1),
        'advance', case when r.kind = 'advance' then jsonb_build_object('purchaseOrderId', r.purchase_order_id,
          'poNumber', (select po.po_number from public.purchase_orders po where po.id = r.purchase_order_id),
          'contractId', coalesce(r.supplier_contract_id, r.subcontract_id), 'subcontractId', r.subcontract_id,
          'contractCode', coalesce((select c.code from public.supplier_contracts c where c.id = r.supplier_contract_id),
            (select sc.code from public.subcontractor_contracts sc where sc.id = r.subcontract_id)),
          'projectId', r.project_id, 'projectCode', (select p.code from public.projects p where p.id = r.project_id),
          'base', r.advance_base, 'percent', r.advance_percent, 'repayDueDate', r.repay_due_date,
          'offset', (select coalesce(sum(o.amount - o.released_amount), 0) from public.supplier_advance_offsets o where o.request_id = r.id and o.status = 'active')) end,
        'lines', (select coalesce(jsonb_agg(jsonb_build_object('documentId', l.payable_document_id, 'documentNo', l.document_no, 'code', d.code,
            'sourceType', d.source_type, 'projectId', l.project_id, 'projectCode', (select code from public.projects p where p.id = l.project_id),
            'amount', l.amount, 'outstandingSnapshot', l.outstanding_snapshot, 'dueDate', d.due_date) order by d.due_date nulls last), '[]'::jsonb)
          from public.finance_payment_request_lines l join public.supplier_payable_documents d on d.id = l.payable_document_id where l.request_id = r.id),
        'steps', (select coalesce(jsonb_agg(jsonb_build_object('submissionNo', s.submission_no, 'stepNo', s.step_no, 'label', s.label, 'action', s.action,
            'actorName', app_private.finance_user_name(s.actor_id), 'reason', s.reason, 'at', s.created_at) order by s.created_at), '[]'::jsonb)
          from public.finance_payment_request_steps s where s.request_id = r.id),
        'approvedBy', (select coalesce(jsonb_agg(s.actor_id), '[]'::jsonb) from public.finance_payment_request_steps s
          where s.request_id = r.id and s.submission_no = r.submission_no and s.action = 'approve'),
        'canApprove', r.status = 'pending' and v_actor is distinct from r.created_by
          and v_actor::text in (select jsonb_array_elements_text(r.route->r.current_step->'eligibleIds'))
          and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
            and s.action = 'approve' and s.actor_id = v_actor),
        'canWithdraw', r.status in ('pending', 'returned') and r.created_by = v_actor,
        'canResubmit', r.status = 'returned' and r.created_by = v_actor and v_record,
        'canCancel', r.status = 'approved' and (r.created_by = v_actor or v_confirm),
        'canConfirm', r.status = 'approved' and v_confirm and v_actor is distinct from r.created_by
          and not exists (select 1 from public.finance_payment_request_steps s where s.request_id = r.id and s.submission_no = r.submission_no
            and s.action = 'approve' and s.actor_id = v_actor)
          and not (v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = r.id)),
        'canReverse', r.status = 'paid' and v_confirm) x
      from public.finance_payment_requests r
      where (v_stage = 'request' and r.status in ('pending', 'returned'))
         or (v_stage = 'approved' and r.status = 'approved')
         or (v_stage = 'paid' and r.status in ('paid', 'reversed'))
         or (v_stage = 'closed' and r.status in ('rejected', 'withdrawn', 'cancelled'))
         or (v_stage = 'all')
    ) q), '[]'::jsonb));
end $function$;
-- Chi tiết NCC / thầu phụ: nguồn gốc chứng từ thầu phụ.
CREATE OR REPLACE FUNCTION public.get_finance_supplier_v1(p_supplier_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id();
  v_bp public.business_partners%rowtype; v_set public.finance_settings%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_bp from public.business_partners where id = p_supplier_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  select * into v_set from public.finance_settings where id = 1;
  return jsonb_build_object(
    'today', v_today, 'cutoverDate', v_set.ap_cutover_date, 'defaultPaymentDays', v_set.default_payment_days,
    'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'supplier', jsonb_build_object('id', v_bp.id, 'name', v_bp.name, 'code', v_bp.code, 'taxCode', v_bp.tax_code,
      'bankName', v_bp.bank_name, 'bankAccount', v_bp.bank_account,
      'internal', exists (select 1 from public.finance_internal_partners ip where ip.supplier_id = v_bp.id),
      'internalReason', (select ip.reason from public.finance_internal_partners ip where ip.supplier_id = v_bp.id),
      'terms', (select jsonb_build_object('paymentDays', t.payment_days, 'note', t.note, 'updatedAt', t.updated_at,
        'updatedByName', app_private.finance_user_name(t.updated_by)) from public.supplier_payment_terms t where t.supplier_id = v_bp.id)),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'status', c.status,
        'paymentTermDays', c.payment_term_days, 'paymentTermsText', c.payment_terms, 'requireInvoice', c.require_invoice_before_payment) order by c.code)
      from public.supplier_contracts c where c.supplier_id = v_bp.id), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'code', r.code, 'documentNo', r.document_no, 'sourceType', r.source_type, 'origin', r.origin,
        'projectId', r.project_id, 'projectCode', r.project_code, 'projectName', r.project_name,
        'contractId', r.contract_id, 'contractCode', r.contract_code,
        'documentDate', r.document_date, 'dueDate', r.due_date, 'dueSource', r.due_date_source,
        'recognized', r.recognized, 'credit', r.credit, 'paid', r.paid, 'outstanding', r.outstanding,
        'pendingExternal', r.pending_external, 'status', r.status, 'issues', to_jsonb(r.issues), 'createdAt', r.created_at,
        'provenance', case r.source_type
          when 'purchase_delivery_receipt' then (select jsonb_build_object('poNumber', po.po_number, 'poId', po.id, 'deliveryNo', b.delivery_no,
              'warehouse', (select w.name from public.transactions t join public.warehouses w on w.id = t.target_warehouse_id where t.id = b.wms_transaction_id),
              'receivedAt', b.received_at, 'receivedByName', app_private.finance_user_name(b.received_by))
            from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id where b.id::text = r.source_id)
          when 'supplier_delivery_statement' then (select jsonb_build_object('statementCode', st.code, 'periodMonth', st.period_month,
              'notes', (select count(distinct l.delivery_note_id) from public.supplier_direct_delivery_lines l where l.statement_id = st.id),
              'createdByName', app_private.finance_user_name(st.created_by), 'confirmedByName', st.metadata->>'confirmedByName',
              'postedByName', app_private.finance_user_name(st.posted_by), 'postedAt', st.posted_at)
            from public.supplier_delivery_statements st where st.id::text = r.source_id)
          when 'opening_balance' then (select jsonb_build_object('reconciliationId', o.id, 'misaAmount', o.misa_amount,
              'createdByName', app_private.finance_user_name(o.created_by), 'confirmedByName', app_private.finance_user_name(o.decided_by), 'confirmedAt', o.decided_at)
            from public.finance_opening_reconciliations o where o.id::text = r.source_id)
          when 'direct_supplier_receipt' then (select jsonb_build_object('transactionId', t.id, 'warehouse', w.name, 'note', t.note,
              'receivedByName', app_private.finance_user_name(coalesce(t.created_by, t.requester_id)), 'approvedByName', app_private.finance_user_name(t.approver_id),
              'postedByName', app_private.finance_user_name(nullif(d.metadata->>'postedById', '')::uuid), 'postedAt', d.metadata->>'postedAt',
              'netAmount', d.metadata->'netAmount', 'vatRate', d.metadata->'vatRate', 'vatAmount', d.metadata->'vatAmount',
              'priceIncludesVat', d.metadata->'priceIncludesVat', 'duplicateOf', d.metadata->>'duplicateOf')
            from public.supplier_payable_documents d join public.transactions t on t.id = d.source_id
            left join public.warehouses w on w.id = t.target_warehouse_id where d.id = r.id)
          when 'subcontract_round' then (select jsonb_build_object('subcontractId', d.subcontract_id, 'subcontractCode', d.metadata->>'subcontractCode', 'roundNo', d.metadata->'roundNo')
            from public.supplier_payable_documents d where d.id = r.id)
          when 'subcontract_retention' then (select jsonb_build_object('subcontractId', d.subcontract_id, 'subcontractCode', d.metadata->>'subcontractCode', 'roundNo', d.metadata->'roundNo')
            from public.supplier_payable_documents d where d.id = r.id)
          when 'subcontract_opening' then (select jsonb_build_object('subcontractId', d.subcontract_id, 'subcontractCode', d.metadata->>'subcontractCode', 'roundNo', d.metadata->'roundNo')
            from public.supplier_payable_documents d where d.id = r.id)
          else null end,
        'pendingAdjustment', (select jsonb_build_object('id', j.id, 'kind', j.kind, 'reason', j.reason, 'createdBy', j.created_by,
            'createdByName', app_private.finance_user_name(j.created_by), 'createdAt', j.created_at)
          from public.finance_payable_adjustments j where j.payable_document_id = r.id and j.status = 'submitted'))
        order by r.project_code, r.contract_code nulls last, r.document_date, r.document_no)
      from app_private.finance_payable_rows() r where r.supplier_id = v_bp.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', pb.id, 'code', pb.code, 'status', pb.status, 'rowVersion', pb.row_version,
        'external', coalesce((pb.metadata->>'external')::boolean, false), 'projectId', pb.project_id,
        'projectCode', (select code from public.projects where id = pb.project_id), 'paymentDate', pb.payment_date, 'amount', pb.payment_amount,
        'method', pb.payment_method, 'documentRef', pb.document_ref, 'note', pb.note, 'attachments', pb.attachments,
        'createdBy', pb.created_by, 'createdByName', app_private.finance_user_name(pb.created_by), 'createdAt', pb.created_at,
        'paidByName', app_private.finance_user_name(pb.paid_by), 'paidAt', pb.paid_at, 'rejection', pb.metadata->'rejection',
        'reversal', pb.metadata->>'g7ReversalReason', 'kind', coalesce(pb.metadata->>'kind', ''), 'requestCode', pb.metadata->>'requestCode',
        'allocations', (select jsonb_agg(jsonb_build_object('documentId', a.payable_document_id, 'documentNo', a.document_no_snapshot, 'amount', a.allocated_amount))
          from public.supplier_payment_allocations a where a.payment_batch_id = pb.id)) order by pb.payment_date desc, pb.created_at desc)
      from public.supplier_payment_batches pb where pb.supplier_id = v_bp.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'projectId', o.project_id,
        'projectCode', (select code from public.projects where id = o.project_id), 'status', o.status, 'revision', o.revision,
        'cutoverDate', o.cutover_date, 'misaAmount', o.misa_amount, 'viooOutstanding', o.vioo_outstanding, 'openingAmount', o.opening_amount,
        'note', o.note, 'attachments', o.attachments, 'reviewedDocumentIds', to_jsonb(o.reviewed_document_ids),
        'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by), 'createdAt', o.created_at,
        'submittedByName', app_private.finance_user_name(o.submitted_by), 'submittedAt', o.submitted_at,
        'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'openingDocumentId', o.opening_document_id) order by o.created_at desc)
      from public.finance_opening_reconciliations o where o.supplier_id = v_bp.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'entityType', e.entity_type, 'actorName', app_private.finance_user_name(e.actor_id),
        'reason', e.reason, 'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where supplier_id = v_bp.id order by created_at desc limit 100) e), '[]'::jsonb));
end;
$function$;
