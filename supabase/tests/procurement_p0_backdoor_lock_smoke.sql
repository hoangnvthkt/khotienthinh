-- Đợt 1 khóa cửa sau (audit 22/10): lặp lại đúng các thăm dò P0 đã làm trên Cloud — tất cả phải bị chặn —
-- và luồng chuẩn (lập PO → duyệt → nhận → đề nghị chi → chi; sửa số nhận; trả hàng giảm trừ) vẫn chạy.
-- Vai thật: Linh (lập đơn), Mơ (duyệt đơn), Phương (thủ kho Kho Xin Hai Vina), Thủy (kế toán), Hương (duyệt chi),
-- Chuẩn (xác nhận chi), Admin. Ghi thẳng = request.path '/rest/v1/…' + role authenticated; lệnh = '/rpc/…'.
-- Mọi số chứng từ (sequence) nhảy trong lúc chạy được đặt lại ở cuối. Rollback.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261028090000_procurement_p0_backdoor_lock.sql --smoke supabase/tests/procurement_p0_backdoor_lock_smoke.sql
begin;

create temp table _seq on commit drop as
  select format('%I.%I', schemaname, sequencename) seq, last_value, start_value
  from pg_sequences where schemaname in ('public', 'app_private');
create temp table _res (n serial, step text, ok boolean, detail jsonb) on commit drop;

-- Đóng vai: claims theo users.id (sub = auth_id), request.path quyết định "lệnh" hay "ghi thẳng".
create function pg_temp.claims(p_user uuid, p_path text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', u.auth_id, 'role', 'authenticated', 'email', coalesce(u.email, ''))::text, true),
         set_config('request.jwt.claim.sub', u.auth_id::text, true),
         set_config('request.path', p_path, true)
  from public.users u where u.id = p_user;
$$;
create function pg_temp.ok(p_step text, p_ok boolean, p_detail jsonb default null) returns void language sql as $$
  insert into _res(step, ok, detail) values (p_step, coalesce(p_ok, false), p_detail);
$$;
-- Thăm dò: hành động chạy trong khối con rồi luôn hoàn tác. ĐẠT = lỗi đúng mã (regex đầu câu), hoặc 0 dòng bị đổi (RLS).
create function pg_temp.probe(p_step text, p_error text, p_rows bigint, p_expect text) returns void language sql as $$
  insert into _res(step, ok, detail) values (
    'CHẶN: ' || p_step,
    case when p_error = 'PROBE_DONE' then p_rows = 0 else p_error ~ ('^' || p_expect) end,
    case when p_error = 'PROBE_DONE' then jsonb_build_object('làm_được', p_rows) else jsonb_build_object('lỗi', left(p_error, 140)) end
  );
$$;
create function pg_temp.reset_seqs() returns void language plpgsql as $$
declare x record;
begin
  for x in select q.seq, q.last_value, q.start_value from _seq q
           join pg_sequences p on format('%I.%I', p.schemaname, p.sequencename) = q.seq
           where p.last_value is distinct from q.last_value loop
    if x.last_value is null then perform setval(x.seq, x.start_value, false);
    else perform setval(x.seq, x.last_value, true); end if;
  end loop;
end $$;

do $smoke$
declare
  c_linh constant uuid := '5bdea3d2-f1e6-45b0-baf1-14cf3770c0a5';
  c_mo constant uuid := '2c4eeb7a-2cff-480c-8b12-be6b9bc67b0c';
  c_phuong constant uuid := 'e05c970a-09a5-4f74-9905-70d39fdc7b86';
  c_thuy constant uuid := '84353526-7c84-485d-bf3a-5bb1dc5bf5eb';
  c_huong constant uuid := '85b13472-d16c-4025-afac-ee8c8d1bf1f6';
  c_chuan constant uuid := '1b7bd7cb-54c3-43b5-b0ff-44ce63b8bd11';
  c_admin constant uuid := '928d3473-49a2-4427-a319-19729689a084';
  c_vendor constant text := '8a0c67b9-2ec3-42a2-a798-75a75749367b';   -- Phúc Hà
  c_wh constant text := 'wh-1782528573176-6lb7z';                     -- Kho Xin Hai Vina
  c_a constant text := 'it-1779153359827-571-zrjb9';                  -- Bịt PVC 42
  c_b constant text := 'it-1779153359827-698-krmpv';                  -- Măng sông PVC 42
  c_mr constant text := 'mr-p0-lock-smoke';
  c_l1 constant text := 'eeeeeeee-0028-4000-8000-000000000001';
  c_l2 constant text := 'eeeeeeee-0028-4000-8000-000000000002';
  v jsonb; v_lines jsonb; v_rv text; n bigint; v_err text;
  v_po1 text; v_po2 text; v_b1 uuid; v_b2 uuid; v_tx2 text; v_req uuid; v_pb uuid; v_pb_rv bigint;
  v_ret uuid; v_ret_tx text; v_legacy_po text; v_legacy_b uuid; v_legacy_line text;
  v_nonhub_batch uuid; v_nonhub_po text; v_today text := to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
  v_tx1 text; v_cash uuid; v_items jsonb; v_po2_line text;
begin
  -- Mọi câu đọc dữ liệu chạy bằng vai gốc (trước khi đổi vai) để RLS không làm sai đầu vào.
  -- Phiếu đề xuất thử: nhân bản MR-2026-9873 (đã duyệt, chạy quy trình, kho XHV), 2 dòng A = 10, B = 5.
  insert into public.requests select (jsonb_populate_record(null::public.requests, to_jsonb(r) || jsonb_build_object(
    'id', c_mr, 'code', public.next_material_request_code_v1(), 'title', 'SMOKE khóa cửa sau',
    'items', jsonb_build_array(
      jsonb_build_object('itemId', c_a, 'lineId', c_l1, 'requestQty', 10, 'approvedQty', 0, 'unitSnapshot', 'Cái', 'itemNameSnapshot', 'Bịt PVC 42', 'isManualItem', false),
      jsonb_build_object('itemId', c_b, 'lineId', c_l2, 'requestQty', 5, 'approvedQty', 0, 'unitSnapshot', 'Cái', 'itemNameSnapshot', 'Măng sông PVC 42', 'isManualItem', false)),
    'created_at', now(), 'last_action_at', now()))).* from public.requests r where r.code = 'MR-2026-9873';

  -- ===== Luồng chuẩn phần 1: lập 2 PO → duyệt → nhận PO-1 → đề nghị chi → chi =====
  begin
    perform pg_temp.claims(c_linh, '/rpc/save_procurement_hub_po_v1');
    execute 'set local role authenticated';
    v := public.save_procurement_hub_po_v1(jsonb_build_object('vendorId', c_vendor, 'vatRate', 8, 'purchaseMode', 'single',
      'items', jsonb_build_array(jsonb_build_object('itemId', c_a, 'unitPrice', 100000, 'allocations', jsonb_build_array(
        jsonb_build_object('sourceType', 'material_request', 'sourceId', c_mr, 'lineId', c_l1, 'qty', 10))))));
    v_po1 := v ->> 'purchaseOrderId';
    v := public.save_procurement_hub_po_v1(jsonb_build_object('vendorId', c_vendor, 'vatRate', 8, 'purchaseMode', 'single',
      'items', jsonb_build_array(jsonb_build_object('itemId', c_b, 'unitPrice', 50000, 'allocations', jsonb_build_array(
        jsonb_build_object('sourceType', 'material_request', 'sourceId', c_mr, 'lineId', c_l2, 'qty', 5))))));
    v_po2 := v ->> 'purchaseOrderId';
    execute 'reset role';
    perform pg_temp.ok('1. Linh lập PO-1 (A 10 × 100k) và PO-2 (B 5 × 50k), VAT 8%', v_po1 is not null and v_po2 is not null);
  exception when others then perform pg_temp.ok('1. Linh lập PO-1, PO-2', false, jsonb_build_object('lỗi', sqlerrm));
  end;

  for v in select jsonb_build_object('po', x) from unnest(array[v_po1, v_po2]) x loop
    begin
      select row_version::text into v_rv from public.purchase_orders where id = v->>'po';
      perform pg_temp.claims(c_linh, '/rpc/transition_procurement_hub_po_v1');
      execute 'set local role authenticated';
      perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId', v->>'po', 'action', 'submit', 'approverUserId', c_mo, 'expectedRowVersion', v_rv));
      execute 'reset role';
      select row_version::text into v_rv from public.purchase_orders where id = v->>'po';
      perform pg_temp.claims(c_mo, '/rpc/transition_procurement_hub_po_v1');
      execute 'set local role authenticated';
      perform public.transition_procurement_hub_po_v1(jsonb_build_object('purchaseOrderId', v->>'po', 'action', 'approve', 'expectedRowVersion', v_rv));
      execute 'reset role';
      perform pg_temp.ok('2. Linh gửi duyệt, Mơ duyệt ' || coalesce((select po_number from public.purchase_orders where id = v->>'po'), '?'),
        (select status = 'confirmed' from public.purchase_orders where id = v->>'po'));
    exception when others then perform pg_temp.ok('2. Gửi duyệt / duyệt', false, jsonb_build_object('lỗi', sqlerrm));
    end;
  end loop;

  select id into v_b1 from public.purchase_order_delivery_batches where purchase_order_id = v_po1;
  select id, wms_transaction_id into v_b2, v_tx2 from public.purchase_order_delivery_batches where purchase_order_id = v_po2;
  perform pg_temp.ok('2b. Duyệt xong tự sinh đợt giao + phiếu nhập chờ nhận', v_b1 is not null and v_b2 is not null and v_tx2 is not null);

  begin
    select jsonb_agg(jsonb_build_object('deliveryLineId', dl.id, 'itemId', dl.item_id,
      'documentedPurchaseQty', dl.planned_qty, 'countedPurchaseQty', dl.planned_qty, 'acceptedPurchaseQty', dl.planned_qty,
      'documentedStockQty', dl.stock_planned_qty, 'countedStockQty', dl.stock_planned_qty, 'acceptedStockQty', dl.stock_planned_qty))
      into v_lines from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = v_b1;
    select wms_transaction_id into v_tx1 from public.purchase_order_delivery_batches where id = v_b1;
    perform pg_temp.claims(c_phuong, '/rpc/receive_purchase_delivery_v1');
    execute 'set local role authenticated';
    perform public.receive_purchase_delivery_v1(v_b1, v_tx1, 'passed', v_lines, '[]'::jsonb);
    execute 'reset role';
    perform pg_temp.ok('3. Phương nhận đủ PO-1: PO delivered, công nợ 1.080.000',
      (select status = 'delivered' from public.purchase_orders where id = v_po1)
      and (select sum(recognized_amount) = 1080000 from public.supplier_payable_documents where metadata ->> 'purchaseOrderId' = v_po1));
  exception when others then perform pg_temp.ok('3. Phương nhận PO-1', false, jsonb_build_object('lỗi', sqlerrm));
  end;

  begin
    select jsonb_agg(jsonb_build_object('documentId', id, 'amount', recognized_amount)) into v_lines
      from public.supplier_payable_documents where metadata ->> 'purchaseOrderId' = v_po1;
    select id into v_cash from public.cash_funds where is_active limit 1;
    perform pg_temp.claims(c_thuy, '/rpc/save_finance_payment_request_v1');
    execute 'set local role authenticated';
    v := public.save_finance_payment_request_v1(jsonb_build_object('supplierId', c_vendor, 'method', 'cash', 'plannedDate', v_today,
      'lines', v_lines));
    execute 'reset role';
    v_req := (v ->> 'requestId')::uuid;
    perform pg_temp.claims(c_huong, '/rpc/decide_finance_payment_request_v1');
    v_rv := (select row_version::text from public.finance_payment_requests where id = v_req);
    execute 'set local role authenticated';
    perform public.decide_finance_payment_request_v1(jsonb_build_object('requestId', v_req, 'action', 'approve', 'expectedRowVersion', v_rv));
    execute 'reset role';
    perform pg_temp.claims(c_chuan, '/rpc/confirm_finance_payment_request_v1');
    v_rv := (select row_version::text from public.finance_payment_requests where id = v_req);
    execute 'set local role authenticated';
    v := public.confirm_finance_payment_request_v1(jsonb_build_object('requestId', v_req, 'expectedRowVersion', v_rv,
      'paymentDate', v_today, 'documentRef', 'SMOKE-P0-LOCK', 'cashAccountId', v_cash,
      'attachments', jsonb_build_array(jsonb_build_object('name', 'unc.pdf', 'path', 'smoke/unc.pdf'))));
    execute 'reset role';
    v_pb := (v -> 'batches' -> 0 ->> 'batchId')::uuid;
    perform pg_temp.ok('4. Thủy lập ĐNC → Hương duyệt → Chuẩn xác nhận chi: còn nợ 0',
      v_pb is not null and (select sum(outstanding_amount) = 0 from public.supplier_payable_document_balances where metadata ->> 'purchaseOrderId' = v_po1));
  exception when others then perform pg_temp.ok('4. Đề nghị chi → chi', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  select row_version into v_pb_rv from public.supplier_payment_batches where id = v_pb;

  -- ===== Thăm dò cửa sau (audit ca 5 + bổ sung) =====
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/purchase_orders'); execute 'set local role authenticated';
    update public.purchase_orders set items = jsonb_set(items, '{0,unitPrice}', '1'::jsonb), total_amount = 10 where id = v_po1;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho sửa thẳng giá dòng PO đã nhận', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/purchase_order_delivery_batches'); execute 'set local role authenticated';
    update public.purchase_order_delivery_batches set accepted_gross_amount = 999999999 where id = v_b1;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho sửa thẳng giá trị chấp nhận của đợt đã nhận', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/purchase_order_delivery_batches'); execute 'set local role authenticated';
    delete from public.purchase_order_delivery_batches where id = v_b1;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho xóa thẳng đợt giao đã nhận', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/purchase_order_delivery_lines'); execute 'set local role authenticated';
    update public.purchase_order_delivery_lines set accepted_qty = 1, delivery_unit_price = 1 where delivery_batch_id = v_b1;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho sửa thẳng SL / giá dòng đợt giao đã nhận', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/purchase_order_delivery_batches'); execute 'set local role authenticated';
    insert into public.purchase_order_delivery_batches(purchase_order_id, project_id, construction_site_id, delivery_no, status, created_by)
      select id, project_id, construction_site_id, 9, 'planned', c_phuong from public.purchase_orders where id = v_po1;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho thêm thẳng đợt giao vào PO Mua hàng', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;
  begin
    perform pg_temp.claims(c_linh, '/rest/v1/purchase_order_request_lines'); execute 'set local role authenticated';
    delete from public.purchase_order_request_lines where purchase_order_id = v_po1;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Người mua xóa thẳng liên kết đề xuất ↔ PO đã nhận', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rpc/transition_project_purchase_order_status'); execute 'set local role authenticated';
    perform public.transition_project_purchase_order_status(v_po1, 'cancelled', '{}'::jsonb);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho hủy PO Mua hàng đã giao bằng lệnh cũ', sqlerrm, n, 'LOCKED_HUB_PO');
  end;
  begin
    perform pg_temp.claims(c_admin, '/rpc/transition_project_purchase_order_status'); execute 'set local role authenticated';
    perform public.transition_project_purchase_order_status(v_po1, 'draft', '{}'::jsonb);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Admin đưa PO Mua hàng đã giao về nháp bằng lệnh cũ', sqlerrm, n, 'LOCKED_HUB_PO');
  end;
  select po.id into v_nonhub_po from public.purchase_orders po
    where not app_private.procurement_po_is_hub(po.metadata) and po.status = 'delivered' limit 1;
  begin
    perform pg_temp.claims(c_admin, '/rpc/transition_project_purchase_order_status'); execute 'set local role authenticated';
    perform public.transition_project_purchase_order_status(v_nonhub_po, 'cancelled', '{}'::jsonb);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Admin hủy PO cũ (tab Dự án) đã giao bằng lệnh cũ', sqlerrm, n, 'LOCKED_RECEIVED');
  end;
  begin
    perform pg_temp.claims(c_linh, '/rpc/remove_purchase_order_v1'); execute 'set local role authenticated';
    perform public.remove_purchase_order_v1(v_po1);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Người lập xóa PO Mua hàng đã nhận bằng lệnh cũ', sqlerrm, n, 'LOCKED_HUB_PO');
  end;
  begin
    perform pg_temp.claims(c_linh, '/rpc/remove_purchase_order_delivery_batch_v1'); execute 'set local role authenticated';
    perform public.remove_purchase_order_delivery_batch_v1(v_b1);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Người lập xóa đợt giao đã nhận của PO Mua hàng bằng lệnh cũ', sqlerrm, n, 'LOCKED_HUB_PO');
  end;
  select b.id into v_nonhub_batch from public.purchase_order_delivery_batches b join public.purchase_orders po on po.id = b.purchase_order_id
    where not app_private.procurement_po_is_hub(po.metadata) and b.status = 'received' order by b.created_at desc limit 1;
  begin
    perform pg_temp.claims(c_admin, '/rpc/remove_purchase_order_delivery_batch_v1'); execute 'set local role authenticated';
    perform public.remove_purchase_order_delivery_batch_v1(v_nonhub_batch);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Admin xóa đợt giao đã nhận của PO cũ bằng lệnh cũ', sqlerrm, n, 'LOCKED_RECEIVED');
  end;
  begin
    perform pg_temp.claims(c_thuy, '/rpc/reverse_supplier_payment_batch'); execute 'set local role authenticated';
    perform public.reverse_supplier_payment_batch(v_pb, c_thuy);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Kế toán dự án đảo đợt chi của ĐNC đã chi bằng lệnh cũ', sqlerrm, n, 'permission denied');
  end;
  begin
    perform pg_temp.claims(c_thuy, '/rpc/post_supplier_payment_batch'); execute 'set local role authenticated';
    perform public.post_supplier_payment_batch(v_pb, c_thuy);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Kế toán dự án chi tắt bằng lệnh cũ', sqlerrm, n, 'permission denied');
  end;
  begin
    perform pg_temp.claims(c_thuy, '/rpc/reverse_supplier_payment_batch_v2'); execute 'set local role authenticated';
    perform public.reverse_supplier_payment_batch_v2(v_pb, v_pb_rv, gen_random_uuid()::text, 'smoke đảo thử');
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Kế toán dự án đảo đợt chi của ĐNC bằng lệnh Tài chính dự án (_v2)', sqlerrm, n,
    '(LOCKED_FINANCE_PAYMENT|ERP_COMPLETION_PILOT_COMMAND_DISABLED)');
  end;
  -- Lệnh _v2 đang tắt theo thí điểm: gọi thẳng lõi để chắc chốt chặn nằm ở lõi đảo / chi.
  begin
    perform pg_temp.claims(c_thuy, '/rpc/reverse_supplier_payment_batch_v2'); execute 'set local role authenticated';
    perform app_private.command_supplier_payment_v2('payment_reverse', v_pb, v_pb_rv, gen_random_uuid()::text, 'smoke đảo thử');
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Lõi lệnh _v2 đảo đợt chi của ĐNC', sqlerrm, n, 'LOCKED_FINANCE_PAYMENT');
  end;
  begin
    perform pg_temp.claims(c_thuy, '/rpc/save_supplier_payment_batch_draft_v1'); execute 'set local role authenticated';
    perform public.save_supplier_payment_batch_draft_v1(jsonb_build_object('id', v_pb, 'status', 'draft'), '[]'::jsonb, v_pb_rv, c_thuy, gen_random_uuid());
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Kế toán dự án sửa nháp đợt chi của ĐNC bằng lệnh cũ', sqlerrm, n, 'LOCKED_FINANCE_PAYMENT');
  end;
  perform pg_temp.ok('5. Sau các thăm dò: ĐNC vẫn đã chi, đợt chi paid, nợ PO-1 còn 0',
    (select status = 'paid' from public.finance_payment_requests where id = v_req)
    and (select status = 'paid' from public.supplier_payment_batches where id = v_pb)
    and (select sum(outstanding_amount) = 0 from public.supplier_payable_document_balances where metadata ->> 'purchaseOrderId' = v_po1));
  begin
    perform pg_temp.claims(c_phuong, '/rpc/process_transaction_status'); execute 'set local role authenticated';
    perform public.process_transaction_status(v_tx2, 'COMPLETED'::public.transaction_status, c_phuong);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho hoàn tất phiếu nhập PO bằng lệnh kho chung', sqlerrm, n, 'WMS_PO_RECEIPT_COMMAND');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rpc/process_transaction_approval'); execute 'set local role authenticated';
    perform public.process_transaction_approval(v_tx2, 'APPROVED'::public.transaction_status, c_phuong, null, null);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho duyệt phiếu nhập PO bằng lệnh kho chung', sqlerrm, n, 'WMS_PO_RECEIPT_COMMAND');
  end;
  select items into v_items from public.transactions where id = v_tx2;
  begin
    perform pg_temp.claims(c_phuong, '/rpc/update_transaction_items_for_receipt'); execute 'set local role authenticated';
    perform public.update_transaction_items_for_receipt(v_tx2, v_items);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Thủ kho sửa số phiếu nhập PO bằng lệnh kho chung', sqlerrm, n, 'WMS_PO_RECEIPT_COMMAND');
  end;
  begin
    perform pg_temp.claims(c_linh, '/rest/v1/requests'); execute 'set local role authenticated';
    update public.requests set items = jsonb_set(items, '{0,requestQty}', '2'::jsonb) where id = c_mr;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Người mua sửa thẳng SL dòng đề xuất đã đặt 10 → 2', sqlerrm, n, 'LOCKED_MR_LINE_ORDERED');
  end;
  begin
    perform pg_temp.claims(c_linh, '/rest/v1/requests'); execute 'set local role authenticated';
    update public.requests set items = items - 0 where id = c_mr;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Người mua xóa thẳng dòng đề xuất đã đặt', sqlerrm, n, 'LOCKED_MR_LINE_ORDERED');
  end;
  begin
    perform pg_temp.claims(c_linh, '/rpc/transition_project_material_request_status'); execute 'set local role authenticated';
    perform public.transition_project_material_request_status(c_mr, 'DRAFT', 'RETURNED', c_linh::text, null, null, 'smoke', '{}'::jsonb);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Đưa đề xuất chạy quy trình về DRAFT bằng lệnh cũ', sqlerrm, n, 'LOCKED_MR_WORKFLOW');
  end;
  update public.requests set workflow_instance_id = null where id = c_mr;
  begin
    perform pg_temp.claims(c_linh, '/rpc/transition_project_material_request_status'); execute 'set local role authenticated';
    perform public.transition_project_material_request_status(c_mr, 'DRAFT', 'RETURNED', c_linh::text, null, null, 'smoke', '{}'::jsonb);
    n := -1; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Đưa đề xuất (không quy trình) đã có PO về DRAFT bằng lệnh cũ', sqlerrm, n, 'LOCKED_MR_ORDERED');
  end;
  update public.requests set workflow_instance_id = (select workflow_instance_id from public.requests where code = 'MR-2026-9873') where id = c_mr;

  -- Không chặn thừa: sửa ghi chú dòng đề xuất (không đổi vật tư / SL / đơn vị) vẫn ghi được.
  begin
    perform pg_temp.claims(c_linh, '/rest/v1/requests'); execute 'set local role authenticated';
    update public.requests set items = jsonb_set(items, '{0,note}', '"ghi chú smoke"'::jsonb) where id = c_mr;
    get diagnostics n = row_count;
    execute 'reset role';
    perform pg_temp.ok('6. Sửa ghi chú dòng đề xuất đã đặt (không đổi SL) vẫn được', n = 1, jsonb_build_object('rows', n));
  exception when others then perform pg_temp.ok('6. Sửa ghi chú dòng đề xuất đã đặt', false, jsonb_build_object('lỗi', sqlerrm));
  end;

  -- ===== Luồng chuẩn phần 2 sau thăm dò: nhận PO-2 → sửa số nhận → trả hàng giảm trừ =====
  begin
    select jsonb_agg(jsonb_build_object('deliveryLineId', dl.id, 'itemId', dl.item_id,
      'documentedPurchaseQty', dl.planned_qty, 'countedPurchaseQty', dl.planned_qty, 'acceptedPurchaseQty', dl.planned_qty,
      'documentedStockQty', dl.stock_planned_qty, 'countedStockQty', dl.stock_planned_qty, 'acceptedStockQty', dl.stock_planned_qty))
      into v_lines from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = v_b2;
    perform pg_temp.claims(c_phuong, '/rpc/receive_purchase_delivery_v1'); execute 'set local role authenticated';
    perform public.receive_purchase_delivery_v1(v_b2, v_tx2, 'passed', v_lines, '[]'::jsonb);
    execute 'reset role';
    perform pg_temp.ok('7. Phương nhận PO-2 bằng lệnh nhận hàng: công nợ 270.000',
      (select sum(recognized_amount) = 270000 from public.supplier_payable_documents where metadata ->> 'purchaseOrderId' = v_po2));
  exception when others then perform pg_temp.ok('7. Phương nhận PO-2', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    select jsonb_agg(jsonb_build_object('deliveryLineId', dl.id, 'correctQty', 4, 'expectedQty', dl.accepted_qty)) into v_lines
      from public.purchase_order_delivery_lines dl where dl.delivery_batch_id = v_b2;
    perform pg_temp.claims(c_admin, '/rpc/correct_purchase_receipt_v1'); execute 'set local role authenticated';
    perform public.correct_purchase_receipt_v1(jsonb_build_object('deliveryId', v_b2, 'reason', 'Đếm lại thực tế còn 4 (smoke)', 'lines', v_lines));
    execute 'reset role';
    perform pg_temp.ok('8. Admin sửa số nhận nhầm 5 → 4: nợ còn 216.000',
      (select sum(outstanding_amount) = 216000 from public.supplier_payable_document_balances where metadata ->> 'purchaseOrderId' = v_po2),
      (select jsonb_agg(jsonb_build_object('rec', recognized_amount, 'credit', credit_amount, 'out', outstanding_amount)) from public.supplier_payable_document_balances where metadata ->> 'purchaseOrderId' = v_po2));
  exception when others then perform pg_temp.ok('8. Admin sửa số nhận', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    select items -> 0 ->> 'lineId' into v_po2_line from public.purchase_orders where id = v_po2;
    perform pg_temp.claims(c_admin, '/rpc/create_purchase_order_supplier_return_v2'); execute 'set local role authenticated';
    perform public.create_purchase_order_supplier_return_v2(v_po2, c_wh,
      jsonb_build_array(jsonb_build_object('purchaseOrderLineId', v_po2_line, 'quantity', 1)),
      'Hàng lỗi (smoke)', null, 'quality');
    execute 'reset role';
    select id, transaction_id into v_ret, v_ret_tx from public.purchase_order_supplier_returns where purchase_order_id = v_po2 order by created_at desc limit 1;
    perform pg_temp.claims(c_linh, '/rpc/decide_procurement_supplier_return_v1'); execute 'set local role authenticated';
    perform public.decide_procurement_supplier_return_v1(jsonb_build_object('returnId', v_ret, 'resolution', 'credit', 'note', 'smoke'));
    execute 'reset role';
    perform pg_temp.claims(c_admin, '/rpc/process_transaction_status'); execute 'set local role authenticated';
    perform public.process_transaction_status(v_ret_tx, 'COMPLETED'::public.transaction_status, c_admin);
    execute 'reset role';
    set constraints all immediate;
    perform pg_temp.ok('9. Trả NCC 1 cái, giảm trừ, kho xuất trả bằng lệnh kho chung: nợ còn 162.000',
      (select sum(outstanding_amount) = 162000 from public.supplier_payable_document_balances where metadata ->> 'purchaseOrderId' = v_po2),
      (select jsonb_agg(jsonb_build_object('rec', recognized_amount, 'credit', credit_amount, 'out', outstanding_amount)) from public.supplier_payable_document_balances where metadata ->> 'purchaseOrderId' = v_po2));
  exception when others then perform pg_temp.ok('9. Trả hàng giảm trừ', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  perform pg_temp.ok('10. Nhật ký đợt giao: có lưu vết tạo + nhận cho đợt PO-1 và dòng',
    (select count(*) >= 2 from public.audit_trail where table_name = 'purchase_order_delivery_batches' and record_id = v_b1::text)
    and exists (select 1 from public.audit_trail where table_name = 'purchase_order_delivery_lines' and action = 'UPDATE'
                and record_id in (select id::text from public.purchase_order_delivery_lines where delivery_batch_id = v_b1)),
    (select jsonb_agg(jsonb_build_object('action', action, 'label', record_label, 'fields', changed_fields) order by created_at)
     from public.audit_trail where table_name = 'purchase_order_delivery_batches' and record_id = v_b1::text));

  -- ===== Không chặn thừa: PO cũ (không phải Mua hàng) còn nháp vẫn sửa thẳng được như giao diện cũ =====
  begin
    v_legacy_po := gen_random_uuid()::text;
    v_legacy_line := gen_random_uuid()::text;
    perform pg_temp.claims(c_admin, '/rest/v1/purchase_orders'); execute 'set local role authenticated';
    insert into public.purchase_orders(id, po_number, vendor_id, vendor_name, items, total_amount, order_date, status, source_mode, created_by_id, target_warehouse_id)
      values (v_legacy_po, public.next_purchase_order_number_v2(), c_vendor, 'Phúc Hà',
        jsonb_build_array(jsonb_build_object('lineId', v_legacy_line, 'itemId', c_a, 'qty', 3, 'unitPrice', 1000, 'receivedQty', 0)),
        3000, v_today, 'draft', 'company_consolidated', c_admin::text, c_wh);
    update public.purchase_orders set items = jsonb_set(items, '{0,qty}', '4'::jsonb), total_amount = 4000 where id = v_legacy_po;
    v_legacy_b := gen_random_uuid();
    insert into public.purchase_order_delivery_batches(id, purchase_order_id, delivery_no, status, fulfillment_mode, created_by, target_warehouse_id)
      values (v_legacy_b, v_legacy_po, 1, 'planned', 'RECEIVE_TO_STOCK', c_admin, c_wh);
    insert into public.purchase_order_delivery_lines(delivery_batch_id, purchase_order_id, purchase_order_line_id, item_id, planned_qty, unit, stock_planned_qty, stock_unit, delivery_unit_price)
      values (v_legacy_b, v_legacy_po, v_legacy_line, c_a, 4, 'Cái', 4, 'Cái', 1000);
    update public.purchase_order_delivery_batches set planned_delivery_date = current_date + 3 where id = v_legacy_b;
    delete from public.purchase_order_delivery_batches where id = v_legacy_b;
    get diagnostics n = row_count;
    execute 'reset role';
    perform pg_temp.ok('11. PO cũ nháp: thêm, sửa dòng, thêm / dời / xóa đợt kế hoạch bằng ghi thẳng vẫn được', n = 1);
  exception when others then perform pg_temp.ok('11. PO cũ nháp ghi thẳng', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    perform pg_temp.claims(c_admin, '/rest/v1/purchase_orders'); execute 'set local role authenticated';
    update public.purchase_orders set items = jsonb_set(items, '{0,receivedQty}', '4'::jsonb) where id = v_legacy_po;
    get diagnostics n = row_count; raise exception 'PROBE_DONE';
  exception when others then perform pg_temp.probe('Ghi thẳng SL đã nhận vào PO cũ nháp', sqlerrm, n, 'LOCKED_DIRECT_WRITE');
  end;

  set constraints all immediate;
  perform pg_temp.reset_seqs();
exception when others then
  execute 'reset role';
  perform pg_temp.reset_seqs();
  raise;
end $smoke$;

do $$ begin
  if exists (select 1 from _res where not ok) then
    raise exception 'FAIL %', (select string_agg(n || '. ' || step || ' ' || coalesce(detail::text, ''), E'\n' order by n) from _res where not ok);
  end if;
end $$;
select n, ok, step, left(coalesce(detail::text, ''), 120) detail from _res order by n;

rollback;
