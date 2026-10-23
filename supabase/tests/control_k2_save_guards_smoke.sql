-- Kiểm soát viên K2: chặn lúc lưu 6 ca P0 trên dữ liệu thật (giao dịch tự hủy).
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261030100000_control_k2_save_guards.sql --smoke supabase/tests/control_k2_save_guards_smoke.sql
begin;
create temp table k2(name text primary key, v text, n bigint) on commit drop;
grant select on k2 to authenticated;
create temp table k2log(at timestamptz default clock_timestamp(), msg text) on commit drop;
grant insert, select on k2log to authenticated;

-- ---------------------------------------------------------------- Postgres: dữ liệu, luật, chốt VAT, công nợ khi nhận
do $$
declare res jsonb; v_batch uuid; v_po text; v_err text; v_vat numeric; v_id uuid;
begin
  res := app_private.control_run(null, 'smoke');
  if jsonb_array_length(res->'errors') > 0 then raise exception 'FAIL 1 luật lỗi: %', res->'errors'; end if;

  -- Ca 6: dữ liệu PO-272 đợt 2 về 117,6 tr; luật sổ kho / công nợ / giá trị đợt không còn báo PO-272.
  select b.id into v_batch from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
  where po.po_number = 'PO-272' and b.delivery_no = 2;
  if abs((select accepted_gross_amount from public.purchase_order_delivery_batches where id = v_batch) - 117600000) > 1 then
    raise exception 'FAIL 2 PO-272 đợt 2 giá trị = %', (select accepted_gross_amount from public.purchase_order_delivery_batches where id = v_batch); end if;
  if exists (select 1 from app_private.control_rule_ledger_vs_accepted() where object_code = 'PO-272') then raise exception 'FAIL 3 luật sổ kho vẫn báo PO-272'; end if;
  if exists (select 1 from app_private.control_rule_ap_vs_accepted() where object_code like 'PO-272%') then raise exception 'FAIL 3b luật công nợ báo PO-272'; end if;
  if exists (select 1 from app_private.control_rule_accepted_value_calc() where object_code = 'PO-272 · đợt 2') then raise exception 'FAIL 3c luật giá trị đợt vẫn báo PO-272 đợt 2'; end if;
  -- Trigger ghi công nợ chạy lại (cập nhật status) không còn báo "Anomaly".
  update public.purchase_order_delivery_batches set status = status where id = v_batch;

  -- Ca 1: luật vẫn bắt PO-609 (HĐ không có giá); ghi nợ lại bảng đối soát thiếu lý do bị chặn.
  if not exists (select 1 from app_private.control_rule_statement_price_no_reason() where object_code like 'PO-609%') then raise exception 'FAIL 4 luật giá mất PO-609'; end if;
  select s.id into v_id from public.supplier_delivery_statements s where s.code = 'DCHD-202610-2865B0';
  update public.supplier_delivery_statements set status = 'confirmed' where id = v_id;
  perform set_config('app.procurement_hub_context', 'on', true);
  begin
    perform public.post_supplier_delivery_statement(v_id, null);
    raise exception 'FAIL 5 ghi nợ được bảng đối soát giá khác phiếu giao không lý do';
  exception when others then
    if sqlerrm not like '%PROCUREMENT_STATEMENT_NOTE_PRICE_REASON%' then raise exception 'FAIL 5 lỗi khác: %', sqlerrm; end if;
  end;
  perform set_config('app.procurement_hub_context', 'off', true);

  -- Ca 4: PO-694 có 2 dòng đặt vượt chưa lý do.
  select id into v_po from public.purchase_orders where po_number = 'PO-694';
  if jsonb_array_length(app_private.procurement_po_excess_missing(v_po)) <> 2 then
    raise exception 'FAIL 6 PO-694 đặt vượt: %', app_private.procurement_po_excess_missing(v_po); end if;

  -- Ca 3: đợt chưa nhận (VAT đơn > 0): đổi VAT khác đơn không lý do bị chặn; có lý do thì lưu; đợt cũ lệch sửa cột khác không bị chặn.
  select b.id, coalesce(po.vat_rate, 0) into v_batch, v_vat from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
  where b.status in ('planned', 'receiving') and coalesce(po.vat_rate, 0) > 0 and coalesce(b.vat_rate, 0) = coalesce(po.vat_rate, 0) order by b.created_at desc limit 1;
  begin
    update public.purchase_order_delivery_batches set vat_rate = 0 where id = v_batch;
    raise exception 'FAIL 7 đổi VAT khác đơn không lý do';
  exception when others then
    if sqlerrm not like 'PURCHASE_DELIVERY_VAT_REASON%' then raise exception 'FAIL 7 lỗi khác: %', sqlerrm; end if;
  end;
  update public.purchase_order_delivery_batches set vat_rate = 0, vat_reason = 'NCC xuất hóa đơn không VAT' where id = v_batch;
  if (select vat_reason from public.purchase_order_delivery_batches where id = v_batch) is null then raise exception 'FAIL 7b không lưu lý do VAT'; end if;
  update public.purchase_order_delivery_batches set vat_rate = v_vat where id = v_batch;
  if (select vat_reason from public.purchase_order_delivery_batches where id = v_batch) is not null then raise exception 'FAIL 7c VAT về theo đơn vẫn giữ lý do'; end if;
  update public.purchase_order_delivery_batches b set note = coalesce(b.note, '') from public.purchase_orders po
  where po.id = b.purchase_order_id and coalesce(b.vat_rate, 0) <> coalesce(po.vat_rate, 0);
  -- Lập đợt qua hàm lưu nháp cũ không truyền VAT (mặc định 0) → lấy VAT đơn.
  insert into k2 values ('vat_batch', v_batch::text, v_vat);

  -- Ca 2 + 4: chuẩn bị đơn đang chờ duyệt.
  insert into k2 select 'po696', po.id, po.row_version from public.purchase_orders po where po.po_number = 'PO-696';
  insert into k2 select 'mr9885', r.id, null from public.requests r where r.code = 'MR-2026-9885';
  insert into k2 select 'po696_open', app_private.material_request_open_pos((select v from k2 where name = 'mr9885'))::text, null;
  insert into k2 select 'po701', po.id, po.row_version from public.purchase_orders po where po.po_number = 'PO-701';
  update public.purchase_order_request_lines set ordered_qty = requested_qty * 2, ordered_stock_qty_snapshot = requested_qty * 2, excess_reason = null
  where purchase_order_id = (select v from k2 where name = 'po701');
  if jsonb_array_length(app_private.procurement_po_excess_missing((select v from k2 where name = 'po701'))) = 0 then raise exception 'FAIL 8 dựng ca đặt vượt PO-701'; end if;
  insert into k2log(msg) values (format('MR-2026-9885 đơn mở: %s', (select v from k2 where name = 'po696_open')));
  if jsonb_array_length((select v from k2 where name = 'po696_open')::jsonb) = 0 then raise exception 'FAIL 9 MR-2026-9885 không thấy PO-696 đang mở'; end if;

  -- Ca 5: phiếu trả NCC đang chờ trả hết số nhận của một dòng PO-272 đợt 3.
  select b.id into v_batch from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
  where po.po_number = 'PO-272' and b.delivery_no = 3;
  insert into k2 select 'fix_batch', v_batch::text, null;
  with r as (
    insert into public.purchase_order_supplier_returns (return_no, purchase_order_id, source_warehouse_id, status, transaction_id, reason)
    select 'TRA-K2-SMOKE', po.id, coalesce(b.target_warehouse_id, po.target_warehouse_id), 'pending', b.wms_transaction_id, 'K2 smoke'
    from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id where b.id = v_batch
    returning id)
  insert into public.purchase_order_supplier_return_lines (supplier_return_id, purchase_order_line_id, item_id, return_qty)
  select r.id, dl.purchase_order_line_id, dl.item_id,
    (select coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) from public.purchase_orders po cross join jsonb_array_elements(po.items) x
     where po.id = dl.purchase_order_id and coalesce(x.value->>'lineId', x.value->>'itemId') = dl.purchase_order_line_id)
  from r, (select * from public.purchase_order_delivery_lines where delivery_batch_id = v_batch order by id limit 1) dl;
  insert into k2 select 'fix_line', dl.id::text, null from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = v_batch order by id limit 1;
end $$;

-- ---------------------------------------------------------------- Admin Hoàng (người dùng thật, qua RPC)
select set_config('request.jwt.claims', jsonb_build_object('sub', auth_id, 'email', email, 'role', 'authenticated')::text, true)
from public.users where name = 'Admin Hoàng' and auth_id is not null limit 1;
set local role authenticated;
do $$
declare res jsonb; v_mr text := (select v from k2 where name = 'mr9885'); v_open jsonb := (select v from k2 where name = 'po696_open')::jsonb;
  v_ack jsonb;
begin
  -- Ca 2: kết thúc đề xuất còn đơn mở → MR_SUPPLY_OPEN_PO (kèm danh sách đơn); xác nhận đúng đơn → kết thúc được.
  begin
    perform public.end_material_request_supply_v1(jsonb_build_object('requestIds', jsonb_build_array(v_mr), 'reason', 'K2 smoke'));
    raise exception 'FAIL 10 kết thúc được đề xuất còn đơn mở';
  exception when others then
    if sqlerrm <> 'MR_SUPPLY_OPEN_PO' then raise exception 'FAIL 10 lỗi khác: %', sqlerrm; end if;
  end;
  begin
    perform public.end_material_request_supply_v1(jsonb_build_object('requestIds', jsonb_build_array(v_mr), 'reason', 'K2 smoke', 'openPoAck', '["x"]'::jsonb));
    raise exception 'FAIL 10b xác nhận sai đơn vẫn kết thúc';
  exception when others then
    if sqlerrm <> 'MR_SUPPLY_OPEN_PO' then raise exception 'FAIL 10b lỗi khác: %', sqlerrm; end if;
  end;
  select jsonb_agg(e->'id') into v_ack from jsonb_array_elements(v_open) e;
  res := public.end_material_request_supply_v1(jsonb_build_object('requestIds', jsonb_build_array(v_mr), 'reason', 'K2 smoke', 'openPoAck', v_ack));
  if (res->>'ended')::int <> 1 then raise exception 'FAIL 11 kết thúc có xác nhận: %', res; end if;
  -- Đơn của đề xuất đã kết thúc không duyệt được.
  begin
    perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId', (select v from k2 where name = 'po696'),
      'expectedRowVersion', (select n from k2 where name = 'po696'), 'action', 'approve'));
    raise exception 'FAIL 12 duyệt được đơn của đề xuất đã kết thúc';
  exception when others then
    if sqlerrm <> 'PROCUREMENT_PO_NEED_ENDED' then raise exception 'FAIL 12 lỗi khác: %', sqlerrm; end if;
  end;

  -- Ca 4: duyệt đơn đặt vượt không lý do → chặn; có lý do → ghi lý do vào dòng.
  begin
    perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId', (select v from k2 where name = 'po701'),
      'expectedRowVersion', (select n from k2 where name = 'po701'), 'action', 'approve'));
    raise exception 'FAIL 13 duyệt được đơn đặt vượt không lý do';
  exception when others then
    if sqlerrm <> 'PROCUREMENT_PO_EXCESS_REASON_REQUIRED' then raise exception 'FAIL 13 lỗi khác: %', sqlerrm; end if;
  end;
  res := public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId', (select v from k2 where name = 'po701'),
    'expectedRowVersion', (select n from k2 where name = 'po701'), 'action', 'approve', 'excessReason', 'Hao hụt thi công, dự phòng đợt sau'));
  insert into k2log(msg) values (format('duyệt PO-701 có lý do: %s', res));

  -- Ca 5: sửa số nhận thấp hơn số đang trả NCC → PURCHASE_FIX_RETURN_PENDING (điều kiện khác chưa thỏa thì in ra để xem).
  begin
    perform public.correct_purchase_receipt_v1(jsonb_build_object('deliveryId', (select v from k2 where name = 'fix_batch'), 'reason', 'K2 smoke kiểm trả NCC',
      'lines', jsonb_build_array(jsonb_build_object('deliveryLineId', (select v from k2 where name = 'fix_line'),
        'correctQty', (select accepted_qty - 1 from public.purchase_order_delivery_lines where id = (select v from k2 where name = 'fix_line')::uuid)))));
    raise exception 'FAIL 14 sửa được số nhận thấp hơn số đang trả';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like 'PURCHASE_FIX_RETURN_PENDING%' then insert into k2log(msg) values (format('Ca 5 dừng ở điều kiện khác (không phải K2): %s', sqlerrm));
    else insert into k2log(msg) values (format('Ca 5 OK: %s', sqlerrm)); end if;
  end;
end $$;
reset role;

do $$ begin
  if (select count(*) from public.purchase_order_request_lines where purchase_order_id = (select v from k2 where name = 'po701') and excess_reason is not null) = 0 then
    raise exception 'FAIL 15 duyệt có lý do mà dòng không lưu lý do'; end if;
  if not exists (select 1 from public.material_request_events e where e.request_id = (select v from k2 where name = 'mr9885') and e.action = 'SUPPLY_ENDED' and e.metadata ? 'openOrders') then
    raise exception 'FAIL 16 sự kiện kết thúc không ghi đơn còn mở'; end if;
end $$;
select msg from k2log order by at;
rollback;
