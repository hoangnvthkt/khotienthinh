-- Kiểm soát viên K0 (chủ SP 22–23/10/2026): bộ luật kiểm tra dữ liệu nghiệp vụ chạy định kỳ + sổ phát hiện. Không gọi AI.
--   control_rules     mỗi luật = một nguyên tắc nghiệp vụ (vì sao lệch là sai, cách xử lý đúng, ai xử lý), mức P0/P1/P2, chế độ
--                     shadow (chạy thử, chỉ Admin thấy) | live (K1 mới đưa tới người xử lý) | off; since_date: lệch trước ngày này là dữ liệu cũ.
--   control_findings  mỗi lệch một hồ sơ (khóa rule_code + object_key): không báo trùng; lần chạy sau không còn lệch → tự đóng (resolved);
--                     Admin "chấp nhận có lý do" (accepted) → không tính là đang mở; xuất hiện lại sau khi đã đóng → mở lại.
--   control_runs      nhật ký mỗi lượt chạy (số luật, mở mới, tự đóng, lỗi từng luật).
-- Luật = hàm app_private.control_rule_<mã>() trả các dòng đang lệch; bộ chạy app_private.control_run() gọi lần lượt (lỗi một luật không
-- dừng luật khác), cron 15 phút có khóa tư vấn (trùng lượt thì bỏ). Nguồn câu kiểm: rà soát Đề xuất → PO → Giao/Nhận → Trả → Công nợ 22/10
-- (C1–C14, A4–A6, V-B02; bất biến I1–I5). Chỉ Admin đọc / thao tác (RPC is_admin()); K1 mới mở cho người phụ trách.

create table if not exists public.control_rules (
  code text primary key,
  module text not null,
  title text not null,
  principle text not null,
  fix_hint text not null,
  owner_hint text not null,
  severity text not null check (severity in ('P0', 'P1', 'P2')),
  mode text not null default 'shadow' check (mode in ('shadow', 'live', 'off')),
  since_date date not null default date '2026-10-01',
  fn text not null check (fn ~ '^control_rule_[a-z0-9_]+$'),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.control_findings (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null references public.control_rules(code) on delete cascade,
  object_key text not null,
  object_type text not null,
  object_id text,
  object_code text,
  project_id text,
  warehouse_id text,
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  amount numeric,
  happened_on date,
  link text,
  legacy boolean not null default false,
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid,
  accepted_reason text,
  unique (rule_code, object_key)
);
create index if not exists control_findings_open_idx on public.control_findings (rule_code, status) where status <> 'resolved';

create table if not exists public.control_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null default 'cron',
  rules integer not null default 0,
  opened integer not null default 0,
  resolved integer not null default 0,
  open_total integer,
  errors jsonb not null default '[]'::jsonb
);

alter table public.control_rules enable row level security;
alter table public.control_findings enable row level security;
alter table public.control_runs enable row level security;
drop policy if exists control_rules_admin_select on public.control_rules;
create policy control_rules_admin_select on public.control_rules for select to authenticated using (public.is_admin());
drop policy if exists control_findings_admin_select on public.control_findings;
create policy control_findings_admin_select on public.control_findings for select to authenticated using (public.is_admin());
drop policy if exists control_runs_admin_select on public.control_runs;
create policy control_runs_admin_select on public.control_runs for select to authenticated using (public.is_admin());
revoke all on public.control_rules, public.control_findings, public.control_runs from public, anon;
grant select on public.control_rules, public.control_findings, public.control_runs to authenticated;

-- ── Định dạng số kiểu Việt ──────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_vnd(p numeric) returns text language sql immutable set search_path = '' as $$
  select case when p is null then '—' else replace(to_char(round(p), 'FM999G999G999G999G990'), ',', '.') || ' đ' end;
$$;
create or replace function app_private.control_qty(p numeric) returns text language sql immutable set search_path = '' as $$
  -- 1234.5 → "1.234,5"; số nguyên không để dấu thập phân thừa.
  select case when p is null then '—' else replace(replace(replace(rtrim(to_char(round(p, 3), 'FM999G999G999G990D999'), '.'), ',', '#'), '.', ','), '#', '.') end;
$$;
create or replace function app_private.control_po_date(p_order_date text, p_created timestamptz) returns date language sql immutable set search_path = '' as $$
  select case when p_order_date ~ '^\d{4}-\d{2}-\d{2}' then left(p_order_date, 10)::date else (p_created at time zone 'Asia/Ho_Chi_Minh')::date end;
$$;

-- ── Luật: mỗi hàm trả các dòng đang lệch ────────────────────────────────────────────────────────────────────────────
-- Cột trả về chung cho mọi luật (bộ chạy chèn theo thứ tự này).
-- object_key, object_type, object_id, object_code, project_id, warehouse_id, title, detail, amount, happened_on, link

-- R01 Tổng tiền đơn ≠ tổng các dòng (C2)
create or replace function app_private.control_rule_po_total_mismatch()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'po:' || po.id, 'purchase_order', po.id, po.po_number, po.project_id, po.target_warehouse_id,
    format('%s: tổng đơn %s, tổng các dòng %s', po.po_number, app_private.control_vnd(po.total_amount), app_private.control_vnd(s.lines)),
    jsonb_build_object('tong_don', po.total_amount, 'tong_dong', round(s.lines, 2), 'trang_thai', po.status, 'nha_cung_cap', po.vendor_name),
    round(coalesce(po.total_amount, 0) - coalesce(s.lines, 0)), app_private.control_po_date(po.order_date, po.created_at), '/procurement?po=' || po.id
  from public.purchase_orders po
  cross join lateral (select sum(coalesce(nullif(x->>'qty', '')::numeric, 0) * coalesce(nullif(x->>'unitPrice', '')::numeric, 0)) lines from jsonb_array_elements(po.items) x) s
  where po.archived_at is null and jsonb_typeof(po.items) = 'array' and po.status <> 'cancelled'
    and abs(coalesce(po.total_amount, 0) - coalesce(s.lines, 0)) > 1;
$$;

-- R02 Số đã nhận trên dòng đơn ≠ tổng các đợt đã nhận (C3, bất biến I1)
create or replace function app_private.control_rule_po_received_mismatch()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'po:' || po.id || ':line:' || coalesce(x->>'lineId', x->>'itemId', '?'), 'purchase_order', po.id, po.po_number, po.project_id, po.target_warehouse_id,
    format('%s · %s: đơn ghi đã nhận %s, các đợt nhận cộng lại %s', po.po_number, coalesce(x->>'name', 'dòng hàng'),
      app_private.control_qty(coalesce(nullif(x->>'receivedQty', '')::numeric, 0)), app_private.control_qty(coalesce(r.acc, 0))),
    jsonb_build_object('dong', x->>'name', 'don_ghi_da_nhan', coalesce(nullif(x->>'receivedQty', '')::numeric, 0), 'tong_dot_nhan', coalesce(r.acc, 0), 'so_dot', coalesce(r.n, 0)),
    null::numeric, app_private.control_po_date(po.order_date, po.created_at), '/procurement?po=' || po.id
  from public.purchase_orders po
  cross join jsonb_array_elements(po.items) x
  left join lateral (
    select sum(dl.accepted_qty) acc, count(distinct b.id) n
    from public.purchase_order_delivery_lines dl join public.purchase_order_delivery_batches b on b.id = dl.delivery_batch_id
    where dl.purchase_order_id = po.id and dl.purchase_order_line_id = x->>'lineId' and b.status like 'received%') r on true
  where po.archived_at is null and jsonb_typeof(po.items) = 'array' and po.status <> 'cancelled'
    and abs(coalesce(nullif(x->>'receivedQty', '')::numeric, 0) - coalesce(r.acc, 0)) > 0.0001;
$$;

-- R03 Đợt giao và phiếu nhập kho lệch trạng thái (C4; rà soát B-01: PO-116/163/181)
create or replace function app_private.control_rule_batch_wms_status()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'batch:' || b.id, 'delivery_batch', b.id::text, po.po_number || ' · đợt ' || b.delivery_no, coalesce(b.project_id, po.project_id), coalesce(b.target_warehouse_id, po.target_warehouse_id),
    case when b.status like 'received%' then format('%s đợt %s: đợt giao đã nhận nhưng phiếu nhập kho chưa hoàn tất (%s)', po.po_number, b.delivery_no, t.status::text)
      else format('%s đợt %s: kho đã nhập xong nhưng đợt giao vẫn "%s"', po.po_number, b.delivery_no, b.status) end,
    jsonb_build_object('trang_thai_dot', b.status, 'trang_thai_phieu_kho', t.status::text, 'gia_tri_chap_nhan', b.accepted_gross_amount),
    b.accepted_gross_amount, coalesce((b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, (t.date at time zone 'Asia/Ho_Chi_Minh')::date, (b.created_at at time zone 'Asia/Ho_Chi_Minh')::date), '/procurement?po=' || po.id
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  join public.transactions t on t.id = b.wms_transaction_id
  where b.status <> 'cancelled'
    and ((b.status like 'received%' and t.status::text <> 'COMPLETED') or (t.status::text = 'COMPLETED' and b.status not like 'received%'));
$$;

-- R04 Sổ kho nhập ≠ số thực nhận (nhập kho thường; C5b, bất biến I2)
create or replace function app_private.control_rule_ledger_vs_accepted()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  with acc as (
    select b.wms_transaction_id tx, dl.item_id, sum(dl.accepted_stock_qty) q, max(b.received_at) d, min(po.po_number) po_number, min(po.id) po_id,
      min(coalesce(b.project_id, po.project_id)) project_id, min(coalesce(b.target_warehouse_id, po.target_warehouse_id)) warehouse_id
    from public.purchase_order_delivery_batches b
    join public.purchase_order_delivery_lines dl on dl.delivery_batch_id = b.id
    join public.purchase_orders po on po.id = b.purchase_order_id
    where b.status like 'received%' and b.fulfillment_mode = 'RECEIVE_TO_STOCK' and b.wms_transaction_id is not null
    group by 1, 2),
  led as (
    select it.source_id tx, e.material_id item_id, sum(e.quantity_in) q
    from public.inventory_ledger_entries e join public.inventory_transactions it on it.id = e.inventory_transaction_id
    where e.movement_direction = 'in' and it.reversed_at is null
    group by 1, 2)
  select 'tx:' || acc.tx || ':item:' || acc.item_id, 'wms_transaction', acc.tx::text, acc.po_number, acc.project_id, acc.warehouse_id,
    format('%s · %s: nhận thực tế %s, sổ kho ghi nhập %s', acc.po_number, coalesce(i.name, 'vật tư'), app_private.control_qty(acc.q), app_private.control_qty(coalesce(led.q, 0))),
    jsonb_build_object('vat_tu', i.name, 'don_vi', i.unit, 'thuc_nhan', acc.q, 'so_kho_nhap', coalesce(led.q, 0)),
    null::numeric, (acc.d at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || acc.po_id
  from acc left join led on led.tx = acc.tx::text and led.item_id = acc.item_id
  left join public.items i on i.id = acc.item_id
  where abs(coalesce(acc.q, 0) - coalesce(led.q, 0)) > 0.0001;
$$;

-- R05 Công nợ của đợt ≠ giá trị hàng nhận được (C6, bất biến I3)
create or replace function app_private.control_rule_ap_vs_accepted()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'ap:' || d.id, 'payable_document', d.id::text, coalesce(po.po_number || ' · đợt ' || b.delivery_no, d.document_no), d.project_id, coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: công nợ ghi %s, giá trị hàng nhận %s', po.po_number, b.delivery_no, app_private.control_vnd(d.recognized_amount), app_private.control_vnd(b.accepted_gross_amount)),
    jsonb_build_object('chung_tu_no', d.document_no, 'cong_no', d.recognized_amount, 'giam_tru', d.credit_amount, 'gia_tri_nhan', b.accepted_gross_amount),
    round(coalesce(d.recognized_amount, 0) - coalesce(b.accepted_gross_amount, 0)), coalesce(d.document_date, (b.received_at at time zone 'Asia/Ho_Chi_Minh')::date), '/procurement?po=' || po.id
  from public.supplier_payable_documents d
  join public.purchase_order_delivery_batches b on b.id::text = d.source_id
  join public.purchase_orders po on po.id = b.purchase_order_id
  where d.source_type = 'purchase_delivery_receipt' and abs(d.recognized_amount - coalesce(b.accepted_gross_amount, 0)) > 1;
$$;

-- R06 Giá trị chấp nhận của đợt ≠ SL nhận × giá đợt × (1 + VAT) (C7)
create or replace function app_private.control_rule_accepted_value_calc()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'batch:' || b.id, 'delivery_batch', b.id::text, po.po_number || ' · đợt ' || b.delivery_no, coalesce(b.project_id, po.project_id), coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: giá trị ghi %s%s, tính lại SL × giá × VAT ra %s', po.po_number, b.delivery_no, app_private.control_vnd(b.accepted_gross_amount),
      case when coalesce(adj.delta, 0) <> 0 then ' (đã chốt giá ' || app_private.control_vnd(adj.delta) || ')' else '' end, app_private.control_vnd(s.calc)),
    jsonb_build_object('gia_tri_ghi', b.accepted_gross_amount, 'chot_gia', adj.delta, 'tinh_lai', round(s.calc, 2), 'vat_dot', b.vat_rate, 'vat_don', po.vat_rate),
    round(coalesce(b.accepted_gross_amount, 0) + coalesce(adj.delta, 0) - coalesce(s.calc, 0)), (b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  join lateral (select sum(dl.accepted_qty * coalesce(dl.delivery_unit_price, 0)) * (1 + coalesce(b.vat_rate, po.vat_rate, 0) / 100) calc
    from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = b.id) s on true
  -- Chốt giá (supplier_price_settlements) bù chênh lệch giá của đợt → cộng vào trước khi so (ca PO-261: ghi 7,95 tr + chốt giá 256,9 tr).
  left join lateral (select sum(sl.delta_gross) delta
    from public.supplier_price_settlement_lines sl
    join public.supplier_price_settlements ss on ss.id = sl.settlement_id
    join public.supplier_payable_documents d on d.id = sl.payable_document_id
    where d.source_type = 'purchase_delivery_receipt' and d.source_id = b.id::text and ss.reversed_at is null
      and ss.status not in ('draft', 'pending', 'rejected', 'cancelled')) adj on true
  where b.status like 'received%' and abs(coalesce(b.accepted_gross_amount, 0) + coalesce(adj.delta, 0) - coalesce(s.calc, 0)) > 2;
$$;

-- R07 Có công nợ mà hàng chưa nhận (C8)
create or replace function app_private.control_rule_ap_without_receipt()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'ap:' || d.id, 'payable_document', d.id::text, coalesce(po.po_number || ' · đợt ' || b.delivery_no, d.document_no), d.project_id, coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: đã ghi công nợ %s nhưng đợt giao còn "%s"', po.po_number, b.delivery_no, app_private.control_vnd(d.recognized_amount), b.status),
    jsonb_build_object('chung_tu_no', d.document_no, 'cong_no', d.recognized_amount, 'trang_thai_dot', b.status),
    d.recognized_amount, coalesce(d.document_date, (d.created_at at time zone 'Asia/Ho_Chi_Minh')::date), '/procurement?po=' || po.id
  from public.supplier_payable_documents d
  join public.purchase_order_delivery_batches b on b.id::text = d.source_id
  join public.purchase_orders po on po.id = b.purchase_order_id
  where d.source_type = 'purchase_delivery_receipt' and b.status not like 'received%' and coalesce(d.status, '') not in ('cancelled', 'void', 'reversed');
$$;

-- R08 Đợt đã nhận (đơn thường) mà chưa có công nợ (C9)
create or replace function app_private.control_rule_receipt_without_ap()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'batch:' || b.id, 'delivery_batch', b.id::text, po.po_number || ' · đợt ' || b.delivery_no, coalesce(b.project_id, po.project_id), coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: đã nhận hàng %s nhưng chưa ghi công nợ NCC', po.po_number, b.delivery_no, app_private.control_vnd(b.accepted_gross_amount)),
    jsonb_build_object('trang_thai_dot', b.status, 'gia_tri_nhan', b.accepted_gross_amount, 'nha_cung_cap', po.vendor_name),
    b.accepted_gross_amount, (b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  where b.status like 'received%' and po.supplier_contract_id is null and coalesce(b.accepted_gross_amount, 0) > 0
    and not exists (select 1 from public.supplier_payable_documents d where d.source_type = 'purchase_delivery_receipt' and d.source_id = b.id::text);
$$;

-- R09 VAT đợt nhận khác VAT đơn (rà soát B-02)
create or replace function app_private.control_rule_batch_vat_differs()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'batch:' || b.id, 'delivery_batch', b.id::text, po.po_number || ' · đợt ' || b.delivery_no, coalesce(b.project_id, po.project_id), coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: VAT đợt %s%%, VAT đơn %s%% → công nợ chênh %s', po.po_number, b.delivery_no, coalesce(b.vat_rate, 0), coalesce(po.vat_rate, 0), app_private.control_vnd(s.gap)),
    jsonb_build_object('vat_dot', b.vat_rate, 'vat_don', po.vat_rate, 'chenh_cong_no', round(s.gap)),
    round(s.gap), (b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  join lateral (select sum(dl.accepted_qty * coalesce(dl.delivery_unit_price, 0)) * (coalesce(po.vat_rate, 0) - coalesce(b.vat_rate, 0)) / 100 gap
    from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = b.id) s on true
  where b.status like 'received%' and coalesce(b.vat_rate, 0) <> coalesce(po.vat_rate, 0) and abs(coalesce(s.gap, 0)) > 1;
$$;

-- R10 Giá đối soát khác giá phiếu giao mà không ghi lý do (C10b; ca PO-609). Phiếu giao giá 0 lấy giá HĐ là đúng — không tính.
create or replace function app_private.control_rule_statement_price_no_reason()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'stmt_line:' || sl.id, 'delivery_statement', s.id::text, coalesce(po.po_number, s.code), s.project_id, null::text,
    format('%s · %s: giá đối soát %s, giá phiếu giao %s, chưa ghi lý do', coalesce(po.po_number, s.code), coalesce(sl.item_name_snapshot, 'dòng hàng'),
      app_private.control_vnd(sl.unit_price_snapshot), app_private.control_vnd(nl.unit_price)),
    jsonb_build_object('bang_doi_soat', s.code, 'phieu_giao', n.code, 'vat_tu', sl.item_name_snapshot, 'gia_doi_soat', sl.unit_price_snapshot, 'gia_phieu_giao', nl.unit_price,
      'tien_doi_soat', round(sl.total_amount), 'tien_phieu_giao', round(nl.total_amount), 'gia_hop_dong', sl.contract_unit_price),
    round(coalesce(sl.total_amount, 0) - coalesce(nl.total_amount, 0)), coalesce(s.statement_date, n.delivery_date),
    case when po.id is not null then '/procurement?po=' || po.id else '/finance/payables' end
  from public.supplier_delivery_statement_lines sl
  join public.supplier_delivery_statements s on s.id = sl.statement_id
  join public.supplier_direct_delivery_lines nl on nl.id = sl.delivery_line_id
  join public.supplier_direct_delivery_notes n on n.id = nl.delivery_note_id
  left join public.purchase_orders po on po.id = n.purchase_order_id
  where coalesce(s.status, '') not in ('cancelled', 'reversed', 'draft')
    and abs(coalesce(sl.unit_price_snapshot, 0) - coalesce(nl.unit_price, 0)) > 0.01
    and coalesce(btrim(sl.price_reason), '') = '' and coalesce(nl.unit_price, 0) > 0;
$$;

-- R11 Trả NCC đã hoàn tất mà chưa quyết định giao bù / giảm nợ (C11)
create or replace function app_private.control_rule_return_no_resolution()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'return:' || r.id, 'supplier_return', r.id::text, coalesce(po.po_number || ' · ' || r.return_no, r.return_no), r.project_id::text, r.source_warehouse_id::text,
    format('%s %s: đã trả NCC%s nhưng chưa chọn giao bù hay giảm nợ', po.po_number, r.return_no, case when coalesce(v.value, 0) > 0 then ' ' || app_private.control_vnd(v.value) else '' end),
    jsonb_build_object('phieu_tra', r.return_no, 'ly_do', r.reason, 'gia_tri', round(v.value)),
    round(v.value), (coalesce(r.completed_at, r.created_at) at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_supplier_returns r
  join public.purchase_orders po on po.id = r.purchase_order_id
  left join lateral (select sum(l.return_qty * l.unit_price) value from public.purchase_order_supplier_return_lines l where l.supplier_return_id = r.id) v on true
  where r.status = 'completed' and r.resolution is null;
$$;

-- R12 Trả NCC vượt số đã nhận (C12)
create or replace function app_private.control_rule_return_over_received()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'return_line:' || l.id, 'supplier_return', r.id::text, coalesce(po.po_number || ' · ' || r.return_no, r.return_no), r.project_id::text, r.source_warehouse_id::text,
    format('%s %s · %s: trả %s (đã trả trước %s) nhưng chỉ nhận %s', po.po_number, r.return_no, coalesce(i.name, 'vật tư'), app_private.control_qty(l.return_qty),
      app_private.control_qty(coalesce(l.previously_returned_qty_snapshot, 0)), app_private.control_qty(l.received_qty_snapshot)),
    jsonb_build_object('tra', l.return_qty, 'da_tra_truoc', l.previously_returned_qty_snapshot, 'da_nhan', l.received_qty_snapshot),
    null::numeric, (r.created_at at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_supplier_return_lines l
  join public.purchase_order_supplier_returns r on r.id = l.supplier_return_id
  join public.purchase_orders po on po.id = r.purchase_order_id
  left join public.items i on i.id = l.item_id
  where r.status <> 'cancelled' and l.return_qty + coalesce(l.previously_returned_qty_snapshot, 0) > l.received_qty_snapshot + 0.0001;
$$;

-- R13 Một phiếu kho được ghi sổ hơn một lần (C13, bất biến I5)
create or replace function app_private.control_rule_ledger_double_post()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'tx:' || it.source_id || ':' || it.transaction_type, 'wms_transaction', it.source_id, min(it.code), min(it.project_id::text), null::text,
    format('Phiếu kho %s được ghi sổ %s lần (%s)', coalesce(min(it.source_code), min(it.code)), count(*), it.transaction_type),
    jsonb_build_object('so_lan', count(*), 'loai', it.transaction_type, 'cac_but_toan', jsonb_agg(it.code order by it.created_at)),
    null::numeric, (min(it.transaction_date) at time zone 'Asia/Ho_Chi_Minh')::date, '/operations'
  from public.inventory_transactions it
  where it.reversed_at is null and it.reversal_of_inventory_transaction_id is null and it.source_id is not null
  group by it.source_id, it.transaction_type
  having count(*) > 1;
$$;

-- R14 Đề xuất hoàn tất nhưng còn thiếu hàng, chưa ghi đóng nhu cầu (C14)
create or replace function app_private.control_rule_mr_completed_short()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
  select 'mr:' || r.id, 'material_request', r.id, r.code, r.project_id, null::text,
    format('%s: đã hoàn tất nhưng còn %s dòng chưa về đủ, chưa ghi đóng nhu cầu', r.code, s.short_lines),
    jsonb_build_object('dong_thieu', s.short_lines, 'buoc', r.workflow_step),
    null::numeric, (coalesce(r.last_action_at, r.created_at) at time zone 'Asia/Ho_Chi_Minh')::date,
    '/da?projectId=' || coalesce(r.project_id, '') || '&tab=material&materialTab=request&requestId=' || r.id
  from public.requests r
  cross join lateral (select count(*)::int short_lines from app_private.material_request_supply_lines_v1(array[r.id]) x where x.received_qty < x.need_qty - 0.0001) s
  where r.request_origin = 'project' and r.status::text = 'COMPLETED' and s.short_lines > 0
    and not exists (select 1 from public.procurement_need_closures nc where nc.source_id::text = r.id);
end $$;

-- R15 Đề xuất đã kết thúc nhưng đơn mua còn mở (A5; ca MR-2026-9833 / PO-671)
create or replace function app_private.control_rule_mr_ended_po_open()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'mr:' || r.id || ':po:' || po.id, 'material_request', r.id, r.code, r.project_id, po.target_warehouse_id,
    format('%s đã kết thúc nhưng %s còn mở (%s)', r.code, po.po_number, po.status),
    jsonb_build_object('don_mua', po.po_number, 'trang_thai_don', po.status, 'da_dat', prl.ordered_qty, 'da_nhan', prl.actual_received_qty_snapshot),
    null::numeric, app_private.control_po_date(po.order_date, po.created_at), '/procurement?po=' || po.id
  from public.requests r
  join public.purchase_order_request_lines prl on prl.material_request_id = r.id
  join public.purchase_orders po on po.id = prl.purchase_order_id
  where r.status::text = 'COMPLETED' and r.workflow_step = 'ended'
    and po.status in ('draft', 'sent', 'confirmed', 'in_transit', 'partial') and po.archived_at is null
  group by r.id, r.code, r.project_id, po.id, po.po_number, po.status, po.target_warehouse_id, prl.ordered_qty, prl.actual_received_qty_snapshot;
$$;

-- R16 Đặt mua vượt nhu cầu đề xuất mà không ghi lý do (A4)
create or replace function app_private.control_rule_order_over_need()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'prl:' || prl.id, 'purchase_order', po.id, po.po_number, coalesce(prl.project_id::text, po.project_id), po.target_warehouse_id,
    format('%s · %s: đặt %s, đề xuất %s cần %s, không ghi lý do đặt vượt', po.po_number, coalesce(i.name, 'vật tư'), app_private.control_qty(prl.ordered_stock_qty_snapshot),
      prl.material_request_code, app_private.control_qty(prl.requested_qty)),
    jsonb_build_object('de_xuat', prl.material_request_code, 'can', prl.requested_qty, 'dat', prl.ordered_stock_qty_snapshot, 'don_vi', prl.unit),
    null::numeric, app_private.control_po_date(po.order_date, po.created_at), '/procurement?po=' || po.id
  from public.purchase_order_request_lines prl
  join public.purchase_orders po on po.id = prl.purchase_order_id
  left join public.items i on i.id = prl.item_id
  where po.status not in ('cancelled') and po.archived_at is null
    and prl.ordered_stock_qty_snapshot > prl.requested_qty * 1.0001 + 0.0001
    and coalesce(btrim(prl.excess_reason), '') = '';
$$;

-- R17 Nhận dư so với kế hoạch đợt (A6; rà soát B-11: chỉ người nhận tự tích, không ai duyệt)
create or replace function app_private.control_rule_received_over()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'batch:' || b.id, 'delivery_batch', b.id::text, po.po_number || ' · đợt ' || b.delivery_no, coalesce(b.project_id, po.project_id), coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: nhận dư so với kế hoạch%s', po.po_number, b.delivery_no, case when coalesce(btrim(b.variance_reason), '') = '' then ', không ghi lý do' else ' — ' || left(b.variance_reason, 80) end),
    jsonb_build_object('ly_do', b.variance_reason, 'dong', (select jsonb_agg(jsonb_build_object('ke_hoach', dl.planned_qty, 'nhan', dl.accepted_qty)) from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = b.id)),
    b.accepted_gross_amount, (b.received_at at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  where b.status = 'received_over';
$$;

-- R18 Đợt đã duyệt chất lượng quá 3 ngày chưa nhập kho (rà soát B-04: PO-259)
create or replace function app_private.control_rule_batch_quality_stuck()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'batch:' || b.id, 'delivery_batch', b.id::text, po.po_number || ' · đợt ' || b.delivery_no, coalesce(b.project_id, po.project_id), coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: đã duyệt chất lượng từ %s, %s ngày chưa nhập kho', po.po_number, b.delivery_no, to_char(b.quality_approved_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY'),
      (current_date - (b.quality_approved_at at time zone 'Asia/Ho_Chi_Minh')::date)),
    jsonb_build_object('duyet_chat_luong', b.quality_approved_at),
    b.accepted_gross_amount, (b.quality_approved_at at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || po.id
  from public.purchase_order_delivery_batches b
  join public.purchase_orders po on po.id = b.purchase_order_id
  where b.status = 'quality_approved' and b.quality_approved_at < now() - interval '3 days';
$$;

do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private' and (p.proname like 'control\_rule\_%' or p.proname in ('control_vnd', 'control_qty', 'control_po_date')) loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- ── Danh mục luật (chạy thử: shadow) ────────────────────────────────────────────────────────────────────────────────
insert into public.control_rules (code, module, title, principle, fix_hint, owner_hint, severity, fn, sort_order) values
  ('po_total_mismatch', 'Mua hàng', 'Tổng tiền đơn khác tổng các dòng', 'Tổng đơn phải bằng Σ số lượng × đơn giá các dòng; lệch là đơn bị sửa ngoài lệnh lưu hoặc dữ liệu cũ.', 'Mở đơn, đối chiếu dòng và tổng; điều chỉnh bằng chứng từ có lý do, không sửa thẳng.', 'Mua hàng', 'P1', 'control_rule_po_total_mismatch', 10),
  ('po_received_mismatch', 'Mua hàng', 'Số đã nhận trên đơn khác tổng các đợt nhận', 'Số "đã nhận" của dòng đơn phải bằng tổng số đạt của các đợt giao đã nhận (một nguồn: đợt giao).', 'Kiểm các đợt giao của dòng; sai ở đợt thì sửa số nhận nhầm, đơn cũ thiếu đợt thì xử lý qua Đối chiếu nhận hàng.', 'Mua hàng + Kho', 'P1', 'control_rule_po_received_mismatch', 20),
  ('batch_wms_status', 'Kho', 'Đợt giao và phiếu nhập kho lệch trạng thái', 'Đợt giao "đã nhận" khi và chỉ khi phiếu nhập kho của đợt đã hoàn tất.', 'Mở Kho → Đối chiếu nhận hàng để chốt đợt theo phiếu kho (không hoàn tất phiếu PO bằng lệnh kho chung).', 'Kho + Mua hàng', 'P0', 'control_rule_batch_wms_status', 30),
  ('ledger_vs_accepted', 'Kho', 'Sổ kho nhập khác số thực nhận', 'Số nhập trên sổ kho của mỗi vật tư phải bằng số đạt khi nhận hàng của đợt.', 'Mở phiếu nhập và đợt giao; lệch thì lập phiếu điều chỉnh kho có lý do.', 'Kho', 'P0', 'control_rule_ledger_vs_accepted', 40),
  ('ap_vs_accepted', 'Công nợ', 'Công nợ đợt khác giá trị hàng nhận', 'Nợ NCC theo đợt = số nhận thực tế × giá × (1 + VAT).', 'Kiểm đợt giao và chứng từ nợ; chênh thì ghi điều chỉnh công nợ có lý do.', 'Kế toán công nợ', 'P0', 'control_rule_ap_vs_accepted', 50),
  ('accepted_value_calc', 'Công nợ', 'Giá trị chấp nhận đợt tính sai', 'Giá trị chấp nhận của đợt = Σ số nhận × giá đợt × (1 + VAT).', 'Kiểm giá đợt và VAT; sửa bằng chốt giá / điều chỉnh có lý do.', 'Kế toán công nợ', 'P1', 'control_rule_accepted_value_calc', 60),
  ('ap_without_receipt', 'Công nợ', 'Có công nợ mà hàng chưa nhận', 'Chưa nhận hàng thì chưa phát sinh nợ NCC.', 'Kiểm đợt giao: chưa nhận thì đảo chứng từ nợ; đã nhận thì chốt đợt.', 'Kế toán công nợ', 'P0', 'control_rule_ap_without_receipt', 70),
  ('receipt_without_ap', 'Công nợ', 'Đã nhận hàng mà chưa ghi công nợ', 'Đơn thường nhận hàng (từ 01/10) phải sinh chứng từ nợ NCC ngay khi nhận.', 'Báo Admin kiểm đường ghi nợ của đợt; không ghi nợ tay trùng.', 'Kế toán công nợ', 'P0', 'control_rule_receipt_without_ap', 80),
  ('batch_vat_differs', 'Công nợ', 'VAT đợt nhận khác VAT đơn', 'VAT của đợt giao phải theo VAT đơn; khác thì phải có lý do (hóa đơn thực tế).', 'Kế toán đối chiếu hóa đơn: đúng VAT đơn thì điều chỉnh công nợ phần VAT thiếu.', 'Kế toán công nợ', 'P1', 'control_rule_batch_vat_differs', 90),
  ('statement_price_no_reason', 'Công nợ', 'Giá đối soát khác giá phiếu giao, không lý do', 'Giá trên bảng đối soát HĐ nguyên tắc khác giá phiếu giao thì phải ghi lý do.', 'Mở bảng đối soát: ghi lý do và chốt giá nếu đúng, hoặc đưa về giá phiếu giao.', 'Kế toán công nợ', 'P0', 'control_rule_statement_price_no_reason', 100),
  ('return_no_resolution', 'Mua hàng', 'Trả NCC xong chưa chọn giao bù / giảm nợ', 'Hàng trả NCC phải được NCC giao bù hoặc giảm nợ — không để treo.', 'Mua hàng mở phiếu trả, chọn Giao bù hoặc Giảm nợ.', 'Mua hàng', 'P1', 'control_rule_return_no_resolution', 110),
  ('return_over_received', 'Kho', 'Trả NCC vượt số đã nhận', 'Tổng số trả không vượt số đã nhận của dòng.', 'Kiểm phiếu trả; sai thì hủy phiếu trả và lập lại đúng số.', 'Kho + Mua hàng', 'P0', 'control_rule_return_over_received', 120),
  ('ledger_double_post', 'Kho', 'Phiếu kho ghi sổ hai lần', 'Mỗi phiếu kho chỉ ghi sổ một lần (lần sau phải là bút toán đảo).', 'Báo Admin: đảo bút toán thừa, kiểm tồn của vật tư liên quan.', 'Kho + Admin', 'P0', 'control_rule_ledger_double_post', 130),
  ('mr_completed_short', 'Đề xuất', 'Đề xuất hoàn tất nhưng còn thiếu hàng', 'Đề xuất chỉ hoàn tất khi đủ hàng, hoặc phần thiếu đã ghi đóng nhu cầu có lý do.', 'Mua hàng ghi đóng nhu cầu có lý do, hoặc mở lại đề xuất để mua tiếp.', 'Mua hàng', 'P1', 'control_rule_mr_completed_short', 140),
  ('mr_ended_po_open', 'Đề xuất', 'Đề xuất đã kết thúc nhưng đơn mua còn mở', 'Kết thúc đề xuất khi còn đơn mua mở làm hàng về không còn nhu cầu để gắn.', 'Hủy đợt / kết thúc thiếu đơn mua còn mở, hoặc mở lại đề xuất nếu vẫn cần hàng.', 'Mua hàng', 'P1', 'control_rule_mr_ended_po_open', 150),
  ('order_over_need', 'Mua hàng', 'Đặt vượt nhu cầu không ghi lý do', 'Đặt nhiều hơn số đề xuất cần thì phải ghi lý do đặt vượt.', 'Người mua ghi lý do trên dòng đơn, hoặc giảm số đặt.', 'Mua hàng', 'P2', 'control_rule_order_over_need', 160),
  ('received_over', 'Kho', 'Nhận dư so với kế hoạch đợt', 'Nhận dư phải có lý do và người duyệt vì làm tăng công nợ ngoài giá trị đã duyệt.', 'Mua hàng kiểm lý do nhận dư; không đúng thì sửa số nhận nhầm hoặc trả NCC.', 'Mua hàng + Kho', 'P2', 'control_rule_received_over', 170),
  ('batch_quality_stuck', 'Kho', 'Đợt đã duyệt chất lượng lâu chưa nhập kho', 'Đợt đã kiểm chất lượng đạt phải nhập kho trong vài ngày để tồn và công nợ đúng.', 'Thủ kho mở đợt và bấm nhận vào kho, hoặc báo Mua hàng nếu hàng chưa về thật.', 'Kho', 'P1', 'control_rule_batch_quality_stuck', 180)
on conflict (code) do update set module = excluded.module, title = excluded.title, principle = excluded.principle, fix_hint = excluded.fix_hint,
  owner_hint = excluded.owner_hint, severity = excluded.severity, fn = excluded.fn, sort_order = excluded.sort_order, updated_at = now();

-- ── Bộ chạy ─────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.control_run(p_rule text default null, p_trigger text default 'cron')
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  r public.control_rules;
  v_run bigint; v_rules int := 0; v_opened int := 0; v_resolved int := 0; v_n int; v_errors jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('cron:control_run')) then
    return jsonb_build_object('skipped', true, 'reason', 'đang có lượt khác chạy');
  end if;
  insert into public.control_runs(trigger) values (left(coalesce(p_trigger, 'cron'), 20)) returning id into v_run;
  create temp table if not exists pg_temp.control_now (object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text,
    title text, detail jsonb, amount numeric, happened_on date, link text) on commit drop;
  for r in select * from public.control_rules where mode <> 'off' and (p_rule is null or code = p_rule) order by sort_order, code loop
    begin
      if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app_private' and p.proname = r.fn) then
        raise exception 'CONTROL_RULE_FN_MISSING %', r.fn;
      end if;
      truncate pg_temp.control_now;
      execute format('insert into pg_temp.control_now select * from app_private.%I()', r.fn);
      -- Lệch mới → mở; đang có → cập nhật bằng chứng; đã tự đóng mà lệch lại → mở lại (giữ "chấp nhận" nếu Admin đã chấp nhận).
      with up as (
        insert into public.control_findings as f (rule_code, object_key, object_type, object_id, object_code, project_id, warehouse_id, title, detail, amount, happened_on, link, legacy)
        select distinct on (n.object_key) r.code, n.object_key, n.object_type, n.object_id, n.object_code, n.project_id, n.warehouse_id, left(n.title, 400), coalesce(n.detail, '{}'::jsonb),
          n.amount, n.happened_on, n.link, n.happened_on is not null and n.happened_on < r.since_date
        from pg_temp.control_now n where n.object_key is not null order by n.object_key
        on conflict (rule_code, object_key) do update set
          object_code = excluded.object_code, project_id = excluded.project_id, warehouse_id = excluded.warehouse_id, title = excluded.title, detail = excluded.detail,
          amount = excluded.amount, happened_on = excluded.happened_on, link = excluded.link, legacy = excluded.legacy, last_seen_at = now(),
          status = case when f.status = 'resolved' then 'open' else f.status end,
          first_seen_at = case when f.status = 'resolved' then now() else f.first_seen_at end,
          resolved_at = case when f.status = 'resolved' then null else f.resolved_at end
        returning (xmax = 0) as inserted)
      select count(*) into v_n from up where inserted;
      v_opened := v_opened + coalesce(v_n, 0);
      -- Hết lệch → tự đóng (cả hồ sơ đã chấp nhận).
      update public.control_findings f set status = 'resolved', resolved_at = now()
      where f.rule_code = r.code and f.status <> 'resolved' and not exists (select 1 from pg_temp.control_now n where n.object_key = f.object_key);
      get diagnostics v_n = row_count;
      v_resolved := v_resolved + v_n;
      v_rules := v_rules + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('rule', r.code, 'error', left(sqlerrm, 300));
    end;
  end loop;
  update public.control_runs set finished_at = now(), rules = v_rules, opened = v_opened, resolved = v_resolved, errors = v_errors,
    open_total = (select count(*) from public.control_findings where status = 'open')
  where id = v_run;
  return jsonb_build_object('run', v_run, 'rules', v_rules, 'opened', v_opened, 'resolved', v_resolved, 'errors', v_errors);
end $$;
revoke all on function app_private.control_run(text, text) from public, anon, authenticated;

-- ── Lệnh cho Admin (Trung tâm AI → Kiểm soát) ──────────────────────────────────────────────────────────────────────
create or replace function public.control_overview_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'CONTROL_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'rules', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', r.code, 'module', r.module, 'title', r.title, 'principle', r.principle, 'fixHint', r.fix_hint, 'ownerHint', r.owner_hint,
        'severity', r.severity, 'mode', r.mode, 'sinceDate', r.since_date,
        'open', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'open' and not f.legacy),
        'openLegacy', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'open' and f.legacy),
        'accepted', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'accepted'),
        'resolved7d', (select count(*) from public.control_findings f where f.rule_code = r.code and f.status = 'resolved' and f.resolved_at > now() - interval '7 days'),
        'amountOpen', (select round(sum(abs(f.amount))) from public.control_findings f where f.rule_code = r.code and f.status = 'open'))
      order by r.sort_order, r.code), '[]'::jsonb) from public.control_rules r),
    'lastRun', (select jsonb_build_object('id', x.id, 'startedAt', x.started_at, 'finishedAt', x.finished_at, 'trigger', x.trigger, 'rules', x.rules,
        'opened', x.opened, 'resolved', x.resolved, 'openTotal', x.open_total, 'errors', x.errors)
      from public.control_runs x order by x.id desc limit 1));
end $$;

create or replace function public.control_findings_v1(p_rule text default null, p_status text default 'open', p_legacy boolean default null, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'CONTROL_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if coalesce(p_status, 'open') not in ('open', 'accepted', 'resolved', 'all') then raise exception 'CONTROL_BAD_STATUS' using errcode = '22023'; end if;
  return (select coalesce(jsonb_agg(x order by x->>'severity', (x->>'happenedOn') desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object('id', f.id, 'rule', f.rule_code, 'ruleTitle', r.title, 'module', r.module, 'severity', r.severity, 'ownerHint', r.owner_hint,
      'objectType', f.object_type, 'objectId', f.object_id, 'objectCode', f.object_code, 'projectId', f.project_id,
      'projectName', (select coalesce(nullif(p.code, ''), p.name) from public.projects p where p.id = f.project_id),
      'title', f.title, 'detail', f.detail, 'amount', f.amount, 'happenedOn', f.happened_on, 'link', f.link, 'legacy', f.legacy, 'status', f.status,
      'firstSeenAt', f.first_seen_at, 'lastSeenAt', f.last_seen_at, 'resolvedAt', f.resolved_at,
      'acceptedAt', f.accepted_at, 'acceptedReason', f.accepted_reason, 'acceptedBy', (select u.name from public.users u where u.id = f.accepted_by)) x
    from public.control_findings f join public.control_rules r on r.code = f.rule_code
    where (p_rule is null or f.rule_code = p_rule)
      and (coalesce(p_status, 'open') = 'all' or f.status = coalesce(p_status, 'open'))
      and (p_legacy is null or f.legacy = p_legacy)
    order by case r.severity when 'P0' then 0 when 'P1' then 1 else 2 end, f.happened_on desc nulls last
    limit least(greatest(coalesce(p_limit, 200), 1), 500)) s);
end $$;

create or replace function public.control_finding_accept_v1(p_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v public.control_findings; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'CONTROL_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if length(v_reason) < 10 then raise exception 'CONTROL_REASON_REQUIRED' using errcode = '22023'; end if;
  update public.control_findings set status = 'accepted', accepted_at = now(), accepted_by = public.current_app_user_id(), accepted_reason = left(v_reason, 500)
  where id = p_id and status = 'open' returning * into v;
  if v.id is null then raise exception 'CONTROL_FINDING_NOT_OPEN' using errcode = 'PT409'; end if;
  insert into public.audit_trail(table_name, record_id, record_label, action, old_data, new_data, user_id, user_name, module, description, impact_level, context)
  values ('control_findings', v.id::text, coalesce(v.object_code, v.rule_code), 'UPDATE', jsonb_build_object('status', 'open'), jsonb_build_object('status', 'accepted', 'reason', v.accepted_reason),
    public.current_app_user_id()::text, (select name from public.users where id = public.current_app_user_id()), 'Kiểm soát', 'Chấp nhận lệch: ' || v.title, 'normal', jsonb_build_object('rule', v.rule_code));
  return jsonb_build_object('id', v.id, 'status', v.status);
end $$;

create or replace function public.control_finding_reopen_v1(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v public.control_findings;
begin
  if not public.is_admin() then raise exception 'CONTROL_ADMIN_REQUIRED' using errcode = '42501'; end if;
  update public.control_findings set status = 'open', accepted_at = null, accepted_by = null, accepted_reason = null
  where id = p_id and status = 'accepted' returning * into v;
  if v.id is null then raise exception 'CONTROL_FINDING_NOT_ACCEPTED' using errcode = 'PT409'; end if;
  insert into public.audit_trail(table_name, record_id, record_label, action, old_data, new_data, user_id, user_name, module, description, impact_level, context)
  values ('control_findings', v.id::text, coalesce(v.object_code, v.rule_code), 'UPDATE', jsonb_build_object('status', 'accepted'), jsonb_build_object('status', 'open'),
    public.current_app_user_id()::text, (select name from public.users where id = public.current_app_user_id()), 'Kiểm soát', 'Mở lại lệch: ' || v.title, 'normal', jsonb_build_object('rule', v.rule_code));
  return jsonb_build_object('id', v.id, 'status', v.status);
end $$;

create or replace function public.control_run_now_v1(p_rule text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'CONTROL_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return app_private.control_run(p_rule, 'admin');
end $$;

revoke all on function public.control_overview_v1(), public.control_findings_v1(text, text, boolean, integer), public.control_finding_accept_v1(uuid, text),
  public.control_finding_reopen_v1(uuid), public.control_run_now_v1(text) from public, anon;
grant execute on function public.control_overview_v1(), public.control_findings_v1(text, text, boolean, integer), public.control_finding_accept_v1(uuid, text),
  public.control_finding_reopen_v1(uuid), public.control_run_now_v1(text) to authenticated;

-- ── Lịch: 15 phút một lượt ──────────────────────────────────────────────────────────────────────────────────────────
select cron.schedule('control-findings-every-15-minutes', '*/15 * * * *', 'select app_private.control_run();');
