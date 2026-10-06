-- ===========================================================================
-- Nhập sao kê ngân hàng + tự khớp với sổ thu chi (06/10/2026) — doc 15 mục 2 dòng "Tiền & ngân hàng", ưu tiên 3.
-- * Kế toán (Ghi nhận) nhập file Excel sao kê của một tài khoản ngân hàng; dòng đã nhập trước (cùng ngày, chiều, số tiền, số tham chiếu, nội dung) tự bỏ.
-- * Tự khớp: dòng sao kê ↔ một dòng sổ thu chi cùng tài khoản, cùng chiều, cùng số tiền, lệch ngày ≤ 5 ngày; nhiều ứng viên ngang nhau thì để người chọn.
-- * Dòng chưa khớp: chọn dòng sổ để khớp, bỏ qua (có lý do), hoặc lập phiếu thu / chi từ dòng đó rồi khớp lại.
-- * Dòng sổ chưa thấy trên sao kê trong kỳ của file → cảnh báo (có thể ghi nhầm tài khoản / chưa chi thật).
-- * Huỷ cả lô (Xác nhận, có lý do) khi nhập nhầm tài khoản / nhầm file; lưu đủ dòng đã xoá trong nhật ký.
-- ===========================================================================

create table public.finance_bank_statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.cash_funds(id),
  file_name text,
  file_path text,
  period_from date,
  period_to date,
  closing_balance numeric(18, 2),
  line_count integer not null default 0,
  duplicate_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text
);
create index finance_bank_statements_account_idx on public.finance_bank_statements (account_id, created_at desc);

create table public.finance_bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.finance_bank_statements(id) on delete cascade,
  account_id uuid not null references public.cash_funds(id),
  line_no integer not null,
  txn_date date not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(18, 2) not null check (amount > 0),
  description text,
  reference text,
  counterparty text,
  balance_after numeric(18, 2),
  dedupe_key text not null,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  matched_entry_id uuid references public.finance_cash_entries(id),
  match_kind text check (match_kind in ('auto', 'manual')),
  matched_by uuid,
  matched_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create unique index finance_bank_lines_dedupe_key on public.finance_bank_statement_lines (account_id, dedupe_key);
create unique index finance_bank_lines_entry_key on public.finance_bank_statement_lines (matched_entry_id) where matched_entry_id is not null;
create index finance_bank_lines_open_idx on public.finance_bank_statement_lines (account_id, status, txn_date);

alter table public.finance_bank_statements enable row level security;
alter table public.finance_bank_statement_lines enable row level security;
create policy finance_bank_statements_select on public.finance_bank_statements for select to authenticated using (app_private.finance_can('view'));
create policy finance_bank_statement_lines_select on public.finance_bank_statement_lines for select to authenticated using (app_private.finance_can('view'));
revoke all on public.finance_bank_statements, public.finance_bank_statement_lines from anon;
grant select on public.finance_bank_statements, public.finance_bank_statement_lines to authenticated;

-- Tự khớp các dòng chưa khớp của một tài khoản. Trả số dòng vừa khớp.
create function app_private.finance_bank_auto_match(p_account uuid, p_actor uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare l record; v_best uuid; v_n integer := 0; v_cnt integer;
begin
  for l in select * from public.finance_bank_statement_lines where account_id = p_account and status = 'unmatched' order by txn_date, line_no loop
    with c as (
      select e.id, abs(e.entry_date - l.txn_date) gap,
        (e.code is not null and length(e.code) >= 4 and position(upper(e.code) in upper(coalesce(l.description, '') || ' ' || coalesce(l.reference, ''))) > 0) code_hit
      from public.finance_cash_entries e
      where e.account_id = p_account and e.direction = l.direction and e.amount = l.amount and abs(e.entry_date - l.txn_date) <= 5
        and not exists (select 1 from public.finance_bank_statement_lines x where x.matched_entry_id = e.id)
    ), r as (select c.*, rank() over (order by code_hit desc, gap) rk from c)
    select (array_agg(id))[1], count(*) into v_best, v_cnt from r where rk = 1;
    if v_cnt = 1 then
      update public.finance_bank_statement_lines set status = 'matched', matched_entry_id = v_best, match_kind = 'auto', matched_by = p_actor, matched_at = now()
      where id = l.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;

create function public.import_finance_bank_statement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_acc public.cash_funds%rowtype; v_rows jsonb := p_input->'rows'; v_bad text; v_id uuid := gen_random_uuid();
  r jsonb; v_key text; v_n integer := 0; v_dup integer := 0; v_matched integer; v_from date; v_to date; v_close numeric;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into v_acc from public.cash_funds where id = nullif(p_input->>'accountId', '')::uuid and is_active;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_ACCOUNT_REQUIRED'; end if;
  if v_acc.kind <> 'bank' then raise exception using errcode = '22023', message = 'FINANCE_BANK_ACCOUNT_ONLY'; end if;
  if jsonb_typeof(v_rows) is distinct from 'array' or jsonb_array_length(v_rows) = 0 then raise exception using errcode = '22023', message = 'FINANCE_BANK_EMPTY'; end if;
  if jsonb_array_length(v_rows) > 5000 then raise exception using errcode = '22023', message = 'FINANCE_BANK_TOO_MANY'; end if;
  select string_agg('dòng ' || coalesce(x->>'row', o::text), ', ') into v_bad
  from jsonb_array_elements(v_rows) with ordinality t(x, o)
  where coalesce(x->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(x->>'direction', '') not in ('in', 'out')
    or case when coalesce(x->>'amount', '') ~ '^\d+(\.\d+)?$' then (x->>'amount')::numeric <= 0 else true end;
  if v_bad is not null then raise exception using errcode = '22023', message = 'FINANCE_BANK_ROWS_INVALID', detail = left(v_bad, 300); end if;
  perform pg_advisory_xact_lock(hashtext('finance_bank_import:' || v_acc.id));
  select min((x->>'date')::date), max((x->>'date')::date) into v_from, v_to from jsonb_array_elements(v_rows) x;
  -- Số dư cuối kỳ: lấy từ dòng cuối có số dư (theo thứ tự trong file), hoặc người nhập khai.
  v_close := coalesce(nullif(p_input->>'closingBalance', '')::numeric,
    (select (x->>'balance')::numeric from jsonb_array_elements(v_rows) with ordinality t(x, o) where coalesce(x->>'balance', '') ~ '^-?\d+(\.\d+)?$' order by (x->>'date')::date desc, o desc limit 1));
  insert into public.finance_bank_statements (id, account_id, file_name, file_path, period_from, period_to, closing_balance, created_by)
  values (v_id, v_acc.id, nullif(btrim(coalesce(p_input->>'fileName', '')), ''), nullif(p_input->>'filePath', ''), v_from, v_to, v_close, v_actor);
  for r in select value from jsonb_array_elements(v_rows) loop
    v_key := (r->>'date') || '|' || (r->>'direction') || '|' || round((r->>'amount')::numeric, 2)::text || '|' || coalesce(nullif(btrim(r->>'reference'), ''), '')
      || '|' || md5(lower(regexp_replace(coalesce(r->>'description', ''), '\s+', ' ', 'g')));
    insert into public.finance_bank_statement_lines (statement_id, account_id, line_no, txn_date, direction, amount, description, reference, counterparty, balance_after, dedupe_key)
    values (v_id, v_acc.id, coalesce((r->>'row')::integer, v_n + v_dup + 1), (r->>'date')::date, r->>'direction', round((r->>'amount')::numeric, 2),
      nullif(btrim(r->>'description'), ''), nullif(btrim(r->>'reference'), ''), nullif(btrim(r->>'counterparty'), ''),
      case when coalesce(r->>'balance', '') ~ '^-?\d+(\.\d+)?$' then (r->>'balance')::numeric end, v_key)
    on conflict (account_id, dedupe_key) do nothing;
    if found then v_n := v_n + 1; else v_dup := v_dup + 1; end if;
  end loop;
  update public.finance_bank_statements set line_count = v_n, duplicate_count = v_dup where id = v_id;
  v_matched := app_private.finance_bank_auto_match(v_acc.id, v_actor);
  insert into public.finance_events (entity_type, entity_id, action, actor_id, payload)
  values ('bank_statement', v_id::text, 'bank_statement_import', v_actor,
    jsonb_build_object('accountId', v_acc.id, 'fileName', p_input->>'fileName', 'lines', v_n, 'duplicates', v_dup, 'matched', v_matched));
  return jsonb_build_object('statementId', v_id, 'inserted', v_n, 'duplicates', v_dup, 'matched', v_matched);
end $$;

create function public.get_finance_bank_statement_v1(p_input jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_acc public.cash_funds%rowtype; v_from date; v_to date; v_last record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_acc from public.cash_funds where id = nullif(p_input->>'accountId', '')::uuid;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CASH_ACCOUNT_REQUIRED'; end if;
  select min(l.txn_date), max(l.txn_date) into v_from, v_to from public.finance_bank_statement_lines l where l.account_id = v_acc.id;
  select s.closing_balance, s.period_to into v_last from public.finance_bank_statements s
  where s.account_id = v_acc.id and s.cancelled_at is null and s.closing_balance is not null order by s.period_to desc nulls last, s.created_at desc limit 1;
  return jsonb_build_object('account', jsonb_build_object('id', v_acc.id, 'name', v_acc.name, 'kind', v_acc.kind, 'bankName', v_acc.bank_name, 'accountNo', v_acc.account_no),
    'can', jsonb_build_object('record', app_private.finance_can('record'), 'confirm', app_private.finance_can('confirm')),
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'statementBalance', case when v_last.period_to is not null then jsonb_build_object('date', v_last.period_to, 'balance', v_last.closing_balance,
      'book', app_private.finance_cash_balance(v_acc.id, v_last.period_to)) end,
    'counts', (select jsonb_build_object('total', count(*), 'matched', count(*) filter (where status = 'matched'), 'unmatched', count(*) filter (where status = 'unmatched'),
        'ignored', count(*) filter (where status = 'ignored'), 'unmatchedIn', coalesce(sum(amount) filter (where status = 'unmatched' and direction = 'in'), 0),
        'unmatchedOut', coalesce(sum(amount) filter (where status = 'unmatched' and direction = 'out'), 0))
      from public.finance_bank_statement_lines where account_id = v_acc.id),
    'statements', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'fileName', s.file_name, 'filePath', s.file_path, 'from', s.period_from, 'to', s.period_to,
        'lines', s.line_count, 'duplicates', s.duplicate_count, 'closingBalance', s.closing_balance, 'createdAt', s.created_at,
        'createdBy', (select u.name from public.users u where u.id = s.created_by), 'cancelledAt', s.cancelled_at,
        'cancelledBy', (select u.name from public.users u where u.id = s.cancelled_by), 'cancelReason', s.cancel_reason) order by s.created_at desc)
      from public.finance_bank_statements s where s.account_id = v_acc.id), '[]'::jsonb),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'statementId', l.statement_id, 'row', l.line_no, 'date', l.txn_date, 'direction', l.direction, 'amount', l.amount,
        'description', l.description, 'reference', l.reference, 'counterparty', l.counterparty, 'balance', l.balance_after, 'status', l.status, 'matchKind', l.match_kind,
        'note', l.note,
        'entry', case when e.id is not null then jsonb_build_object('id', e.id, 'date', e.entry_date, 'code', e.code, 'sourceType', e.source_type, 'description', e.description,
          'counterparty', e.counterparty) end,
        'candidates', case when l.status = 'unmatched' then coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'date', c.entry_date, 'code', c.code, 'sourceType', c.source_type,
            'description', c.description, 'counterparty', c.counterparty, 'amount', c.amount) order by (c.amount = l.amount) desc, abs(c.entry_date - l.txn_date))
          from (select c2.* from public.finance_cash_entries c2 where c2.account_id = l.account_id and c2.direction = l.direction
            and not exists (select 1 from public.finance_bank_statement_lines x where x.matched_entry_id = c2.id)
            and abs(c2.entry_date - l.txn_date) <= 31 and (c2.amount = l.amount or abs(c2.amount - l.amount) <= greatest(l.amount * 0.02, 50000))
            order by (c2.amount = l.amount) desc, abs(c2.entry_date - l.txn_date) limit 5) c), '[]'::jsonb) end)
        order by (l.status = 'unmatched') desc, l.txn_date desc, l.line_no)
      from (select * from public.finance_bank_statement_lines where account_id = v_acc.id order by (status = 'unmatched') desc, txn_date desc limit 1000) l
      left join public.finance_cash_entries e on e.id = l.matched_entry_id), '[]'::jsonb),
    -- Dòng sổ trong kỳ sao kê đã nhập mà không thấy trên sao kê.
    'bookOnly', case when v_from is not null then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.entry_date, 'direction', e.direction, 'amount', e.amount,
        'code', e.code, 'sourceType', e.source_type, 'description', e.description, 'counterparty', e.counterparty) order by e.entry_date desc)
      from public.finance_cash_entries e where e.account_id = v_acc.id and e.entry_date between v_from and v_to
        and not exists (select 1 from public.finance_bank_statement_lines x where x.matched_entry_id = e.id)), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Khớp / bỏ khớp / bỏ qua / bỏ "bỏ qua" / tự khớp lại.
create function public.decide_finance_bank_line_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); l public.finance_bank_statement_lines%rowtype; e public.finance_cash_entries%rowtype;
  v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_action = 'rematch' then
    v_n := app_private.finance_bank_auto_match(nullif(p_input->>'accountId', '')::uuid, v_actor);
    return jsonb_build_object('matched', v_n);
  end if;
  select * into l from public.finance_bank_statement_lines where id = nullif(p_input->>'lineId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_BANK_LINE_NOT_FOUND'; end if;
  if v_action = 'match' then
    if l.status <> 'unmatched' then raise exception using errcode = '22023', message = 'FINANCE_BANK_LINE_STATE'; end if;
    select * into e from public.finance_cash_entries where id = nullif(p_input->>'entryId', '')::uuid;
    if not found or e.account_id <> l.account_id or e.direction <> l.direction then raise exception using errcode = '22023', message = 'FINANCE_BANK_ENTRY_MISMATCH'; end if;
    if exists (select 1 from public.finance_bank_statement_lines x where x.matched_entry_id = e.id) then
      raise exception using errcode = '22023', message = 'FINANCE_BANK_ENTRY_TAKEN'; end if;
    if e.amount <> l.amount and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_BANK_AMOUNT_DIFF_REASON'; end if;
    update public.finance_bank_statement_lines set status = 'matched', matched_entry_id = e.id, match_kind = 'manual', matched_by = v_actor, matched_at = now(),
      note = case when e.amount <> l.amount then 'Sao kê ' || case when l.amount > e.amount then 'nhiều' else 'ít' end || ' hơn sổ '
        || replace(to_char(abs(l.amount - e.amount), 'FM999G999G999G990'), ',', '.') || ' đ: ' || v_reason end where id = l.id;
  elsif v_action = 'unmatch' then
    if l.status <> 'matched' then raise exception using errcode = '22023', message = 'FINANCE_BANK_LINE_STATE'; end if;
    update public.finance_bank_statement_lines set status = 'unmatched', matched_entry_id = null, match_kind = null, matched_by = null, matched_at = null, note = null where id = l.id;
  elsif v_action = 'ignore' then
    if l.status <> 'unmatched' then raise exception using errcode = '22023', message = 'FINANCE_BANK_LINE_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_bank_statement_lines set status = 'ignored', note = v_reason, matched_by = v_actor, matched_at = now() where id = l.id;
  elsif v_action = 'unignore' then
    if l.status <> 'ignored' then raise exception using errcode = '22023', message = 'FINANCE_BANK_LINE_STATE'; end if;
    update public.finance_bank_statement_lines set status = 'unmatched', note = null, matched_by = null, matched_at = null where id = l.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('bank_line', l.id::text, 'bank_line_' || v_action, v_actor, v_reason, jsonb_build_object('entryId', p_input->>'entryId', 'amount', l.amount, 'date', l.txn_date));
  return jsonb_build_object('lineId', l.id, 'action', v_action);
end $$;

create function public.cancel_finance_bank_statement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); s public.finance_bank_statements%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_rows jsonb; v_n integer;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into s from public.finance_bank_statements where id = nullif(p_input->>'statementId', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_BANK_STATEMENT_NOT_FOUND'; end if;
  if s.cancelled_at is not null then raise exception using errcode = '22023', message = 'FINANCE_BANK_STATEMENT_CANCELLED'; end if;
  select jsonb_agg(to_jsonb(l) order by l.line_no) into v_rows from public.finance_bank_statement_lines l where l.statement_id = s.id;
  delete from public.finance_bank_statement_lines where statement_id = s.id;
  get diagnostics v_n = row_count;
  update public.finance_bank_statements set cancelled_at = now(), cancelled_by = v_actor, cancel_reason = v_reason where id = s.id;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, payload)
  values ('bank_statement', s.id::text, 'bank_statement_cancel', v_actor, v_reason, v_rows, jsonb_build_object('accountId', s.account_id, 'lines', v_n));
  return jsonb_build_object('statementId', s.id, 'removed', v_n);
end $$;

revoke all on function app_private.finance_bank_auto_match(uuid, uuid) from public, anon, authenticated;
revoke all on function public.import_finance_bank_statement_v1(jsonb) from public, anon;
revoke all on function public.get_finance_bank_statement_v1(jsonb) from public, anon;
revoke all on function public.decide_finance_bank_line_v1(jsonb) from public, anon;
revoke all on function public.cancel_finance_bank_statement_v1(jsonb) from public, anon;
grant execute on function public.import_finance_bank_statement_v1(jsonb) to authenticated;
grant execute on function public.get_finance_bank_statement_v1(jsonb) to authenticated;
grant execute on function public.decide_finance_bank_line_v1(jsonb) to authenticated;
grant execute on function public.cancel_finance_bank_statement_v1(jsonb) to authenticated;
