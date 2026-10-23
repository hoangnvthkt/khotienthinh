-- Đợt 1b khóa cửa sau (audit 22/10, sau PR #314) — hai cửa còn lại, đã kiểm động trên Cloud bằng giao dịch tự hủy.
-- Không đổi giao diện (không màn nào gọi lệnh đảo bảng đối soát; mọi màn kho chèn phiếu Chờ rồi hoàn tất bằng lệnh).
--  1. reverse_supplier_delivery_statement (đảo bảng đối soát HĐ nguyên tắc đã ghi công nợ):
--     - chỉ Tài chính — Xác nhận hoặc Admin (trước: ai có quyền sửa dự án — cả thủ kho — đều gọi được);
--     - người đảo = người đang đăng nhập (trước: lấy từ tham số client), bắt lý do;
--     - từ chối khi công nợ của bảng đã chi / đang trong đợt chi hoặc đề nghị chi, đã cấn trừ / giảm trừ, có chốt giá,
--       có hóa đơn NCC gắn vào, đang chờ hủy, hoặc kỳ đang khóa sổ;
--     - đảo chi phí dự án đã ghi lúc ghi nợ bằng bút toán âm ngày đảo (trước để nguyên → lập lại bảng thành chi phí trùng).
--  2. Phiếu kho ghi thẳng (REST): chỉ tạo ở trạng thái Chờ (trừ phiếu điều chỉnh); phiếu nhập gắn đợt giao PO chỉ cho
--     đợt kế hoạch của PO cũ (không phải Mua hàng) chưa có phiếu kho. Phiếu nhập PO Mua hàng chỉ sinh bởi lệnh Mua hàng / Kho.
-- Bản gốc hàm lấy từ Cloud ngày 23/10/2026, chỉ chèn thêm kiểm tra.

-- 1. Đảo bảng đối soát HĐ nguyên tắc. Bỏ tham số người đảo (p_actor_id) nên phải xóa bản cũ.
drop function if exists public.reverse_supplier_delivery_statement(uuid, uuid);

create or replace function public.reverse_supplier_delivery_statement(p_statement_id uuid, p_reason text)
returns public.supplier_delivery_statements
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_actor uuid := public.current_app_user_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_blocker text;
begin
  -- 23/10/2026: đảo công nợ đã ghi là việc của Tài chính — Xác nhận (như xác nhận hủy công nợ) hoặc Admin.
  if v_actor is null or not app_private.finance_can('confirm') then
    raise exception using errcode = '42501', message = 'SUPPLIER_STATEMENT_REVERSE_DENIED';
  end if;
  if v_reason is null then
    raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED';
  end if;

  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  if v_statement.status <> 'posted' then
    raise exception 'Chỉ đảo được bảng đối soát đã post.';
  end if;

  select * into v_document
  from public.supplier_payable_documents
  where id = v_statement.payable_document_id
  for update;

  if app_private.finance_period_is_locked(v_statement.project_id, v_statement.construction_site_id, 'VND',
      (now() at time zone 'Asia/Ho_Chi_Minh')::date) then
    raise exception using errcode = '55000', message = 'FINANCE_PERIOD_LOCKED';
  end if;

  -- Đã chi, hoặc đang nằm trong đợt chi / đề nghị chi chưa hủy: đảo / hủy thanh toán trước.
  if exists (
    select 1
    from public.supplier_payment_allocations a
    join public.supplier_payment_batches b on b.id = a.payment_batch_id
    where a.payable_document_id = v_statement.payable_document_id
      and b.status not in ('cancelled', 'reversed')
  ) or exists (
    select 1
    from public.finance_payment_request_lines l
    join public.finance_payment_requests r on r.id = l.request_id
    where l.payable_document_id = v_statement.payable_document_id
      and r.status in ('pending', 'returned', 'approved', 'paid')
  ) then
    raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_HAS_PAYMENTS';
  end if;

  -- Chứng từ đi kèm công nợ chưa đảo được ở đây: đảo / gỡ ở Tài chính trước.
  v_blocker := case
    when coalesce(v_document.credit_amount, 0) > 0
      or exists (select 1 from public.supplier_advance_offsets o where o.payable_document_id = v_document.id and o.status = 'active')
      or exists (select 1 from public.finance_supplier_credit_uses u where u.payable_document_id = v_document.id and u.status = 'active')
      then 'Công nợ của bảng đã được cấn trừ / giảm trừ.'
    when exists (
        select 1 from public.supplier_price_settlement_lines l
        join public.supplier_price_settlements s on s.id = l.settlement_id
        where l.payable_document_id = v_document.id and s.status in ('pending_approval', 'posted'))
      then 'Bảng có chốt giá đang chờ duyệt / đã ghi.'
    when exists (
        select 1 from public.supplier_invoice_payable_links k
        join public.supplier_invoices i on i.id = k.invoice_id
        where k.payable_document_id = v_document.id and i.status in ('awaiting_goods', 'pending_approval', 'posted'))
      then 'Bảng có hóa đơn NCC gắn vào.'
  end;
  if v_blocker is not null then
    raise exception using errcode = '22023', message = 'SUPPLIER_STATEMENT_REVERSE_SETTLED', detail = v_blocker;
  end if;

  if exists (
    select 1 from public.finance_payable_adjustments j
    where j.payable_document_id = v_document.id and j.status = 'submitted'
  ) then
    raise exception using errcode = '22023', message = 'FINANCE_ADJUSTMENT_PENDING';
  end if;

  -- Công nợ Tài chính đã xác nhận hủy thì giữ trạng thái hủy (chi phí đã về 0).
  update public.supplier_payable_documents
  set status = 'reversed', updated_at = now()
  where id = v_statement.payable_document_id
    and status not in ('cancelled', 'reversed');

  -- Chi phí dự án ghi lúc ghi nợ: bút toán âm ngày đảo, không sửa số tháng cũ.
  perform app_private.finance_reverse_project_cost(
    'supplier_payable_document:' || v_statement.payable_document_id::text || ':recognition', v_reason, v_actor);

  update public.supplier_direct_delivery_lines dl
  set statement_id = null, updated_at = now()
  where dl.statement_id = p_statement_id;

  update public.supplier_direct_delivery_notes note
  set status = 'accepted', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and status = 'statemented';

  update public.supplier_delivery_statements
  set
    status = 'reversed',
    metadata = metadata || jsonb_build_object('reversedBy', v_actor, 'reversedByName', (select name from public.users where id = v_actor),
      'reversedAt', now(), 'reverseReason', v_reason),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
  values ('need', 'statement:' || v_statement.id, 'statement_reverse', v_actor, v_reason,
    jsonb_build_object('code', v_statement.code, 'payableDocumentId', v_statement.payable_document_id, 'totalAmount', v_statement.total_amount));
  insert into public.finance_events (entity_type, entity_id, supplier_id, action, actor_id, reason, payload)
  select 'payable', v_statement.payable_document_id::text, v_statement.supplier_id, 'statement_reverse', v_actor, v_reason,
    jsonb_build_object('statementId', v_statement.id, 'statementCode', v_statement.code, 'amount', v_statement.total_amount)
  where v_statement.payable_document_id is not null;

  return v_statement;
end;
$function$;

revoke all on function public.reverse_supplier_delivery_statement(uuid, text) from public, anon;
grant execute on function public.reverse_supplier_delivery_statement(uuid, text) to authenticated;

-- 2. Phiếu kho ghi thẳng: chỉ phiếu Chờ (trừ điều chỉnh); phiếu nhập gắn đợt giao PO chỉ cho đợt kế hoạch của PO cũ.
create or replace function app_private.wms_assert_transaction_direct_insert(p_new jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_batch public.purchase_order_delivery_batches%rowtype;
begin
  if coalesce(p_new ->> 'status', '') <> 'PENDING' and coalesce(p_new ->> 'type', '') <> 'ADJUSTMENT' then
    raise exception using errcode = '42501',
      message = 'WMS_DIRECT_INSERT_PENDING_ONLY: Phiếu kho tạo mới ở trạng thái Chờ — duyệt / hoàn tất phiếu bằng thao tác ở màn Kho.';
  end if;

  if coalesce(p_new ->> 'source_type', '') = 'po_delivery_batch' then
    select * into v_batch
    from public.purchase_order_delivery_batches
    where id = case when pg_input_is_valid(coalesce(p_new ->> 'source_id', ''), 'uuid') then (p_new ->> 'source_id')::uuid end;
    if not found
      or coalesce(p_new ->> 'type', '') <> 'IMPORT'
      or v_batch.status <> 'planned'
      or v_batch.wms_transaction_id is not null
      or exists (
        select 1 from public.purchase_orders po
        where po.id = v_batch.purchase_order_id and app_private.procurement_po_is_hub(po.metadata)
      ) then
      raise exception using errcode = '42501',
        message = 'WMS_PO_RECEIPT_COMMAND_ONLY: Phiếu nhập đợt giao PO sinh từ thao tác ở màn Mua hàng / Kho — không tạo trực tiếp.';
    end if;
  end if;
end;
$$;

create or replace function app_private.guard_wms_transaction_direct_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and coalesce(current_setting('request.path', true), '') not like '/rpc/%' then
    perform app_private.wms_assert_transaction_direct_insert(to_jsonb(new));
  end if;
  return new;
end;
$$;

revoke all on function app_private.wms_assert_transaction_direct_insert(jsonb) from public, anon;
revoke all on function app_private.guard_wms_transaction_direct_insert() from public, anon, authenticated;
grant execute on function app_private.wms_assert_transaction_direct_insert(jsonb) to authenticated;

drop trigger if exists guard_wms_transaction_direct_insert on public.transactions;
create trigger guard_wms_transaction_direct_insert
  before insert on public.transactions
  for each row execute function app_private.guard_wms_transaction_direct_insert();
