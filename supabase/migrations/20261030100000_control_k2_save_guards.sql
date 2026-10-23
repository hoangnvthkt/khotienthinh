-- Kiểm soát viên K2 (chủ SP 23/10/2026): chặn ngay lúc lưu các lệch P0 mà người thao tác sửa được tại chỗ — bắt lý do hoặc
-- xác nhận, không chặn cứng việc đúng. Sáu ca lấy từ lệch thật K0 phát hiện:
--   1. Giá đối soát HĐ nguyên tắc khác giá NCC ghi trên phiếu giao (PO-609)  → lưu / ghi nợ bắt lý do.
--   2. Kết thúc đề xuất khi đơn mua còn mở (MR-2026-9833 / PO-671)           → xác nhận từng đơn; đơn của đề xuất đã kết thúc không gửi / duyệt.
--   3. VAT đợt giao khác VAT đơn không lý do (32/137 đợt)                     → mặc định VAT đơn; khác thì bắt lý do (đợt mới / khi đổi VAT).
--   4. Đặt vượt nhu cầu đề xuất không lý do (PO-694)                          → gửi duyệt bắt lý do từng dòng; người duyệt ghi lý do khi duyệt.
--   5. Sửa số nhận nhầm thấp hơn số đang trả NCC                              → chặn PURCHASE_FIX_RETURN_PENDING.
--   6. Sửa số nhận nhầm không giảm giá trị nhận của đợt (PO-272 đợt 2)        → giảm luôn; hàm ghi công nợ tính phần đã sửa; sửa dữ liệu.
-- Mọi hàm sửa dựng từ định nghĩa đang chạy trên Cloud ngày 23/10, chỉ chèn kiểm tra.

alter table public.purchase_order_delivery_batches add column if not exists vat_reason text;
comment on column public.purchase_order_delivery_batches.vat_reason is 'Lý do VAT đợt khác VAT đơn (K2) — bắt buộc khi lập đợt / đổi VAT khác đơn.';

-- Ca 2: đơn mua còn mở của đề xuất — chỉ đơn đang mua cho dòng còn chờ hàng (dòng đã đủ / đã đóng không tính).
create or replace function app_private.material_request_open_pos(p_request_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with waiting as materialized (
    select s.line_id from app_private.material_request_supply_lines_v1(array[p_request_id]) s where s.line_state = 'waiting')
  select coalesce(jsonb_agg(jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status, 'createdById', po.created_by_id)
    order by po.po_number), '[]'::jsonb)
  from public.purchase_orders po
  where po.archived_at is null and po.status in ('draft', 'sent', 'returned', 'confirmed', 'in_transit', 'partial')
    and exists (select 1 from public.purchase_order_request_lines l join waiting w on w.line_id = l.request_line_id
      where l.purchase_order_id = po.id and l.material_request_id = p_request_id);
$$;

-- Ca 2: người dùng đã xác nhận đúng mọi đơn đang mở (danh sách id đơn gửi kèm lệnh).
create or replace function app_private.material_request_open_pos_acked(p_open jsonb, p_ack jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_array_length(coalesce(p_open, '[]'::jsonb)) = 0
    or coalesce(jsonb_typeof(p_ack) = 'array' and p_ack @> (select jsonb_agg(e.value->'id') from jsonb_array_elements(p_open) e), false);
$$;

-- Ca 4: SL các đơn lập TRƯỚC đơn này đã đặt cho cùng dòng đề xuất (trừ phần kết thúc thiếu đã trả về nhu cầu).
create or replace function app_private.procurement_request_line_ordered_before(p_request_id text, p_line_id text, p_po_id text, p_created_at timestamptz)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(x.ordered_qty - app_private.procurement_link_credited_v2(p.id, x.purchase_order_line_id, x.ordered_qty, x.id)), 0)
  from public.purchase_order_request_lines x
  join public.purchase_orders p on p.id = x.purchase_order_id
  where x.material_request_id = p_request_id and x.request_line_id = p_line_id and x.purchase_order_id <> p_po_id
    and p.status not in ('cancelled', 'returned') and p.archived_at is null
    and (p.created_at, p.id) < (p_created_at, p_po_id);
$$;

-- Ca 4: dòng của đơn đặt vượt nhu cầu (cộng các đơn trước, dung sai 2% như "đủ hàng") mà chưa có lý do.
create or replace function app_private.procurement_po_excess_missing(p_po_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('linkId', prl.id, 'requestCode', prl.material_request_code, 'item', coalesce(i.name, prl.item_id),
      'unit', prl.unit, 'need', prl.requested_qty, 'ordered', prl.ordered_qty, 'otherOrdered', o.qty)
    order by prl.material_request_code, i.name), '[]'::jsonb)
  from public.purchase_order_request_lines prl
  join public.purchase_orders po on po.id = prl.purchase_order_id
  left join public.items i on i.id = prl.item_id
  cross join lateral (select app_private.procurement_request_line_ordered_before(prl.material_request_id, prl.request_line_id, po.id, po.created_at) qty) o
  where prl.purchase_order_id = p_po_id and coalesce(prl.requested_qty, 0) > 0
    and coalesce(prl.ordered_qty, 0) + o.qty > prl.requested_qty * 1.02 + 0.0001
    and coalesce(btrim(prl.excess_reason), '') = '';
$$;

-- Ca 6: tổng tiền các lần Sửa số nhận nhầm đã giảm trừ trên chứng từ nợ của đợt.
create or replace function app_private.purchase_receipt_corrected_amount(p_metadata jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(sum(nullif(c.value->>'amount', '')::numeric), 0)
  from jsonb_each(case when jsonb_typeof(p_metadata->'purchaseReceiptCorrections') = 'object' then p_metadata->'purchaseReceiptCorrections' else '{}'::jsonb end) c;
$$;

-- Ca 3: VAT đợt giao khác VAT đơn phải có lý do — chỉ khi lập đợt hoặc đổi VAT (đợt cũ đang nhận không bị chặn).
-- Lập đợt không truyền VAT (mặc định 0 ở các hàm cũ) mà đơn có VAT → lấy VAT đơn. Giao tiếp từ đợt trước cùng VAT → kế thừa lý do.
-- Lý do do hàm lưu đặt qua app.delivery_vat_reason (save_procurement_delivery_v1) hoặc cột vat_reason.
create or replace function app_private.guard_delivery_batch_vat_reason()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_po_vat numeric; v_reason text;
begin
  select coalesce(po.vat_rate, 0) into v_po_vat from public.purchase_orders po where po.id = new.purchase_order_id;
  if not found then return new; end if;
  if coalesce(new.vat_rate, 0) = v_po_vat then new.vat_reason := null; return new; end if;
  if tg_op = 'UPDATE' and new.vat_rate is not distinct from old.vat_rate then return new; end if;
  v_reason := coalesce(nullif(btrim(current_setting('app.delivery_vat_reason', true)), ''),
    case when tg_op = 'INSERT' or new.vat_reason is distinct from old.vat_reason then nullif(btrim(new.vat_reason), '') end);
  if v_reason is null and tg_op = 'INSERT' then
    select b.vat_reason into v_reason from public.purchase_order_delivery_batches b
    where b.purchase_order_id = new.purchase_order_id and b.vat_rate = new.vat_rate and nullif(btrim(b.vat_reason), '') is not null
    order by b.delivery_no desc limit 1;
    if v_reason is null and coalesce(new.vat_rate, 0) = 0 then
      new.vat_rate := v_po_vat; new.vat_reason := null; return new; end if;
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = format('PURCHASE_DELIVERY_VAT_REASON: VAT đợt %s%% khác VAT đơn %s%% — ghi lý do (VD NCC xuất hóa đơn không VAT) hoặc để VAT theo đơn.',
      trim_scale(coalesce(new.vat_rate, 0)), trim_scale(v_po_vat));
  end if;
  new.vat_reason := left(v_reason, 300);
  return new;
end $$;

drop trigger if exists trg_delivery_vat_reason_guard on public.purchase_order_delivery_batches;
create trigger trg_delivery_vat_reason_guard before insert or update of vat_rate, vat_reason on public.purchase_order_delivery_batches
for each row execute function app_private.guard_delivery_batch_vat_reason();

-- Ca 1 — lưu bảng đối soát: giá khác giá NCC ghi trên phiếu giao (và khác giá HĐ) phải có lý do.

CREATE OR REPLACE FUNCTION public.save_procurement_contract_statement_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_c public.supplier_contracts%rowtype;
  v_s public.supplier_delivery_statements%rowtype;
  v_id uuid := nullif(p_input->>'statementId', '')::uuid;
  v_month date := date_trunc('month', nullif(p_input->>'month', '')::date)::date;
  v_scopes integer; v_project text; v_site text; v_n integer;
  v_inv_vat numeric := nullif(p_input->>'invoiceVat', '')::numeric;
  v_cg numeric; v_cv numeric; v_g numeric; v_v numeric; v_dv numeric; v_adjusted integer;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_c from public.supplier_contracts where id = p_input->>'contractId';
  if not found or coalesce(v_c.status, '') = 'cancelled' then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if v_month is null or jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_EMPTY'; end if;

  create temp table if not exists pg_temp.fc_stmt_lines_v2 (line_id uuid primary key, unit_price numeric, vat_rate numeric, reason text, inv_amount numeric) on commit drop;
  truncate pg_temp.fc_stmt_lines_v2;
  insert into pg_temp.fc_stmt_lines_v2 select (x->>'deliveryLineId')::uuid, (x->>'unitPrice')::numeric, coalesce(nullif(x->>'vatRate', '')::numeric, 0),
    nullif(btrim(x->>'reason'), ''), round(nullif(x->>'amount', '')::numeric, 0)
  from jsonb_array_elements(p_input->'lines') x;
  if exists (select 1 from pg_temp.fc_stmt_lines_v2 where unit_price is null or unit_price < 0 or vat_rate not between 0 and 100 or inv_amount < 0)
    or v_inv_vat < 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
  -- Sửa tiền theo hóa đơn NCC (làm tròn) chỉ dành cho kế toán (Tài chính — Ghi nhận) / Admin.
  if (v_inv_vat is not null or exists (select 1 from pg_temp.fc_stmt_lines_v2 where inv_amount is not null))
    and not app_private.finance_can('record') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_INVOICE_DENIED'; end if;

  -- Mỗi dòng: giao nhận đã nhận của HĐ trong tháng, đã nhập kho xong (không cần xuất), chưa nằm trong bảng đối soát khác.
  if exists (select 1 from pg_temp.fc_stmt_lines_v2 t
    left join app_private.procurement_contract_delivery_lines() d on d.line_id = t.line_id and d.contract_id = v_c.id
    where d.line_id is null or date_trunc('month', d.delivery_date)::date <> v_month or not d.wms_ready
      or (d.statement_id is not null and d.statement_id is distinct from v_id)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_LINE_INVALID'; end if;
  -- Giá khác giá HĐ tại ngày giao: bắt buộc lý do.
  if exists (select 1 from pg_temp.fc_stmt_lines_v2 t
    join app_private.procurement_contract_delivery_lines() d on d.line_id = t.line_id
    join public.supplier_direct_delivery_lines sdl on sdl.id = d.line_id
    cross join lateral app_private.procurement_contract_line_price(v_c.id, d.item_id, sdl.specification, d.delivery_date) cp
    where round(t.unit_price, 2) <> round(cp.unit_price, 2) and t.reason is null) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_PRICE_REASON'; end if;
  -- K2 (23/10): giá đối soát khác giá NCC ghi trên phiếu giao — trừ khi đúng giá HĐ — bắt buộc lý do (ca PO-609).
  if exists (select 1 from pg_temp.fc_stmt_lines_v2 t
    join public.supplier_direct_delivery_lines sdl on sdl.id = t.line_id
    join public.supplier_direct_delivery_notes n on n.id = sdl.delivery_note_id
    left join lateral app_private.procurement_contract_line_price(v_c.id, sdl.item_id, sdl.specification, n.delivery_date) cp on true
    where coalesce(sdl.unit_price, 0) > 0 and round(t.unit_price, 2) <> round(sdl.unit_price, 2)
      and (cp.unit_price is null or round(t.unit_price, 2) <> round(cp.unit_price, 2)) and t.reason is null) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_NOTE_PRICE_REASON'; end if;
  select count(distinct coalesce(n.project_id, '') || '|' || coalesce(n.construction_site_id, '')), min(n.project_id), min(n.construction_site_id)
  into v_scopes, v_project, v_site
  from pg_temp.fc_stmt_lines_v2 t join public.supplier_direct_delivery_lines l on l.id = t.line_id
  join public.supplier_direct_delivery_notes n on n.id = l.delivery_note_id;
  if v_scopes <> 1 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.supplier_delivery_statements (id, code, project_id, construction_site_id, supplier_contract_id, supplier_contract_code,
      supplier_id, supplier_name_snapshot, period_month, statement_date, status, gross_amount, vat_amount, total_amount, metadata, created_by, note)
    values (v_id, 'DCHD-' || to_char(v_month, 'YYYYMM') || '-' || upper(substr(md5(v_id::text), 1, 6)), v_project, v_site, v_c.id, v_c.code,
      v_c.supplier_id, coalesce(nullif(v_c.supplier_name, ''), 'Nhà cung cấp'), v_month, current_date, 'draft', 0, 0, 0,
      jsonb_build_object('channel', 'procurement_hub'), v_actor, nullif(btrim(p_input->>'note'), ''))
    returning * into v_s;
  else
    select * into v_s from public.supplier_delivery_statements where id = v_id and supplier_contract_id = v_c.id for update;
    if not found or v_s.status <> 'draft' then raise exception using errcode = '42501', message = 'PROCUREMENT_STATEMENT_NOT_EDITABLE'; end if;
    delete from public.supplier_delivery_statement_lines where statement_id = v_id;
    update public.supplier_delivery_statements set note = nullif(btrim(p_input->>'note'), ''), statement_date = current_date,
      metadata = metadata - 'returnReason' where id = v_id;
  end if;

  insert into public.supplier_delivery_statement_lines (statement_id, delivery_note_id, delivery_line_id, supplier_contract_id,
    item_name_snapshot, unit_snapshot, accepted_quantity, unit_price_snapshot, vat_rate_snapshot, accepted_amount, vat_amount, total_amount,
    contract_unit_price, price_reason)
  select v_id, l.delivery_note_id, l.id, v_c.id, l.item_name_snapshot, l.unit_snapshot, q.qty, t.unit_price, t.vat_rate,
    round(q.qty * t.unit_price, 0), round(round(q.qty * t.unit_price, 0) * t.vat_rate / 100, 0),
    round(q.qty * t.unit_price, 0) + round(round(q.qty * t.unit_price, 0) * t.vat_rate / 100, 0),
    cp.unit_price, case when cp.unit_price is null or round(t.unit_price, 2) <> round(cp.unit_price, 2) then t.reason end
  from pg_temp.fc_stmt_lines_v2 t join public.supplier_direct_delivery_lines l on l.id = t.line_id
  join public.supplier_direct_delivery_notes n on n.id = l.delivery_note_id
  cross join lateral (select coalesce(nullif(l.accepted_quantity, 0), l.quantity) qty) q
  left join lateral app_private.procurement_contract_line_price(v_c.id, l.item_id, l.specification, n.delivery_date) cp on true;
  get diagnostics v_n = row_count;

  -- Tiền theo hóa đơn NCC: thành tiền từng dòng / tổng VAT do NCC làm tròn. Mỗi dòng và cả bảng
  -- chỉ lệch so với SL × đơn giá: mỗi dòng tối đa 1.000 đ (chủ SP 12/10), tổng VAT / cả bảng trong dung sai hóa đơn K3c; vượt → sửa đơn giá + lý do.
  select coalesce(sum(accepted_amount), 0), coalesce(sum(vat_amount), 0) into v_cg, v_cv
  from public.supplier_delivery_statement_lines where statement_id = v_id;
  if exists (select 1 from pg_temp.fc_stmt_lines_v2 t join public.supplier_delivery_statement_lines sl
      on sl.statement_id = v_id and sl.delivery_line_id = t.line_id
    where t.inv_amount is not null and abs(t.inv_amount - sl.accepted_amount) > 1000) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_INVOICE_LIMIT'; end if;
  update public.supplier_delivery_statement_lines sl set accepted_amount = t.inv_amount,
    vat_amount = round(t.inv_amount * sl.vat_rate_snapshot / 100, 0)
  from pg_temp.fc_stmt_lines_v2 t
  where sl.statement_id = v_id and sl.delivery_line_id = t.line_id and t.inv_amount is not null and t.inv_amount <> sl.accepted_amount;
  get diagnostics v_adjusted = row_count;
  if v_inv_vat is not null then
    v_dv := round(v_inv_vat, 0) - (select coalesce(sum(vat_amount), 0) from public.supplier_delivery_statement_lines where statement_id = v_id);
    if v_dv <> 0 then
      -- Phần VAT NCC làm tròn ghi vào dòng có VAT lớn nhất.
      update public.supplier_delivery_statement_lines set vat_amount = vat_amount + v_dv
      where id = (select id from public.supplier_delivery_statement_lines where statement_id = v_id and vat_rate_snapshot > 0
        order by vat_amount desc, id limit 1) and vat_amount + v_dv >= 0;
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_INVOICE_LIMIT'; end if;
    end if;
  end if;
  update public.supplier_delivery_statement_lines set total_amount = accepted_amount + vat_amount
  where statement_id = v_id and total_amount <> accepted_amount + vat_amount;
  select coalesce(sum(accepted_amount), 0), coalesce(sum(vat_amount), 0) into v_g, v_v
  from public.supplier_delivery_statement_lines where statement_id = v_id;
  if abs(v_v - v_cv) > app_private.finance_invoice_tolerance(v_cv)
    or abs((v_g + v_v) - (v_cg + v_cv)) > app_private.finance_invoice_tolerance(v_cg + v_cv) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_INVOICE_LIMIT'; end if;
  update public.supplier_delivery_statements set metadata = case when v_g <> v_cg or v_v <> v_cv
      then metadata || jsonb_build_object('invoiceAdjust', jsonb_build_object('computedGross', v_cg, 'computedVat', v_cv,
        'grossDelta', v_g - v_cg, 'vatDelta', v_v - v_cv, 'lines', v_adjusted, 'by', v_actor,
        'byName', (select name from public.users where id = v_actor), 'at', now()))
      else metadata - 'invoiceAdjust' end
  where id = v_id;
  if v_g <> v_cg or v_v <> v_cv then
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('need', 'statement:' || v_id, 'statement_invoice_adjust', v_actor, null, jsonb_build_object('code', v_s.code,
      'computedGross', v_cg, 'computedVat', v_cv, 'gross', v_g, 'vat', v_v, 'lines', v_adjusted));
  end if;

  update public.supplier_delivery_statements s set
    gross_amount = x.g, vat_amount = x.v, total_amount = x.t
  from (select coalesce(sum(accepted_amount), 0) g, coalesce(sum(vat_amount), 0) v, coalesce(sum(total_amount), 0) t
        from public.supplier_delivery_statement_lines where statement_id = v_id) x
  where s.id = v_id returning s.* into v_s;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('statementId', v_id, 'code', v_s.code, 'lines', v_n, 'totalAmount', v_s.total_amount);
end;
$function$;


-- Ca 1 — chặn cuối khi ghi công nợ (cả đường Admin cũ gọi thẳng).

CREATE OR REPLACE FUNCTION public.post_supplier_delivery_statement(p_statement_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS supplier_delivery_statements
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_contract public.supplier_contracts%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_gross numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
  v_blocked_item text;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  -- 01/10/2026: công nợ HĐ nguyên tắc chỉ ghi qua Mua hàng (kế toán dự án) hoặc Admin.
  if not (app_private.procurement_hub_context_enabled() or public.is_admin()) then
    raise exception using errcode = '42501', message = 'SUPPLIER_STATEMENT_MOVED_TO_PROCUREMENT';
  end if;

  if v_statement.status = 'posted' then
    return v_statement;
  end if;

  if v_statement.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post bảng đối soát đã huỷ/đảo.';
  end if;

  select * into v_contract
  from public.supplier_contracts
  where id = v_statement.supplier_contract_id;

  if not found then
    raise exception 'Không tìm thấy HĐ NCC %. ', v_statement.supplier_contract_id;
  end if;

  if v_contract.status = 'cancelled' then
    raise exception 'Không thể ghi nhận phải trả từ HĐ NCC đã huỷ.';
  end if;

  if not exists (
    select 1
    from public.supplier_delivery_statement_lines
    where statement_id = p_statement_id
  ) then
    raise exception 'Bảng đối soát chưa có dòng giao nhận được duyệt.';
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
    where sl.statement_id = p_statement_id
      and dl.status not in ('accepted', 'adjusted')
  ) then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  select dl.item_name_snapshot into v_blocked_item
  from public.supplier_delivery_statement_lines sl
  join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
  where sl.statement_id = p_statement_id
    and not app_private.supplier_delivery_line_ready(dl.wms_flow_mode, dl.wms_import_transaction_id)
  limit 1;

  if v_blocked_item is not null then
    raise exception 'Dòng % chưa nhập kho xong — chưa ghi công nợ được.', v_blocked_item;
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_delivery_statement_lines other_sl on other_sl.delivery_line_id = sl.delivery_line_id
    join public.supplier_delivery_statements other_s on other_s.id = other_sl.statement_id
    where sl.statement_id = p_statement_id
      and other_sl.statement_id <> p_statement_id
      and other_s.status in ('draft', 'confirmed', 'posted')
  ) then
    raise exception 'Có dòng giao nhận đã nằm trong bảng đối soát khác.';
  end if;

  -- K2 (23/10): giá đối soát khác giá NCC ghi trên phiếu giao (không phải giá HĐ) mà không lý do → không ghi nợ.
  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
    where sl.statement_id = p_statement_id
      and coalesce(dl.unit_price, 0) > 0 and abs(coalesce(sl.unit_price_snapshot, 0) - dl.unit_price) > 0.01
      and (sl.contract_unit_price is null or abs(coalesce(sl.unit_price_snapshot, 0) - sl.contract_unit_price) > 0.01)
      and coalesce(btrim(sl.price_reason), '') = ''
  ) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_STATEMENT_NOTE_PRICE_REASON';
  end if;

  select
    coalesce(sum(accepted_amount), 0)::numeric(18,2),
    coalesce(sum(vat_amount), 0)::numeric(18,2),
    coalesce(sum(total_amount), 0)::numeric(18,2)
  into v_gross, v_vat, v_total
  from public.supplier_delivery_statement_lines
  where statement_id = p_statement_id;

  if v_total <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  update public.supplier_delivery_statements
  set
    gross_amount = v_gross,
    vat_amount = v_vat,
    total_amount = v_total,
    status = 'posted',
    posted_by = coalesce(p_actor_id, posted_by),
    posted_at = coalesce(posted_at, now()),
    supplier_contract_code = coalesce(supplier_contract_code, v_contract.code),
    supplier_id = coalesce(supplier_id, v_contract.supplier_id),
    supplier_name_snapshot = coalesce(nullif(supplier_name_snapshot, ''), v_contract.supplier_name, 'Nhà cung cấp'),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  update public.supplier_direct_delivery_lines dl
  set statement_id = p_statement_id, updated_at = now()
  from public.supplier_delivery_statement_lines sl
  where sl.statement_id = p_statement_id
    and sl.delivery_line_id = dl.id;

  update public.supplier_direct_delivery_notes note
  set status = 'statemented', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and not exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.delivery_note_id = note.id
      and dl.status in ('accepted', 'adjusted')
      and dl.statement_id is null
  );

  v_document := public.sync_supplier_payable_from_delivery_statement(p_statement_id);

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  return v_statement;
end;
$function$;


-- Ca 1 — màn đối soát biết giá NCC ghi trên phiếu giao (chip "Dùng giá phiếu giao").

CREATE OR REPLACE FUNCTION public.get_procurement_contract_v1(p_contract_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_c public.supplier_contracts%rowtype; v_actor uuid := public.current_app_user_id(); v_buyer boolean := app_private.procurement_can('view');
begin
  select * into v_c from public.supplier_contracts where id = p_contract_id;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_CONTRACT_NOT_FOUND'; end if;
  if not app_private.procurement_contract_can_view(v_c) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with dl as materialized (
      select d.*, n.source_delivery_batch_id batch_id, n.purchase_order_id po_id, po.po_number, l.specification spec, l.line_no,
        nullif(l.unit_price, 0) note_price,
        case when b.id is not null then case b.fulfillment_mode when 'DIRECT_CONSUMPTION' then 'direct' else 'stock' end
          when coalesce(l.wms_flow_mode, 'none') <> 'direct_in_out' then 'none'
          when l.wms_status = 'exported' then 'direct'
          when d.wms_ready then 'stock' else 'pending' end stock_state,
        w.name warehouse_name, pr.code project_code,
        (select cp.unit_price from app_private.procurement_contract_line_price(p_contract_id, d.item_id, l.specification, d.delivery_date) cp) contract_price
      from app_private.procurement_contract_delivery_lines() d
      join public.supplier_direct_delivery_notes n on n.id = d.note_id
      join public.supplier_direct_delivery_lines l on l.id = d.line_id
      left join public.purchase_order_delivery_batches b on b.id = n.source_delivery_batch_id
      left join public.purchase_orders po on po.id = n.purchase_order_id
      left join public.warehouses w on w.id = l.target_warehouse_id
      left join public.projects pr on pr.id = d.project_id
      where d.contract_id = p_contract_id)
    select jsonb_build_object(
      'id', v_c.id, 'code', v_c.code, 'name', v_c.name, 'type', v_c.type, 'status', v_c.status, 'note', v_c.note,
      'supplierId', v_c.supplier_id, 'supplierName', v_c.supplier_name, 'projectId', v_c.project_id,
      'projectCode', (select code from public.projects where id = v_c.project_id), 'projectName', (select name from public.projects where id = v_c.project_id),
      'constructionSiteId', v_c.construction_site_id, 'value', v_c.value, 'paymentTerms', v_c.payment_terms, 'paymentTermDays', v_c.payment_term_days,
      'signedDate', v_c.signed_date, 'effectiveDate', v_c.effective_date, 'expiryDate', v_c.expiry_date,
      'canManage', app_private.procurement_can('manage'), 'isBuyer', v_buyer,
      'canOrder', app_private.procurement_contract_can_order(v_c.project_id, v_c.construction_site_id)
        and coalesce(v_c.status, '') not in ('cancelled', 'completed'),
      -- Người duyệt khi đơn gọi hàng vượt giá trị HĐ / hạn mức.
      'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
        from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
          and app_private.has_permission(u.id, 'system.procurement.approve')), '[]'::jsonb),
      'priceLines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'lineNo', l.line_no, 'itemId', l.item_id,
          'sku', coalesce(l.sku_snapshot, i.sku), 'name', coalesce(i.name, l.item_name_snapshot), 'unit', coalesce(l.unit_snapshot, i.unit),
          'unitPrice', l.unit_price, 'vatRate', l.vat_rate, 'quantityLimit', l.quantity_limit, 'amountLimit', l.amount_limit,
          'effectiveFrom', l.effective_from, 'effectiveTo', l.effective_to, 'note', l.note, 'specification', l.specification,
          'used', exists (select 1 from public.supplier_direct_delivery_lines d where d.supplier_contract_line_id = l.id))
        order by coalesce(i.name, l.item_name_snapshot), l.specification nulls first, l.effective_from nulls first)
        from public.supplier_contract_lines l left join public.items i on i.id = l.item_id where l.supplier_contract_id = p_contract_id), '[]'::jsonb),
      'usage', coalesce((select jsonb_agg(u order by u->>'name') from (
          select jsonb_build_object('itemId', d.item_id, 'name', max(d.item_name), 'unit', max(d.unit),
            'deliveredQty', sum(d.qty), 'deliveredValue', sum(d.amount), 'unpricedLines', count(*) filter (where d.price_source = 'missing'),
            'quantityLimit', (select max(l.quantity_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'amountLimit', (select max(l.amount_limit) from public.supplier_contract_lines l where l.supplier_contract_id = p_contract_id and l.item_id = d.item_id),
            'currentPrice', (select cp.unit_price from app_private.procurement_contract_price(p_contract_id, d.item_id, current_date) cp),
            -- Cộng theo mã; từng quy cách vẫn đủ khối lượng + giá trị.
            'specs', coalesce((select jsonb_agg(jsonb_build_object('specification', z2.spec, 'qty', z2.qty, 'value', z2.val) order by z2.spec nulls first)
              from (select d2.spec, sum(d2.qty) qty, sum(d2.amount) val from dl d2 where d2.item_id = d.item_id group by d2.spec) z2), '[]'::jsonb)) u
          from dl d group by d.item_id) z), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'poNumber', po.po_number, 'status', po.status,
          'totalAmount', po.total_amount, 'vatRate', po.vat_rate, 'expectedDeliveryDate', po.expected_delivery_date,
          'fulfillmentMode', po.fulfillment_mode, 'warehouseName', w.name, 'projectCode', pr.code, 'rowVersion', po.row_version,
          'createdById', po.created_by_id, 'createdByName', (select name from public.users u where u.id::text = po.created_by_id),
          'submittedToName', po.submitted_to_name, 'returnReason', po.metadata->>'returnReason',
          'lines', jsonb_array_length(coalesce(po.items, '[]'::jsonb)),
          'items', po.items, 'targetWarehouseId', po.target_warehouse_id, 'note', po.note, 'purchaseMode', po.purchase_mode,
          'receivedValue', coalesce((select sum(coalesce(dl2.accepted_qty, 0) * coalesce(dl2.delivery_unit_price, 0))
            from public.purchase_order_delivery_lines dl2 join public.purchase_order_delivery_batches b2 on b2.id = dl2.delivery_batch_id
            where dl2.purchase_order_id = po.id and b2.status in ('received', 'received_short', 'received_over')), 0))
        order by po.created_at desc)
        from public.purchase_orders po left join public.warehouses w on w.id = po.target_warehouse_id left join public.projects pr on pr.id = po.project_id
        where po.supplier_contract_id = p_contract_id and po.archived_at is null
          and (v_buyer or po.created_by_id = v_actor::text or app_private.procurement_contract_can_order(po.project_id, po.construction_site_id))), '[]'::jsonb),
      'deliveries', coalesce((select jsonb_agg(jsonb_build_object('noteId', n.note_id, 'code', n.note_code, 'ticketNo', n.ticket_no,
          'date', n.delivery_date, 'purchaseOrderNo', n.po_number, 'projectCode', n.project_code, 'scopeKey', n.scope_key, 'lines', n.lines)
          order by n.delivery_date desc, n.note_code desc)
        from (select note_id, note_code, ticket_no, delivery_date, max(po_number) po_number, max(project_code) project_code,
                coalesce(max(project_id), '') || '|' || coalesce(max(site_id), '') scope_key,
                jsonb_agg(jsonb_build_object('lineId', line_id, 'itemId', item_id,
                'name', item_name, 'specification', spec, 'unit', unit, 'qty', qty, 'unitPrice', unit_price, 'vatRate', vat_rate, 'priceSource', price_source,
                'amount', amount, 'wmsReady', wms_ready, 'stockState', stock_state, 'warehouseName', warehouse_name,
                'contractPrice', contract_price, 'notePrice', note_price, 'statementId', statement_id, 'statementCode', statement_code,
                'statementStatus', statement_status) order by line_no nulls last, item_name) lines
              from dl group by 1, 2, 3, 4 order by delivery_date desc limit 200) n), '[]'::jsonb),
      'statements', case when not v_buyer then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'periodMonth', s.period_month,
          'status', s.status, 'grossAmount', s.gross_amount, 'vatAmount', s.vat_amount, 'totalAmount', s.total_amount,
          'projectCode', (select code from public.projects where id = s.project_id),
          'lineCount', (select count(*) from public.supplier_delivery_statement_lines x where x.statement_id = s.id),
          'createdByName', (select name from public.users where id = s.created_by), 'postedAt', s.posted_at,
          'postedByName', (select name from public.users where id = s.posted_by),
          'confirmedByName', s.metadata->>'confirmedByName', 'confirmedAt', s.metadata->>'confirmedAt',
          'returnReason', s.metadata->>'returnReason', 'note', s.note,
          'canPost', s.status = 'confirmed' and app_private.procurement_statement_accountant_ok(v_actor, s.project_id, s.construction_site_id))
        order by s.period_month desc, s.created_at desc) from public.supplier_delivery_statements s where s.supplier_contract_id = p_contract_id), '[]'::jsonb) end
    )
  );
end;
$function$;


-- Ca 2 — Kết thúc đề xuất (CHT / người lập): còn đơn mua mở thì phải xác nhận từng đơn.

CREATE OR REPLACE FUNCTION public.end_material_request_supply_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_id text; v_req public.requests%rowtype; v_n integer := 0; v_lines integer := 0; v_closed integer;
  v_open jsonb; v_o jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'MR_SUPPLY_END_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'MR_SUPPLY_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_input->'requestIds') is distinct from 'array' or jsonb_array_length(p_input->'requestIds') = 0 then
    raise exception using errcode = '22023', message = 'MR_SUPPLY_NOT_FOUND'; end if;
  for v_id in select distinct value from jsonb_array_elements_text(p_input->'requestIds') loop
    select * into v_req from public.requests where id = v_id and request_origin = 'project' for update;
    if not found then raise exception using errcode = '22023', message = 'MR_SUPPLY_NOT_FOUND'; end if;
    if v_req.status not in ('APPROVED', 'IN_TRANSIT') then
      raise exception using errcode = '22023', message = 'MR_SUPPLY_STATE'; end if;
    if not app_private.material_request_can_end_supply(v_req) then
      raise exception using errcode = '42501', message = 'MR_SUPPLY_END_DENIED'; end if;
    -- K2 (23/10, ca MR-2026-9833 / PO-671): còn đơn mua mở → người dùng phải xác nhận đúng các đơn đó (openPoAck).
    v_open := app_private.material_request_open_pos(v_req.id);
    if not app_private.material_request_open_pos_acked(v_open, p_input->'openPoAck') then
      raise exception using errcode = '22023', message = 'MR_SUPPLY_OPEN_PO',
        detail = jsonb_build_object('requestCode', v_req.code, 'orders', v_open)::text; end if;
    insert into public.material_request_line_need_closures (project_id, construction_site_id, material_request_id, request_line_id,
      item_id, work_boq_item_id, material_budget_item_id, closed_qty, actual_received_qty_snapshot, reason, status, closed_by, closed_at)
    select v_req.project_id, v_req.construction_site_id, v_req.id, s.line_id, s.item_id,
      (select b.id from public.project_work_boq_items b where b.id::text = x.value->>'workBoqItemId'),
      (select m.id from public.material_budget_items m where m.id::text = x.value->>'materialBudgetItemId'),
      greatest(s.need_qty - s.received_qty, 0), greatest(s.received_qty, 0), v_reason, 'active', v_actor, now()
    from app_private.material_request_supply_lines_v1(array[v_req.id]) s
    join lateral jsonb_array_elements(v_req.items) x on x.value->>'lineId' = s.line_id
    where s.line_state in ('waiting', 'none') and s.item_id is not null;
    get diagnostics v_closed = row_count;
    v_lines := v_lines + v_closed;
    update public.requests
    set status = 'COMPLETED'::public.request_status, workflow_step = 'ended', workflow_step_started_at = now(),
      workflow_step_due_at = null, workflow_step_sla_hours = null, workflow_step_actor_user_id = v_actor::text,
      submitted_to_user_id = null, submitted_to_name = null, submitted_to_permission = null,
      last_action_by = v_actor, last_action_at = now()
    where id = v_req.id;
    insert into public.material_request_events (request_id, project_id, from_step, to_step, action, actor_user_id, note, metadata)
    values (v_req.id, v_req.project_id, v_req.workflow_step, 'ended', 'SUPPLY_ENDED', v_actor::text, v_reason,
      jsonb_build_object('closedLines', v_closed, 'fromStatus', v_req.status)
        || case when jsonb_array_length(v_open) > 0 then jsonb_build_object('openOrders', v_open) else '{}'::jsonb end);
    for v_o in select value from jsonb_array_elements(v_open) loop
      if v_o->>'createdById' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_o->>'createdById' <> v_actor::text then
        perform app_private.procurement_notify((v_o->>'createdById')::uuid, 'Đề xuất đã kết thúc — đơn còn mở',
          format('%s đã kết thúc (%s). %s: đã duyệt thì vẫn giao, hàng về thành tồn kho công trường; chưa duyệt thì trả lại / hủy.',
            v_req.code, v_reason, v_o->>'poNumber'), v_o->>'id', 'responsible');
      end if;
    end loop;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ended', v_n, 'closedLines', v_lines);
end $function$;


-- Ca 2 — Mua hàng "Đóng nhu cầu" của đề xuất: cùng điều kiện.

CREATE OR REPLACE FUNCTION app_private.procurement_legacy_close_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := public.current_app_user_id(); v_action text := coalesce(p_input->>'action', 'close');
  v_reason text := nullif(btrim(p_input->>'reason'), ''); v_n integer := 0; s jsonb; v_at timestamptz; v_ended integer := 0;
  v_open jsonb;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'sources') is distinct from 'array' or jsonb_array_length(p_input->'sources') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCES_REQUIRED'; end if;
  if v_action not in ('close', 'reopen') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID'; end if;
  if v_action = 'close' and v_reason is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_CLOSE_REASON_REQUIRED'; end if;
  for s in select value from jsonb_array_elements(p_input->'sources') loop
    if not exists (select 1 from app_private.procurement_inbox_documents() d
        where d.source_type = s->>'sourceType' and d.source_id = s->>'sourceId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    v_at := null;
    if v_action = 'close' and s->>'sourceType' = 'material_request' then
      v_open := app_private.material_request_open_pos(s->>'sourceId');
      if not app_private.material_request_open_pos_acked(v_open, p_input->'openPoAck') then
        raise exception using errcode = '22023', message = 'MR_SUPPLY_OPEN_PO',
          detail = jsonb_build_object('requestCode', (select r.code from public.requests r where r.id = s->>'sourceId'), 'orders', v_open)::text; end if;
    end if;
    if v_action = 'close' then
      insert into public.procurement_need_closures (source_type, source_id, reason, closed_by)
      values (s->>'sourceType', s->>'sourceId', v_reason, v_actor)
      on conflict (source_type, source_id) do nothing
      returning closed_at into v_at;
    else
      delete from public.procurement_need_closures where source_type = s->>'sourceType' and source_id = s->>'sourceId'
      returning closed_at into v_at;
    end if;
    if v_at is not null then
      -- Đề xuất vật tư: đóng nhu cầu = Kết thúc đề xuất; mở lại = gỡ phần kết thúc đó.
      if s->>'sourceType' = 'material_request' then
        if v_action = 'close' then
          if app_private.procurement_close_end_request(s->>'sourceId', v_reason, v_actor, v_at) is not null then
            v_ended := v_ended + 1;
          end if;
        else
          perform app_private.procurement_close_reopen_request(s->>'sourceId', v_at, v_actor);
        end if;
      end if;
      v_n := v_n + 1;
      insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
      values ('need', (s->>'sourceType') || ':' || (s->>'sourceId'), v_action, v_actor, v_reason, s);
    end if;
  end loop;
  return jsonb_build_object('changed', v_n, 'endedRequests', v_ended);
end;
$function$;


-- Ca 2 + 4 — gửi / duyệt đơn: đề xuất đã kết thúc thì không duyệt; đặt vượt nhu cầu phải có lý do.

CREATE OR REPLACE FUNCTION public.transition_procurement_hub_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_action text := p_input->>'action';
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_po public.purchase_orders%rowtype;
  v_name text;
  v_budget jsonb;
  v_excess jsonb; v_excess_reason text := nullif(btrim(p_input->>'excessReason'), '');
begin
  if not (app_private.procurement_can('manage') or public.is_admin()
    or (v_action in ('approve', 'return') and app_private.procurement_can('approve'))) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
    raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  -- K2 (23/10, ca PO-671): mọi đề xuất của đơn đã kết thúc → không gửi / duyệt mua nữa (trả lại hoặc hủy đơn).
  if v_action in ('submit', 'approve') and exists (select 1 from public.purchase_order_request_lines l where l.purchase_order_id = v_po.id)
    and not exists (select 1 from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
      where l.purchase_order_id = v_po.id and (r.id is null or not (r.status::text = 'COMPLETED' and r.workflow_step = 'ended'))) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_NEED_ENDED',
      detail = (select string_agg(distinct l.material_request_code, ', ') from public.purchase_order_request_lines l where l.purchase_order_id = v_po.id); end if;
  if v_action = 'submit' then
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_SUBMIT_DENIED'; end if;
    if jsonb_array_length(coalesce(v_po.items, '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    if exists (select 1 from jsonb_array_elements(v_po.items) x where coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0) <= 0) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_MISSING'; end if;
    if v_po.target_warehouse_id is null and not app_private.procurement_po_is_group(v_po.metadata) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_REQUIRED'; end if;
    if v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_APPROVER_INVALID'; end if;
    -- K2 (23/10, ca PO-694): đặt vượt nhu cầu đề xuất (cộng các đơn trước, dung sai 2%) phải ghi lý do ở từng dòng.
    v_excess := app_private.procurement_po_excess_missing(v_po.id);
    if jsonb_array_length(v_excess) > 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_EXCESS_REASON_REQUIRED', detail = v_excess::text; end if;
    select name into v_name from public.users where id = v_to;
    update public.purchase_orders set status = 'sent', submitted_to_user_id = v_to::text, submitted_to_name = v_name,
      submitted_to_permission = 'system.procurement.approve', submission_note = v_reason, ever_submitted = true,
      last_action_by = v_actor::text, last_action_at = now(), metadata = metadata - 'returnReason' - 'budgetApproval'
    where id = v_po.id returning * into v_po;
    -- Tài chính: đơn làm vật tư của dự án vượt dự toán → báo người duyệt vượt ngân sách ngay khi gửi.
    v_budget := app_private.finance_po_budget_mark(v_po.id, v_actor);
    select * into v_po from public.purchase_orders where id = v_po.id;
    perform app_private.procurement_notify(v_to, 'Đơn hàng chờ bạn duyệt',
      v_po.po_number || ' · ' || coalesce(v_po.vendor_name, '') || ' — ' || to_char(v_po.total_amount, 'FM999G999G999G999') || ' đ', v_po.id, 'assigned');
  elsif v_action in ('approve', 'return') then
    if v_po.status <> 'sent' or v_po.created_by_id = v_actor::text
      or not (v_po.submitted_to_user_id = v_actor::text or public.is_admin()) then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_APPROVE_DENIED'; end if;
    if v_action = 'return' and v_reason is null then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_RETURN_REASON_REQUIRED'; end if;
    if v_action = 'approve' then
      -- Người duyệt không sửa được đơn: ghi lý do chấp nhận đặt vượt ngay khi duyệt (hoặc Trả lại).
      v_excess := app_private.procurement_po_excess_missing(v_po.id);
      if jsonb_array_length(v_excess) > 0 then
        if v_excess_reason is null or char_length(v_excess_reason) < 5 then
          raise exception using errcode = '22023', message = 'PROCUREMENT_PO_EXCESS_REASON_REQUIRED', detail = v_excess::text; end if;
        update public.purchase_order_request_lines set excess_reason = left(v_excess_reason, 500)
        where id in (select (e.value->>'linkId')::uuid from jsonb_array_elements(v_excess) e);
        insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
        values ('purchase_order', v_po.id, 'excess_accept', v_actor, v_excess_reason, jsonb_build_object('lines', v_excess));
      end if;
      v_budget := app_private.finance_po_budget_mark(v_po.id, v_actor);
      if coalesce((v_budget->>'over')::boolean, false) and v_budget->>'status' <> 'approved' then
        select * into v_po from public.purchase_orders where id = v_po.id;
        perform set_config('app.procurement_hub_context', 'off', true);
        perform set_config('app.material_transition_context', 'off', true);
        return jsonb_build_object('purchaseOrderId', v_po.id, 'status', v_po.status, 'rowVersion', v_po.row_version, 'budgetPending', true,
          'budgetApproverNames', v_po.metadata->'budgetApproval'->'approverNames', 'budget', v_budget->'budget', 'projected', v_budget->'projected');
      end if;
      select * into v_po from public.purchase_orders where id = v_po.id;
      update public.purchase_orders set status = 'confirmed', approved_total_amount = total_amount,
        last_action_by = v_actor::text, last_action_at = now()
      where id = v_po.id returning * into v_po;
      -- Same as the project flow: a single-delivery order gets its delivery note + WMS/QR so the
      -- warehouse receives it (both purchase and stock quantities) — actual qty may be short.
      if coalesce(v_po.purchase_mode, 'single') = 'single' and not app_private.procurement_po_is_group(v_po.metadata) then
        perform app_private.create_delivery_batch_with_wms_qr_core_v2(v_po.id, gen_random_uuid(), v_po.vendor_id, v_po.vendor_name,
          v_po.fulfillment_mode, coalesce(v_po.vat_rate, 0), v_po.target_warehouse_id,
          coalesce(app_private.procurement_date_or_null(v_po.expected_delivery_date), current_date),
          'Đợt giao tự động khi duyệt đơn tại Mua hàng', v_actor,
          (select jsonb_agg(jsonb_build_object('purchaseOrderLineId', coalesce(x.value->>'lineId', x.value->>'itemId'),
              'itemId', x.value->>'itemId', 'purchaseQty', (x.value->>'qty')::numeric, 'purchaseUnit', x.value->>'purchaseUnitSnapshot',
              'stockQty', (x.value->>'qty')::numeric * (x.value->>'purchaseConversionFactor')::numeric,
              'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unitSnapshot'),
              'purchaseUnitPrice', (x.value->>'unitPrice')::numeric,
              'stockUnitPrice', (x.value->>'unitPrice')::numeric / (x.value->>'purchaseConversionFactor')::numeric))
            from jsonb_array_elements(v_po.items) x));
        select * into v_po from public.purchase_orders where id = v_po.id;
      end if;
      perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng đã được duyệt',
        v_po.po_number || ' đã duyệt — gửi NCC và theo dõi giao hàng.', v_po.id, 'responsible');
    else
      update public.purchase_orders set status = 'returned', submitted_to_user_id = null, submitted_to_name = null,
        submitted_to_permission = null, last_action_by = v_actor::text, last_action_at = now(),
        metadata = metadata || jsonb_build_object('returnReason', v_reason)
      where id = v_po.id returning * into v_po;
      perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Đơn hàng bị trả lại',
        v_po.po_number || ': ' || v_reason, v_po.id, 'responsible');
    end if;
  elsif v_action = 'delete' then
    if v_po.status <> 'draft' or v_po.ever_submitted or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_DELETE_DENIED'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po.id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po.id;
    delete from public.purchase_orders where id = v_po.id;
  else
    raise exception using errcode = '22023', message = 'PROCUREMENT_ACTION_INVALID';
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, v_action, v_actor, v_reason,
    case when v_to is null then '{}'::jsonb else jsonb_build_object('approverUserId', v_to) end);
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po.id, 'status', case when v_action = 'delete' then 'deleted' else v_po.status end,
    'rowVersion', v_po.row_version);
end;
$function$;


-- Ca 4 — lưu đơn: nhận lý do đặt vượt của từng dòng nhu cầu (allocations[].excessReason).

CREATE OR REPLACE FUNCTION app_private.procurement_legacy_save_po_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_vendor record;
  v_project text; v_site text; v_warehouse text := nullif(p_input->>'targetWarehouseId', '');
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_request_ids text[];
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_needed date; v_scopes integer; v_group boolean := false; v_line_id text; v_punit text; v_ord integer := 0; it jsonb; al jsonb; v_qty numeric; v_price numeric; v_item record; v_src record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;

  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;

  -- Every allocation must be an open need line of the same item, in one project/site.
  create temp table if not exists pg_temp.hub_alloc (item_ord integer, po_line_id text, item_id text, unit_price numeric, item_note text, item_spec text,
    purchase_qty numeric, purchase_unit text,
    source_type text, source_id text, line_id text, qty numeric, need_qty numeric, project_id text, site_id text,
    warehouse_id text, needed_date date, work_boq_item_id text, material_budget_item_id text, code text, unit text) on commit drop;
  truncate pg_temp.hub_alloc;
  -- Chụp nhu cầu MỘT lần cho các phiếu trong đơn (22/10): trước đây mỗi dòng phân bổ gọi lại
  -- procurement_inbox_lines() (~330 ms) → đơn 67 vật tư × 3 phiếu hết giờ 8 s (57014).
  create temp table if not exists pg_temp.hub_src (source_type text, source_id text, line_id text, item_id text,
    need_qty numeric, unit text, project_id text, construction_site_id text, warehouse_id text, needed_date date,
    code text, closed_at timestamptz) on commit drop;
  truncate pg_temp.hub_src;
  insert into pg_temp.hub_src
  select l.source_type, l.source_id, l.line_id, l.item_id, l.need_qty, l.unit, d.project_id, d.construction_site_id,
    d.warehouse_id, d.needed_date, d.code, d.closed_at
  from app_private.procurement_inbox_lines() l
  join app_private.procurement_inbox_documents() d on d.source_type = l.source_type and d.source_id = l.source_id
  where (l.source_type, l.source_id) in (
    select a.value->>'sourceType', a.value->>'sourceId'
    from jsonb_array_elements(p_input->'items') i
    cross join lateral jsonb_array_elements(case when jsonb_typeof(i.value->'allocations') = 'array' then i.value->'allocations' else '[]'::jsonb end) a);

  for it in select value from jsonb_array_elements(p_input->'items') loop
    v_ord := v_ord + 1;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if nullif(it->>'purchaseQty', '')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if jsonb_typeof(it->'allocations') is distinct from 'array' or jsonb_array_length(it->'allocations') = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    for al in select value from jsonb_array_elements(it->'allocations') loop
      v_qty := nullif(al->>'qty', '')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
      select s.need_qty, s.unit, s.project_id, s.construction_site_id, s.warehouse_id, s.needed_date, s.code, s.closed_at
        into v_src
      from pg_temp.hub_src s
      where s.source_type = al->>'sourceType' and s.source_id = al->>'sourceId' and s.line_id = al->>'lineId'
        and s.item_id = it->>'itemId'
      limit 1;
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
      if v_src.closed_at is not null then raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
      insert into pg_temp.hub_alloc values (v_ord, null, it->>'itemId', v_price,
        nullif(btrim(it->>'note'), ''), nullif(left(btrim(coalesce(it->>'specification', '')), 160), ''), nullif(it->>'purchaseQty', '')::numeric, nullif(btrim(it->>'purchaseUnit'), ''), al->>'sourceType', al->>'sourceId', al->>'lineId', v_qty, v_src.need_qty,
        v_src.project_id, v_src.construction_site_id, v_src.warehouse_id, v_src.needed_date, null, null, v_src.code, v_src.unit);
    end loop;
  end loop;
  if exists (select 1 from pg_temp.hub_alloc group by source_type, source_id, line_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
  -- Một mã nhiều dòng đơn được, mỗi dòng một quy cách (chủ SP 09/10).
  if exists (select 1 from (select distinct item_ord, item_id, lower(coalesce(item_spec, '')) k from pg_temp.hub_alloc) d
      group by item_id, k having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_SPEC'; end if;
  select count(distinct coalesce(project_id, '') || '|' || coalesce(site_id, '')), min(project_id), min(site_id), min(needed_date)
    into v_scopes, v_project, v_site, v_needed from pg_temp.hub_alloc;
  -- Việc 2: phiếu của nhiều dự án → đơn gom; mỗi dòng phân bổ giữ kho nhận của phiếu, đơn không gắn một dự án / kho.
  v_group := v_scopes > 1;
  if v_group then
    if exists (select 1 from pg_temp.hub_alloc where warehouse_id is null) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_WAREHOUSE_REQUIRED'; end if;
    v_project := null; v_site := null; v_warehouse := null;
    -- Đơn gom giao nhiều đợt (mỗi đợt một công trường), không tự tạo đợt giao khi duyệt.
    v_mode := 'multiple';
  end if;
  if v_warehouse is null and not v_group then
    select min(warehouse_id) into v_warehouse from pg_temp.hub_alloc having count(distinct warehouse_id) = 1;
  end if;
  if v_warehouse is not null and not exists (select 1 from public.warehouses w where w.id = v_warehouse and not coalesce(w.is_archived, false)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  -- Request line attribution (BOQ links) from the request itself.
  update pg_temp.hub_alloc a set work_boq_item_id = x.value->>'workBoqItemId', material_budget_item_id = x.value->>'materialBudgetItemId'
  from public.requests r cross join lateral jsonb_array_elements(r.items) x
  where a.source_type = 'material_request' and r.id = a.source_id and x.value->>'lineId' = a.line_id;

  -- One PO line per submitted item (the editor groups needs by item + specification; the buyer may split further).
  for v_item in
    select a.item_ord, max(a.item_spec) spec, a.item_id, max(a.unit_price) unit_price, sum(a.qty) qty, min(a.needed_date) needed_date, max(a.item_note) note,
      max(a.purchase_qty) manual_purchase_qty, max(a.purchase_unit) manual_purchase_unit,
      count(*) n, min(a.source_type) st, min(a.source_id) sid, min(a.line_id) lid, min(a.code) code,
      coalesce(i.name, min(a.item_id)) name, i.sku, coalesce(i.unit, min(a.unit)) unit,
      -- Need quantities are in the stock unit; the order uses the purchase unit (stock = purchase × factor).
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    from pg_temp.hub_alloc a left join public.items i on i.id = a.item_id
    group by a.item_ord, a.item_id, i.name, i.sku, i.unit, i.purchase_unit, i.purchase_conversion_factor order by a.item_ord
  loop
    v_line_id := 'mh-' || gen_random_uuid();
    -- The buyer may type the purchase quantity (e.g. 100 kg ↔ 10 cây); otherwise the item's default factor applies.
    v_punit := coalesce(v_item.manual_purchase_unit, v_item.purchase_unit, v_item.unit);
    v_qty := case when v_item.manual_purchase_qty is not null then v_item.manual_purchase_qty
      when v_item.purchase_unit is null then v_item.qty else round(v_item.qty / v_item.factor, 6) end;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.item_id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_item.qty / v_qty, 12), 'stockQty', v_item.qty,
      'qty', v_qty, 'unitPrice', v_item.unit_price, 'neededDate', v_item.needed_date, 'note', v_item.note, 'specification', v_item.spec,
      'requestId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.sid end,
      'requestCode', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.code end,
      'requestLineId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.lid end)));
    v_total := v_total + v_qty * v_item.unit_price;
    update pg_temp.hub_alloc set po_line_id = v_line_id where item_ord = v_item.item_ord;
  end loop;
  select array_agg(distinct source_id) into v_request_ids from pg_temp.hub_alloc where source_type = 'material_request';

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, material_request_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project, v_site, v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'from_request', v_mode, 'RECEIVE_TO_STOCK',
      v_warehouse, case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Đơn hàng lập tại Mua hàng',
      jsonb_build_object('channel', 'procurement_hub') || case when v_group then jsonb_build_object('groupOrder', true) else '{}'::jsonb end)
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'create', v_actor);
  else
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    -- Đơn chủ động (M2d) chỉ sửa bằng save_procurement_proactive_po_v1 để giữ liên kết nhu cầu đã gắn.
    if v_po.source_mode in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PROACTIVE_USE_EDITOR'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = 'PT409', message = 'ROW_VERSION_CONFLICT'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po_id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po_id;
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode, expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''),
      target_warehouse_id = v_warehouse, material_request_id = case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      note = nullif(btrim(p_input->>'note'), ''), project_id = v_project, construction_site_id = v_site,
      metadata = (coalesce(metadata, '{}'::jsonb) - 'groupOrder') || case when v_group then jsonb_build_object('groupOrder', true) else '{}'::jsonb end
    where id = v_po_id returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'update', v_actor);
  end if;

  insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id,
    target_warehouse_id, allocation_status, purchase_order_id, purchase_order_line_id, material_request_id,
    material_request_code, request_line_id, item_id, work_boq_item_id, material_budget_item_id, requested_qty,
    ordered_qty, requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit)
  select a.project_id, a.site_id, a.site_id, coalesce(v_warehouse, a.warehouse_id), 'open', v_po_id, a.po_line_id, a.source_id,
    a.code, a.line_id, a.item_id,
    (select b.id from public.project_work_boq_items b where b.id = a.work_boq_item_id),
    (select b.id from public.material_budget_items b where b.id = a.material_budget_item_id),
    a.need_qty, a.qty, a.need_qty, a.qty, 0, a.unit
  from pg_temp.hub_alloc a where a.source_type = 'material_request';
  -- K2 (23/10): lý do đặt vượt theo từng dòng nhu cầu (lưu lại mỗi lần sửa đơn — liên kết được tạo lại).
  update public.purchase_order_request_lines prl set excess_reason = left(btrim(al.value->>'excessReason'), 500)
  from jsonb_array_elements(p_input->'items') it
  cross join lateral jsonb_array_elements(case when jsonb_typeof(it.value->'allocations') = 'array' then it.value->'allocations' else '[]'::jsonb end) al
  where prl.purchase_order_id = v_po_id and al.value->>'sourceType' = 'material_request'
    and prl.material_request_id = al.value->>'sourceId' and prl.request_line_id = al.value->>'lineId'
    and nullif(btrim(al.value->>'excessReason'), '') is not null;
  insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id,
    material_plan_line_id, item_id, ordered_qty)
  select v_po_id, a.po_line_id, a.source_id::uuid, a.line_id::uuid, a.item_id, a.qty
  from pg_temp.hub_alloc a where a.source_type = 'material_plan';
  perform set_config('app.procurement_hub_context', 'off', true);

  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items));
end;
$function$;


-- Ca 3 — lập đợt giao tại Mua hàng: VAT mặc định theo đơn; VAT khác đơn đi kèm lý do (vatReason).

CREATE OR REPLACE FUNCTION public.save_procurement_delivery_v1(p_input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_po public.purchase_orders%rowtype;
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_batch_id uuid := nullif(p_input->>'deliveryId', '')::uuid;
  v_no integer;
  v_vat numeric := nullif(p_input->>'vatRate', '')::numeric;
  v_to uuid := nullif(p_input->>'approverUserId', '')::uuid;
  v_lines jsonb := '[]'::jsonb; ln jsonb; v_item jsonb;
  v_pq numeric; v_sq numeric; v_price numeric; v_amount numeric := 0; v_budget numeric; v_over boolean;
  v_group boolean; v_wh text; v_mode text; v_scope record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_input->>'purchaseOrderId' for update;
  if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
    raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  v_vat := coalesce(v_vat, v_po.vat_rate, 0);
  if v_po.status not in ('confirmed', 'in_transit', 'partial') then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_PO_STATE'; end if;
  -- Việc 2: đơn gom — mỗi đợt giao về một công trường chọn trong các kho của đơn.
  v_group := app_private.procurement_po_is_group(v_po.metadata);
  v_wh := case when v_group then nullif(p_input->>'targetWarehouseId', '') else v_po.target_warehouse_id end;
  v_mode := case when p_input->>'allocationMode' = 'ratio' then 'ratio' else 'earliest' end;
  if v_wh is null then
    raise exception using errcode = '22023', message = case when v_group then 'PROCUREMENT_GROUP_SITE_REQUIRED' else 'PROCUREMENT_PO_WAREHOUSE_REQUIRED' end; end if;
  if v_group and not exists (select 1 from app_private.group_po_link_allocation(v_po.id) g where g.warehouse_id = v_wh) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_SITE_INVALID'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
  if jsonb_typeof(p_input->'lines') is distinct from 'array' or jsonb_array_length(p_input->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;

  if v_batch_id is not null then
    select * into v_batch from public.purchase_order_delivery_batches where id = v_batch_id and purchase_order_id = v_po.id for update;
    if not found or v_batch.status <> 'planned' or v_batch.wms_transaction_id is not null
      or coalesce(v_batch.approval_status, 'draft') not in ('draft', 'rejected', 'revision_requested') then
      raise exception using errcode = '42501', message = 'PROCUREMENT_DELIVERY_NOT_EDITABLE'; end if;
    v_no := v_batch.delivery_no;
  else
    v_batch_id := gen_random_uuid();
    select coalesce(max(delivery_no), 0) + 1 into v_no from public.purchase_order_delivery_batches where purchase_order_id = v_po.id;
  end if;

  for ln in select value from jsonb_array_elements(p_input->'lines') loop
    select x.value into v_item from jsonb_array_elements(v_po.items) x
    where coalesce(x.value->>'lineId', x.value->>'itemId') = ln->>'purchaseOrderLineId' limit 1;
    if v_item is null then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
    if v_group and not exists (select 1 from app_private.group_po_link_allocation(v_po.id) g
        where g.warehouse_id = v_wh and g.po_line_id = ln->>'purchaseOrderLineId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_GROUP_LINE_NOT_AT_SITE'; end if;
    v_pq := nullif(ln->>'purchaseQty', '')::numeric; v_sq := nullif(ln->>'stockQty', '')::numeric;
    v_price := coalesce(nullif(ln->>'unitPrice', '')::numeric, 0);
    if v_pq is null or v_pq <= 0 or v_sq is null or v_sq <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if exists (select 1 from jsonb_array_elements(v_lines) e where e.value->>'purchaseOrderLineId' = ln->>'purchaseOrderLineId') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('purchaseOrderLineId', ln->>'purchaseOrderLineId',
      'itemId', v_item->>'itemId', 'purchaseQty', v_pq, 'purchaseUnit', coalesce(v_item->>'purchaseUnitSnapshot', v_item->>'unit'),
      'stockQty', v_sq, 'stockUnit', coalesce(v_item->>'stockUnitSnapshot', v_item->>'unitSnapshot', v_item->>'unit'),
      'purchaseUnitPrice', v_price));
    v_amount := v_amount + v_pq * v_price;
  end loop;

  v_budget := coalesce(nullif(v_po.approved_total_amount, 0), v_po.total_amount, 0);
  v_over := app_private.procurement_po_committed_amount(v_po.id, v_batch_id) + v_amount > v_budget * 1.0001 + 1;
  if v_over and (v_to is null or v_to = v_actor or not app_private.procurement_po_approver_ok(v_to)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_DELIVERY_APPROVER_REQUIRED'; end if;

  perform set_config('app.procurement_hub_context', 'on', true);
  perform set_config('app.material_transition_context', 'on', true);
  perform set_config('app.delivery_vat_reason', coalesce(nullif(btrim(p_input->>'vatReason'), ''), ''), true);
  perform app_private.write_purchase_order_draft_batch_v1(v_po, jsonb_build_object('id', v_batch_id, 'delivery_no', v_no,
    'planned_delivery_date', coalesce(nullif(p_input->>'plannedDate', '')::date, current_date), 'status', 'planned',
    'approval_status', 'draft', 'fulfillment_mode', v_po.fulfillment_mode, 'vat_rate', v_vat,
    'note', nullif(btrim(p_input->>'note'), ''), 'lines', v_lines), v_actor);
  perform set_config('app.delivery_vat_reason', '', true);
  select * into v_scope from app_private.resolve_warehouse_project_scope(v_wh);
  update public.purchase_order_delivery_batches
  set target_warehouse_id = v_wh, allocation_mode = v_mode,
      project_id = case when v_group then v_scope.project_id else project_id end,
      construction_site_id = case when v_group then v_scope.construction_site_id else construction_site_id end
  where id = v_batch_id;
  update public.purchase_order_delivery_batches
  set approval_status = case when v_over then 'pending_approval' else 'approved' end,
      approval_requested_by = v_actor, approval_requested_at = now(),
      approval_assignee_user_id = case when v_over then v_to end,
      approval_decided_by = case when v_over then null else v_actor end,
      approval_decided_at = case when v_over then null else now() end
  where id = v_batch_id;
  if v_over then
    perform app_private.procurement_notify(v_to, 'Đợt giao cần duyệt bổ sung',
      v_po.po_number || ' — đợt ' || v_no || ' vượt giá trị đơn đã duyệt.', v_po.id, 'assigned');
  else
    perform app_private.prepare_planned_purchase_delivery_batch_with_wms_qr_v2(v_batch_id, v_actor, gen_random_uuid());
  end if;
  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, payload)
  values ('purchase_order', v_po.id, case when v_over then 'delivery_request' else 'delivery_create' end, v_actor,
    jsonb_build_object('deliveryNo', v_no, 'amount', v_amount, 'vatRate', v_vat));
  perform set_config('app.procurement_hub_context', 'off', true);
  perform set_config('app.material_transition_context', 'off', true);
  return jsonb_build_object('deliveryId', v_batch_id, 'deliveryNo', v_no, 'needsApproval', v_over, 'amount', v_amount);
end;
$function$;


-- Ca 5 + 6 — Sửa số nhận nhầm: không thấp hơn số đã / đang trả NCC; giảm luôn giá trị nhận của đợt.

CREATE OR REPLACE FUNCTION public.correct_purchase_receipt_v1(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(coalesce(p->>'reason', '')), '');
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_ap public.supplier_payable_documents%rowtype;
  v_wh text;
  v_req jsonb;
  v_line public.purchase_order_delivery_lines%rowtype;
  v_new numeric; v_new_stock numeric; v_diff numeric; v_diff_stock numeric; v_factor numeric;
  v_line_gross numeric; v_total_gross numeric := 0;
  v_fix_id uuid := gen_random_uuid();
  v_adj_id text := 'tx-receipt-fix-' || replace(gen_random_uuid()::text, '-', '');
  v_adj_items jsonb := '[]'::jsonb;
  v_event_lines jsonb := '[]'::jsonb;
  v_orig_item jsonb;
  v_usage text;
  v_unit text;
  v_note text := '';
  v_status text;
  v_next_items jsonb;
  v_delivered boolean;
  v_project_finance_id text;
  v_po_no text;
  v_prev_guard text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_REASON: Ghi lý do sửa (ít nhất 5 ký tự) — ví dụ số cân thực tế, ai phát hiện.'; end if;
  if coalesce(jsonb_typeof(p->'lines'), '') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_NOTHING: Chưa có dòng nào cần sửa.'; end if;

  select * into v_batch from public.purchase_order_delivery_batches where id = nullif(p->>'deliveryId', '')::uuid;
  if not found then raise exception using errcode = 'P0002', message = 'PURCHASE_FIX_NOT_FOUND'; end if;
  select * into v_po from public.purchase_orders where id = v_batch.purchase_order_id for update;
  select * into v_batch from public.purchase_order_delivery_batches where id = v_batch.id for update;
  select * into v_tx from public.transactions where id = v_batch.wms_transaction_id for update;
  v_wh := coalesce(v_batch.target_warehouse_id, v_tx.target_warehouse_id);
  v_po_no := coalesce(v_po.po_number, v_po.id) || '-' || lpad(v_batch.delivery_no::text, 2, '0');

  if not app_private.wms_user_can_approve_exception(v_actor, v_wh) then
    raise exception using errcode = '42501', message = 'PURCHASE_FIX_DENIED: Chỉ người Duyệt ngoại lệ của kho (hoặc Admin) được sửa số nhận.'; end if;
  if v_tx.approver_id = v_actor then
    raise exception using errcode = '42501', message = 'PURCHASE_FIX_SELF: Người đã duyệt nhận đợt này không tự sửa số — nhờ người Duyệt ngoại lệ khác kiểm tra và sửa.'; end if;
  if v_batch.status not in ('received', 'received_short', 'received_over') or v_tx.status::text <> 'COMPLETED' then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_STATE: Đợt giao chưa ghi sổ nhận hàng — sửa trực tiếp số thực nhận trên phiếu.'; end if;
  if v_po.supplier_contract_id is not null then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_CONTRACT: Đơn gọi hàng theo HĐ nguyên tắc — báo Mua hàng điều chỉnh trên bảng đối soát tháng.'; end if;
  if coalesce(v_batch.fulfillment_mode, 'RECEIVE_TO_STOCK') <> 'RECEIVE_TO_STOCK'
     or exists (select 1 from app_private.request_purchase_po_links l where l.purchase_order_id = v_po.id and l.kind = 'asset') then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_MODE: Đợt giao dùng thẳng / mua tài sản không qua tồn kho — báo Mua hàng xử lý.'; end if;

  select * into v_ap from public.supplier_payable_documents where source_type = 'purchase_delivery_receipt' and source_id = v_batch.id::text for update;
  if found then
    if v_ap.status in ('cancelled', 'reversed') then
      raise exception using errcode = '22023', message = 'PURCHASE_FIX_AP_STATE: Công nợ của đợt đã hủy/đảo — báo kế toán.'; end if;
    v_usage := app_private.purchase_receipt_ap_usage(v_ap.id);
    if v_usage is not null then
      raise exception using errcode = '22023', message = format('PURCHASE_FIX_AP_USED: Công nợ của đợt đã có %s — báo kế toán lập điều chỉnh công nợ, kho lập phiếu điều chỉnh theo kiểm kê.', v_usage); end if;
  end if;

  for v_req in select value from jsonb_array_elements(p->'lines') loop
    select * into v_line from public.purchase_order_delivery_lines
    where id = nullif(v_req->>'deliveryLineId', '')::uuid and delivery_batch_id = v_batch.id for update;
    if not found then raise exception using errcode = '22023', message = 'PURCHASE_FIX_LINE: Dòng không thuộc đợt giao.'; end if;
    v_new := nullif(v_req->>'correctQty', '')::numeric;
    v_unit := coalesce(v_line.unit, v_line.stock_unit, '');
    if v_new is null or v_new < 0 then raise exception using errcode = '22023', message = 'PURCHASE_FIX_QTY: Số đúng không hợp lệ.'; end if;
    if v_req ? 'expectedQty' and abs(coalesce(nullif(v_req->>'expectedQty', '')::numeric, -1) - v_line.accepted_qty) > 0.000001 then
      raise exception using errcode = 'PT409', message = 'PURCHASE_FIX_STALE: Số đã nhận vừa thay đổi — mở lại phiếu để xem số mới.'; end if;
    if v_new > v_line.accepted_qty + 0.000001 then
      raise exception using errcode = '22023', message = format('PURCHASE_FIX_INCREASE: Số đúng %s lớn hơn số đã nhận %s %s. Ghi thiếu thì nhận phần còn lại qua "NCC giao tiếp" (đúng ngày hàng về), không sửa tăng.',
        trim(to_char(v_new, 'FM999G999G990D###')), trim(to_char(v_line.accepted_qty, 'FM999G999G990D###')), v_unit); end if;
    if v_new < coalesce(v_line.returned_qty, 0) - 0.000001 then
      raise exception using errcode = '22023', message = 'PURCHASE_FIX_RETURNED: Số đúng nhỏ hơn số đã trả NCC của dòng.'; end if;
    v_diff := round(v_line.accepted_qty - v_new, 6);
    if v_diff <= 0.0000005 then continue; end if;

    v_factor := case when coalesce(v_line.planned_qty, 0) > 0 and coalesce(v_line.stock_planned_qty, 0) > 0
      then v_line.stock_planned_qty / v_line.planned_qty else 1 end;
    v_new_stock := round(v_new * v_factor, 6);
    v_diff_stock := round(v_line.accepted_stock_qty - v_new_stock, 6);
    select x.value into v_orig_item from jsonb_array_elements(coalesce(v_tx.items, '[]'::jsonb)) x
    where x.value->>'purchaseOrderDeliveryLineId' = v_line.id::text limit 1;

    v_adj_items := v_adj_items || jsonb_build_array(jsonb_build_object(
      'itemId', v_line.item_id, 'quantity', -v_diff_stock,
      'price', case when v_factor > 0 then coalesce(v_line.delivery_unit_price, 0) / v_factor else coalesce(v_line.delivery_unit_price, 0) end,
      'accountingQty', -v_diff, 'accountingUnit', v_unit, 'accountingPrice', coalesce(v_line.delivery_unit_price, 0),
      'specification', v_orig_item->>'specification', 'itemNameSnapshot', v_orig_item->>'itemNameSnapshot',
      'purchaseOrderLineId', v_line.purchase_order_line_id, 'purchaseOrderDeliveryLineId', v_line.id,
      'purchaseOrderDeliveryBatchId', v_batch.id, 'correctionOfTransactionId', v_tx.id,
      'receivedBeforeQty', v_line.accepted_qty, 'receivedAfterQty', v_new, 'varianceReason', v_reason));
    v_event_lines := v_event_lines || jsonb_build_array(jsonb_build_object('deliveryLineId', v_line.id, 'itemId', v_line.item_id, 'unit', v_unit,
      'before', v_line.accepted_qty, 'after', v_new, 'diff', v_diff, 'stockDiff', v_diff_stock,
      'beforeDelivered', v_line.delivered_qty, 'beforeCounted', v_line.physical_counted_qty));
    v_note := v_note || case when v_note = '' then '' else '; ' end
      || coalesce(v_orig_item->>'itemNameSnapshot', (select i.name from public.items i where i.id = v_line.item_id), v_line.item_id) || ' '
      || trim(to_char(v_line.accepted_qty, 'FM999G999G990D###')) || ' → ' || trim(to_char(v_new, 'FM999G999G990D###')) || ' ' || v_unit;

    update public.purchase_order_delivery_lines
    set accepted_qty = v_new, accepted_stock_qty = v_new_stock,
        physical_counted_qty = v_new, physical_counted_stock_qty = v_new_stock,
        delivered_qty = least(delivered_qty, v_new), delivered_stock_qty = least(delivered_stock_qty, v_new_stock), updated_at = now()
    where id = v_line.id;

    perform public.apply_stock_change(v_line.item_id, v_wh, -v_diff_stock);

    v_line_gross := round(v_diff * coalesce(v_line.delivery_unit_price, 0) * (1 + coalesce(v_batch.vat_rate, 0) / 100), 2);
    v_total_gross := round(v_total_gross + v_line_gross, 2);

    v_po.items := (select coalesce(jsonb_agg(case when coalesce(x.value->>'lineId', x.value->>'itemId') = v_line.purchase_order_line_id
        then jsonb_set(x.value, '{receivedQty}', to_jsonb(greatest(round(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) - v_diff, 6), 0)), true)
        else x.value end order by x.ordinality), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) with ordinality x(value, ordinality));
    -- K2 (23/10): phiếu trả NCC đang chờ cũng giữ số (create_purchase_order_supplier_return so receivedQty với trả chờ + xong).
    if exists (select 1 from jsonb_array_elements(v_po.items) x
      where coalesce(x.value->>'lineId', x.value->>'itemId') = v_line.purchase_order_line_id
        and coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) + 0.000001 < (select coalesce(sum(rl.return_qty), 0)
          from public.purchase_order_supplier_return_lines rl
          join public.purchase_order_supplier_returns r on r.id = rl.supplier_return_id
          where r.purchase_order_id = v_po.id and rl.purchase_order_line_id = v_line.purchase_order_line_id
            and r.status in ('pending', 'completed'))) then
      raise exception using errcode = '22023', message = 'PURCHASE_FIX_RETURN_PENDING: Số đúng nhỏ hơn số đã / đang trả NCC của dòng — hủy phiếu trả đang chờ hoặc sửa số lớn hơn.'; end if;
  end loop;

  if jsonb_array_length(v_adj_items) = 0 then
    raise exception using errcode = '22023', message = 'PURCHASE_FIX_NOTHING: Số đúng bằng số đã nhận — không có gì để sửa.'; end if;

  insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, approved_at, status, note,
    business_event_type, business_event_reason, source_type, source_id, business_partner_id, business_partner_name_snapshot, created_by)
  values (v_adj_id, 'ADJUSTMENT', v_tx.date, v_adj_items, v_wh, v_actor, v_actor, now(), 'COMPLETED',
    'Sửa số nhận nhầm ' || v_po_no || ': ' || v_note || ' — ' || v_reason,
    'inventory_adjustment', v_reason, 'purchase_receipt_correction', v_batch.id::text, v_tx.business_partner_id, v_tx.business_partner_name_snapshot, v_actor);

  select case when sum(coalesce(accepted_qty, 0)) > sum(coalesce(planned_qty, 0)) then 'received_over'
    when sum(coalesce(accepted_qty, 0)) < sum(coalesce(planned_qty, 0)) then 'received_short' else 'received' end
  into v_status from public.purchase_order_delivery_lines where delivery_batch_id = v_batch.id;
  update public.purchase_order_delivery_batches
  set status = v_status, variance_reason = concat_ws('; ', variance_reason, 'Sửa số nhận: ' || v_note || ' (' || v_reason || ')'), updated_at = now()
  where id = v_batch.id;

  select coalesce(bool_and(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) >= coalesce(nullif(x.value->>'qty', '')::numeric, 0)), false)
  into v_delivered from jsonb_array_elements(coalesce(v_po.items, '[]'::jsonb)) x;
  v_prev_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);
  update public.purchase_orders
  set items = v_po.items,
      status = case when v_po.status in ('delivered', 'partial') then case when v_delivered then 'delivered' else 'partial' end else v_po.status end,
      actual_delivery_date = case when v_delivered then actual_delivery_date else null end
  where id = v_po.id;
  perform set_config('app.material_transition_context', coalesce(v_prev_guard, ''), true);

  update public.material_request_fulfillment_lines mfl
  set received_qty = coalesce(line.accepted_stock_qty, line.accepted_qty, 0), updated_at = now()
  from public.purchase_order_delivery_lines line
  where mfl.po_delivery_line_id = line.id and line.delivery_batch_id = v_batch.id;

  if v_ap.id is not null and v_total_gross > 0 then
    -- K2 (23/10, ca PO-272 đợt 2): giá trị nhận của đợt giảm theo phần sửa — câu lệnh riêng, không đụng cột status
    -- (trigger ghi công nợ chỉ chạy khi cập nhật status). Công nợ: ghi nhận giữ nguyên + giảm trừ (credit) bên dưới.
    update public.purchase_order_delivery_batches
    set accepted_gross_amount = round(coalesce(accepted_gross_amount, 0) - v_total_gross, 2)
    where id = v_batch.id;
    update public.supplier_payable_documents
    set credit_amount = round(coalesce(credit_amount, 0) + v_total_gross, 2),
        status = case when round(coalesce(recognized_amount, 0) - (coalesce(credit_amount, 0) + v_total_gross), 2) <= 0 then 'paid'
          when status = 'open' then 'partial' else status end,
        metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{purchaseReceiptCorrections}',
          coalesce(metadata->'purchaseReceiptCorrections', '{}'::jsonb) || jsonb_build_object(v_fix_id::text, jsonb_build_object(
            'sourceType', 'purchase_receipt_correction', 'adjustmentTransactionId', v_adj_id, 'amount', v_total_gross,
            'lines', v_event_lines, 'reason', v_reason, 'actorId', v_actor, 'at', now())), true),
        updated_at = now()
    where id = v_ap.id;

    select id into v_project_finance_id from public.project_finances
    where (v_po.project_id is not null and project_id = coalesce(v_batch.project_id, v_po.project_id))
       or (v_po.construction_site_id is not null and construction_site_id = coalesce(v_batch.construction_site_id, v_po.construction_site_id))
    limit 1;
    insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source, "sourceRef", source_ref, contract_cost_item_id, cost_classification_status,
      counterparty_partner_id, counterparty_name, attachments, "createdBy", "createdAt")
    values ('purchase-receipt-fix-' || v_fix_id::text, coalesce(v_project_finance_id, ''), coalesce(coalesce(v_batch.construction_site_id, v_po.construction_site_id), ''),
      coalesce(v_batch.project_id, v_po.project_id), nullif(v_project_finance_id, ''), coalesce(v_batch.construction_site_id, v_po.construction_site_id),
      'expense', 'materials', -v_total_gross, 'Sửa số nhận nhầm ' || v_po_no || ': ' || v_note,
      coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date)::text, 'workflow',
      'purchase_receipt_correction:' || v_fix_id::text, 'purchase_receipt_correction:' || v_fix_id::text, null, 'auto', null,
      coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, 'Nhà cung cấp'), '[]'::jsonb, v_actor::text, now())
    on conflict (source_ref) do nothing;
  end if;

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('purchase_order', v_po.id, 'receipt_correction', v_actor, v_reason, jsonb_build_object('correctionId', v_fix_id, 'deliveryId', v_batch.id,
    'deliveryNo', v_batch.delivery_no, 'transactionId', v_adj_id, 'receiptTransactionId', v_tx.id, 'lines', v_event_lines,
    'creditAmount', v_total_gross, 'batchStatus', v_status));

  if v_po.created_by_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and v_po.created_by_id <> v_actor::text then
    perform app_private.procurement_notify(v_po.created_by_id::uuid, 'Kho sửa số nhận nhầm',
      v_po_no || ': ' || v_note || '. Đơn mở lại phần thiếu — liên hệ NCC giao tiếp hoặc chốt thiếu.', v_po.id, 'assigned');
  end if;

  return jsonb_build_object('correctionId', v_fix_id, 'transactionId', v_adj_id, 'creditAmount', v_total_gross, 'batchStatus', v_status, 'lines', v_event_lines);
end;
$function$;


-- Ca 6 — ghi công nợ khi nhận: so chi phí / công nợ đã có với giá trị đợt + phần đã sửa số nhận.

CREATE OR REPLACE FUNCTION app_private.post_purchase_receipt_finance_v2(p_delivery_batch_id uuid, p_actor_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_tx public.transactions%rowtype;
  v_project_finance_id text;
  v_received_gross numeric(18,2);
  v_committed_gross numeric(18,2);
  v_source_ref text := 'purchase_receipt:' || p_delivery_batch_id::text;
  v_description text;
  v_existing_cost public.project_transactions%rowtype;
  v_existing_ap public.supplier_payable_documents%rowtype;
  v_corrected numeric(18,2);
begin
  select * into v_batch
  from public.purchase_order_delivery_batches
  where id = p_delivery_batch_id
  for update;
  if not found then
    raise exception 'Khong tim thay Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  v_received_gross := round(coalesce(v_batch.accepted_gross_amount, 0), 2);
  if v_received_gross <= 0 then
    return;
  end if;

  select * into v_po
  from public.purchase_orders
  where id = v_batch.purchase_order_id
  for update;
  if not found then
    raise exception 'Khong tim thay Goi mua hang cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;

  -- Việc 2: đơn gom ghi công nợ và chi phí cho dự án của công trường nhận (đợt giao).
  v_po.project_id := coalesce(v_batch.project_id, v_po.project_id);
  v_po.construction_site_id := coalesce(v_batch.construction_site_id, v_po.construction_site_id);

  select * into v_tx
  from public.transactions
  where id = v_batch.wms_transaction_id
  for update;
  if not found then
    raise exception 'Khong tim thay WMS cua Dot giao %.', p_delivery_batch_id using errcode = '22023';
  end if;
  if v_tx.status <> 'COMPLETED'::public.transaction_status then
    raise exception 'Chi ghi nhan chi phi receipt khi WMS da COMPLETED.' using errcode = '22023';
  end if;

  -- Việc 4: đơn gọi hàng theo HĐ nguyên tắc ghi nợ khi chốt đối soát tháng, không ghi lúc nhận.
  if v_po.supplier_contract_id is not null then
    perform app_private.procurement_contract_receipt_note(p_delivery_batch_id, p_actor_user_id);
    return;
  end if;

  select round(coalesce(sum(
    coalesce(line.planned_qty, 0)
    * coalesce(line.delivery_unit_price, 0)
    * (1 + coalesce(v_batch.vat_rate, 0) / 100)
  ), 0), 2)
  into v_committed_gross
  from public.purchase_order_delivery_lines line
  where line.delivery_batch_id = p_delivery_batch_id;

  select id into v_project_finance_id
  from public.project_finances
  where (v_po.project_id is not null and project_id = v_po.project_id)
     or (v_po.construction_site_id is not null and construction_site_id = v_po.construction_site_id)
  limit 1;

  v_description := 'Nhận hàng NCC '
    || coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp')
    || ' - '
    || coalesce(v_po.po_number, v_po.id)
    || ' - đợt '
    || coalesce(v_batch.delivery_no::text, p_delivery_batch_id::text);

  -- K2 (23/10): Sửa số nhận nhầm giảm giá trị đợt nhưng giữ chi phí / công nợ gốc + bút toán giảm riêng.
  select round(coalesce(sum(app_private.purchase_receipt_corrected_amount(d.metadata)), 0), 2) into v_corrected
  from public.supplier_payable_documents d
  where d.source_type = 'purchase_delivery_receipt' and d.source_id = p_delivery_batch_id::text;

  select * into v_existing_cost
  from public.project_transactions
  where source_ref = v_source_ref
  for update;
  if found then
    if round(coalesce(v_existing_cost.amount, 0), 2) <> v_received_gross + v_corrected then
      raise exception 'Anomaly: chi phi receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
  else
    insert into public.project_transactions (
      id, "projectFinanceId", "constructionSiteId",
      project_id, project_finance_id, construction_site_id,
      type, category, amount, description, date, source,
      "sourceRef", source_ref, contract_cost_item_id,
      cost_classification_status, counterparty_partner_id,
      counterparty_name, attachments, "createdBy", "createdAt"
    )
    values (
      'purchase-receipt-' || p_delivery_batch_id::text,
      coalesce(v_project_finance_id, ''),
      coalesce(v_po.construction_site_id, ''),
      v_po.project_id,
      nullif(v_project_finance_id, ''),
      v_po.construction_site_id,
      'expense',
      'materials',
      v_received_gross,
      v_description,
      coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date)::text, -- Ngày nghiệp vụ: chi phí theo ngày hàng về
      'workflow',
      v_source_ref,
      v_source_ref,
      null,
      'auto',
      null,
      coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
      coalesce(v_tx.attachments, '[]'::jsonb),
      p_actor_user_id::text,
      now()
    )
    on conflict (source_ref) do nothing;
  end if;

  select * into v_existing_ap
  from public.supplier_payable_documents
  where source_type = 'purchase_delivery_receipt'
    and source_id = p_delivery_batch_id::text
  for update;
  if found then
    if round(coalesce(v_existing_ap.recognized_amount, 0), 2) <> v_received_gross + v_corrected
       or round(coalesce(v_existing_ap.committed_amount, 0), 2) <> v_committed_gross then
      raise exception 'Anomaly: AP receipt da ton tai voi gia tri khac.' using errcode = 'P0001';
    end if;
    return;
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    metadata, created_by
  )
  values (
    'AP-REC-' || replace(p_delivery_batch_id::text, '-', ''),
    'purchase_delivery_receipt',
    p_delivery_batch_id::text,
    v_po.project_id,
    v_po.construction_site_id,
    v_batch.supplier_id,
    coalesce(v_batch.supplier_name_snapshot, v_po.vendor_name, v_po.vendor_id, 'Nhà cung cấp'),
    coalesce(v_po.po_number, v_po.id) || '-' || lpad(coalesce(v_batch.delivery_no, 0)::text, 2, '0'),
    coalesce((v_tx.date at time zone 'Asia/Ho_Chi_Minh')::date, current_date), -- công nợ theo ngày hàng về (chủ SP 08/10)
    null,
    v_committed_gross,
    v_received_gross,
    0,
    'open',
    'ap_receipt_' || replace(p_delivery_batch_id::text, '-', ''),
    jsonb_build_object(
      'purchaseOrderId', v_po.id,
      'purchaseOrderNo', v_po.po_number,
      'deliveryBatchId', p_delivery_batch_id,
      'wmsTransactionId', v_tx.id,
      'fulfillmentMode', v_batch.fulfillment_mode,
      'sourceRef', v_source_ref
    ),
    p_actor_user_id
  )
  on conflict (source_type, source_id) do nothing;
end;
$function$;


-- ---------------------------------------------------------------------------------------------------------------
-- Luật kiểm soát K0 đi cùng các chặn mới (để luật và chặn nói cùng một điều).
-- ---------------------------------------------------------------------------------------------------------------

-- Giá đối soát: đúng giá HĐ thì không cần lý do (giá HĐ là căn cứ).
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
    and (sl.contract_unit_price is null or abs(coalesce(sl.unit_price_snapshot, 0) - sl.contract_unit_price) > 0.01)
    and coalesce(btrim(sl.price_reason), '') = '' and coalesce(nl.unit_price, 0) > 0;
$$;

-- Sổ kho: trừ phần "Sửa số nhận nhầm" đã xuất điều chỉnh (ca PO-272 Sika: nhập 35.930, xuất điều chỉnh 14.930 = nhận 21.000).
create or replace function app_private.control_rule_ledger_vs_accepted()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  with acc as (
    select b.wms_transaction_id tx, dl.item_id, sum(dl.accepted_stock_qty) q, max(b.received_at) d, min(po.po_number) po_number, min(po.id) po_id,
      min(coalesce(b.project_id, po.project_id)) project_id, min(coalesce(b.target_warehouse_id, po.target_warehouse_id)) warehouse_id,
      array_agg(distinct b.id::text) batch_ids
    from public.purchase_order_delivery_batches b
    join public.purchase_order_delivery_lines dl on dl.delivery_batch_id = b.id
    join public.purchase_orders po on po.id = b.purchase_order_id
    where b.status like 'received%' and b.fulfillment_mode = 'RECEIVE_TO_STOCK' and b.wms_transaction_id is not null
    group by 1, 2),
  led as (
    select it.source_id tx, e.material_id item_id, sum(e.quantity_in) q
    from public.inventory_ledger_entries e join public.inventory_transactions it on it.id = e.inventory_transaction_id
    where e.movement_direction = 'in' and it.reversed_at is null
    group by 1, 2),
  fix as (
    select t.source_id batch_id, e.material_id item_id, sum(e.quantity_out) q
    from public.transactions t
    join public.inventory_transactions it on it.source_id = t.id and it.reversed_at is null
    join public.inventory_ledger_entries e on e.inventory_transaction_id = it.id and e.movement_direction = 'out'
    where t.source_type = 'purchase_receipt_correction'
    group by 1, 2)
  select 'tx:' || acc.tx || ':item:' || acc.item_id, 'wms_transaction', acc.tx::text, acc.po_number, acc.project_id, acc.warehouse_id,
    format('%s · %s: nhận thực tế %s, sổ kho ghi nhập %s%s', acc.po_number, coalesce(i.name, 'vật tư'), app_private.control_qty(acc.q), app_private.control_qty(coalesce(led.q, 0)),
      case when coalesce(f.q, 0) > 0 then ', xuất điều chỉnh ' || app_private.control_qty(f.q) else '' end),
    jsonb_build_object('vat_tu', i.name, 'don_vi', i.unit, 'thuc_nhan', acc.q, 'so_kho_nhap', coalesce(led.q, 0), 'xuat_dieu_chinh', coalesce(f.q, 0)),
    null::numeric, (acc.d at time zone 'Asia/Ho_Chi_Minh')::date, '/procurement?po=' || acc.po_id
  from acc left join led on led.tx = acc.tx::text and led.item_id = acc.item_id
  left join lateral (select sum(fix.q) q from fix where fix.batch_id = any(acc.batch_ids) and fix.item_id = acc.item_id) f on true
  left join public.items i on i.id = acc.item_id
  where abs(coalesce(acc.q, 0) - (coalesce(led.q, 0) - coalesce(f.q, 0))) > 0.0001;
$$;

-- Công nợ đợt: ghi nhận − phần giảm trừ do Sửa số nhận nhầm = giá trị đợt.
create or replace function app_private.control_rule_ap_vs_accepted()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'ap:' || d.id, 'payable_document', d.id::text, coalesce(po.po_number || ' · đợt ' || b.delivery_no, d.document_no), d.project_id, coalesce(b.target_warehouse_id, po.target_warehouse_id),
    format('%s đợt %s: công nợ ghi %s%s, giá trị hàng nhận %s', po.po_number, b.delivery_no, app_private.control_vnd(d.recognized_amount),
      case when c.amount > 0 then ' (đã giảm do sửa số nhận ' || app_private.control_vnd(c.amount) || ')' else '' end, app_private.control_vnd(b.accepted_gross_amount)),
    jsonb_build_object('chung_tu_no', d.document_no, 'cong_no', d.recognized_amount, 'giam_tru', d.credit_amount, 'giam_do_sua_so_nhan', c.amount, 'gia_tri_nhan', b.accepted_gross_amount),
    round(coalesce(d.recognized_amount, 0) - c.amount - coalesce(b.accepted_gross_amount, 0)), coalesce(d.document_date, (b.received_at at time zone 'Asia/Ho_Chi_Minh')::date), '/procurement?po=' || po.id
  from public.supplier_payable_documents d
  join public.purchase_order_delivery_batches b on b.id::text = d.source_id
  join public.purchase_orders po on po.id = b.purchase_order_id
  cross join lateral (select app_private.purchase_receipt_corrected_amount(d.metadata) amount) c
  where d.source_type = 'purchase_delivery_receipt' and abs(d.recognized_amount - c.amount - coalesce(b.accepted_gross_amount, 0)) > 1;
$$;

-- VAT đợt: có lý do thì không còn là lệch.
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
  where b.status like 'received%' and coalesce(b.vat_rate, 0) <> coalesce(po.vat_rate, 0) and abs(coalesce(s.gap, 0)) > 1
    and coalesce(btrim(b.vat_reason), '') = '';
$$;

-- Đặt vượt: cộng các đơn lập trước cho cùng dòng đề xuất, dung sai 2% (cùng điều kiện chặn khi gửi / duyệt).
create or replace function app_private.control_rule_order_over_need()
returns table(object_key text, object_type text, object_id text, object_code text, project_id text, warehouse_id text, title text, detail jsonb, amount numeric, happened_on date, link text)
language sql stable security definer set search_path = '' as $$
  select 'prl:' || prl.id, 'purchase_order', po.id, po.po_number, coalesce(prl.project_id::text, po.project_id), po.target_warehouse_id,
    format('%s · %s: đặt %s%s, đề xuất %s cần %s, không ghi lý do đặt vượt', po.po_number, coalesce(i.name, 'vật tư'), app_private.control_qty(prl.ordered_qty),
      case when o.qty > 0 then ' (đơn trước đã đặt ' || app_private.control_qty(o.qty) || ')' else '' end,
      prl.material_request_code, app_private.control_qty(prl.requested_qty)),
    jsonb_build_object('de_xuat', prl.material_request_code, 'can', prl.requested_qty, 'dat', prl.ordered_qty, 'don_truoc_da_dat', o.qty, 'don_vi', prl.unit),
    null::numeric, app_private.control_po_date(po.order_date, po.created_at), '/procurement?po=' || po.id
  from public.purchase_order_request_lines prl
  join public.purchase_orders po on po.id = prl.purchase_order_id
  left join public.items i on i.id = prl.item_id
  cross join lateral (select app_private.procurement_request_line_ordered_before(prl.material_request_id, prl.request_line_id, po.id, po.created_at) qty) o
  where po.status not in ('cancelled') and po.archived_at is null and coalesce(prl.requested_qty, 0) > 0
    and coalesce(prl.ordered_qty, 0) + o.qty > prl.requested_qty * 1.02 + 0.0001
    and coalesce(btrim(prl.excess_reason), '') = '';
$$;

update public.control_rules set
  principle = case code
    when 'statement_price_no_reason' then 'Giá trên bảng đối soát HĐ nguyên tắc khác giá NCC ghi trên phiếu giao (và khác giá HĐ) thì phải ghi lý do. Từ K2: lưu / ghi nợ bị chặn nếu thiếu.'
    when 'batch_vat_differs' then 'VAT của đợt giao phải theo VAT đơn; khác thì phải có lý do (hóa đơn thực tế). Từ K2: lập đợt / đổi VAT khác đơn bị chặn nếu thiếu.'
    when 'order_over_need' then 'Đặt nhiều hơn số đề xuất cần (cộng các đơn trước, dung sai 2%) thì phải ghi lý do. Từ K2: gửi / duyệt đơn bị chặn nếu thiếu.'
    when 'ledger_vs_accepted' then 'Số nhập trên sổ kho của mỗi vật tư, trừ phần xuất điều chỉnh khi sửa số nhận nhầm, phải bằng số đạt khi nhận hàng của đợt.'
    when 'ap_vs_accepted' then 'Nợ NCC theo đợt = số nhận thực tế × giá × (1 + VAT); phần sửa số nhận nhầm ghi giảm trừ riêng.'
    when 'mr_ended_po_open' then 'Kết thúc đề xuất khi đơn mua còn mở phải xác nhận từng đơn (K2); đơn chưa duyệt của đề xuất đã kết thúc không duyệt được.'
    else principle end
where code in ('statement_price_no_reason', 'batch_vat_differs', 'order_over_need', 'ledger_vs_accepted', 'ap_vs_accepted', 'mr_ended_po_open');

-- ---------------------------------------------------------------------------------------------------------------
-- Ca 6 — sửa dữ liệu: đợt đã "Sửa số nhận nhầm" trước K2 giữ giá trị nhận cũ (PO-272 đợt 2: 201,2 tr → 117,6 tr).
-- Chỉ sửa đợt mà giá trị vẫn bằng số ghi nhận công nợ gốc (chưa giảm). Nhật ký trước/sau do trigger audit đợt giao ghi.
-- ---------------------------------------------------------------------------------------------------------------
update public.purchase_order_delivery_batches b
set accepted_gross_amount = round(b.accepted_gross_amount - c.amount, 2)
from (select d.source_id, d.recognized_amount, app_private.purchase_receipt_corrected_amount(d.metadata) amount
      from public.supplier_payable_documents d where d.source_type = 'purchase_delivery_receipt') c
where b.id::text = c.source_id and c.amount > 0 and abs(coalesce(b.accepted_gross_amount, 0) - c.recognized_amount) < 0.01;

revoke all on function app_private.material_request_open_pos(text) from public, anon, authenticated;
revoke all on function app_private.material_request_open_pos_acked(jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.procurement_request_line_ordered_before(text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function app_private.procurement_po_excess_missing(text) from public, anon, authenticated;
revoke all on function app_private.purchase_receipt_corrected_amount(jsonb) from public, anon, authenticated;
revoke all on function app_private.guard_delivery_batch_vat_reason() from public, anon, authenticated;
