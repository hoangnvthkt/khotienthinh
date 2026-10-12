-- Bảng đối soát HĐ NCC: kế toán sửa tiền theo hóa đơn thực tế (NCC làm tròn đơn giá / số lượng lẻ).
-- save_procurement_contract_statement_v1 nhận thêm lines[].amount (tiền hàng theo HĐ) và invoiceVat (tổng VAT theo HĐ).
-- Kiểm soát: chỉ Tài chính — Ghi nhận / Admin; mỗi dòng và cả bảng lệch trong dung sai K3c; lưu metadata.invoiceAdjust + sự kiện.

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
  -- chỉ lệch so với SL × đơn giá trong dung sai hóa đơn K3c (0,5%, tối thiểu 50.000 đ); vượt → sửa đơn giá + lý do.
  select coalesce(sum(accepted_amount), 0), coalesce(sum(vat_amount), 0) into v_cg, v_cv
  from public.supplier_delivery_statement_lines where statement_id = v_id;
  if exists (select 1 from pg_temp.fc_stmt_lines_v2 t join public.supplier_delivery_statement_lines sl
      on sl.statement_id = v_id and sl.delivery_line_id = t.line_id
    where t.inv_amount is not null and abs(t.inv_amount - sl.accepted_amount) > app_private.finance_invoice_tolerance(sl.accepted_amount)) then
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
