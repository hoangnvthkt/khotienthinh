-- ===========================================================================
-- Tài chính đợt 3a — Thu chi & quỹ (03/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 17; mockup .superpowers/review/adv/tq-v1.html
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 9 câu 03/10):
-- * Từ mốc 01/10 mọi khoản tiền vào / ra ghi qua TÀI KHOẢN TIỀN trong Vioo (tiền mặt, ngân hàng, quỹ công trường); MISA vẫn là sổ kế toán.
-- * Khai tài khoản + số dư đầu kỳ theo MISA 30/09, người khác chốt.
-- * Xác nhận chi NCC (đề nghị chi, tạm ứng, chi ngoài từ mốc), phiếu thu CĐT, NCC hoàn tạm ứng: bắt buộc chọn tài khoản → sổ thu chi tự ghi.
-- * Phiếu chi khác (lương, thuế, bảo hiểm, văn phòng, lãi vay, trả nợ vay, tạm ứng nhân viên…) = đề nghị chi loại 'expense':
--   duyệt theo ma trận + luật 3 người; gắn dự án thì ghi chi phí dự án theo khoản mục.
-- * Thu khác và chuyển tiền giữa tài khoản: người lập ≠ người xác nhận; chuyển tiền không phải thu / chi.
-- * Đối chiếu sao kê theo tháng: lệch phải giải thích, người khác chốt; chốt xong khóa tháng của tài khoản (không ghi lùi ngày).
-- * Dự báo 8 tuần: thu (đợt CĐT đã xác nhận theo hạn; đợt đã gửi = có thể), chi (nợ NCC theo hạn, đề nghị đã lập chưa chi, khoản định kỳ);
--   cảnh báo dưới tồn quỹ tối thiểu (Quản trị, mặc định 2 tỷ).
-- * Sổ thu chi bất biến: ghi nhầm thì đảo (dòng ngược chiều), không sửa, không xóa.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.cash_funds
  add column kind text not null default 'cash' check (kind in ('cash', 'bank', 'site')),
  add column bank_name text,
  add column account_no text,
  add column project_id text references public.projects(id),
  add column holder_name text,
  add column note text,
  add column sort_order integer not null default 0,
  add column created_by uuid references public.users(id),
  add column updated_at timestamptz not null default now();

alter table public.finance_settings add column cash_min_balance numeric(18,2) not null default 2000000000 check (cash_min_balance >= 0);

create table public.finance_cash_openings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.cash_funds(id),
  cutover_date date not null,
  balance numeric(18,2) not null,
  note text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'cancelled')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_cash_openings_one_active on public.finance_cash_openings (account_id) where status in ('submitted', 'confirmed');

create table public.finance_cash_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.cash_funds(id),
  entry_date date not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(18,2) not null check (amount > 0),
  source_type text not null,
  source_id text not null,
  code text,
  description text not null,
  counterparty text,
  project_id text,
  reversal_of uuid references public.finance_cash_entries(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index finance_cash_entries_account_idx on public.finance_cash_entries (account_id, entry_date);
create index finance_cash_entries_source_idx on public.finance_cash_entries (source_type, source_id);

create table public.finance_cash_reconciliations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.cash_funds(id),
  period_month date not null check (extract(day from period_month) = 1),
  book_balance numeric(18,2) not null,
  statement_balance numeric(18,2) not null,
  difference numeric(18,2) generated always as (book_balance - statement_balance) stored,
  explanation text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text
);
create unique index finance_cash_recon_one_active on public.finance_cash_reconciliations (account_id, period_month) where status in ('submitted', 'confirmed');

create sequence public.finance_cash_movement_seq;
create table public.finance_cash_movements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null check (kind in ('receipt', 'transfer')),
  category text not null,
  from_account_id uuid references public.cash_funds(id),
  to_account_id uuid not null references public.cash_funds(id),
  amount numeric(18,2) not null check (amount > 0),
  movement_date date not null,
  document_ref text,
  counterparty text,
  project_id text references public.projects(id),
  description text not null check (length(btrim(description)) > 0),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reverse_reason text,
  row_version bigint not null default 1,
  check (kind <> 'transfer' or (from_account_id is not null and from_account_id <> to_account_id))
);

create table public.finance_cash_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  direction text not null check (direction in ('in', 'out')),
  category text not null,
  amount numeric(18,2) not null check (amount > 0),
  day_of_month integer not null check (day_of_month between 1 and 28),
  account_id uuid references public.cash_funds(id),
  start_month date not null,
  end_month date,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);

-- Đề nghị chi loại 'expense' (chi khác, không có NCC) + tài khoản tiền trên phiếu thu CĐT / NCC hoàn tạm ứng / chi ngoài.
alter table public.finance_payment_requests alter column supplier_id drop not null,
  drop constraint finance_payment_requests_kind_check,
  add constraint finance_payment_requests_kind_check check (kind in ('payable', 'advance', 'expense')),
  add constraint finance_payment_requests_supplier_check check (kind = 'expense' or supplier_id is not null),
  add column expense_category text,
  add column cost_category text;
create sequence public.finance_expense_seq;
alter table public.finance_customer_receipts add column cash_account_id uuid references public.cash_funds(id);
alter table public.supplier_advance_adjustments add column cash_account_id uuid references public.cash_funds(id);

do $$ declare t text; begin
  foreach t in array array['finance_cash_openings', 'finance_cash_entries', 'finance_cash_reconciliations', 'finance_cash_movements', 'finance_cash_plans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.finance_cash_movement_seq, public.finance_expense_seq from public, anon, authenticated;

-- Sổ thu chi bất biến; không ghi trước mốc, không ghi vào tháng đã chốt đối chiếu.
create function app_private.trg_finance_cash_entry_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cut date;
begin
  if tg_op <> 'INSERT' then raise exception using errcode = '42501', message = 'FINANCE_CASH_ENTRY_IMMUTABLE'; end if;
  select ap_cutover_date into v_cut from public.finance_settings where id = 1;
  if new.entry_date < v_cut then raise exception using errcode = '22023', message = 'FINANCE_CASH_BEFORE_CUTOVER'; end if;
  if exists (select 1 from public.finance_cash_reconciliations r where r.account_id = new.account_id and r.status = 'confirmed'
      and new.entry_date < (r.period_month + interval '1 month')::date) then
    raise exception using errcode = '55000', message = 'FINANCE_CASH_PERIOD_LOCKED'; end if;
  if not exists (select 1 from public.cash_funds f where f.id = new.account_id and f.is_active) and new.reversal_of is null then
    raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_INACTIVE'; end if;
  return new;
end $$;
create trigger trg_finance_cash_entry_guard before insert or update or delete on public.finance_cash_entries
  for each row execute function app_private.trg_finance_cash_entry_guard();

-- Danh mục tài khoản chỉ sửa qua hàm Tài chính.
create function app_private.guard_cash_fund_direct_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_path text := coalesce(current_setting('request.path', true), '');
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') and v_path <> '' and v_path not like '/rpc/%' then
    raise exception using errcode = '42501', message = 'FINANCE_CASH_ACCOUNT_DIRECT_WRITE'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_guard_cash_fund_direct_write before insert or update or delete on public.cash_funds
  for each row execute function app_private.guard_cash_fund_direct_write();

-- ---------------------------------------------------------------------------
-- 2. Trợ giúp: ghi sổ, đảo, số dư, dự báo
-- ---------------------------------------------------------------------------
create function app_private.finance_cash_entry(p_account uuid, p_date date, p_direction text, p_amount numeric, p_source_type text, p_source_id text,
  p_code text, p_description text, p_counterparty text, p_project text, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_account is null then raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_REQUIRED'; end if;
  insert into public.finance_cash_entries (account_id, entry_date, direction, amount, source_type, source_id, code, description, counterparty, project_id, created_by)
  values (p_account, p_date, p_direction, round(p_amount, 2), p_source_type, p_source_id, p_code, p_description, p_counterparty, p_project, p_actor)
  returning id into v_id;
  return v_id;
end $$;

-- Đảo mọi dòng sổ của một chứng từ (dòng ngược chiều, ngày hôm nay); trả số dòng đã đảo.
create function app_private.finance_cash_reverse_source(p_source_type text, p_source_id text, p_reason text, p_actor uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare e record; n integer := 0;
begin
  for e in select x.* from public.finance_cash_entries x where x.source_type = p_source_type and x.source_id = p_source_id and x.reversal_of is null
    and not exists (select 1 from public.finance_cash_entries y where y.reversal_of = x.id) loop
    insert into public.finance_cash_entries (account_id, entry_date, direction, amount, source_type, source_id, code, description, counterparty, project_id, reversal_of, created_by)
    values (e.account_id, (now() at time zone 'Asia/Ho_Chi_Minh')::date, case e.direction when 'in' then 'out' else 'in' end, e.amount, e.source_type, e.source_id,
      e.code, 'Đảo: ' || e.description || coalesce(' — ' || p_reason, ''), e.counterparty, e.project_id, e.id, p_actor);
    n := n + 1;
  end loop;
  return n;
end $$;

create function app_private.finance_cash_balance(p_account uuid, p_until date default null)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select o.balance from public.finance_cash_openings o where o.account_id = p_account and o.status = 'confirmed'), 0)
    + coalesce((select sum(case e.direction when 'in' then e.amount else -e.amount end) from public.finance_cash_entries e
        where e.account_id = p_account and (p_until is null or e.entry_date <= p_until)), 0);
$$;

create function app_private.finance_cash_require_account(p_account uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if p_account is null then raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_REQUIRED'; end if;
  if not exists (select 1 from public.cash_funds where id = p_account and is_active) then
    raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_INACTIVE'; end if;
  return p_account;
end $$;

-- Dự báo 8 tuần (tuần bắt đầu thứ Hai). Khoản quá hạn dồn vào tuần đầu.
create function app_private.finance_cash_forecast()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_w0 date; v_start numeric; v_min numeric; v_weeks jsonb := '[]'::jsonb;
  i integer; ws date; we date; v_in_sure numeric; v_in_maybe numeric; v_out_ap numeric; v_out_req numeric; v_out_plan numeric; v_in_plan numeric;
  v_sure numeric; v_maybe numeric; v_lowest numeric; v_lowest_w date; v_below date;
begin
  v_w0 := date_trunc('week', v_today)::date;
  select cash_min_balance into v_min from public.finance_settings where id = 1;
  select coalesce(sum(app_private.finance_cash_balance(f.id)), 0) into v_start from public.cash_funds f where f.is_active;
  v_sure := v_start; v_maybe := v_start;
  for i in 0..7 loop
    ws := v_w0 + i * 7; we := ws + 6;
    select coalesce(sum(x.outstanding), 0) into v_in_sure from app_private.finance_receivable_round_rows() x
    where x.outstanding > 0.5 and (case when x.due_date < v_w0 then v_w0 else x.due_date end) between ws and we;
    select coalesce(sum(r.receivable), 0) into v_in_maybe from public.finance_receivable_rounds r join public.customer_contracts c on c.id = r.contract_id
    where r.status = 'sent' and greatest(r.sent_date + 15 + coalesce(c.payment_term_days, 30), v_w0) between ws and we;
    select coalesce(sum(p.outstanding - p.pending_external), 0) into v_out_ap from app_private.finance_payable_rows() p
    where p.outstanding > 0.5 and not p.internal and (case when p.due_date is null or p.due_date < v_w0 then v_w0 else p.due_date end) between ws and we;
    -- Tạm ứng NCC và chi khác đã lập chưa chi (đề nghị chi NCC trả các chứng từ đã tính ở trên nên không cộng lại).
    select coalesce(sum(r.amount), 0) into v_out_req from public.finance_payment_requests r
    where r.kind in ('advance', 'expense') and r.status in ('pending', 'returned', 'approved') and greatest(r.planned_date, v_w0) between ws and we;
    select coalesce(sum(pl.amount) filter (where pl.direction = 'out'), 0), coalesce(sum(pl.amount) filter (where pl.direction = 'in'), 0) into v_out_plan, v_in_plan
    from public.finance_cash_plans pl cross join lateral generate_series(date_trunc('month', ws)::date, date_trunc('month', we)::date, interval '1 month') m(mon)
    where pl.is_active and (m.mon::date + pl.day_of_month - 1) between greatest(ws, v_today) and we
      and m.mon::date >= pl.start_month and (pl.end_month is null or m.mon::date <= pl.end_month);
    v_sure := v_sure + v_in_sure + v_in_plan - v_out_ap - v_out_req - v_out_plan;
    v_maybe := v_maybe + v_in_sure + v_in_maybe + v_in_plan - v_out_ap - v_out_req - v_out_plan;
    if v_lowest is null or v_sure < v_lowest then v_lowest := v_sure; v_lowest_w := ws; end if;
    if v_below is null and v_sure < v_min then v_below := ws; end if;
    v_weeks := v_weeks || jsonb_build_object('weekStart', ws, 'inSure', v_in_sure, 'inMaybe', v_in_maybe, 'inPlan', v_in_plan, 'outAp', v_out_ap,
      'outRequests', v_out_req, 'outPlan', v_out_plan, 'balanceSure', v_sure, 'balanceMaybe', v_maybe);
  end loop;
  return jsonb_build_object('start', v_start, 'minBalance', v_min, 'weeks', v_weeks, 'lowest', v_lowest, 'lowestWeek', v_lowest_w, 'belowMinWeek', v_below,
    'known', not exists (select 1 from public.cash_funds f where f.is_active
      and not exists (select 1 from public.finance_cash_openings o where o.account_id = f.id and o.status = 'confirmed')),
    'accounts', (select count(*) from public.cash_funds where is_active));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Đọc
-- ---------------------------------------------------------------------------
create function public.get_finance_cash_accounts_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'bankName', f.bank_name, 'accountNo', f.account_no,
      'balance', app_private.finance_cash_balance(f.id), 'openingConfirmed', exists (select 1 from public.finance_cash_openings o where o.account_id = f.id and o.status = 'confirmed'))
      order by f.sort_order, f.kind, f.name)
    from public.cash_funds f where f.is_active), '[]'::jsonb);
end $$;

create function public.get_finance_cash_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_actor uuid := public.current_app_user_id(); v_confirm boolean := app_private.finance_can('confirm');
  v_month date := coalesce(nullif(p_filter->>'month', '')::date, date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date)::date);
  v_account uuid := nullif(p_filter->>'accountId', '')::uuid;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('today', v_today, 'can', app_private.finance_can_flags(), 'currentUserId', v_actor, 'month', v_month,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'forecast', app_private.finance_cash_forecast(),
    'flows30', (select jsonb_build_object(
        'in', coalesce(sum(case when e.reversal_of is null then e.amount else -e.amount end) filter (where (e.reversal_of is null) = (e.direction = 'in')), 0),
        'out', coalesce(sum(case when e.reversal_of is null then e.amount else -e.amount end) filter (where (e.reversal_of is null) = (e.direction = 'out')), 0))
      from public.finance_cash_entries e where e.entry_date > v_today - 30 and e.source_type <> 'cash_transfer'),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'kind', f.kind, 'bankName', f.bank_name, 'accountNo', f.account_no,
        'projectId', f.project_id, 'projectCode', (select code from public.projects p where p.id = f.project_id), 'holderName', f.holder_name, 'note', f.note,
        'active', f.is_active, 'balance', app_private.finance_cash_balance(f.id),
        'opening', (select jsonb_build_object('id', o.id, 'status', o.status, 'balance', o.balance, 'cutoverDate', o.cutover_date, 'note', o.note, 'attachments', o.attachments,
            'createdBy', o.created_by, 'createdByName', app_private.finance_user_name(o.created_by), 'decidedByName', app_private.finance_user_name(o.decided_by),
            'decidedAt', o.decided_at, 'decisionNote', o.decision_note, 'canDecide', o.status = 'submitted' and v_confirm and o.created_by is distinct from v_actor)
          from public.finance_cash_openings o where o.account_id = f.id order by (o.status in ('submitted', 'confirmed')) desc, o.created_at desc limit 1),
        'lastRecon', (select jsonb_build_object('id', r.id, 'month', r.period_month, 'status', r.status, 'bookBalance', r.book_balance, 'statementBalance', r.statement_balance,
            'difference', r.difference, 'explanation', r.explanation, 'attachments', r.attachments, 'createdBy', r.created_by,
            'createdByName', app_private.finance_user_name(r.created_by), 'decidedByName', app_private.finance_user_name(r.decided_by), 'decisionNote', r.decision_note,
            'canDecide', r.status = 'submitted' and v_confirm and r.created_by is distinct from v_actor)
          from public.finance_cash_reconciliations r where r.account_id = f.id order by r.period_month desc, r.created_at desc limit 1),
        'lockedThrough', (select (max(r.period_month) + interval '1 month' - interval '1 day')::date from public.finance_cash_reconciliations r where r.account_id = f.id and r.status = 'confirmed'))
        order by f.is_active desc, f.sort_order, f.kind, f.name)
      from public.cash_funds f), '[]'::jsonb),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.entry_date, 'accountId', e.account_id, 'accountName', f.name, 'direction', e.direction,
        'amount', e.amount, 'sourceType', e.source_type, 'sourceId', e.source_id, 'code', e.code, 'description', e.description, 'counterparty', e.counterparty,
        'projectCode', (select code from public.projects p where p.id = e.project_id), 'reversalOf', e.reversal_of,
        'reversed', exists (select 1 from public.finance_cash_entries y where y.reversal_of = e.id), 'createdByName', app_private.finance_user_name(e.created_by))
        order by e.entry_date desc, e.created_at desc)
      from public.finance_cash_entries e join public.cash_funds f on f.id = e.account_id
      where e.entry_date >= v_month and e.entry_date < (v_month + interval '1 month')::date and (v_account is null or e.account_id = v_account)), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'code', m.code, 'kind', m.kind, 'category', m.category, 'fromAccountId', m.from_account_id,
        'fromName', (select name from public.cash_funds where id = m.from_account_id), 'toAccountId', m.to_account_id, 'toName', (select name from public.cash_funds where id = m.to_account_id),
        'amount', m.amount, 'date', m.movement_date, 'documentRef', m.document_ref, 'counterparty', m.counterparty, 'projectCode', (select code from public.projects p where p.id = m.project_id),
        'description', m.description, 'attachments', m.attachments, 'status', m.status, 'rowVersion', m.row_version, 'createdBy', m.created_by,
        'createdByName', app_private.finance_user_name(m.created_by), 'decidedByName', app_private.finance_user_name(m.decided_by), 'decisionNote', m.decision_note,
        'reverseReason', m.reverse_reason, 'canDecide', m.status = 'submitted' and v_confirm and m.created_by is distinct from v_actor,
        'canWithdraw', m.status = 'submitted' and m.created_by = v_actor, 'canReverse', m.status = 'confirmed' and v_confirm) order by m.created_at desc)
      from public.finance_cash_movements m where m.status = 'submitted' or m.created_at > now() - interval '45 days'), '[]'::jsonb),
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'direction', pl.direction, 'category', pl.category, 'amount', pl.amount,
        'dayOfMonth', pl.day_of_month, 'accountId', pl.account_id, 'startMonth', pl.start_month, 'endMonth', pl.end_month, 'active', pl.is_active) order by pl.is_active desc, pl.day_of_month)
      from public.finance_cash_plans pl), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code) order by p.code)
      from public.projects p where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')), '[]'::jsonb),
    'pending', jsonb_build_object(
      'openings', (select count(*) from public.finance_cash_openings where status = 'submitted'),
      'reconciliations', (select count(*) from public.finance_cash_reconciliations where status = 'submitted'),
      'movements', (select count(*) from public.finance_cash_movements where status = 'submitted'),
      'waitingMe', case when v_confirm then (select count(*) from public.finance_cash_openings where status = 'submitted' and created_by is distinct from v_actor)
        + (select count(*) from public.finance_cash_reconciliations where status = 'submitted' and created_by is distinct from v_actor)
        + (select count(*) from public.finance_cash_movements where status = 'submitted' and created_by is distinct from v_actor) else 0 end,
      'accountsWithoutOpening', (select count(*) from public.cash_funds f where f.is_active and not exists (select 1 from public.finance_cash_openings o
        where o.account_id = f.id and o.status in ('submitted', 'confirmed')))));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Tài khoản, đầu kỳ, đối chiếu sao kê, khoản định kỳ, tồn quỹ tối thiểu
-- ---------------------------------------------------------------------------
create function public.save_finance_cash_account_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_id uuid := nullif(p_input->>'id', '')::uuid; v_kind text := coalesce(nullif(p_input->>'kind', ''), 'bank');
  v_name text := nullif(btrim(p_input->>'name'), ''); v_active boolean := coalesce((p_input->>'isActive')::boolean, true); f public.cash_funds%rowtype;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_name is null or v_kind not in ('cash', 'bank', 'site') or (v_kind = 'bank' and nullif(btrim(p_input->>'accountNo'), '') is null)
    or (v_kind = 'site' and nullif(p_input->>'projectId', '') is null) then
    raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_INVALID'; end if;
  if v_id is null then
    insert into public.cash_funds (name, currency, opening_balance, description, is_active, kind, bank_name, account_no, project_id, holder_name, note, created_by)
    values (v_name, 'VND', 0, null, true, v_kind, nullif(btrim(p_input->>'bankName'), ''), nullif(btrim(p_input->>'accountNo'), ''),
      nullif(p_input->>'projectId', ''), nullif(btrim(p_input->>'holderName'), ''), nullif(btrim(p_input->>'note'), ''), v_actor)
    returning id into v_id;
  else
    select * into f from public.cash_funds where id = v_id for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_ACCOUNT_NOT_FOUND'; end if;
    if not v_active and (abs(app_private.finance_cash_balance(v_id)) > 0.5
      or exists (select 1 from public.finance_cash_movements m where m.status = 'submitted' and v_id in (m.from_account_id, m.to_account_id))) then
      raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_NOT_EMPTY'; end if;
    update public.cash_funds set name = v_name, kind = v_kind, bank_name = nullif(btrim(p_input->>'bankName'), ''), account_no = nullif(btrim(p_input->>'accountNo'), ''),
      project_id = nullif(p_input->>'projectId', ''), holder_name = nullif(btrim(p_input->>'holderName'), ''), note = nullif(btrim(p_input->>'note'), ''),
      is_active = v_active, updated_at = now() where id = v_id;
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('cash_account', v_id::text, case when p_input->>'id' is null then 'cash_account_create' else 'cash_account_update' end, v_actor,
    jsonb_build_object('name', v_name, 'kind', v_kind, 'accountNo', p_input->>'accountNo', 'active', v_active));
  return jsonb_build_object('id', v_id);
end $$;

create function public.save_finance_cash_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_account uuid := (p_input->>'accountId')::uuid; v_bal numeric := round(nullif(p_input->>'balance', '')::numeric, 2); v_id uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  perform app_private.finance_cash_require_account(v_account);
  if v_bal is null then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.finance_cash_openings where account_id = v_account and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_OPENING_EXISTS'; end if;
  insert into public.finance_cash_openings (account_id, cutover_date, balance, note, attachments, created_by)
  values (v_account, (select ap_cutover_date from public.finance_settings where id = 1), v_bal, nullif(btrim(p_input->>'note'), ''), p_input->'attachments', v_actor)
  returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload) values ('cash_opening', v_id::text, 'cash_opening_submit', v_actor, jsonb_build_object('accountId', v_account, 'balance', v_bal));
  perform app_private.finance_notify_admins('Số dư đầu kỳ tài khoản tiền chờ chốt', (select name from public.cash_funds where id = v_account) || ': ' || to_char(v_bal, 'FM999G999G999G990') || ' đ', v_actor);
  return jsonb_build_object('id', v_id);
end $$;

create function public.decide_finance_cash_opening_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), ''); o public.finance_cash_openings%rowtype;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into o from public.finance_cash_openings where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_OPENING_NOT_FOUND'; end if;
  if v_action in ('confirm', 'reject') then
    if o.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if v_actor = o.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_cash_openings set status = case v_action when 'confirm' then 'confirmed' else 'rejected' end, decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = o.id;
  elsif v_action = 'cancel' then
    if o.status <> 'confirmed' or v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_OPENING_STATE'; end if;
    if exists (select 1 from public.finance_cash_reconciliations r where r.account_id = o.account_id and r.status = 'confirmed') then
      raise exception using errcode = '22023', message = 'FINANCE_CASH_PERIOD_LOCKED'; end if;
    update public.finance_cash_openings set status = 'cancelled', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = o.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('cash_opening', o.id::text, 'cash_opening_' || v_action, v_actor, v_reason, jsonb_build_object('accountId', o.account_id, 'balance', o.balance));
  return jsonb_build_object('id', o.id, 'action', v_action);
end $$;

create function public.save_finance_cash_reconciliation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_account uuid := (p_input->>'accountId')::uuid; v_month date := date_trunc('month', nullif(p_input->>'month', '')::date)::date;
  v_stmt numeric := round(nullif(p_input->>'statementBalance', '')::numeric, 2); v_book numeric; v_id uuid; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  perform app_private.finance_cash_require_account(v_account);
  if v_month is null or v_stmt is null or (v_month + interval '1 month')::date > v_today + 1 then raise exception using errcode = '22023', message = 'FINANCE_RECON_INVALID'; end if;
  if not exists (select 1 from public.finance_cash_openings where account_id = v_account and status = 'confirmed') then
    raise exception using errcode = '22023', message = 'FINANCE_CASH_OPENING_REQUIRED'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  v_book := app_private.finance_cash_balance(v_account, (v_month + interval '1 month' - interval '1 day')::date);
  if abs(v_book - v_stmt) > 0.5 and nullif(btrim(p_input->>'explanation'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_RECON_EXPLAIN'; end if;
  if exists (select 1 from public.finance_cash_reconciliations where account_id = v_account and period_month = v_month and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_RECON_EXISTS'; end if;
  insert into public.finance_cash_reconciliations (account_id, period_month, book_balance, statement_balance, explanation, attachments, created_by)
  values (v_account, v_month, v_book, v_stmt, nullif(btrim(p_input->>'explanation'), ''), p_input->'attachments', v_actor) returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('cash_reconciliation', v_id::text, 'cash_recon_submit', v_actor, jsonb_build_object('accountId', v_account, 'month', v_month, 'book', v_book, 'statement', v_stmt));
  return jsonb_build_object('id', v_id, 'bookBalance', v_book, 'difference', v_book - v_stmt);
end $$;

create function public.decide_finance_cash_reconciliation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), ''); r public.finance_cash_reconciliations%rowtype;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into r from public.finance_cash_reconciliations where id = (p_input->>'id')::uuid for update;
  if not found or r.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_RECON_STATE'; end if;
  if v_actor = r.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
  if v_action = 'confirm' then
    if abs(app_private.finance_cash_balance(r.account_id, (r.period_month + interval '1 month' - interval '1 day')::date) - r.book_balance) > 0.5 then
      raise exception using errcode = '22023', message = 'FINANCE_RECON_STALE'; end if;
    update public.finance_cash_reconciliations set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = r.id;
  elsif v_action = 'reject' then
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_cash_reconciliations set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = r.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('cash_reconciliation', r.id::text, 'cash_recon_' || v_action, v_actor, v_reason, jsonb_build_object('accountId', r.account_id, 'month', r.period_month, 'difference', r.difference));
  return jsonb_build_object('id', r.id, 'action', v_action);
end $$;

create function public.save_finance_cash_plan_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_id uuid := nullif(p_input->>'id', '')::uuid; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_day integer := nullif(p_input->>'dayOfMonth', '')::integer; v_start date := date_trunc('month', coalesce(nullif(p_input->>'startMonth', '')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date))::date;
  v_end date := date_trunc('month', nullif(p_input->>'endMonth', '')::date)::date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if nullif(btrim(p_input->>'name'), '') is null or v_amount is null or v_amount <= 0 or v_day is null or v_day not between 1 and 28
    or coalesce(p_input->>'direction', '') not in ('in', 'out') or (v_end is not null and v_end < v_start) then
    raise exception using errcode = '22023', message = 'FINANCE_CASH_PLAN_INVALID'; end if;
  if v_id is null then
    insert into public.finance_cash_plans (name, direction, category, amount, day_of_month, account_id, start_month, end_month, is_active, created_by)
    values (btrim(p_input->>'name'), p_input->>'direction', coalesce(nullif(p_input->>'category', ''), 'other'), v_amount, v_day, nullif(p_input->>'accountId', '')::uuid,
      v_start, v_end, coalesce((p_input->>'active')::boolean, true), v_actor) returning id into v_id;
  else
    update public.finance_cash_plans set name = btrim(p_input->>'name'), direction = p_input->>'direction', category = coalesce(nullif(p_input->>'category', ''), 'other'),
      amount = v_amount, day_of_month = v_day, account_id = nullif(p_input->>'accountId', '')::uuid, start_month = v_start, end_month = v_end,
      is_active = coalesce((p_input->>'active')::boolean, true), updated_at = now() where id = v_id;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_PLAN_INVALID'; end if;
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('cash_plan', v_id::text, 'cash_plan_save', v_actor, jsonb_build_object('name', p_input->>'name', 'amount', v_amount, 'day', v_day, 'active', p_input->'active'));
  return jsonb_build_object('id', v_id);
end $$;

create function public.save_finance_cash_settings_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_min numeric := round(nullif(p_input->>'minBalance', '')::numeric, 2); v_set public.finance_settings%rowtype;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_min is null or v_min < 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if nullif(btrim(p_input->>'reason'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_set from public.finance_settings where id = 1 for update;
  if v_set.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.finance_settings set cash_min_balance = v_min, row_version = row_version + 1, updated_by = v_actor, updated_at = now() where id = 1;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after)
  values ('settings', '1', 'cash_settings_save', v_actor, btrim(p_input->>'reason'), jsonb_build_object('minBalance', v_set.cash_min_balance), jsonb_build_object('minBalance', v_min));
  return jsonb_build_object('minBalance', v_min);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Thu khác, chuyển tiền (người lập ≠ người xác nhận)
-- ---------------------------------------------------------------------------
create function public.save_finance_cash_movement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_kind text := p_input->>'kind'; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_date date := nullif(p_input->>'date', '')::date; v_from uuid := nullif(p_input->>'fromAccountId', '')::uuid; v_to uuid := nullif(p_input->>'toAccountId', '')::uuid;
  v_id uuid; v_code text; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_kind not in ('receipt', 'transfer') then raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_date is null or v_date > v_today or v_date < (select ap_cutover_date from public.finance_settings where id = 1) then
    raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  perform app_private.finance_cash_require_account(v_to);
  if v_kind = 'transfer' then
    perform app_private.finance_cash_require_account(v_from);
    if v_from = v_to then raise exception using errcode = '22023', message = 'FINANCE_CASH_TRANSFER_SAME'; end if;
  else v_from := null; end if;
  if nullif(btrim(p_input->>'description'), '') is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_kind = 'receipt' and (jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0) then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  v_code := case v_kind when 'receipt' then 'PTK-' else 'CT-' end || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_cash_movement_seq')::text, 3, '0');
  insert into public.finance_cash_movements (code, kind, category, from_account_id, to_account_id, amount, movement_date, document_ref, counterparty, project_id, description, attachments, created_by)
  values (v_code, v_kind, coalesce(nullif(p_input->>'category', ''), case v_kind when 'transfer' then 'transfer' else 'other' end), v_from, v_to, v_amount, v_date,
    nullif(btrim(p_input->>'documentRef'), ''), nullif(btrim(p_input->>'counterparty'), ''), nullif(p_input->>'projectId', ''), btrim(p_input->>'description'),
    coalesce(p_input->'attachments', '[]'::jsonb), v_actor) returning id into v_id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('cash_movement', v_id::text, 'cash_' || v_kind || '_submit', v_actor, jsonb_build_object('code', v_code, 'amount', v_amount, 'from', v_from, 'to', v_to));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

create function public.decide_finance_cash_movement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), ''); m public.finance_cash_movements%rowtype;
begin
  select * into m from public.finance_cash_movements where id = (p_input->>'id')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_MOVEMENT_STATE'; end if;
  if m.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_action = 'withdraw' then
    if m.status <> 'submitted' or m.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.finance_cash_movements set status = 'withdrawn', decided_by = v_actor, decided_at = now(), row_version = row_version + 1 where id = m.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if m.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_CASH_MOVEMENT_STATE'; end if;
    if v_actor = m.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.finance_cash_movements set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = m.id;
    else
      if m.kind = 'transfer' then
        perform app_private.finance_cash_entry(m.from_account_id, m.movement_date, 'out', m.amount, 'cash_transfer', m.id::text, m.code,
          'Chuyển tiền sang ' || (select name from public.cash_funds where id = m.to_account_id) || ' · ' || m.description, null, m.project_id, v_actor);
        perform app_private.finance_cash_entry(m.to_account_id, m.movement_date, 'in', m.amount, 'cash_transfer', m.id::text, m.code,
          'Nhận tiền từ ' || (select name from public.cash_funds where id = m.from_account_id) || ' · ' || m.description, null, m.project_id, v_actor);
      else
        perform app_private.finance_cash_entry(m.to_account_id, m.movement_date, 'in', m.amount, 'cash_movement', m.id::text, m.code, m.description, m.counterparty, m.project_id, v_actor);
      end if;
      update public.finance_cash_movements set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = m.id;
    end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if m.status <> 'confirmed' or v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_CASH_MOVEMENT_STATE'; end if;
    perform app_private.finance_cash_reverse_source(case m.kind when 'transfer' then 'cash_transfer' else 'cash_movement' end, m.id::text, v_reason, v_actor);
    update public.finance_cash_movements set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason, row_version = row_version + 1 where id = m.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('cash_movement', m.id::text, 'cash_' || m.kind || '_' || v_action, v_actor, v_reason, jsonb_build_object('code', m.code, 'amount', m.amount));
  return jsonb_build_object('id', m.id, 'action', v_action);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Phiếu chi khác = đề nghị chi loại 'expense' (ma trận + 3 người)
-- ---------------------------------------------------------------------------
create function public.preview_finance_expense_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('route', app_private.finance_payment_route(null, greatest(coalesce(round(nullif(p_input->>'amount', '')::numeric, 2), 0), 0.01), '{}'::uuid[],
    public.current_app_user_id(), nullif(p_input->>'requestId', '')::uuid), 'canRecord', app_private.finance_can('record'));
end $$;

create function public.save_finance_expense_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_date date := nullif(p_input->>'plannedDate', '')::date; v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer');
  v_note text := nullif(btrim(p_input->>'note'), ''); v_party text := nullif(btrim(p_input->>'counterparty'), ''); v_cat text := nullif(p_input->>'category', '');
  v_project text := nullif(p_input->>'projectId', ''); v_cost text := nullif(p_input->>'costCategory', ''); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_route jsonb; v_id uuid; v_code text; v_submission integer := 1;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_method not in ('bank_transfer', 'cash') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if v_date is null or v_date < v_today - 30 then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_note is null or v_party is null or v_cat is null then raise exception using errcode = '22023', message = 'FINANCE_EXPENSE_INVALID'; end if;
  if v_project is not null and not exists (select 1 from public.projects where id = v_project) then raise exception using errcode = '22023', message = 'FINANCE_EXPENSE_INVALID'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.kind <> 'expense' or v_req.status <> 'returned' or v_req.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;
  v_route := app_private.finance_payment_route(null, v_amount, '{}'::uuid[], v_actor, v_req.id);
  if v_route->>'problemStep' is not null then raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;
  if v_req.id is null then
    v_code := 'CK-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_expense_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, planned_date, amount, note, status, matrix_version_id, threshold_amount,
      prior_requests, route, current_step, created_by, kind, project_id, expense_category, cost_category)
    values (v_code, null, v_party, v_method, v_date, v_amount, v_note, 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor, 'expense', v_project, v_cat, case when v_project is not null then coalesce(v_cost, 'other') end)
    returning id into v_id;
  else
    v_id := v_req.id; v_code := v_req.code;
    update public.finance_payment_requests set supplier_name = v_party, method = v_method, planned_date = v_date, amount = v_amount, note = v_note, status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null, project_id = v_project,
      expense_category = v_cat, cost_category = case when v_project is not null then coalesce(v_cost, 'other') end, updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập phiếu chi khác và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_amount, 'category', v_cat, 'tierNo', v_route->'tierNo'));
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Phiếu chi khác chờ bạn duyệt', v_code || ' · ' || v_party || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('payment_request', v_id::text, 'expense_submit', v_actor, jsonb_build_object('code', v_code, 'amount', v_amount, 'category', v_cat, 'projectId', v_project));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_amount, 'route', v_route);
end $$;

-- Xác nhận đã chi phiếu chi khác: sổ thu chi đã ghi ở hàm xác nhận chung; gắn dự án thì ghi chi phí dự án theo khoản mục.
create function app_private.finance_confirm_expense(p_request uuid, p_date date, p_ref text, p_attachments jsonb, p_note text, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.finance_payment_requests%rowtype; v_finance text; v_ref text;
begin
  select * into v_req from public.finance_payment_requests where id = p_request;
  if v_req.project_id is not null then
    if app_private.finance_period_is_locked(v_req.project_id, null, 'VND', p_date) then raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
    select f.id into v_finance from public.project_finances f where f.project_id = v_req.project_id order by f.id limit 1;
    v_ref := 'finance_expense:' || v_req.id::text;
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, cost_classification_status)
    values ('finance-expense-' || v_req.id::text, coalesce(v_finance, ''), '', v_req.project_id, v_finance, null, 'expense', coalesce(v_req.cost_category, 'other'), v_req.amount,
      v_req.code || ' · ' || v_req.note, p_date::text, 'workflow', v_ref, v_ref, coalesce(p_attachments, '[]'::jsonb), p_actor::text, now(), v_req.supplier_name, 'manual');
  end if;
  update public.finance_payment_requests set status = 'paid', updated_at = now(), row_version = row_version + 1,
    paid = jsonb_build_object('paymentDate', p_date, 'documentRef', p_ref, 'attachments', p_attachments, 'batches', '[]'::jsonb,
      'by', p_actor, 'byName', app_private.finance_user_name(p_actor), 'at', now(), 'note', p_note)
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_req.id, v_req.submission_no, 'Xác nhận đã chi ' || p_ref, 'paid', p_actor, jsonb_build_object('paymentDate', p_date));
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('payment_request', v_req.id::text, 'expense_paid', p_actor, jsonb_build_object('code', v_req.code, 'amount', v_req.amount, 'documentRef', p_ref));
  perform app_private.finance_notify(array[v_req.created_by], 'Phiếu chi khác đã chi', v_req.code || ' · ' || p_ref, v_req.id, p_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'paid');
end $$;

revoke all on function app_private.trg_finance_cash_entry_guard(), app_private.guard_cash_fund_direct_write(),
  app_private.finance_cash_entry(uuid, date, text, numeric, text, text, text, text, text, text, uuid), app_private.finance_cash_reverse_source(text, text, text, uuid),
  app_private.finance_cash_balance(uuid, date), app_private.finance_cash_require_account(uuid), app_private.finance_cash_forecast(),
  app_private.finance_confirm_expense(uuid, date, text, jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.get_finance_cash_accounts_v1(), public.get_finance_cash_v1(jsonb), public.save_finance_cash_account_v1(jsonb),
  public.save_finance_cash_opening_v1(jsonb), public.decide_finance_cash_opening_v1(jsonb), public.save_finance_cash_reconciliation_v1(jsonb),
  public.decide_finance_cash_reconciliation_v1(jsonb), public.save_finance_cash_plan_v1(jsonb), public.save_finance_cash_settings_v1(jsonb),
  public.save_finance_cash_movement_v1(jsonb), public.decide_finance_cash_movement_v1(jsonb), public.preview_finance_expense_v1(jsonb),
  public.save_finance_expense_request_v1(jsonb) from public, anon;
grant execute on function public.get_finance_cash_accounts_v1(), public.get_finance_cash_v1(jsonb), public.save_finance_cash_account_v1(jsonb),
  public.save_finance_cash_opening_v1(jsonb), public.decide_finance_cash_opening_v1(jsonb), public.save_finance_cash_reconciliation_v1(jsonb),
  public.decide_finance_cash_reconciliation_v1(jsonb), public.save_finance_cash_plan_v1(jsonb), public.save_finance_cash_settings_v1(jsonb),
  public.save_finance_cash_movement_v1(jsonb), public.decide_finance_cash_movement_v1(jsonb), public.preview_finance_expense_v1(jsonb),
  public.save_finance_expense_request_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Vá hàm đang chạy: chọn tài khoản khi xác nhận chi / thu, đảo ghi đảo sổ, danh sách đề nghị (chi khác), Quản trị, Tổng quan
-- ---------------------------------------------------------------------------

create or replace function public.confirm_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype;
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), '');
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_lines jsonb; g record; v_bid uuid; v_batches jsonb := '[]'::jsonb;
  v_last_approver uuid; v_cash uuid;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'approved' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  if v_actor = v_req.created_by or exists (select 1 from public.finance_payment_request_steps s where s.request_id = v_req.id
      and s.submission_no = v_req.submission_no and s.action = 'approve' and s.actor_id = v_actor)
    or v_actor = any(select unnest(app_private.finance_doc_handlers(l.payable_document_id)) from public.finance_payment_request_lines l where l.request_id = v_req.id) then
    raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_REQUIRED'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.supplier_payment_batches where supplier_id = v_req.supplier_id and document_ref = v_ref and status in ('submitted', 'paid')) then
    raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_DUPLICATE'; end if;
  select actor_id into v_last_approver from public.finance_payment_request_steps where request_id = v_req.id and submission_no = v_req.submission_no
    and action = 'approve' order by created_at desc limit 1;
  -- Thu chi & quỹ: chọn tài khoản tiền đã chi → sổ thu chi.
  v_cash := app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid);
  perform app_private.finance_cash_entry(v_cash, v_date, 'out', v_req.amount, 'payment_request', v_req.id::text, v_req.code || ' · ' || v_ref,
    case v_req.kind when 'advance' then 'Tạm ứng NCC ' || v_req.supplier_name when 'expense' then 'Chi khác: ' || coalesce(v_req.note, '') else 'Chi NCC ' || v_req.supplier_name end,
    v_req.supplier_name, v_req.project_id, v_actor);
  if v_req.kind = 'expense' then
    return app_private.finance_confirm_expense(v_req.id, v_date, v_ref, p_input->'attachments', nullif(btrim(p_input->>'note'), ''), v_actor);
  end if;
  if v_req.kind = 'advance' then
    return app_private.finance_confirm_advance(v_req.id, v_date, v_ref, p_input->'attachments', nullif(btrim(p_input->>'note'), ''), v_actor, v_last_approver);
  end if;

  -- Kiểm lại phần còn nợ tại lúc chi (có thể đã chi ngoài trong lúc chờ).
  select jsonb_agg(jsonb_build_object('documentId', payable_document_id, 'amount', amount)) into v_lines from public.finance_payment_request_lines where request_id = v_req.id;
  create temp table if not exists pg_temp.fin_pay_lines (doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric,
    source_type text, source_id text, recognized numeric, paid numeric) on commit drop;
  truncate pg_temp.fin_pay_lines;
  insert into pg_temp.fin_pay_lines select * from app_private.finance_check_request_lines(v_req.supplier_id, v_lines, v_req.id);

  perform set_config('app.finance_context', 'on', true);
  for g in select project_id, site_id, sum(amount) total, sum(recognized) recognized from pg_temp.fin_pay_lines group by project_id, site_id loop
    v_bid := gen_random_uuid();
    insert into public.supplier_payment_batches (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot, payment_date, payment_method,
      bank_account_snapshot, document_ref, total_recognized_snapshot, payment_amount, currency, allocation_mode, status, attachments, metadata, created_by, approved_by, approved_at, note)
    values (v_bid, 'PC-' || to_char(v_today, 'YYMMDD') || '-' || upper(substr(replace(v_bid::text, '-', ''), 1, 5)), g.project_id, g.site_id, v_req.supplier_id,
      v_req.supplier_name, v_date, v_req.method, v_req.bank_snapshot->>'account', v_ref, g.recognized, g.total, 'VND', 'manual', 'submitted', p_input->'attachments',
      jsonb_build_object('kind', 'payment_request', 'requestId', v_req.id, 'requestCode', v_req.code)
        || case when g.project_id is null and g.site_id is null then jsonb_build_object('scope', 'company') else '{}'::jsonb end,
      v_req.created_by, v_last_approver, now(), nullif(btrim(p_input->>'note'), ''));
    insert into public.supplier_payment_allocations (payment_batch_id, payable_document_id, source_type, source_id, document_no_snapshot,
      recognized_amount_snapshot, paid_before_snapshot, outstanding_before_snapshot, allocated_amount, allocation_mode, note)
    select v_bid, doc_id, source_type, source_id, document_no, recognized, paid, outstanding, amount, 'manual', v_req.code
    from pg_temp.fin_pay_lines l where l.project_id is not distinct from g.project_id and l.site_id is not distinct from g.site_id;
    perform app_private.post_supplier_payment_batch(v_bid, v_actor);
    v_batches := v_batches || jsonb_build_object('batchId', v_bid, 'projectId', g.project_id, 'amount', g.total);
  end loop;
  perform set_config('app.finance_context', 'off', true);

  update public.finance_payment_requests set status = 'paid', updated_at = now(), row_version = row_version + 1,
    paid = jsonb_build_object('paymentDate', v_date, 'documentRef', v_ref, 'attachments', p_input->'attachments', 'batches', v_batches,
      'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now(), 'note', nullif(btrim(p_input->>'note'), ''))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_req.id, v_req.submission_no, 'Xác nhận đã chi ' || v_ref, 'paid', v_actor, jsonb_build_object('batches', v_batches, 'paymentDate', v_date));
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_paid', v_actor,
    jsonb_build_object('code', v_req.code, 'amount', v_req.amount, 'documentRef', v_ref, 'batches', v_batches));
  perform app_private.finance_notify(array[v_req.created_by], 'Đề nghị chi đã chi', v_req.code || ' · ' || v_ref, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'paid', 'batches', v_batches);
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $function$;

create or replace function public.reverse_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), ''); b jsonb;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
  if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_req.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_REQUEST_STATE'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if v_req.kind = 'advance' then perform app_private.finance_assert_advance_reversible(v_req.id); end if;
  perform app_private.finance_cash_reverse_source('payment_request', v_req.id::text, v_reason, v_actor);
  if v_req.kind = 'expense' then
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, cost_classification_status)
    select 'finance-expense-reversal-' || v_req.id::text, t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
      'expense', t.category, -t.amount, 'Đảo ' || t.description || ' — ' || v_reason, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'workflow',
      t.source_ref || ':reversal', t.source_ref || ':reversal', '[]'::jsonb, v_actor::text, now(), t.counterparty_name, 'manual'
    from public.project_transactions t where t.source_ref = 'finance_expense:' || v_req.id::text;
  end if;
  perform set_config('app.finance_context', 'on', true);
  for b in select value from jsonb_array_elements(v_req.paid->'batches') loop
    perform app_private.reverse_supplier_payment_batch((b->>'batchId')::uuid, v_actor);
    update public.supplier_payment_batches set metadata = metadata || jsonb_build_object('g7ReversalReason', v_reason) where id = (b->>'batchId')::uuid;
  end loop;
  perform set_config('app.finance_context', 'off', true);
  update public.finance_payment_requests set status = 'reversed', updated_at = now(), row_version = row_version + 1,
    paid = paid || jsonb_build_object('reversal', jsonb_build_object('reason', v_reason, 'by', v_actor, 'byName', app_private.finance_user_name(v_actor), 'at', now()))
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, reason)
  values (v_req.id, v_req.submission_no, 'Đảo phiếu chi', 'reverse', v_actor, v_reason);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'payment_request_reverse', v_actor, v_reason, jsonb_build_object('code', v_req.code, 'amount', v_req.amount));
  perform app_private.finance_notify(array[v_req.created_by], 'Phiếu chi đã bị đảo', v_req.code || ': ' || v_reason, v_req.id, v_actor);
  return jsonb_build_object('requestId', v_req.id, 'status', 'reversed');
exception when others then
  perform set_config('app.finance_context', 'off', true);
  raise;
end $function$;

create or replace function public.save_finance_external_payment_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_supplier text := p_input->>'supplierId'; v_project text := p_input->>'projectId';
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), '');
  v_method text := coalesce(nullif(p_input->>'method', ''), 'bank_transfer');
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_id uuid := gen_random_uuid(); v_total numeric := 0; v_recognized numeric := 0; v_site text; v_name text;
  a jsonb; d record; v_amount numeric; v_cash uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_REQUIRED'; end if;
  -- Từ mốc 01/10: tiền đã ra khỏi tài khoản nào (sổ thu chi ghi khi người khác xác nhận). Trước mốc là chi đã ghi ở MISA.
  if v_date >= (select ap_cutover_date from public.finance_settings where id = 1) then
    v_cash := app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid); end if;
  if v_method not in ('bank_transfer', 'cash', 'other') then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_METHOD_INVALID'; end if;
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if jsonb_typeof(p_input->'allocations') is distinct from 'array' or jsonb_array_length(p_input->'allocations') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATIONS_REQUIRED'; end if;
  if exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  if exists (select 1 from public.supplier_payment_batches where supplier_id = v_supplier and document_ref = v_ref and status in ('submitted', 'paid')) then
    raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_DUPLICATE'; end if;

  create temp table if not exists pg_temp.fin_alloc (doc_id uuid, amount numeric, doc_no text, recognized numeric, paid numeric, outstanding numeric,
    source_type text, source_id text, site text) on commit drop;
  truncate pg_temp.fin_alloc;
  for a in select value from jsonb_array_elements(p_input->'allocations') loop
    v_amount := round(nullif(a->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    select r.* into d from app_private.finance_payable_rows() r where r.id = (a->>'documentId')::uuid;
    if not found or d.supplier_id is distinct from v_supplier or d.project_id is distinct from v_project then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if v_amount > d.outstanding - d.pending_external + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_OVER_OUTSTANDING'; end if;
    perform 1 from public.supplier_payable_documents where id = d.id for update;
    insert into pg_temp.fin_alloc values (d.id, v_amount, d.document_no, d.recognized, d.paid, d.outstanding, d.source_type, d.source_id, d.construction_site_id);
  end loop;
  if exists (select 1 from pg_temp.fin_alloc group by doc_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
  select sum(amount), sum(recognized), min(site) into v_total, v_recognized, v_site from pg_temp.fin_alloc;
  if app_private.finance_period_is_locked(v_project, v_site, 'VND', v_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
  select name into v_name from public.business_partners where id = v_supplier;

  insert into public.supplier_payment_batches (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
    payment_date, payment_method, document_ref, total_recognized_snapshot, payment_amount, currency, allocation_mode, status,
    attachments, metadata, created_by, note, cash_fund_id)
  values (v_id, 'CNB-' || to_char(v_today, 'YYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 5)), v_project, v_site,
    v_supplier, v_name, v_date, v_method, v_ref, v_recognized, v_total, 'VND', 'manual', 'submitted',
    p_input->'attachments', jsonb_build_object('external', true, 'kind', 'external_payment'), v_actor, nullif(btrim(p_input->>'note'), ''), v_cash);
  insert into public.supplier_payment_allocations (payment_batch_id, payable_document_id, source_type, source_id, document_no_snapshot,
    recognized_amount_snapshot, paid_before_snapshot, outstanding_before_snapshot, allocated_amount, allocation_mode, note)
  select v_id, doc_id, source_type, source_id, doc_no, recognized, paid, outstanding, amount, 'manual', 'Chi ngoài hệ thống' from pg_temp.fin_alloc;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('external_payment', v_id::text, v_supplier, 'external_payment_submit', v_actor,
    jsonb_build_object('amount', v_total, 'paymentDate', v_date, 'documentRef', v_ref, 'projectId', v_project,
      'documents', (select jsonb_agg(jsonb_build_object('documentNo', doc_no, 'amount', amount)) from pg_temp.fin_alloc)));
  return jsonb_build_object('paymentId', v_id, 'amount', v_total);
end $function$;

create or replace function public.decide_finance_external_payment_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_b public.supplier_payment_batches%rowtype;
begin
  select * into v_b from public.supplier_payment_batches where id = (p_input->>'paymentId')::uuid for update;
  if not found or not coalesce((v_b.metadata->>'external')::boolean, false) then
    raise exception using errcode = 'PT404', message = 'FINANCE_PAYMENT_NOT_FOUND'; end if;
  if v_b.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if v_action = 'withdraw' then
    if v_b.status <> 'submitted' or v_b.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.supplier_payment_batches set status = 'cancelled', metadata = metadata || jsonb_build_object('withdrawnAt', now()) where id = v_b.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_b.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_STATE'; end if;
    if v_b.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.supplier_payment_batches set status = 'cancelled',
        metadata = metadata || jsonb_build_object('rejection', jsonb_build_object('reason', v_reason, 'by', v_actor,
          'byName', app_private.finance_user_name(v_actor), 'at', now())) where id = v_b.id;
    else
      update public.supplier_payment_batches set approved_by = v_actor, approved_at = now() where id = v_b.id;
      perform set_config('app.finance_context', 'on', true);
      perform app_private.post_supplier_payment_batch(v_b.id, v_actor);
      perform set_config('app.finance_context', 'off', true);
      if v_b.cash_fund_id is not null then
        perform app_private.finance_cash_entry(v_b.cash_fund_id, v_b.payment_date, 'out', v_b.payment_amount, 'external_payment', v_b.id::text, v_b.code || ' · ' || v_b.document_ref,
          'Chi NCC ' || v_b.supplier_name_snapshot || ' (chi ngoài)', v_b.supplier_name_snapshot, v_b.project_id, v_actor);
      end if;
    end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if v_b.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    perform set_config('app.finance_context', 'on', true);
    perform app_private.reverse_supplier_payment_batch(v_b.id, v_actor);
    perform app_private.finance_cash_reverse_source('external_payment', v_b.id::text, v_reason, v_actor);
    perform set_config('app.finance_context', 'off', true);
    update public.supplier_payment_batches set metadata = metadata || jsonb_build_object('g7ReversalReason', v_reason) where id = v_b.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('external_payment', v_b.id::text, v_b.supplier_id, 'external_payment_' || v_action, v_actor, v_reason,
    jsonb_build_object('code', v_b.code, 'amount', v_b.payment_amount, 'documentRef', v_b.document_ref));
  select * into v_b from public.supplier_payment_batches where id = v_b.id;
  return jsonb_build_object('paymentId', v_b.id, 'status', v_b.status);
end $function$;

create or replace function public.save_finance_customer_receipt_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); c public.customer_contracts%rowtype; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_date date := nullif(p_input->>'receiptDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), ''); v_alloc numeric; v_id uuid; v_code text;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; a jsonb; v_cash uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into c from public.customer_contracts where id = p_input->>'contractId' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CONTRACT_NOT_FOUND'; end if;
  if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
  if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
  if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_REF_REQUIRED'; end if;
  v_cash := app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid);
  if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
  if exists (select 1 from public.finance_customer_receipts where contract_id = c.id and document_ref = v_ref and status in ('submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_REF_DUPLICATE'; end if;
  v_alloc := app_private.finance_check_receipt_allocations(c.id, p_input->'allocations', null);
  if v_alloc > v_amount + 0.005 then raise exception using errcode = '22023', message = 'FINANCE_RECEIPT_OVER_ALLOCATED'; end if;
  v_code := 'PT-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_customer_receipt_seq')::text, 3, '0');
  insert into public.finance_customer_receipts (code, contract_id, project_id, construction_site_id, customer_name, receipt_date, amount, document_ref, attachments, note, created_by, cash_account_id)
  values (v_code, c.id, c.project_id, c.construction_site_id, c.customer_name, v_date, v_amount, v_ref, p_input->'attachments', nullif(btrim(p_input->>'note'), ''), v_actor, v_cash)
  returning id into v_id;
  for a in select value from jsonb_array_elements(coalesce(p_input->'allocations', '[]'::jsonb)) loop
    insert into public.finance_customer_receipt_allocations (receipt_id, round_id, amount, created_by) values (v_id, (a->>'roundId')::uuid, round((a->>'amount')::numeric, 2), v_actor);
  end loop;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('customer_receipt', v_id::text, 'receipt_submit', v_actor, jsonb_build_object('contractId', c.id, 'code', v_code, 'amount', v_amount, 'documentRef', v_ref, 'allocated', v_alloc));
  perform app_private.finance_notify_receivable(app_private.finance_confirm_users(), 'Phiếu thu CĐT chờ xác nhận',
    v_code || ' · ' || c.customer_name || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', c.id, v_actor);
  return jsonb_build_object('id', v_id, 'code', v_code, 'unallocated', v_amount - v_alloc);
end $function$;

create or replace function public.decide_finance_customer_receipt_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      perform app_private.finance_cash_entry(app_private.finance_cash_require_account(rc.cash_account_id), rc.receipt_date, 'in', rc.amount, 'customer_receipt', rc.id::text,
        rc.code || ' · ' || rc.document_ref, 'Thu CĐT ' || rc.customer_name, rc.customer_name, rc.project_id, v_actor);
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
    perform app_private.finance_cash_reverse_source('customer_receipt', rc.id::text, v_reason, v_actor);
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
end $function$;

create or replace function public.save_finance_advance_adjustment_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_kind text := p_input->>'kind'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  r record; v_req public.finance_payment_requests%rowtype; v_po public.purchase_orders%rowtype; v_amount numeric; v_date date := nullif(p_input->>'paymentDate', '')::date;
  v_ref text := nullif(btrim(p_input->>'documentRef'), ''); v_id uuid; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_cash uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
  select * into r from app_private.finance_advance_rows() x where x.id = v_req.id;
  if not found or r.status <> 'paid' or r.remaining <= 0.004 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_STATE'; end if;
  if exists (select 1 from public.supplier_advance_adjustments where request_id = v_req.id and status = 'submitted') then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_ADJUSTMENT_PENDING'; end if;
  if v_kind = 'refund' then
    v_amount := round(nullif(p_input->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 or v_amount > r.remaining + 0.005 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER'; end if;
    if v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_DATE_INVALID'; end if;
    if v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_PAYMENT_REF_REQUIRED'; end if;
    v_cash := app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid);
    if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
      raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
    insert into public.supplier_advance_adjustments (request_id, kind, amount, payment_date, document_ref, attachments, reason, created_by, cash_account_id)
    values (v_req.id, 'refund', v_amount, v_date, v_ref, p_input->'attachments', v_reason, v_actor, v_cash) returning id into v_id;
  elsif v_kind = 'transfer' then
    if v_req.purchase_order_id is null then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TRANSFER_PO_ONLY'; end if;
    select * into v_po from public.purchase_orders where id = p_input->>'targetPurchaseOrderId';
    if not found or v_po.id = v_req.purchase_order_id or v_po.vendor_id is distinct from v_req.supplier_id or v_po.supplier_contract_id is not null
      or app_private.finance_scope_key(v_po.project_id, v_po.construction_site_id) <> app_private.finance_scope_key(v_req.project_id, v_req.construction_site_id) then
      raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TRANSFER_SCOPE'; end if;
    if v_po.status not in ('sent', 'confirmed', 'in_transit', 'partial') or v_po.archived_at is not null then
      raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_CLOSED'; end if;
    insert into public.supplier_advance_adjustments (request_id, kind, amount, target_purchase_order_id, source_purchase_order_id, reason, created_by)
    values (v_req.id, 'transfer', r.remaining, v_po.id, v_req.purchase_order_id, v_reason, v_actor) returning id into v_id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('advance', v_req.id::text, v_req.supplier_id, 'advance_' || v_kind || '_submit', v_actor, v_reason,
    jsonb_build_object('code', v_req.code, 'adjustmentId', v_id, 'amount', coalesce(v_amount, r.remaining), 'target', v_po.po_number, 'documentRef', v_ref));
  perform app_private.finance_notify(array(select u.id from public.users u where coalesce(u.is_active, true)
      and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.confirm'))),
    case v_kind when 'refund' then 'NCC hoàn tạm ứng — chờ xác nhận' else 'Chuyển tạm ứng sang đơn khác — chờ xác nhận' end,
    v_req.code || ' · ' || v_req.supplier_name, v_req.id, v_actor);
  return jsonb_build_object('adjustmentId', v_id);
end $function$;

create or replace function public.decide_finance_advance_adjustment_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  a public.supplier_advance_adjustments%rowtype; v_req public.finance_payment_requests%rowtype; r record; v_finance text; v_ref text; v_applied numeric;
begin
  select * into a from public.supplier_advance_adjustments where id = (p_input->>'adjustmentId')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ADJUSTMENT_STATE'; end if;
  select * into v_req from public.finance_payment_requests where id = a.request_id for update;
  if v_action = 'withdraw' then
    if a.status <> 'submitted' or a.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.supplier_advance_adjustments set status = 'withdrawn', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = a.id;
  elsif v_action in ('confirm', 'reject') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if a.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_ADJUSTMENT_STATE'; end if;
    if v_actor = a.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.supplier_advance_adjustments set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = a.id;
    else
      select * into r from app_private.finance_advance_rows() x where x.id = a.request_id;
      if r.status <> 'paid' then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_STATE'; end if;
      if a.kind = 'refund' then
        if a.amount > r.remaining + 0.005 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER'; end if;
        if app_private.finance_period_is_locked(v_req.project_id, v_req.construction_site_id, 'VND', a.payment_date) then
          raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
        -- Tiền NCC trả lại = dòng tiền ra âm cùng nhóm supplier_payment_batch:… (dòng tiền dự án giảm, không đụng chi phí).
        select f.id into v_finance from public.project_finances f
        where (v_req.project_id is not null and f.project_id = v_req.project_id) or (v_req.construction_site_id is not null and f.construction_site_id = v_req.construction_site_id)
        order by case when v_req.project_id is not null and f.project_id = v_req.project_id then 0 else 1 end, f.id limit 1;
        v_ref := 'supplier_payment_batch:' || r.batch_id::text || ':refund:' || a.id::text;
        insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
          type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id)
        values ('supplier-advance-refund-' || a.id::text, coalesce(v_finance, ''), coalesce(v_req.construction_site_id, ''), v_req.project_id, v_finance, v_req.construction_site_id,
          'expense', 'materials', -a.amount, 'NCC hoàn tạm ứng ' || v_req.supplier_name || ' - ' || v_req.code || ' · ' || a.document_ref, a.payment_date::text, 'workflow',
          v_ref, v_ref, a.attachments, v_actor::text, now(), v_req.supplier_name, v_req.supplier_id);
        perform app_private.finance_cash_entry(app_private.finance_cash_require_account(a.cash_account_id), a.payment_date, 'in', a.amount, 'advance_refund', a.id::text,
          v_req.code || ' · ' || a.document_ref, 'NCC hoàn tạm ứng ' || v_req.supplier_name, v_req.supplier_name, v_req.project_id, v_actor);
      else
        if exists (select 1 from public.purchase_orders po where po.id = a.target_purchase_order_id and (po.status not in ('sent', 'confirmed', 'in_transit', 'partial') or po.archived_at is not null)) then
          raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_CLOSED'; end if;
        update public.finance_payment_requests set purchase_order_id = a.target_purchase_order_id, updated_at = now(), row_version = row_version + 1 where id = v_req.id;
      end if;
      update public.supplier_advance_adjustments set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = a.id;
      if a.kind = 'transfer' then v_applied := app_private.finance_advance_auto_apply_request(v_req.id); end if;
    end if;
  elsif v_action = 'reverse' then
    -- Ghi nhầm phiếu thu hoàn ứng: đảo (dòng tiền dương bù lại), tạm ứng còn lại tăng trở lại.
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if a.status <> 'confirmed' or a.kind <> 'refund' then raise exception using errcode = '22023', message = 'FINANCE_ADJUSTMENT_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    select * into r from app_private.finance_advance_rows() x where x.id = a.request_id;
    v_ref := 'supplier_payment_batch:' || r.batch_id::text || ':refund:' || a.id::text;
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id)
    select 'supplier-advance-refund-reversal-' || a.id::text, t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
      'expense', 'materials', a.amount, 'Đảo phiếu thu hoàn tạm ứng ' || v_req.code || ' · ' || a.document_ref, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'workflow',
      v_ref || ':reversal', v_ref || ':reversal', '[]'::jsonb, v_actor::text, now(), t.counterparty_name, t.counterparty_partner_id
    from public.project_transactions t where t.source_ref = v_ref;
    perform app_private.finance_cash_reverse_source('advance_refund', a.id::text, v_reason, v_actor);
    update public.supplier_advance_adjustments set status = 'reversed', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = a.id;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('advance', v_req.id::text, v_req.supplier_id, 'advance_' || a.kind || '_' || v_action, v_actor, v_reason,
    jsonb_build_object('code', v_req.code, 'adjustmentId', a.id, 'amount', a.amount, 'targetPurchaseOrderId', a.target_purchase_order_id, 'offset', v_applied));
  if v_action <> 'withdraw' then
    perform app_private.finance_notify(array[a.created_by], case v_action when 'confirm' then 'Đã xác nhận' when 'reject' then 'Bị từ chối' else 'Đã đảo' end
      || case a.kind when 'refund' then ' phiếu thu hoàn tạm ứng' else ' chuyển tạm ứng' end, v_req.code || coalesce(': ' || v_reason, ''), v_req.id, v_actor);
  end if;
  return jsonb_build_object('adjustmentId', a.id, 'action', v_action, 'offset', v_applied);
end $function$;

create or replace function public.list_finance_payment_requests_v1(p_filter jsonb DEFAULT '{}'::jsonb)
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
          'contractId', r.supplier_contract_id, 'contractCode', (select c.code from public.supplier_contracts c where c.id = r.supplier_contract_id),
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

create or replace function public.get_finance_settings_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_set public.finance_settings%rowtype; v_version public.finance_approval_matrix_versions%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  select * into v_version from public.finance_approval_matrix_versions where is_current;
  return jsonb_build_object('can', app_private.finance_can_flags(),
    'settings', jsonb_build_object('defaultPaymentDays', v_set.default_payment_days, 'cutoverDate', v_set.ap_cutover_date,
      'rowVersion', v_set.row_version, 'updatedAt', v_set.updated_at, 'updatedByName', app_private.finance_user_name(v_set.updated_by),
      'advanceWarnPercent', v_set.advance_warn_percent, 'advanceExtraPercent', v_set.advance_extra_percent,
      'advanceExtraApproverIds', to_jsonb(v_set.advance_extra_approver_ids), 'advanceGraceDays', v_set.advance_repay_grace_days, 'cashMinBalance', v_set.cash_min_balance),
    'matrix', jsonb_build_object('id', v_version.id, 'versionNo', v_version.version_no, 'note', v_version.note,
      'createdAt', v_version.created_at, 'createdByName', app_private.finance_user_name(v_version.created_by),
      'rules', coalesce((select jsonb_agg(jsonb_build_object('tierNo', r.tier_no, 'minAmount', r.min_amount, 'maxAmount', r.max_amount,
          'steps', (select jsonb_agg(jsonb_build_object('label', s.value->>'label',
              'approvers', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'active', coalesce(u.is_active, true)))
                from jsonb_array_elements_text(s.value->'approverIds') a join public.users u on u.id = a::uuid)) order by s.ordinality)
            from jsonb_array_elements(r.steps) with ordinality s)) order by r.tier_no)
        from public.finance_approval_rules r where r.version_id = v_version.id), '[]'::jsonb)),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('versionNo', v.version_no, 'note', v.note, 'createdAt', v.created_at,
        'createdByName', app_private.finance_user_name(v.created_by), 'current', v.is_current) order by v.version_no desc)
      from public.finance_approval_matrix_versions v), '[]'::jsonb),
    'delegations', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'fromUserId', d.from_user_id, 'fromName', app_private.finance_user_name(d.from_user_id),
        'toUserId', d.to_user_id, 'toName', app_private.finance_user_name(d.to_user_id), 'validFrom', d.valid_from, 'validTo', d.valid_to,
        'reason', d.reason, 'createdByName', app_private.finance_user_name(d.created_by), 'revokedAt', d.revoked_at, 'revokeReason', d.revoke_reason)
        order by d.valid_from desc) from public.finance_approval_delegations d), '[]'::jsonb),
    'responsibilities', (select jsonb_object_agg(a.x, (select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name, 'admin', u.role = 'ADMIN') order by u.name), '[]'::jsonb)
        from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'
          and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.finance.' || a.x))))
      from unnest(array['view', 'record', 'confirm', 'manage']) a(x)),
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where coalesce(u.is_active, true) and u.account_status = 'ACTIVE'), '[]'::jsonb));
end;
$function$;

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
      'cash', (select jsonb_build_object('balance', fc->'start', 'known', fc->'known', 'accounts', fc->'accounts', 'lowest', fc->'lowest', 'lowestWeek', fc->'lowestWeek',
          'belowMinWeek', fc->'belowMinWeek', 'minBalance', fc->'minBalance') from (select app_private.finance_cash_forecast() fc) z),
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
