-- ===========================================================================
-- Tạm ứng NCC + phần Quản trị của module Tài chính (03/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 15; mockup .superpowers/review/work-plan/fa-v1.html
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 6 câu 03/10):
-- * Tạm ứng gắn MỘT đơn hàng (PO, không phải đơn theo HĐ nguyên tắc) hoặc MỘT HĐ nguyên tắc + dự án (hoặc Kho Tổng = cấp công ty).
--   Tổng tạm ứng của một PO không vượt giá trị đơn (gồm VAT).
-- * Không chặn theo %: vượt ngưỡng cảnh báo (mặc định 30%) chỉ nhắc; vượt ngưỡng duyệt thêm (mặc định 50%) thì thêm bước
--   "Duyệt tạm ứng vượt X%" do người được cài ở Quản trị duyệt (mặc định TGĐ). Lý do luôn bắt buộc.
-- * Dùng chung đề nghị chi K3b: ma trận duyệt, cộng dồn 7 ngày cùng NCC, luật 3 người (lập ≠ duyệt ≠ xác nhận chi), UNC + file.
-- * Xác nhận đã chi → một phiếu chi (supplier_payment_batches, metadata.kind = 'advance') + dòng tiền ra của dự án
--   (source_ref supplier_payment_batch:…, như mọi khoản chi NCC). Tạm ứng KHÔNG phải chi phí.
-- * Cấn trừ: công nợ của cùng PO / cùng HĐ + cùng dự án được ghi (kho nhận hàng, chốt đối soát) → tự trừ tạm ứng còn lại vào chứng từ
--   (phân bổ của phiếu chi tạm ứng vào chứng từ; mỗi lần cấn trừ ghi supplier_advance_offsets). Trừ hết vào các đợt đầu.
--   Kế toán hoàn tác được (bắt buộc lý do) và cấn trừ tay lại. Lỗi cấn trừ tự động không chặn kho nhận hàng (ghi nhật ký).
-- * Luồng ngược: trả hàng NCC làm chứng từ vượt phần đã trả → phần cấn trừ được trả lại tạm ứng; chứng từ bị hủy/đảo → trả lại toàn bộ.
--   Đơn kết thúc (đã giao đủ / kết thúc thiếu / hủy) mà còn tạm ứng → "chờ hoàn": NCC hoàn tiền (ghi phiếu thu hoàn ứng, người khác
--   xác nhận) hoặc chuyển sang đơn khác cùng NCC, cùng dự án (người khác xác nhận). Đảo phiếu chi tạm ứng chỉ khi chưa cấn trừ / hoàn.
-- * Quản trị: ngưỡng cảnh báo, ngưỡng duyệt thêm, người duyệt thêm, số ngày cộng vào hạn hoàn ứng — Admin / Quản trị Tài chính sửa,
--   có lý do, ghi nhật ký. Màn Quản trị hiện ai đang giữ từng quyền Tài chính.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Bảng
-- ---------------------------------------------------------------------------
alter table public.finance_settings
  add column advance_warn_percent numeric(5,2) not null default 30 check (advance_warn_percent between 0 and 100),
  add column advance_extra_percent numeric(5,2) not null default 50 check (advance_extra_percent between 0 and 100),
  add column advance_extra_approver_ids uuid[] not null default '{}',
  add column advance_repay_grace_days integer not null default 0 check (advance_repay_grace_days between 0 and 365);
-- Người duyệt thêm mặc định: TGĐ Dương Xuân Thịnh (đang giữ Tài chính — Quản trị).
update public.finance_settings set advance_extra_approver_ids = array['d2c494c2-bbd4-4ea2-a194-ad3cb0faa6d5']::uuid[] where id = 1;

alter table public.finance_payment_requests
  add column kind text not null default 'payable' check (kind in ('payable', 'advance')),
  add column purchase_order_id text references public.purchase_orders(id),
  add column supplier_contract_id text references public.supplier_contracts(id),
  add column project_id text references public.projects(id),
  add column construction_site_id text,
  add column advance_base numeric(18,2),
  add column advance_percent numeric(7,3),
  add column repay_due_date date,
  add constraint finance_payment_requests_advance_check check (kind <> 'advance'
    or ((purchase_order_id is null) <> (supplier_contract_id is null) and repay_due_date is not null));
create index finance_payment_requests_po_idx on public.finance_payment_requests (purchase_order_id) where kind = 'advance';
create sequence public.finance_advance_seq;
revoke all on sequence public.finance_advance_seq from public, anon, authenticated;

create table public.supplier_advance_offsets (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_payment_requests(id),
  payment_batch_id uuid not null references public.supplier_payment_batches(id),
  payable_document_id uuid not null references public.supplier_payable_documents(id),
  amount numeric(18,2) not null check (amount > 0),
  released_amount numeric(18,2) not null default 0 check (released_amount >= 0 and released_amount <= amount),
  mode text not null check (mode in ('auto', 'manual')),
  status text not null default 'active' check (status in ('active', 'released')),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  released_by uuid references public.users(id),
  released_at timestamptz,
  release_kind text check (release_kind in ('manual', 'return', 'document_cancel')),
  release_reason text
);
create index supplier_advance_offsets_request_idx on public.supplier_advance_offsets (request_id);
create index supplier_advance_offsets_doc_idx on public.supplier_advance_offsets (payable_document_id) where status = 'active';

create table public.supplier_advance_adjustments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.finance_payment_requests(id),
  kind text not null check (kind in ('refund', 'transfer')),
  amount numeric(18,2) not null check (amount > 0),
  target_purchase_order_id text references public.purchase_orders(id),
  source_purchase_order_id text,
  payment_date date,
  document_ref text,
  attachments jsonb not null default '[]'::jsonb,
  reason text not null check (length(btrim(reason)) > 0),
  status text not null default 'submitted' check (status in ('submitted', 'confirmed', 'rejected', 'withdrawn', 'reversed')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  decision_note text,
  check (kind <> 'refund' or (payment_date is not null and document_ref is not null)),
  check (kind <> 'transfer' or target_purchase_order_id is not null)
);
create unique index supplier_advance_adjustments_one_open on public.supplier_advance_adjustments (request_id) where status = 'submitted';

do $$ declare t text; begin
  foreach t in array array['supplier_advance_offsets', 'supplier_advance_adjustments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (app_private.finance_can(''view''))', t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Trợ giúp: phạm vi, số dư tạm ứng, đích tạm ứng, luồng duyệt
-- ---------------------------------------------------------------------------
create function app_private.finance_scope_key(p_project_id text, p_site_id text)
returns text language sql immutable set search_path = '' as $$
  select coalesce(p_project_id, 'site:' || coalesce(p_site_id, ''));
$$;

-- PO của chứng từ công nợ (nhận hàng PO, kể cả đối chiếu lùi ngày).
create function app_private.finance_doc_purchase_order(p_source_type text, p_source_id text, p_metadata jsonb)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(case when p_source_type = 'purchase_delivery_receipt' then
    (select b.purchase_order_id::text from public.purchase_order_delivery_batches b where b.id::text = p_source_id) end, p_metadata->>'purchaseOrderId');
$$;

-- Mọi khoản tạm ứng, kèm số đã cấn trừ, đã hoàn, còn lại; đích đã kết thúc (đơn giao đủ / kết thúc / hủy, HĐ đóng).
create function app_private.finance_advance_rows()
returns table (id uuid, code text, supplier_id text, supplier_name text, project_id text, construction_site_id text, status text,
  purchase_order_id text, supplier_contract_id text, amount numeric, offset_amount numeric, refunded numeric, remaining numeric,
  repay_due_date date, batch_id uuid, target_closed boolean, paid_date date, created_by uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select r.id, r.code, r.supplier_id, r.supplier_name, r.project_id, r.construction_site_id, r.status, r.purchase_order_id, r.supplier_contract_id,
    r.amount, coalesce(o.amt, 0), coalesce(f.amt, 0),
    case when r.status = 'paid' then greatest(round(r.amount - coalesce(o.amt, 0) - coalesce(f.amt, 0), 2), 0) else 0 end,
    r.repay_due_date, nullif(r.paid->'batches'->0->>'batchId', '')::uuid,
    coalesce((select po.status in ('delivered', 'closed', 'returned', 'cancelled') or po.archived_at is not null
        from public.purchase_orders po where po.id = r.purchase_order_id),
      (select coalesce(c.status, '') in ('cancelled', 'completed') from public.supplier_contracts c where c.id = r.supplier_contract_id), false),
    nullif(r.paid->>'paymentDate', '')::date, r.created_by, r.created_at
  from public.finance_payment_requests r
  left join lateral (select sum(x.amount - x.released_amount) amt from public.supplier_advance_offsets x where x.request_id = r.id and x.status = 'active') o on true
  left join lateral (select sum(a.amount) amt from public.supplier_advance_adjustments a where a.request_id = r.id and a.kind = 'refund' and a.status = 'confirmed') f on true
  where r.kind = 'advance';
$$;

-- Đích tạm ứng: PO đang mở của NCC (không phải đơn theo HĐ) hoặc HĐ còn hiệu lực + dự án. base = giá trị đơn gồm VAT / giá trị HĐ.
create function app_private.finance_advance_target(p_supplier text, p_po text, p_contract text, p_project text, p_exclude uuid)
returns table (purchase_order_id text, supplier_contract_id text, project_id text, construction_site_id text, base numeric, received numeric,
  other numeric, po_number text, contract_code text, expected_date date)
language plpgsql stable security definer set search_path = '' as $$
declare v_po public.purchase_orders%rowtype; v_c public.supplier_contracts%rowtype;
begin
  if nullif(p_po, '') is not null then
    select * into v_po from public.purchase_orders where id = p_po;
    if not found or v_po.vendor_id is distinct from p_supplier then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_SCOPE'; end if;
    if v_po.supplier_contract_id is not null then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_CONTRACT_ORDER'; end if;
    if v_po.status not in ('sent', 'confirmed', 'in_transit', 'partial') or v_po.archived_at is not null then
      raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_CLOSED'; end if;
    purchase_order_id := v_po.id; project_id := v_po.project_id; construction_site_id := v_po.construction_site_id;
    base := round(coalesce(v_po.total_amount, 0) * (1 + coalesce(v_po.vat_rate, 0) / 100), 2);
    received := (select coalesce(sum(b.accepted_gross_amount), 0) from public.purchase_order_delivery_batches b
      where b.purchase_order_id::text = v_po.id and b.status in ('received', 'received_short', 'received_over'));
    other := (select coalesce(sum(r.amount), 0) from public.finance_payment_requests r where r.kind = 'advance' and r.purchase_order_id = v_po.id
      and r.status in ('pending', 'returned', 'approved', 'paid') and r.id is distinct from p_exclude);
    po_number := v_po.po_number; expected_date := v_po.expected_delivery_date;
  elsif nullif(p_contract, '') is not null then
    select * into v_c from public.supplier_contracts where id = p_contract;
    if not found or v_c.supplier_id is distinct from p_supplier then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_SCOPE'; end if;
    if coalesce(v_c.status, '') in ('cancelled', 'completed') or (v_c.expiry_date is not null and v_c.expiry_date < (now() at time zone 'Asia/Ho_Chi_Minh')::date) then
      raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_CLOSED'; end if;
    if nullif(p_project, '') is not null and not exists (select 1 from public.projects p where p.id = p_project) then
      raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_SCOPE'; end if;
    supplier_contract_id := v_c.id; project_id := nullif(p_project, ''); construction_site_id := null;
    base := nullif(v_c.value, 0); received := null;
    other := (select coalesce(sum(r.amount), 0) from public.finance_payment_requests r where r.kind = 'advance' and r.supplier_contract_id = v_c.id
      and r.project_id is not distinct from nullif(p_project, '') and r.status in ('pending', 'returned', 'approved', 'paid') and r.id is distinct from p_exclude);
    contract_code := v_c.code; expected_date := v_c.expiry_date;
  else
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_REQUIRED';
  end if;
  return next;
end $$;

-- Luồng duyệt tạm ứng = ma trận đề nghị chi (cộng dồn 7 ngày cùng NCC) + bước duyệt thêm khi vượt ngưỡng %.
-- Người duyệt thêm đã có mặt trong luồng (VD TGĐ ở mức ≥ 1 tỷ) thì không thêm bước (một người không duyệt hai bước).
create function app_private.finance_advance_route(p_supplier text, p_amount numeric, p_percent numeric, p_creator uuid, p_exclude uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_route jsonb := app_private.finance_payment_route(p_supplier, p_amount, '{}'::uuid[], p_creator, p_exclude);
  v_set public.finance_settings%rowtype; v_ids uuid[]; v_existing uuid[]; v_eligible uuid[]; v_label text;
begin
  select * into v_set from public.finance_settings where id = 1;
  v_route := v_route || jsonb_build_object('percent', p_percent, 'warnPercent', v_set.advance_warn_percent, 'extraPercent', v_set.advance_extra_percent);
  if p_percent is null or p_percent <= v_set.advance_extra_percent then return v_route; end if;
  v_label := 'Duyệt tạm ứng vượt ' || to_char(v_set.advance_extra_percent, 'FM990.##') || '%';
  v_ids := v_set.advance_extra_approver_ids;
  if cardinality(v_ids) = 0 then
    return v_route || jsonb_build_object('problemStep', coalesce(v_route->>'problemStep', v_label || ' (chưa cài người duyệt)'));
  end if;
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_existing
  from jsonb_array_elements(v_route->'steps') s cross join jsonb_array_elements_text(s->'approverIds') x;
  if v_ids && v_existing then return v_route || jsonb_build_object('extraCovered', true); end if;
  select coalesce(array_agg(distinct u), '{}'::uuid[]) into v_eligible
  from (select unnest(v_ids) u union select unnest(app_private.finance_active_delegates(i)) from unnest(v_ids) i) q
  join public.users usr on usr.id = q.u and coalesce(usr.is_active, true)
  where q.u is distinct from p_creator;
  v_route := jsonb_set(v_route, '{steps}', (v_route->'steps') || jsonb_build_array(jsonb_build_object('label', v_label, 'approverIds', to_jsonb(v_ids),
    'eligibleIds', to_jsonb(v_eligible), 'extra', true,
    'approverNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_ids) i),
    'eligibleNames', (select coalesce(jsonb_agg(app_private.finance_user_name(i)), '[]'::jsonb) from unnest(v_eligible) i))));
  if cardinality(v_eligible) = 0 and v_route->>'problemStep' is null then v_route := v_route || jsonb_build_object('problemStep', v_label); end if;
  return v_route;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Cấn trừ / trả lại
-- ---------------------------------------------------------------------------
-- Cấn trừ tạm ứng vào một chứng từ (cùng NCC, cùng dự án, cùng PO / HĐ). p_amount null = tối đa có thể.
create function app_private.finance_advance_apply(p_request uuid, p_doc uuid, p_amount numeric, p_mode text, p_actor uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
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
      or (r.supplier_contract_id is not null and v_doc.supplier_contract_id = r.supplier_contract_id)) then
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
end $$;

-- Trả lại phần đã cấn trừ (toàn bộ hoặc một phần). Không sửa trạng thái chứng từ — nơi gọi tự tính.
create function app_private.finance_advance_release(p_offset uuid, p_amount numeric, p_kind text, p_reason text, p_actor uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare o public.supplier_advance_offsets%rowtype; v_take numeric; v_code text;
begin
  select * into o from public.supplier_advance_offsets where id = p_offset for update;
  if not found or o.status <> 'active' then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OFFSET_STATE'; end if;
  v_take := round(least(coalesce(p_amount, o.amount - o.released_amount), o.amount - o.released_amount), 2);
  if v_take <= 0 then return 0; end if;
  update public.supplier_advance_offsets set released_amount = released_amount + v_take,
    status = case when released_amount + v_take >= amount - 0.004 then 'released' else 'active' end,
    released_by = p_actor, released_at = now(), release_kind = p_kind, release_reason = p_reason
  where id = p_offset;
  update public.supplier_payment_allocations set allocated_amount = allocated_amount - v_take
  where payment_batch_id = o.payment_batch_id and payable_document_id = o.payable_document_id;
  delete from public.supplier_payment_allocations where payment_batch_id = o.payment_batch_id and payable_document_id = o.payable_document_id
    and allocated_amount <= 0.004;
  select code into v_code from public.finance_payment_requests where id = o.request_id;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  select 'advance', o.request_id::text, d.supplier_id, 'advance_release', p_actor, p_reason,
    jsonb_build_object('code', v_code, 'documentId', d.id, 'documentNo', d.document_no, 'amount', v_take, 'kind', p_kind)
  from public.supplier_payable_documents d where d.id = o.payable_document_id;
  return v_take;
end $$;

create function app_private.finance_doc_settled(p_doc uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(a.allocated_amount + a.discount_amount + a.withholding_amount), 0)
  from public.supplier_payment_allocations a join public.supplier_payment_batches b on b.id = a.payment_batch_id and b.status = 'paid'
  where a.payable_document_id = p_doc;
$$;

-- Công nợ mới của PO / HĐ → trừ các tạm ứng còn lại (tạm ứng chi trước trừ trước).
create function app_private.finance_advance_auto_apply_doc(p_doc uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare v_doc public.supplier_payable_documents%rowtype; v_po text; r record; v_total numeric := 0;
begin
  select * into v_doc from public.supplier_payable_documents where id = p_doc;
  if not found or coalesce(v_doc.recognized_amount, 0) <= 0 then return 0; end if;
  v_po := app_private.finance_doc_purchase_order(v_doc.source_type, v_doc.source_id, v_doc.metadata);
  if v_po is null and v_doc.supplier_contract_id is null then return 0; end if;
  for r in select x.id from app_private.finance_advance_rows() x
    where x.status = 'paid' and x.remaining > 0.004 and x.supplier_id = v_doc.supplier_id
      and app_private.finance_scope_key(x.project_id, x.construction_site_id) = app_private.finance_scope_key(v_doc.project_id, v_doc.construction_site_id)
      and ((x.purchase_order_id is not null and x.purchase_order_id = v_po) or (x.supplier_contract_id is not null and x.supplier_contract_id = v_doc.supplier_contract_id))
    order by x.paid_date, x.code
  loop
    exit when (select status from public.supplier_payable_documents where id = p_doc) not in ('open', 'partial');
    v_total := v_total + app_private.finance_advance_apply(r.id, p_doc, null, 'auto', coalesce(public.current_app_user_id(), v_doc.created_by));
  end loop;
  return v_total;
end $$;

-- Tạm ứng vừa chi / vừa chuyển đích → trừ vào công nợ đang mở của đích (chứng từ cũ trước).
create function app_private.finance_advance_auto_apply_request(p_request uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare r record; d record; v_total numeric := 0;
begin
  select * into r from app_private.finance_advance_rows() x where x.id = p_request;
  if not found or r.status <> 'paid' then return 0; end if;
  for d in select x.id from public.supplier_payable_documents x
    where x.supplier_id = r.supplier_id and x.status in ('open', 'partial')
      and app_private.finance_scope_key(x.project_id, x.construction_site_id) = app_private.finance_scope_key(r.project_id, r.construction_site_id)
      and ((r.purchase_order_id is not null and app_private.finance_doc_purchase_order(x.source_type, x.source_id, x.metadata) = r.purchase_order_id)
        or (r.supplier_contract_id is not null and x.supplier_contract_id = r.supplier_contract_id))
    order by x.document_date, x.created_at
  loop
    exit when (select y.remaining from app_private.finance_advance_rows() y where y.id = p_request) <= 0.004;
    v_total := v_total + app_private.finance_advance_apply(p_request, d.id, null, 'auto', public.current_app_user_id());
  end loop;
  return v_total;
end $$;

-- Trigger: chứng từ mở lần đầu → cấn trừ tự động. Lỗi không được chặn nghiệp vụ kho / đối soát: ghi nhật ký để kế toán cấn trừ tay.
create function app_private.trg_supplier_advance_auto_offset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.status in ('open', 'partial', 'paid') then return null; end if;
  if not exists (select 1 from public.finance_payment_requests r where r.kind = 'advance' and r.status = 'paid' and r.supplier_id = new.supplier_id) then return null; end if;
  begin
    perform app_private.finance_advance_auto_apply_doc(new.id);
  exception when others then
    insert into public.finance_events (entity_type, entity_id, supplier_id, action, reason, payload)
    values ('payable_document', new.id::text, new.supplier_id, 'advance_offset_failed', sqlerrm, jsonb_build_object('documentNo', new.document_no));
  end;
  return null;
end $$;
create trigger trg_supplier_advance_auto_offset after insert or update of status on public.supplier_payable_documents
  for each row when (new.status in ('open', 'partial')) execute function app_private.trg_supplier_advance_auto_offset();

-- Trigger: trả hàng NCC (giảm trừ tăng) làm chứng từ vượt phần đã trả → trả lại phần cấn trừ; chứng từ hủy/đảo → trả lại toàn bộ.
create function app_private.trg_supplier_advance_release()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cancel boolean := new.status in ('cancelled', 'reversed') and old.status not in ('cancelled', 'reversed');
  v_excess numeric; v_settled numeric; o record;
begin
  if not exists (select 1 from public.supplier_advance_offsets x where x.payable_document_id = new.id and x.status = 'active') then return new; end if;
  v_settled := app_private.finance_doc_settled(new.id);
  v_excess := case when v_cancel then v_settled else round(coalesce(new.credit_amount, 0) + v_settled - coalesce(new.recognized_amount, 0), 2) end;
  if v_excess <= 0.004 then return new; end if;
  for o in select x.id from public.supplier_advance_offsets x where x.payable_document_id = new.id and x.status = 'active' order by x.created_at desc loop
    exit when v_excess <= 0.004;
    v_excess := v_excess - app_private.finance_advance_release(o.id, case when v_cancel then null else v_excess end,
      case when v_cancel then 'document_cancel' else 'return' end,
      case when v_cancel then 'Chứng từ công nợ bị hủy / đảo — trả lại tạm ứng' else 'Trả hàng NCC — phần đã cấn trừ trả lại tạm ứng' end,
      public.current_app_user_id());
  end loop;
  if not v_cancel and new.status in ('open', 'partial', 'paid') then
    v_settled := app_private.finance_doc_settled(new.id);
    new.status := case when round(coalesce(new.recognized_amount, 0) - coalesce(new.credit_amount, 0) - v_settled, 2) <= 0 then 'paid'
      when v_settled > 0 then 'partial' else 'open' end;
  end if;
  return new;
end $$;
create trigger trg_supplier_advance_release before update on public.supplier_payable_documents
  for each row when (coalesce(new.credit_amount, 0) > coalesce(old.credit_amount, 0)
    or (new.status in ('cancelled', 'reversed') and old.status not in ('cancelled', 'reversed')))
  execute function app_private.trg_supplier_advance_release();

create function app_private.finance_doc_refresh_status(p_doc uuid)
returns void language sql security definer set search_path = '' as $$
  update public.supplier_payable_documents d set status = case when b.outstanding_amount <= 0 then 'paid' when b.paid_amount > 0 then 'partial' else 'open' end,
    updated_at = now()
  from public.supplier_payable_document_balances b where b.id = d.id and d.id = p_doc and d.status in ('open', 'partial', 'paid');
$$;

-- ---------------------------------------------------------------------------
-- 4. Lập / gửi lại đề nghị tạm ứng, xem trước, lựa chọn
-- ---------------------------------------------------------------------------
create function public.get_finance_advance_options_v1(p_supplier_id text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_set public.finance_settings%rowtype; v_bp public.business_partners%rowtype;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into v_set from public.finance_settings where id = 1;
  if nullif(p_supplier_id, '') is null then
    -- NCC có đơn đang chờ giao (chọn NCC trước khi lập tạm ứng).
    return jsonb_build_object('suppliers', coalesce((select jsonb_agg(x order by x->>'name') from (
      select jsonb_build_object('id', bp.id, 'name', bp.name, 'hasBank', nullif(btrim(coalesce(bp.bank_account, '')), '') is not null,
        'orders', count(po.id), 'value', round(sum(coalesce(po.total_amount, 0) * (1 + coalesce(po.vat_rate, 0) / 100)), 2)) x
      from public.purchase_orders po join public.business_partners bp on bp.id = po.vendor_id
      where po.status in ('sent', 'confirmed', 'in_transit', 'partial') and po.archived_at is null and po.supplier_contract_id is null
        and not exists (select 1 from public.finance_internal_partners ip where ip.supplier_id = bp.id)
      group by bp.id, bp.name, bp.bank_account) q), '[]'::jsonb));
  end if;
  select * into v_bp from public.business_partners where id = p_supplier_id;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  return jsonb_build_object('today', (now() at time zone 'Asia/Ho_Chi_Minh')::date, 'can', app_private.finance_can_flags(),
    'settings', jsonb_build_object('warnPercent', v_set.advance_warn_percent, 'extraPercent', v_set.advance_extra_percent, 'graceDays', v_set.advance_repay_grace_days),
    'supplier', jsonb_build_object('id', v_bp.id, 'name', v_bp.name, 'bankName', v_bp.bank_name, 'bankAccount', nullif(btrim(coalesce(v_bp.bank_account, '')), ''),
      'internal', exists (select 1 from public.finance_internal_partners ip where ip.supplier_id = v_bp.id)),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status,
        'projectId', po.project_id, 'projectCode', p.code, 'expectedDate', po.expected_delivery_date, 'vatRate', po.vat_rate,
        'base', round(coalesce(po.total_amount, 0) * (1 + coalesce(po.vat_rate, 0) / 100), 2),
        'received', (select coalesce(sum(b.accepted_gross_amount), 0) from public.purchase_order_delivery_batches b
          where b.purchase_order_id::text = po.id and b.status in ('received', 'received_short', 'received_over')),
        'advanced', (select coalesce(sum(r.amount), 0) from public.finance_payment_requests r where r.kind = 'advance' and r.purchase_order_id = po.id
          and r.status in ('pending', 'returned', 'approved', 'paid')),
        'items', (select string_agg(coalesce(i->>'name', i->>'itemName', ''), ', ') from (select i from jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) i limit 3) z))
        order by po.expected_delivery_date nulls last, po.po_number)
      from public.purchase_orders po left join public.projects p on p.id = po.project_id
      where po.vendor_id = v_bp.id and po.status in ('sent', 'confirmed', 'in_transit', 'partial') and po.archived_at is null and po.supplier_contract_id is null), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'status', c.status, 'value', nullif(c.value, 0),
        'expiryDate', c.expiry_date, 'projectId', c.project_id) order by c.code)
      from public.supplier_contracts c where c.supplier_id = v_bp.id and coalesce(c.status, '') not in ('cancelled', 'completed')
        and (c.expiry_date is null or c.expiry_date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date)), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code)
      from public.projects p where coalesce(p.status, '') not in ('cancelled', 'archived', 'completed_archived')), '[]'::jsonb));
end $$;

create function public.preview_finance_advance_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req uuid := nullif(p_input->>'requestId', '')::uuid;
  v_amount numeric := greatest(coalesce(round(nullif(p_input->>'amount', '')::numeric, 2), 0), 0.01); t record; v_bp record;
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  select * into t from app_private.finance_advance_target(v_supplier, p_input->>'purchaseOrderId', p_input->>'contractId', p_input->>'projectId', v_req);
  select bank_name, bank_account into v_bp from public.business_partners where id = v_supplier;
  return jsonb_build_object(
    'route', app_private.finance_advance_route(v_supplier, v_amount, case when t.base > 0 then round(v_amount * 100 / t.base, 3) end, v_actor, v_req),
    'target', jsonb_build_object('base', t.base, 'received', t.received, 'other', t.other, 'poNumber', t.po_number, 'contractCode', t.contract_code,
      'expectedDate', t.expected_date, 'projectId', t.project_id, 'available', case when t.base is not null then greatest(t.base - t.other, 0) end),
    'bank', case when nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then null else jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
    'internal', exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier),
    'canRecord', app_private.finance_can('record'));
end $$;

create function public.save_finance_advance_request_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_supplier text := p_input->>'supplierId'; v_req public.finance_payment_requests%rowtype;
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
  if exists (select 1 from public.finance_internal_partners where supplier_id = v_supplier) then
    raise exception using errcode = '22023', message = 'FINANCE_INTERNAL_PARTNER'; end if;
  select id, name, bank_name, bank_account into v_bp from public.business_partners where id = v_supplier;
  if not found then raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_NOT_FOUND'; end if;
  if v_method = 'bank_transfer' and nullif(btrim(coalesce(v_bp.bank_account, '')), '') is null then
    raise exception using errcode = '22023', message = 'FINANCE_SUPPLIER_BANK_REQUIRED'; end if;
  if nullif(p_input->>'requestId', '') is not null then
    select * into v_req from public.finance_payment_requests where id = (p_input->>'requestId')::uuid for update;
    if not found then raise exception using errcode = 'PT404', message = 'FINANCE_REQUEST_NOT_FOUND'; end if;
    if v_req.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_req.kind <> 'advance' or v_req.status <> 'returned' or v_req.created_by is distinct from v_actor then
      raise exception using errcode = '42501', message = 'FINANCE_REQUEST_STATE'; end if;
    if v_req.supplier_id is distinct from v_supplier then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_SCOPE'; end if;
    v_submission := v_req.submission_no + 1;
  end if;
  if nullif(p_input->>'purchaseOrderId', '') is not null then perform 1 from public.purchase_orders where id = p_input->>'purchaseOrderId' for update; end if;
  select * into t from app_private.finance_advance_target(v_supplier, p_input->>'purchaseOrderId', p_input->>'contractId', p_input->>'projectId', v_req.id);
  if t.base is not null and v_amount + t.other > t.base + 0.5 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER_ORDER'; end if;
  v_percent := case when t.base > 0 then round(v_amount * 100 / t.base, 3) end;
  v_route := app_private.finance_advance_route(v_supplier, v_amount, v_percent, v_actor, v_req.id);
  if v_route->>'problemStep' is not null then
    raise exception using errcode = '22023', message = 'FINANCE_NO_ELIGIBLE_APPROVER: ' || (v_route->>'problemStep'); end if;

  if v_req.id is null then
    v_code := 'TU-' || to_char(v_today, 'YYMM') || '-' || lpad(nextval('public.finance_advance_seq')::text, 3, '0');
    insert into public.finance_payment_requests (code, supplier_id, supplier_name, method, bank_snapshot, planned_date, amount, note, status,
      matrix_version_id, threshold_amount, prior_requests, route, current_step, created_by, kind, purchase_order_id, supplier_contract_id,
      project_id, construction_site_id, advance_base, advance_percent, repay_due_date)
    values (v_code, v_supplier, v_bp.name, v_method,
      case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      v_date, v_amount, v_note, 'pending', (v_route->>'versionId')::uuid, (v_route->>'thresholdAmount')::numeric,
      v_route->'priorRequests', v_route->'steps', 0, v_actor, 'advance', t.purchase_order_id, t.supplier_contract_id,
      t.project_id, t.construction_site_id, t.base, v_percent, v_due)
    returning id into v_id;
  else
    v_id := v_req.id; v_code := v_req.code;
    update public.finance_payment_requests set method = v_method,
      bank_snapshot = case when v_method = 'bank_transfer' then jsonb_build_object('bankName', v_bp.bank_name, 'account', v_bp.bank_account) end,
      planned_date = v_date, amount = v_amount, note = v_note, status = 'pending',
      matrix_version_id = (v_route->>'versionId')::uuid, threshold_amount = (v_route->>'thresholdAmount')::numeric, prior_requests = v_route->'priorRequests',
      route = v_route->'steps', current_step = 0, submission_no = v_submission, submitted_at = now(), decided_at = null,
      purchase_order_id = t.purchase_order_id, supplier_contract_id = t.supplier_contract_id, project_id = t.project_id,
      construction_site_id = t.construction_site_id, advance_base = t.base, advance_percent = v_percent, repay_due_date = v_due,
      updated_at = now(), row_version = row_version + 1
    where id = v_id;
  end if;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_id, v_submission, case when v_submission = 1 then 'Lập đề nghị tạm ứng và gửi duyệt' else 'Sửa và gửi lại' end, 'submit', v_actor,
    jsonb_build_object('amount', v_amount, 'percent', v_percent, 'thresholdAmount', v_route->'thresholdAmount', 'tierNo', v_route->'tierNo'));
  perform app_private.finance_notify(array(select jsonb_array_elements_text(v_route->'steps'->0->'eligibleIds')::uuid),
    'Đề nghị tạm ứng chờ bạn duyệt', v_code || ' · ' || v_bp.name || ' · ' || to_char(v_amount, 'FM999G999G999G990') || ' đ', v_id, v_actor);
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_id::text, v_supplier, 'advance_submit', v_actor,
    jsonb_build_object('code', v_code, 'amount', v_amount, 'percent', v_percent, 'purchaseOrder', t.po_number, 'contract', t.contract_code, 'submission', v_submission));
  return jsonb_build_object('requestId', v_id, 'code', v_code, 'amount', v_amount, 'route', v_route);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Xác nhận đã chi tạm ứng (gọi từ confirm_finance_payment_request_v1 sau các kiểm tra chung) và kiểm tra đảo
-- ---------------------------------------------------------------------------
create function app_private.finance_confirm_advance(p_request uuid, p_date date, p_ref text, p_attachments jsonb, p_note text, p_actor uuid, p_approver uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req public.finance_payment_requests%rowtype; v_bid uuid := gen_random_uuid(); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_finance text; v_tx text; v_ref text; v_po text; v_batches jsonb; v_applied numeric;
begin
  select * into v_req from public.finance_payment_requests where id = p_request;
  if exists (select 1 from public.purchase_orders po where po.id = v_req.purchase_order_id and (po.status in ('closed', 'returned', 'cancelled') or po.archived_at is not null))
    or exists (select 1 from public.supplier_contracts c where c.id = v_req.supplier_contract_id and coalesce(c.status, '') in ('cancelled', 'completed')) then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_TARGET_CLOSED'; end if;
  if app_private.finance_period_is_locked(v_req.project_id, v_req.construction_site_id, 'VND', p_date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
  select po_number into v_po from public.purchase_orders where id = v_req.purchase_order_id;
  insert into public.supplier_payment_batches (id, code, project_id, construction_site_id, supplier_id, supplier_name_snapshot, payment_date, payment_method,
    bank_account_snapshot, document_ref, total_recognized_snapshot, payment_amount, currency, allocation_mode, status, attachments, metadata,
    created_by, approved_by, approved_at, paid_by, paid_at, note)
  values (v_bid, 'PC-' || to_char(v_today, 'YYMMDD') || '-' || upper(substr(replace(v_bid::text, '-', ''), 1, 5)), v_req.project_id, v_req.construction_site_id,
    v_req.supplier_id, v_req.supplier_name, p_date, v_req.method, v_req.bank_snapshot->>'account', p_ref, 0, v_req.amount, 'VND', 'manual', 'paid', p_attachments,
    jsonb_build_object('kind', 'advance', 'requestId', v_req.id, 'requestCode', v_req.code, 'purchaseOrderId', v_req.purchase_order_id, 'contractId', v_req.supplier_contract_id)
      || case when v_req.project_id is null and v_req.construction_site_id is null then jsonb_build_object('scope', 'company') else '{}'::jsonb end,
    v_req.created_by, p_approver, now(), p_actor, now(), p_note);
  -- Dòng tiền ra của dự án (cùng dạng engine G7: supplier_payment_batch:… là tiền chi thật, không phải chi phí).
  select f.id into v_finance from public.project_finances f
  where (v_req.project_id is not null and f.project_id = v_req.project_id) or (v_req.construction_site_id is not null and f.construction_site_id = v_req.construction_site_id)
  order by case when v_req.project_id is not null and f.project_id = v_req.project_id then 0 else 1 end, f.id limit 1;
  v_ref := 'supplier_payment_batch:' || v_bid::text;
  insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref, attachments, "createdBy", "createdAt", counterparty_name, counterparty_partner_id)
  values ('supplier-payment-' || v_bid::text, coalesce(v_finance, ''), coalesce(v_req.construction_site_id, ''), v_req.project_id, v_finance, v_req.construction_site_id,
    'expense', 'materials', v_req.amount, 'Tạm ứng NCC ' || v_req.supplier_name || ' - ' || v_req.code || coalesce(' · ' || v_po, ''), p_date::text, 'workflow',
    v_ref, v_ref, coalesce(p_attachments, '[]'::jsonb), p_actor::text, now(), v_req.supplier_name, v_req.supplier_id)
  returning id into v_tx;
  update public.supplier_payment_batches set project_transaction_id = v_tx where id = v_bid;
  v_batches := jsonb_build_array(jsonb_build_object('batchId', v_bid, 'projectId', v_req.project_id, 'amount', v_req.amount));
  update public.finance_payment_requests set status = 'paid', updated_at = now(), row_version = row_version + 1,
    paid = jsonb_build_object('paymentDate', p_date, 'documentRef', p_ref, 'attachments', p_attachments, 'batches', v_batches,
      'by', p_actor, 'byName', app_private.finance_user_name(p_actor), 'at', now(), 'note', p_note)
  where id = v_req.id;
  insert into public.finance_payment_request_steps (request_id, submission_no, label, action, actor_id, payload)
  values (v_req.id, v_req.submission_no, 'Xác nhận đã chi tạm ứng ' || p_ref, 'paid', p_actor, jsonb_build_object('batches', v_batches, 'paymentDate', p_date));
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, payload)
  values ('payment_request', v_req.id::text, v_req.supplier_id, 'advance_paid', p_actor,
    jsonb_build_object('code', v_req.code, 'amount', v_req.amount, 'documentRef', p_ref, 'batches', v_batches));
  perform app_private.finance_notify(array[v_req.created_by], 'Tạm ứng đã chi', v_req.code || ' · ' || p_ref, v_req.id, p_actor);
  v_applied := app_private.finance_advance_auto_apply_request(v_req.id);
  return jsonb_build_object('requestId', v_req.id, 'status', 'paid', 'batches', v_batches, 'offset', v_applied);
end $$;

create function app_private.finance_assert_advance_reversible(p_request uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.supplier_advance_offsets where request_id = p_request and status = 'active') then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_HAS_OFFSETS'; end if;
  if exists (select 1 from public.supplier_advance_adjustments where request_id = p_request and status in ('submitted', 'confirmed') and kind = 'refund')
    or exists (select 1 from public.supplier_advance_adjustments where request_id = p_request and status = 'submitted') then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_HAS_ADJUSTMENTS'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Cấn trừ tay / hoàn tác, NCC hoàn tiền, chuyển sang đơn khác
-- ---------------------------------------------------------------------------
create function public.release_finance_advance_offset_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_reason text := nullif(btrim(p_input->>'reason'), ''); o public.supplier_advance_offsets%rowtype; v_take numeric;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select * into o from public.supplier_advance_offsets where id = (p_input->>'offsetId')::uuid;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_ADVANCE_OFFSET_STATE'; end if;
  perform 1 from public.supplier_payable_documents where id = o.payable_document_id for update;
  if app_private.finance_period_is_locked((select project_id from public.supplier_payable_documents where id = o.payable_document_id),
      (select construction_site_id from public.supplier_payable_documents where id = o.payable_document_id), 'VND', (now() at time zone 'Asia/Ho_Chi_Minh')::date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED'; end if;
  v_take := app_private.finance_advance_release(o.id, null, 'manual', v_reason, v_actor);
  perform app_private.finance_doc_refresh_status(o.payable_document_id);
  return jsonb_build_object('offsetId', o.id, 'released', v_take);
end $$;

create function public.apply_finance_advance_offset_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_amt numeric;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  v_amt := app_private.finance_advance_apply((p_input->>'requestId')::uuid, (p_input->>'documentId')::uuid,
    round(nullif(p_input->>'amount', '')::numeric, 2), 'manual', v_actor);
  if v_amt <= 0 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_OVER'; end if;
  return jsonb_build_object('amount', v_amt);
end $$;

create function public.save_finance_advance_adjustment_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_kind text := p_input->>'kind'; v_reason text := nullif(btrim(p_input->>'reason'), '');
  r record; v_req public.finance_payment_requests%rowtype; v_po public.purchase_orders%rowtype; v_amount numeric; v_date date := nullif(p_input->>'paymentDate', '')::date;
  v_ref text := nullif(btrim(p_input->>'documentRef'), ''); v_id uuid; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
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
    if jsonb_typeof(p_input->'attachments') is distinct from 'array' or jsonb_array_length(p_input->'attachments') = 0 then
      raise exception using errcode = '22023', message = 'FINANCE_ATTACHMENT_REQUIRED'; end if;
    insert into public.supplier_advance_adjustments (request_id, kind, amount, payment_date, document_ref, attachments, reason, created_by)
    values (v_req.id, 'refund', v_amount, v_date, v_ref, p_input->'attachments', v_reason, v_actor) returning id into v_id;
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
end $$;

create function public.decide_finance_advance_adjustment_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
end $$;

-- ---------------------------------------------------------------------------
-- 7. Danh sách tạm ứng (Tài chính → Phải trả → Tạm ứng NCC; chi tiết NCC)
-- ---------------------------------------------------------------------------
create function public.list_finance_advances_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
              from public.supplier_contracts c where c.id = a.supplier_contract_id)),
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
end $$;

-- ---------------------------------------------------------------------------
-- 8. Quản trị: thông số tạm ứng
-- ---------------------------------------------------------------------------
create function public.save_finance_advance_settings_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_set public.finance_settings%rowtype; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_warn numeric := nullif(p_input->>'warnPercent', '')::numeric; v_extra numeric := nullif(p_input->>'extraPercent', '')::numeric;
  v_grace integer := nullif(p_input->>'graceDays', '')::integer; v_ids uuid[];
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_ids from jsonb_array_elements_text(coalesce(p_input->'extraApproverIds', '[]'::jsonb)) x;
  if v_warn is null or v_extra is null or v_grace is null or v_warn < 0 or v_extra > 100 or v_warn > v_extra or v_grace < 0 or v_grace > 365
    or exists (select 1 from unnest(v_ids) i where not exists (select 1 from public.users u where u.id = i and coalesce(u.is_active, true))) then
    raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_SETTINGS_INVALID'; end if;
  if v_extra < 100 and cardinality(v_ids) = 0 then raise exception using errcode = '22023', message = 'FINANCE_ADVANCE_EXTRA_APPROVER_REQUIRED'; end if;
  select * into v_set from public.finance_settings where id = 1 for update;
  if v_set.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
  update public.finance_settings set advance_warn_percent = v_warn, advance_extra_percent = v_extra, advance_extra_approver_ids = v_ids,
    advance_repay_grace_days = v_grace, row_version = row_version + 1, updated_by = v_actor, updated_at = now() where id = 1;
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after)
  values ('settings', '1', 'advance_settings_save', v_actor, v_reason,
    jsonb_build_object('warnPercent', v_set.advance_warn_percent, 'extraPercent', v_set.advance_extra_percent, 'extraApproverIds', to_jsonb(v_set.advance_extra_approver_ids), 'graceDays', v_set.advance_repay_grace_days),
    jsonb_build_object('warnPercent', v_warn, 'extraPercent', v_extra, 'extraApproverIds', to_jsonb(v_ids), 'graceDays', v_grace));
  perform app_private.finance_notify_admins('Đổi thông số tạm ứng NCC', 'Cảnh báo ' || v_warn || '%, duyệt thêm ' || v_extra || '%: ' || v_reason, v_actor);
  return jsonb_build_object('ok', true);
end $$;

revoke all on function app_private.finance_scope_key(text, text), app_private.finance_doc_purchase_order(text, text, jsonb), app_private.finance_advance_rows(),
  app_private.finance_advance_target(text, text, text, text, uuid), app_private.finance_advance_route(text, numeric, numeric, uuid, uuid),
  app_private.finance_advance_apply(uuid, uuid, numeric, text, uuid), app_private.finance_advance_release(uuid, numeric, text, text, uuid),
  app_private.finance_doc_settled(uuid), app_private.finance_advance_auto_apply_doc(uuid), app_private.finance_advance_auto_apply_request(uuid),
  app_private.trg_supplier_advance_auto_offset(), app_private.trg_supplier_advance_release(), app_private.finance_doc_refresh_status(uuid),
  app_private.finance_confirm_advance(uuid, date, text, jsonb, text, uuid, uuid), app_private.finance_assert_advance_reversible(uuid)
  from public, anon, authenticated;
revoke all on function public.get_finance_advance_options_v1(text), public.preview_finance_advance_v1(jsonb), public.save_finance_advance_request_v1(jsonb),
  public.release_finance_advance_offset_v1(jsonb), public.apply_finance_advance_offset_v1(jsonb), public.save_finance_advance_adjustment_v1(jsonb),
  public.decide_finance_advance_adjustment_v1(jsonb), public.list_finance_advances_v1(jsonb), public.save_finance_advance_settings_v1(jsonb) from public, anon;
grant execute on function public.get_finance_advance_options_v1(text), public.preview_finance_advance_v1(jsonb), public.save_finance_advance_request_v1(jsonb),
  public.release_finance_advance_offset_v1(jsonb), public.apply_finance_advance_offset_v1(jsonb), public.save_finance_advance_adjustment_v1(jsonb),
  public.decide_finance_advance_adjustment_v1(jsonb), public.list_finance_advances_v1(jsonb), public.save_finance_advance_settings_v1(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Vá hàm đang chạy: xác nhận chi / đảo / danh sách đề nghị, chi tiết NCC, Tổng quan, Quản trị, trạng thái thanh toán PO
-- ---------------------------------------------------------------------------
-- Mua hàng thấy tạm ứng trên PO: đã tạm ứng, đang duyệt, đã cấn trừ, còn lại (không lộ UNC, người chi).
create or replace function public.get_procurement_po_payment_status_v1(p_po_ids text[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not (app_private.procurement_can('view') or app_private.finance_can('view')) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return coalesce((
    with docs as (
      select bt.purchase_order_id::text po_id, d.id, d.due_date, b.recognized_amount, b.credit_amount, b.paid_amount,
        greatest(b.recognized_amount - b.credit_amount - b.paid_amount, 0) outstanding,
        (select coalesce(sum(l.amount), 0) from public.finance_payment_request_lines l join public.finance_payment_requests r on r.id = l.request_id
          where l.payable_document_id = d.id and r.status in ('pending', 'returned', 'approved')) in_request,
        (select coalesce(sum(o.amount - o.released_amount), 0) from public.supplier_advance_offsets o where o.payable_document_id = d.id and o.status = 'active') advance_offset
      from public.supplier_payable_documents d
      join public.supplier_payable_document_balances b on b.id = d.id
      join public.purchase_order_delivery_batches bt on bt.id::text = d.source_id
      where d.source_type = 'purchase_delivery_receipt' and d.status not in ('cancelled', 'reversed', 'draft')
        and bt.purchase_order_id::text = any(p_po_ids)
    ), adv as (
      select x.purchase_order_id po_id, coalesce(sum(x.amount) filter (where x.status = 'paid'), 0) advance, coalesce(sum(x.remaining), 0) remaining,
        coalesce(sum(x.amount) filter (where x.status in ('pending', 'returned', 'approved')), 0) pending
      from app_private.finance_advance_rows() x where x.purchase_order_id = any(p_po_ids) group by 1
    ), per_doc as (
      select po_id, round(sum(recognized_amount), 2) recognized, round(sum(credit_amount), 2) credit, round(sum(paid_amount), 2) paid,
        round(sum(outstanding), 2) outstanding, round(sum(in_request), 2) in_request, round(sum(advance_offset), 2) advance_offset, count(*) documents,
        min(due_date) filter (where outstanding > 0.5) next_due, coalesce(bool_or(outstanding > 0.5 and due_date < v_today), false) overdue,
        case when sum(recognized_amount - credit_amount) <= 0.5 then 'none' when sum(outstanding) <= 0.5 then 'paid'
          when sum(paid_amount) > 0.5 then 'partial' else 'unpaid' end status
      from docs group by po_id
    ), ids as (select po_id from per_doc union select po_id from adv)
    select jsonb_object_agg(i.po_id, jsonb_build_object(
      'recognized', coalesce(p.recognized, 0), 'credit', coalesce(p.credit, 0), 'paid', coalesce(p.paid, 0), 'outstanding', coalesce(p.outstanding, 0),
      'inRequest', coalesce(p.in_request, 0), 'documents', coalesce(p.documents, 0), 'nextDue', p.next_due, 'overdue', coalesce(p.overdue, false),
      'status', coalesce(p.status, 'none'), 'advanceOffset', coalesce(p.advance_offset, 0),
      'advance', coalesce(a.advance, 0), 'advanceRemaining', coalesce(a.remaining, 0), 'advancePending', coalesce(a.pending, 0)))
    from ids i left join per_doc p on p.po_id = i.po_id left join adv a on a.po_id = i.po_id), '{}'::jsonb);
end $$;

create or replace function public.confirm_finance_payment_request_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_req public.finance_payment_requests%rowtype;
  v_date date := nullif(p_input->>'paymentDate', '')::date; v_ref text := nullif(btrim(p_input->>'documentRef'), '');
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; v_lines jsonb; g record; v_bid uuid; v_batches jsonb := '[]'::jsonb;
  v_last_approver uuid;
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

create or replace function public.get_finance_supplier_v1(p_supplier_id text)
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
        'supplierAdvance', (select nullif(sum(x.remaining), 0) from app_private.finance_advance_rows() x where x.project_id = s.id))
        order by coalesce((select sum(x.amount) from tx x where x.project_id = s.id), 0) desc, s.code)
        from scope s left join ap a on a.project_id = s.id left join recv r on r.project_id = s.id), '[]'::jsonb),
      'companyPayable', (select jsonb_build_object('outstanding', coalesce(sum(r.outstanding), 0), 'docs', count(*))
        from app_private.finance_payable_rows() r where r.outstanding > 0.5 and not r.internal and r.project_id is null),
      'advances', (select jsonb_build_object('remaining', coalesce(sum(x.remaining), 0),
          'overdue', coalesce(sum(x.remaining) filter (where not x.target_closed and x.repay_due_date < v_today), 0),
          'overdueCount', count(*) filter (where x.remaining > 0.004 and not x.target_closed and x.repay_due_date < v_today),
          'refundDue', coalesce(sum(x.remaining) filter (where x.target_closed), 0), 'refundDueCount', count(*) filter (where x.remaining > 0.004 and x.target_closed))
        from app_private.finance_advance_rows() x where x.remaining > 0.004)
    )
  );
end;
$function$;

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
      'advanceExtraApproverIds', to_jsonb(v_set.advance_extra_approver_ids), 'advanceGraceDays', v_set.advance_repay_grace_days),
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


notify pgrst, 'reload schema';
