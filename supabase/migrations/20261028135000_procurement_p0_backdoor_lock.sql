-- Đợt 1 khóa cửa sau luồng Đề xuất → Mua hàng → Giao/Nhận → Công nợ → Chi (audit 22/10, P0 đã kiểm động trên Cloud).
-- Không đổi giao diện. Mọi lệnh nghiệp vụ là RPC SECURITY DEFINER (chạy bằng chủ hàm) nên không bị chặn;
-- chỉ ghi thẳng qua REST (current_user = authenticated, request.path ≠ /rpc/…) và lệnh cũ bị từ chối.
--  1. Ghi thẳng PO / đợt giao / dòng đợt giao / liên kết đề xuất ↔ PO: chỉ còn sửa PO cũ (không phải Mua hàng)
--     đang nháp / trả lại / hủy chưa nhận hàng và đợt giao kế hoạch chưa có phiếu kho; xóa đợt đã nhận bị cấm.
--     Đề xuất: dòng đã lập đơn mua không đổi vật tư / SL / đơn vị / xóa dòng bằng ghi thẳng.
--  2. Lệnh cũ: transition_project_purchase_order_status từ chối PO Mua hàng và không hủy đơn đã nhận;
--     transition_project_material_request_status từ chối phiếu chạy quy trình / đã có đơn mua;
--     remove_purchase_order_v1, remove_purchase_order_delivery_batch_v1 từ chối PO Mua hàng và đợt đã nhận;
--     chi / đảo đợt chi bản cũ: thu hồi EXECUTE; đợt của đề nghị chi / chi ngoài chỉ chi / đảo trong lệnh Tài chính.
--  3. process_transaction_status / _approval, update_transaction_items_for_receipt: không xử lý phiếu nhập đợt giao PO.
--  4. Nhật ký trước/sau cho đợt giao và dòng đợt giao.
-- Bản gốc các hàm sửa lấy từ Cloud ngày 23/10/2026, chỉ chèn thêm kiểm tra.

-- Đợt chi sinh từ đề nghị chi (metadata.kind = payment_request) hoặc chi ngoài (metadata.external).
create or replace function app_private.supplier_payment_batch_finance_managed(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_metadata ->> 'kind', '') = 'payment_request'
    or coalesce(p_metadata ->> 'external', '') = 'true';
$$;

-- Số lượng trong jsonb dạng chữ chuẩn: trống / null = '0'; 10, "10", 10.0 đều ra '10'; chữ không phải số giữ nguyên.
create or replace function app_private.procurement_jsonb_qty(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) = 'null' or coalesce(p_value #>> '{}', '') = '' then '0'
    when pg_input_is_valid(p_value #>> '{}', 'numeric') then trim_scale((p_value #>> '{}')::numeric)::text
    else p_value #>> '{}'
  end;
$$;

-- Đợt giao đã nhận: trạng thái nhận, có người nhận, phiếu nhập đã hoàn tất, hoặc đã sinh công nợ.
create or replace function app_private.procurement_delivery_has_receipt(p_delivery_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchase_order_delivery_batches batch
    where batch.id = p_delivery_id
      and (
        batch.status in ('quality_approved', 'received', 'received_short', 'received_over')
        or batch.received_at is not null
        or exists (
          select 1 from public.transactions tx
          where tx.id = batch.wms_transaction_id and tx.status = 'COMPLETED'::public.transaction_status
        )
        or exists (
          select 1 from public.supplier_payable_documents document
          where document.source_type = 'purchase_delivery_receipt' and document.source_id = batch.id::text
        )
      )
  );
$$;

-- Đơn đã phát sinh nhận hàng: SL đã nhận trên dòng, phiếu nhập đã ghi, hoặc có đợt giao đã nhận.
create or replace function app_private.procurement_po_has_receipt(p_po_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchase_orders po
    where po.id = p_po_id
      and (
        jsonb_array_length(case when jsonb_typeof(po.received_transaction_ids) = 'array' then po.received_transaction_ids else '[]'::jsonb end) > 0
        or exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(po.items) = 'array' then po.items else '[]'::jsonb end) item(value)
          where app_private.procurement_jsonb_qty(item.value -> 'receivedQty') <> '0'
        )
      )
  )
  or exists (
    select 1 from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = p_po_id
      and app_private.procurement_delivery_has_receipt(batch.id)
  );
$$;

-- Dòng đề xuất đã nằm trong đơn mua còn hiệu lực (không hủy, không lưu trữ).
create or replace function app_private.material_request_ordered_line_ids(p_request_id text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct link.request_line_id) filter (where link.request_line_id is not null), array[]::text[])
  from public.purchase_order_request_lines link
  join public.purchase_orders po on po.id = link.purchase_order_id
  where link.material_request_id = p_request_id
    and po.status <> 'cancelled'
    and po.archived_at is null;
$$;

create or replace function app_private.material_request_has_open_po(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.purchase_order_request_lines link
    join public.purchase_orders po on po.id = link.purchase_order_id
    where link.material_request_id = p_request_id
      and po.status <> 'cancelled'
      and po.archived_at is null
  );
$$;

-- PO (dạng jsonb của dòng) không còn sửa thẳng được: PO Mua hàng, đã qua bước duyệt, hoặc đã nhận hàng.
create or replace function app_private.procurement_po_row_locked(p_po jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.procurement_po_is_hub(p_po -> 'metadata')
    or coalesce(p_po ->> 'status', '') not in ('draft', 'returned', 'cancelled')
    or jsonb_array_length(case when jsonb_typeof(p_po -> 'received_transaction_ids') = 'array' then p_po -> 'received_transaction_ids' else '[]'::jsonb end) > 0
    or exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(p_po -> 'items') = 'array' then p_po -> 'items' else '[]'::jsonb end) item(value)
      where app_private.procurement_jsonb_qty(item.value -> 'receivedQty') <> '0'
    )
    or app_private.procurement_po_has_receipt(p_po ->> 'id');
$$;

-- Đợt giao (dạng jsonb) còn là kế hoạch: chưa có phiếu kho, chưa kiểm / nhận, chưa có giá trị chấp nhận.
create or replace function app_private.procurement_delivery_row_is_open_plan(p_batch jsonb)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_batch ->> 'status', '') in ('planned', 'supplemental_pending')
    and nullif(p_batch ->> 'wms_transaction_id', '') is null
    and p_batch ->> 'received_at' is null
    and p_batch ->> 'received_by' is null
    and p_batch ->> 'quality_result' is null
    and p_batch ->> 'quality_approved_at' is null
    and app_private.procurement_jsonb_qty(p_batch -> 'accepted_gross_amount') = '0'
    and not app_private.procurement_delivery_has_receipt(nullif(p_batch ->> 'id', '')::uuid);
$$;

-- Kiểm một lần ghi thẳng (REST) vào bảng nguồn; báo lỗi nếu không được phép. Gọi từ trigger bên dưới.
create or replace function app_private.procurement_assert_direct_write(p_table text, p_op text, p_old jsonb, p_new jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_locked_message constant text := 'LOCKED_DIRECT_WRITE: Đơn mua, đợt giao chỉ thay đổi bằng thao tác ở màn Mua hàng / Kho — không ghi thẳng dữ liệu.';
  v_receipt_fields constant text[] := array['accepted_qty', 'accepted_stock_qty', 'returned_qty', 'delivered_qty', 'delivered_stock_qty',
    'physical_counted_qty', 'physical_counted_stock_qty', 'custody_qty', 'custody_stock_qty'];
  v_plan_fields constant text[] := array['status', 'wms_transaction_id', 'fulfillment_batch_ids', 'note', 'planned_delivery_date', 'updated_at'];
  v_batch jsonb;
  v_po jsonb;
  v_field text;
  v_line_id text;
  v_old_line jsonb;
  v_new_line jsonb;
begin
  if p_op = 'UPDATE' and (p_new - 'updated_at') = (p_old - 'updated_at') then
    return;
  end if;

  if p_table = 'purchase_orders' then
    if (p_old is not null and app_private.procurement_po_row_locked(p_old))
      or (p_new is not null and app_private.procurement_po_row_locked(p_new))
      or (p_op = 'INSERT' and coalesce(p_new ->> 'status', '') <> 'draft') then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    return;
  end if;

  if p_table = 'purchase_order_request_lines' then
    if not exists (
      select 1 from public.purchase_orders po where po.id = coalesce(p_new ->> 'purchase_order_id', p_old ->> 'purchase_order_id')
    ) then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    for v_po in
      select to_jsonb(po) from public.purchase_orders po
      where po.id in (p_old ->> 'purchase_order_id', p_new ->> 'purchase_order_id')
    loop
      if app_private.procurement_po_row_locked(v_po) then
        raise exception using errcode = '42501', message = v_locked_message;
      end if;
    end loop;
    return;
  end if;

  if p_table = 'purchase_order_delivery_batches' then
    if p_op = 'UPDATE' and p_new ->> 'purchase_order_id' is distinct from p_old ->> 'purchase_order_id' then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    select to_jsonb(po) into v_po from public.purchase_orders po
    where po.id = coalesce(p_new ->> 'purchase_order_id', p_old ->> 'purchase_order_id');
    if v_po is null or app_private.procurement_po_is_hub(v_po -> 'metadata') then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    if p_old is not null and not app_private.procurement_delivery_row_is_open_plan(p_old) then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    if p_op = 'INSERT' and (
      not app_private.procurement_delivery_row_is_open_plan(p_new)
      or coalesce(p_new ->> 'approval_status', '') = 'approved'
    ) then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    -- Luồng cũ tab Dự án: đợt kế hoạch → tạo phiếu nhận (wms_pending + mã phiếu kho); các cột khác giữ nguyên.
    if p_op = 'UPDATE' and (
      coalesce(p_new ->> 'status', '') not in ('planned', 'supplemental_pending', 'wms_pending')
      or (p_new - v_plan_fields) is distinct from (p_old - v_plan_fields)
    ) then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    return;
  end if;

  if p_table = 'purchase_order_delivery_lines' then
    if p_op = 'UPDATE' and (
      p_new ->> 'delivery_batch_id' is distinct from p_old ->> 'delivery_batch_id'
      or p_new ->> 'purchase_order_id' is distinct from p_old ->> 'purchase_order_id'
    ) then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    select to_jsonb(batch) into v_batch from public.purchase_order_delivery_batches batch
    where batch.id = nullif(coalesce(p_new ->> 'delivery_batch_id', p_old ->> 'delivery_batch_id'), '')::uuid;
    select to_jsonb(po) into v_po from public.purchase_orders po where po.id = v_batch ->> 'purchase_order_id';
    if v_batch is null or v_po is null
      or app_private.procurement_po_is_hub(v_po -> 'metadata')
      or not app_private.procurement_delivery_row_is_open_plan(v_batch) then
      raise exception using errcode = '42501', message = v_locked_message;
    end if;
    foreach v_field in array v_receipt_fields loop
      if (p_op = 'INSERT' and app_private.procurement_jsonb_qty(p_new -> v_field) <> '0')
        or (p_op = 'UPDATE' and (p_new -> v_field) is distinct from (p_old -> v_field)) then
        raise exception using errcode = '42501', message = v_locked_message;
      end if;
    end loop;
    return;
  end if;

  if p_table = 'requests' then
    foreach v_line_id in array app_private.material_request_ordered_line_ids(p_old ->> 'id') loop
      select line.value into v_old_line
      from jsonb_array_elements(case when jsonb_typeof(p_old -> 'items') = 'array' then p_old -> 'items' else '[]'::jsonb end) line(value)
      where line.value ->> 'lineId' = v_line_id limit 1;
      continue when v_old_line is null;
      select line.value into v_new_line
      from jsonb_array_elements(case when jsonb_typeof(p_new -> 'items') = 'array' then p_new -> 'items' else '[]'::jsonb end) line(value)
      where line.value ->> 'lineId' = v_line_id limit 1;
      if v_new_line is null
        or coalesce(v_new_line ->> 'itemId', '') is distinct from coalesce(v_old_line ->> 'itemId', '')
        or coalesce(v_new_line ->> 'unitSnapshot', v_new_line ->> 'unit', '') is distinct from coalesce(v_old_line ->> 'unitSnapshot', v_old_line ->> 'unit', '')
        or app_private.procurement_jsonb_qty(v_new_line -> 'requestQty') is distinct from app_private.procurement_jsonb_qty(v_old_line -> 'requestQty')
        or app_private.procurement_jsonb_qty(v_new_line -> 'approvedQty') is distinct from app_private.procurement_jsonb_qty(v_old_line -> 'approvedQty') then
        raise exception using errcode = '42501',
          message = 'LOCKED_MR_LINE_ORDERED: Dòng đã lập đơn mua — không đổi vật tư, số lượng, đơn vị hoặc xóa dòng. Cần đổi, báo Mua hàng điều chỉnh đơn.';
      end if;
    end loop;
    return;
  end if;
end;
$$;

-- Trigger SECURITY INVOKER để thấy current_user thật: RPC SECURITY DEFINER chạy bằng chủ hàm → bỏ qua.
create or replace function app_private.guard_procurement_source_direct_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and coalesce(current_setting('request.path', true), '') not like '/rpc/%' then
    perform app_private.procurement_assert_direct_write(
      tg_table_name,
      tg_op,
      case when tg_op = 'INSERT' then null else to_jsonb(old) end,
      case when tg_op = 'DELETE' then null else to_jsonb(new) end
    );
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Nhật ký trước/sau cho đợt giao và dòng đợt giao (giống lưu vết công nợ NCC).
create or replace function app_private.audit_purchase_delivery_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_fields text[] := array[]::text[];
  v_label text;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(field.key order by field.key), array[]::text[]) into v_fields
    from jsonb_each(v_new) field
    where field.key <> 'updated_at' and (v_old -> field.key) is distinct from field.value;
    if cardinality(v_fields) = 0 then
      return null;
    end if;
  end if;

  select coalesce(po.po_number, po.id) into v_label
  from public.purchase_orders po where po.id = v_row ->> 'purchase_order_id';
  v_label := coalesce(v_label, v_row ->> 'purchase_order_id', '')
    || case when tg_table_name = 'purchase_order_delivery_batches' then ' · đợt ' || coalesce(v_row ->> 'delivery_no', '?')
       else ' · ' || coalesce(v_row ->> 'item_id', '') end;

  insert into public.audit_trail (
    table_name, record_id, action, old_data, new_data, user_id, user_name, module, description,
    record_label, entity_type, changed_fields, change_count, context
  )
  values (
    tg_table_name,
    v_row ->> 'id',
    tg_op,
    coalesce(v_old, '{}'::jsonb),
    coalesce(v_new, '{}'::jsonb),
    public.current_app_user_id()::text,
    '',
    'DA',
    case when tg_table_name = 'purchase_order_delivery_batches' then 'Lưu vết đợt giao PO' else 'Lưu vết dòng đợt giao PO' end,
    v_label,
    'purchase_delivery',
    v_fields,
    cardinality(v_fields),
    jsonb_strip_nulls(jsonb_build_object('requestPath', nullif(current_setting('request.path', true), '')))
  );
  return null;
end;
$$;

revoke all on function app_private.supplier_payment_batch_finance_managed(jsonb) from public, anon;
revoke all on function app_private.procurement_jsonb_qty(jsonb) from public, anon, authenticated;
revoke all on function app_private.procurement_delivery_has_receipt(uuid) from public, anon, authenticated;
revoke all on function app_private.procurement_po_has_receipt(text) from public, anon, authenticated;
revoke all on function app_private.material_request_ordered_line_ids(text) from public, anon, authenticated;
revoke all on function app_private.material_request_has_open_po(text) from public, anon, authenticated;
revoke all on function app_private.procurement_po_row_locked(jsonb) from public, anon, authenticated;
revoke all on function app_private.procurement_delivery_row_is_open_plan(jsonb) from public, anon, authenticated;
revoke all on function app_private.procurement_assert_direct_write(text, text, jsonb, jsonb) from public, anon;
revoke all on function app_private.guard_procurement_source_direct_write() from public, anon, authenticated;
revoke all on function app_private.audit_purchase_delivery_change() from public, anon, authenticated;
-- Trigger INVOKER gọi hàm kiểm bằng vai người dùng; vỏ lưu nháp đợt chi (INVOKER) gọi hàm nhận diện đợt Tài chính.
grant execute on function app_private.procurement_assert_direct_write(text, text, jsonb, jsonb) to authenticated;
grant execute on function app_private.supplier_payment_batch_finance_managed(jsonb) to authenticated;

drop trigger if exists guard_procurement_source_direct_write on public.purchase_orders;
create trigger guard_procurement_source_direct_write
  before insert or update or delete on public.purchase_orders
  for each row execute function app_private.guard_procurement_source_direct_write();

drop trigger if exists guard_procurement_source_direct_write on public.purchase_order_delivery_batches;
create trigger guard_procurement_source_direct_write
  before insert or update or delete on public.purchase_order_delivery_batches
  for each row execute function app_private.guard_procurement_source_direct_write();

drop trigger if exists guard_procurement_source_direct_write on public.purchase_order_delivery_lines;
create trigger guard_procurement_source_direct_write
  before insert or update or delete on public.purchase_order_delivery_lines
  for each row execute function app_private.guard_procurement_source_direct_write();

drop trigger if exists guard_procurement_source_direct_write on public.purchase_order_request_lines;
create trigger guard_procurement_source_direct_write
  before insert or update or delete on public.purchase_order_request_lines
  for each row execute function app_private.guard_procurement_source_direct_write();

drop trigger if exists guard_procurement_source_direct_write on public.requests;
create trigger guard_procurement_source_direct_write
  before update of items on public.requests
  for each row when (old.items is distinct from new.items)
  execute function app_private.guard_procurement_source_direct_write();

drop trigger if exists trg_audit_purchase_order_delivery_batches on public.purchase_order_delivery_batches;
create trigger trg_audit_purchase_order_delivery_batches
  after insert or update or delete on public.purchase_order_delivery_batches
  for each row execute function app_private.audit_purchase_delivery_change();

drop trigger if exists trg_audit_purchase_order_delivery_lines on public.purchase_order_delivery_lines;
create trigger trg_audit_purchase_order_delivery_lines
  after insert or update or delete on public.purchase_order_delivery_lines
  for each row execute function app_private.audit_purchase_delivery_change();

-- Lệnh cũ đổi trạng thái PO: từ chối PO Mua hàng; không hủy / đưa về nháp đơn đã nhận hàng.
CREATE OR REPLACE FUNCTION public.transition_project_purchase_order_status(p_po_id text, p_status text, p_patch jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po public.purchase_orders%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_target_status text;
  v_target_user_id uuid;
  v_previous_guard text;
  v_is_wms_actor boolean;
begin
  if v_user_id is null then
    raise exception 'Không xác định được người dùng chuyển trạng thái PO.' using errcode = '42501';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if not found then raise exception 'Không tìm thấy PO.'; end if;

  -- 23/10: PO lập tại Mua hàng chỉ đổi trạng thái bằng lệnh của Mua hàng / Kho.
  if app_private.procurement_po_is_hub(v_po.metadata) then
    raise exception using errcode = '42501',
      message = 'LOCKED_HUB_PO: Đơn lập tại màn Mua hàng — gửi, duyệt, hủy, kết thúc đơn ở màn Mua hàng.';
  end if;

  v_target_status := coalesce(nullif(p_status, ''), v_po.status);
  v_is_wms_actor := public.is_admin()
    or app_private.current_user_is_global_wms_keeper()
    or app_private.current_user_is_wms_keeper_for(v_po.target_warehouse_id);

  if coalesce(v_po.source_mode, 'project') = 'company_consolidated' then
    if not (
      public.is_admin()
      or app_private.company_procurement_can_manage()
      or v_is_wms_actor
    ) then
      raise exception 'Bạn không có quyền chuyển trạng thái PO tổng hợp công ty.' using errcode = '42501';
    end if;
  elsif public.is_admin() then
    null;
  elsif v_target_status = 'sent' then
    if v_po.status not in ('draft', 'returned')
      or nullif(v_po.created_by_id, '') <> v_user_id::text
      or not app_private.project_actor_has_effective_room_action(
        v_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'submit'
      ) then
      raise exception 'Chỉ người tạo có quyền Gửi mới được gửi PO draft/returned.' using errcode = '42501';
    end if;
    v_target_user_id := nullif(p_patch->>'submitted_to_user_id', '')::uuid;
    if v_target_user_id is null
      or not app_private.project_user_has_room_action(
        v_target_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Người nhận phải có quyền Duyệt thuần trong Room Đơn hàng PO.' using errcode = '42501';
    end if;
  elsif v_target_status in ('confirmed', 'returned') then
    if v_po.status <> 'sent'
      or v_po.submitted_to_user_id is null
      or v_po.submitted_to_user_id::text <> v_user_id::text
      or not app_private.project_actor_has_effective_room_action(
        v_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'approve'
      ) then
      raise exception 'Bạn cần quyền Duyệt và phải là người được giao xử lý PO.' using errcode = '42501';
    end if;
  elsif p_patch ? 'received_transaction_ids' or p_patch ? 'actual_delivery_date' then
    if not v_is_wms_actor then
      raise exception 'Quyền Xác nhận PO không thay thế quyền ghi nhận tồn kho WMS.' using errcode = '42501';
    end if;
  elsif v_target_status in ('in_transit', 'partial', 'delivered', 'closed') then
    if not (
      v_is_wms_actor
      or app_private.project_actor_has_effective_room_action(
        v_user_id, v_po.project_id, v_po.construction_site_id, 'material_po', 'confirm'
      )
    ) then
      raise exception 'Bạn cần quyền Xác nhận để quản lý giao nhận PO.' using errcode = '42501';
    end if;
  elsif v_target_status = 'cancelled' then
    if not v_is_wms_actor then
      raise exception 'Chỉ System Admin hoặc Thủ kho được hủy PO.' using errcode = '42501';
    end if;
  else
    raise exception 'Transition PO từ % sang % không hợp lệ.', v_po.status, v_target_status
      using errcode = '42501';
  end if;

  -- Đơn đã nhận hàng không được hủy / đưa về nháp (đề xuất sẽ mở lại "Cần mua" trong khi hàng đã vào kho).
  if v_target_status in ('cancelled', 'draft', 'returned')
    and v_target_status is distinct from v_po.status
    and app_private.procurement_po_has_receipt(v_po.id) then
    raise exception using errcode = '42501',
      message = 'LOCKED_RECEIVED: Đơn đã nhận hàng — không hủy hoặc đưa về nháp; dùng trả hàng NCC hoặc kết thúc thiếu.';
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.purchase_orders
  set
    status = v_target_status,
    submitted_to_user_id = case
      when v_target_status = 'returned' then null
      when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '')
      else submitted_to_user_id
    end,
    submitted_to_name = case
      when v_target_status = 'returned' then null
      when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '')
      else submitted_to_name
    end,
    submitted_to_permission = case
      when v_target_status = 'returned' then null
      when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '')
      else submitted_to_permission
    end,
    submission_note = case
      when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '')
      else submission_note
    end,
    ever_submitted = case
      when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted)
      else ever_submitted
    end,
    last_action_by = v_user_id::text,
    last_action_at = now(),
    received_transaction_ids = case
      when p_patch ? 'received_transaction_ids' then coalesce(p_patch->'received_transaction_ids', '[]'::jsonb)
      else received_transaction_ids
    end,
    actual_delivery_date = case
      when p_patch ? 'actual_delivery_date' then nullif(p_patch->>'actual_delivery_date', '')
      else actual_delivery_date
    end
  where id = p_po_id;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$function$;

-- Lệnh cũ đổi trạng thái đề xuất: từ chối phiếu chạy quy trình hoặc đã có đơn mua.
CREATE OR REPLACE FUNCTION public.transition_project_material_request_status(p_request_id text, p_status text, p_action text, p_actor_user_id text, p_target_user_id text DEFAULT NULL::text, p_target_permission text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_patch jsonb DEFAULT '{}'::jsonb)
 RETURNS requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request public.requests%rowtype;
  v_user_id uuid := public.current_app_user_id();
  v_required_permission text;
  v_room_action text;
  v_target_room_action text;
  v_previous_guard text;
begin
  if v_user_id is null or p_actor_user_id is distinct from v_user_id::text then
    raise exception 'Không xác định được người dùng chuyển bước phiếu vật tư.'
      using errcode = '42501';
  end if;

  select *
  into v_request
  from public.requests
  where id = p_request_id
    and coalesce(request_origin, 'wms') = 'project'
  for update;

  if not found then
    raise exception 'Không tìm thấy phiếu vật tư dự án.';
  end if;

  -- 23/10: phiếu chạy quy trình động hoặc đã lập đơn mua không đổi trạng thái bằng lệnh cũ.
  if v_request.workflow_instance_id is not null then
    raise exception using errcode = '42501',
      message = 'LOCKED_MR_WORKFLOW: Phiếu chạy theo quy trình — duyệt, trả lại, chuyển bước trong quy trình của phiếu.';
  end if;
  if app_private.material_request_has_open_po(v_request.id) then
    raise exception using errcode = '42501',
      message = 'LOCKED_MR_ORDERED: Phiếu đã lập đơn mua — không đổi trạng thái bằng thao tác cũ.';
  end if;

  v_required_permission := case
    when upper(coalesce(p_action, '')) in ('SUBMITTED', 'RESUBMITTED') then 'project.material_request.submit'
    when upper(coalesce(p_action, '')) in ('RETURNED', 'REJECTED') then 'project.material_request.approve'
    when upper(coalesce(p_action, '')) in ('FULFILLED', 'CONFIRMED', 'CONFIRM_FULFILLMENT') then 'project.material_request.confirm_fulfillment'
    when coalesce(p_patch->>'workflow_step', '') in ('site_quality_check', 'completed')
      or upper(coalesce(p_status, '')) in ('COMPLETED', 'IN_TRANSIT') then 'project.material_request.confirm_fulfillment'
    else 'project.material_request.approve'
  end;
  v_room_action := app_private.project_room_action_from_material_permission(v_required_permission);

  if v_required_permission = 'project.material_request.submit' then
    if coalesce(v_request.status::text, 'DRAFT') not in ('DRAFT', 'REJECTED') then
      raise exception 'Chỉ phiếu nháp hoặc bị trả lại mới được gửi duyệt.';
    end if;
    if v_request.requester_id is distinct from v_user_id then
      raise exception 'Chỉ người tạo phiếu mới được gửi duyệt.'
        using errcode = '42501';
    end if;
  elsif v_request.submitted_to_user_id is not null
    and v_request.submitted_to_user_id <> v_user_id::text then
    raise exception 'Bạn không phải người đang được giao xử lý phiếu vật tư này.'
      using errcode = '42501';
  end if;

  perform app_private.assert_project_permission_room_action(
    v_request.project_id::text,
    v_request.construction_site_id::text,
    'material_request',
    v_room_action,
    v_user_id
  );

  if nullif(p_target_user_id, '') is not null then
    v_target_room_action := app_private.project_room_action_from_material_permission(p_target_permission);
    perform app_private.assert_project_permission_room_action(
      v_request.project_id::text,
      v_request.construction_site_id::text,
      'material_request',
      v_target_room_action,
      p_target_user_id::uuid
    );
  end if;

  v_previous_guard := current_setting('app.material_transition_context', true);
  perform set_config('app.material_transition_context', 'on', true);

  update public.requests
  set
    status = coalesce(nullif(p_status, '')::public.request_status, status),
    logs = case when p_patch ? 'logs' then p_patch->'logs' else logs end,
    ever_submitted = case when p_patch ? 'ever_submitted' then coalesce((p_patch->>'ever_submitted')::boolean, ever_submitted) else ever_submitted end,
    last_action_by = case when p_patch ? 'last_action_by' then nullif(p_patch->>'last_action_by', '') else last_action_by end,
    last_action_at = case when p_patch ? 'last_action_at' then nullif(p_patch->>'last_action_at', '')::timestamptz else last_action_at end,
    workflow_step = case when p_patch ? 'workflow_step' then nullif(p_patch->>'workflow_step', '') else workflow_step end,
    workflow_step_started_at = case when p_patch ? 'workflow_step_started_at' then nullif(p_patch->>'workflow_step_started_at', '')::timestamptz else workflow_step_started_at end,
    workflow_step_due_at = case when p_patch ? 'workflow_step_due_at' then nullif(p_patch->>'workflow_step_due_at', '')::timestamptz else workflow_step_due_at end,
    workflow_step_sla_hours = case when p_patch ? 'workflow_step_sla_hours' then nullif(p_patch->>'workflow_step_sla_hours', '')::integer else workflow_step_sla_hours end,
    workflow_step_actor_user_id = case when p_patch ? 'workflow_step_actor_user_id' then nullif(p_patch->>'workflow_step_actor_user_id', '') else workflow_step_actor_user_id end,
    submitted_to_user_id = case when p_patch ? 'submitted_to_user_id' then nullif(p_patch->>'submitted_to_user_id', '') else submitted_to_user_id end,
    submitted_to_name = case when p_patch ? 'submitted_to_name' then nullif(p_patch->>'submitted_to_name', '') else submitted_to_name end,
    submitted_to_permission = case when p_patch ? 'submitted_to_permission' then nullif(p_patch->>'submitted_to_permission', '') else submitted_to_permission end,
    submission_note = case when p_patch ? 'submission_note' then nullif(p_patch->>'submission_note', '') else submission_note end
  where id = p_request_id
  returning * into v_request;

  perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
  return v_request;
exception
  when others then
    perform set_config('app.material_transition_context', coalesce(v_previous_guard, ''), true);
    raise;
end;
$function$;

-- Xóa PO: từ chối PO Mua hàng và đơn đã nhận hàng.
CREATE OR REPLACE FUNCTION public.remove_purchase_order_v1(p_po_id text)
 RETURNS TABLE(action text, id text, po_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_po public.purchase_orders%rowtype;
  v_has_permission boolean := false;
  v_has_stock_impact boolean := false;
  v_received_transaction_ids text[] := array[]::text[];
  v_fulfillment_transaction_ids text[] := array[]::text[];
  v_supplier_return_transaction_ids text[] := array[]::text[];
  v_supplier_return_ids uuid[] := array[]::uuid[];
  v_supplier_return_text_ids text[] := array[]::text[];
  v_cleanup_transaction_ids text[] := array[]::text[];
begin
  select *
    into v_po
  from public.purchase_orders
  where public.purchase_orders.id = p_po_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO cần xoá/lưu trữ.';
  end if;

  if v_po.archived_at is not null then
    raise exception 'PO đã được lưu trữ.';
  end if;

  -- 23/10: PO Mua hàng xóa / hủy ở màn Mua hàng.
  if app_private.procurement_po_is_hub(v_po.metadata) then
    raise exception using errcode = '42501',
      message = 'LOCKED_HUB_PO: Đơn lập tại màn Mua hàng — xóa đơn nháp hoặc hủy đơn ở màn Mua hàng.';
  end if;

  v_has_permission := public.is_admin()
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text
    or app_private.material_has_action(
      v_po.project_id::text,
      v_po.construction_site_id::text,
      'project.material_po.delete',
      public.current_app_user_id()
    );

  if not v_has_permission then
    raise exception 'Bạn cần quyền xoá PO, quyền quản trị PO, hoặc là người tạo PO để xoá/lưu trữ phiếu này.'
      using errcode = '42501';
  end if;

  if app_private.project_po_has_pending_work_v1(v_po.id::text) then
    raise exception 'PO đang có đợt giao/giao dịch chờ xử lý. Vui lòng huỷ hoặc xử lý xong trước khi xoá.';
  end if;

  v_has_stock_impact := app_private.project_po_has_stock_impact_v1(
    v_po.id::text,
    v_po.received_transaction_ids,
    v_po.items
  );

  -- Đơn đã có đợt nhận hàng không được xóa cứng (mất đợt giao, phiếu nhập, công nợ).
  if not v_has_stock_impact and app_private.procurement_po_has_receipt(v_po.id::text) then
    raise exception using errcode = '42501',
      message = 'LOCKED_RECEIVED: Đơn đã nhận hàng — không xóa; dùng trả hàng NCC hoặc kết thúc thiếu.';
  end if;

  if not v_has_stock_impact then
    select coalesce(array_agg(distinct tx_id), array[]::text[])
      into v_received_transaction_ids
    from (
      select jsonb_array_elements_text(
        case
          when jsonb_typeof(coalesce(v_po.received_transaction_ids, '[]'::jsonb)) = 'array'
            then coalesce(v_po.received_transaction_ids, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) as tx_id
    ) tx
    where nullif(tx_id, '') is not null;

    if to_regclass('public.material_request_fulfillment_batches') is not null
       and to_regclass('public.material_request_fulfillment_lines') is not null then
      select coalesce(array_agg(distinct batch.transaction_id::text), array[]::text[])
        into v_fulfillment_transaction_ids
      from public.material_request_fulfillment_lines line
      join public.material_request_fulfillment_batches batch
        on batch.id = line.batch_id
      where line.po_id = v_po.id::text
        and batch.transaction_id is not null;
    end if;

    if to_regclass('public.purchase_order_supplier_returns') is not null then
      select coalesce(array_agg(distinct r.id), array[]::uuid[]),
             coalesce(array_agg(distinct r.transaction_id::text) filter (where r.transaction_id is not null), array[]::text[])
        into v_supplier_return_ids, v_supplier_return_transaction_ids
      from public.purchase_order_supplier_returns r
      where r.purchase_order_id = v_po.id::text;

      select coalesce(array_agg(ids.return_id::text), array[]::text[])
        into v_supplier_return_text_ids
      from unnest(v_supplier_return_ids) as ids(return_id);
    end if;

    select coalesce(array_agg(distinct tx_id), array[]::text[])
      into v_cleanup_transaction_ids
    from (
      select unnest(v_received_transaction_ids) as tx_id
      union
      select unnest(v_fulfillment_transaction_ids) as tx_id
      union
      select unnest(v_supplier_return_transaction_ids) as tx_id
    ) tx
    where nullif(tx_id, '') is not null;

    if to_regclass('public.project_document_links') is not null then
      delete from public.project_document_links link
      where (link.source_type = 'purchase_order' and link.source_id = v_po.id::text)
         or (link.target_type = 'purchase_order' and link.target_id = v_po.id::text)
         or (link.source_type = 'transaction' and link.source_id = any(v_cleanup_transaction_ids))
         or (link.target_type = 'transaction' and link.target_id = any(v_cleanup_transaction_ids))
         or (link.source_type = 'supplier_return' and link.source_id = any(v_supplier_return_text_ids))
         or (link.target_type = 'supplier_return' and link.target_id = any(v_supplier_return_text_ids));
    end if;

    if to_regclass('public.purchase_order_supplier_return_lines') is not null
       and coalesce(array_length(v_supplier_return_ids, 1), 0) > 0 then
      delete from public.purchase_order_supplier_return_lines line
      where line.supplier_return_id = any(v_supplier_return_ids);
    end if;

    if to_regclass('public.purchase_order_supplier_returns') is not null then
      delete from public.purchase_order_supplier_returns r
      where r.purchase_order_id = v_po.id::text;
    end if;

    if to_regclass('public.material_request_fulfillment_batches') is not null
       and to_regclass('public.material_request_fulfillment_lines') is not null then
      delete from public.material_request_fulfillment_batches batch
      where exists (
        select 1
        from public.material_request_fulfillment_lines line
        where line.batch_id = batch.id
          and line.po_id = v_po.id::text
      );
    end if;

    if coalesce(array_length(v_cleanup_transaction_ids, 1), 0) > 0 then
      delete from public.transactions t
      where t.id::text = any(v_cleanup_transaction_ids)
        and upper(coalesce(t.status::text, '')) <> 'COMPLETED'
        and not exists (
          select 1
          from public.inventory_ledger_entries entry
          where entry.source_type = 'wms_transaction'
            and entry.source_id = t.id::text
        )
        and (
          to_regclass('public.material_request_fulfillment_batches') is null
          or not exists (
            select 1
            from public.material_request_fulfillment_batches batch
            where batch.transaction_id::text = t.id::text
          )
        )
        and (
          to_regclass('public.purchase_order_supplier_returns') is null
          or not exists (
            select 1
            from public.purchase_order_supplier_returns r
            where r.transaction_id::text = t.id::text
          )
        );
    end if;

    if to_regclass('public.purchase_order_delivery_batches') is not null then
      delete from public.purchase_order_delivery_batches batch
      where batch.purchase_order_id = v_po.id::text;
    end if;

    if to_regclass('public.purchase_order_delivery_groups') is not null then
      delete from public.purchase_order_delivery_groups delivery_group
      where delivery_group.purchase_order_id = v_po.id::text;
    end if;

    delete from public.purchase_orders
    where public.purchase_orders.id = v_po.id;

    if to_regclass('public.project_document_links') is not null then
      delete from public.project_document_links link
      where (link.source_type = 'purchase_order' and link.source_id = v_po.id::text)
         or (link.target_type = 'purchase_order' and link.target_id = v_po.id::text);
    end if;

    action := 'deleted';
    id := v_po.id::text;
    po_number := v_po.po_number::text;
    return next;
    return;
  end if;

  if not app_private.project_po_can_archive_v1(
    v_po.id::text,
    v_po.project_id::text,
    v_po.construction_site_id::text,
    v_po.status::text,
    v_po.ever_submitted,
    v_po.received_transaction_ids,
    v_po.items
  ) then
    raise exception 'PO đã phát sinh kho và chưa đủ điều kiện lưu trữ. Vui lòng hoàn trả/đối soát đủ trước.';
  end if;

  update public.purchase_orders
  set archived_at = now(),
      archived_by = public.current_app_user_id(),
      archive_reason = 'Người dùng lưu trữ PO từ tab Cung ứng'
  where public.purchase_orders.id = v_po.id;

  action := 'archived';
  id := v_po.id::text;
  po_number := v_po.po_number::text;
  return next;
end;
$function$;

-- Xóa đợt giao: từ chối PO Mua hàng và đợt đã nhận.
CREATE OR REPLACE FUNCTION public.remove_purchase_order_delivery_batch_v1(p_delivery_batch_id uuid)
 RETURNS TABLE(action text, id text, purchase_order_id text, po_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_delivery public.purchase_order_delivery_batches%rowtype;
  v_po public.purchase_orders%rowtype;
  v_has_permission boolean := false;
  v_batch_ids uuid[] := array[]::uuid[];
  v_transaction_ids text[] := array[]::text[];
begin
  select *
    into v_delivery
  from public.purchase_order_delivery_batches
  where public.purchase_order_delivery_batches.id = p_delivery_batch_id
  for update;

  if not found then
    raise exception 'Không tìm thấy đợt giao cần xoá.';
  end if;

  select *
    into v_po
  from public.purchase_orders
  where public.purchase_orders.id = v_delivery.purchase_order_id
  for update;

  if not found then
    raise exception 'Không tìm thấy PO của đợt giao.';
  end if;

  -- 23/10: đợt giao của PO Mua hàng hủy ở màn Mua hàng; đợt đã nhận không xóa.
  if app_private.procurement_po_is_hub(v_po.metadata) then
    raise exception using errcode = '42501',
      message = 'LOCKED_HUB_PO: Đơn lập tại màn Mua hàng — hủy đợt giao ở màn Mua hàng.';
  end if;
  if app_private.procurement_delivery_has_receipt(v_delivery.id) then
    raise exception using errcode = '42501',
      message = 'LOCKED_RECEIVED: Đợt giao đã nhận hàng — không xóa; dùng sửa số nhận hoặc trả hàng NCC.';
  end if;

  v_has_permission := public.is_admin()
    or nullif(v_po.created_by_id, '') = public.current_app_user_id()::text;

  if not v_has_permission then
    raise exception 'Chỉ Admin hoặc người tạo PO được xoá đợt giao này.'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct batch.id), array[]::uuid[]),
         coalesce(array_agg(distinct batch.transaction_id::text) filter (where batch.transaction_id is not null), array[]::text[])
    into v_batch_ids, v_transaction_ids
  from public.material_request_fulfillment_batches batch
  where batch.po_delivery_batch_id = p_delivery_batch_id;

  if coalesce(array_length(v_batch_ids, 1), 0) > 0 then
    if exists (
      select 1
      from public.material_request_fulfillment_batches batch
      where batch.id = any(v_batch_ids)
        and lower(coalesce(batch.status::text, '')) not in ('returned', 'cancelled')
    ) then
      raise exception 'Chỉ xoá được đợt giao đã bị từ chối/huỷ và không còn chờ xử lý.';
    end if;

    if exists (
      select 1
      from public.material_request_fulfillment_lines line
      where line.batch_id = any(v_batch_ids)
        and coalesce(line.received_qty, 0) > 0
    ) then
      raise exception 'Đợt giao đã phát sinh thực nhận, không thể xoá.';
    end if;
  end if;

  if coalesce(array_length(v_transaction_ids, 1), 0) > 0 then
    if exists (
      select 1
      from public.transactions tx
      where tx.id::text = any(v_transaction_ids)
        and tx.status = 'COMPLETED'::public.transaction_status
    ) then
      raise exception 'Đợt giao đã có phiếu kho hoàn tất, không thể xoá.';
    end if;

    if to_regclass('public.inventory_ledger_entries') is not null
       and exists (
         select 1
         from public.inventory_ledger_entries entry
         where entry.source_type = 'wms_transaction'
           and entry.source_id = any(v_transaction_ids)
       ) then
      raise exception 'Đợt giao đã phát sinh ledger kho, không thể xoá.';
    end if;
  end if;

  if to_regclass('public.project_document_links') is not null then
    delete from public.project_document_links link
    where (link.source_type = 'transaction' and link.source_id = any(v_transaction_ids))
       or (link.target_type = 'transaction' and link.target_id = any(v_transaction_ids));
  end if;

  if coalesce(array_length(v_batch_ids, 1), 0) > 0 then
    delete from public.material_request_fulfillment_batches batch
    where batch.id = any(v_batch_ids);
  end if;

  if coalesce(array_length(v_transaction_ids, 1), 0) > 0 then
    delete from public.transactions tx
    where tx.id::text = any(v_transaction_ids)
      and tx.status <> 'COMPLETED'::public.transaction_status
      and (
        to_regclass('public.inventory_ledger_entries') is null
        or not exists (
          select 1
          from public.inventory_ledger_entries entry
          where entry.source_type = 'wms_transaction'
            and entry.source_id = tx.id::text
        )
      )
      and not exists (
        select 1
        from public.material_request_fulfillment_batches batch
        where batch.transaction_id::text = tx.id::text
      )
      and (
        to_regclass('public.purchase_order_supplier_returns') is null
        or not exists (
          select 1
          from public.purchase_order_supplier_returns r
          where r.transaction_id::text = tx.id::text
        )
      );
  end if;

  delete from public.purchase_order_delivery_batches
  where public.purchase_order_delivery_batches.id = p_delivery_batch_id;

  action := 'deleted';
  id := p_delivery_batch_id::text;
  purchase_order_id := v_po.id::text;
  po_number := v_po.po_number::text;
  return next;
end;
$function$;

-- Lệnh kho chung: không duyệt / hoàn tất phiếu nhập của đợt giao PO (process_transaction_approval gọi qua hàm này).
CREATE OR REPLACE FUNCTION public.process_transaction_status(p_transaction_id text, p_status transaction_status, p_approver_id uuid)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_line jsonb;
  v_pending jsonb;
  v_item_id text;
  v_qty numeric;
  v_can_approve boolean := false;
  v_can_complete boolean := false;
begin
  if p_status is null or p_status not in (
    'APPROVED'::public.transaction_status,
    'COMPLETED'::public.transaction_status,
    'CANCELLED'::public.transaction_status
  ) then
    raise exception 'unsupported transaction status target: %', p_status
      using errcode = '22023';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  -- 23/10: phiếu nhập theo đợt giao PO chỉ duyệt / nhập qua lệnh nhận hàng (ghi kho + PO + công nợ cùng lúc).
  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status)
    and v_tx.source_type = 'po_delivery_batch' then
    raise exception using errcode = '42501',
      message = 'WMS_PO_RECEIPT_COMMAND: Phiếu nhập theo đơn mua chỉ nhận ở bước Nhận hàng của phiếu (ghi kho, đơn mua và công nợ cùng lúc).';
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if p_approver_id is not null and p_approver_id is distinct from v_user.id then
    raise exception 'approver id must match the authenticated user'
      using errcode = '42501';
  end if;

  v_can_approve := app_private.wms_transaction_has_action(
    'wms.transaction.approve', v_tx.type,
    v_tx.source_warehouse_id, v_tx.target_warehouse_id, v_tx.items,
    v_tx.requester_id, v_tx.approver_id, v_user.id
  );

  v_can_complete := app_private.wms_transaction_has_action(
    'wms.transaction.complete', v_tx.type,
    v_tx.source_warehouse_id, v_tx.target_warehouse_id, v_tx.items,
    v_tx.requester_id, v_tx.approver_id, v_user.id
  );

  -- V1-2: người Duyệt ngoại lệ duyệt / hoàn tất được phiếu xuất hủy, điều chỉnh (tách nhiệm kiểm ở trg_guard_wms_exception_approval).
  if v_tx.type::text in ('LIQUIDATION', 'ADJUSTMENT')
     and app_private.wms_user_can_approve_exception(v_user.id, coalesce(v_tx.source_warehouse_id, v_tx.target_warehouse_id)) then
    v_can_approve := true;
    v_can_complete := true;
  end if;

  if p_status = 'APPROVED'::public.transaction_status and not v_can_approve then
    raise exception 'insufficient privilege to approve transaction'
      using errcode = '42501';
  end if;

  if p_status = 'CANCELLED'::public.transaction_status
     and not v_can_approve
     and v_tx.requester_id is distinct from v_user.id then
    raise exception 'insufficient privilege to cancel transaction'
      using errcode = '42501';
  end if;

  if p_status = 'COMPLETED'::public.transaction_status and not v_can_complete then
    raise exception 'insufficient privilege to complete transaction'
      using errcode = '42501';
  end if;

  if v_tx.status = p_status then
    return v_tx;
  end if;
  if v_tx.status = 'CANCELLED'::public.transaction_status then
    raise exception 'cancelled transaction cannot be changed';
  end if;
  if v_tx.status = 'COMPLETED'::public.transaction_status then
    raise exception 'completed transaction cannot be changed';
  end if;

  if p_status in ('APPROVED'::public.transaction_status, 'COMPLETED'::public.transaction_status) then
    for v_pending in
      select value from jsonb_array_elements(coalesce(v_tx.pending_items, '[]'::jsonb))
    loop
      insert into public.items (
        id, sku, name, category, unit, purchase_unit,
        price_in, price_out, min_stock, supplier_id, image_url,
        stock_by_warehouse, location
      )
      values (
        v_pending->>'id',
        v_pending->>'sku',
        v_pending->>'name',
        coalesce(nullif(v_pending->>'category', ''), 'Khác'),
        coalesce(nullif(v_pending->>'unit', ''), 'Cái'),
        nullif(v_pending->>'purchaseUnit', ''),
        coalesce(nullif(v_pending->>'priceIn', '')::numeric, 0),
        coalesce(nullif(v_pending->>'priceOut', '')::numeric, 0),
        coalesce(nullif(v_pending->>'minStock', '')::integer, 0),
        nullif(v_pending->>'supplierId', ''),
        nullif(v_pending->>'imageUrl', ''),
        coalesce(v_pending->'stockByWarehouse', '{}'::jsonb),
        nullif(v_pending->>'location', '')
      )
      on conflict (id) do nothing;
    end loop;
  end if;

  if p_status = 'COMPLETED'::public.transaction_status then
    for v_line in
      select value from jsonb_array_elements(v_tx.items)
    loop
      v_item_id := v_line->>'itemId';
      v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
      if v_item_id is null or v_qty <= 0 then
        raise exception 'invalid transaction item payload';
      end if;

      if v_tx.type = 'IMPORT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type in ('EXPORT'::public.transaction_type, 'LIQUIDATION'::public.transaction_type) then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
      elsif v_tx.type = 'TRANSFER'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.source_warehouse_id, -v_qty);
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      elsif v_tx.type = 'ADJUSTMENT'::public.transaction_type then
        perform public.apply_stock_change(v_item_id, v_tx.target_warehouse_id, v_qty);
      end if;
    end loop;
  end if;

  update public.transactions
  set status = p_status,
      approver_id = v_user.id
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$function$;

-- Sửa số trên phiếu kho chung: không áp cho phiếu nhập của đợt giao PO.
CREATE OR REPLACE FUNCTION public.update_transaction_items_for_receipt(p_transaction_id text, p_items jsonb)
 RETURNS transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tx public.transactions%rowtype;
  v_user public.users%rowtype;
  v_item_count integer;
  v_idx integer;
  v_old_item jsonb;
  v_new_item jsonb;
  v_old_qty numeric;
  v_new_qty numeric;
  v_ordered_qty numeric;
  v_can_adjust boolean := false;
begin
  select * into v_tx
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'transaction not found: %', p_transaction_id;
  end if;

  if v_tx.source_type = 'po_delivery_batch' then
    raise exception using errcode = '42501',
      message = 'WMS_PO_RECEIPT_COMMAND: Phiếu nhập theo đơn mua chỉ nhận ở bước Nhận hàng của phiếu (ghi kho, đơn mua và công nợ cùng lúc).';
  end if;

  select * into v_user from public.users where id = public.current_app_user_id();
  if v_user.id is null then
    raise exception 'authentication required';
  end if;

  if v_tx.status not in ('PENDING'::public.transaction_status, 'APPROVED'::public.transaction_status) then
    raise exception 'Chỉ được điều chỉnh số lượng ở bước chờ duyệt hoặc chờ xác nhận nhập.';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid transaction items payload';
  end if;

  v_item_count := jsonb_array_length(coalesce(v_tx.items, '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'Phiếu kho không có dòng vật tư để điều chỉnh.';
  end if;
  if jsonb_array_length(p_items) <> v_item_count then
    raise exception 'Không được thêm/xóa dòng vật tư khi duyệt phiếu kho.';
  end if;

  v_can_adjust := app_private.wms_transaction_has_action(
    case
      when v_tx.status = 'PENDING'::public.transaction_status
        then 'wms.transaction.approve'
      else 'wms.transaction.complete'
    end,
    v_tx.type,
    v_tx.source_warehouse_id,
    v_tx.target_warehouse_id,
    v_tx.items,
    v_tx.requester_id,
    v_tx.approver_id,
    v_user.id
  );

  if not v_can_adjust then
    raise exception 'insufficient privilege to adjust transaction quantities'
      using errcode = '42501';
  end if;

  for v_idx in 0..(v_item_count - 1) loop
    v_old_item := v_tx.items -> v_idx;
    v_new_item := p_items -> v_idx;

    if v_old_item is null or v_new_item is null then
      raise exception 'invalid transaction items payload';
    end if;

    if coalesce(v_old_item->>'itemId', '') is distinct from coalesce(v_new_item->>'itemId', '')
       or coalesce(v_old_item->>'requestLineId', '') is distinct from coalesce(v_new_item->>'requestLineId', '')
       or coalesce(v_old_item->>'fulfillmentBatchId', '') is distinct from coalesce(v_new_item->>'fulfillmentBatchId', '') then
      raise exception 'Không được đổi vật tư/dòng đề xuất khi duyệt phiếu kho.';
    end if;

    v_old_qty := coalesce(nullif(v_old_item->>'quantity', '')::numeric, 0);
    v_new_qty := coalesce(nullif(v_new_item->>'quantity', '')::numeric, 0);
    v_ordered_qty := coalesce(
      nullif(v_new_item->>'orderedQty', '')::numeric,
      nullif(v_new_item->>'ordered_qty', '')::numeric,
      v_old_qty
    );

    if v_new_qty < 0 then
      raise exception 'Số lượng thực nhận không được âm.';
    end if;
    if v_ordered_qty < 0 then
      raise exception 'Số lượng đặt không được âm.';
    end if;
    if v_new_qty is distinct from v_ordered_qty
       and nullif(trim(coalesce(v_new_item->>'varianceReason', '')), '') is null
       and nullif(trim(coalesce(v_new_item->>'variance_reason', '')), '') is null then
      raise exception 'Phải nhập lý do khi số lượng thực nhận lệch số lượng trên phiếu.';
    end if;
  end loop;

  update public.transactions
  set items = p_items
  where id = p_transaction_id
  returning * into v_tx;

  return v_tx;
end;
$function$;

-- Lõi chi đợt chi NCC: đợt của đề nghị chi / chi ngoài chỉ chạy trong lệnh Tài chính.
CREATE OR REPLACE FUNCTION app_private.post_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS supplier_payment_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_batch public.supplier_payment_batches%rowtype;
begin
  select * into v_batch from public.supplier_payment_batches where id = p_batch_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- 23/10: đợt chi sinh từ đề nghị chi / chi ngoài chỉ chi trong lệnh Tài chính (app.finance_context).
  if app_private.supplier_payment_batch_finance_managed(v_batch.metadata)
    and coalesce(current_setting('app.finance_context', true), '') <> 'on' then
    raise exception using errcode = '42501',
      message = 'LOCKED_FINANCE_PAYMENT: Đợt chi của đề nghị chi / chi ngoài chỉ chi hoặc đảo ở màn Tài chính.';
  end if;
  if app_private.finance_period_is_locked(v_batch.project_id, v_batch.construction_site_id, v_batch.currency, v_batch.payment_date) then
    raise exception 'FINANCE_PERIOD_LOCKED' using errcode = '55000';
  end if;
  perform document.id from public.supplier_payment_allocations allocation
  join public.supplier_payable_documents document on document.id = allocation.payable_document_id
  where allocation.payment_batch_id = p_batch_id order by document.id for update of document;
  return app_private.post_supplier_payment_batch_engine_g7(p_batch_id, p_actor_id);
end;
$function$;

-- Lõi đảo đợt chi NCC: đợt của đề nghị chi / chi ngoài chỉ chạy trong lệnh Tài chính.
CREATE OR REPLACE FUNCTION app_private.reverse_supplier_payment_batch(p_batch_id uuid, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS supplier_payment_batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_batch public.supplier_payment_batches%rowtype;
begin
  select * into v_batch from public.supplier_payment_batches where id = p_batch_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  -- 23/10: đợt chi sinh từ đề nghị chi / chi ngoài chỉ đảo trong lệnh Tài chính (app.finance_context).
  if app_private.supplier_payment_batch_finance_managed(v_batch.metadata)
    and coalesce(current_setting('app.finance_context', true), '') <> 'on' then
    raise exception using errcode = '42501',
      message = 'LOCKED_FINANCE_PAYMENT: Đợt chi của đề nghị chi / chi ngoài chỉ chi hoặc đảo ở màn Tài chính.';
  end if;
  if app_private.finance_period_is_locked(v_batch.project_id, v_batch.construction_site_id, v_batch.currency, current_date) then
    raise exception 'FINANCE_PERIOD_LOCKED' using errcode = '55000';
  end if;
  perform document.id from public.supplier_payment_allocations allocation
  join public.supplier_payable_documents document on document.id = allocation.payable_document_id
  where allocation.payment_batch_id = p_batch_id order by document.id for update of document;
  return app_private.reverse_supplier_payment_batch_engine_g7(p_batch_id, p_actor_id);
end;
$function$;

-- Lưu nháp đợt chi (bản cũ): không sửa đợt chi của đề nghị chi / chi ngoài.
CREATE OR REPLACE FUNCTION public.save_supplier_payment_batch_draft_v1(p_batch jsonb, p_allocations jsonb DEFAULT '[]'::jsonb, p_expected_row_version bigint DEFAULT NULL::bigint, p_actor_user_id uuid DEFAULT NULL::uuid, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := coalesce(p_actor_user_id, public.current_app_user_id());
begin
  if public.current_app_user_id() is null or v_actor <> public.current_app_user_id() then
    raise exception 'SUPPLIER_PAYMENT_ACTOR_INVALID' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.supplier_payment_batches batch
    where batch.id::text = p_batch ->> 'id'
      and app_private.supplier_payment_batch_finance_managed(batch.metadata)
  ) then
    raise exception using errcode = '42501',
      message = 'LOCKED_FINANCE_PAYMENT: Đợt chi của đề nghị chi / chi ngoài chỉ chi hoặc đảo ở màn Tài chính.';
  end if;
  return app_private.save_supplier_payment_batch_draft_v1(
    p_batch,
    p_allocations,
    p_expected_row_version,
    v_actor,
    p_idempotency_key
  );
end;
$function$;

-- Chi / đảo đợt chi bản cũ (không ma trận duyệt, không ghi sổ quỹ): giao diện không còn gọi; chỉ lệnh Tài chính
-- (SECURITY DEFINER) và bản _v2 dùng lõi app_private.
revoke execute on function public.post_supplier_payment_batch(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.reverse_supplier_payment_batch(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.post_supplier_payment_batch(uuid, uuid) from public, anon, authenticated;
revoke execute on function app_private.reverse_supplier_payment_batch(uuid, uuid) from public, anon, authenticated;
