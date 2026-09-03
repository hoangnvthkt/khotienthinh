-- Retire only the rejected MR/PO V3/V4 command surfaces after the
-- neutral practical-flow commands have been deployed and verified.

do $$
begin
  if exists (select 1 from public.purchase_order_master_estimates)
     or exists (select 1 from public.purchase_order_master_estimate_versions)
     or exists (select 1 from public.purchase_order_receipts)
     or exists (select 1 from public.purchase_order_receipt_lines) then
    raise exception 'Cannot retire rejected PO tables because they contain data.';
  end if;
end;
$$;

-- When several batches are pending together, the reason belongs to the batch
-- that creates the overage; approving another in-range batch must remain valid.
create or replace function app_private.assert_material_po_batch_overage_reason(
  p_purchase_order_id text,
  p_delivery_batch_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    with active_allocated as (
      select
        line.purchase_order_line_id,
        sum(coalesce(line.stock_planned_qty, line.planned_qty, 0)) as allocated_qty
      from public.purchase_order_delivery_batches batch
      join public.purchase_order_delivery_lines line on line.delivery_batch_id = batch.id
      where batch.purchase_order_id = p_purchase_order_id
        and batch.status <> 'cancelled'
        and (
          batch.id = p_delivery_batch_id
          or coalesce(batch.approval_status, 'draft') in ('pending_approval', 'approved')
        )
      group by line.purchase_order_line_id
    ), requested as (
      select
        coalesce(item.value ->> 'lineId', item.value ->> 'itemId') as line_id,
        coalesce(
          nullif(item.value ->> 'requestedQtySnapshot', '')::numeric,
          nullif(item.value ->> 'qty', '')::numeric,
          0
        ) as requested_qty
      from public.purchase_orders po
      cross join lateral jsonb_array_elements(coalesce(po.items, '[]'::jsonb)) item(value)
      where po.id = p_purchase_order_id
    )
    select 1
    from active_allocated allocated
    join requested on requested.line_id = allocated.purchase_order_line_id
    where allocated.allocated_qty > requested.requested_qty + 0.000001
  ) and not exists (
    select 1
    from public.purchase_order_delivery_batches batch
    where batch.purchase_order_id = p_purchase_order_id
      and batch.status <> 'cancelled'
      and (
        batch.id = p_delivery_batch_id
        or coalesce(batch.approval_status, 'draft') in ('pending_approval', 'approved')
      )
      and coalesce(trim(batch.variance_reason), '') <> ''
  ) then
    raise exception 'Tổng các đợt đang duyệt/đã duyệt vượt nhu cầu MR; phải nhập lý do.'
      using errcode = '22023';
  end if;
end;
$$;

drop function if exists public.save_purchase_order_master_estimate_v1(text, boolean, jsonb, text, text, uuid);
drop function if exists public.issue_purchase_order_master_estimate_v1(text, uuid);
drop function if exists public.save_purchase_order_delivery_batch_draft_v2(text, uuid, date, numeric, text, text, jsonb, uuid);
drop function if exists public.delete_purchase_order_delivery_batch_draft_v2(uuid, uuid);
drop function if exists public.submit_purchase_order_delivery_batch_approval_v2(uuid, uuid, uuid);
drop function if exists public.decide_purchase_order_delivery_batch_approval_v2(uuid, text, text, uuid);
drop function if exists public.approve_purchase_order_delivery_batch_v2(uuid, uuid);
drop function if exists public.record_purchase_order_receipt_v3(uuid, uuid, text, boolean, text, jsonb, jsonb, uuid);
drop function if exists public.confirm_purchase_order_receipt_variance_v1(uuid, text, uuid);

drop function if exists public.save_purchase_order_delivery_batch_draft_v4(text, uuid, date, numeric, text, text, jsonb, uuid);
drop function if exists public.delete_purchase_order_delivery_batch_draft_v4(uuid, uuid);
drop function if exists public.submit_purchase_order_delivery_batch_approval_v4(uuid, uuid, uuid);
drop function if exists public.decide_purchase_order_delivery_batch_approval_v4(uuid, text, text, uuid);
drop function if exists public.approve_purchase_order_delivery_batch_v4(uuid, uuid);
drop function if exists public.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid);

drop function if exists app_private.confirm_purchase_order_receipt_variance_v1(uuid, text, uuid);
drop function if exists app_private.record_purchase_order_receipt_v3(uuid, uuid, text, boolean, text, jsonb, jsonb, uuid);
drop function if exists app_private.record_purchase_order_receipt_v4(uuid, uuid, text, text, jsonb, jsonb, uuid);
drop function if exists app_private.post_purchase_order_receipt_finance_v3(uuid, uuid);

drop function if exists app_private.approve_purchase_order_delivery_batch_v2(uuid, uuid);
drop function if exists app_private.approve_purchase_order_delivery_batch_v4(uuid, uuid);
drop function if exists app_private.approve_purchase_order_delivery_batch_without_wms_v4_legacy(uuid, uuid);
drop function if exists app_private.ensure_purchase_order_delivery_wms_v4(uuid, uuid);
drop function if exists app_private.ensure_mr_fulfillment_for_delivery_batch_v3(uuid, uuid);

drop function if exists app_private.decide_purchase_order_delivery_batch_approval_v2(uuid, text, text, uuid);
drop function if exists app_private.submit_purchase_order_delivery_batch_approval_v2(uuid, uuid, uuid);
drop function if exists app_private.delete_purchase_order_delivery_batch_draft_v2(uuid, uuid);
drop function if exists app_private.save_purchase_order_delivery_batch_draft_v2(text, uuid, date, numeric, text, text, jsonb, uuid);
drop function if exists app_private.assert_delivery_batch_overage_reason_v2(text, uuid);

drop function if exists app_private.decide_purchase_order_delivery_batch_approval_v4(uuid, text, text, uuid);
drop function if exists app_private.submit_purchase_order_delivery_batch_approval_v4(uuid, uuid, uuid);
drop function if exists app_private.delete_purchase_order_delivery_batch_draft_v4(uuid, uuid);
drop function if exists app_private.save_purchase_order_delivery_batch_draft_v4(text, uuid, date, numeric, text, text, jsonb, uuid);
drop function if exists app_private.assert_mr_po_flow_v4_actor_v1(text, text, uuid);

drop function if exists app_private.issue_purchase_order_master_estimate_v1(text, uuid);
drop function if exists app_private.save_purchase_order_master_estimate_v1(text, boolean, jsonb, text, text, uuid);
drop function if exists app_private.assert_mr_po_flow_v3_actor_v1(text, text, uuid);

drop table public.purchase_order_receipt_lines;
drop table public.purchase_order_receipts;
drop table public.purchase_order_master_estimate_versions;
drop table public.purchase_order_master_estimates;

drop function if exists app_private.set_mr_po_flow_v3_updated_at();

notify pgrst, 'reload schema';
