-- Mua nóng/CCDC: one guarded lifecycle from draft to supplier payable/payment.

create or replace function app_private.guard_site_direct_purchase_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payable_status text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Phiếu mua nóng mới phải được tạo ở trạng thái Nháp.';
    end if;
    return new;
  end if;

  if new.status = old.status then
    if old.status <> 'draft'
      and (to_jsonb(new) - array['updated_at', 'wms_transaction_id', 'last_action_by', 'last_action_at'])
        <> (to_jsonb(old) - array['updated_at', 'wms_transaction_id', 'last_action_by', 'last_action_at']) then
      raise exception 'Chỉ sửa được phiếu mua nóng ở trạng thái Nháp.';
    end if;
    return new;
  end if;

  if not (
    (old.status = 'draft' and new.status = 'submitted')
    or (old.status = 'submitted' and new.status in ('draft', 'approved_to_buy', 'rejected'))
    or (old.status = 'approved_to_buy' and new.status in ('submitted', 'purchased', 'rejected'))
    or (old.status in ('purchased', 'received', 'finance_review') and new.status in ('finance_review', 'reconciled', 'rejected'))
    or (old.status = 'reconciled' and new.status in ('finance_review', 'rejected', 'closed'))
    or (old.status = 'closed' and new.status = 'reconciled')
  ) then
    raise exception 'Chuyển trạng thái mua nóng không hợp lệ: % -> %.', old.status, new.status;
  end if;

  if new.status = 'reconciled' then
    select status into v_payable_status
    from public.supplier_payable_documents
    where source_type = 'site_direct_purchase'
      and source_id = new.id::text;

    if v_payable_status not in ('open', 'payable', 'partial') then
      raise exception 'Chỉ xác nhận công nợ khi phiếu có công nợ nhà cung cấp đang mở.';
    end if;
  end if;

  if new.status = 'closed' then
    select status into v_payable_status
    from public.supplier_payable_documents
    where source_type = 'site_direct_purchase'
      and source_id = new.id::text;

    if v_payable_status <> 'paid' then
      raise exception 'Chỉ đóng phiếu khi công nợ nhà cung cấp đã thanh toán đủ.';
    end if;
  end if;

  if new.status = 'rejected' then
    if exists (
      select 1
      from public.supplier_payable_documents payable
      where payable.source_type = 'site_direct_purchase'
        and payable.source_id = new.id::text
        and payable.status not in ('cancelled', 'reversed')
    ) then
      raise exception 'Phải hủy công nợ nhà cung cấp trước khi từ chối phiếu.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_site_direct_purchase_lifecycle on public.site_direct_purchases;
create trigger trg_guard_site_direct_purchase_lifecycle
before insert or update on public.site_direct_purchases
for each row execute function app_private.guard_site_direct_purchase_lifecycle();

create or replace function public.sync_supplier_payable_from_site_direct_purchase(p_direct_purchase_id uuid)
returns public.supplier_payable_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_recognized numeric(18,2);
  v_document public.supplier_payable_documents%rowtype;
  v_recording boolean := coalesce(current_setting('app.direct_purchase_recording', true), '') = 'on';
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_purchase.project_id, v_purchase.construction_site_id) then
    raise exception 'Bạn không có quyền đồng bộ công nợ phiếu mua nóng này.';
  end if;

  if not v_recording and v_purchase.status not in ('purchased', 'received', 'finance_review', 'reconciled') then
    raise exception 'Phiếu mua nóng chưa ở bước xác nhận công nợ.';
  end if;

  if exists (
    select 1
    from public.site_direct_purchase_lines line
    where line.direct_purchase_id = v_purchase.id
      and line.line_type = 'stock_item'
      and line.status <> 'rejected'
  )
  and not exists (
    select 1
    from public.transactions tx
    where tx.id = v_purchase.wms_transaction_id
      and upper(coalesce(tx.status::text, '')) = 'COMPLETED'
  )
  then
    raise exception 'Mua nóng vật tư tồn kho phải hoàn tất WMS import trước khi xác nhận công nợ.';
  end if;

  select coalesce(sum(
    case
      when line.status in ('accepted', 'adjusted') then coalesce(nullif(line.accepted_amount, 0), line.line_amount + line.vat_amount)
      else 0
    end
  ), 0)::numeric(18,2)
  into v_recognized
  from public.site_direct_purchase_lines line
  where line.direct_purchase_id = v_purchase.id;

  if v_recognized <= 0 then
    raise exception 'Phiếu mua nóng chưa có giá trị được chấp nhận để xác nhận công nợ.';
  end if;

  select * into v_document
  from public.supplier_payable_documents
  where source_type = 'site_direct_purchase'
    and source_id = v_purchase.id::text
  for update;

  if found and v_document.status in ('cancelled', 'reversed') and not v_recording then
    raise exception 'Công nợ của phiếu đã bị hủy. Hãy dùng thao tác Xác nhận công nợ nhà cung cấp để ghi nhận lại.';
  end if;

  insert into public.supplier_payable_documents (
    code, source_type, source_id, project_id, construction_site_id,
    supplier_id, supplier_name_snapshot, document_no, document_date, due_date,
    committed_amount, recognized_amount, credit_amount, status, qr_token,
    invoice_number, invoice_date, metadata, created_by
  )
  values (
    'AP-' || v_purchase.code,
    'site_direct_purchase',
    v_purchase.id::text,
    v_purchase.project_id,
    v_purchase.construction_site_id,
    v_purchase.supplier_id,
    v_purchase.supplier_name_snapshot,
    v_purchase.code,
    coalesce(v_purchase.purchase_date, current_date),
    null,
    v_purchase.total_amount,
    v_recognized,
    0,
    'open',
    coalesce(v_purchase.qr_token, 'ap_direct_' || replace(v_purchase.id::text, '-', '')),
    v_purchase.invoice_number,
    v_purchase.invoice_date,
    jsonb_build_object(
      'purchaseMode', v_purchase.purchase_mode,
      'paymentSource', v_purchase.payment_source,
      'wmsTransactionId', v_purchase.wms_transaction_id
    ),
    v_purchase.created_by
  )
  on conflict (source_type, source_id) do update
  set
    project_id = excluded.project_id,
    construction_site_id = excluded.construction_site_id,
    supplier_id = excluded.supplier_id,
    supplier_name_snapshot = excluded.supplier_name_snapshot,
    document_no = excluded.document_no,
    document_date = excluded.document_date,
    committed_amount = excluded.committed_amount,
    recognized_amount = excluded.recognized_amount,
    credit_amount = excluded.credit_amount,
    status = case
      when v_recording then 'open'
      else public.supplier_payable_documents.status
    end,
    invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date,
    metadata = public.supplier_payable_documents.metadata || excluded.metadata,
    updated_at = now()
  returning * into v_document;

  return v_document;
end;
$$;

create or replace function app_private.cancel_site_direct_purchase_payable_v1(
  p_direct_purchase_id uuid,
  p_reason text,
  p_next_status text
)
returns public.site_direct_purchases
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_actor_id uuid := auth.uid();
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_purchase.project_id, v_purchase.construction_site_id)
    or not app_private.material_flow_has_action_or_legacy(v_purchase.project_id, v_purchase.construction_site_id, 'project.material_direct_purchase.record_ap') then
    raise exception 'Bạn không có quyền hủy xác nhận công nợ phiếu mua nóng này.';
  end if;

  if v_purchase.status not in ('submitted', 'approved_to_buy', 'purchased', 'received', 'finance_review', 'reconciled') then
    raise exception 'Phiếu ở trạng thái % không thể từ chối hoặc bỏ xác nhận công nợ.', v_purchase.status;
  end if;

  if exists (
    select 1
    from public.supplier_payment_allocations allocation
    join public.supplier_payment_batches batch on batch.id = allocation.payment_batch_id
    join public.supplier_payable_documents payable on payable.id = allocation.payable_document_id
    where payable.source_type = 'site_direct_purchase'
      and payable.source_id = v_purchase.id::text
      and batch.status = 'paid'
  ) then
    raise exception 'Phiếu đã có thanh toán. Hãy Đảo thanh toán trước khi từ chối hoặc bỏ xác nhận công nợ.';
  end if;

  if v_purchase.site_cash_settlement_id is not null then
    raise exception 'Phiếu đã nằm trong quyết toán quỹ. Hãy đảo/quy hồi quyết toán trước.';
  end if;

  if v_purchase.wms_transaction_id is not null then
    raise exception 'Phiếu đã phát sinh WMS. Hãy hủy hoặc đảo phiếu kho trước.';
  end if;

  if exists (
    select 1
    from public.site_small_tool_records tool
    where tool.source_type = 'site_direct_purchase'
      and tool.source_id = v_purchase.id::text
      and tool.status <> 'stored'
  ) then
    raise exception 'CCDC đã được bàn giao hoặc sử dụng. Hãy thực hiện nghiệp vụ đảo CCDC trước.';
  end if;

  delete from public.site_small_tool_records tool
  where tool.source_type = 'site_direct_purchase'
    and tool.source_id = v_purchase.id::text
    and tool.status = 'stored';

  update public.supplier_payable_documents payable
  set
    status = 'cancelled',
    recognized_amount = 0,
    metadata = coalesce(payable.metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelledAt', now(),
      'cancelledBy', v_actor_id,
      'cancellationReason', nullif(btrim(p_reason), '')
    ),
    updated_at = now()
  where payable.source_type = 'site_direct_purchase'
    and payable.source_id = v_purchase.id::text
    and payable.status not in ('cancelled', 'reversed');

  update public.site_direct_purchases purchase
  set
    status = p_next_status,
    note = concat_ws(E'\n', nullif(purchase.note, ''), case when nullif(btrim(p_reason), '') is null then null else 'Lý do: ' || btrim(p_reason) end),
    last_action_by = v_actor_id,
    last_action_at = now(),
    updated_at = now()
  where purchase.id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.record_site_direct_purchase_payable_v1(p_direct_purchase_id uuid)
returns public.supplier_payable_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_document public.supplier_payable_documents%rowtype;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_purchase.project_id, v_purchase.construction_site_id)
    or not app_private.material_flow_has_action_or_legacy(v_purchase.project_id, v_purchase.construction_site_id, 'project.material_direct_purchase.record_ap') then
    raise exception 'Bạn không có quyền xác nhận công nợ phiếu mua nóng này.';
  end if;

  if v_purchase.status not in ('purchased', 'received', 'finance_review') then
    raise exception 'Chỉ xác nhận công nợ sau khi phiếu đã mua và sẵn sàng đối chiếu.';
  end if;

  if exists (
    select 1 from public.site_direct_purchase_lines line
    where line.direct_purchase_id = v_purchase.id
      and line.status in ('accepted', 'adjusted')
  ) is not true then
    raise exception 'Phiếu chưa có dòng hàng hợp lệ để xác nhận công nợ.';
  end if;

  perform set_config('app.direct_purchase_recording', 'on', true);

  if exists (
    select 1 from public.site_direct_purchase_lines line
    where line.direct_purchase_id = v_purchase.id
      and line.line_type = 'small_tool'
      and line.status in ('accepted', 'adjusted')
  ) then
    perform public.sync_site_small_tools_from_site_direct_purchase(v_purchase.id);
  end if;

  select * into v_document
  from public.sync_supplier_payable_from_site_direct_purchase(v_purchase.id);

  update public.site_direct_purchases purchase
  set
    status = 'reconciled',
    last_action_by = auth.uid(),
    last_action_at = now(),
    updated_at = now()
  where purchase.id = v_purchase.id;

  return v_document;
end;
$$;

create or replace function public.unrecord_site_direct_purchase_payable_v1(
  p_direct_purchase_id uuid,
  p_reason text default null
)
returns public.site_direct_purchases
language sql
security invoker
set search_path = ''
as $$
  select app_private.cancel_site_direct_purchase_payable_v1(
    p_direct_purchase_id,
    coalesce(nullif(btrim(p_reason), ''), 'Bỏ xác nhận công nợ'),
    'finance_review'
  );
$$;

create or replace function public.reject_site_direct_purchase_v1(
  p_direct_purchase_id uuid,
  p_reason text default null
)
returns public.site_direct_purchases
language sql
security invoker
set search_path = ''
as $$
  select app_private.cancel_site_direct_purchase_payable_v1(
    p_direct_purchase_id,
    coalesce(nullif(btrim(p_reason), ''), 'Từ chối phiếu'),
    'rejected'
  );
$$;

create or replace function public.transition_site_direct_purchase_v1(
  p_direct_purchase_id uuid,
  p_action text,
  p_reason text default null,
  p_target_user_id uuid default null,
  p_target_name text default null,
  p_target_permission text default null
)
returns public.site_direct_purchases
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
  v_target_status text;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.material_flow_has_action_or_legacy(v_purchase.project_id, v_purchase.construction_site_id, 'project.material_direct_purchase.edit') then
    raise exception 'Bạn không có quyền chuyển trạng thái phiếu mua nóng này.';
  end if;

  v_target_status := case p_action
    when 'submit' then 'submitted'
    when 'return_to_draft' then 'draft'
    when 'approve_to_buy' then 'approved_to_buy'
    when 'cancel_approval' then 'submitted'
    when 'mark_purchased' then 'purchased'
    when 'close_after_payment' then 'closed'
    else null
  end;

  if v_target_status is null then
    raise exception 'Thao tác vòng đời mua nóng không hợp lệ: %.', p_action;
  end if;

  update public.site_direct_purchases purchase
  set
    status = v_target_status,
    submitted_to_user_id = case when p_action = 'submit' then p_target_user_id else purchase.submitted_to_user_id end,
    submitted_to_name = case when p_action = 'submit' then p_target_name else purchase.submitted_to_name end,
    submitted_to_permission = case when p_action = 'submit' then coalesce(p_target_permission, 'approve') else purchase.submitted_to_permission end,
    ever_submitted = case when p_action = 'submit' then true else purchase.ever_submitted end,
    last_action_by = auth.uid(),
    last_action_at = now(),
    note = case
      when p_action = 'cancel_approval' and nullif(btrim(p_reason), '') is not null
        then concat_ws(E'\n', nullif(purchase.note, ''), 'Hủy duyệt: ' || btrim(p_reason))
      else purchase.note
    end,
    updated_at = now()
  where purchase.id = v_purchase.id
  returning * into v_purchase;

  return v_purchase;
end;
$$;

create or replace function public.delete_site_direct_purchase_v1(p_direct_purchase_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_purchase public.site_direct_purchases%rowtype;
begin
  select * into v_purchase
  from public.site_direct_purchases
  where id = p_direct_purchase_id
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu mua nóng %. ', p_direct_purchase_id;
  end if;

  if not app_private.material_flow_has_action_or_legacy(v_purchase.project_id, v_purchase.construction_site_id, 'project.material_direct_purchase.delete') then
    raise exception 'Bạn không có quyền xóa phiếu mua nóng.';
  end if;

  if v_purchase.status <> 'draft' or coalesce(v_purchase.ever_submitted, false) then
    raise exception 'Chỉ xóa được phiếu mua nóng ở trạng thái Nháp và chưa từng trình duyệt.';
  end if;

  if v_purchase.wms_transaction_id is not null
    or v_purchase.site_cash_settlement_id is not null
    or exists (
      select 1 from public.supplier_payable_documents payable
      where payable.source_type = 'site_direct_purchase'
        and payable.source_id = p_direct_purchase_id::text
    )
    or exists (
      select 1 from public.site_small_tool_records tool
      where tool.source_type = 'site_direct_purchase'
        and tool.source_id = p_direct_purchase_id::text
    )
  then
    raise exception 'Không thể xóa phiếu mua nóng đã phát sinh WMS, CCDC, công nợ hoặc hoàn ứng.';
  end if;

  delete from public.site_direct_purchases where id = p_direct_purchase_id;
end;
$$;

create or replace function app_private.sync_site_direct_purchase_payment_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source_type <> 'site_direct_purchase' then
    return new;
  end if;

  if new.status = 'paid' then
    update public.site_direct_purchases purchase
    set status = 'closed', updated_at = now()
    where purchase.id::text = new.source_id
      and purchase.status = 'reconciled';
  elsif old.status = 'paid' and new.status in ('open', 'payable', 'partial') then
    update public.site_direct_purchases purchase
    set status = 'reconciled', updated_at = now()
    where purchase.id::text = new.source_id
      and purchase.status = 'closed';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_site_direct_purchase_payment_status on public.supplier_payable_documents;
create trigger trg_sync_site_direct_purchase_payment_status
after update of status on public.supplier_payable_documents
for each row execute function app_private.sync_site_direct_purchase_payment_status();

revoke all on function public.record_site_direct_purchase_payable_v1(uuid) from public, anon;
revoke all on function public.unrecord_site_direct_purchase_payable_v1(uuid, text) from public, anon;
revoke all on function public.reject_site_direct_purchase_v1(uuid, text) from public, anon;
revoke all on function public.transition_site_direct_purchase_v1(uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.record_site_direct_purchase_payable_v1(uuid) to authenticated;
grant execute on function public.unrecord_site_direct_purchase_payable_v1(uuid, text) to authenticated;
grant execute on function public.reject_site_direct_purchase_v1(uuid, text) to authenticated;
grant execute on function public.transition_site_direct_purchase_v1(uuid, text, text, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
