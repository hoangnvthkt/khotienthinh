create schema if not exists app_private;

alter table public.supplier_direct_delivery_lines
  add column if not exists wms_flow_mode text not null default 'none',
  add column if not exists target_warehouse_id text references public.warehouses(id) on delete set null,
  add column if not exists wms_import_transaction_id text references public.transactions(id) on delete set null,
  add column if not exists wms_export_transaction_id text references public.transactions(id) on delete set null,
  add column if not exists wms_status text not null default 'not_required';

alter table public.supplier_direct_delivery_lines
  drop constraint if exists supplier_direct_delivery_lines_wms_flow_mode_check,
  drop constraint if exists supplier_direct_delivery_lines_wms_status_check,
  drop constraint if exists supplier_direct_delivery_lines_direct_wms_required_check;

alter table public.supplier_direct_delivery_lines
  add constraint supplier_direct_delivery_lines_wms_flow_mode_check
  check (wms_flow_mode in ('none', 'direct_in_out')),
  add constraint supplier_direct_delivery_lines_wms_status_check
  check (wms_status in ('not_required', 'import_pending', 'imported', 'export_pending', 'exported', 'blocked')),
  add constraint supplier_direct_delivery_lines_direct_wms_required_check
  check (
    wms_flow_mode <> 'direct_in_out'
    or (item_id is not null and target_warehouse_id is not null)
  );

update public.supplier_direct_delivery_lines
set wms_status = 'not_required'
where wms_flow_mode = 'none'
  and wms_status is distinct from 'not_required';

create index if not exists idx_supplier_direct_delivery_lines_target_warehouse
  on public.supplier_direct_delivery_lines(target_warehouse_id)
  where wms_flow_mode = 'direct_in_out';

create index if not exists idx_supplier_direct_delivery_lines_wms_import
  on public.supplier_direct_delivery_lines(wms_import_transaction_id)
  where wms_import_transaction_id is not null;

create index if not exists idx_supplier_direct_delivery_lines_wms_export
  on public.supplier_direct_delivery_lines(wms_export_transaction_id)
  where wms_export_transaction_id is not null;

create index if not exists idx_supplier_direct_delivery_lines_wms_status
  on public.supplier_direct_delivery_lines(wms_status, delivery_note_id)
  where wms_flow_mode = 'direct_in_out';

create or replace function app_private.supplier_direct_delivery_line_statement_ready(p_delivery_line_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      dl.status in ('accepted', 'adjusted')
      and (
        coalesce(dl.wms_flow_mode, 'none') <> 'direct_in_out'
        or dl.wms_status = 'exported'
      )
    from public.supplier_direct_delivery_lines dl
    where dl.id = p_delivery_line_id
  ), false);
$$;

create or replace function app_private.guard_supplier_delivery_statement_line_wms()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.supplier_direct_delivery_lines%rowtype;
begin
  select * into v_line
  from public.supplier_direct_delivery_lines
  where id = new.delivery_line_id;

  if not found then
    raise exception 'Không tìm thấy dòng giao nhận HĐ NCC %. ', new.delivery_line_id;
  end if;

  if v_line.status not in ('accepted', 'adjusted') then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  if coalesce(v_line.wms_flow_mode, 'none') = 'direct_in_out'
    and coalesce(v_line.wms_status, 'not_required') <> 'exported'
  then
    raise exception 'Dòng nhập-xuất thẳng % phải hoàn tất WMS import và WMS xuất dùng trước khi đối soát/AP.', v_line.item_name_snapshot;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_supplier_delivery_statement_line_wms
on public.supplier_delivery_statement_lines;
create trigger trg_guard_supplier_delivery_statement_line_wms
before insert or update of delivery_line_id
on public.supplier_delivery_statement_lines
for each row execute function app_private.guard_supplier_delivery_statement_line_wms();

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
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

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
          id, type, date, items, source_warehouse_id, supplier_id,
          requester_id, created_by, approver_id, status, note, related_request_id
        )
        values (
          v_export_tx_id,
          'EXPORT',
          now(),
          v_group.items,
          v_group.target_warehouse_id,
          new.supplier_id,
          new.requester_id,
          coalesce(new.created_by, new.requester_id),
          new.approver_id,
          'PENDING',
          trim('Xuất dùng ngay từ phiếu giao HĐ ' || v_note_code || ' ' || v_supplier_name),
          'supplier-direct-delivery:' || v_group.delivery_note_id::text
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

drop trigger if exists trg_supplier_direct_delivery_wms_from_transaction
on public.transactions;
create trigger trg_supplier_direct_delivery_wms_from_transaction
after update of status
on public.transactions
for each row execute function app_private.sync_supplier_direct_delivery_wms_from_transaction();

create or replace function public.post_supplier_delivery_statement(p_statement_id uuid, p_actor_id uuid default null)
returns public.supplier_delivery_statements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_statement public.supplier_delivery_statements%rowtype;
  v_contract public.supplier_contracts%rowtype;
  v_document public.supplier_payable_documents%rowtype;
  v_gross numeric(18,2);
  v_vat numeric(18,2);
  v_total numeric(18,2);
  v_blocked_item text;
begin
  select * into v_statement
  from public.supplier_delivery_statements
  where id = p_statement_id
  for update;

  if not found then
    raise exception 'Không tìm thấy bảng đối soát HĐ NCC %. ', p_statement_id;
  end if;

  if not app_private.ap_scope_can_mutate(v_statement.project_id, v_statement.construction_site_id) then
    raise exception 'Bạn không có quyền post bảng đối soát này.';
  end if;

  if v_statement.status = 'posted' then
    return v_statement;
  end if;

  if v_statement.status in ('cancelled', 'reversed') then
    raise exception 'Không thể post bảng đối soát đã huỷ/đảo.';
  end if;

  select * into v_contract
  from public.supplier_contracts
  where id = v_statement.supplier_contract_id;

  if not found then
    raise exception 'Không tìm thấy HĐ NCC %. ', v_statement.supplier_contract_id;
  end if;

  if v_contract.status = 'cancelled' then
    raise exception 'Không thể ghi nhận phải trả từ HĐ NCC đã huỷ.';
  end if;

  if not exists (
    select 1
    from public.supplier_delivery_statement_lines
    where statement_id = p_statement_id
  ) then
    raise exception 'Bảng đối soát chưa có dòng giao nhận được duyệt.';
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
    where sl.statement_id = p_statement_id
      and dl.status not in ('accepted', 'adjusted')
  ) then
    raise exception 'Bảng đối soát chỉ được gồm dòng giao nhận accepted/adjusted.';
  end if;

  select dl.item_name_snapshot into v_blocked_item
  from public.supplier_delivery_statement_lines sl
  join public.supplier_direct_delivery_lines dl on dl.id = sl.delivery_line_id
  where sl.statement_id = p_statement_id
    and coalesce(dl.wms_flow_mode, 'none') = 'direct_in_out'
    and coalesce(dl.wms_status, 'not_required') <> 'exported'
  limit 1;

  if v_blocked_item is not null then
    raise exception 'Dòng nhập-xuất thẳng % phải hoàn tất WMS import và WMS xuất dùng trước khi post AP.', v_blocked_item;
  end if;

  if exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    join public.supplier_delivery_statement_lines other_sl on other_sl.delivery_line_id = sl.delivery_line_id
    join public.supplier_delivery_statements other_s on other_s.id = other_sl.statement_id
    where sl.statement_id = p_statement_id
      and other_sl.statement_id <> p_statement_id
      and other_s.status in ('draft', 'posted')
  ) then
    raise exception 'Có dòng giao nhận đã nằm trong bảng đối soát khác.';
  end if;

  select
    coalesce(sum(accepted_amount), 0)::numeric(18,2),
    coalesce(sum(vat_amount), 0)::numeric(18,2),
    coalesce(sum(total_amount), 0)::numeric(18,2)
  into v_gross, v_vat, v_total
  from public.supplier_delivery_statement_lines
  where statement_id = p_statement_id;

  if v_total <= 0 then
    raise exception 'Bảng đối soát chưa có giá trị được duyệt.';
  end if;

  update public.supplier_delivery_statements
  set
    gross_amount = v_gross,
    vat_amount = v_vat,
    total_amount = v_total,
    status = 'posted',
    posted_by = coalesce(p_actor_id, posted_by),
    posted_at = coalesce(posted_at, now()),
    supplier_contract_code = coalesce(supplier_contract_code, v_contract.code),
    supplier_id = coalesce(supplier_id, v_contract.supplier_id),
    supplier_name_snapshot = coalesce(nullif(supplier_name_snapshot, ''), v_contract.supplier_name, 'Nhà cung cấp'),
    updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  update public.supplier_direct_delivery_lines dl
  set statement_id = p_statement_id, updated_at = now()
  from public.supplier_delivery_statement_lines sl
  where sl.statement_id = p_statement_id
    and sl.delivery_line_id = dl.id;

  update public.supplier_direct_delivery_notes note
  set status = 'statemented', updated_at = now()
  where exists (
    select 1
    from public.supplier_delivery_statement_lines sl
    where sl.statement_id = p_statement_id
      and sl.delivery_note_id = note.id
  )
  and not exists (
    select 1
    from public.supplier_direct_delivery_lines dl
    where dl.delivery_note_id = note.id
      and dl.status in ('accepted', 'adjusted')
      and dl.statement_id is null
  );

  v_document := public.sync_supplier_payable_from_delivery_statement(p_statement_id);

  update public.supplier_delivery_statements
  set payable_document_id = v_document.id, updated_at = now()
  where id = p_statement_id
  returning * into v_statement;

  return v_statement;
end;
$$;

revoke all on function app_private.supplier_direct_delivery_line_statement_ready(uuid) from public, anon, authenticated;
revoke all on function app_private.guard_supplier_delivery_statement_line_wms() from public, anon, authenticated;
revoke all on function app_private.sync_supplier_direct_delivery_wms_from_transaction() from public, anon, authenticated;
revoke all on function public.post_supplier_delivery_statement(uuid, uuid) from public, anon;
grant execute on function public.post_supplier_delivery_statement(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
