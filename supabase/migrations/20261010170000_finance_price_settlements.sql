-- ===========================================================================
-- Chốt giá NCC — giá thanh toán khác giá đặt (10/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/17-chot-gia-ncc.md — chủ SP duyệt 3 ý (10/10) + 6 câu chọn a (10/10):
--  * Kho ghi số thực nhận, Mua hàng ghi giá đặt, kế toán ghi giá thật. Không sửa đơn / phiếu kho: chênh lệch = chứng từ điều chỉnh.
--  * Chốt giá theo dòng hàng của chứng từ công nợ: kèm hóa đơn (ngăn Ghi hóa đơn) hoặc theo biên bản (chưa có hóa đơn).
--  * Duyệt: chỉ giảm → bước Kế toán trưởng (người duyệt bậc 1 ma trận); có tăng → ma trận theo tổng số tăng. Người lập / người
--    nhận hàng của chứng từ không duyệt. Hóa đơn lệch vượt dung sai (không chốt giá) cũng duyệt theo luật này.
--  * Giảm: giảm trừ vào chứng từ (không vượt phần còn nợ chưa đề nghị chi); phần vượt khi chứng từ đã trả = "NCC nợ lại",
--    tự trừ vào công nợ kế tiếp cùng NCC + cùng dự án, hoặc NCC hoàn tiền (phiếu thu, người khác xác nhận). Đang đề nghị chi → chặn.
--  * Tăng: chứng từ công nợ mới loại supplier_price_adjustment. Chi phí dự án ghi phần chênh; hàng Kho Tổng chỉ gắn nhãn.
--  * Chứng từ đã có hóa đơn giá cũ → "Chờ HĐ điều chỉnh", kế toán gắn số / file khi NCC xuất.
--  * Báo người lập PO khi chốt giá (phần chưa giao Mua hàng tự sửa đơn). Mua hàng xem giá chốt từng dòng ở chi tiết đơn.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.supplier_payable_documents drop constraint supplier_payable_documents_source_type_check;
alter table public.supplier_payable_documents add constraint supplier_payable_documents_source_type_check
  check (source_type = any (array['purchase_order', 'purchase_delivery_receipt', 'supplier_invoice_adjustment', 'site_direct_purchase',
    'supplier_delivery_statement', 'supplier_return_credit', 'opening_balance', 'manual_adjustment', 'direct_supplier_receipt',
    'subcontract_round', 'subcontract_retention', 'subcontract_opening', 'supplier_price_adjustment']));

alter table public.supplier_invoices
  add column route jsonb not null default '[]'::jsonb,
  add column step_index integer not null default 0,
  add column approvals jsonb not null default '[]'::jsonb;

create sequence public.finance_price_seq;
create sequence public.finance_supplier_credit_seq;
revoke all on sequence public.finance_price_seq, public.finance_supplier_credit_seq from public, anon, authenticated;

create table public.supplier_price_settlements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  supplier_id text not null references public.business_partners(id),
  supplier_name_snapshot text not null,
  basis text not null check (basis in ('invoice', 'agreement')),
  invoice_id uuid references public.supplier_invoices(id),
  agreement_no text,
  agreement_date date,
  reason text not null check (length(btrim(reason)) > 0),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'pending_approval' check (status in ('pending_approval', 'posted', 'rejected', 'withdrawn', 'reversed')),
  delta_gross numeric(18,2) not null,
  increase_gross numeric(18,2) not null default 0 check (increase_gross >= 0),
  route jsonb not null default '[]'::jsonb,
  step_index integer not null default 0,
  approvals jsonb not null default '[]'::jsonb,
  needs_adjustment_invoice boolean not null default false,
  adjustment_invoice jsonb,
  effects jsonb,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  reversed_by uuid references public.users(id),
  reversed_at timestamptz,
  reversal_reason text,
  updated_at timestamptz not null default now(),
  row_version bigint not null default 1,
  check (basis <> 'invoice' or invoice_id is not null),
  check (basis <> 'agreement' or agreement_date is not null),
  check (status <> 'reversed' or (reversed_at is not null and nullif(btrim(reversal_reason), '') is not null))
);
create index supplier_price_settlements_supplier_idx on public.supplier_price_settlements (supplier_id, created_at desc);
create unique index supplier_price_settlements_invoice_idx on public.supplier_price_settlements (invoice_id) where invoice_id is not null and status in ('pending_approval', 'posted');

create table public.supplier_price_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.supplier_price_settlements(id) on delete cascade,
  payable_document_id uuid not null references public.supplier_payable_documents(id),
  source_kind text not null check (source_kind in ('po_delivery_line', 'statement_line')),
  source_line_id uuid not null,
  purchase_order_id text,
  purchase_order_line_id text,
  item_name text,
  unit text,
  qty numeric(18,6) not null check (qty > 0),
  from_price numeric(18,6) not null check (from_price >= 0),
  to_price numeric(18,6) not null check (to_price >= 0),
  vat_rate numeric(5,2) not null default 0,
  delta_gross numeric(18,2) not null,
  unique (settlement_id, source_line_id)
);
create index supplier_price_settlement_lines_source_idx on public.supplier_price_settlement_lines (source_line_id);
create index supplier_price_settlement_lines_doc_idx on public.supplier_price_settlement_lines (payable_document_id);
create index supplier_price_settlement_lines_po_idx on public.supplier_price_settlement_lines (purchase_order_id) where purchase_order_id is not null;

-- NCC nợ lại: chốt giảm khi chứng từ đã trả. Còn lại = số tiền − cấn trừ đang hiệu lực − hoàn tiền (chờ xác nhận / đã xác nhận).
create table public.finance_supplier_credits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  supplier_id text not null references public.business_partners(id),
  supplier_name_snapshot text not null,
  project_id text references public.projects(id),
  construction_site_id text,
  settlement_id uuid not null references public.supplier_price_settlements(id),
  amount numeric(18,2) not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.users(id),
  cancelled_at timestamptz,
  cancel_reason text
);
create index finance_supplier_credits_supplier_idx on public.finance_supplier_credits (supplier_id) where status = 'open';

create table public.finance_supplier_credit_uses (
  id uuid primary key default gen_random_uuid(),
  credit_id uuid not null references public.finance_supplier_credits(id),
  kind text not null check (kind in ('offset', 'refund')),
  payable_document_id uuid references public.supplier_payable_documents(id),
  amount numeric(18,2) not null check (amount > 0),
  status text not null check (status in ('active', 'released', 'submitted', 'confirmed', 'rejected')),
  cash_account_id uuid,
  payment_date date,
  document_ref text,
  attachments jsonb not null default '[]'::jsonb,
  reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  check ((kind = 'offset' and payable_document_id is not null and status in ('active', 'released'))
    or (kind = 'refund' and status in ('submitted', 'confirmed', 'rejected') and payment_date is not null and cash_account_id is not null))
);
create index finance_supplier_credit_uses_credit_idx on public.finance_supplier_credit_uses (credit_id);
create index finance_supplier_credit_uses_doc_idx on public.finance_supplier_credit_uses (payable_document_id) where kind = 'offset' and status = 'active';

do $$ declare t text; begin
  foreach t in array array['supplier_price_settlements', 'supplier_price_settlement_lines', 'finance_supplier_credits', 'finance_supplier_credit_uses'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_finance_select', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Dòng giá của chứng từ, giá đang áp, chênh đã chốt
-- ---------------------------------------------------------------------------
-- Dòng hàng có giá của một chứng từ công nợ: SL thực nhận (trừ phần trả lại) + giá trên chứng từ. Dòng giá 0 bỏ qua (giá nằm ở tổng).
create function app_private.finance_price_doc_lines(p_doc uuid)
returns table (line_id uuid, kind text, item_name text, unit text, qty numeric, ordered_price numeric, vat_rate numeric, po_id text, po_line_id text)
language sql stable security definer set search_path = '' as $$
  select l.id, 'po_delivery_line', coalesce(i.name, l.item_id), coalesce(nullif(l.unit, ''), i.unit),
    greatest(coalesce(l.accepted_qty, 0) - coalesce(l.returned_qty, 0), 0), l.delivery_unit_price, coalesce(b.vat_rate, 0), l.purchase_order_id, l.purchase_order_line_id
  from public.supplier_payable_documents d join public.purchase_order_delivery_batches b on b.id::text = d.source_id
  join public.purchase_order_delivery_lines l on l.delivery_batch_id = b.id left join public.items i on i.id = l.item_id
  where d.id = p_doc and d.source_type = 'purchase_delivery_receipt' and coalesce(l.delivery_unit_price, 0) > 0
    and coalesce(l.accepted_qty, 0) - coalesce(l.returned_qty, 0) > 0
  union all
  select l.id, 'statement_line', l.item_name_snapshot, l.unit_snapshot, l.accepted_quantity, l.unit_price, coalesce(l.vat_rate, 0), null, null
  from public.supplier_payable_documents d join public.supplier_direct_delivery_lines l on l.statement_id::text = d.source_id
  where d.id = p_doc and d.source_type = 'supplier_delivery_statement' and coalesce(l.unit_price, 0) > 0
    and coalesce(l.accepted_quantity, 0) > 0 and coalesce(l.status, '') <> 'rejected';
$$;

-- Giá đang áp của một dòng: giá chốt gần nhất đã ghi, không có thì null (= giá trên chứng từ).
create function app_private.finance_price_current(p_line uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select l.to_price from public.supplier_price_settlement_lines l join public.supplier_price_settlements s on s.id = l.settlement_id
  where l.source_line_id = p_line and s.status = 'posted' order by s.decided_at desc, s.created_at desc limit 1;
$$;

-- Tổng chênh chốt giá (có VAT) của một chứng từ: giá trị theo giá chốt = ghi nợ + chênh. Tính cả bản kèm hóa đơn đang chờ duyệt
-- (số gắn của hóa đơn đó đã theo giá mới) để phần "chưa có hóa đơn" không còn dư ảo và không gắn được vào hóa đơn khác.
create function app_private.finance_doc_price_delta(p_doc uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.delta_gross), 0) from public.supplier_price_settlement_lines l join public.supplier_price_settlements s on s.id = l.settlement_id
  where l.payable_document_id = p_doc and (s.status = 'posted' or (s.status = 'pending_approval' and s.basis = 'invoice'));
$$;

create function app_private.finance_doc_price_lines_json(p_doc uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when count(*) = 0 then null else jsonb_agg(jsonb_build_object('lineId', x.line_id, 'kind', x.kind, 'itemName', x.item_name, 'unit', x.unit,
    'qty', x.qty, 'orderedPrice', x.ordered_price, 'currentPrice', coalesce(app_private.finance_price_current(x.line_id), x.ordered_price), 'vatRate', x.vat_rate,
    'pendingCode', (select s.code from public.supplier_price_settlement_lines k join public.supplier_price_settlements s on s.id = k.settlement_id
      where k.source_line_id = x.line_id and s.status = 'pending_approval' limit 1)) order by x.item_name, x.line_id) end
  from app_private.finance_price_doc_lines(p_doc) x;
$$;

-- ---------------------------------------------------------------------------
-- 3. Luồng duyệt chốt giá / hóa đơn lệch
-- ---------------------------------------------------------------------------
-- Chỉ giảm → bước bậc 1 ma trận, đổi tên "Kế toán trưởng xác nhận"; có tăng → bậc theo tổng số tăng.
create function app_private.finance_price_route(p_increase numeric, p_docs uuid[], p_creator uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_version uuid; v_rule record; s jsonb; v_ids uuid[]; v_eligible uuid[]; v_handlers uuid[]; v_steps jsonb := '[]'::jsonb; v_first boolean := true;
begin
  select id into v_version from public.finance_approval_matrix_versions where is_current;
  if coalesce(p_increase, 0) <= 0.5 then
    select * into v_rule from public.finance_approval_rules where version_id = v_version order by tier_no limit 1;
  else
    select * into v_rule from public.finance_approval_rules where version_id = v_version
      and (p_increase > min_amount or min_amount = 0) and (max_amount is null or p_increase <= max_amount) order by tier_no limit 1;
  end if;
  if not found then raise exception using errcode = 'P0001', message = 'FINANCE_MATRIX_MISSING'; end if;
  select coalesce(array_agg(distinct h), '{}'::uuid[]) into v_handlers from unnest(coalesce(p_docs, '{}'::uuid[])) d cross join lateral unnest(app_private.finance_doc_handlers(d)) h;
  for s in select value from jsonb_array_elements(v_rule.steps) loop
    exit when coalesce(p_increase, 0) <= 0.5 and not v_first;
    v_first := false;
    select coalesce(array_agg((x)::uuid), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(s->'approverIds') x;
    select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_eligible
    from (select unnest(v_ids) u union select unnest(app_private.finance_active_delegates(i)) from unnest(v_ids) i) q
    join public.users usr on usr.id = q.u and coalesce(usr.is_active, true)
    where q.u is distinct from p_creator and not (q.u = any(v_handlers));
    if cardinality(v_eligible) = 0 then
      raise exception using errcode = '22023', message = 'FINANCE_PRICE_NO_APPROVER', detail = s->>'label'; end if;
    v_steps := v_steps || jsonb_build_object('label', case when coalesce(p_increase, 0) <= 0.5 then 'Kế toán trưởng xác nhận' else s->>'label' end,
      'approverIds', to_jsonb(v_ids), 'eligibleIds', to_jsonb(v_eligible),
      'eligibleNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_eligible) i));
  end loop;
  return v_steps;
end $$;

create function app_private.finance_price_can_decide(p_route jsonb, p_step integer, p_approvals jsonb, p_creator uuid, p_docs uuid[], p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_actor is not null and p_actor is distinct from p_creator and p_step < jsonb_array_length(coalesce(p_route, '[]'::jsonb))
    and (p_actor::text in (select jsonb_array_elements_text(p_route->p_step->'eligibleIds'))
      or exists (select 1 from jsonb_array_elements_text(p_route->p_step->'approverIds') a where p_actor = any(app_private.finance_active_delegates(a::uuid))))
    and not (p_actor = any(select unnest(app_private.finance_doc_handlers(d)) from unnest(coalesce(p_docs, '{}'::uuid[])) d))
    and not exists (select 1 from jsonb_array_elements(coalesce(p_approvals, '[]'::jsonb)) x where x->>'actorId' = p_actor::text);
$$;

create function app_private.finance_price_steps_json(p_route jsonb, p_step integer, p_approvals jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', r.value->>'label', 'names', coalesce(r.value->'eligibleNames', '[]'::jsonb),
    'doneByName', (select x->>'actorName' from jsonb_array_elements(coalesce(p_approvals, '[]'::jsonb)) x where (x->>'step')::integer = r.ord - 1 limit 1),
    'doneAt', (select x->>'at' from jsonb_array_elements(coalesce(p_approvals, '[]'::jsonb)) x where (x->>'step')::integer = r.ord - 1 limit 1)) order by r.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_route, '[]'::jsonb)) with ordinality r(value, ord);
$$;

-- ---------------------------------------------------------------------------
-- 4. Dựng dòng chốt giá (kiểm từng dòng) — trả về tổng chênh + phần tăng
-- ---------------------------------------------------------------------------
create function app_private.finance_price_build_lines(p_settlement uuid, p_supplier text, p_prices jsonb, p_docs_allowed uuid[])
returns table (delta numeric, increase numeric) language plpgsql security definer set search_path = '' as $$
declare a jsonb; d record; x record; v_price numeric; v_cur numeric; v_delta numeric; v_seen uuid[] := '{}'; v_total numeric := 0; v_inc numeric := 0;
begin
  if jsonb_typeof(p_prices) is distinct from 'array' or jsonb_array_length(p_prices) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_PRICE_LINES_REQUIRED'; end if;
  for a in select value from jsonb_array_elements(p_prices) loop
    select r.* into d from app_private.finance_payable_rows() r where r.id = nullif(a->>'documentId', '')::uuid;
    if not found or d.supplier_id is distinct from p_supplier or d.source_type not in ('purchase_delivery_receipt', 'supplier_delivery_statement')
      or (p_docs_allowed is not null and not d.id = any(p_docs_allowed)) then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    select * into x from app_private.finance_price_doc_lines(d.id) l where l.line_id = nullif(a->>'lineId', '')::uuid;
    if not found then raise exception using errcode = '22023', message = 'FINANCE_PRICE_LINE_INVALID', detail = coalesce(d.document_no, d.code); end if;
    if x.line_id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_PRICE_LINE_DUPLICATE'; end if;
    v_seen := v_seen || x.line_id;
    v_price := round(nullif(a->>'price', '')::numeric, 6);
    if v_price is null or v_price < 0 then raise exception using errcode = '22023', message = 'FINANCE_PRICE_INVALID', detail = x.item_name; end if;
    v_cur := coalesce(app_private.finance_price_current(x.line_id), x.ordered_price);
    if abs(v_price - v_cur) < 0.005 then raise exception using errcode = '22023', message = 'FINANCE_PRICE_UNCHANGED', detail = x.item_name; end if;
    if exists (select 1 from public.supplier_price_settlement_lines k join public.supplier_price_settlements s on s.id = k.settlement_id
        where k.source_line_id = x.line_id and s.status = 'pending_approval' and s.id <> p_settlement) then
      raise exception using errcode = '22023', message = 'FINANCE_PRICE_LINE_PENDING', detail = x.item_name; end if;
    v_delta := round(x.qty * (v_price - v_cur) * (1 + x.vat_rate / 100), 0);
    insert into public.supplier_price_settlement_lines (settlement_id, payable_document_id, source_kind, source_line_id, purchase_order_id, purchase_order_line_id,
      item_name, unit, qty, from_price, to_price, vat_rate, delta_gross)
    values (p_settlement, d.id, x.kind, x.line_id, x.po_id, x.po_line_id, x.item_name, x.unit, x.qty, v_cur, v_price, x.vat_rate, v_delta);
    v_total := v_total + v_delta; v_inc := v_inc + greatest(v_delta, 0);
  end loop;
  delta := v_total; increase := v_inc; return next;
end $$;

-- ---------------------------------------------------------------------------
-- 5. NCC nợ lại: còn lại, tự cấn trừ vào công nợ cùng NCC + cùng dự án
-- ---------------------------------------------------------------------------
create function app_private.finance_supplier_credit_remaining(p_credit uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select c.amount - coalesce((select sum(u.amount) from public.finance_supplier_credit_uses u where u.credit_id = c.id
    and ((u.kind = 'offset' and u.status = 'active') or (u.kind = 'refund' and u.status in ('submitted', 'confirmed')))), 0)
  from public.finance_supplier_credits c where c.id = p_credit and c.status = 'open';
$$;

create function app_private.finance_supplier_credit_apply_doc(p_credit uuid, p_doc uuid, p_actor uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_rem numeric := coalesce(app_private.finance_supplier_credit_remaining(p_credit), 0); b record; v_take numeric;
begin
  if v_rem <= 0.004 then return 0; end if;
  select r.* into b from app_private.finance_payable_rows() r where r.id = p_doc;
  if not found or b.status not in ('open', 'partial') then return 0; end if;
  v_take := least(v_rem, greatest(b.outstanding - b.pending_external - app_private.finance_doc_reserved(p_doc, null), 0));
  if v_take <= 0.004 then return 0; end if;
  update public.supplier_payable_documents set credit_amount = credit_amount + v_take, updated_at = now() where id = p_doc;
  insert into public.finance_supplier_credit_uses (credit_id, kind, payable_document_id, amount, status, created_by)
  values (p_credit, 'offset', p_doc, v_take, 'active', p_actor);
  perform app_private.finance_doc_refresh_status(p_doc);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  select 'supplier_credit', c.id::text, c.supplier_id, 'supplier_credit_offset', p_actor, jsonb_build_object('code', c.code, 'documentNo', b.document_no, 'amount', v_take)
  from public.finance_supplier_credits c where c.id = p_credit;
  return v_take;
end $$;

-- Một khoản nợ lại: trừ dần vào các chứng từ còn nợ cũ nhất cùng NCC + cùng phạm vi (dự án / công trường / Kho Tổng).
create function app_private.finance_supplier_credit_apply(p_credit uuid, p_actor uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare c public.finance_supplier_credits%rowtype; r record; v_total numeric := 0;
begin
  select * into c from public.finance_supplier_credits where id = p_credit and status = 'open' for update;
  if not found then return 0; end if;
  for r in select x.id from app_private.finance_payable_rows() x
    where x.supplier_id = c.supplier_id and x.status in ('open', 'partial') and x.outstanding > 0.004
      and app_private.finance_scope_key(x.project_id, x.construction_site_id) = app_private.finance_scope_key(c.project_id, c.construction_site_id)
    order by x.document_date, x.created_at loop
    exit when coalesce(app_private.finance_supplier_credit_remaining(c.id), 0) <= 0.004;
    v_total := v_total + app_private.finance_supplier_credit_apply_doc(c.id, r.id, p_actor);
  end loop;
  return v_total;
end $$;

-- Chứng từ mới ghi nợ (kho nhận hàng, bảng đối soát...) → tự trừ khoản NCC nợ lại cùng NCC + cùng dự án. Lỗi không chặn ghi nợ.
create function app_private.trg_finance_supplier_credit_auto()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c record;
begin
  if not exists (select 1 from public.finance_supplier_credits x where x.supplier_id = new.supplier_id and x.status = 'open') then return null; end if;
  begin
    for c in select x.id from public.finance_supplier_credits x where x.supplier_id = new.supplier_id and x.status = 'open'
      and app_private.finance_scope_key(x.project_id, x.construction_site_id) = app_private.finance_scope_key(new.project_id, new.construction_site_id)
      order by x.created_at loop
      perform app_private.finance_supplier_credit_apply_doc(c.id, new.id, coalesce(public.current_app_user_id(), new.created_by));
    end loop;
  exception when others then
    insert into public.finance_events (entity_type, entity_id, supplier_id, action, reason, payload)
    values ('payable_document', new.id::text, new.supplier_id, 'supplier_credit_offset_failed', sqlerrm, jsonb_build_object('documentNo', new.document_no));
  end;
  return null;
end $$;
create trigger trg_finance_supplier_credit_auto after insert or update of status on public.supplier_payable_documents
  for each row when (new.status in ('open', 'partial') and new.supplier_id is not null) execute function app_private.trg_finance_supplier_credit_auto();

-- Chứng từ bị hủy / đảo → phần đã cấn trừ trả lại khoản nợ lại (tự trừ tiếp vào chứng từ khác nếu có).
create function app_private.trg_finance_supplier_credit_release()
returns trigger language plpgsql security definer set search_path = '' as $$
declare c uuid;
begin
  for c in update public.finance_supplier_credit_uses set status = 'released', decided_at = now(), decision_note = 'Chứng từ công nợ bị hủy / đảo'
    where payable_document_id = new.id and kind = 'offset' and status = 'active' returning credit_id loop
    perform app_private.finance_supplier_credit_apply(c, coalesce(public.current_app_user_id(), new.created_by));
  end loop;
  return null;
end $$;
create trigger trg_finance_supplier_credit_release after update of status on public.supplier_payable_documents
  for each row when (new.status in ('cancelled', 'reversed') and old.status not in ('cancelled', 'reversed')) execute function app_private.trg_finance_supplier_credit_release();

-- ---------------------------------------------------------------------------
-- 6. Ghi / đảo một bản chốt giá
-- ---------------------------------------------------------------------------
create function app_private.finance_price_post(p_settlement uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.supplier_price_settlements%rowtype; g record; b record; v_avail numeric; v_take numeric; v_rest numeric; v_doc uuid; v_n integer := 0;
  v_date date; v_docs jsonb := '[]'::jsonb; v_credit numeric := 0; v_owes jsonb := '{}'::jsonb; v_inv jsonb := '[]'::jsonb; v_codes text[] := '{}';
  v_credit_ids uuid[] := '{}'; v_cid uuid; v_key text; v_po record; v_needs boolean := false;
begin
  select * into s from public.supplier_price_settlements where id = p_settlement for update;
  v_date := coalesce(s.agreement_date, (select i.invoice_date from public.supplier_invoices i where i.id = s.invoice_id), (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  for g in select l.payable_document_id doc, sum(l.delta_gross) delta, string_agg(l.item_name, ', ' order by l.item_name) items
    from public.supplier_price_settlement_lines l where l.settlement_id = s.id group by l.payable_document_id loop
    perform 1 from public.supplier_payable_documents where id = g.doc for update;
    select r.* into b from app_private.finance_payable_rows() r where r.id = g.doc;
    if not found then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if b.project_id is not null and app_private.finance_period_is_locked(b.project_id, b.construction_site_id, 'VND', v_date) then
      raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
    v_take := 0; v_rest := 0; v_doc := null;
    if g.delta < -0.5 then
      v_avail := greatest(b.outstanding - b.pending_external - app_private.finance_doc_reserved(b.id, null), 0);
      v_take := least(-g.delta, v_avail); v_rest := -g.delta - v_take;
      if v_rest > 0.5 and (b.pending_external + app_private.finance_doc_reserved(b.id, null)) > 0.5 then
        raise exception using errcode = '22023', message = 'FINANCE_PRICE_DOC_RESERVED', detail = coalesce(b.document_no, b.code); end if;
      if v_take > 0.004 then
        update public.supplier_payable_documents set credit_amount = credit_amount + v_take, updated_at = now() where id = b.id;
        perform app_private.finance_doc_refresh_status(b.id);
      end if;
      if v_rest > 0.5 then
        v_key := app_private.finance_scope_key(b.project_id, b.construction_site_id);
        v_owes := jsonb_set(v_owes, array[v_key], jsonb_build_object('project', b.project_id, 'site', b.construction_site_id,
          'amount', coalesce((v_owes->v_key->>'amount')::numeric, 0) + v_rest));
      end if;
      v_credit := v_credit + v_take;
    elsif g.delta > 0.5 then
      v_n := v_n + 1;
      insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
        document_no, document_date, committed_amount, recognized_amount, status, supplier_contract_id, supplier_contract_code, metadata, created_by)
      values ('AP-' || s.code || case when v_n > 1 then '-' || v_n else '' end, 'supplier_price_adjustment', s.id::text, b.project_id, b.construction_site_id,
        s.supplier_id, s.supplier_name_snapshot, 'Chốt giá ' || s.code || ' · ' || coalesce(b.document_no, b.code), v_date, g.delta, g.delta, 'open',
        b.contract_id, b.contract_code,
        jsonb_build_object('origin', 'price_settlement', 'settlementId', s.id, 'baseDocumentId', b.id,
          'purchaseOrderId', app_private.finance_doc_purchase_order(b.source_type, b.source_id, null)), p_actor)
      returning id into v_doc;
      v_codes := v_codes || ('AP-' || s.code || case when v_n > 1 then '-' || v_n else '' end);
    end if;
    if b.project_id is not null then
      perform app_private.finance_insert_project_cost(b.project_id, g.delta, 'Chốt giá NCC ' || s.supplier_name_snapshot || ' · ' || s.code || ' · ' || coalesce(b.document_no, b.code)
        || ' (' || g.items || ')', v_date::text, 'supplier_price_settlement:' || s.id || ':' || b.id, p_actor::text);
    else
      v_inv := v_inv || to_jsonb(coalesce(b.document_no, b.code));
    end if;
    if s.basis = 'agreement' and app_private.finance_doc_invoiced(b.id, null) > 0.5 then v_needs := true; end if;
    v_docs := v_docs || jsonb_build_object('documentId', b.id, 'documentNo', coalesce(b.document_no, b.code), 'delta', g.delta, 'credit', v_take,
      'owes', v_rest, 'increaseDocumentId', v_doc);
  end loop;
  -- Phần giảm vượt số còn nợ (chứng từ đã trả) → NCC nợ lại, theo từng dự án; trừ ngay vào chứng từ khác còn nợ cùng dự án.
  for v_key in select jsonb_object_keys(v_owes) loop
    insert into public.finance_supplier_credits (code, supplier_id, supplier_name_snapshot, project_id, construction_site_id, settlement_id, amount, created_by)
    values ('NCN-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYMM') || '-' || lpad(nextval('public.finance_supplier_credit_seq')::text, 4, '0'),
      s.supplier_id, s.supplier_name_snapshot, v_owes->v_key->>'project', v_owes->v_key->>'site', s.id, round((v_owes->v_key->>'amount')::numeric, 2), p_actor)
    returning id into v_cid;
    v_credit_ids := v_credit_ids || v_cid;
    perform app_private.finance_supplier_credit_apply(v_cid, p_actor);
  end loop;
  update public.supplier_price_settlements set status = 'posted', needs_adjustment_invoice = v_needs, decided_by = p_actor, decided_at = now(), updated_at = now(),
    row_version = row_version + 1,
    effects = jsonb_build_object('docs', v_docs, 'creditGross', v_credit, 'increaseDocCodes', to_jsonb(v_codes), 'inventoryDocs', v_inv,
      'supplierOwes', (select coalesce(sum(amount), 0) from public.finance_supplier_credits where id = any(v_credit_ids)),
      'supplierCreditIds', to_jsonb(v_credit_ids))
  where id = s.id;
  -- Báo người lập PO: giá chốt cho phần đã giao; phần chưa giao Mua hàng tự sửa đơn nếu NCC áp giá mới.
  for v_po in select po.id, po.po_number, po.created_by_id, string_agg(l.item_name || ' ' || trim(to_char(l.from_price, 'FM999G999G999G990D99')) || ' → '
      || trim(to_char(l.to_price, 'FM999G999G999G990D99')), '; ') items
    from public.supplier_price_settlement_lines l join public.purchase_orders po on po.id = l.purchase_order_id
    where l.settlement_id = s.id group by po.id, po.po_number, po.created_by_id loop
    if v_po.created_by_id ~ '^[0-9a-f-]{36}$' then
      perform app_private.finance_notify_link(array[v_po.created_by_id::uuid], 'Kế toán đã chốt giá ' || v_po.po_number,
        s.code || ': ' || v_po.items || '. Giá chốt áp cho hàng đã giao; phần chưa giao vẫn giá cũ — sửa đơn nếu NCC áp giá mới.',
        '/#/procurement?po=' || v_po.id, 'price_settlement', p_actor);
    end if;
  end loop;
  return jsonb_build_object('credit', v_credit, 'increaseDocs', to_jsonb(v_codes));
end $$;

create function app_private.finance_price_unpost(p_settlement uuid, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.supplier_price_settlements%rowtype; e jsonb; b record; v_cid uuid;
begin
  select * into s from public.supplier_price_settlements where id = p_settlement for update;
  if s.status <> 'posted' then raise exception using errcode = '22023', message = 'FINANCE_PRICE_STATE'; end if;
  -- Khoản NCC nợ lại đã cấn trừ / hoàn tiền → không đảo được (đảo phần đó trước).
  for v_cid in select (jsonb_array_elements_text(coalesce(s.effects->'supplierCreditIds', '[]'::jsonb)))::uuid loop
    if exists (select 1 from public.finance_supplier_credit_uses u where u.credit_id = v_cid
        and ((u.kind = 'offset' and u.status = 'active') or (u.kind = 'refund' and u.status in ('submitted', 'confirmed')))) then
      raise exception using errcode = '22023', message = 'FINANCE_PRICE_CREDIT_USED'; end if;
    update public.finance_supplier_credits set status = 'cancelled', cancelled_by = p_actor, cancelled_at = now(), cancel_reason = p_reason where id = v_cid;
  end loop;
  for e in select value from jsonb_array_elements(coalesce(s.effects->'docs', '[]'::jsonb)) loop
    if nullif(e->>'increaseDocumentId', '') is not null then
      select r.* into b from public.supplier_payable_document_balances r where r.id = (e->>'increaseDocumentId')::uuid;
      if coalesce(b.paid_amount, 0) > 0.5 or coalesce(b.credit_amount, 0) > 0.5 or app_private.finance_doc_reserved(b.id, null) > 0.5 then
        raise exception using errcode = '22023', message = 'FINANCE_PRICE_ADJUSTMENT_PAID', detail = b.code; end if;
      update public.supplier_payable_documents set status = 'cancelled', updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancelReason', p_reason) where id = b.id;
    end if;
    if coalesce((e->>'credit')::numeric, 0) > 0.004 then
      update public.supplier_payable_documents set credit_amount = greatest(credit_amount - (e->>'credit')::numeric, 0), updated_at = now()
      where id = (e->>'documentId')::uuid;
      perform app_private.finance_doc_refresh_status((e->>'documentId')::uuid);
    end if;
  end loop;
  perform app_private.finance_reverse_project_cost('supplier_price_settlement:' || s.id, p_reason, p_actor);
  update public.supplier_price_settlements set status = 'reversed', reversed_by = p_actor, reversed_at = now(), reversal_reason = p_reason,
    updated_at = now(), row_version = row_version + 1 where id = s.id;
end $$;

-- JSON một bản chốt giá cho màn Hóa đơn NCC (bước duyệt của bản kèm hóa đơn lấy theo hóa đơn).
create function app_private.finance_price_json(p_id uuid, p_uid uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'code', s.code, 'supplierId', s.supplier_id, 'supplierName', s.supplier_name_snapshot, 'basis', s.basis,
    'invoiceNumber', i.invoice_number, 'agreementNo', s.agreement_no, 'agreementDate', s.agreement_date, 'reason', s.reason, 'attachments', s.attachments,
    'status', s.status, 'deltaGross', s.delta_gross, 'increaseGross', s.increase_gross,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('documentId', l.payable_document_id, 'lineId', l.source_line_id,
        'documentNo', coalesce(d.document_no, d.code), 'projectCode', p.code, 'poNumber', po.po_number, 'itemName', l.item_name, 'unit', l.unit, 'qty', l.qty,
        'fromPrice', l.from_price, 'toPrice', l.to_price, 'vatRate', l.vat_rate, 'deltaGross', l.delta_gross) order by d.document_date, l.item_name)
      from public.supplier_price_settlement_lines l join public.supplier_payable_documents d on d.id = l.payable_document_id
      left join public.projects p on p.id = d.project_id left join public.purchase_orders po on po.id = l.purchase_order_id
      where l.settlement_id = s.id), '[]'::jsonb),
    'steps', case when s.basis = 'invoice' then app_private.finance_price_steps_json(i.route, i.step_index, i.approvals)
      else app_private.finance_price_steps_json(s.route, s.step_index, s.approvals) end,
    'stepIndex', case when s.basis = 'invoice' then i.step_index else s.step_index end,
    'needsAdjustmentInvoice', s.needs_adjustment_invoice, 'adjustmentInvoice', s.adjustment_invoice,
    'effects', case when s.effects is null then null else jsonb_build_object('creditGross', s.effects->'creditGross',
      'increaseDocCode', (select string_agg(x, ', ') from jsonb_array_elements_text(s.effects->'increaseDocCodes') x),
      'supplierOwes', s.effects->'supplierOwes', 'inventoryDocs', s.effects->'inventoryDocs') end,
    'createdByName', app_private.finance_user_name(s.created_by), 'createdAt', s.created_at,
    'decidedByName', app_private.finance_user_name(s.decided_by), 'decidedAt', s.decided_at, 'decisionNote', s.decision_note,
    'reversedByName', app_private.finance_user_name(s.reversed_by), 'reversedAt', s.reversed_at, 'reversalReason', s.reversal_reason, 'rowVersion', s.row_version,
    'canDecide', s.basis = 'agreement' and s.status = 'pending_approval' and app_private.finance_price_can_decide(s.route, s.step_index, s.approvals, s.created_by,
      array(select distinct payable_document_id from public.supplier_price_settlement_lines where settlement_id = s.id), p_uid),
    'canWithdraw', s.basis = 'agreement' and s.status = 'pending_approval' and s.created_by = p_uid,
    'canAttachInvoice', s.status = 'posted' and s.needs_adjustment_invoice and s.adjustment_invoice is null and app_private.finance_can('record'),
    'canReverse', s.basis = 'agreement' and s.status = 'posted' and app_private.finance_can('confirm') and s.created_by is distinct from p_uid)
  from public.supplier_price_settlements s left join public.supplier_invoices i on i.id = s.invoice_id where s.id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 7. Chốt giá theo biên bản: lập, duyệt / trả lại / rút / đảo, gắn hóa đơn điều chỉnh
-- ---------------------------------------------------------------------------
create function public.save_finance_price_agreement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_sup text := nullif(p_input->>'supplierId', ''); v_name text; v_id uuid; v_code text;
  v_date date := nullif(p_input->>'agreementDate', '')::date; v_reason text := nullif(btrim(p_input->>'reason'), ''); r record; v_route jsonb; v_docs uuid[];
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select bp.name into v_name from public.business_partners bp where bp.id = v_sup;
  if v_name is null then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_REQUIRED'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception using errcode = '22023', message = 'FINANCE_PRICE_DATE_INVALID'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_input->'attachments', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_input->'attachments', '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_PRICE_FILE_REQUIRED'; end if;
  v_code := 'CG-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYMM') || '-' || lpad(nextval('public.finance_price_seq')::text, 4, '0');
  insert into public.supplier_price_settlements (code, supplier_id, supplier_name_snapshot, basis, agreement_no, agreement_date, reason, attachments, delta_gross, created_by)
  values (v_code, v_sup, v_name, 'agreement', nullif(btrim(p_input->>'agreementNo'), ''), v_date, v_reason, p_input->'attachments', 0, v_actor)
  returning id into v_id;
  select * into r from app_private.finance_price_build_lines(v_id, v_sup, p_input->'prices', null);
  select array_agg(distinct payable_document_id) into v_docs from public.supplier_price_settlement_lines where settlement_id = v_id;
  v_route := app_private.finance_price_route(r.increase, v_docs, v_actor);
  update public.supplier_price_settlements set delta_gross = r.delta, increase_gross = r.increase, route = v_route where id = v_id;
  perform app_private.finance_notify_link(array(select jsonb_array_elements_text(v_route->0->'eligibleIds')::uuid), 'Chốt giá NCC chờ bạn duyệt',
    v_code || ' · ' || v_name || ' · ' || case when r.delta < 0 then 'giảm ' else 'tăng ' end || trim(to_char(abs(r.delta), 'FM999G999G999G990')) || ' đ — ' || (v_route->0->>'label'),
    '/#/finance?section=invoices', 'price_settlement', v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('price_settlement', v_id::text, v_sup, 'price_submitted', v_actor, v_reason, jsonb_build_object('code', v_code, 'delta', r.delta, 'increase', r.increase,
    'lines', (select count(*) from public.supplier_price_settlement_lines where settlement_id = v_id)));
  return jsonb_build_object('id', v_id, 'code', v_code, 'status', 'pending_approval', 'delta', r.delta);
end $$;

create function public.decide_finance_price_settlement_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  s public.supplier_price_settlements%rowtype; v_docs uuid[]; v_label text; v_next jsonb;
begin
  select * into s from public.supplier_price_settlements where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_PRICE_NOT_FOUND'; end if;
  if s.basis <> 'agreement' then raise exception using errcode = '22023', message = 'FINANCE_PRICE_VIA_INVOICE'; end if;
  if (p_input->>'expectedRowVersion')::bigint is distinct from s.row_version then raise exception using errcode = '40001', message = 'FINANCE_STALE'; end if;
  select array_agg(distinct payable_document_id) into v_docs from public.supplier_price_settlement_lines where settlement_id = s.id;
  if v_action in ('approve', 'reject') then
    if s.status <> 'pending_approval' then raise exception using errcode = '22023', message = 'FINANCE_PRICE_STATE'; end if;
    if not app_private.finance_price_can_decide(s.route, s.step_index, s.approvals, s.created_by, v_docs, v_actor) then
      raise exception using errcode = '42501', message = 'FINANCE_NOT_APPROVER'; end if;
    v_label := s.route->s.step_index->>'label';
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.supplier_price_settlements set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason,
        updated_at = now(), row_version = row_version + 1 where id = s.id;
      perform app_private.finance_notify_link(array[s.created_by], 'Chốt giá bị trả lại', s.code || ': ' || v_reason, '/#/finance?section=invoices', 'price_settlement', v_actor);
    else
      update public.supplier_price_settlements set approvals = approvals || jsonb_build_object('step', s.step_index, 'label', v_label, 'actorId', v_actor,
        'actorName', app_private.finance_user_name(v_actor), 'at', now()), step_index = step_index + 1, updated_at = now() where id = s.id;
      if s.step_index + 1 >= jsonb_array_length(s.route) then
        perform app_private.finance_price_post(s.id, v_actor);
        perform app_private.finance_notify_link(array[s.created_by], 'Chốt giá đã duyệt', s.code || ' · ' || s.supplier_name_snapshot || ' — công nợ và chi phí đã điều chỉnh.',
          '/#/finance?section=invoices', 'price_settlement', v_actor);
      else
        update public.supplier_price_settlements set row_version = row_version + 1 where id = s.id;
        v_next := s.route->(s.step_index + 1);
        perform app_private.finance_notify_link(array(select jsonb_array_elements_text(v_next->'eligibleIds')::uuid), 'Chốt giá NCC chờ bạn duyệt',
          s.code || ' · ' || s.supplier_name_snapshot || ' — ' || (v_next->>'label'), '/#/finance?section=invoices', 'price_settlement', v_actor);
      end if;
    end if;
  elsif v_action = 'withdraw' then
    if s.status <> 'pending_approval' or s.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_WITHDRAW_DENIED'; end if;
    update public.supplier_price_settlements set status = 'withdrawn', decided_at = now(), decision_note = v_reason, updated_at = now(), row_version = row_version + 1 where id = s.id;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if s.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SAME_PERSON'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    perform app_private.finance_price_unpost(s.id, v_actor, v_reason);
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('price_settlement', s.id::text, s.supplier_id, 'price_' || v_action, v_actor, v_reason, jsonb_build_object('code', s.code, 'delta', s.delta_gross, 'step', s.step_index));
  select * into s from public.supplier_price_settlements where id = s.id;
  return jsonb_build_object('id', s.id, 'action', v_action, 'status', s.status);
end $$;

create function public.attach_finance_price_adjustment_invoice_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); s public.supplier_price_settlements%rowtype; v_no text := nullif(btrim(p_input->>'number'), '');
  v_date date := nullif(p_input->>'date', '')::date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into s from public.supplier_price_settlements where id = nullif(p_input->>'id', '')::uuid for update;
  if not found or s.status <> 'posted' or not s.needs_adjustment_invoice or s.adjustment_invoice is not null then
    raise exception using errcode = '22023', message = 'FINANCE_PRICE_STATE'; end if;
  if (p_input->>'expectedRowVersion')::bigint is distinct from s.row_version then raise exception using errcode = '40001', message = 'FINANCE_STALE'; end if;
  if v_no is null or v_date is null or v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_HEADER_INVALID'; end if;
  if jsonb_typeof(coalesce(p_input->'attachments', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_input->'attachments', '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_INVOICE_FILE_REQUIRED'; end if;
  update public.supplier_price_settlements set adjustment_invoice = jsonb_build_object('number', v_no, 'date', v_date, 'attachments', p_input->'attachments',
    'byName', app_private.finance_user_name(v_actor), 'byId', v_actor, 'at', now()), updated_at = now(), row_version = row_version + 1 where id = s.id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('price_settlement', s.id::text, s.supplier_id, 'price_adjustment_invoice', v_actor, jsonb_build_object('code', s.code, 'number', v_no, 'date', v_date));
  return jsonb_build_object('id', s.id);
end $$;

-- ---------------------------------------------------------------------------
-- 8. NCC hoàn tiền khoản nợ lại: kế toán ghi phiếu thu → người khác xác nhận → sổ thu chi + dòng tiền dự án
-- ---------------------------------------------------------------------------
create function public.save_finance_supplier_credit_refund_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); c public.finance_supplier_credits%rowtype; v_amount numeric := round(nullif(p_input->>'amount', '')::numeric, 2);
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), ''); v_id uuid;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  select * into c from public.finance_supplier_credits where id = nullif(p_input->>'creditId', '')::uuid and status = 'open' for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_CREDIT_NOT_FOUND'; end if;
  if v_amount is null or v_amount <= 0 or v_amount > coalesce(app_private.finance_supplier_credit_remaining(c.id), 0) + 0.005 then
    raise exception using errcode = '22023', message = 'FINANCE_CREDIT_OVER'; end if;
  if v_date is null or v_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date or v_ref is null then raise exception using errcode = '22023', message = 'FINANCE_CREDIT_REFUND_INVALID'; end if;
  perform app_private.finance_cash_require_account(nullif(p_input->>'cashAccountId', '')::uuid);
  insert into public.finance_supplier_credit_uses (credit_id, kind, amount, status, cash_account_id, payment_date, document_ref, attachments, reason, created_by)
  values (c.id, 'refund', v_amount, 'submitted', (p_input->>'cashAccountId')::uuid, v_date, v_ref, coalesce(p_input->'attachments', '[]'::jsonb), nullif(btrim(p_input->>'note'), ''), v_actor)
  returning id into v_id;
  perform app_private.finance_notify_link((select array_agg(u) from unnest(app_private.finance_confirm_users()) u), 'NCC hoàn tiền — chờ xác nhận',
    c.code || ' · ' || c.supplier_name_snapshot || ' · ' || trim(to_char(v_amount, 'FM999G999G999G990')) || ' đ', '/#/finance?section=invoices', 'supplier_credit', v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('supplier_credit', c.id::text, c.supplier_id, 'supplier_credit_refund_submitted', v_actor, jsonb_build_object('code', c.code, 'amount', v_amount, 'ref', v_ref));
  return jsonb_build_object('id', v_id);
end $$;

create function public.decide_finance_supplier_credit_refund_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); u public.finance_supplier_credit_uses%rowtype; c public.finance_supplier_credits%rowtype;
  v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), ''); v_finance text; v_ref text;
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into u from public.finance_supplier_credit_uses where id = nullif(p_input->>'id', '')::uuid and kind = 'refund' for update;
  if not found or u.status <> 'submitted' then raise exception using errcode = '22023', message = 'FINANCE_ADJUSTMENT_STATE'; end if;
  if u.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SELF_CONFIRM'; end if;
  select * into c from public.finance_supplier_credits where id = u.credit_id;
  if v_action = 'reject' then
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.finance_supplier_credit_uses set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = u.id;
  elsif v_action = 'confirm' then
    if c.project_id is not null and app_private.finance_period_is_locked(c.project_id, c.construction_site_id, 'VND', u.payment_date) then
      raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
    -- Tiền NCC trả lại = dòng tiền ra âm của dự án (nhóm supplier_payment_batch:…), không đụng chi phí (đã giảm khi chốt giá).
    if c.project_id is not null or c.construction_site_id is not null then
      select f.id into v_finance from public.project_finances f
      where (c.project_id is not null and f.project_id = c.project_id) or (c.construction_site_id is not null and f.construction_site_id = c.construction_site_id)
      order by case when c.project_id is not null and f.project_id = c.project_id then 0 else 1 end, f.id limit 1;
      v_ref := 'supplier_payment_batch:credit_refund:' || u.id::text;
      insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
        type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id)
      values ('supplier-credit-refund-' || u.id::text, coalesce(v_finance, ''), coalesce(c.construction_site_id, ''), c.project_id, v_finance, c.construction_site_id,
        'expense', 'materials', -u.amount, 'NCC hoàn tiền chốt giá ' || c.supplier_name_snapshot || ' - ' || c.code || ' · ' || u.document_ref, u.payment_date::text, 'workflow',
        v_ref, v_ref, u.attachments, v_actor::text, now(), c.supplier_name_snapshot, c.supplier_id);
    end if;
    perform app_private.finance_cash_entry(app_private.finance_cash_require_account(u.cash_account_id), u.payment_date, 'in', u.amount, 'supplier_credit_refund', u.id::text,
      c.code || ' · ' || u.document_ref, 'NCC hoàn tiền chốt giá ' || c.supplier_name_snapshot, c.supplier_name_snapshot, c.project_id, v_actor);
    update public.finance_supplier_credit_uses set status = 'confirmed', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = u.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  perform app_private.finance_notify_link(array[u.created_by], case v_action when 'confirm' then 'Đã xác nhận NCC hoàn tiền' else 'Phiếu NCC hoàn tiền bị trả lại' end,
    c.code || coalesce(': ' || v_reason, ''), '/#/finance?section=invoices', 'supplier_credit', v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('supplier_credit', c.id::text, c.supplier_id, 'supplier_credit_refund_' || v_action, v_actor, v_reason, jsonb_build_object('code', c.code, 'amount', u.amount));
  return jsonb_build_object('id', u.id, 'action', v_action);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Hóa đơn NCC (K3c) — thêm giá chốt theo dòng + duyệt theo luồng
-- ---------------------------------------------------------------------------
create or replace function public.save_finance_invoice_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_id uuid := nullif(p_input->>'id', '')::uuid; o public.supplier_invoices%rowtype;
  v_sup text := nullif(p_input->>'supplierId', ''); v_name text; v_no text := nullif(btrim(p_input->>'invoiceNumber'), ''); v_date date := nullif(p_input->>'invoiceDate', '')::date;
  v_net numeric := round(coalesce(nullif(p_input->>'netAmount', '')::numeric, 0), 2); v_vat numeric := round(coalesce(nullif(p_input->>'vatAmount', '')::numeric, 0), 2);
  v_gross numeric := round(coalesce(nullif(p_input->>'grossAmount', '')::numeric, 0), 2); v_lines jsonb := coalesce(p_input->'lines', '[]'::jsonb);
  v_prices jsonb := coalesce(p_input->'prices', '[]'::jsonb);
  v_reason text := nullif(btrim(p_input->>'reason'), ''); a jsonb; d record; v_amt numeric; v_exp numeric := 0; v_var numeric; v_tol numeric; v_status text;
  v_seen uuid[] := '{}'; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_ps uuid; v_pr record; v_pdelta numeric; v_route jsonb := '[]'::jsonb; v_inc numeric := 0;
  v_code text;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_id is not null then
    select * into o from public.supplier_invoices where id = v_id for update;
    if not found or o.status not in ('awaiting_goods', 'pending_approval') then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_STATE'; end if;
    if o.status = 'pending_approval' and o.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_INVOICE_NOT_OWNER'; end if;
    if (p_input->>'expectedRowVersion')::bigint is distinct from o.row_version then raise exception using errcode = '40001', message = 'FINANCE_STALE'; end if;
    v_sup := o.supplier_id;
    -- Sửa hóa đơn chờ duyệt: bản chốt giá cũ đi kèm bỏ, dựng lại theo giá mới.
    update public.supplier_price_settlements set status = 'withdrawn', decided_at = now(), decision_note = 'Người lập sửa hóa đơn', updated_at = now(),
      row_version = row_version + 1 where invoice_id = v_id and status = 'pending_approval';
  end if;
  select bp.name into v_name from public.business_partners bp where bp.id = v_sup;
  if v_name is null then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_REQUIRED'; end if;
  if v_no is null or v_date is null or v_date > v_today then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_HEADER_INVALID'; end if;
  if v_gross <= 0 or v_net < 0 or v_vat < 0 or abs(v_net + v_vat - v_gross) > 1 then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_AMOUNT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_input->'attachments', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_input->'attachments', '[]'::jsonb)) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_INVOICE_FILE_REQUIRED'; end if;
  if exists (select 1 from public.supplier_invoices x where x.supplier_id = v_sup and x.id is distinct from v_id and x.status not in ('reversed', 'rejected')
      and lower(btrim(x.invoice_number)) = lower(v_no) and lower(btrim(coalesce(x.invoice_symbol, ''))) = lower(btrim(coalesce(p_input->>'invoiceSymbol', '')))) then
    raise exception using errcode = '22023', message = 'FINANCE_INVOICE_DUPLICATE', detail = v_no; end if;
  if jsonb_array_length(v_prices) > 0 and jsonb_array_length(v_lines) = 0 then raise exception using errcode = '22023', message = 'FINANCE_PRICE_LINES_REQUIRED'; end if;
  -- Kiểm từng chứng từ: cùng NCC, còn hiệu lực, số gắn (theo giá đang áp) không vượt phần chưa có hóa đơn (ghi nợ + chênh đã chốt − đã có hóa đơn).
  for a in select value from jsonb_array_elements(v_lines) loop
    v_amt := round(nullif(a->>'amount', '')::numeric, 2);
    select r.* into d from app_private.finance_payable_rows() r where r.id = nullif(a->>'documentId', '')::uuid;
    if not found or d.supplier_id is distinct from v_sup or d.status in ('cancelled', 'reversed', 'draft')
      or d.source_type in ('supplier_invoice_adjustment', 'supplier_price_adjustment', 'subcontract_round', 'subcontract_retention', 'subcontract_opening') then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if d.id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
    v_seen := v_seen || d.id;
    if v_amt is null or v_amt <= 0 or v_amt > d.recognized + app_private.finance_doc_price_delta(d.id) - app_private.finance_doc_invoiced(d.id, v_id) + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_INVOICE_OVER_DOCUMENT', detail = coalesce(d.document_no, d.code); end if;
    v_exp := v_exp + v_amt;
  end loop;
  -- Chèn / cập nhật đầu hóa đơn trước (bản chốt giá trỏ tới hóa đơn), trạng thái + số khớp tính xong cập nhật lại.
  if v_id is null then
    insert into public.supplier_invoices (supplier_id, supplier_name_snapshot, invoice_number, invoice_symbol, invoice_date, net_amount, vat_amount, gross_amount, vat_percent,
      variance_reason, attachments, created_by, currency, status, source)
    values (v_sup, v_name, v_no, nullif(btrim(p_input->>'invoiceSymbol'), ''), v_date, v_net, v_vat, v_gross, nullif(p_input->>'vatPercent', '')::numeric,
      v_reason, p_input->'attachments', v_actor, 'VND', 'awaiting_goods', case when p_input->>'source' = 'xml' then 'xml' else 'manual' end)
    returning id into v_id;
  else
    delete from public.supplier_invoice_payable_links where invoice_id = v_id;
  end if;
  if jsonb_array_length(v_lines) = 0 then v_status := 'awaiting_goods'; v_var := null; v_tol := null;
  else
    if jsonb_array_length(v_prices) > 0 then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_PRICE_REASON'; end if;
      v_code := 'CG-' || to_char((now() at time zone 'Asia/Ho_Chi_Minh'), 'YYMM') || '-' || lpad(nextval('public.finance_price_seq')::text, 4, '0');
      insert into public.supplier_price_settlements (code, supplier_id, supplier_name_snapshot, basis, invoice_id, reason, attachments, delta_gross, created_by)
      values (v_code, v_sup, v_name, 'invoice', v_id, v_reason, p_input->'attachments', 0, v_actor)
      returning id into v_ps;
      select * into v_pr from app_private.finance_price_build_lines(v_ps, v_sup, v_prices, v_seen);
      v_pdelta := v_pr.delta; v_exp := v_exp + v_pdelta; v_inc := v_pr.increase;
      update public.supplier_price_settlements set delta_gross = v_pr.delta, increase_gross = v_pr.increase where id = v_ps;
    end if;
    v_var := round(v_gross - v_exp, 2); v_tol := app_private.finance_invoice_tolerance(v_exp);
    if v_ps is null and abs(v_var) <= v_tol then v_status := 'posted';
    else
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_VARIANCE_REASON'; end if;
      v_status := 'pending_approval';
      v_route := app_private.finance_price_route(v_inc + case when abs(v_var) > v_tol then greatest(v_var, 0) else 0 end, v_seen, v_actor);
    end if;
  end if;
  update public.supplier_invoices set invoice_number = v_no, invoice_symbol = nullif(btrim(p_input->>'invoiceSymbol'), ''), invoice_date = v_date,
    net_amount = v_net, vat_amount = v_vat, gross_amount = v_gross, vat_percent = nullif(p_input->>'vatPercent', '')::numeric, variance_reason = v_reason,
    attachments = p_input->'attachments', status = v_status, expected_amount = case when v_status <> 'awaiting_goods' then v_exp end,
    variance_amount = v_var, tolerance_amount = v_tol, route = v_route, step_index = 0, approvals = '[]'::jsonb, updated_at = now() where id = v_id;
  if v_ps is not null then update public.supplier_price_settlements set route = v_route where id = v_ps; end if;
  -- Số gắn vào hóa đơn = theo giá đang áp + chênh chốt giá của chứng từ đó.
  for a in select value from jsonb_array_elements(v_lines) loop
    insert into public.supplier_invoice_payable_links (invoice_id, payable_document_id, allocated_gross_amount)
    values (v_id, (a->>'documentId')::uuid, round((a->>'amount')::numeric, 2) + coalesce((select sum(l.delta_gross) from public.supplier_price_settlement_lines l
      where l.settlement_id = v_ps and l.payable_document_id = (a->>'documentId')::uuid), 0));
  end loop;
  if v_status = 'posted' then
    perform app_private.finance_invoice_post_variance(v_id, v_actor);
    update public.supplier_payable_documents pd set invoice_number = coalesce(pd.invoice_number, v_no), invoice_date = coalesce(pd.invoice_date, v_date), updated_at = now()
    where pd.id in (select payable_document_id from public.supplier_invoice_payable_links where invoice_id = v_id);
  elsif v_status = 'pending_approval' then
    perform app_private.finance_notify_link(array(select jsonb_array_elements_text(v_route->0->'eligibleIds')::uuid),
      case when v_ps is null then 'Hóa đơn lệch chờ bạn duyệt' else 'Hóa đơn + chốt giá chờ bạn duyệt' end,
      v_name || ' · số ' || v_no || ' — ' || (v_route->0->>'label'), '/#/finance?section=invoices', 'invoice', v_actor);
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('supplier_invoice', v_id::text, v_sup, 'invoice_' || v_status, v_actor, v_reason,
    jsonb_build_object('number', v_no, 'gross', v_gross, 'expected', v_exp, 'variance', v_var, 'tolerance', v_tol, 'documents', jsonb_array_length(v_lines),
      'priceSettlement', v_code, 'priceDelta', v_pdelta));
  return jsonb_build_object('id', v_id, 'status', v_status, 'expected', v_exp, 'variance', v_var, 'tolerance', v_tol, 'priceSettlement', v_code);
end $$;

create or replace function public.decide_finance_invoice_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); i public.supplier_invoices%rowtype; v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_ps uuid; v_docs uuid[]; v_label text; v_next jsonb;
begin
  select * into i from public.supplier_invoices where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_INVOICE_NOT_FOUND'; end if;
  if (p_input->>'expectedRowVersion')::bigint is distinct from i.row_version then raise exception using errcode = '40001', message = 'FINANCE_STALE'; end if;
  select id into v_ps from public.supplier_price_settlements where invoice_id = i.id and status in ('pending_approval', 'posted') limit 1;
  select array_agg(payable_document_id) into v_docs from public.supplier_invoice_payable_links where invoice_id = i.id;
  if v_action in ('approve', 'reject') then
    if i.status <> 'pending_approval' then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_STATE'; end if;
    if not app_private.finance_price_can_decide(i.route, i.step_index, i.approvals, i.created_by, v_docs, v_actor) then
      raise exception using errcode = '42501', message = case when i.created_by = v_actor then 'FINANCE_SAME_PERSON' else 'FINANCE_NOT_APPROVER' end; end if;
    v_label := i.route->i.step_index->>'label';
    if v_action = 'reject' then
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
      update public.supplier_invoices set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason, updated_at = now() where id = i.id;
      update public.supplier_price_settlements set status = 'rejected', decided_by = v_actor, decided_at = now(), decision_note = v_reason, updated_at = now(),
        row_version = row_version + 1 where id = v_ps;
      perform app_private.finance_notify_link(array[i.created_by], 'Hóa đơn bị trả lại', i.supplier_name_snapshot || ' · số ' || i.invoice_number || ': ' || v_reason,
        '/#/finance?section=invoices', 'invoice', v_actor);
    else
      update public.supplier_invoices set approvals = approvals || jsonb_build_object('step', i.step_index, 'label', v_label, 'actorId', v_actor,
        'actorName', app_private.finance_user_name(v_actor), 'at', now()), step_index = step_index + 1, updated_at = now() where id = i.id;
      if i.step_index + 1 >= jsonb_array_length(i.route) then
        update public.supplier_invoices set status = 'posted', decided_by = v_actor, decided_at = now(), decision_note = v_reason where id = i.id;
        if v_ps is not null then perform app_private.finance_price_post(v_ps, v_actor); end if;
        perform app_private.finance_invoice_post_variance(i.id, v_actor);
        update public.supplier_payable_documents pd set invoice_number = coalesce(pd.invoice_number, i.invoice_number), invoice_date = coalesce(pd.invoice_date, i.invoice_date), updated_at = now()
        where pd.id in (select payable_document_id from public.supplier_invoice_payable_links where invoice_id = i.id);
        perform app_private.finance_notify_link(array[i.created_by], 'Hóa đơn đã duyệt', i.supplier_name_snapshot || ' · số ' || i.invoice_number,
          '/#/finance?section=invoices', 'invoice', v_actor);
      else
        v_next := i.route->(i.step_index + 1);
        perform app_private.finance_notify_link(array(select jsonb_array_elements_text(v_next->'eligibleIds')::uuid), 'Hóa đơn chờ bạn duyệt',
          i.supplier_name_snapshot || ' · số ' || i.invoice_number || ' — ' || (v_next->>'label'), '/#/finance?section=invoices', 'invoice', v_actor);
      end if;
    end if;
  elsif v_action = 'reverse' then
    if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
    if i.status not in ('posted', 'awaiting_goods') then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if i.status = 'posted' then
      perform app_private.finance_invoice_unpost_variance(i.id, v_actor, v_reason);
      if v_ps is not null then perform app_private.finance_price_unpost(v_ps, v_actor, v_reason); end if;
    end if;
    update public.supplier_payable_documents pd set invoice_number = null, invoice_date = null, updated_at = now()
    where pd.id in (select payable_document_id from public.supplier_invoice_payable_links where invoice_id = i.id) and pd.invoice_number = i.invoice_number;
    update public.supplier_invoices set status = 'reversed', reversed_at = now(), reversed_by = v_actor, reversal_reason = v_reason, updated_at = now() where id = i.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('supplier_invoice', i.id::text, i.supplier_id, 'invoice_' || v_action, v_actor, v_reason,
    jsonb_build_object('number', i.invoice_number, 'variance', i.variance_amount, 'step', i.step_index));
  return jsonb_build_object('id', i.id, 'action', v_action);
end $$;

-- Danh sách: hóa đơn (kèm chốt giá), chốt giá theo biên bản, NCC nợ lại, ma trận để xem trước luồng duyệt.
-- p_filter.supplierId → chứng từ còn phần chưa có hóa đơn (kèm dòng giá); thêm forPrice → mọi chứng từ của NCC (chốt giá theo biên bản).
create or replace function public.get_finance_invoices_v1(p_filter jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_sup text := nullif(p_filter->>'supplierId', ''); v_uid uuid := public.current_app_user_id(); v_for_price boolean := coalesce((p_filter->>'forPrice')::boolean, false);
  v_version uuid;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select id into v_version from public.finance_approval_matrix_versions where is_current;
  return jsonb_build_object(
    'can', jsonb_build_object('record', app_private.finance_can('record'), 'confirm', app_private.finance_can('confirm')),
    'tolerance', jsonb_build_object('percent', 0.5, 'min', 50000),
    'counts', jsonb_build_object(
      'pendingApproval', (select count(*) from public.supplier_invoices where status = 'pending_approval'),
      'awaitingGoods', (select count(*) from public.supplier_invoices where status = 'awaiting_goods'),
      'posted', (select count(*) from public.supplier_invoices where status = 'posted'),
      'pricePending', (select count(*) from public.supplier_price_settlements where basis = 'agreement' and status = 'pending_approval'),
      'awaitingAdjustment', (select count(*) from public.supplier_price_settlements where status = 'posted' and needs_adjustment_invoice and adjustment_invoice is null),
      'docsWithout', (select count(*) from app_private.finance_payable_rows() r where not r.internal and r.status not in ('cancelled', 'reversed', 'draft')
        and r.source_type in ('purchase_delivery_receipt', 'supplier_delivery_statement', 'direct_supplier_receipt', 'site_direct_purchase')
        and r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null) > 0.5),
      'docsWithoutAmount', (select coalesce(sum(r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null)), 0)
        from app_private.finance_payable_rows() r where not r.internal and r.status not in ('cancelled', 'reversed', 'draft')
        and r.source_type in ('purchase_delivery_receipt', 'supplier_delivery_statement', 'direct_supplier_receipt', 'site_direct_purchase')
        and r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null) > 0.5),
      'requiredMissing', (select count(*) from app_private.finance_payable_rows() r join public.supplier_contracts sc on sc.id = r.contract_id
        where sc.require_invoice_before_payment and r.outstanding > 0.5 and r.status in ('open', 'partial')
          and not exists (select 1 from public.supplier_invoice_payable_links k join public.supplier_invoices i on i.id = k.invoice_id
            where k.payable_document_id = r.id and i.status = 'posted'))),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'supplierId', i.supplier_id, 'supplierName', i.supplier_name_snapshot,
        'number', i.invoice_number, 'symbol', i.invoice_symbol, 'date', i.invoice_date, 'net', i.net_amount, 'vat', i.vat_amount, 'gross', i.gross_amount,
        'vatPercent', i.vat_percent, 'status', i.status, 'expected', i.expected_amount, 'variance', i.variance_amount, 'tolerance', i.tolerance_amount,
        'reason', i.variance_reason, 'attachments', i.attachments, 'source', i.source, 'rowVersion', i.row_version,
        'createdBy', i.created_by, 'createdByName', app_private.finance_user_name(i.created_by), 'createdAt', i.created_at,
        'decidedByName', app_private.finance_user_name(i.decided_by), 'decidedAt', i.decided_at, 'decisionNote', i.decision_note,
        'reversedByName', app_private.finance_user_name(i.reversed_by), 'reversedAt', i.reversed_at, 'reversalReason', i.reversal_reason,
        'adjustmentCode', (select d.code from public.supplier_payable_documents d where d.id = i.adjustment_document_id),
        'steps', app_private.finance_price_steps_json(i.route, i.step_index, i.approvals), 'stepIndex', i.step_index,
        'canDecide', i.status = 'pending_approval' and app_private.finance_price_can_decide(i.route, i.step_index, i.approvals, i.created_by,
          array(select payable_document_id from public.supplier_invoice_payable_links where invoice_id = i.id), v_uid),
        'canEdit', (i.status = 'awaiting_goods' or (i.status = 'pending_approval' and i.created_by = v_uid)) and app_private.finance_can('record'),
        'priceSettlement', (select app_private.finance_price_json(s.id, v_uid) from public.supplier_price_settlements s
          where s.invoice_id = i.id and s.status not in ('withdrawn') order by s.created_at desc limit 1),
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'documentNo', d.document_no, 'projectCode', p.code,
            'amount', l.allocated_gross_amount, 'recognized', d.recognized_amount, 'variance', l.variance_amount, 'sourceType', d.source_type) order by d.document_date)
          from public.supplier_invoice_payable_links l join public.supplier_payable_documents d on d.id = l.payable_document_id left join public.projects p on p.id = d.project_id
          where l.invoice_id = i.id), '[]'::jsonb))
        order by case i.status when 'pending_approval' then 0 when 'awaiting_goods' then 1 else 2 end, i.invoice_date desc, i.created_at desc)
      from public.supplier_invoices i where (v_sup is null or i.supplier_id = v_sup) and (i.status <> 'reversed' or coalesce((p_filter->>'withReversed')::boolean, false))), '[]'::jsonb),
    'priceSettlements', coalesce((select jsonb_agg(app_private.finance_price_json(s.id, v_uid) order by s.created_at desc)
      from (select * from public.supplier_price_settlements s where s.basis = 'agreement' and s.status <> 'withdrawn' and (v_sup is null or s.supplier_id = v_sup)
        and (s.status <> 'reversed' or coalesce((p_filter->>'withReversed')::boolean, false)) order by s.created_at desc limit 300) s), '[]'::jsonb),
    'credits', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'supplierId', c.supplier_id, 'supplierName', c.supplier_name_snapshot,
        'projectCode', (select code from public.projects where id = c.project_id), 'amount', c.amount,
        'remaining', app_private.finance_supplier_credit_remaining(c.id), 'settlementCode', s.code, 'createdAt', c.created_at,
        'uses', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'amount', u.amount, 'status', u.status,
            'documentNo', (select coalesce(d.document_no, d.code) from public.supplier_payable_documents d where d.id = u.payable_document_id),
            'paymentDate', u.payment_date, 'documentRef', u.document_ref, 'attachments', u.attachments, 'createdByName', app_private.finance_user_name(u.created_by),
            'createdAt', u.created_at, 'decidedByName', app_private.finance_user_name(u.decided_by), 'decisionNote', u.decision_note,
            'canDecide', u.kind = 'refund' and u.status = 'submitted' and app_private.finance_can('confirm') and u.created_by is distinct from v_uid) order by u.created_at)
          from public.finance_supplier_credit_uses u where u.credit_id = c.id), '[]'::jsonb)) order by c.created_at desc)
      from public.finance_supplier_credits c join public.supplier_price_settlements s on s.id = c.settlement_id
      where c.status = 'open' and (v_sup is null or c.supplier_id = v_sup)
        and (app_private.finance_supplier_credit_remaining(c.id) > 0.5
          or exists (select 1 from public.finance_supplier_credit_uses u where u.credit_id = c.id and u.kind = 'refund' and u.status = 'submitted'))), '[]'::jsonb),
    'approval', jsonb_build_object(
      'decrease', coalesce((select jsonb_build_array(jsonb_build_object('label', 'Kế toán trưởng xác nhận',
          'names', (select coalesce(jsonb_agg(app_private.finance_user_name(x::uuid)), '[]'::jsonb) from jsonb_array_elements_text(r.steps->0->'approverIds') x)))
        from public.finance_approval_rules r where r.version_id = v_version order by r.tier_no limit 1), '[]'::jsonb),
      'tiers', coalesce((select jsonb_agg(jsonb_build_object('tierNo', r.tier_no, 'min', r.min_amount, 'max', r.max_amount,
          'steps', (select coalesce(jsonb_agg(jsonb_build_object('label', s->>'label',
            'names', (select coalesce(jsonb_agg(app_private.finance_user_name(x::uuid)), '[]'::jsonb) from jsonb_array_elements_text(s->'approverIds') x))), '[]'::jsonb)
            from jsonb_array_elements(r.steps) s)) order by r.tier_no)
        from public.finance_approval_rules r where r.version_id = v_version), '[]'::jsonb)),
    'documents', case when v_sup is not null then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'documentNo', r.document_no, 'sourceType', r.source_type,
        'projectCode', r.project_code, 'contractCode', r.contract_code, 'documentDate', r.document_date, 'recognized', r.recognized, 'outstanding', r.outstanding,
        'paid', r.paid, 'companyScope', r.project_id is null,
        'invoiced', app_private.finance_doc_invoiced(r.id, null), 'priceDelta', app_private.finance_doc_price_delta(r.id),
        'remaining', r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null),
        'lines', app_private.finance_doc_price_lines_json(r.id),
        'requireInvoice', coalesce((select sc.require_invoice_before_payment from public.supplier_contracts sc where sc.id = r.contract_id), false),
        'poNumber', case when r.source_type = 'purchase_delivery_receipt' then (select po.po_number from public.purchase_order_delivery_batches b
          join public.purchase_orders po on po.id = b.purchase_order_id where b.id::text = r.source_id) end) order by r.document_date, r.document_no)
      from app_private.finance_payable_rows() r where r.supplier_id = v_sup and r.status not in ('cancelled', 'reversed', 'draft')
        and r.source_type not in ('supplier_invoice_adjustment', 'supplier_price_adjustment', 'subcontract_round', 'subcontract_retention', 'subcontract_opening')
        and (case when v_for_price then r.source_type in ('purchase_delivery_receipt', 'supplier_delivery_statement')
          else r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null) > 0.5 end)), '[]'::jsonb) end,
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', x.supplier_id, 'name', x.name, 'taxCode', x.tax_code, 'docs', x.n, 'remaining', x.rem) order by x.name)
      from (select r.supplier_id, max(r.supplier_name) name, (select bp.tax_code from public.business_partners bp where bp.id = r.supplier_id) tax_code, count(*) n,
          sum(r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null)) rem
        from app_private.finance_payable_rows() r where not r.internal and r.status not in ('cancelled', 'reversed', 'draft')
          and r.source_type not in ('supplier_invoice_adjustment', 'supplier_price_adjustment', 'subcontract_round', 'subcontract_retention', 'subcontract_opening')
          and r.recognized + app_private.finance_doc_price_delta(r.id) - app_private.finance_doc_invoiced(r.id, null) > 0.5 group by r.supplier_id) x), '[]'::jsonb),
    -- NCC có chứng từ chốt giá được (kể cả đã có hóa đơn) — ô chọn NCC của "Chốt giá theo biên bản".
    'priceSuppliers', coalesce((select jsonb_agg(jsonb_build_object('id', x.supplier_id, 'name', x.name, 'taxCode', x.tax_code) order by x.name)
      from (select r.supplier_id, max(r.supplier_name) name, (select bp.tax_code from public.business_partners bp where bp.id = r.supplier_id) tax_code
        from app_private.finance_payable_rows() r where not r.internal and r.supplier_id is not null and r.status not in ('cancelled', 'reversed', 'draft')
          and r.source_type in ('purchase_delivery_receipt', 'supplier_delivery_statement') group by r.supplier_id) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 10. Mua hàng xem giá chốt theo dòng đơn
-- ---------------------------------------------------------------------------
create function public.get_procurement_po_price_settlements_v1(p_po_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app_private.procurement_can('view') or app_private.finance_can('view')) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('poLineId', l.purchase_order_line_id, 'code', s.code, 'status', s.status, 'itemName', l.item_name, 'unit', l.unit,
      'qty', l.qty, 'fromPrice', l.from_price, 'toPrice', l.to_price, 'deltaGross', l.delta_gross, 'reason', s.reason,
      'at', coalesce(s.decided_at, s.created_at), 'deliveryNo', b.delivery_no) order by coalesce(s.decided_at, s.created_at))
    from public.supplier_price_settlement_lines l join public.supplier_price_settlements s on s.id = l.settlement_id
    left join public.purchase_order_delivery_lines dl on dl.id = l.source_line_id left join public.purchase_order_delivery_batches b on b.id = dl.delivery_batch_id
    where l.purchase_order_id = p_po_id and s.status in ('pending_approval', 'posted')), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 11. Quyền gọi hàm
-- ---------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array['app_private.finance_price_doc_lines(uuid)', 'app_private.finance_price_current(uuid)', 'app_private.finance_doc_price_delta(uuid)',
    'app_private.finance_doc_price_lines_json(uuid)', 'app_private.finance_price_route(numeric,uuid[],uuid)',
    'app_private.finance_price_can_decide(jsonb,integer,jsonb,uuid,uuid[],uuid)', 'app_private.finance_price_steps_json(jsonb,integer,jsonb)',
    'app_private.finance_price_build_lines(uuid,text,jsonb,uuid[])', 'app_private.finance_supplier_credit_remaining(uuid)',
    'app_private.finance_supplier_credit_apply_doc(uuid,uuid,uuid)', 'app_private.finance_supplier_credit_apply(uuid,uuid)',
    'app_private.trg_finance_supplier_credit_auto()', 'app_private.trg_finance_supplier_credit_release()',
    'app_private.finance_price_post(uuid,uuid)', 'app_private.finance_price_unpost(uuid,uuid,text)', 'app_private.finance_price_json(uuid,uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.save_finance_price_agreement_v1(jsonb)', 'public.decide_finance_price_settlement_v1(jsonb)',
    'public.attach_finance_price_adjustment_invoice_v1(jsonb)', 'public.save_finance_supplier_credit_refund_v1(jsonb)',
    'public.decide_finance_supplier_credit_refund_v1(jsonb)', 'public.get_procurement_po_price_settlements_v1(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
