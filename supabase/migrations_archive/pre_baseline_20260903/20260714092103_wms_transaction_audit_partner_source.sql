alter table public.transactions
  add column if not exists created_by uuid references public.users(id) on delete set null,
  add column if not exists updated_by uuid references public.users(id) on delete set null,
  add column if not exists business_partner_id text references public.business_partners(id) on delete set null,
  add column if not exists business_partner_name_snapshot text,
  add column if not exists source_type text,
  add column if not exists source_id text;

create index if not exists idx_transactions_created_by
  on public.transactions(created_by);

create index if not exists idx_transactions_business_partner
  on public.transactions(business_partner_id)
  where business_partner_id is not null;

create index if not exists idx_transactions_source
  on public.transactions(source_type, source_id)
  where source_type is not null and source_id is not null;

create or replace function app_private.sync_supplier_direct_delivery_wms_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_export_tx_id text;
  v_note_code text;
  v_supplier_name text;
  v_actor_id uuid;
  v_uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  v_actor_id := coalesce(
    new.created_by,
    case
      when new.requester_id::text ~* v_uuid_pattern then new.requester_id::text::uuid
      else null
    end
  );

  if exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.wms_import_transaction_id = new.id
      and dl.wms_flow_mode = 'direct_in_out'
  ) then
    if upper(coalesce(new.status::text, '')) = 'COMPLETED' then
      update public.supplier_direct_delivery_lines dl
      set wms_status = 'imported', updated_at = now()
      where dl.wms_import_transaction_id = new.id
        and dl.wms_flow_mode = 'direct_in_out'
        and dl.wms_status in ('not_required', 'import_pending', 'blocked');

      for v_group in
        select
          dl.delivery_note_id,
          dl.target_warehouse_id,
          min(note.code) as note_code,
          min(note.supplier_name_snapshot) as supplier_name,
          min(note.supplier_id::text) as supplier_id_text,
          jsonb_agg(
            jsonb_build_object(
              'itemId', dl.item_id,
              'quantity', coalesce(nullif(dl.accepted_quantity, 0), dl.quantity),
              'price', 0,
              'accountingQty', coalesce(nullif(dl.accepted_quantity, 0), dl.quantity),
              'accountingUnit', dl.unit_snapshot,
              'accountingPrice', 0,
              'supplierDirectDeliveryNoteId', dl.delivery_note_id,
              'supplierDirectDeliveryLineId', dl.id,
              'supplierDeliveryWmsFlow', 'direct_in_out'
            )
            order by dl.line_no
          ) as items,
          array_agg(dl.id order by dl.line_no) as line_ids
        from public.supplier_direct_delivery_lines dl
        join public.supplier_direct_delivery_notes note on note.id = dl.delivery_note_id
        where dl.wms_import_transaction_id = new.id
          and dl.wms_flow_mode = 'direct_in_out'
          and dl.wms_status = 'imported'
          and dl.wms_export_transaction_id is null
        group by dl.delivery_note_id, dl.target_warehouse_id
      loop
        v_export_tx_id := 'tx-supplier-delivery-export-' || replace(gen_random_uuid()::text, '-', '');
        v_note_code := coalesce(v_group.note_code, v_group.delivery_note_id::text);
        v_supplier_name := coalesce(v_group.supplier_name, '');

        insert into public.transactions (
          id, type, date, items, source_warehouse_id,
          requester_id, created_by, updated_by, approver_id, status, note,
          related_request_id, business_partner_id, business_partner_name_snapshot,
          source_type, source_id
        )
        values (
          v_export_tx_id,
          'EXPORT',
          now(),
          v_group.items,
          v_group.target_warehouse_id,
          new.requester_id,
          v_actor_id,
          coalesce(new.updated_by, v_actor_id),
          new.approver_id,
          'PENDING',
          trim('Xuất dùng ngay từ phiếu giao HĐ ' || v_note_code || ' ' || v_supplier_name),
          'supplier-direct-delivery:' || v_group.delivery_note_id::text,
          coalesce(new.business_partner_id, nullif(v_group.supplier_id_text, '')),
          coalesce(new.business_partner_name_snapshot, nullif(v_supplier_name, '')),
          'supplier_direct_delivery_note',
          v_group.delivery_note_id::text
        );

        update public.supplier_direct_delivery_lines dl
        set
          wms_export_transaction_id = v_export_tx_id,
          wms_status = 'export_pending',
          updated_at = now()
        where dl.id = any(v_group.line_ids);
      end loop;
    elsif upper(coalesce(new.status::text, '')) = 'CANCELLED' then
      update public.supplier_direct_delivery_lines dl
      set wms_status = 'blocked', updated_at = now()
      where dl.wms_import_transaction_id = new.id
        and dl.wms_flow_mode = 'direct_in_out'
        and dl.wms_status <> 'exported';
    end if;
  end if;

  if exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.wms_export_transaction_id = new.id
      and dl.wms_flow_mode = 'direct_in_out'
  ) then
    if upper(coalesce(new.status::text, '')) = 'COMPLETED' then
      update public.supplier_direct_delivery_lines dl
      set wms_status = 'exported', updated_at = now()
      where dl.wms_export_transaction_id = new.id
        and dl.wms_flow_mode = 'direct_in_out';
    elsif upper(coalesce(new.status::text, '')) = 'CANCELLED' then
      update public.supplier_direct_delivery_lines dl
      set wms_status = 'blocked', updated_at = now()
      where dl.wms_export_transaction_id = new.id
        and dl.wms_flow_mode = 'direct_in_out'
        and dl.wms_status <> 'exported';
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
