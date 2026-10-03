-- ===========================================================================
-- Tài chính đợt 2 — Phải thu chủ đầu tư (03/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 16; mockup .superpowers/review/adv/rc-v1.html
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 8 câu 03/10):
-- * Đợt thu nhập theo số tổng của hồ sơ gửi CĐT (gắn biên bản nghiệm thu nếu có) — không bắt buộc BOQ.
-- * Lập → gửi CĐT → CĐT xác nhận số tiền (lúc này thành PHẢI THU, hạn = ngày xác nhận + số ngày theo HĐ, mặc định 30) → hóa đơn → thu tiền.
--   CĐT trả lại / duyệt thấp hơn: ghi số CĐT duyệt + lý do; chênh lệch không thành phải thu.
-- * Phải thu đợt = giá trị đợt gồm VAT − thu hồi tạm ứng − giữ lại bảo hành. Gợi ý theo HĐ: % thu hồi (mặc định = tạm ứng đã nhận ÷ HĐ),
--   % giữ lại (mặc định 5%), số ngày thanh toán, tháng bảo hành; kế toán sửa từng đợt phải ghi lý do.
-- * Kế toán (Tài chính — Ghi nhận) lập đợt và ghi phiếu thu; người khác có quyền Xác nhận xác nhận phiếu thu thì mới ghi dòng tiền vào
--   (project_transactions revenue_received, source_ref finance_customer_receipt:…). Đảo phiếu thu không xóa. Thu thừa = CĐT trả trước, trừ vào đợt sau.
-- * Đối chiếu đầu kỳ với MISA đến 30/09: phải thu còn lại, tạm ứng chưa thu hồi, giữ lại — người lập ≠ người chốt.
-- * Bảo lãnh (tạm ứng, thực hiện, bảo hành): khai số tiền, ngân hàng, hạn; nhắc trước 30 ngày.
-- * Dự án → Hợp đồng: lịch thanh toán và chứng từ thanh toán của HĐ CĐT chỉ xem (máy chủ chặn ghi ngoài hàm Tài chính).
--   Đợt thu đồng bộ sang payment_schedules để các màn đang đọc lịch thanh toán vẫn đúng.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.customer_contracts
  add column advance_recovery_percent numeric(7,3) check (advance_recovery_percent between 0 and 100),
  add column retention_percent numeric(5,2) check (retention_percent between 0 and 100),
  add column payment_term_days integer check (payment_term_days between 0 and 365);

create table public.finance_receivable_rounds (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null references public.customer_contracts(id),
  project_id text,
  construction_site_id text,
  sequence_no integer not null,
  kind text not null check (kind in ('advance', 'progress', 'settlement', 'retention', 'other', 'opening')),
  description text not null check (length(btrim(description)) > 0),
  net_amount numeric(18,2) not null default 0,
  vat_percent numeric(5,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  gross_amount numeric(18,2) not null check (gross_amount >= 0),
  advance_recovery numeric(18,2) not null default 0 check (advance_recovery >= 0),
  retention numeric(18,2) not null default 0 check (retention >= 0),
  receivable numeric(18,2) generated always as (gross_amount - advance_recovery - retention) stored,
  suggested_recovery numeric(18,2),
  suggested_retention numeric(18,2),
  adjust_reason text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'confirmed', 'cancelled')),
  sent_date date,
  confirmed_date date,
  confirmed_by uuid references public.users(id),
  submitted_gross numeric(18,2),
  customer_note text,
  due_date date,
  invoice_no text,
  invoice_date date,
  acceptance_id uuid,
  attachments jsonb not null default '[]'::jsonb,
  note text,
  legacy_schedule_id text unique,
  legacy_received numeric(18,2) not null default 0,
  legacy_received_date date,
  cancel_reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  unique (contract_id, sequence_no),
  check (gross_amount >= advance_recovery + retention)
);
create index finance_receivable_rounds_contract_idx on public.finance_receivable_rounds (contract_id, status);

create sequence public.finance_customer_receipt_seq;
create table public.finance_customer_receipts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  contract_id text not null references public.customer_contracts(id),
  project_id text,
  construction_site_id text,
  customer_name text not null,
  receipt_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  document_ref text not null check (length(btrim(document_ref)) > 0),
  attachments jsonb not null default '[]'::jsonb,
  note text,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reverse_reason text,
  row_version bigint not null default 1
);
create index finance_customer_receipts_contract_idx on public.finance_customer_receipts (contract_id, status);

create table public.finance_customer_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.finance_customer_receipts(id),
  round_id uuid not null references public.finance_receivable_rounds(id),
  amount numeric(18,2) not null check (amount > 0),
  kind text not null default 'receipt' check (kind in ('receipt', 'prepayment')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index finance_customer_receipt_allocations_round_idx on public.finance_customer_receipt_allocations (round_id);
create index finance_customer_receipt_allocations_receipt_idx on public.finance_customer_receipt_allocations (receipt_id);

create table public.finance_customer_openings (
  id uuid primary key default gen_random_uuid(),
  contract_id text not null references public.customer_contracts(id),
  cutover_date date not null,
  receivable_amount numeric(18,2) not null check (receivable_amount >= 0),
  receivable_due_date date,
  advance_remaining numeric(18,2) not null check (advance_remaining >= 0),
  retention_held numeric(18,2) not null check (retention_held >= 0),
  note text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'cancelled')),
  opening_round_id uuid references public.finance_receivable_rounds(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_customer_openings_one_active on public.finance_customer_openings (contract_id) where status in ('submitted', 'confirmed');

do $$ declare t text; begin
  foreach t in array array['finance_receivable_rounds', 'finance_customer_receipts', 'finance_customer_receipt_allocations', 'finance_customer_openings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.finance_customer_receipt_seq from public, anon, authenticated;

-- Đợt thu cũ (lịch thanh toán HĐ CĐT, đều ghi khi đã thu) → đợt thu đã xác nhận, đã thu đủ. Không tách được thu hồi tạm ứng / giữ lại.
insert into public.finance_receivable_rounds (contract_id, project_id, construction_site_id, sequence_no, kind, description, net_amount, vat_percent, vat_amount,
  gross_amount, status, sent_date, confirmed_date, due_date, legacy_schedule_id, legacy_received, legacy_received_date, note, created_at)
select c.id, coalesce(ps.project_id, c.project_id), coalesce(ps.construction_site_id, c.construction_site_id), ps.sequence_no,
  case when ps.milestone_type in ('advance', 'progress', 'settlement', 'retention') then ps.milestone_type else 'other' end, ps.description,
  round(ps.amount / (1 + coalesce(c.vat_percent, 0) / 100), 2), coalesce(c.vat_percent, 0), ps.amount - round(ps.amount / (1 + coalesce(c.vat_percent, 0) / 100), 2),
  ps.amount, 'confirmed', left(ps.due_date, 10)::date, left(ps.due_date, 10)::date, left(ps.due_date, 10)::date, ps.id, coalesce(ps.paid_amount, 0),
  case when ps.paid_date ~ '^\d{4}-\d{2}-\d{2}' then left(ps.paid_date, 10)::date end,
  'Chuyển từ lịch thanh toán (ghi khi đã thu, chưa tách thu hồi tạm ứng / giữ lại)', ps.created_at
from public.payment_schedules ps join public.customer_contracts c on c.id = ps.contract_id::text
where ps.type = 'receivable' and coalesce(ps.contract_type, 'customer') = 'customer' and ps.due_date ~ '^\d{4}-\d{2}-\d{2}';

-- ---------------------------------------------------------------------------
-- 2. Số liệu: từng đợt (đã thu, còn phải thu), từng HĐ
-- ---------------------------------------------------------------------------
create function app_private.finance_receivable_round_rows()
returns table (id uuid, contract_id text, project_id text, kind text, status text, sequence_no integer, gross numeric, advance_recovery numeric,
  retention numeric, receivable numeric, received numeric, pending numeric, outstanding numeric, due_date date, confirmed_date date,
  legacy boolean, last_received date)
language sql stable security definer set search_path = '' as $$
  select r.id, r.contract_id, r.project_id, r.kind, r.status, r.sequence_no, r.gross_amount, r.advance_recovery, r.retention, r.receivable,
    r.legacy_received + coalesce(a.confirmed, 0), coalesce(a.pending, 0),
    case when r.status = 'confirmed' then greatest(r.receivable - r.legacy_received - coalesce(a.confirmed, 0), 0) else 0 end,
    r.due_date, r.confirmed_date, r.legacy_schedule_id is not null, greatest(r.legacy_received_date, a.last_date)
  from public.finance_receivable_rounds r
  left join lateral (select sum(x.amount) filter (where rc.status = 'confirmed') confirmed, sum(x.amount) filter (where rc.status = 'submitted') pending,
      max(rc.receipt_date) filter (where rc.status = 'confirmed') last_date
    from public.finance_customer_receipt_allocations x join public.finance_customer_receipts rc on rc.id = x.receipt_id where x.round_id = r.id) a on true;
$$;

create function app_private.finance_customer_contract_metrics(p_contract text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.customer_contracts%rowtype; o public.finance_customer_openings%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_gross numeric; v_progress numeric; v_adv_received numeric; v_recovered numeric; v_adv_remaining numeric; v_ret_held numeric; v_billed numeric;
  v_out numeric; v_overdue numeric; v_received numeric; v_prepay numeric; v_pct numeric; v_cut date;
begin
  select * into c from public.customer_contracts where id = p_contract;
  if not found then return null; end if;
  select * into o from public.finance_customer_openings where contract_id = p_contract and status = 'confirmed';
  v_cut := o.cutover_date;
  v_gross := round(coalesce(c.value, 0) * (1 + coalesce(c.vat_percent, 0) / 100), 2);
  v_progress := case when c.project_id is not null then app_private.finance_project_gantt_progress(c.project_id) end;
  select coalesce(sum(received) filter (where kind = 'advance' and (v_cut is null or confirmed_date >= v_cut)), 0),
    coalesce(sum(advance_recovery) filter (where status = 'confirmed' and (v_cut is null or confirmed_date >= v_cut)), 0),
    coalesce(sum(gross) filter (where status in ('sent', 'confirmed') and kind in ('progress', 'settlement', 'other')), 0),
    coalesce(sum(outstanding), 0), coalesce(sum(outstanding) filter (where due_date < v_today), 0), coalesce(sum(received), 0)
    into v_adv_received, v_recovered, v_billed, v_out, v_overdue, v_received
  from app_private.finance_receivable_round_rows() where contract_id = p_contract;
  v_adv_remaining := greatest(coalesce(o.advance_remaining, 0) + v_adv_received - v_recovered, 0);
  select greatest(coalesce(o.retention_held, 0)
      + coalesce(sum(r.retention) filter (where r.status = 'confirmed' and (v_cut is null or r.confirmed_date >= v_cut)), 0)
      - coalesce(sum(r.gross_amount) filter (where r.status = 'confirmed' and r.kind = 'retention'), 0), 0)
    into v_ret_held from public.finance_receivable_rounds r where r.contract_id = p_contract;
  select coalesce(sum(rc.amount - coalesce((select sum(x.amount) from public.finance_customer_receipt_allocations x where x.receipt_id = rc.id), 0)), 0)
    into v_prepay from public.finance_customer_receipts rc where rc.contract_id = p_contract and rc.status = 'confirmed';
  -- % thu hồi gợi ý: khai trên HĐ, không có thì = tạm ứng đã nhận (tổng) ÷ giá trị HĐ.
  v_pct := coalesce(c.advance_recovery_percent, case when v_gross > 0 then round((select coalesce(sum(received), 0) from app_private.finance_receivable_round_rows()
    where contract_id = p_contract and kind = 'advance') * 100 / v_gross, 3) end, 0);
  return jsonb_build_object('gross', v_gross, 'progress', v_progress, 'estOutput', case when v_progress is not null then round(v_gross * v_progress / 100, 2) end,
    'billed', v_billed, 'received', v_received, 'outstanding', v_out, 'overdue', v_overdue, 'prepayment', v_prepay,
    'advanceReceived', (select coalesce(sum(received), 0) from app_private.finance_receivable_round_rows() where contract_id = p_contract and kind = 'advance'),
    'advanceRemaining', v_adv_remaining, 'advanceRecovered', v_recovered, 'retentionHeld', v_ret_held,
    'unbilled', case when v_progress is not null then greatest(round(v_gross * v_progress / 100, 2) - v_billed, 0) end,
    'recoveryPercent', v_pct, 'recoveryPercentSource', case when c.advance_recovery_percent is not null then 'contract' else 'auto' end,
    'retentionPercent', coalesce(c.retention_percent, 5), 'retentionPercentSource', case when c.retention_percent is not null then 'contract' else 'default' end,
    'paymentTermDays', coalesce(c.payment_term_days, 30), 'paymentTermSource', case when c.payment_term_days is not null then 'contract' else 'default' end,
    'warrantyMonths', nullif(c.warranty_months, 0), 'opening', case when o.id is not null then 'confirmed'
      when exists (select 1 from public.finance_customer_openings x where x.contract_id = p_contract and x.status = 'submitted') then 'submitted'
      when exists (select 1 from public.finance_receivable_rounds x where x.contract_id = p_contract and x.legacy_schedule_id is not null) then 'todo' else 'not_needed' end);
end $$;

-- Gợi ý thu hồi tạm ứng / giữ lại cho một đợt (trừ chính đợt đó khi tính tạm ứng còn lại).
create function app_private.finance_round_suggest(p_contract text, p_kind text, p_gross numeric, p_exclude uuid)
returns table (recovery numeric, retention numeric) language plpgsql stable security definer set search_path = '' as $$
declare m jsonb := app_private.finance_customer_contract_metrics(p_contract); v_remaining numeric;
begin
  if p_kind not in ('progress', 'settlement', 'other') then recovery := 0; retention := 0; return next; return; end if;
  v_remaining := coalesce((m->>'advanceRemaining')::numeric, 0)
    + coalesce((select r.advance_recovery from public.finance_receivable_rounds r where r.id = p_exclude and r.status = 'confirmed'), 0);
  recovery := least(round(p_gross * coalesce((m->>'recoveryPercent')::numeric, 0) / 100, 2), v_remaining);
  retention := round(p_gross * coalesce((m->>'retentionPercent')::numeric, 5) / 100, 2);
  return next;
end $$;

-- Đồng bộ đợt thu sang lịch thanh toán (màn Dự án, Tổng quan đang đọc payment_schedules). Đợt cũ chuyển sang thì giữ nguyên dòng cũ.
create function app_private.finance_round_sync_schedule(p_round uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.finance_receivable_rounds%rowtype; x record; v_id text;
begin
  select * into r from public.finance_receivable_rounds where id = p_round;
  if not found or r.legacy_schedule_id is not null then return; end if;
  v_id := 'fr-' || r.id::text;
  if r.status = 'cancelled' then delete from public.payment_schedules where id = v_id; return; end if;
  select * into x from app_private.finance_receivable_round_rows() q where q.id = p_round;
  insert into public.payment_schedules (id, construction_site_id, project_id, description, amount, due_date, paid_date, paid_amount, status, type, contract_id,
    contract_type, sequence_no, milestone_type, dossier_status, quality_status, contact_name, note)
  select v_id, r.construction_site_id, r.project_id, r.description, r.receivable,
    coalesce(r.due_date, r.sent_date, r.created_at::date)::text, x.last_received::text, x.received,
    case when r.status = 'confirmed' and x.received >= r.receivable - 0.5 then 'paid'
      when r.status = 'confirmed' and r.due_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date then 'overdue' else 'pending' end,
    'receivable', case when r.contract_id ~ '^[0-9a-f-]{36}$' then r.contract_id::uuid end, 'customer', r.sequence_no,
    case when r.kind = 'opening' then 'other' else r.kind end,
    case r.status when 'draft' then 'preparing' when 'sent' then 'submitted' else 'approved' end,
    case when r.kind = 'advance' then 'not_applicable' else 'not_confirmed' end,
    (select c.customer_name from public.customer_contracts c where c.id = r.contract_id), 'Quản lý ở Tài chính → Phải thu'
  on conflict (id) do update set description = excluded.description, amount = excluded.amount, due_date = excluded.due_date, paid_date = excluded.paid_date,
    paid_amount = excluded.paid_amount, status = excluded.status, sequence_no = excluded.sequence_no, milestone_type = excluded.milestone_type,
    dossier_status = excluded.dossier_status;
end $$;

-- Chặn ghi lịch thanh toán / chứng từ thanh toán HĐ CĐT ngoài hàm Tài chính (Dự án chỉ xem).
create function app_private.guard_customer_receivable_direct_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path', true), ''); j jsonb;
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') or v_path = '' or v_path like '/rpc/%' then
    return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then j := to_jsonb(old); else j := to_jsonb(new); end if;
  if (tg_table_name = 'payment_schedules' and j->>'type' = 'receivable' and coalesce(j->>'contract_type', 'customer') = 'customer')
    or (tg_table_name = 'payment_certificates' and j->>'contract_type' = 'customer') then
    raise exception using errcode = '42501', message = 'CUSTOMER_RECEIVABLE_FINANCE_ONLY';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_guard_customer_receivable_schedule before insert or update or delete on public.payment_schedules
  for each row execute function app_private.guard_customer_receivable_direct_write();
create trigger trg_guard_customer_receivable_certificate before insert or update or delete on public.payment_certificates
  for each row execute function app_private.guard_customer_receivable_direct_write();

create function app_private.finance_notify_receivable(p_users uuid[], p_title text, p_message text, p_contract text, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select u::text, 'info', 'finance', p_title, p_message, p_message, 'info', '🏦', '/#/finance?section=receivables&contract=' || p_contract,
    'finance_receivable', 'finance_receivable:' || p_contract || ':' || gen_random_uuid(), 'high', true, '{}'::jsonb, 'responsible'
  from (select distinct unnest(p_users) u) q where u is not null and u is distinct from p_actor;
$$;

create function app_private.finance_confirm_users()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u.id), '{}') from public.users u where coalesce(u.is_active, true)
    and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.confirm'));
$$;

-- ---------------------------------------------------------------------------
-- 3. Đọc
-- ---------------------------------------------------------------------------
create function public.get_finance_receivables_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); v_confirm boolean := app_private.finance_can('confirm');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return (with cs as (
      select c.*, p.code project_code, app_private.finance_customer_contract_metrics(c.id) m
      from public.customer_contracts c left join public.projects p on p.id = c.project_id
      where coalesce(c.status, '') not in ('cancelled', 'draft') or exists (select 1 from public.finance_receivable_rounds r where r.contract_id = c.id)),
    rr as (select * from app_private.finance_receivable_round_rows() where contract_id in (select id from cs))
    select jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
      'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
      'totals', jsonb_build_object(
        'outstanding', coalesce((select sum((m->>'outstanding')::numeric) from cs), 0),
        'overdue', coalesce((select sum((m->>'overdue')::numeric) from cs), 0),
        'overdueCount', (select count(*) from rr where outstanding > 0.5 and due_date < v_today),
        'unbilled', (select sum((m->>'unbilled')::numeric) from cs where m->>'unbilled' is not null),
        'advanceRemaining', coalesce((select sum((m->>'advanceRemaining')::numeric) from cs), 0),
        'retentionHeld', coalesce((select sum((m->>'retentionHeld')::numeric) from cs), 0),
        'prepayment', coalesce((select sum((m->>'prepayment')::numeric) from cs), 0),
        'sentStale', (select count(*) from public.finance_receivable_rounds r where r.status = 'sent' and r.sent_date < v_today - 15),
        'receiptsPending', (select count(*) from public.finance_customer_receipts where status = 'submitted'),
        'receiptsPendingMe', case when v_confirm then (select count(*) from public.finance_customer_receipts where status = 'submitted' and created_by is distinct from v_actor) else 0 end,
        'openingsTodo', (select count(*) from cs where m->>'opening' = 'todo'),
        'openingsPending', (select count(*) from public.finance_customer_openings where status = 'submitted'),
        'guaranteesExpiring', (select count(*) from public.contract_guarantees g join cs on cs.id = g.contract_id
          where g.status = 'active' and g.expiry_date is not null and g.expiry_date <= v_today + 30),
        'guaranteesMissing', (select count(*) from public.contract_guarantees g join cs on cs.id = g.contract_id where g.status = 'draft' and coalesce(g.amount, 0) = 0)),
      'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', cs.id, 'code', cs.code, 'name', cs.name, 'projectId', cs.project_id, 'projectCode', cs.project_code,
          'customerName', cs.customer_name, 'value', cs.value, 'vatPercent', cs.vat_percent, 'endDate', cs.end_date, 'status', cs.status,
          'nextDue', (select min(due_date) from rr where rr.contract_id = cs.id and outstanding > 0.5),
          'draftRounds', (select count(*) from public.finance_receivable_rounds r where r.contract_id = cs.id and r.status in ('draft', 'sent')),
          'metrics', cs.m) order by (cs.m->>'outstanding')::numeric desc, cs.project_code nulls last)
        from cs), '[]'::jsonb),
      -- Khoản thu ghi tay / không gắn đợt thu: kế toán soát xét (VD giảm trừ ghi nhầm thành thu).
      'reviewRevenues', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'projectCode', p.code, 'date', t.date, 'amount', t.amount,
          'description', t.description, 'source', t.source) order by t.date desc)
        from public.project_transactions t join public.projects p on p.id = t.project_id
        where t.type = 'revenue_received' and coalesce(t.source, '') <> 'workflow'
          and exists (select 1 from public.customer_contracts c where c.project_id = t.project_id)), '[]'::jsonb)));
end $$;

create function public.get_finance_customer_contract_v1(p_contract_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype;
  v_record boolean := app_private.finance_can('record'); v_confirm boolean := app_private.finance_can('confirm');
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into c from public.customer_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'contract', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'customerName', c.customer_name, 'customerTaxCode', c.customer_tax_code,
      'projectId', c.project_id, 'projectCode', (select code from public.projects where id = c.project_id), 'value', c.value, 'vatPercent', coalesce(c.vat_percent, 0),
      'signedDate', c.signed_date, 'endDate', c.end_date, 'status', c.status, 'warrantyMonths', c.warranty_months,
      'advanceRecoveryPercent', c.advance_recovery_percent, 'retentionPercent', c.retention_percent, 'paymentTermDays', c.payment_term_days),
    'metrics', app_private.finance_customer_contract_metrics(c.id),
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sequenceNo', r.sequence_no, 'kind', r.kind, 'description', r.description,
        'netAmount', r.net_amount, 'vatPercent', r.vat_percent, 'vatAmount', r.vat_amount, 'gross', r.gross_amount, 'advanceRecovery', r.advance_recovery,
        'retention', r.retention, 'receivable', r.receivable, 'suggestedRecovery', r.suggested_recovery, 'suggestedRetention', r.suggested_retention,
        'adjustReason', r.adjust_reason, 'status', r.status, 'sentDate', r.sent_date, 'confirmedDate', r.confirmed_date,
        'confirmedByName', app_private.finance_user_name(r.confirmed_by), 'submittedGross', r.submitted_gross, 'customerNote', r.customer_note,
        'dueDate', r.due_date, 'invoiceNo', r.invoice_no, 'invoiceDate', r.invoice_date, 'attachments', r.attachments, 'note', r.note,
        'legacy', r.legacy_schedule_id is not null, 'cancelReason', r.cancel_reason, 'createdByName', app_private.finance_user_name(r.created_by),
        'createdAt', r.created_at, 'rowVersion', r.row_version, 'received', x.received, 'pending', x.pending, 'outstanding', x.outstanding,
        'overdue', x.outstanding > 0.5 and r.due_date < v_today, 'lastReceived', x.last_received,
        'canEdit', v_record and r.status = 'draft', 'canAct', v_record and r.status <> 'cancelled' and r.kind <> 'opening' and r.legacy_schedule_id is null)
        order by r.sequence_no)
      from public.finance_receivable_rounds r join app_private.finance_receivable_round_rows() x on x.id = r.id where r.contract_id = c.id), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', rc.id, 'code', rc.code, 'receiptDate', rc.receipt_date, 'amount', rc.amount,
        'documentRef', rc.document_ref, 'attachments', rc.attachments, 'note', rc.note, 'status', rc.status, 'rowVersion', rc.row_version,
        'createdBy', rc.created_by, 'createdByName', app_private.finance_user_name(rc.created_by), 'createdAt', rc.created_at,
        'decidedByName', app_private.finance_user_name(rc.decided_by), 'decidedAt', rc.decided_at, 'decisionNote', rc.decision_note,
        'reversedByName', app_private.finance_user_name(rc.reversed_by), 'reversedAt', rc.reversed_at, 'reverseReason', rc.reverse_reason,
        'allocations', (select coalesce(jsonb_agg(jsonb_build_object('roundId', x.round_id, 'sequenceNo', r.sequence_no, 'description', r.description,
            'amount', x.amount, 'kind', x.kind) order by r.sequence_no), '[]'::jsonb)
          from public.finance_customer_receipt_allocations x join public.finance_receivable_rounds r on r.id = x.round_id where x.receipt_id = rc.id),
        'unallocated', rc.amount - coalesce((select sum(x.amount) from public.finance_customer_receipt_allocations x where x.receipt_id = rc.id), 0),
        'canDecide', rc.status = 'submitted' and v_confirm and rc.created_by is distinct from v_actor,
        'canWithdraw', rc.status = 'submitted' and rc.created_by = v_actor, 'canReverse', rc.status = 'confirmed' and v_confirm)
        order by rc.receipt_date desc, rc.created_at desc)
      from public.finance_customer_receipts rc where rc.contract_id = c.id), '[]'::jsonb),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'cutoverDate', o.cutover_date, 'receivableAmount', o.receivable_amount,
        'receivableDueDate', o.receivable_due_date, 'advanceRemaining', o.advance_remaining, 'retentionHeld', o.retention_held, 'note', o.note,
        'attachments', o.attachments, 'status', o.status, 'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by),
        'createdAt', o.created_at, 'decidedByName', app_private.finance_user_name(o.decided_by), 'decidedAt', o.decided_at, 'decisionNote', o.decision_note,
        'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor, 'canCancel', o.status = 'confirmed' and v_confirm)
        order by o.created_at desc)
      from public.finance_customer_openings o where o.contract_id = c.id), '[]'::jsonb),
    'guarantees', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'type', g.guarantee_type, 'name', g.name, 'amount', nullif(g.amount, 0),
        'percent', nullif(g.percent, 0), 'bankName', g.bank_name, 'number', g.guarantee_number, 'issueDate', g.issue_date, 'expiryDate', g.expiry_date,
        'status', g.status, 'note', g.note, 'expiring', g.status = 'active' and g.expiry_date <= v_today + 30) order by g.guarantee_type)
      from public.contract_guarantees g where g.contract_id = c.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', app_private.finance_user_name(e.actor_id), 'reason', e.reason,
        'payload', e.payload, 'at', e.created_at) order by e.created_at desc)
      from (select * from public.finance_events where entity_type in ('receivable_round', 'customer_receipt', 'customer_opening', 'customer_terms', 'guarantee')
        and payload->>'contractId' = c.id order by created_at desc limit 100) e), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Khai điều khoản HĐ CĐT, bảo lãnh
-- ---------------------------------------------------------------------------
create function public.save_finance_customer_terms_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_rec numeric := nullif(p_input->>'advanceRecoveryPercent', '')::numeric; v_ret numeric := nullif(p_input->>'retentionPercent', '')::numeric;
  v_days integer := nullif(p_input->>'paymentTermDays', '')::integer; v_war integer := nullif(p_input->>'warrantyMonths', '')::integer;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if (v_rec is not null and (v_rec < 0 or v_rec > 100)) or (v_ret is not null and (v_ret < 0 or v_ret > 100))
    or (v_days is not null and (v_days < 0 or v_days > 365)) or (v_war is not null and (v_war < 0 or v_war > 120)) then
    raise exception using errcode = '22023', message = 'FINANCE_TERMS_INVALID'; end if;
  select * into c from public.customer_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  update public.customer_contracts set advance_recovery_percent = v_rec, retention_percent = v_ret, payment_term_days = v_days,
    warranty_months = coalesce(v_war, 0), updated_at = now() where id = c.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after, payload)
  values ('customer_terms', c.id, 'customer_terms_save', v_actor, v_reason,
    jsonb_build_object('advanceRecoveryPercent', c.advance_recovery_percent, 'retentionPercent', c.retention_percent, 'paymentTermDays', c.payment_term_days, 'warrantyMonths', c.warranty_months),
    jsonb_build_object('advanceRecoveryPercent', v_rec, 'retentionPercent', v_ret, 'paymentTermDays', v_days, 'warrantyMonths', v_war),
    jsonb_build_object('contractId', c.id, 'code', c.code));
  return jsonb_build_object('contractId', c.id);
end $$;

create function public.save_finance_guarantee_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); g public.contract_guarantees%rowtype; v_status text := coalesce(nullif(p_input->>'status', ''), 'active');
  v_amount numeric := round(coalesce(nullif(p_input->>'amount', '')::numeric, 0), 2); v_issue date := nullif(p_input->>'issueDate', '')::date;
  v_expiry date := nullif(p_input->>'expiryDate', '')::date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into g from public.contract_guarantees where id = p_input->>'id' for update;
  if not found or not exists (select 1 from public.customer_contracts c where c.id = g.contract_id) then
    raise exception using errcode = 'PT404', message = 'FINANCE_GUARANTEE_NOT_FOUND'; end if;
  if v_status not in ('draft', 'active', 'released', 'expired') or v_amount < 0 or (v_status = 'active' and (v_amount <= 0 or v_expiry is null))
    or (v_issue is not null and v_expiry is not null and v_expiry < v_issue) then
    raise exception using errcode = '22023', message = 'FINANCE_GUARANTEE_INVALID'; end if;
  update public.contract_guarantees set amount = v_amount, percent = round(coalesce(nullif(p_input->>'percent', '')::numeric, 0), 3),
    bank_name = nullif(btrim(p_input->>'bankName'), ''), guarantee_number = nullif(btrim(p_input->>'number'), ''), issue_date = v_issue, expiry_date = v_expiry,
    status = v_status, note = nullif(btrim(p_input->>'note'), ''), updated_at = now() where id = g.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, before, after, payload)
  values ('guarantee', g.id, 'guarantee_save', v_actor, to_jsonb(g) - 'created_at' - 'updated_at',
    jsonb_build_object('amount', v_amount, 'status', v_status, 'expiryDate', v_expiry), jsonb_build_object('contractId', g.contract_id, 'name', g.name));
  return jsonb_build_object('id', g.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Đợt thu: lập / sửa nháp, gửi CĐT, CĐT xác nhận, trả lại, hóa đơn, hủy
-- ---------------------------------------------------------------------------
create function public.save_finance_receivable_round_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype; r public.finance_receivable_rounds%rowtype;
  v_kind text := coalesce(nullif(p_input->>'kind', ''), 'progress'); v_net numeric := round(nullif(p_input->>'netAmount', '')::numeric, 2);
  v_vat numeric := coalesce(nullif(p_input->>'vatPercent', '')::numeric, -1); v_vat_amount numeric; v_gross numeric; s record;
  v_rec numeric; v_ret numeric; v_reason text := nullif(btrim(p_input->>'adjustReason'), ''); v_id uuid; v_seq integer; m jsonb;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_kind not in ('advance', 'progress', 'settlement', 'retention', 'other') then raise exception using errcode = '22023', message = 'FINANCE_ROUND_KIND_INVALID'; end if;
  if v_net is null or v_net <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if nullif(btrim(p_input->>'description'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_ROUND_DESCRIPTION_REQUIRED'; end if;
  if nullif(p_input->>'id', '') is not null then
    select * into r from public.finance_receivable_rounds where id = (p_input->>'id')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ROUND_NOT_FOUND'; end if;
    if r.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if r.status <> 'draft' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    select * into c from public.customer_contracts where id = r.contract_id;
  else
    select * into c from public.customer_contracts where id = p_input->>'contractId' for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  end if;
  if v_vat < 0 then v_vat := coalesce(c.vat_percent, 0); end if;
  v_vat_amount := round(v_net * v_vat / 100, 2); v_gross := v_net + v_vat_amount;
  if v_kind = 'retention' then
    m := app_private.finance_customer_contract_metrics(c.id);
    if v_gross > coalesce((m->>'retentionHeld')::numeric, 0) + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_RETENTION_OVER'; end if;
  end if;
  select * into s from app_private.finance_round_suggest(c.id, v_kind, v_gross, r.id);
  v_rec := coalesce(round(nullif(p_input->>'advanceRecovery', '')::numeric, 2), s.recovery);
  v_ret := coalesce(round(nullif(p_input->>'retention', '')::numeric, 2), s.retention);
  if v_rec < 0 or v_ret < 0 or v_rec + v_ret > v_gross then raise exception using errcode = '22023', message = 'FINANCE_ROUND_DEDUCTION_INVALID'; end if;
  if (abs(v_rec - s.recovery) > 1 or abs(v_ret - s.retention) > 1) and v_reason is null then
    raise exception using errcode = '22023', message = 'FINANCE_ROUND_ADJUST_REASON'; end if;
  if r.id is null then
    select coalesce(max(sequence_no), 0) + 1 into v_seq from public.finance_receivable_rounds where contract_id = c.id;
    insert into public.finance_receivable_rounds (contract_id, project_id, construction_site_id, sequence_no, kind, description, net_amount, vat_percent, vat_amount,
      gross_amount, advance_recovery, retention, suggested_recovery, suggested_retention, adjust_reason, acceptance_id, attachments, note, created_by)
    values (c.id, c.project_id, c.construction_site_id, v_seq, v_kind, btrim(p_input->>'description'), v_net, v_vat, v_vat_amount, v_gross, v_rec, v_ret,
      s.recovery, s.retention, v_reason, nullif(p_input->>'acceptanceId', '')::uuid, coalesce(p_input->'attachments', '[]'::jsonb), nullif(btrim(p_input->>'note'), ''), v_actor)
    returning id into v_id;
  else
    v_id := r.id;
    update public.finance_receivable_rounds set kind = v_kind, description = btrim(p_input->>'description'), net_amount = v_net, vat_percent = v_vat,
      vat_amount = v_vat_amount, gross_amount = v_gross, advance_recovery = v_rec, retention = v_ret, suggested_recovery = s.recovery,
      suggested_retention = s.retention, adjust_reason = v_reason, acceptance_id = nullif(p_input->>'acceptanceId', '')::uuid,
      attachments = coalesce(p_input->'attachments', '[]'::jsonb), note = nullif(btrim(p_input->>'note'), ''), updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  perform app_private.finance_round_sync_schedule(v_id);
  select * into r from public.finance_receivable_rounds where id = v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('receivable_round', v_id::text, case when p_input->>'id' is null then 'round_create' else 'round_update' end, v_actor, v_reason,
    jsonb_build_object('contractId', c.id, 'sequenceNo', r.sequence_no, 'gross', v_gross, 'recovery', v_rec, 'retention', v_ret, 'receivable', r.receivable));
  return jsonb_build_object('id', v_id, 'sequenceNo', r.sequence_no, 'receivable', r.receivable);
end $$;

create function public.transition_finance_receivable_round_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  r public.finance_receivable_rounds%rowtype; c public.customer_contracts%rowtype; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_date date := coalesce(nullif(p_input->>'date', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date); v_gross numeric; v_net numeric; s record;
  v_rec numeric; v_ret numeric;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into r from public.finance_receivable_rounds where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ROUND_NOT_FOUND'; end if;
  if r.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if r.legacy_schedule_id is not null or r.kind = 'opening' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
  if v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_DATE_FUTURE'; end if;
  select * into c from public.customer_contracts where id = r.contract_id;
  if v_action = 'send' then
    if r.status <> 'draft' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    update public.finance_receivable_rounds set status = 'sent', sent_date = v_date, customer_note = null, updated_at = now(), row_version = row_version + 1 where id = r.id;
  elsif v_action = 'confirm' then
    if r.status not in ('draft', 'sent') then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    v_gross := coalesce(round(nullif(p_input->>'confirmedGross', '')::numeric, 2), r.gross_amount);
    if v_gross <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    if abs(v_gross - r.gross_amount) > 0.5 and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    v_net := case when abs(v_gross - r.gross_amount) > 0.5 then round(v_gross / (1 + r.vat_percent / 100), 2) else r.net_amount end;
    select * into s from app_private.finance_round_suggest(c.id, r.kind, v_gross, r.id);
    v_rec := coalesce(round(nullif(p_input->>'advanceRecovery', '')::numeric, 2), case when abs(v_gross - r.gross_amount) > 0.5 then s.recovery else r.advance_recovery end);
    v_ret := coalesce(round(nullif(p_input->>'retention', '')::numeric, 2), case when abs(v_gross - r.gross_amount) > 0.5 then s.retention else r.retention end);
    if v_rec < 0 or v_ret < 0 or v_rec + v_ret > v_gross then raise exception using errcode = '22023', message = 'FINANCE_ROUND_DEDUCTION_INVALID'; end if;
    if (abs(v_rec - s.recovery) > 1 or abs(v_ret - s.retention) > 1) and coalesce(v_reason, r.adjust_reason) is null then
      raise exception using errcode = '22023', message = 'FINANCE_ROUND_ADJUST_REASON'; end if;
    update public.finance_receivable_rounds set status = 'confirmed', confirmed_date = v_date, confirmed_by = v_actor,
      submitted_gross = case when abs(v_gross - gross_amount) > 0.5 then gross_amount end, gross_amount = v_gross, net_amount = v_net, vat_amount = v_gross - v_net,
      advance_recovery = v_rec, retention = v_ret, suggested_recovery = s.recovery, suggested_retention = s.retention,
      adjust_reason = coalesce(v_reason, adjust_reason), customer_note = coalesce(v_reason, customer_note),
      due_date = v_date + coalesce(c.payment_term_days, 30), sent_date = coalesce(sent_date, v_date), updated_at = now(), row_version = row_version + 1 where id = r.id;
  elsif v_action = 'return' then
    if r.status <> 'sent' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_receivable_rounds set status = 'draft', customer_note = v_reason, updated_at = now(), row_version = row_version + 1 where id = r.id;
  elsif v_action = 'invoice' then
    if r.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if nullif(btrim(p_input->>'invoiceNo'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_REQUIRED'; end if;
    update public.finance_receivable_rounds set invoice_no = btrim(p_input->>'invoiceNo'), invoice_date = v_date, updated_at = now(), row_version = row_version + 1 where id = r.id;
  elsif v_action = 'cancel' then
    if r.status = 'cancelled' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if exists (select 1 from public.finance_customer_receipt_allocations x join public.finance_customer_receipts rc on rc.id = x.receipt_id
      where x.round_id = r.id and rc.status in ('submitted', 'confirmed')) then
      raise exception using errcode = '22023', message = 'FINANCE_ROUND_HAS_RECEIPTS'; end if;
    update public.finance_receivable_rounds set status = 'cancelled', cancel_reason = v_reason, updated_at = now(), row_version = row_version + 1 where id = r.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  perform app_private.finance_round_sync_schedule(r.id);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  select 'receivable_round', r.id::text, 'round_' || v_action, v_actor, v_reason,
    jsonb_build_object('contractId', r.contract_id, 'sequenceNo', r.sequence_no, 'date', v_date, 'gross', x.gross_amount, 'receivable', x.receivable,
      'submittedGross', x.submitted_gross, 'invoiceNo', x.invoice_no, 'dueDate', x.due_date)
  from public.finance_receivable_rounds x where x.id = r.id;
  return (select jsonb_build_object('id', x.id, 'status', x.status, 'receivable', x.receivable, 'dueDate', x.due_date, 'rowVersion', x.row_version)
    from public.finance_receivable_rounds x where x.id = r.id);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Phiếu thu: ghi → người khác xác nhận (dòng tiền vào) / từ chối / rút / đảo; trừ tiền trả trước vào đợt
-- ---------------------------------------------------------------------------
create function app_private.finance_check_receipt_allocations(p_contract text, p_allocations jsonb, p_exclude_receipt uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare a jsonb; x record; v_amount numeric; v_total numeric := 0; v_seen uuid[] := '{}';
begin
  for a in select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amount := round(nullif(a->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    perform 1 from public.finance_receivable_rounds where id = (a->>'roundId')::uuid for update;
    select * into x from app_private.finance_receivable_round_rows() q where q.id = (a->>'roundId')::uuid;
    if not found or x.contract_id <> p_contract or x.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_ROUND_SCOPE'; end if;
    if x.id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
    v_seen := v_seen || x.id;
    if v_amount > x.outstanding - (x.pending - coalesce((select sum(y.amount) from public.finance_customer_receipt_allocations y
        where y.round_id = x.id and y.receipt_id = p_exclude_receipt), 0)) + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_OVER_OUTSTANDING'; end if;
    v_total := v_total + v_amount;
  end loop;
  return v_total;
end $$;

create function public.save_finance_customer_receipt_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_date date := nullif(p_input->>'receiptDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), ''); v_alloc numeric; v_id uuid; v_code text;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; a jsonb;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into c from public.customer_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_REF_REQUIRED'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.finance_customer_receipts where contract_id = c.id and document_ref = v_ref and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_REF_DUPLICATE'; end if;
  v_alloc := app_private.finance_check_receipt_allocations(c.id, p_input->'allocations', null);
  if v_alloc > v_amount + 0.005 then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_OVER_ALLOCATED'; end if;
  v_code := 'PT-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_customer_receipt_seq')::text, 3, '0');
  insert into public.finance_customer_receipts (code, contract_id, project_id, construction_site_id, customer_name, receipt_date, amount, document_ref, attachments, note, created_by)
  values (v_code, c.id, c.project_id, c.construction_site_id, c.customer_name, v_date, v_amount, v_ref, p_input->'attachments', nullif(btrim(p_input->>'note'), ''), v_actor)
  returning id into v_id;
  for a in select value from jsonb_array_elements(coalesce(p_input->'allocations', '[]'::jsonb)) loop
    insert into public.finance_customer_receipt_allocations (receipt_id, round_id, amount, created_by) values (v_id, (a->>'roundId')::uuid, round((a->>'amount')::numeric, 2), v_actor);
  end loop;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('customer_receipt', v_id::text, 'receipt_submit', v_actor, jsonb_build_object('contractId', c.id, 'code', v_code, 'amount', v_amount, 'documentRef', v_ref, 'allocated', v_alloc));
  perform app_private.finance_notify_receivable(app_private.finance_confirm_users(), 'Phiếu thu CĐT chờ xác nhận',
    v_code || ' · ' || c.customer_name || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', c.id, v_actor);
  return jsonb_build_object('id', v_id, 'code', v_code, 'unallocated', v_amount - v_alloc);
end $$;

create function public.decide_finance_customer_receipt_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  rc public.finance_customer_receipts%rowtype; v_finance text; v_ref text; x record; v_alloc jsonb;
begin
  select * into rc from public.finance_customer_receipts where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_RECEIPT_NOT_FOUND'; end if;
  if rc.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  v_ref := 'finance_customer_receipt:' || rc.id::text;
  if v_action = 'withdraw' then
    if rc.status <> 'submitted' or rc.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.finance_customer_receipts set status = 'withdrawn', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = rc.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if rc.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_STATE'; end if;
    if v_actor = rc.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.finance_customer_receipts set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = rc.id;
    else
      select jsonb_agg(jsonb_build_object('roundId', round_id, 'amount', amount)) into v_alloc from public.finance_customer_receipt_allocations where receipt_id = rc.id;
      perform app_private.finance_check_receipt_allocations(rc.contract_id, v_alloc, rc.id);
      if app_private.finance_period_is_locked(rc.project_id, rc.construction_site_id, 'VND', rc.receipt_date) then
        raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
      select f.id into v_finance from public.project_finances f
      where (rc.project_id is not null and f.project_id = rc.project_id) or (rc.construction_site_id is not null and f.construction_site_id = rc.construction_site_id)
      order by case when rc.project_id is not null and f.project_id = rc.project_id then 0 else 1 end, f.id limit 1;
      insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
        type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name)
      values ('finance-customer-receipt-' || rc.id::text, coalesce(v_finance, ''), coalesce(rc.construction_site_id, ''), rc.project_id, v_finance, rc.construction_site_id,
        'revenue_received', 'other', rc.amount, 'Thu CĐT ' || rc.customer_name || ' - ' || rc.code || ' · ' || rc.document_ref, rc.receipt_date::text, 'workflow',
        v_ref, v_ref, rc.attachments, v_actor::text, now(), rc.customer_name);
      update public.finance_customer_receipts set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = rc.id;
    end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if rc.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name)
    select 'finance-customer-receipt-reversal-' || rc.id::text, t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
      'revenue_received', 'other', -rc.amount, 'Đảo phiếu thu ' || rc.code || ' · ' || v_reason, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'workflow',
      v_ref || ':reversal', v_ref || ':reversal', '[]'::jsonb, v_actor::text, now(), t.counterparty_name
    from public.project_transactions t where t.source_ref = v_ref;
    update public.finance_customer_receipts set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason, row_version = row_version + 1 where id = rc.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  for x in select distinct round_id from public.finance_customer_receipt_allocations where receipt_id = rc.id loop
    perform app_private.finance_round_sync_schedule(x.round_id);
  end loop;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('customer_receipt', rc.id::text, 'receipt_' || v_action, v_actor, v_reason, jsonb_build_object('contractId', rc.contract_id, 'code', rc.code, 'amount', rc.amount));
  if v_action <> 'withdraw' then
    perform app_private.finance_notify_receivable(array[rc.created_by], case v_action when 'confirm' then 'Phiếu thu đã xác nhận' when 'reject' then 'Phiếu thu bị từ chối' else 'Phiếu thu đã bị đảo' end,
      rc.code || coalesce(': ' || v_reason, ''), rc.contract_id, v_actor);
  end if;
  return jsonb_build_object('id', rc.id, 'action', v_action);
end $$;

create function public.apply_finance_customer_prepayment_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); rc public.finance_customer_receipts%rowtype; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2); v_free numeric;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into rc from public.finance_customer_receipts where id = (p_input->>'receiptId')::uuid for update;
  if not found or rc.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_STATE'; end if;
  v_free := rc.amount - coalesce((select sum(amount) from public.finance_customer_receipt_allocations where receipt_id = rc.id), 0);
  if v_amount is null or v_amount <= 0 or v_amount > v_free + 0.005 then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_OVER_ALLOCATED'; end if;
  perform app_private.finance_check_receipt_allocations(rc.contract_id, jsonb_build_array(jsonb_build_object('roundId', p_input->>'roundId', 'amount', v_amount)), null);
  insert into public.finance_customer_receipt_allocations (receipt_id, round_id, amount, kind, created_by) values (rc.id, (p_input->>'roundId')::uuid, v_amount, 'prepayment', v_actor);
  perform app_private.finance_round_sync_schedule((p_input->>'roundId')::uuid);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('customer_receipt', rc.id::text, 'receipt_apply_prepayment', v_actor, jsonb_build_object('contractId', rc.contract_id, 'code', rc.code, 'amount', v_amount, 'roundId', p_input->>'roundId'));
  return jsonb_build_object('id', rc.id, 'amount', v_amount);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Đối chiếu đầu kỳ (MISA 30/09): người lập ≠ người chốt; chốt sinh đợt "Số dư đầu kỳ" cho phần còn phải thu
-- ---------------------------------------------------------------------------
create function public.save_finance_customer_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype; v_id uuid; v_cut date;
  v_rcv numeric := round(coalesce(nullif(p_input->>'receivableAmount', '')::numeric, -1), 2); v_adv numeric := round(coalesce(nullif(p_input->>'advanceRemaining', '')::numeric, -1), 2);
  v_ret numeric := round(coalesce(nullif(p_input->>'retentionHeld', '')::numeric, -1), 2);
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into c from public.customer_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  if v_rcv < 0 or v_adv < 0 or v_ret < 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.finance_customer_openings where contract_id = c.id and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_OPENING_EXISTS'; end if;
  select ap_cutover_date into v_cut from public.finance_settings where id = 1;
  insert into public.finance_customer_openings (contract_id, cutover_date, receivable_amount, receivable_due_date, advance_remaining, retention_held, note, attachments, created_by)
  values (c.id, v_cut, v_rcv, nullif(p_input->>'receivableDueDate', '')::date, v_adv, v_ret, nullif(btrim(p_input->>'note'), ''), p_input->'attachments', v_actor)
  returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('customer_opening', v_id::text, 'customer_opening_submit', v_actor,
    jsonb_build_object('contractId', c.id, 'receivable', v_rcv, 'advanceRemaining', v_adv, 'retentionHeld', v_ret));
  perform app_private.finance_notify_receivable(app_private.finance_confirm_users(), 'Đối chiếu đầu kỳ phải thu chờ chốt', c.code || ' · ' || c.customer_name, c.id, v_actor);
  return jsonb_build_object('id', v_id);
end $$;

create function public.decide_finance_customer_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  o public.finance_customer_openings%rowtype; c public.customer_contracts%rowtype; v_round uuid;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into o from public.finance_customer_openings where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_OPENING_NOT_FOUND'; end if;
  select * into c from public.customer_contracts where id = o.contract_id;
  if v_action in ('confirm', 'reject') then
    if o.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if v_actor = o.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.finance_customer_openings set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = o.id;
    else
      if o.receivable_amount > 0 then
        insert into public.finance_receivable_rounds (contract_id, project_id, construction_site_id, sequence_no, kind, description, net_amount, vat_percent, vat_amount,
          gross_amount, status, sent_date, confirmed_date, confirmed_by, due_date, note, created_by)
        values (c.id, c.project_id, c.construction_site_id, 0, 'opening', 'Số dư phải thu đầu kỳ (MISA ' || to_char(o.cutover_date - 1, 'DD/MM/YYYY') || ')',
          o.receivable_amount, 0, 0, o.receivable_amount, 'confirmed', o.cutover_date - 1, o.cutover_date - 1, v_actor,
          coalesce(o.receivable_due_date, o.cutover_date), 'Đối chiếu đầu kỳ', o.created_by)
        on conflict (contract_id, sequence_no) do update set gross_amount = excluded.gross_amount, net_amount = excluded.net_amount, status = 'confirmed',
          due_date = excluded.due_date, confirmed_by = excluded.confirmed_by, cancel_reason = null, updated_at = now(), row_version = public.finance_receivable_rounds.row_version + 1
        returning id into v_round;
        perform app_private.finance_round_sync_schedule(v_round);
      end if;
      update public.finance_customer_openings set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason, opening_round_id = v_round where id = o.id;
    end if;
  elsif v_action = 'cancel' then
    if o.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if o.opening_round_id is not null and exists (select 1 from public.finance_customer_receipt_allocations x join public.finance_customer_receipts rc on rc.id = x.receipt_id
      where x.round_id = o.opening_round_id and rc.status in ('submitted', 'confirmed')) then
      raise exception using errcode = '22023', message = 'FINANCE_OPENING_HAS_PAYMENTS'; end if;
    update public.finance_receivable_rounds set status = 'cancelled', cancel_reason = v_reason, updated_at = now(), row_version = row_version + 1 where id = o.opening_round_id;
    if o.opening_round_id is not null then perform app_private.finance_round_sync_schedule(o.opening_round_id); end if;
    update public.finance_customer_openings set status = 'cancelled', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = o.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('customer_opening', o.id::text, 'customer_opening_' || v_action, v_actor, v_reason, jsonb_build_object('contractId', o.contract_id, 'receivable', o.receivable_amount));
  if v_action <> 'cancel' then
    perform app_private.finance_notify_receivable(array[o.created_by], case v_action when 'confirm' then 'Đã chốt đầu kỳ phải thu' else 'Đối chiếu đầu kỳ bị trả lại' end,
      c.code || coalesce(': ' || v_reason, ''), c.id, v_actor);
  end if;
  return jsonb_build_object('id', o.id, 'action', v_action);
end $$;

revoke all on function app_private.finance_receivable_round_rows(), app_private.finance_customer_contract_metrics(text),
  app_private.finance_round_suggest(text, text, numeric, uuid), app_private.finance_round_sync_schedule(uuid), app_private.guard_customer_receivable_direct_write(),
  app_private.finance_notify_receivable(uuid[], text, text, text, uuid), app_private.finance_confirm_users(),
  app_private.finance_check_receipt_allocations(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.get_finance_receivables_v1(), public.get_finance_customer_contract_v1(text), public.save_finance_customer_terms_v1(jsonb),
  public.save_finance_guarantee_v1(jsonb), public.save_finance_receivable_round_v1(jsonb), public.transition_finance_receivable_round_v1(jsonb),
  public.save_finance_customer_receipt_v1(jsonb), public.decide_finance_customer_receipt_v1(jsonb), public.apply_finance_customer_prepayment_v1(jsonb),
  public.save_finance_customer_opening_v1(jsonb), public.decide_finance_customer_opening_v1(jsonb) from public, anon;
grant execute on function public.get_finance_receivables_v1(), public.get_finance_customer_contract_v1(text), public.save_finance_customer_terms_v1(jsonb),
  public.save_finance_guarantee_v1(jsonb), public.save_finance_receivable_round_v1(jsonb), public.transition_finance_receivable_round_v1(jsonb),
  public.save_finance_customer_receipt_v1(jsonb), public.decide_finance_customer_receipt_v1(jsonb), public.apply_finance_customer_prepayment_v1(jsonb),
  public.save_finance_customer_opening_v1(jsonb), public.decide_finance_customer_opening_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Vá Tổng quan: phải thu, quá hạn thu, sản lượng chưa đề nghị theo dự án và toàn công ty
-- ---------------------------------------------------------------------------

create or replace function public.get_finance_overview_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'receivables', coalesce(r.rows, '[]'::jsonb),
        'supplierAdvance', (select nullif(sum(x.remaining), 0) from app_private.finance_advance_rows() x where x.project_id = s.id),
        'ar', (select jsonb_build_object('outstanding', coalesce(sum((z.m->>'outstanding')::numeric), 0), 'overdue', coalesce(sum((z.m->>'overdue')::numeric), 0),
            'unbilled', sum((z.m->>'unbilled')::numeric), 'advanceRemaining', coalesce(sum((z.m->>'advanceRemaining')::numeric), 0))
          from (select app_private.finance_customer_contract_metrics(c.id) m from public.customer_contracts c where c.project_id = s.id) z))
        order by coalesce((select sum(x.amount) from tx x where x.project_id = s.id), 0) desc, s.code)
        from scope s left join ap a on a.project_id = s.id left join recv r on r.project_id = s.id), '[]'::jsonb),
      'companyPayable', (select jsonb_build_object('outstanding', coalesce(sum(r.outstanding), 0), 'docs', count(*))
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and r.project_id is null),
      'receivables', (select jsonb_build_object('outstanding', coalesce(sum((z.m->>'outstanding')::numeric), 0), 'overdue', coalesce(sum((z.m->>'overdue')::numeric), 0),
          'unbilled', sum((z.m->>'unbilled')::numeric))
        from (select app_private.finance_customer_contract_metrics(c.id) m from public.customer_contracts c where coalesce(c.status, '') not in ('cancelled', 'draft')) z),
      'advances', (select jsonb_build_object('remaining', coalesce(sum(x.remaining), 0),
          'overdue', coalesce(sum(x.remaining) filter (where not x.target_closed and x.repay_due_date < v_today), 0),
          'overdueCount', count(*) filter (where x.remaining > 0.004 and not x.target_closed and x.repay_due_date < v_today),
          'refundDue', coalesce(sum(x.remaining) filter (where x.target_closed), 0), 'refundDueCount', count(*) filter (where x.remaining > 0.004 and x.target_closed))
        from app_private.finance_advance_rows() x where x.remaining > 0.004)
    )
  );
end;
$function$;

notify pgrst, 'reload schema';
