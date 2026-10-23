-- Đợt 1b khóa cửa sau (audit 22/10, sau PR #314): đảo bảng đối soát HĐ nguyên tắc + chèn thẳng phiếu kho.
-- Thăm dò lặp lại đúng lỗ hổng — tất cả phải bị chặn — và luồng chuẩn vẫn chạy.
-- Vai thật: Luật (thủ kho SMB, có quyền sửa dự án SMB, không có Tài chính), Tâm (Tài chính — Ghi nhận, không có Xác nhận),
-- Hương (Tài chính — Xác nhận), Thủy (kế toán dự án, người lập + ghi nợ bảng), Phương (thủ kho Kho Xin Hai Vina), Admin.
-- Bảng thử: DCHD-202609-E63391 (1 dòng, 1.080 đ, đã ghi nợ, chưa chi). Ghi thẳng = request.path '/rest/v1/…' + role authenticated.
-- Chạy với migration rỗng (bản gốc Cloud): mọi thăm dò "làm được" = tái hiện lỗ hổng. Số chứng từ (sequence) đặt lại ở cuối. Rollback.
-- node scripts/run-supabase-cloud-transaction.mjs --expected-ref <ref> --migration supabase/migrations/20261028160000_procurement_p0b_statement_reverse_wms_insert_lock.sql --smoke supabase/tests/procurement_p0b_statement_reverse_wms_insert_smoke.sql
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
-- Thăm dò: hành động chạy trong khối con rồi luôn hoàn tác (raise PROBE_DONE). ĐẠT = lỗi đúng mã (regex đầu câu).
-- p_seen: điều thấy được khi hành động làm được (để đọc khi chạy với bản gốc).
create function pg_temp.probe(p_step text, p_error text, p_expect text, p_seen jsonb default null) returns void language sql as $$
  insert into _res(step, ok, detail) values (
    'CHẶN: ' || p_step,
    p_error <> 'PROBE_DONE' and p_error ~ ('^' || p_expect),
    case when p_error = 'PROBE_DONE' then jsonb_build_object('làm_được', coalesce(p_seen, 'true'::jsonb))
      else jsonb_build_object('lỗi', left(p_error, 160)) end
  );
$$;
-- Lệnh đảo: bản sửa (uuid, text: lý do); bản gốc (uuid, uuid: người đảo do client gửi).
create function pg_temp.reverse_stmt(p_statement uuid, p_reason text, p_client_actor uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  if to_regprocedure('public.reverse_supplier_delivery_statement(uuid,text)') is not null then
    execute 'select to_jsonb(public.reverse_supplier_delivery_statement($1, $2))' into v using p_statement, p_reason;
  else
    execute 'select to_jsonb(public.reverse_supplier_delivery_statement($1, $2))' into v using p_statement, p_client_actor;
  end if;
  return v;
end $$;
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
  c_luat constant uuid := 'e9be7010-cbb9-4cf1-9d5a-8ec558ec5d99';
  c_tam constant uuid := 'f1ae09f2-c1be-4763-87cf-202b432ade67';
  c_huong constant uuid := '85b13472-d16c-4025-afac-ee8c8d1bf1f6';
  c_thuy constant uuid := '84353526-7c84-485d-bf3a-5bb1dc5bf5eb';
  c_phuong constant uuid := 'e05c970a-09a5-4f74-9905-70d39fdc7b86';
  c_admin constant uuid := '928d3473-49a2-4427-a319-19729689a084';
  c_wh constant text := 'wh-1782528573176-6lb7z';                     -- Kho Xin Hai Vina (Phương)
  c_item constant text := 'it-1779153359827-571-zrjb9';               -- Bịt PVC 42
  c_stocked_item constant text := 'it-1779153359828-829-ienjc';       -- Thép XD D8 (còn tồn ở Kho Xin Hai Vina)
  c_legacy_batch constant uuid := '12ed5fe0-8e02-4907-a49b-0c53ecd48f4b'; -- PO-490 (PO cũ), đợt kế hoạch chưa có phiếu kho
  c_vendor constant text := '8a0c67b9-2ec3-42a2-a798-75a75749367b';   -- Phúc Hà
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  s public.supplier_delivery_statements%rowtype;
  v_smb_stmt uuid := (select id from public.supplier_delivery_statements where code = 'DCHD-202610-4A23F5'); -- SMB, 21.165.000 đ
  v_line uuid; v_doc uuid; v jsonb; v_rv text; v_req uuid; v_ps uuid; v_credit uuid; v_inv uuid; v_new_stmt uuid; v_new_doc uuid;
  v_reverser uuid; v_tx text; v_hub_po text; v_hub_batch uuid; n numeric;
begin
  -- Mọi câu đọc dữ liệu chạy bằng vai gốc (trước khi đổi vai) để RLS không làm sai đầu vào.
  select * into s from public.supplier_delivery_statements where code = 'DCHD-202609-E63391';
  v_doc := s.payable_document_id;
  select delivery_line_id into v_line from public.supplier_delivery_statement_lines where statement_id = s.id;
  perform pg_temp.ok('0. Bảng thử DCHD-202609-E63391 đã ghi nợ 1.080 đ, chưa chi, chi phí dự án 1.080 đ',
    s.status = 'posted' and (select status = 'open' and recognized_amount = 1080 from public.supplier_payable_documents where id = v_doc)
    and (select sum(amount) = 1080 from public.project_transactions where source_ref like 'supplier_payable_document:' || v_doc || ':recognition%'));

  -- ===== 1. Ai được đảo, người đảo, lý do =====
  begin
    perform pg_temp.claims(c_luat, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(v_smb_stmt, 'Luật đảo', c_huong);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('1a. Thủ kho Luật (quyền sửa dự án SMB, không có Tài chính) đảo bảng SMB 21 tr, ghi người đảo = Hương', sqlerrm,
      'SUPPLIER_STATEMENT_REVERSE_DENIED', jsonb_build_object('reversedBy', v -> 'metadata' ->> 'reversedBy', 'là_Hương', v -> 'metadata' ->> 'reversedBy' = c_huong::text));
  end;
  begin
    perform pg_temp.claims(c_tam, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, 'Tâm đảo', c_tam);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('1b. Tâm (Tài chính — Ghi nhận, không có Xác nhận) đảo bảng', sqlerrm, 'SUPPLIER_STATEMENT_REVERSE_DENIED');
  end;
  begin
    perform pg_temp.claims(c_admin, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, '  ', c_admin);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('1c. Admin đảo không ghi lý do', sqlerrm, 'FINANCE_REASON_REQUIRED');
  end;

  -- ===== 2. Công nợ của bảng đã vào đề nghị chi / chốt giá / cấn trừ / hóa đơn: không đảo được =====
  begin
    perform pg_temp.claims(c_thuy, '/rpc/save_finance_payment_request_v1'); execute 'set local role authenticated';
    v := public.save_finance_payment_request_v1(jsonb_build_object('supplierId', s.supplier_id, 'method', 'cash',
      'plannedDate', to_char(v_today, 'YYYY-MM-DD'), 'lines', jsonb_build_array(jsonb_build_object('documentId', v_doc, 'amount', 1080))));
    execute 'reset role';
    v_req := (v ->> 'requestId')::uuid;
    v_rv := (select row_version::text from public.finance_payment_requests where id = v_req);
    perform pg_temp.claims(c_huong, '/rpc/decide_finance_payment_request_v1'); execute 'set local role authenticated';
    perform public.decide_finance_payment_request_v1(jsonb_build_object('requestId', v_req, 'action', 'approve', 'expectedRowVersion', v_rv));
    perform pg_temp.claims(c_admin, '/rpc/reverse_supplier_delivery_statement');
    v := pg_temp.reverse_stmt(s.id, 'Đảo khi đề nghị chi đã duyệt', c_admin);
    execute 'reset role';
    v := jsonb_build_object('đề_nghị_chi', (select status from public.finance_payment_requests where id = v_req),
      'công_nợ', (select status from public.supplier_payable_documents where id = v_doc));
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('2a. Admin đảo bảng khi đề nghị chi công nợ đó đã duyệt (chờ chi)', sqlerrm, 'FINANCE_DOCUMENT_HAS_PAYMENTS', v);
  end;
  begin
    -- Chốt giá tăng 1.000 → 1.200 đ cho dòng của bảng: sinh chứng từ công nợ tăng + chi phí dự án.
    insert into public.supplier_price_settlements (code, supplier_id, supplier_name_snapshot, basis, agreement_date, reason, delta_gross, increase_gross, created_by)
      values ('CG-SMOKE-P0B', s.supplier_id, s.supplier_name_snapshot, 'agreement', v_today, 'SMOKE chốt giá', 216, 216, c_admin) returning id into v_ps;
    insert into public.supplier_price_settlement_lines (settlement_id, payable_document_id, source_kind, source_line_id, item_name, qty, from_price, to_price, vat_rate, delta_gross)
      values (v_ps, v_doc, 'statement_line', v_line, 'SMOKE', 1, 1000, 1200, 8, 216);
    perform app_private.finance_price_post(v_ps, c_admin);
    perform pg_temp.claims(c_admin, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, 'Đảo khi đã chốt giá', c_admin);
    execute 'reset role';
    v := (select jsonb_build_object('chứng_từ_tăng_vẫn_nợ', jsonb_agg(jsonb_build_object('code', code, 'status', status, 'nợ', outstanding_amount))))
      from public.supplier_payable_document_balances where source_type = 'supplier_price_adjustment' and source_id = v_ps::text;
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('2b. Admin đảo bảng đã chốt giá (chứng từ công nợ tăng còn mở)', sqlerrm, 'SUPPLIER_STATEMENT_REVERSE_SETTLED', v);
  end;
  begin
    -- NCC nợ lại 500 đ cấn trừ vào công nợ của bảng.
    insert into public.supplier_price_settlements (code, supplier_id, supplier_name_snapshot, basis, agreement_date, reason, status, delta_gross, created_by)
      values ('CG-SMOKE-P0B-NCN', s.supplier_id, s.supplier_name_snapshot, 'agreement', v_today, 'SMOKE NCC nợ lại', 'posted', -500, c_admin) returning id into v_ps;
    insert into public.finance_supplier_credits (code, supplier_id, supplier_name_snapshot, project_id, construction_site_id, settlement_id, amount, created_by)
      values ('NCN-SMOKE-P0B', s.supplier_id, s.supplier_name_snapshot, s.project_id, s.construction_site_id, v_ps, 500, c_admin) returning id into v_credit;
    n := app_private.finance_supplier_credit_apply_doc(v_credit, v_doc, c_admin);
    perform pg_temp.claims(c_admin, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, 'Đảo khi đã cấn trừ', c_admin);
    execute 'reset role';
    v := jsonb_build_object('cấn_trừ', n);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('2c. Admin đảo bảng có công nợ đã cấn trừ NCC nợ lại', sqlerrm, 'SUPPLIER_STATEMENT_REVERSE_SETTLED', v);
  end;
  begin
    insert into public.supplier_invoices (supplier_id, supplier_name_snapshot, invoice_number, invoice_date, net_amount, vat_amount, gross_amount, status)
      values (s.supplier_id, s.supplier_name_snapshot, 'HD-SMOKE-P0B', v_today, 1000, 80, 1080, 'posted') returning id into v_inv;
    insert into public.supplier_invoice_payable_links (invoice_id, payable_document_id, allocated_gross_amount, allocated_net_amount, allocated_vat_amount, coverage_mode, project_id, construction_site_id, currency)
      values (v_inv, v_doc, 1080, 1000, 80, 'full', s.project_id, s.construction_site_id, 'VND');
    perform pg_temp.claims(c_admin, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, 'Đảo khi đã gắn hóa đơn', c_admin);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('2d. Admin đảo bảng đã gắn hóa đơn NCC', sqlerrm, 'SUPPLIER_STATEMENT_REVERSE_SETTLED');
  end;

  -- ===== 3. Đảo đúng quyền + lập lại bảng: không nợ / chi phí trùng =====
  -- Bản gốc chỉ cho người có quyền sửa dự án (Hương không có) nên khi chạy với bản gốc dùng Admin để xem chi phí trùng ở bước 3b.
  v_reverser := case when to_regprocedure('public.reverse_supplier_delivery_statement(uuid,text)') is null then c_admin else c_huong end;
  begin
    perform pg_temp.claims(v_reverser, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, 'NCC giao nhầm hóa đơn, lập lại bảng', v_reverser);
    execute 'reset role';
    perform pg_temp.ok('3a. Hương (Tài chính — Xác nhận) đảo kèm lý do: bảng + công nợ đảo, người đảo = Hương, chi phí dự án về 0, dòng giao trả lại',
      (select status = 'reversed' and metadata ->> 'reversedBy' = c_huong::text and metadata ->> 'reverseReason' is not null
         from public.supplier_delivery_statements where id = s.id)
      and (select status = 'reversed' from public.supplier_payable_documents where id = v_doc)
      and (select sum(amount) = 0 and count(*) = 2 and bool_or(amount < 0 and date = v_today::text)
           from public.project_transactions where source_ref like 'supplier_payable_document:' || v_doc || ':recognition%')
      and (select statement_id is null from public.supplier_direct_delivery_lines where id = v_line)
      and exists (select 1 from public.procurement_hub_events where entity_id = 'statement:' || s.id and action = 'statement_reverse' and actor_id = c_huong)
      and exists (select 1 from public.finance_events where entity_id = v_doc::text and action = 'statement_reverse' and actor_id = c_huong),
      jsonb_build_object('bảng', v -> 'metadata', 'chi_phí', (select jsonb_agg(jsonb_build_object('amount', amount, 'date', date, 'ref', source_ref))
        from public.project_transactions where source_ref like 'supplier_payable_document:' || v_doc || ':recognition%')));
  exception when others then perform pg_temp.ok('3a. Hương đảo kèm lý do', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    -- Mua hàng lập lại bảng cho đúng dòng giao (giá HĐ 1.000 đ, VAT 8%), chốt, kế toán ghi nợ.
    perform pg_temp.claims(c_admin, '/rpc/save_procurement_contract_statement_v1'); execute 'set local role authenticated';
    v := public.save_procurement_contract_statement_v1(jsonb_build_object('contractId', s.supplier_contract_id, 'month', to_char(s.period_month, 'YYYY-MM-DD'),
      'lines', jsonb_build_array(jsonb_build_object('deliveryLineId', v_line, 'unitPrice', 1000, 'vatRate', 8, 'reason', 'SMOKE lập lại'))));
    v_new_stmt := (v ->> 'statementId')::uuid;
    perform pg_temp.claims(c_admin, '/rpc/transition_procurement_contract_statement_v1');
    perform public.transition_procurement_contract_statement_v1(jsonb_build_object('statementId', v_new_stmt, 'action', 'confirm'));
    perform pg_temp.claims(c_thuy, '/rpc/transition_procurement_contract_statement_v1');
    perform public.transition_procurement_contract_statement_v1(jsonb_build_object('statementId', v_new_stmt, 'action', 'post'));
    execute 'reset role';
    select payable_document_id into v_new_doc from public.supplier_delivery_statements where id = v_new_stmt;
    perform pg_temp.ok('3b. Lập lại bảng cho dòng đó: công nợ còn mở 1.080 đ, chi phí dự án cộng dồn 1.080 đ (không trùng)',
      (select sum(outstanding_amount) = 1080 from public.supplier_payable_document_balances
        where id in (v_doc, v_new_doc) and status not in ('cancelled', 'reversed'))
      and (select sum(amount) = 1080 from public.project_transactions
        where source_ref like 'supplier_payable_document:' || v_doc || ':recognition%' or source_ref like 'supplier_payable_document:' || v_new_doc || ':recognition%'),
      jsonb_build_object('chi_phí', (select sum(amount) from public.project_transactions
        where source_ref like 'supplier_payable_document:' || v_doc || ':recognition%' or source_ref like 'supplier_payable_document:' || v_new_doc || ':recognition%')));
  exception when others then perform pg_temp.ok('3b. Lập lại bảng', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    perform pg_temp.claims(c_admin, '/rpc/reverse_supplier_delivery_statement'); execute 'set local role authenticated';
    v := pg_temp.reverse_stmt(s.id, 'Đảo lần 2', c_admin);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('3c. Đảo lần hai bảng đã đảo', sqlerrm, 'Chỉ đảo được bảng đối soát đã post');
  end;

  -- ===== 4. Phiếu kho chèn thẳng (REST) =====
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    v_tx := 'tx-smoke-p0b-import';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, created_by, status, note, business_event_type)
      values (v_tx, 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 5, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'COMPLETED', 'SMOKE nhập thẳng', 'proactive_po_receipt');
    execute 'reset role';
    v := jsonb_build_object('sổ_kho_đã_ghi', exists (select 1 from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx));
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('4a. Thủ kho chèn thẳng phiếu nhập COMPLETED mục đích "nhận hàng PO" (kho cộng ngay)', sqlerrm, 'WMS_DIRECT_INSERT_PENDING_ONLY', v);
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    v_tx := 'tx-smoke-p0b-po-completed';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, created_by, status, note, source_type, source_id)
      values (v_tx, 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 5, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'COMPLETED', 'SMOKE nhập PO thẳng', 'po_delivery_batch', c_legacy_batch::text);
    execute 'reset role';
    v := jsonb_build_object('sổ_kho_đã_ghi', exists (select 1 from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx),
      'đợt_vẫn', (select status from public.purchase_order_delivery_batches where id = c_legacy_batch));
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('4b. Thủ kho chèn thẳng phiếu nhập COMPLETED gắn đợt giao PO', sqlerrm, 'WMS_DIRECT_INSERT_PENDING_ONLY', v);
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    v_tx := 'tx-smoke-p0b-export';
    insert into public.transactions (id, type, date, items, source_warehouse_id, requester_id, created_by, status, note, business_event_type)
      values (v_tx, 'EXPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_stocked_item, 'quantity', 1, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'COMPLETED', 'SMOKE xuất thẳng', 'construction_issue');
    execute 'reset role';
    v := jsonb_build_object('sổ_kho_đã_ghi', exists (select 1 from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx));
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('4c. Thủ kho chèn thẳng phiếu xuất COMPLETED', sqlerrm, 'WMS_DIRECT_INSERT_PENDING_ONLY', v);
  end;
  -- Đợt giao kế hoạch của PO Mua hàng chưa có phiếu kho (dựng bằng vai gốc).
  v_hub_po := 'smoke-p0b-hub-po';
  insert into public.purchase_orders (id, po_number, vendor_id, vendor_name, items, total_amount, order_date, status, source_mode, created_by_id, target_warehouse_id, metadata)
    values (v_hub_po, public.next_purchase_order_number_v2(), c_vendor, 'Phúc Hà', '[]'::jsonb, 0, v_today::text, 'confirmed', 'company_consolidated', c_admin::text, c_wh,
      jsonb_build_object('channel', 'procurement_hub'));
  v_hub_batch := gen_random_uuid();
  insert into public.purchase_order_delivery_batches (id, purchase_order_id, delivery_no, status, fulfillment_mode, created_by, target_warehouse_id)
    values (v_hub_batch, v_hub_po, 1, 'planned', 'RECEIVE_TO_STOCK', c_admin, c_wh);
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, created_by, status, note, source_type, source_id)
      values ('tx-smoke-p0b-hub-pending', 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 5, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'PENDING', 'SMOKE phiếu chờ gắn đợt PO Mua hàng', 'po_delivery_batch', v_hub_batch::text);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('4d. Thủ kho chèn thẳng phiếu nhập Chờ gắn đợt giao của PO Mua hàng', sqlerrm, 'WMS_PO_RECEIPT_COMMAND_ONLY');
  end;
  begin
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, created_by, status, note, source_type, source_id)
      values ('tx-smoke-p0b-ghost-pending', 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 5, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'PENDING', 'SMOKE phiếu chờ gắn đợt không có', 'po_delivery_batch', gen_random_uuid()::text);
    raise exception 'PROBE_DONE';
  exception when others then
    perform pg_temp.probe('4e. Thủ kho chèn thẳng phiếu nhập Chờ gắn mã đợt giao không có', sqlerrm, 'WMS_PO_RECEIPT_COMMAND_ONLY');
  end;

  -- Không chặn thừa: luồng giao diện hiện có.
  begin
    -- Như màn Nhập kho: chèn phiếu Chờ rồi hoàn tất bằng lệnh kho.
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    v_tx := 'tx-smoke-p0b-import-pending';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, created_by, status, note, business_event_type, business_event_reason)
      values (v_tx, 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 2, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'PENDING', 'SMOKE nhập chờ', 'direct_manual_receipt', 'SMOKE nhập tay');
    perform pg_temp.claims(c_admin, '/rpc/process_transaction_status');
    perform public.process_transaction_status(v_tx, 'COMPLETED'::public.transaction_status, c_admin);
    execute 'reset role';
    perform pg_temp.ok('5a. Thủ kho chèn phiếu nhập Chờ, hoàn tất bằng lệnh kho: sổ kho ghi',
      exists (select 1 from public.inventory_transactions where source_type = 'wms_transaction' and source_id = v_tx));
  exception when others then perform pg_temp.ok('5a. Phiếu nhập Chờ + lệnh kho', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    -- Như Kiểm kê / Điều chỉnh / Chốt đầu kỳ: phiếu điều chỉnh tạo thẳng ở trạng thái Hoàn tất.
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    v_tx := 'tx-smoke-p0b-adjustment';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, approver_id, created_by, status, note, business_event_type, business_event_reason)
      values (v_tx, 'ADJUSTMENT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 1, 'price', 1000)),
        c_wh, c_phuong, c_phuong, c_phuong, 'COMPLETED', 'SMOKE điều chỉnh', 'inventory_adjustment', 'SMOKE kiểm kê');
    execute 'reset role';
    perform pg_temp.ok('5b. Thủ kho chèn thẳng phiếu điều chỉnh Hoàn tất vẫn được (như trước)',
      exists (select 1 from public.transactions where id = v_tx));
  exception when others then perform pg_temp.ok('5b. Phiếu điều chỉnh', false, jsonb_build_object('lỗi', sqlerrm));
  end;
  begin
    -- Như tab Dự án (PO cũ): đợt kế hoạch chưa có phiếu kho → chèn phiếu nhập Chờ gắn đợt.
    perform pg_temp.claims(c_phuong, '/rest/v1/transactions'); execute 'set local role authenticated';
    v_tx := 'tx-smoke-p0b-legacy-pending';
    insert into public.transactions (id, type, date, items, target_warehouse_id, requester_id, created_by, status, note, source_type, source_id)
      values (v_tx, 'IMPORT', now(), jsonb_build_array(jsonb_build_object('itemId', c_item, 'quantity', 1, 'price', 1000)),
        c_wh, c_phuong, c_phuong, 'PENDING', 'SMOKE PO cũ đang giao', 'po_delivery_batch', c_legacy_batch::text);
    execute 'reset role';
    perform pg_temp.ok('5c. Phiếu nhập Chờ gắn đợt kế hoạch của PO cũ vẫn tạo được (luồng tab Dự án)',
      exists (select 1 from public.transactions where id = v_tx));
  exception when others then perform pg_temp.ok('5c. Phiếu Chờ gắn đợt PO cũ', false, jsonb_build_object('lỗi', sqlerrm));
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
select n, ok, step, left(coalesce(detail::text, ''), 160) detail from _res order by n;

rollback;
