-- ===========================================================================
-- Tài chính đợt 3b-2: Phân bổ tháng + Quỹ công trường / hoàn ứng (chủ SP duyệt 8 câu, 04/10/2026)
--   * Phân bổ tháng (từ 10/2026, trước đó MISA đã phân bổ): (1) lương nhân viên = lương gộp bảng lương đã duyệt × số công ở
--     công trường (bảng công đã chốt + chấm công có công trường) → khoản mục CPL1; kế toán sửa số công có lý do; công ở văn phòng,
--     nhà máy, dự án không có HĐ chủ đầu tư → chi phí chung. (2) Chi phí chung = phiếu chi khác không gắn dự án đã chi trong tháng
--     (mặc định bỏ lương, trả nợ gốc, tạm ứng nhân viên, thuế) + phần lương văn phòng → chia theo tiền CĐT trả trong tháng → CPQL;
--     tháng không có tiền CĐT trả thì để lại công ty. Kế toán lập, người khác chốt; chốt ghi chi phí dự án + trừ quỹ dự án; đảo cả kỳ.
--   * Quỹ công trường: người giữ quỹ gắn tài khoản người dùng; CHT ghi từng khoản chi kèm ảnh (màn "Quỹ công trường của tôi",
--     không cần quyền Tài chính); kế toán (khác CHT, khác người lập) duyệt / trả lại từng khoản; duyệt = trừ quỹ công trường (sổ thu chi)
--     + chi phí dự án theo khoản mục (không trừ lại quỹ dự án); đảo có lý do. Chi quá số đang giữ vẫn ghi → "công ty nợ CHT".
--   * Tab Tài chính trong Dự án chuyển chỉ xem; hủy 2 bản quyết toán quỹ công trường kiểu cũ (nháp, không có dòng).
--   * Cập nhật mô tả 4 quyền Tài chính theo các việc mới.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.cash_funds add column holder_user_id uuid references public.users(id);

create sequence public.finance_site_expense_seq;
create table public.finance_site_expenses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  account_id uuid not null references public.cash_funds(id),
  project_id text not null references public.projects(id),
  spent_date date not null,
  description text not null check (length(btrim(description)) > 0),
  counterparty text,
  cost_item_id uuid not null references public.contract_cost_items(id),
  amount numeric(18,2) not null check (amount > 0),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'withdrawn', 'reversed')),
  submission_no integer not null default 1,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reverse_reason text,
  row_version bigint not null default 1
);
create index finance_site_expenses_account_idx on public.finance_site_expenses (account_id, status);

create sequence public.finance_allocation_seq;
create table public.finance_allocation_runs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  period_month date not null check (extract(day from period_month) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'confirmed', 'reversed', 'cancelled')),
  timesheet_version integer,
  payroll_count integer not null default 0,
  payroll_total numeric(18,2) not null default 0,
  site_total numeric(18,2) not null default 0,
  office_total numeric(18,2) not null default 0,
  pool_total numeric(18,2) not null default 0,
  receipts_total numeric(18,2) not null default 0,
  note text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reverse_reason text,
  row_version bigint not null default 1
);
create unique index finance_allocation_runs_one_active on public.finance_allocation_runs (period_month) where status in ('draft', 'submitted', 'confirmed');

create table public.finance_allocation_staff (
  run_id uuid not null references public.finance_allocation_runs(id),
  employee_id uuid not null references public.employees(id),
  employee_name text not null,
  gross numeric(18,2) not null default 0,
  site_days jsonb not null default '{}'::jsonb,
  office_days numeric(6,2) not null default 0,
  auto_site_days jsonb not null default '{}'::jsonb,
  auto_office_days numeric(6,2) not null default 0,
  edited boolean not null default false,
  edit_reason text,
  primary key (run_id, employee_id)
);

create table public.finance_allocation_pool (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.finance_allocation_runs(id),
  source_type text not null check (source_type in ('expense_request', 'office_salary', 'manual')),
  source_id text,
  description text not null,
  category text,
  amount numeric(18,2) not null check (amount >= 0),
  included boolean not null default true,
  note text,
  created_by uuid references public.users(id)
);
create unique index finance_allocation_pool_source on public.finance_allocation_pool (run_id, source_type, source_id) where source_type <> 'manual';

create table public.finance_allocation_lines (
  run_id uuid not null references public.finance_allocation_runs(id),
  project_id text not null references public.projects(id),
  kind text not null check (kind in ('salary', 'overhead')),
  cost_item_id uuid references public.contract_cost_items(id),
  amount numeric(18,2) not null,
  basis numeric(18,2),
  share numeric(9,6),
  primary key (run_id, project_id, kind)
);

do $$ declare t text; begin
  foreach t in array array['finance_site_expenses', 'finance_allocation_runs', 'finance_allocation_staff', 'finance_allocation_pool', 'finance_allocation_lines'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.finance_site_expense_seq, public.finance_allocation_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Trợ giúp chung
-- ---------------------------------------------------------------------------
create function app_private.finance_notify_link(p_users uuid[], p_title text, p_message text, p_link text, p_source text, p_actor uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
    priority, push_enabled, metadata, delivery_reason)
  select u::text, 'info', 'finance', p_title, p_message, p_message, 'info', '🏦', p_link, 'finance_' || p_source,
    'finance_' || p_source || ':' || gen_random_uuid(), 'high', true, '{}'::jsonb, 'responsible'
  from (select distinct unnest(p_users) u) q where u is not null and u is distinct from p_actor;
$$;

-- Loại chi phí của giao dịch dự án theo khoản mục (để Tổng quan chia vật tư / nhân công / máy / chung / khác).
create function app_private.finance_category_of_item(p_item uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case c.symbol when 'CPNVL' then 'materials' when 'CPNC' then 'labor' when 'CPMTC' then 'machinery'
    when 'CPQL' then 'overhead' when 'CPL' then 'overhead' when 'CPL1' then 'overhead' when 'CPNG' then 'overhead' else 'other' end
  from public.contract_cost_items c where c.id = p_item;
$$;

-- Ghi một dòng chi phí dự án (chi phí ghi nhận) theo khoản mục; trả id giao dịch.
create function app_private.finance_post_project_cost(p_id text, p_project text, p_item uuid, p_amount numeric, p_date date, p_description text,
  p_source_ref text, p_counterparty text, p_attachments jsonb, p_actor uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_finance text; c public.contract_cost_items%rowtype;
begin
  if app_private.finance_period_is_locked(p_project, null, 'VND', p_date) then raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
  select f.id into v_finance from public.project_finances f where f.project_id = p_project order by f.id limit 1;
  select * into c from public.contract_cost_items where id = p_item;
  insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name,
    contract_cost_item_id, contract_cost_item_symbol_snapshot, contract_cost_item_name_snapshot, cost_classification_status)
  values (p_id, coalesce(v_finance, ''), '', p_project, v_finance, null, 'expense', coalesce(app_private.finance_category_of_item(p_item), 'other'), round(p_amount, 2),
    p_description, p_date::text, 'workflow', p_source_ref, p_source_ref, coalesce(p_attachments, '[]'::jsonb), p_actor::text, now(), p_counterparty,
    p_item, c.symbol, c.name, 'manual');
  return p_id;
end $$;

-- Đảo các dòng chi phí đã ghi theo source_ref (đúng mã hoặc mã con "<mã>:…"; dòng âm, ngày hôm nay).
create function app_private.finance_reverse_project_cost(p_source_ref text, p_reason text, p_actor uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name,
    contract_cost_item_id, contract_cost_item_symbol_snapshot, contract_cost_item_name_snapshot, cost_classification_status)
  select t.id || '-reversal', t."projectFinanceId", t."constructionSiteId", t.project_id, t.project_finance_id, t.construction_site_id,
    'expense', t.category, -t.amount, 'Đảo ' || t.description || ' — ' || p_reason, (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'workflow',
    t.source_ref || ':reversal', t.source_ref || ':reversal', '[]'::jsonb, p_actor::text, now(), t.counterparty_name,
    t.contract_cost_item_id, t.contract_cost_item_symbol_snapshot, t.contract_cost_item_name_snapshot, 'manual'
  from public.project_transactions t where (t.source_ref = p_source_ref or t.source_ref like p_source_ref || ':%')
    and t.source_ref not like '%:reversal' and t.amount <> 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Quỹ công trường / hoàn ứng
-- ---------------------------------------------------------------------------
create function app_private.finance_site_holder(p_account uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cash_funds f where f.id = p_account and f.kind = 'site' and f.holder_user_id is not null
    and f.holder_user_id = public.current_app_user_id());
$$;

-- Tệp chứng từ quỹ công trường: thư mục site/<tài khoản>/… — người giữ quỹ đó tải lên / xem được (ngoài quyền Tài chính).
create function app_private.finance_site_holder_path(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_parts text[] := string_to_array(p_name, '/');
begin
  if cardinality(v_parts) < 3 or v_parts[1] <> 'site' or v_parts[2] !~ '^[0-9a-f-]{36}$' then return false; end if;
  return app_private.finance_site_holder(v_parts[2]::uuid);
end $$;
create policy finance_attachments_site_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'finance-attachments' and app_private.finance_site_holder_path(name));
create policy finance_attachments_site_read on storage.objects for select to authenticated
  using (bucket_id = 'finance-attachments' and app_private.finance_site_holder_path(name));

-- Quỹ công trường: người giữ quỹ thấy quỹ của mình; người có quyền Tài chính — Xem thấy mọi quỹ công trường.
create function public.get_finance_site_funds_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_view boolean := app_private.finance_can('view');
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object('today', (now() at time zone 'Asia/Ho_Chi_Minh')::date,
    'cutoverDate', (select ap_cutover_date from public.finance_settings where id = 1),
    'can', jsonb_build_object('view', v_view, 'record', app_private.finance_can('record'), 'confirm', app_private.finance_can('confirm')),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'symbol', i.symbol, 'name', i.name, 'groupName', i.group_name) order by i.ord)
      from app_private.finance_budget_items() i), '[]'::jsonb),
    'funds', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'projectId', f.project_id,
        'projectCode', (select code from public.projects p where p.id = f.project_id), 'holderUserId', f.holder_user_id,
        'holderName', coalesce(app_private.finance_user_name(f.holder_user_id), f.holder_name), 'active', f.is_active,
        'mine', f.holder_user_id = v_actor,
        'balance', app_private.finance_cash_balance(f.id),
        'received', coalesce((select sum(case e.direction when 'in' then e.amount else -e.amount end) from public.finance_cash_entries e
          where e.account_id = f.id and e.source_type in ('cash_transfer', 'cash_movement')), 0),
        'pending', coalesce((select sum(x.amount) from public.finance_site_expenses x where x.account_id = f.id and x.status = 'submitted'), 0),
        'approved', coalesce((select sum(x.amount) from public.finance_site_expenses x where x.account_id = f.id and x.status = 'approved'), 0),
        'expenses', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'date', x.spent_date, 'description', x.description,
            'counterparty', x.counterparty, 'costItemId', x.cost_item_id, 'costItem', (select c.symbol || ' · ' || c.name from public.contract_cost_items c where c.id = x.cost_item_id),
            'amount', x.amount, 'attachments', x.attachments, 'status', x.status, 'submissionNo', x.submission_no,
            'createdById', x.created_by, 'createdByName', app_private.finance_user_name(x.created_by), 'createdAt', x.created_at,
            'decidedByName', app_private.finance_user_name(x.decided_by), 'decidedAt', x.decided_at, 'decisionNote', x.decision_note,
            'reverseReason', x.reverse_reason, 'rowVersion', x.row_version,
            'canEdit', x.created_by = v_actor and x.status in ('submitted', 'rejected'),
            'canDecide', x.status = 'submitted' and app_private.finance_can('record') and x.created_by is distinct from v_actor and f.holder_user_id is distinct from v_actor,
            'canReverse', x.status = 'approved' and app_private.finance_can('confirm') and f.holder_user_id is distinct from v_actor)
          order by case x.status when 'submitted' then 0 when 'rejected' then 1 else 2 end, x.spent_date desc, x.created_at desc)
          from (select * from public.finance_site_expenses y where y.account_id = f.id order by y.created_at desc limit 200) x), '[]'::jsonb))
      order by (f.holder_user_id = v_actor) desc, f.name)
      from public.cash_funds f where f.kind = 'site' and (v_view or f.holder_user_id = v_actor)), '[]'::jsonb));
end $$;

create function public.save_finance_site_expense_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); f public.cash_funds%rowtype; x public.finance_site_expenses%rowtype;
  v_date date := nullif(p_input->>'spentDate', '')::date; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_desc text := nullif(btrim(p_input->>'description'), ''); v_item uuid := nullif(p_input->>'costItemId', '')::uuid;
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_code text; v_id uuid; v_records uuid[];
begin
  select * into f from public.cash_funds where id = nullif(p_input->>'accountId', '')::uuid;
  if not found or f.kind <> 'site' or not f.is_active or f.project_id is null then raise exception using errcode = '22023', message = 'FINANCE_SITE_FUND_INVALID'; end if;
  if v_actor is null or not (f.holder_user_id = v_actor or app_private.finance_can('record')) then
    raise exception using errcode = '42501', message = 'FINANCE_SITE_FUND_DENIED'; end if;
  if v_desc is null or v_amount is null or v_amount <= 0 or v_date is null or v_date > v_today
    or v_date < (select ap_cutover_date from public.finance_settings where id = 1)
    or not exists (select 1 from app_private.finance_budget_items() i where i.id = v_item) then
    raise exception using errcode = '22023', message = 'FINANCE_SITE_EXPENSE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_input->'attachments', '[]'::jsonb)) <> 'array' then raise exception using errcode = '22023', message = 'FINANCE_SITE_EXPENSE_INVALID'; end if;
  if nullif(p_input->>'id', '') is null then
    v_code := 'QCT-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_site_expense_seq')::text, 3, '0');
    insert into public.finance_site_expenses (code, account_id, project_id, spent_date, description, counterparty, cost_item_id, amount, attachments, created_by)
    values (v_code, f.id, f.project_id, v_date, v_desc, nullif(btrim(p_input->>'counterparty'), ''), v_item, v_amount, coalesce(p_input->'attachments', '[]'::jsonb), v_actor)
    returning id into v_id;
  else
    select * into x from public.finance_site_expenses where id = (p_input->>'id')::uuid for update;
    if not found or x.account_id <> f.id then raise exception using errcode = 'PT404', message = 'FINANCE_SITE_EXPENSE_NOT_FOUND'; end if;
    if x.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if x.created_by is distinct from v_actor or x.status not in ('submitted', 'rejected') then raise exception using errcode = '42501', message = 'FINANCE_SITE_EXPENSE_STATE'; end if;
    update public.finance_site_expenses set spent_date = v_date, description = v_desc, counterparty = nullif(btrim(p_input->>'counterparty'), ''), cost_item_id = v_item,
      amount = v_amount, attachments = coalesce(p_input->'attachments', '[]'::jsonb), status = 'submitted',
      submission_no = submission_no + case when status = 'rejected' then 1 else 0 end, updated_at = now(), row_version = row_version + 1
    where id = x.id returning id, code into v_id, v_code;
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('site_expense', v_id::text, 'site_expense_submit', v_actor, jsonb_build_object('code', v_code, 'accountId', f.id, 'projectId', f.project_id, 'amount', v_amount,
    'costItemId', v_item, 'attachments', jsonb_array_length(coalesce(p_input->'attachments', '[]'::jsonb))));
  v_records := app_private.finance_users_with('record');
  perform app_private.finance_notify_link(array(select u from unnest(v_records) u where u is distinct from f.holder_user_id), 'Khoản chi quỹ công trường chờ duyệt',
    v_code || ' · ' || f.name || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ: ' || v_desc, '/#/finance?section=cash', 'site_expense', v_actor);
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- Người lập rút khoản đang chờ / bị trả lại.
create function public.withdraw_finance_site_expense_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); x public.finance_site_expenses%rowtype;
begin
  select * into x from public.finance_site_expenses where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SITE_EXPENSE_NOT_FOUND'; end if;
  if x.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if x.created_by is distinct from v_actor or x.status not in ('submitted', 'rejected') then raise exception using errcode = '42501', message = 'FINANCE_SITE_EXPENSE_STATE'; end if;
  update public.finance_site_expenses set status = 'withdrawn', updated_at = now(), row_version = row_version + 1 where id = x.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('site_expense', x.id::text, 'site_expense_withdraw', v_actor, jsonb_build_object('code', x.code));
  return jsonb_build_object('id', x.id, 'status', 'withdrawn');
end $$;

-- Kế toán duyệt / trả lại nhiều khoản một lần. Người duyệt khác người lập và khác người giữ quỹ. Duyệt: trừ quỹ công trường
-- (sổ thu chi) + ghi chi phí dự án theo khoản mục (kế toán chọn lại được khoản mục). Đảo: quyền Xác nhận, có lý do.
create function public.decide_finance_site_expenses_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  it jsonb; x public.finance_site_expenses%rowtype; f public.cash_funds%rowtype; v_item uuid; n integer := 0; v_ref text;
begin
  if v_action in ('approve', 'reject') then
    if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  if v_action in ('reject', 'reverse') and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  for it in select value from jsonb_array_elements(coalesce(p_input->'items', '[]'::jsonb)) loop
    select * into x from public.finance_site_expenses where id = (it->>'id')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SITE_EXPENSE_NOT_FOUND'; end if;
    if x.row_version is distinct from nullif(it->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    select * into f from public.cash_funds where id = x.account_id;
    if v_actor is null or v_actor = x.created_by or v_actor = f.holder_user_id then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    v_ref := 'finance_site_expense:' || x.id::text;
    if v_action in ('approve', 'reject') and x.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_SITE_EXPENSE_STATE'; end if;
    if v_action = 'approve' then
      v_item := coalesce(nullif(it->>'costItemId', '')::uuid, x.cost_item_id);
      if not exists (select 1 from app_private.finance_budget_items() i where i.id = v_item) then raise exception using errcode = '22023', message = 'FINANCE_SITE_EXPENSE_INVALID'; end if;
      perform app_private.finance_cash_entry(f.id, x.spent_date, 'out', x.amount, 'site_expense', x.id::text, x.code, x.description, x.counterparty, x.project_id, v_actor);
      perform app_private.finance_post_project_cost('finance-site-expense-' || x.id::text, x.project_id, v_item, x.amount, x.spent_date,
        x.code || ' · ' || x.description, v_ref, x.counterparty, x.attachments, v_actor);
      update public.finance_site_expenses set status = 'approved', cost_item_id = v_item, decided_by = v_actor, decided_at = now(), decision_note = v_reason,
        updated_at = now(), row_version = row_version + 1 where id = x.id;
    elsif v_action = 'reject' then
      update public.finance_site_expenses set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason,
        updated_at = now(), row_version = row_version + 1 where id = x.id;
    else
      if x.status <> 'approved' then raise exception using errcode = '22023', message = 'FINANCE_SITE_EXPENSE_STATE'; end if;
      perform app_private.finance_cash_reverse_source('site_expense', x.id::text, v_reason, v_actor);
      perform app_private.finance_reverse_project_cost(v_ref, v_reason, v_actor);
      update public.finance_site_expenses set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason,
        updated_at = now(), row_version = row_version + 1 where id = x.id;
    end if;
    insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('site_expense', x.id::text, 'site_expense_' || v_action, v_actor, v_reason, jsonb_build_object('code', x.code, 'amount', x.amount, 'costItemId', coalesce(v_item, x.cost_item_id)));
    perform app_private.finance_notify_link(array[x.created_by], case v_action when 'approve' then 'Khoản chi quỹ công trường đã duyệt'
      when 'reject' then 'Khoản chi quỹ công trường bị trả lại' else 'Khoản chi quỹ công trường đã bị đảo' end,
      x.code || ' · ' || x.description || coalesce(': ' || v_reason, ''), '/#/site-fund', 'site_expense', v_actor);
    n := n + 1;
  end loop;
  if n = 0 then raise exception using errcode = '22023', message = 'FINANCE_SITE_EXPENSE_INVALID'; end if;
  return jsonb_build_object('count', n, 'action', v_action);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Phân bổ tháng
-- ---------------------------------------------------------------------------
-- Dự án nhận phân bổ: có HĐ chủ đầu tư còn hiệu lực (nhà máy, văn phòng, dự án nội bộ → chi phí chung).
create function app_private.finance_allocation_projects()
returns table (id text, code text, site_id text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.code, p.construction_site_id::text from public.projects p
  where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')
    and exists (select 1 from public.customer_contracts c where c.project_id = p.id and c.status <> 'cancelled');
$$;

-- Dựng lại số liệu kỳ nháp. Không ghi đè số công kế toán đã sửa (chỉ cập nhật số gợi ý); giữ các khoản chi phí chung tay và lựa chọn bỏ / tính.
create function app_private.finance_allocation_build(p_run uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.finance_allocation_runs%rowtype; v_year integer; v_month integer; v_from date; v_to date; v_period public.hrm_timesheet_periods%rowtype;
  v_office numeric; v_pool numeric; v_receipts numeric; v_item_salary uuid; v_item_overhead uuid;
begin
  select * into r from public.finance_allocation_runs where id = p_run;
  v_year := extract(year from r.period_month); v_month := extract(month from r.period_month);
  v_from := r.period_month; v_to := (r.period_month + interval '1 month')::date;
  select * into v_period from public.hrm_timesheet_periods where year = v_year and month = v_month;

  -- (1) Lương: chỉ khi bảng công đã chốt; số công = công trong bản chốt, công trường lấy từ chấm công ngày đó.
  create temp table if not exists pg_temp.fin_alloc_auto (employee_id uuid, employee_name text, gross numeric, site_days jsonb, office_days numeric) on commit drop;
  truncate pg_temp.fin_alloc_auto;
  if v_period.status = 'closed' then
    insert into pg_temp.fin_alloc_auto
    with pay as (
      select p."employeeId" employee_id, sum(coalesce(p."grossSalary", 0)) gross from public.hrm_payrolls p
      where p.year = v_year and p.month = v_month and p.status in ('confirmed', 'paid') group by 1
    ), days as (
      select s.employee_id, (d->>'date')::date dt, coalesce((d->>'workCredit')::numeric, 0) credit
      from public.hrm_timesheet_snapshots s cross join jsonb_array_elements(coalesce(s.row->'days', '[]'::jsonb)) d
      where s.year = v_year and s.month = v_month and s.version = v_period.version and coalesce((d->>'workCredit')::numeric, 0) > 0
    ), placed as (
      select dy.employee_id, dy.credit,
        (select ap.id from public.hrm_attendance a join app_private.finance_allocation_projects() ap on ap.site_id = a."constructionSiteId"
          where a."employeeId" = dy.employee_id and a.date::date = dy.dt limit 1) project_id
      from days dy
    ), agg as (
      select employee_id, coalesce(jsonb_object_agg(project_id, d) filter (where project_id is not null), '{}'::jsonb) site_days,
        coalesce(sum(d) filter (where project_id is null), 0) office_days
      from (select employee_id, project_id, sum(credit) d from placed group by 1, 2) z group by 1
    )
    select pay.employee_id, e.full_name, pay.gross, coalesce(agg.site_days, '{}'::jsonb), coalesce(agg.office_days, 0)
    from pay join public.employees e on e.id = pay.employee_id left join agg on agg.employee_id = pay.employee_id;
  end if;
  delete from public.finance_allocation_staff s where s.run_id = p_run and not s.edited
    and not exists (select 1 from pg_temp.fin_alloc_auto a where a.employee_id = s.employee_id);
  insert into public.finance_allocation_staff (run_id, employee_id, employee_name, gross, site_days, office_days, auto_site_days, auto_office_days)
  select p_run, a.employee_id, a.employee_name, a.gross, a.site_days, a.office_days, a.site_days, a.office_days from pg_temp.fin_alloc_auto a
  on conflict (run_id, employee_id) do update set employee_name = excluded.employee_name, gross = excluded.gross,
    auto_site_days = excluded.auto_site_days, auto_office_days = excluded.auto_office_days,
    site_days = case when public.finance_allocation_staff.edited then public.finance_allocation_staff.site_days else excluded.site_days end,
    office_days = case when public.finance_allocation_staff.edited then public.finance_allocation_staff.office_days else excluded.office_days end;

  -- (2) Chi phí chung: phiếu chi khác không gắn dự án đã chi trong tháng (giữ lựa chọn cũ), phần lương văn phòng.
  insert into public.finance_allocation_pool (run_id, source_type, source_id, description, category, amount, included)
  select p_run, 'expense_request', q.id::text, concat_ws(' · ', q.code, nullif(q.supplier_name, ''), nullif(q.note, '')), q.expense_category, q.amount,
    coalesce(q.expense_category, 'other') not in ('salary', 'loan_repay', 'staff_advance', 'tax')
  from public.finance_payment_requests q
  where q.kind = 'expense' and q.project_id is null and q.status = 'paid'
    and (q.paid->>'paymentDate')::date >= v_from and (q.paid->>'paymentDate')::date < v_to
  on conflict (run_id, source_type, source_id) where source_type <> 'manual' do update set amount = excluded.amount, description = excluded.description;
  delete from public.finance_allocation_pool p where p.run_id = p_run and p.source_type = 'expense_request'
    and not exists (select 1 from public.finance_payment_requests q where q.id::text = p.source_id and q.status = 'paid'
      and (q.paid->>'paymentDate')::date >= v_from and (q.paid->>'paymentDate')::date < v_to);

  select coalesce(sum(case when tot > 0 then s.gross * s.office_days / tot else s.gross end), 0) into v_office
  from (select x.*, x.office_days + coalesce((select sum(value::numeric) from jsonb_each_text(x.site_days)), 0) tot
    from public.finance_allocation_staff x where x.run_id = p_run) s;
  insert into public.finance_allocation_pool (run_id, source_type, source_id, description, category, amount, included)
  values (p_run, 'office_salary', 'office', 'Lương nhân viên phần không ở công trường (văn phòng, nhà máy)', 'salary', round(v_office, 2), true)
  on conflict (run_id, source_type, source_id) where source_type <> 'manual' do update set amount = excluded.amount;

  -- (3) Kết quả theo dự án.
  select id into v_item_salary from public.contract_cost_items where symbol = 'CPL1' and status = 'active' limit 1;
  select id into v_item_overhead from public.contract_cost_items where symbol = 'CPQL' and status = 'active' limit 1;
  delete from public.finance_allocation_lines where run_id = p_run;
  insert into public.finance_allocation_lines (run_id, project_id, kind, cost_item_id, amount, basis, share)
  select p_run, z.project_id, 'salary', v_item_salary, round(sum(z.amt), 2), sum(z.days), null
  from (select d.key project_id, d.value::numeric days, s.gross * d.value::numeric
      / nullif(s.office_days + (select sum(value::numeric) from jsonb_each_text(s.site_days)), 0) amt
    from public.finance_allocation_staff s cross join jsonb_each_text(s.site_days) d where s.run_id = p_run) z
  where z.amt > 0 group by z.project_id;

  select coalesce(sum(amount) filter (where included), 0) into v_pool from public.finance_allocation_pool where run_id = p_run;
  select coalesce(sum(rc.amount), 0) into v_receipts from public.finance_customer_receipts rc join app_private.finance_allocation_projects() ap on ap.id = rc.project_id
  where rc.status = 'confirmed' and rc.receipt_date >= v_from and rc.receipt_date < v_to;
  if v_receipts > 0 and v_pool > 0 then
    insert into public.finance_allocation_lines (run_id, project_id, kind, cost_item_id, amount, basis, share)
    select p_run, rc.project_id, 'overhead', v_item_overhead, round(v_pool * sum(rc.amount) / v_receipts, 2), sum(rc.amount), round(sum(rc.amount) / v_receipts, 6)
    from public.finance_customer_receipts rc join app_private.finance_allocation_projects() ap on ap.id = rc.project_id
    where rc.status = 'confirmed' and rc.receipt_date >= v_from and rc.receipt_date < v_to group by rc.project_id;
  end if;

  update public.finance_allocation_runs set timesheet_version = case when v_period.status = 'closed' then v_period.version end,
    payroll_count = (select count(*) from public.finance_allocation_staff where run_id = p_run),
    payroll_total = (select coalesce(sum(gross), 0) from public.finance_allocation_staff where run_id = p_run),
    site_total = (select coalesce(sum(amount), 0) from public.finance_allocation_lines where run_id = p_run and kind = 'salary'),
    office_total = round(v_office, 2), pool_total = v_pool, receipts_total = v_receipts, updated_at = now()
  where id = p_run;
end $$;

-- Điều kiện của tháng: bảng công đã chốt? bảng lương đã duyệt?
create function app_private.finance_allocation_readiness(p_month date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'timesheet', (select jsonb_build_object('status', t.status, 'version', t.version, 'decidedAt', t.decided_at) from public.hrm_timesheet_periods t
      where t.year = extract(year from p_month) and t.month = extract(month from p_month)),
    'payroll', (select jsonb_build_object('confirmed', count(*) filter (where p.status in ('confirmed', 'paid')), 'draft', count(*) filter (where p.status = 'draft'),
        'gross', coalesce(sum(p."grossSalary") filter (where p.status in ('confirmed', 'paid')), 0))
      from public.hrm_payrolls p where p.year = extract(year from p_month) and p.month = extract(month from p_month)),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('projectId', ap.id, 'projectCode', ap.code, 'amount', z.amount) order by z.amount desc)
      from (select rc.project_id, sum(rc.amount) amount from public.finance_customer_receipts rc where rc.status = 'confirmed'
        and rc.receipt_date >= p_month and rc.receipt_date < (p_month + interval '1 month')::date group by 1) z
      join app_private.finance_allocation_projects() ap on ap.id = z.project_id), '[]'::jsonb));
$$;

create function public.get_finance_allocation_v1(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_cut date; v_month date; r public.finance_allocation_runs%rowtype; v_last date;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select date_trunc('month', ap_cutover_date)::date into v_cut from public.finance_settings where id = 1;
  v_last := (date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date) - interval '1 month')::date;
  v_month := coalesce(date_trunc('month', p_month)::date, greatest(v_cut, v_last));
  select * into r from public.finance_allocation_runs where period_month = v_month and status in ('draft', 'submitted', 'confirmed');
  return jsonb_build_object('month', v_month, 'firstMonth', v_cut, 'lastClosableMonth', v_last,
    'can', app_private.finance_can_flags(),
    'readiness', app_private.finance_allocation_readiness(v_month),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', ap.id, 'code', ap.code) order by ap.code) from app_private.finance_allocation_projects() ap), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'code', x.code, 'month', x.period_month, 'status', x.status,
        'siteTotal', x.site_total, 'poolTotal', x.pool_total, 'createdByName', app_private.finance_user_name(x.created_by), 'decidedByName', app_private.finance_user_name(x.decided_by),
        'decidedAt', x.decided_at, 'reverseReason', x.reverse_reason, 'decisionNote', x.decision_note) order by x.period_month desc, x.created_at desc)
      from public.finance_allocation_runs x), '[]'::jsonb),
    'run', case when r.id is null then null else jsonb_build_object('id', r.id, 'code', r.code, 'month', r.period_month, 'status', r.status,
      'timesheetVersion', r.timesheet_version, 'payrollCount', r.payroll_count, 'payrollTotal', r.payroll_total, 'siteTotal', r.site_total, 'officeTotal', r.office_total,
      'poolTotal', r.pool_total, 'receiptsTotal', r.receipts_total, 'note', r.note, 'rowVersion', r.row_version,
      'createdByName', app_private.finance_user_name(r.created_by), 'createdAt', r.created_at, 'submittedAt', r.submitted_at,
      'decidedByName', app_private.finance_user_name(r.decided_by), 'decidedAt', r.decided_at, 'decisionNote', r.decision_note,
      'canEdit', r.status = 'draft' and app_private.finance_can('record'),
      'canSubmit', r.status = 'draft' and app_private.finance_can('record'),
      'canDecide', r.status = 'submitted' and app_private.finance_can('confirm') and r.created_by is distinct from v_actor,
      'canCancel', r.status in ('draft', 'submitted') and (r.created_by = v_actor or app_private.finance_can('manage')),
      'canReverse', r.status = 'confirmed' and app_private.finance_can('confirm'),
      'staff', coalesce((select jsonb_agg(jsonb_build_object('employeeId', s.employee_id, 'name', s.employee_name, 'gross', s.gross, 'siteDays', s.site_days,
          'officeDays', s.office_days, 'autoSiteDays', s.auto_site_days, 'autoOfficeDays', s.auto_office_days, 'edited', s.edited, 'editReason', s.edit_reason)
          order by (s.site_days <> '{}'::jsonb) desc, s.employee_name) from public.finance_allocation_staff s where s.run_id = r.id), '[]'::jsonb),
      'pool', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'sourceType', p.source_type, 'description', p.description, 'category', p.category,
          'amount', p.amount, 'included', p.included, 'note', p.note) order by p.source_type = 'office_salary' desc, p.amount desc) from public.finance_allocation_pool p where p.run_id = r.id), '[]'::jsonb),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('projectId', l.project_id, 'projectCode', (select code from public.projects x where x.id = l.project_id),
          'kind', l.kind, 'amount', l.amount, 'basis', l.basis, 'share', l.share) order by l.project_id, l.kind) from public.finance_allocation_lines l where l.run_id = r.id), '[]'::jsonb)) end);
end $$;

create function public.create_finance_allocation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_month date := date_trunc('month', nullif(p_input->>'month', '')::date)::date; v_cut date; v_id uuid; v_code text;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select date_trunc('month', ap_cutover_date)::date into v_cut from public.finance_settings where id = 1;
  if v_month is null or v_month < v_cut or v_month >= date_trunc('month', (now() at time zone 'Asia/Ho_Chi_Minh')::date)::date then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_MONTH_INVALID'; end if;
  if exists (select 1 from public.finance_allocation_runs where period_month = v_month and status in ('draft', 'submitted', 'confirmed')) then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_EXISTS'; end if;
  v_code := 'PB-' || to_char(v_month, 'YYMM') || '-' || lpad(nextval('public.finance_allocation_seq')::text, 2, '0');
  insert into public.finance_allocation_runs (code, period_month, created_by) values (v_code, v_month, v_actor) returning id into v_id;
  perform app_private.finance_allocation_build(v_id);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('allocation', v_id::text, 'allocation_create', v_actor, jsonb_build_object('code', v_code, 'month', v_month));
  return jsonb_build_object('id', v_id, 'code', v_code);
end $$;

-- Kỳ nháp: làm mới số liệu, sửa số công một người (bắt buộc lý do), bỏ / tính một khoản chi phí chung, thêm / xóa khoản tay.
create function public.save_finance_allocation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; r public.finance_allocation_runs%rowtype;
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_days jsonb := coalesce(p_input->'siteDays', '{}'::jsonb); v_office numeric := nullif(p_input->>'officeDays', '')::numeric;
  s public.finance_allocation_staff%rowtype;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into r from public.finance_allocation_runs where id = nullif(p_input->>'runId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ALLOCATION_NOT_FOUND'; end if;
  if r.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  if r.status <> 'draft' then raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_STATE'; end if;
  if v_action = 'staff' then
    select * into s from public.finance_allocation_staff where run_id = r.id and employee_id = nullif(p_input->>'employeeId', '')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ALLOCATION_NOT_FOUND'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if jsonb_typeof(v_days) <> 'object' or v_office is null or v_office < 0 or v_office > 31
      or exists (select 1 from jsonb_each_text(v_days) d where d.value::numeric < 0 or d.value::numeric > 31
        or not exists (select 1 from app_private.finance_allocation_projects() ap where ap.id = d.key)) then
      raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_DAYS_INVALID'; end if;
    update public.finance_allocation_staff set site_days = (select coalesce(jsonb_object_agg(d.key, d.value::numeric) filter (where d.value::numeric > 0), '{}'::jsonb) from jsonb_each_text(v_days) d),
      office_days = v_office, edited = true, edit_reason = v_reason where run_id = r.id and employee_id = s.employee_id;
  elsif v_action = 'pool' then
    update public.finance_allocation_pool set included = coalesce((p_input->>'included')::boolean, included), note = coalesce(v_reason, note)
    where id = nullif(p_input->>'itemId', '')::uuid and run_id = r.id;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ALLOCATION_NOT_FOUND'; end if;
  elsif v_action = 'pool_add' then
    if v_reason is null or nullif(btrim(p_input->>'description'), '') is null or coalesce(nullif(p_input->>'amount', '')::numeric, 0) <= 0 then
      raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_POOL_INVALID'; end if;
    insert into public.finance_allocation_pool (run_id, source_type, description, category, amount, included, note, created_by)
    values (r.id, 'manual', btrim(p_input->>'description'), 'other', round((p_input->>'amount')::numeric, 2), true, v_reason, v_actor);
  elsif v_action = 'pool_remove' then
    delete from public.finance_allocation_pool where id = nullif(p_input->>'itemId', '')::uuid and run_id = r.id and source_type = 'manual';
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ALLOCATION_NOT_FOUND'; end if;
  elsif v_action <> 'refresh' then
    raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID';
  end if;
  perform app_private.finance_allocation_build(r.id);
  update public.finance_allocation_runs set row_version = row_version + 1 where id = r.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('allocation', r.id::text, 'allocation_' || v_action, v_actor, v_reason, p_input - 'expectedRowVersion' - 'runId');
  return jsonb_build_object('id', r.id);
end $$;

-- Gửi chốt / trả lại / chốt / hủy / đảo. Chốt: người khác người lập (quyền Xác nhận); ghi chi phí dự án ngày cuối tháng.
create function public.decide_finance_allocation_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  r public.finance_allocation_runs%rowtype; l record; v_end date; v_ready jsonb; v_status text;
begin
  select * into r from public.finance_allocation_runs where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ALLOCATION_NOT_FOUND'; end if;
  if r.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  v_end := ((r.period_month + interval '1 month')::date - 1);
  if v_action = 'submit' then
    if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
    if r.status <> 'draft' then raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_STATE'; end if;
    perform app_private.finance_allocation_build(r.id);
    v_ready := app_private.finance_allocation_readiness(r.period_month);
    if coalesce(v_ready->'timesheet'->>'status', '') <> 'closed' or coalesce((v_ready->'payroll'->>'confirmed')::integer, 0) = 0 then
      raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_NOT_READY'; end if;
    v_status := 'submitted';
    update public.finance_allocation_runs set status = 'submitted', submitted_at = now(), note = coalesce(v_reason, note), row_version = row_version + 1 where id = r.id;
    perform app_private.finance_notify_link(app_private.finance_users_with('confirm'), 'Phân bổ tháng chờ chốt', r.code || ' · tháng ' || to_char(r.period_month, 'MM/YYYY'),
      '/#/finance?section=cost&view=allocation', 'allocation', v_actor);
  elsif v_action in ('return', 'confirm') then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if r.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_STATE'; end if;
    if v_actor is null or v_actor = r.created_by then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
    if v_action = 'return' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      v_status := 'draft';
      update public.finance_allocation_runs set status = 'draft', decision_note = v_reason, row_version = row_version + 1 where id = r.id;
    else
      for l in select * from public.finance_allocation_lines where run_id = r.id and amount > 0 loop
        perform app_private.finance_post_project_cost('finance-allocation-' || r.id::text || '-' || l.project_id || '-' || l.kind, l.project_id, l.cost_item_id, l.amount, v_end,
          r.code || ' · ' || case l.kind when 'salary' then 'Phân bổ lương nhân viên công trường' else 'Phân bổ chi phí chung công ty' end || ' tháng ' || to_char(r.period_month, 'MM/YYYY'),
          'finance_allocation:' || r.id::text || ':' || l.project_id || ':' || l.kind, null, '[]'::jsonb, v_actor);
      end loop;
      v_status := 'confirmed';
      update public.finance_allocation_runs set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason, row_version = row_version + 1 where id = r.id;
    end if;
    perform app_private.finance_notify_link(array[r.created_by], case v_action when 'confirm' then 'Phân bổ tháng đã chốt' else 'Phân bổ tháng bị trả lại' end,
      r.code || coalesce(': ' || v_reason, ''), '/#/finance?section=cost&view=allocation', 'allocation', v_actor);
  elsif v_action = 'cancel' then
    if r.status not in ('draft', 'submitted') or not (v_actor = r.created_by or app_private.finance_can('manage')) then
      raise exception using errcode = '42501', message = 'FINANCE_ALLOCATION_STATE'; end if;
    v_status := 'cancelled';
    update public.finance_allocation_runs set status = 'cancelled', decision_note = v_reason, row_version = row_version + 1 where id = r.id;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if r.status <> 'confirmed' then raise exception using errcode = '22023', message = 'FINANCE_ALLOCATION_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    perform app_private.finance_reverse_project_cost('finance_allocation:' || r.id::text, v_reason, v_actor);
    v_status := 'reversed';
    update public.finance_allocation_runs set status = 'reversed', reversed_by = v_actor, reversed_at = now(), reverse_reason = v_reason, row_version = row_version + 1 where id = r.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('allocation', r.id::text, 'allocation_' || v_action, v_actor, v_reason, jsonb_build_object('code', r.code, 'month', r.period_month,
    'lines', (select jsonb_agg(jsonb_build_object('projectId', project_id, 'kind', kind, 'amount', amount)) from public.finance_allocation_lines where run_id = r.id)));
  return jsonb_build_object('id', r.id, 'status', v_status);
end $$;

revoke all on function app_private.finance_notify_link(uuid[], text, text, text, text, uuid), app_private.finance_category_of_item(uuid),
  app_private.finance_post_project_cost(text, text, uuid, numeric, date, text, text, text, jsonb, uuid), app_private.finance_reverse_project_cost(text, text, uuid),
  app_private.finance_site_holder(uuid), app_private.finance_allocation_projects(), app_private.finance_allocation_build(uuid),
  app_private.finance_allocation_readiness(date) from public, anon, authenticated;
-- Chính sách lưu trữ gọi hàm này dưới quyền người dùng.
revoke all on function app_private.finance_site_holder_path(text) from public, anon;
grant execute on function app_private.finance_site_holder_path(text) to authenticated;
revoke all on function public.get_finance_site_funds_v1(), public.save_finance_site_expense_v1(jsonb), public.withdraw_finance_site_expense_v1(jsonb),
  public.decide_finance_site_expenses_v1(jsonb), public.get_finance_allocation_v1(date), public.create_finance_allocation_v1(jsonb),
  public.save_finance_allocation_v1(jsonb), public.decide_finance_allocation_v1(jsonb) from public, anon;
grant execute on function public.get_finance_site_funds_v1(), public.save_finance_site_expense_v1(jsonb), public.withdraw_finance_site_expense_v1(jsonb),
  public.decide_finance_site_expenses_v1(jsonb), public.get_finance_allocation_v1(date), public.create_finance_allocation_v1(jsonb),
  public.save_finance_allocation_v1(jsonb), public.decide_finance_allocation_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dữ liệu: hủy quyết toán quỹ công trường kiểu cũ (2 bản nháp T7, T8 không có dòng); mô tả quyền Tài chính
-- ---------------------------------------------------------------------------
update public.site_cash_settlement_batches b set status = 'cancelled', updated_at = now(),
  metadata = coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object('cancelledReason', 'Chuyển sang Quỹ công trường ở module Tài chính (chủ SP duyệt 04/10/2026)')
where b.status = 'draft' and not exists (select 1 from public.site_cash_settlement_lines l where l.settlement_batch_id = b.id);

update public.permission_actions set label = 'Xem Tài chính toàn công ty',
  description = 'Xem Tổng quan, Phải thu, Phải trả, Thu chi & quỹ, Chi phí & ngân sách, quỹ dự án, phân bổ tháng của mọi dự án', updated_at = now()
where permission_code = 'system.finance.view';
update public.permission_actions set description = 'Kế toán: ghi nợ, lập đề nghị chi / tạm ứng / chi khác, phiếu thu CĐT, thu khác, chuyển tiền, đầu kỳ (NCC, CĐT, tài khoản, quỹ dự án), '
  || 'lập ngân sách dự án, lập phân bổ tháng, duyệt khoản chi quỹ công trường', updated_at = now()
where permission_code = 'system.finance.record';
update public.permission_actions set description = 'Xác nhận đã chi (UNC), phiếu thu, thu khác / chuyển tiền, chốt các đầu kỳ, đối chiếu sao kê, chốt phân bổ tháng, '
  || 'đảo khoản quỹ công trường — luôn khác người lập', updated_at = now()
where permission_code = 'system.finance.confirm';
update public.permission_actions set description = 'Tổng quan Ban giám đốc, duyệt ngân sách dự án, ma trận duyệt chi, ủy quyền, thông số tạm ứng / tồn quỹ / ngân sách / cấp vốn, mốc MISA', updated_at = now()
where permission_code = 'system.finance.manage';

-- ---------------------------------------------------------------------------
-- 6. Vá hàm đang chạy: người giữ quỹ công trường (tài khoản tiền), quỹ dự án tính phân bổ tháng
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_finance_cash_account_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_id uuid := nullif(p_input->>'id', '')::uuid; v_kind text := coalesce(nullif(p_input->>'kind', ''), 'bank');
  v_name text := nullif(btrim(p_input->>'name'), ''); v_active boolean := coalesce((p_input->>'isActive')::boolean, true); f public.cash_funds%rowtype;
  v_holder uuid := nullif(p_input->>'holderUserId', '')::uuid; v_holder_name text;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_name is null or v_kind not in ('cash', 'bank', 'site') or (v_kind = 'bank' and nullif(btrim(p_input->>'accountNo'), '') is null)
    or (v_kind = 'site' and nullif(p_input->>'projectId', '') is null) then
    raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_INVALID'; end if;
  -- Quỹ công trường: người giữ quỹ phải là người dùng đang hoạt động; tên hiển thị lấy theo người đó.
  if v_kind <> 'site' then v_holder := null; end if;
  if v_holder is not null then
    select name into v_holder_name from public.users where id = v_holder and coalesce(is_active, true);
    if v_holder_name is null then raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_INVALID'; end if;
  end if;
  if v_id is null then
    insert into public.cash_funds (name, currency, opening_balance, description, is_active, kind, bank_name, account_no, project_id, holder_name, note, created_by)
    values (v_name, 'VND', 0, null, true, v_kind, nullif(btrim(p_input->>'bankName'), ''), nullif(btrim(p_input->>'accountNo'), ''),
      nullif(p_input->>'projectId', ''), coalesce(v_holder_name, nullif(btrim(p_input->>'holderName'), '')), nullif(btrim(p_input->>'note'), ''), v_actor)
    returning id into v_id;
    update public.cash_funds set holder_user_id = v_holder where id = v_id;
  else
    select * into f from public.cash_funds where id = v_id for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_ACCOUNT_NOT_FOUND'; end if;
    if not v_active and (abs(app_private.finance_cash_balance(v_id)) > 0.5
      or exists (select 1 from public.finance_cash_movements m where m.status = 'submitted' and v_id in (m.from_account_id, m.to_account_id))) then
      raise exception using errcode = '22023', message = 'FINANCE_CASH_ACCOUNT_NOT_EMPTY'; end if;
    update public.cash_funds set name = v_name, kind = v_kind, bank_name = nullif(btrim(p_input->>'bankName'), ''), account_no = nullif(btrim(p_input->>'accountNo'), ''),
      project_id = nullif(p_input->>'projectId', ''), holder_name = coalesce(v_holder_name, nullif(btrim(p_input->>'holderName'), '')), note = nullif(btrim(p_input->>'note'), ''),
      holder_user_id = v_holder, is_active = v_active, updated_at = now() where id = v_id;
  end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('cash_account', v_id::text, case when p_input->>'id' is null then 'cash_account_create' else 'cash_account_update' end, v_actor,
    jsonb_build_object('name', v_name, 'kind', v_kind, 'accountNo', p_input->>'accountNo', 'active', v_active));
  if v_holder is not null and v_holder is distinct from f.holder_user_id then
    perform app_private.finance_notify_link(array[v_holder], 'Bạn được giao giữ quỹ công trường', v_name || ' — ghi các khoản chi kèm ảnh hóa đơn ở "Quỹ công trường của tôi".',
      '/#/site-fund', 'site_fund', v_actor);
  end if;
  return jsonb_build_object('id', v_id);
end $function$;

CREATE OR REPLACE FUNCTION public.get_finance_cash_v1(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'projectId', f.project_id, 'projectCode', (select code from public.projects p where p.id = f.project_id), 'holderName', f.holder_name, 'holderUserId', f.holder_user_id, 'note', f.note,
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
end $function$;

CREATE OR REPLACE FUNCTION app_private.finance_project_fund_rows(p_project text)
 RETURNS TABLE(entry_date date, kind text, code text, description text, amount numeric, source_type text, source_id text, reversal boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with site as (select f.id from public.cash_funds f where f.kind = 'site' and f.project_id = p_project),
  e as (select x.* from public.finance_cash_entries x where x.account_id not in (select id from site))
  select e.entry_date,
    case e.source_type when 'customer_receipt' then 'customer_receipt' when 'advance_refund' then 'advance_refund' when 'cash_movement' then 'other_receipt'
      when 'external_payment' then 'supplier_payment' else case r.kind when 'expense' then 'expense' else 'supplier_payment' end end,
    e.code, e.description, case e.direction when 'in' then e.amount else -e.amount end, e.source_type, e.source_id, e.reversal_of is not null
  from e left join public.finance_payment_requests r on e.source_type = 'payment_request' and r.id::text = e.source_id
  where (e.project_id = p_project and e.source_type in ('customer_receipt', 'advance_refund', 'cash_movement', 'external_payment'))
    or (e.source_type = 'payment_request' and r.kind in ('expense', 'advance') and r.project_id = p_project)
  union all
  select e.entry_date, 'supplier_payment', e.code, e.description, case e.direction when 'in' then 1 else -1 end * l.amount, e.source_type, e.source_id,
    e.reversal_of is not null
  from e join public.finance_payment_requests r on e.source_type = 'payment_request' and r.id::text = e.source_id and r.kind = 'payable'
  cross join lateral (select sum(x.amount) amount from public.finance_payment_request_lines x where x.request_id = r.id and x.project_id = p_project) l
  where l.amount is not null
  union all
  select e.entry_date, 'site_transfer', e.code, e.description, case e.direction when 'in' then e.amount else -e.amount end, e.source_type, e.source_id,
    e.reversal_of is not null
  from e join public.finance_cash_movements m on e.source_type = 'cash_transfer' and m.id::text = e.source_id
  where (m.to_account_id in (select id from site) and e.account_id = m.from_account_id)
    or (m.from_account_id in (select id from site) and e.account_id = m.to_account_id)
  union all
  select c.entry_date, case c.kind when 'topup' then 'capital' else 'capital_return' end, c.code, c.reason,
    case c.kind when 'topup' then c.amount else -c.amount end, 'capital', c.id::text, false
  from public.finance_project_capital c where c.project_id = p_project and c.status = 'posted'
  union all
  select ((r.period_month + interval '1 month')::date - 1), 'allocation', r.code, case l.kind when 'salary' then 'Phân bổ lương nhân viên công trường' else 'Phân bổ chi phí chung công ty' end
    || ' tháng ' || to_char(r.period_month, 'MM/YYYY'), -l.amount, 'allocation', r.id::text, false
  from public.finance_allocation_runs r join public.finance_allocation_lines l on l.run_id = r.id
  where l.project_id = p_project and r.status in ('confirmed', 'reversed') and l.amount <> 0
  union all
  select (r.reversed_at at time zone 'Asia/Ho_Chi_Minh')::date, 'allocation', r.code, 'Đảo phân bổ tháng ' || to_char(r.period_month, 'MM/YYYY') || ': ' || r.reverse_reason,
    l.amount, 'allocation', r.id::text, true
  from public.finance_allocation_runs r join public.finance_allocation_lines l on l.run_id = r.id
  where l.project_id = p_project and r.status = 'reversed' and l.amount <> 0;
$function$;

CREATE OR REPLACE FUNCTION app_private.finance_project_fund(p_project text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with o as (select x.balance, x.cutover_date from public.finance_project_fund_openings x where x.project_id = p_project and x.status = 'confirmed'),
  r as (select x.* from app_private.finance_project_fund_rows(p_project) x where x.entry_date >= (select ap_cutover_date from public.finance_settings where id = 1))
  select jsonb_build_object('opening', (select balance from o), 'openingDate', (select cutover_date from o),
    'received', coalesce((select sum(amount) from r where kind = 'customer_receipt'), 0),
    'otherIn', coalesce((select sum(amount) from r where kind in ('advance_refund', 'other_receipt')), 0),
    'spent', coalesce((select -sum(amount) from r where kind in ('supplier_payment', 'expense', 'site_transfer', 'allocation')), 0),
    'capital', coalesce((select sum(amount) from r where kind in ('capital', 'capital_return')), 0),
    'flow', coalesce((select sum(amount) from r), 0),
    'balance', (select balance from o) + coalesce((select sum(amount) from r), 0));
$function$;


notify pgrst, 'reload schema';
