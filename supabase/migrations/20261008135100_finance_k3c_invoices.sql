-- ===========================================================================
-- K3c — Hóa đơn đầu vào NCC + khớp 3 bên (06/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md (quyết định 8, tình huống 5, 6, 12) — chủ SP duyệt 01/10:
--  * Không bắt buộc hóa đơn trước khi chi; HĐ NCC có cờ "bắt buộc hóa đơn trước khi chi" → đề nghị chi bị chặn nếu chứng từ chưa có hóa đơn.
--  * Khớp 3 bên: đơn mua → nhận hàng (chứng từ công nợ theo giá đơn) → hóa đơn. Dung sai 0,5% hoặc 50.000 đ (lấy số lớn hơn).
--    Trong dung sai: ghi ngay, phần lệch tự điều chỉnh công nợ + chi phí dự án. Vượt dung sai: bắt lý do + chứng từ, người khác duyệt mới ghi.
--  * Hóa đơn đến trước hàng: ghi ở trạng thái "chờ hàng", chưa thành công nợ; khớp khi kho nhận.
--  * Tách tiền hàng / VAT trên hóa đơn. Đảo hóa đơn (Xác nhận, có lý do) gỡ điều chỉnh nếu chưa trả.
-- Dùng lại bảng supplier_invoices / supplier_invoice_payable_links (0 dòng); khoá các hàm ghi hóa đơn kiểu cũ (tab Tài chính dự án đã gỡ).
-- ===========================================================================

alter table public.supplier_invoices drop constraint if exists supplier_invoices_status_check;
alter table public.supplier_invoices drop constraint if exists supplier_invoices_check;
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.supplier_invoices'::regclass and contype = 'c'
    and (pg_get_constraintdef(oid) like '%status%') loop
    execute format('alter table public.supplier_invoices drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.supplier_invoices
  add column invoice_symbol text,
  add column vat_percent numeric(5, 2),
  add column expected_amount numeric(18, 2),
  add column variance_amount numeric(18, 2),
  add column tolerance_amount numeric(18, 2),
  add column adjustment_document_id uuid references public.supplier_payable_documents(id),
  add column decided_by uuid references public.users(id),
  add column decided_at timestamptz,
  add column decision_note text,
  add column source text not null default 'manual' check (source in ('manual', 'xml')),
  add constraint supplier_invoices_status_k3c check (status in ('awaiting_goods', 'pending_approval', 'posted', 'rejected', 'reversed')),
  add constraint supplier_invoices_reversal_k3c check (status <> 'reversed' or (reversed_at is not null and reversed_by is not null and nullif(btrim(reversal_reason), '') is not null));
alter table public.supplier_invoices alter column status set default 'posted';
-- Số hóa đơn trùng chỉ chặn với hóa đơn còn hiệu lực (đã đảo / trả lại thì ghi lại được).
drop index if exists public.uq_supplier_invoice_header_number;
create unique index uq_supplier_invoice_header_number on public.supplier_invoices (supplier_id, lower(btrim(coalesce(invoice_symbol, ''))), lower(btrim(invoice_number)))
  where status not in ('reversed', 'rejected');

-- Chỉ đọc qua quyền Tài chính; mọi ghi qua hàm (bỏ chính sách cũ cho ghi thẳng theo phạm vi dự án).
drop policy if exists supplier_invoices_access_v2 on public.supplier_invoices;
drop policy if exists supplier_invoice_links_access_v2 on public.supplier_invoice_payable_links;
create policy supplier_invoices_finance_select on public.supplier_invoices for select to authenticated using (app_private.finance_can('view'));
create policy supplier_invoice_links_finance_select on public.supplier_invoice_payable_links for select to authenticated using (app_private.finance_can('view'));
revoke execute on function public.record_supplier_invoice_reconciliation_v2(jsonb, jsonb, uuid) from authenticated;
revoke execute on function public.record_supplier_invoice_reconciliation_v3(jsonb, jsonb, jsonb, text) from authenticated;
revoke execute on function public.reverse_supplier_invoice_v1(uuid, bigint, text, text) from authenticated;

-- Phần chứng từ công nợ còn chưa có hóa đơn (theo giá trị ghi nợ, trừ phần đã gắn vào hóa đơn còn hiệu lực).
create function app_private.finance_doc_invoiced(p_doc uuid, p_exclude uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(k.allocated_gross_amount), 0) from public.supplier_invoice_payable_links k join public.supplier_invoices i on i.id = k.invoice_id
  where k.payable_document_id = p_doc and i.status in ('posted', 'pending_approval') and i.id is distinct from p_exclude;
$$;
create function app_private.finance_invoice_tolerance(p_expected numeric)
returns numeric language sql immutable set search_path = '' as $$ select greatest(round(abs(coalesce(p_expected, 0)) * 0.005, 2), 50000::numeric) $$;

-- Ghi điều chỉnh công nợ + chi phí cho phần lệch của hóa đơn đã duyệt / trong dung sai.
-- Lệch dương: chứng từ "điều chỉnh theo hóa đơn" (tăng nợ). Lệch âm: giảm trừ vào các chứng từ đã gắn (tăng credit), không vượt số còn nợ.
create function app_private.finance_invoice_post_variance(p_invoice uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.supplier_invoices%rowtype; v numeric; k record; v_left numeric; v_take numeric; v_doc uuid; v_main record; v_name text;
begin
  select * into i from public.supplier_invoices where id = p_invoice for update;
  v := coalesce(i.variance_amount, 0);
  if abs(v) < 0.5 then return; end if;
  select d.project_id, d.construction_site_id, d.supplier_contract_id, d.supplier_contract_code into v_main
  from public.supplier_invoice_payable_links l join public.supplier_payable_documents d on d.id = l.payable_document_id
  where l.invoice_id = i.id order by l.allocated_gross_amount desc limit 1;
  if v > 0 then
    insert into public.supplier_payable_documents (code, source_type, source_id, project_id, construction_site_id, supplier_id, supplier_name_snapshot,
      document_no, document_date, committed_amount, recognized_amount, status, invoice_number, invoice_date, supplier_contract_id, supplier_contract_code, metadata, created_by)
    values ('AP-HD-' || to_char(coalesce(i.invoice_date, current_date), 'YYYYMM') || '-' || upper(left(replace(i.id::text, '-', ''), 6)), 'supplier_invoice_adjustment', i.id::text,
      v_main.project_id, v_main.construction_site_id, i.supplier_id, i.supplier_name_snapshot, 'Chênh lệch HĐ ' || i.invoice_number, coalesce(i.invoice_date, current_date),
      v, v, 'open', i.invoice_number, i.invoice_date, v_main.supplier_contract_id, v_main.supplier_contract_code,
      jsonb_build_object('origin', 'invoice_variance', 'invoiceId', i.id, 'scope', case when v_main.project_id is null and v_main.construction_site_id is null then 'company' end),
      p_actor)
    returning id into v_doc;
    update public.supplier_invoices set adjustment_document_id = v_doc where id = i.id;
  else
    v_left := -v;
    for k in select l.payable_document_id doc, l.allocated_gross_amount amt, b.outstanding_amount out
      from public.supplier_invoice_payable_links l join public.supplier_payable_document_balances b on b.id = l.payable_document_id
      where l.invoice_id = i.id order by b.outstanding_amount desc loop
      exit when v_left <= 0.005;
      v_take := least(v_left, greatest(k.out - app_private.finance_doc_reserved(k.doc, null), 0));
      continue when v_take <= 0.005;
      update public.supplier_payable_documents set credit_amount = credit_amount + v_take, updated_at = now() where id = k.doc;
      update public.supplier_invoice_payable_links set variance_amount = -v_take where invoice_id = i.id and payable_document_id = k.doc;
      v_left := v_left - v_take;
    end loop;
    if v_left > 0.5 then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_CREDIT_OVER',
      detail = 'Hóa đơn thấp hơn công nợ ' || round(-v) || ' đ nhưng chỉ còn ' || round(-v - v_left) || ' đ chưa trả / chưa đề nghị chi'; end if;
  end if;
  if v_main.project_id is not null then
    perform app_private.finance_insert_project_cost(v_main.project_id, v, 'Chênh lệch hóa đơn NCC ' || i.supplier_name_snapshot || ' · ' || i.invoice_number,
      coalesce(i.invoice_date, current_date)::text, 'supplier_invoice_adjustment:' || i.id, p_actor::text);
  end if;
end $$;

create function app_private.finance_invoice_unpost_variance(p_invoice uuid, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.supplier_invoices%rowtype; d record; k record; v_proj text;
begin
  select * into i from public.supplier_invoices where id = p_invoice for update;
  if abs(coalesce(i.variance_amount, 0)) < 0.5 then return; end if;
  if i.adjustment_document_id is not null then
    select b.* into d from public.supplier_payable_document_balances b where b.id = i.adjustment_document_id;
    if coalesce(d.paid_amount, 0) > 0.5 or app_private.finance_doc_reserved(i.adjustment_document_id, null) > 0.5 then
      raise exception using errcode = '22023', message = 'FINANCE_INVOICE_ADJUSTMENT_PAID'; end if;
    v_proj := d.project_id;
    update public.supplier_payable_documents set status = 'cancelled', updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancelReason', p_reason) where id = i.adjustment_document_id;
  else
    for k in select l.payable_document_id doc, l.variance_amount va from public.supplier_invoice_payable_links l where l.invoice_id = i.id and coalesce(l.variance_amount, 0) < 0 loop
      update public.supplier_payable_documents set credit_amount = greatest(credit_amount + k.va, 0), updated_at = now() where id = k.doc;
      update public.supplier_invoice_payable_links set variance_amount = 0 where invoice_id = i.id and payable_document_id = k.doc;
    end loop;
    select d2.project_id into v_proj from public.supplier_invoice_payable_links l join public.supplier_payable_documents d2 on d2.id = l.payable_document_id
    where l.invoice_id = i.id order by l.allocated_gross_amount desc limit 1;
  end if;
  if v_proj is not null and exists (select 1 from public.project_transactions where source_ref = 'supplier_invoice_adjustment:' || i.id) then
    perform app_private.finance_insert_project_cost(v_proj, -i.variance_amount, 'Đảo chênh lệch hóa đơn ' || i.invoice_number || ' — ' || p_reason,
      (now() at time zone 'Asia/Ho_Chi_Minh')::date::text, 'supplier_invoice_adjustment:' || i.id || ':reversal', p_actor::text);
  end if;
end $$;

-- Lưu hóa đơn (thêm mới, hoặc sửa hóa đơn "chờ hàng" / "chờ duyệt" của chính mình): tính khớp, quyết định trạng thái.
create function public.save_finance_invoice_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_id uuid := nullif(p_input->>'id', '')::uuid; o public.supplier_invoices%rowtype;
  v_sup text := nullif(p_input->>'supplierId', ''); v_name text; v_no text := nullif(btrim(p_input->>'invoiceNumber'), ''); v_date date := nullif(p_input->>'invoiceDate', '')::date;
  v_net numeric := round(coalesce(nullif(p_input->>'netAmount', '')::numeric, 0), 2); v_vat numeric := round(coalesce(nullif(p_input->>'vatAmount', '')::numeric, 0), 2);
  v_gross numeric := round(coalesce(nullif(p_input->>'grossAmount', '')::numeric, 0), 2); v_lines jsonb := coalesce(p_input->'lines', '[]'::jsonb);
  v_reason text := nullif(btrim(p_input->>'reason'), ''); a jsonb; d record; v_amt numeric; v_exp numeric := 0; v_var numeric; v_tol numeric; v_status text;
  v_seen uuid[] := '{}'; v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if not app_private.finance_can('record') then raise exception using errcode = '42501', message = 'FINANCE_RECORD_DENIED'; end if;
  if v_id is not null then
    select * into o from public.supplier_invoices where id = v_id for update;
    if not found or o.status not in ('awaiting_goods', 'pending_approval') then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_STATE'; end if;
    if o.status = 'pending_approval' and o.created_by is distinct from v_actor then raise exception using errcode = '42501', message = 'FINANCE_INVOICE_NOT_OWNER'; end if;
    if (p_input->>'expectedRowVersion')::bigint is distinct from o.row_version then raise exception using errcode = '40001', message = 'FINANCE_STALE'; end if;
    v_sup := o.supplier_id;
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
  -- Kiểm từng chứng từ công nợ được gắn: cùng NCC, còn hiệu lực, không vượt phần chưa có hóa đơn.
  for a in select value from jsonb_array_elements(v_lines) loop
    v_amt := round(nullif(a->>'amount', '')::numeric, 2);
    select r.* into d from app_private.finance_payable_rows() r where r.id = nullif(a->>'documentId', '')::uuid;
    if not found or d.supplier_id is distinct from v_sup or d.status in ('cancelled', 'reversed', 'draft')
      or d.source_type in ('supplier_invoice_adjustment', 'subcontract_round', 'subcontract_retention', 'subcontract_opening') then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if d.id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
    v_seen := v_seen || d.id;
    if v_amt is null or v_amt <= 0 or v_amt > d.recognized - app_private.finance_doc_invoiced(d.id, v_id) + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_INVOICE_OVER_DOCUMENT', detail = coalesce(d.document_no, d.code); end if;
    v_exp := v_exp + v_amt;
  end loop;
  if jsonb_array_length(v_lines) = 0 then v_status := 'awaiting_goods'; v_var := null; v_tol := null;
  else
    v_var := round(v_gross - v_exp, 2); v_tol := app_private.finance_invoice_tolerance(v_exp);
    if abs(v_var) <= v_tol then v_status := 'posted';
    else
      if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_VARIANCE_REASON'; end if;
      v_status := 'pending_approval';
    end if;
  end if;
  if v_id is null then
    insert into public.supplier_invoices (supplier_id, supplier_name_snapshot, invoice_number, invoice_symbol, invoice_date, net_amount, vat_amount, gross_amount, vat_percent,
      variance_reason, attachments, created_by, currency, status, expected_amount, variance_amount, tolerance_amount, source)
    values (v_sup, v_name, v_no, nullif(btrim(p_input->>'invoiceSymbol'), ''), v_date, v_net, v_vat, v_gross, nullif(p_input->>'vatPercent', '')::numeric,
      v_reason, p_input->'attachments', v_actor, 'VND', v_status, case when v_status <> 'awaiting_goods' then v_exp end, v_var, v_tol,
      case when p_input->>'source' = 'xml' then 'xml' else 'manual' end)
    returning id into v_id;
  else
    delete from public.supplier_invoice_payable_links where invoice_id = v_id;
    update public.supplier_invoices set invoice_number = v_no, invoice_symbol = nullif(btrim(p_input->>'invoiceSymbol'), ''), invoice_date = v_date,
      net_amount = v_net, vat_amount = v_vat, gross_amount = v_gross, vat_percent = nullif(p_input->>'vatPercent', '')::numeric, variance_reason = v_reason,
      attachments = p_input->'attachments', status = v_status, expected_amount = case when v_status <> 'awaiting_goods' then v_exp end,
      variance_amount = v_var, tolerance_amount = v_tol, updated_at = now() where id = v_id;
  end if;
  for a in select value from jsonb_array_elements(v_lines) loop
    insert into public.supplier_invoice_payable_links (invoice_id, payable_document_id, allocated_gross_amount)
    values (v_id, (a->>'documentId')::uuid, round((a->>'amount')::numeric, 2));
  end loop;
  if v_status = 'posted' then
    perform app_private.finance_invoice_post_variance(v_id, v_actor);
    update public.supplier_payable_documents pd set invoice_number = coalesce(pd.invoice_number, v_no), invoice_date = coalesce(pd.invoice_date, v_date), updated_at = now()
    where pd.id in (select payable_document_id from public.supplier_invoice_payable_links where invoice_id = v_id);
  end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('supplier_invoice', v_id::text, v_sup, 'invoice_' || v_status, v_actor, v_reason,
    jsonb_build_object('number', v_no, 'gross', v_gross, 'expected', v_exp, 'variance', v_var, 'tolerance', v_tol, 'documents', jsonb_array_length(v_lines)));
  return jsonb_build_object('id', v_id, 'status', v_status, 'expected', v_exp, 'variance', v_var, 'tolerance', v_tol);
end $$;

-- Duyệt / trả lại hóa đơn lệch vượt dung sai (người khác người lập, quyền Xác nhận); đảo hóa đơn đã ghi (Xác nhận, lý do).
create function public.decide_finance_invoice_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); i public.supplier_invoices%rowtype; v_action text := p_input->>'action'; v_reason text := nullif(btrim(p_input->>'reason'), '');
begin
  if not app_private.finance_can('confirm') then raise exception using errcode = '42501', message = 'FINANCE_CONFIRM_DENIED'; end if;
  select * into i from public.supplier_invoices where id = nullif(p_input->>'id', '')::uuid for update;
  if not found then raise exception using errcode = 'PT404', message = 'FINANCE_INVOICE_NOT_FOUND'; end if;
  if (p_input->>'expectedRowVersion')::bigint is distinct from i.row_version then raise exception using errcode = '40001', message = 'FINANCE_STALE'; end if;
  if v_action in ('approve', 'reject') then
    if i.status <> 'pending_approval' then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_STATE'; end if;
    if i.created_by = v_actor then raise exception using errcode = '42501', message = 'FINANCE_SAME_PERSON'; end if;
    if v_action = 'reject' and v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    update public.supplier_invoices set status = case when v_action = 'approve' then 'posted' else 'rejected' end, decided_by = v_actor, decided_at = now(),
      decision_note = v_reason, updated_at = now() where id = i.id;
    if v_action = 'approve' then
      perform app_private.finance_invoice_post_variance(i.id, v_actor);
      update public.supplier_payable_documents pd set invoice_number = coalesce(pd.invoice_number, i.invoice_number), invoice_date = coalesce(pd.invoice_date, i.invoice_date), updated_at = now()
      where pd.id in (select payable_document_id from public.supplier_invoice_payable_links where invoice_id = i.id);
    end if;
  elsif v_action = 'reverse' then
    if i.status not in ('posted', 'awaiting_goods') then raise exception using errcode = '22023', message = 'FINANCE_INVOICE_STATE'; end if;
    if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
    if i.status = 'posted' then perform app_private.finance_invoice_unpost_variance(i.id, v_actor, v_reason); end if;
    update public.supplier_payable_documents pd set invoice_number = null, invoice_date = null, updated_at = now()
    where pd.id in (select payable_document_id from public.supplier_invoice_payable_links where invoice_id = i.id) and pd.invoice_number = i.invoice_number;
    update public.supplier_invoices set status = 'reversed', reversed_at = now(), reversed_by = v_actor, reversal_reason = v_reason, updated_at = now() where id = i.id;
  else raise exception using errcode = '22023', message = 'FINANCE_ACTION_INVALID'; end if;
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  values ('supplier_invoice', i.id::text, i.supplier_id, 'invoice_' || v_action, v_actor, v_reason, jsonb_build_object('number', i.invoice_number, 'variance', i.variance_amount));
  return jsonb_build_object('id', i.id, 'action', v_action);
end $$;

-- Danh sách hóa đơn + chứng từ chưa có hóa đơn; p_filter.supplierId → thêm chứng từ của NCC đó để gắn vào hóa đơn.
create function public.get_finance_invoices_v1(p_filter jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_sup text := nullif(p_filter->>'supplierId', ''); v_uid uuid := public.current_app_user_id();
begin
  if not app_private.finance_can('view') then raise exception using errcode = '42501', message = 'FINANCE_VIEW_DENIED'; end if;
  return jsonb_build_object(
    'can', jsonb_build_object('record', app_private.finance_can('record'), 'confirm', app_private.finance_can('confirm')),
    'tolerance', jsonb_build_object('percent', 0.5, 'min', 50000),
    'counts', jsonb_build_object(
      'pendingApproval', (select count(*) from public.supplier_invoices where status = 'pending_approval'),
      'awaitingGoods', (select count(*) from public.supplier_invoices where status = 'awaiting_goods'),
      'posted', (select count(*) from public.supplier_invoices where status = 'posted'),
      'docsWithout', (select count(*) from app_private.finance_payable_rows() r where not r.internal and r.status not in ('cancelled', 'reversed', 'draft')
        and r.source_type in ('purchase_delivery_receipt', 'supplier_delivery_statement', 'direct_supplier_receipt', 'site_direct_purchase')
        and r.recognized - app_private.finance_doc_invoiced(r.id, null) > 0.5),
      'docsWithoutAmount', (select coalesce(sum(r.recognized - app_private.finance_doc_invoiced(r.id, null)), 0) from app_private.finance_payable_rows() r
        where not r.internal and r.status not in ('cancelled', 'reversed', 'draft')
        and r.source_type in ('purchase_delivery_receipt', 'supplier_delivery_statement', 'direct_supplier_receipt', 'site_direct_purchase')
        and r.recognized - app_private.finance_doc_invoiced(r.id, null) > 0.5),
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
        'canDecide', i.status = 'pending_approval' and app_private.finance_can('confirm') and i.created_by is distinct from v_uid,
        'canEdit', (i.status = 'awaiting_goods' or (i.status = 'pending_approval' and i.created_by = v_uid)) and app_private.finance_can('record'),
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'documentNo', d.document_no, 'projectCode', p.code,
            'amount', l.allocated_gross_amount, 'recognized', d.recognized_amount, 'variance', l.variance_amount, 'sourceType', d.source_type) order by d.document_date)
          from public.supplier_invoice_payable_links l join public.supplier_payable_documents d on d.id = l.payable_document_id left join public.projects p on p.id = d.project_id
          where l.invoice_id = i.id), '[]'::jsonb))
        order by case i.status when 'pending_approval' then 0 when 'awaiting_goods' then 1 else 2 end, i.invoice_date desc, i.created_at desc)
      from public.supplier_invoices i where (v_sup is null or i.supplier_id = v_sup) and (i.status <> 'reversed' or coalesce((p_filter->>'withReversed')::boolean, false))), '[]'::jsonb),
    'documents', case when v_sup is not null then coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'documentNo', r.document_no, 'sourceType', r.source_type,
        'projectCode', r.project_code, 'contractCode', r.contract_code, 'documentDate', r.document_date, 'recognized', r.recognized, 'outstanding', r.outstanding,
        'invoiced', app_private.finance_doc_invoiced(r.id, null), 'remaining', r.recognized - app_private.finance_doc_invoiced(r.id, null),
        'requireInvoice', coalesce((select sc.require_invoice_before_payment from public.supplier_contracts sc where sc.id = r.contract_id), false),
        'poNumber', case when r.source_type = 'purchase_delivery_receipt' then (select po.po_number from public.purchase_order_delivery_batches b
          join public.purchase_orders po on po.id = b.purchase_order_id where b.id::text = r.source_id) end) order by r.document_date, r.document_no)
      from app_private.finance_payable_rows() r where r.supplier_id = v_sup and r.status not in ('cancelled', 'reversed', 'draft')
        and r.source_type not in ('supplier_invoice_adjustment', 'subcontract_round', 'subcontract_retention', 'subcontract_opening')
        and r.recognized - app_private.finance_doc_invoiced(r.id, null) > 0.5), '[]'::jsonb) end,
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', x.supplier_id, 'name', x.name, 'taxCode', x.tax_code, 'docs', x.n, 'remaining', x.rem) order by x.name)
      from (select r.supplier_id, max(r.supplier_name) name, (select bp.tax_code from public.business_partners bp where bp.id = r.supplier_id) tax_code, count(*) n,
          sum(r.recognized - app_private.finance_doc_invoiced(r.id, null)) rem
        from app_private.finance_payable_rows() r where not r.internal and r.status not in ('cancelled', 'reversed', 'draft')
          and r.source_type not in ('supplier_invoice_adjustment', 'subcontract_round', 'subcontract_retention', 'subcontract_opening')
          and r.recognized - app_private.finance_doc_invoiced(r.id, null) > 0.5 group by r.supplier_id) x), '[]'::jsonb));
end $$;

-- Tìm NCC theo mã số thuế (đọc file XML hóa đơn điện tử).
create function public.find_finance_supplier_by_tax_v1(p_tax text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when app_private.finance_can('record') then coalesce((select jsonb_agg(jsonb_build_object('id', bp.id, 'name', bp.name, 'taxCode', bp.tax_code))
    from public.business_partners bp where regexp_replace(coalesce(bp.tax_code, ''), '\D', '', 'g') = regexp_replace(coalesce(p_tax, ''), '\D', '', 'g')
      and length(regexp_replace(coalesce(p_tax, ''), '\D', '', 'g')) >= 10), '[]'::jsonb) end;
$$;

revoke all on function app_private.finance_doc_invoiced(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.finance_invoice_tolerance(numeric) from public, anon, authenticated;
revoke all on function app_private.finance_invoice_post_variance(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.finance_invoice_unpost_variance(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_finance_invoice_v1(jsonb) from public, anon;
revoke all on function public.decide_finance_invoice_v1(jsonb) from public, anon;
revoke all on function public.get_finance_invoices_v1(jsonb) from public, anon;
revoke all on function public.find_finance_supplier_by_tax_v1(text) from public, anon;
grant execute on function public.save_finance_invoice_v1(jsonb) to authenticated;
grant execute on function public.decide_finance_invoice_v1(jsonb) to authenticated;
grant execute on function public.get_finance_invoices_v1(jsonb) to authenticated;
grant execute on function public.find_finance_supplier_by_tax_v1(text) to authenticated;

-- Vá: HĐ NCC "bắt buộc hóa đơn trước khi chi" → chứng từ chưa có hóa đơn đã ghi thì không lập đề nghị chi được.
CREATE OR REPLACE FUNCTION app_private.finance_check_request_lines(p_supplier text, p_lines jsonb, p_exclude uuid)
 RETURNS TABLE(doc_id uuid, amount numeric, project_id text, site_id text, document_no text, outstanding numeric, source_type text, source_id text, recognized numeric, paid numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a jsonb; d record; v_amount numeric; v_seen uuid[] := '{}';
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception using errcode = '22023', message = 'FINANCE_ALLOCATIONS_REQUIRED'; end if;
  for a in select value from jsonb_array_elements(p_lines) loop
    v_amount := round(nullif(a->>'amount', '')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception using errcode = '22023', message = 'FINANCE_AMOUNT_INVALID'; end if;
    select r.* into d from app_private.finance_payable_rows() r where r.id = (a->>'documentId')::uuid;
    if not found or d.supplier_id is distinct from p_supplier or d.status not in ('open', 'partial') then
      raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
    if d.source_type = 'subcontract_retention' and (d.due_date is null or d.due_date > (now() at time zone 'Asia/Ho_Chi_Minh')::date) then
      raise exception using errcode = '22023', message = 'FINANCE_RETENTION_NOT_DUE'; end if;
    if d.contract_id is not null and exists (select 1 from public.supplier_contracts sc where sc.id = d.contract_id and sc.require_invoice_before_payment)
      and not exists (select 1 from public.supplier_invoice_payable_links k join public.supplier_invoices i on i.id = k.invoice_id
        where k.payable_document_id = d.id and i.status = 'posted') then
      raise exception using errcode = '22023', message = 'FINANCE_CONTRACT_NEEDS_INVOICE', detail = coalesce(d.document_no, d.code); end if;
    if d.id = any(v_seen) then raise exception using errcode = '22023', message = 'FINANCE_DUPLICATE_DOCUMENT'; end if;
    v_seen := v_seen || d.id;
    perform 1 from public.supplier_payable_documents where id = d.id for update;
    if v_amount > d.outstanding - d.pending_external - app_private.finance_doc_reserved(d.id, p_exclude) + 0.005 then
      raise exception using errcode = '22023', message = 'FINANCE_OVER_OUTSTANDING'; end if;
    doc_id := d.id; amount := v_amount; project_id := d.project_id; site_id := d.construction_site_id; document_no := d.document_no;
    outstanding := d.outstanding; source_type := d.source_type; source_id := d.source_id; recognized := d.recognized; paid := d.paid;
    return next;
  end loop;
end $function$;

-- Vá: mỗi chứng từ công nợ kèm hóa đơn đã gắn và phần chưa có hóa đơn.
CREATE OR REPLACE FUNCTION public.get_finance_supplier_v1(p_supplier_id text)
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
          when 'subcontract_round' then (select jsonb_build_object('subcontractId', d.subcontract_id, 'subcontractCode', d.metadata->>'subcontractCode', 'roundNo', d.metadata->'roundNo')
            from public.supplier_payable_documents d where d.id = r.id)
          when 'subcontract_retention' then (select jsonb_build_object('subcontractId', d.subcontract_id, 'subcontractCode', d.metadata->>'subcontractCode', 'roundNo', d.metadata->'roundNo')
            from public.supplier_payable_documents d where d.id = r.id)
          when 'subcontract_opening' then (select jsonb_build_object('subcontractId', d.subcontract_id, 'subcontractCode', d.metadata->>'subcontractCode', 'roundNo', d.metadata->'roundNo')
            from public.supplier_payable_documents d where d.id = r.id)
          else null end,
        'pendingAdjustment', (select jsonb_build_object('id', j.id, 'kind', j.kind, 'reason', j.reason, 'createdBy', j.created_by,
            'createdByName', app_private.finance_user_name(j.created_by), 'createdAt', j.created_at)
          from public.finance_payable_adjustments j where j.payable_document_id = r.id and j.status = 'submitted'),
        'invoiced', app_private.finance_doc_invoiced(r.id, null),
        'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'status', i.status, 'amount', k.allocated_gross_amount) order by i.invoice_date)
          from public.supplier_invoice_payable_links k join public.supplier_invoices i on i.id = k.invoice_id
          where k.payable_document_id = r.id and i.status in ('posted', 'pending_approval')), '[]'::jsonb))
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
