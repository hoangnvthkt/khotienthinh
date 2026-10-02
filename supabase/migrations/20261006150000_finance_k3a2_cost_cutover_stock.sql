-- ===========================================================================
-- K3a-2 — Mốc chi phí MISA, chặn nhập trùng, mua dự trữ Kho Tổng (02/10/2026)
-- Thiết kế: docs/designs/project-closed-loop-2026-09-30/08-trung-tam-tai-chinh-k3.md mục 4.3, 10
--
-- Luật nghiệp vụ (chủ sản phẩm duyệt 02/10):
-- * Mốc chi phí theo dự án (SMB 01/08/2026, DA29 20/08/2026): trước mốc, chi phí dự án lấy từ MISA.
--   Chi phí vật tư do Vioo tự sinh (nhận hàng, đối soát HĐ, trả NCC) có ngày trước mốc → số tiền về 0,
--   số gốc giữ ở misa_overlap_amount + nhãn "[Đã có trong MISA]" để truy vết. Đổi mốc thì tự tính lại.
-- * Nhập file MISA vào sổ giao dịch dự án: chặn dòng VẬT TƯ có ngày từ mốc trở đi (Vioo đã ghi khi nhận hàng)
--   và chặn dòng trùng (cùng số chứng từ, số tiền, ngày, diễn giải đã nhập trước đó).
-- * Mua dự trữ Kho Tổng (đơn chủ động mục đích "stock"): công nợ NCC ghi cấp CÔNG TY (không gắn dự án),
--   KHÔNG ghi chi phí dự án lúc nhận hàng. Chi phí vào dự án khi chuyển kho sang kho công trường của dự án
--   (theo giá vốn sổ kho); chuyển ngược về Kho Tổng / sang dự án khác thì dự án gửi được ghi giảm.
--   Phiếu chuyển bị hủy sau khi hoàn tất → các dòng chi phí đó về 0 kèm nhãn. Dòng giá vốn bằng 0 ghi nhật ký để xử lý.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Mốc chi phí theo dự án
-- ---------------------------------------------------------------------------
create table public.finance_project_cost_cutovers (
  project_id text primary key references public.projects(id),
  cutover_date date not null,
  note text not null,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.finance_project_cost_cutovers enable row level security;
create policy finance_project_cost_cutovers_select on public.finance_project_cost_cutovers for select to authenticated using (true);
revoke all on public.finance_project_cost_cutovers from anon;
revoke insert, update, delete on public.finance_project_cost_cutovers from authenticated;
grant select on public.finance_project_cost_cutovers to authenticated;

insert into public.finance_project_cost_cutovers (project_id, cutover_date, note) values
  ('b4ce0810-2cac-44af-a83f-8bb1a361567a', date '2026-08-01', 'Số MISA đã nhập vào Vioo đến 31/07/2026 (nhập ngày 17/08/2026)'),
  ('d3d25b49-0623-40eb-99ac-b96f6ac0855a', date '2026-08-20', 'Số MISA đã nhập vào Vioo đến 19/08/2026 (nhập ngày 04/09/2026)');

alter table public.project_transactions add column misa_overlap_amount numeric(18,2);

create function app_private.finance_text_date(p text)
returns date language sql immutable set search_path = '' as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}' then left(p, 10)::date end;
$$;

-- Chi phí vật tư do Vioo tự sinh từ chứng từ NCC (không gồm khoản chi tiền — supplier_payment_batch là dòng tiền thật).
create function app_private.finance_is_vioo_supplier_cost(p_source text, p_ref text)
returns boolean language sql immutable set search_path = '' as $$
  select p_source = 'workflow' and (p_ref like 'purchase_receipt:%' or p_ref like 'purchase_receipt_return:%'
    or p_ref like 'supplier_payable_document:%:recognition');
$$;

create function app_private.trg_project_transaction_finance_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_cut date; v_date date := app_private.finance_text_date(new.date);
begin
  -- Hàng dự trữ của công ty (PO không gắn dự án): không ghi chi phí dự án lúc nhận / trả hàng.
  if tg_op = 'INSERT' and new.source = 'workflow' and new.project_id is null and coalesce(new.construction_site_id, '') = ''
    and (new.source_ref like 'purchase_receipt:%' or new.source_ref like 'purchase_receipt_return:%') then
    return null;
  end if;
  select cutover_date into v_cut from public.finance_project_cost_cutovers where project_id = new.project_id;
  if tg_op = 'INSERT' and new.source = 'import' and new.project_id is not null then
    if v_cut is not null and new.type = 'expense' and new.category = 'materials' and v_date >= v_cut then
      raise exception using errcode = '22023', message = 'MISA_IMPORT_AFTER_CUTOVER',
        detail = 'Vật tư từ ' || to_char(v_cut, 'DD/MM/YYYY') || ' do Vioo ghi khi nhận hàng — không nhập từ MISA.';
    end if;
    if nullif(btrim(new.invoice_no), '') is not null and exists (select 1 from public.project_transactions t
        where t.project_id = new.project_id and t.source = 'import' and t.invoice_no = new.invoice_no and t.amount = new.amount
          and t.date = new.date and t.description is not distinct from new.description and t.id <> new.id) then
      raise exception using errcode = '22023', message = 'MISA_IMPORT_DUPLICATE', detail = new.invoice_no;
    end if;
  end if;
  if app_private.finance_is_vioo_supplier_cost(new.source, new.source_ref) then
    if v_cut is not null and v_date is not null and v_date < v_cut then
      if coalesce(new.amount, 0) <> 0 then
        new.misa_overlap_amount := new.amount; new.amount := 0;
        if coalesce(new.description, '') not like '[Đã có trong MISA]%' then
          new.description := '[Đã có trong MISA] ' || coalesce(new.description, ''); end if;
      end if;
    elsif new.misa_overlap_amount is not null then
      new.amount := new.misa_overlap_amount; new.misa_overlap_amount := null;
      new.description := regexp_replace(coalesce(new.description, ''), '^\[Đã có trong MISA\] ', '');
    end if;
  end if;
  return new;
end $$;
create trigger trg_project_transaction_finance_guard before insert or update on public.project_transactions
  for each row execute function app_private.trg_project_transaction_finance_guard();

-- Áp mốc cho dữ liệu đã có (nếu có chi phí Vioo trước mốc).
update public.project_transactions t set description = t.description
where app_private.finance_is_vioo_supplier_cost(t.source, t.source_ref)
  and t.project_id in (select project_id from public.finance_project_cost_cutovers);

create function public.get_finance_cost_cutovers_v1()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('cutovers', coalesce((select jsonb_agg(jsonb_build_object('projectId', c.project_id, 'projectCode', p.code, 'projectName', p.name,
    'cutoverDate', c.cutover_date, 'note', c.note, 'updatedAt', c.updated_at, 'updatedByName', (select name from public.users where id = c.updated_by),
    'overlapCount', (select count(*) from public.project_transactions t where t.project_id = c.project_id and t.misa_overlap_amount is not null),
    'overlapAmount', (select coalesce(sum(t.misa_overlap_amount), 0) from public.project_transactions t where t.project_id = c.project_id))
    order by p.code)
  from public.finance_project_cost_cutovers c join public.projects p on p.id = c.project_id), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name) order by p.code nulls last, p.name)
      from public.projects p where coalesce(p.status, '') not in ('cancelled')), '[]'::jsonb))
  where public.current_app_user_id() is not null;
$$;

create function public.save_finance_cost_cutover_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_project text := p_input->>'projectId';
  v_date date := nullif(p_input->>'cutoverDate', '')::date; v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_before jsonb; v_old numeric; v_new numeric;
begin
  if not app_private.finance_can('manage') then raise exception using errcode = '42501', message = 'FINANCE_MANAGE_DENIED'; end if;
  if v_reason is null then raise exception using errcode = '22023', message = 'FINANCE_REASON_REQUIRED'; end if;
  if not exists (select 1 from public.projects where id = v_project) then raise exception using errcode = '22023', message = 'FINANCE_DOCUMENT_SCOPE'; end if;
  select to_jsonb(c) into v_before from public.finance_project_cost_cutovers c where project_id = v_project;
  select coalesce(sum(amount), 0) into v_old from public.project_transactions where project_id = v_project and type = 'expense';
  if v_date is null then
    delete from public.finance_project_cost_cutovers where project_id = v_project;
  else
    insert into public.finance_project_cost_cutovers (project_id, cutover_date, note, updated_by, updated_at)
    values (v_project, v_date, coalesce(nullif(btrim(p_input->>'note'), ''), v_reason), v_actor, now())
    on conflict (project_id) do update set cutover_date = excluded.cutover_date, note = excluded.note, updated_by = v_actor, updated_at = now();
  end if;
  update public.project_transactions t set description = t.description
  where t.project_id = v_project and app_private.finance_is_vioo_supplier_cost(t.source, t.source_ref);
  select coalesce(sum(amount), 0) into v_new from public.project_transactions where project_id = v_project and type = 'expense';
  insert into public.finance_events (entity_type, entity_id, action, actor_id, reason, before, after, payload)
  values ('cost_cutover', v_project, 'cost_cutover_save', v_actor, v_reason, v_before,
    case when v_date is null then null else jsonb_build_object('cutoverDate', v_date) end,
    jsonb_build_object('expenseBefore', v_old, 'expenseAfter', v_new));
  perform app_private.finance_notify_admins('Đổi mốc chi phí MISA', coalesce((select code from public.projects where id = v_project), v_project)
    || ': ' || coalesce(to_char(v_date, 'DD/MM/YYYY'), 'bỏ mốc') || ' — ' || v_reason, v_actor);
  return jsonb_build_object('projectId', v_project, 'expenseBefore', v_old, 'expenseAfter', v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Công nợ / khoản chi cấp công ty (không gắn dự án)
-- ---------------------------------------------------------------------------
create function app_private.trg_finance_company_scope()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.project_id is null and coalesce(new.construction_site_id, '') = '' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('scope', 'company');
  end if;
  return new;
end $$;
create trigger trg_finance_company_scope before insert on public.supplier_payable_documents
  for each row execute function app_private.trg_finance_company_scope();
create trigger trg_finance_company_scope before insert on public.supplier_payment_batches
  for each row execute function app_private.trg_finance_company_scope();
alter table public.supplier_payable_documents drop constraint supplier_payable_documents_check;
alter table public.supplier_payable_documents add constraint supplier_payable_documents_scope_check
  check (project_id is not null or construction_site_id is not null or coalesce(metadata->>'scope', '') = 'company');
alter table public.supplier_payment_batches drop constraint supplier_payment_batches_check;
alter table public.supplier_payment_batches add constraint supplier_payment_batches_scope_check
  check (project_id is not null or construction_site_id is not null or coalesce(metadata->>'scope', '') = 'company');

-- ---------------------------------------------------------------------------
-- 3. Chuyển kho giữa kho có dự án khác nhau: chi phí đi theo hàng (giá vốn sổ kho)
-- ---------------------------------------------------------------------------
create function app_private.finance_warehouse_project(p_warehouse_id text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(w.project_id, (select p.id from public.projects p where p.construction_site_id::text = w.construction_site_id::text limit 1))
  from public.warehouses w where w.id = p_warehouse_id;
$$;

create function app_private.finance_insert_project_cost(p_project text, p_amount numeric, p_description text, p_date text, p_ref text, p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fin text; v_site text;
begin
  select id into v_fin from public.project_finances where project_id = p_project limit 1;
  select construction_site_id::text into v_site from public.projects where id = p_project;
  insert into public.project_transactions (id, "projectFinanceId", "constructionSiteId", project_id, project_finance_id, construction_site_id,
    type, category, amount, description, date, source, "sourceRef", source_ref, cost_classification_status, attachments, "createdBy", "createdAt")
  values ('fin-' || replace(p_ref, ':', '-'), coalesce(v_fin, ''), coalesce(v_site, ''), p_project, v_fin, v_site,
    'expense', 'materials', round(p_amount, 2), p_description, p_date, 'workflow', p_ref, p_ref, 'auto', '[]'::jsonb, p_actor, now())
  on conflict (source_ref) do nothing;
end $$;

create function app_private.trg_finance_transfer_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_src text; v_tgt text; v_value numeric; v_zero integer; v_date text := left(new.date::text, 10); v_code text;
begin
  if new.type::text <> 'TRANSFER' then return new; end if;
  if new.status::text = 'COMPLETED' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    v_src := app_private.finance_warehouse_project(new.source_warehouse_id);
    v_tgt := app_private.finance_warehouse_project(new.target_warehouse_id);
    if v_src is not distinct from v_tgt then return new; end if;
    select coalesce(sum(le.amount), 0), count(*) filter (where coalesce(le.amount, 0) = 0) into v_value, v_zero
    from public.inventory_ledger_entries le where le.source_id = new.id and le.movement_direction = 'in';
    v_code := 'Chuyển kho ' || coalesce((select name from public.warehouses where id = new.source_warehouse_id), '?')
      || ' → ' || coalesce((select name from public.warehouses where id = new.target_warehouse_id), '?') || ' (' || new.id || ')';
    if v_value > 0 then
      if v_tgt is not null then
        perform app_private.finance_insert_project_cost(v_tgt, v_value, 'Nhận vật tư: ' || v_code, v_date, 'stock_transfer:' || new.id || ':in', coalesce(new.approver_id, new.requester_id)::text);
      end if;
      if v_src is not null then
        perform app_private.finance_insert_project_cost(v_src, -v_value, 'Chuyển vật tư đi: ' || v_code, v_date, 'stock_transfer:' || new.id || ':out', coalesce(new.approver_id, new.requester_id)::text);
      end if;
    end if;
    if v_zero > 0 then
      insert into public.finance_events (entity_type, entity_id, action, payload)
      values ('stock_transfer', new.id, 'transfer_cost_missing', jsonb_build_object('lines', v_zero, 'sourceProject', v_src, 'targetProject', v_tgt));
    end if;
  elsif tg_op = 'UPDATE' and old.status::text = 'COMPLETED' and new.status::text <> 'COMPLETED' then
    update public.project_transactions set amount = 0, description = '[Phiếu chuyển đã hủy] ' || description
    where source_ref in ('stock_transfer:' || new.id || ':in', 'stock_transfer:' || new.id || ':out') and amount <> 0;
  end if;
  return new;
end $$;
create trigger zz_trg_finance_transfer_cost after insert or update on public.transactions
  for each row execute function app_private.trg_finance_transfer_cost();

-- ---------------------------------------------------------------------------
-- 4. Mua hàng: đơn chủ động mục đích "Dự trữ Kho Tổng"
-- ---------------------------------------------------------------------------
create or replace function public.list_procurement_proactive_options_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  return jsonb_build_object('projects', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name, 'status', p.status, 'warehouses', w.list)
      order by case when p.status = 'active' then 0 else 1 end, p.code nulls last, p.name)
    from public.projects p
    cross join lateral (select jsonb_agg(jsonb_build_object('id', wh.id, 'name', wh.name)
        order by coalesce(wh.is_default_for_site, false) desc, wh.name) list
      from public.warehouses wh
      where not coalesce(wh.is_archived, false) and wh.type = 'SITE'
        and (wh.project_id = p.id or (p.construction_site_id is not null and wh.construction_site_id = p.construction_site_id))) w
    where w.list is not null and coalesce(p.status, '') <> 'cancelled'), '[]'::jsonb),
    'stockWarehouses', coalesce((select jsonb_agg(jsonb_build_object('id', wh.id, 'name', wh.name) order by wh.name)
      from public.warehouses wh where not coalesce(wh.is_archived, false) and wh.type = 'GENERAL'), '[]'::jsonb));
end;
$$;


create or replace function public.save_procurement_proactive_po_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_project public.projects%rowtype;
  v_wh public.warehouses%rowtype;
  v_vendor record; v_item record; v_boq record;
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_reason_code text := nullif(p_input->>'reasonCode', '');
  v_reason text := nullif(btrim(p_input->>'reason'), '');
  v_over_reason text := nullif(btrim(p_input->>'overBoqReason'), '');
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_over integer := 0; v_seen text[] := '{}';
  v_purpose text := case when p_input->>'purpose' = 'stock' then 'stock' else 'project' end;
  it jsonb; v_line_id text; v_stock numeric; v_pqty numeric; v_punit text; v_price numeric; v_status text; v_meta jsonb;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if v_reason_code is null or v_reason_code not in ('price_lock', 'long_lead', 'min_stock', 'other')
    or (v_reason_code = 'other' and v_reason is null) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_REASON_REQUIRED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;
  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;
  if v_purpose = 'project' then
    select * into v_project from public.projects where id = nullif(p_input->>'projectId', '');
    if not found or v_project.status = 'cancelled' then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_REQUIRED'; end if;
    select * into v_wh from public.warehouses w
    where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'SITE'
      and (w.project_id = v_project.id or (v_project.construction_site_id is not null and w.construction_site_id = v_project.construction_site_id));
  else
    -- Dự trữ Kho Tổng: không gắn dự án; công nợ cấp công ty, chi phí vào dự án khi chuyển kho.
    select * into v_wh from public.warehouses w
    where w.id = nullif(p_input->>'targetWarehouseId', '') and not coalesce(w.is_archived, false) and w.type = 'GENERAL';
  end if;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  if v_po_id is not null then
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null
      or v_po.source_mode not in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project.id
      or v_po.source_mode <> (case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_PROJECT_LOCKED'; end if;
  end if;

  for it in select value from jsonb_array_elements(p_input->'items') loop
    select i.id, i.name, i.sku, i.unit,
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    into v_item from public.items i where i.id = it->>'itemId';
    if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_ITEM_NOT_FOUND'; end if;
    if v_item.id = any (v_seen) then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
    v_seen := v_seen || v_item.id;
    v_stock := nullif(it->>'stockQty', '')::numeric;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if v_stock is null or v_stock <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    v_punit := coalesce(nullif(btrim(it->>'purchaseUnit'), ''), v_item.purchase_unit, v_item.unit);
    v_pqty := case when nullif(it->>'purchaseQty', '') is not null then (it->>'purchaseQty')::numeric
      when v_item.purchase_unit is not null and v_punit = v_item.purchase_unit then round(v_stock / v_item.factor, 6)
      else v_stock end;
    if v_pqty is null or v_pqty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    v_line_id := nullif(it->>'lineId', '');
    if v_line_id is not null and (v_po_id is null or not exists (select 1 from jsonb_array_elements(v_po.items) x
        where x.value->>'lineId' = v_line_id and x.value->>'itemId' = v_item.id)) then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_LINE_INVALID'; end if;
    v_line_id := coalesce(v_line_id, 'mh-' || gen_random_uuid());
    select * into v_boq from app_private.procurement_project_item_boq(v_project.id, v_item.id, v_po_id);
    v_status := case when v_purpose = 'stock' then 'stock' when not v_boq.in_boq then 'outside'
      when v_boq.ordered_qty + v_stock > v_boq.boq_qty * 1.0001 + 0.0005 then 'over' else 'within' end;
    if v_status not in ('within', 'stock') then v_over := v_over + 1; end if;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_stock / v_pqty, 12), 'stockQty', v_stock,
      'qty', v_pqty, 'unitPrice', v_price, 'note', nullif(btrim(it->>'note'), ''),
      'boq', jsonb_build_object('status', v_status, 'boqQty', v_boq.boq_qty, 'orderedBefore', v_boq.ordered_qty))));
    v_total := v_total + v_pqty * v_price;
  end loop;
  if v_over > 0 and v_over_reason is null then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_OVER_BOQ_REASON'; end if;

  -- Dòng đã gắn nhu cầu phải còn, cùng vật tư, và SL không nhỏ hơn phần đã gắn.
  if v_po_id is not null and exists (
    select 1 from (select s.purchase_order_line_id line_id, s.item_id, sum(s.ordered_qty) q from (
        select purchase_order_line_id, item_id, ordered_qty from public.purchase_order_request_lines where purchase_order_id = v_po_id
        union all
        select purchase_order_line_id, item_id, ordered_qty from public.procurement_po_plan_links where purchase_order_id = v_po_id) s
      group by 1, 2) a
    where not exists (select 1 from jsonb_array_elements(v_items) x
      where x.value->>'lineId' = a.line_id and x.value->>'itemId' = a.item_id and (x.value->>'stockQty')::numeric >= a.q - 0.0005)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PROACTIVE_ALLOCATED'; end if;

  v_meta := jsonb_strip_nulls(jsonb_build_object('purpose', v_purpose, 'reasonCode', v_reason_code, 'reason', v_reason,
    'overBoqReason', case when v_over > 0 then v_over_reason end));
  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project.id, coalesce(v_wh.construction_site_id::text, v_project.construction_site_id::text),
      v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', case v_purpose when 'stock' then 'proactive_stock' else 'proactive_project' end, v_mode, 'RECEIVE_TO_STOCK',
      v_wh.id, nullif(btrim(p_input->>'note'), ''), v_actor::text, case v_purpose when 'stock' then 'Đơn dự trữ Kho Tổng lập tại Mua hàng' else 'Đơn chủ động lập tại Mua hàng' end,
      jsonb_build_object('channel', 'procurement_hub', 'proactive', v_meta))
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('purchase_order', v_po_id, 'create', v_actor, v_reason,
      jsonb_build_object('kind', 'proactive', 'reasonCode', v_reason_code, 'overBoq', v_over, 'overBoqReason', v_over_reason));
  else
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode,
      expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''), target_warehouse_id = v_wh.id,
      note = nullif(btrim(p_input->>'note'), ''), metadata = (metadata - 'proactive') || jsonb_build_object('proactive', v_meta)
    where id = v_po_id returning * into v_po;
    update public.purchase_order_request_lines set target_warehouse_id = v_wh.id where purchase_order_id = v_po_id;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id, reason, payload)
    values ('purchase_order', v_po_id, 'update', v_actor, v_reason,
      jsonb_build_object('kind', 'proactive', 'reasonCode', v_reason_code, 'overBoq', v_over, 'overBoqReason', v_over_reason));
  end if;
  perform set_config('app.procurement_hub_context', 'off', true);
  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items), 'overBoq', v_over);
end;
$$;

create or replace function public.list_procurement_orders_v1(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_filter jsonb := coalesce(p_filter, '{}'::jsonb); v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_actor text := public.current_app_user_id()::text;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return (
    with pos as (
      select o.*, app_private.procurement_po_stage(o.status) stage,
        app_private.procurement_date_or_null(o.expected_delivery_date) expected_date,
        app_private.procurement_po_is_hub(o.metadata) is_hub,
        app_private.procurement_po_awaits_me(o.id, o.status, o.submitted_to_user_id, v_actor) awaits_me,
        pr.code project_code, pr.name project_name,
        (select u.name from public.users u where u.id::text = o.created_by_id) created_by_name,
        (select coalesce(sum(nullif(x.value->>'qty', '')::numeric), 0) from jsonb_array_elements(
          case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_total,
        (select coalesce(sum(least(coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), coalesce(nullif(x.value->>'qty', '')::numeric, 0))), 0)
          from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) x) qty_received
      from public.purchase_orders o left join public.projects pr on pr.id = o.project_id
      where o.archived_at is null and o.status <> 'cancelled'
    ),
    filtered as (
      select *, row_number() over (order by case when awaits_me then 0 else 1 end,
        expected_date nulls last, created_at desc) rn
      from pos
      where (coalesce(v_filter->>'stage', 'all') = 'all' or stage = v_filter->>'stage')
        and (nullif(v_filter->>'projectId', '') is null or project_id = v_filter->>'projectId')
        and (coalesce(v_filter->>'mine', 'false') <> 'true' or created_by_id = v_actor or submitted_to_user_id = v_actor)
        and (nullif(v_filter->>'search', '') is null or lower(concat_ws(' ', po_number, vendor_name, project_code, project_name))
          like '%' || lower(v_filter->>'search') || '%')
    )
    select jsonb_build_object(
      'today', v_today,
      'orders', coalesce((select jsonb_agg(jsonb_build_object(
          'id', f.id, 'poNumber', f.po_number, 'status', f.status, 'stage', f.stage, 'isHub', f.is_hub,
          'vendorName', f.vendor_name, 'projectId', f.project_id, 'projectCode', f.project_code, 'projectName', f.project_name,
          'constructionSiteId', f.construction_site_id, 'totalAmount', f.total_amount, 'vatRate', f.vat_rate,
          'orderDate', f.order_date, 'expectedDeliveryDate', f.expected_date,
          'late', f.stage in ('ordered', 'delivering') and f.expected_date < v_today,
          'lineCount', jsonb_array_length(case when jsonb_typeof(f.items) = 'array' then f.items else '[]'::jsonb end),
          'qtyTotal', f.qty_total, 'qtyReceived', f.qty_received,
          'createdById', f.created_by_id, 'createdByName', f.created_by_name,
          'submittedToUserId', f.submitted_to_user_id, 'submittedToName', f.submitted_to_name,
          'awaitingMe', f.awaits_me, 'purchaseMode', f.purchase_mode,
          'kind', case when f.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end,
          'returnsPending', (select count(*) from public.purchase_order_supplier_returns r where r.purchase_order_id = f.id and r.status <> 'cancelled' and r.resolution is null),
          'sources', app_private.procurement_po_sources(f.id)) order by f.rn) from filtered f where f.rn <= 300), '[]'::jsonb),
      'awaitingMyApproval', (select count(*) from pos where awaits_me)
    )
  );
end;
$$;

create or replace function public.get_procurement_order_v1(p_po_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_po public.purchase_orders%rowtype; v_actor uuid := public.current_app_user_id(); v_hub boolean; v_manage boolean;
begin
  if not app_private.procurement_can('view') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  select * into v_po from public.purchase_orders where id = p_po_id and archived_at is null;
  if not found then raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
  v_hub := app_private.procurement_po_is_hub(v_po.metadata);
  v_manage := app_private.procurement_can('manage');
  return jsonb_build_object(
    'id', v_po.id, 'poNumber', v_po.po_number, 'status', v_po.status, 'stage', app_private.procurement_po_stage(v_po.status),
    'isHub', v_hub, 'rowVersion', v_po.row_version, 'vendorId', v_po.vendor_id, 'vendorName', v_po.vendor_name,
    'projectId', v_po.project_id, 'constructionSiteId', v_po.construction_site_id,
    'projectCode', (select code from public.projects where id = v_po.project_id),
    'projectName', (select name from public.projects where id = v_po.project_id),
    'targetWarehouseId', v_po.target_warehouse_id, 'warehouseName', (select name from public.warehouses where id = v_po.target_warehouse_id),
    'orderDate', v_po.order_date, 'expectedDeliveryDate', app_private.procurement_date_or_null(v_po.expected_delivery_date),
    'totalAmount', v_po.total_amount, 'vatRate', v_po.vat_rate, 'note', v_po.note,
    'createdById', v_po.created_by_id, 'createdByName', (select name from public.users where id::text = v_po.created_by_id),
    'createdAt', v_po.created_at, 'submittedToUserId', v_po.submitted_to_user_id, 'submittedToName', v_po.submitted_to_name,
    'returnReason', v_po.metadata->>'returnReason', 'everSubmitted', v_po.ever_submitted,
    'purchaseMode', v_po.purchase_mode,
    'kind', case when v_po.source_mode in ('proactive_project', 'proactive_stock') then 'proactive' else 'need' end, 'proactive', v_po.metadata->'proactive', 'approvedTotalAmount', v_po.approved_total_amount, 'shortClose', v_po.metadata->'shortClose',
    'deliveries', app_private.procurement_po_deliveries(v_po.id),
    'returns', app_private.procurement_po_returns(v_po.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'lineId', coalesce(x.value->>'lineId', x.value->>'itemId'), 'itemId', x.value->>'itemId',
        'name', coalesce(x.value->>'name', x.value->>'itemNameSnapshot'), 'sku', x.value->>'sku', 'unit', x.value->>'unit',
        'qty', coalesce(nullif(x.value->>'qty', '')::numeric, 0), 'unitPrice', coalesce(nullif(x.value->>'unitPrice', '')::numeric, 0),
        'receivedQty', coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0), 'note', x.value->>'note',
        'returnedQty', coalesce(nullif(x.value->>'returnedQty', '')::numeric, 0),
        'stockUnit', coalesce(x.value->>'stockUnitSnapshot', x.value->>'unit'),
        'remainingToDeliver', app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'factor', coalesce(nullif(x.value->>'purchaseConversionFactor', '')::numeric, 1),
        'stockQty', app_private.procurement_po_line_stock_qty(x.value),
        'allocatedQty', app_private.procurement_po_line_link_total(v_po.id, coalesce(x.value->>'lineId', x.value->>'itemId')),
        'boq', x.value->'boq',
        'allocations', coalesce((select jsonb_agg(a) from (
            select jsonb_build_object('sourceType', 'material_request', 'sourceId', l.material_request_id,
              'code', coalesce(r.code, l.material_request_code), 'lineId', l.request_line_id, 'qty', l.ordered_qty, 'needQty', l.requested_qty) a
            from public.purchase_order_request_lines l left join public.requests r on r.id = l.material_request_id
            where l.purchase_order_id = v_po.id and l.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')
            union all
            select jsonb_build_object('sourceType', 'material_plan', 'sourceId', k.material_plan_id,
              'code', p.code, 'lineId', k.material_plan_line_id, 'qty', k.ordered_qty, 'needQty', pl.requested_qty)
            from public.procurement_po_plan_links k join public.project_material_plans p on p.id = k.material_plan_id
            join public.project_material_plan_lines pl on pl.id = k.material_plan_line_id
            where k.purchase_order_id = v_po.id and k.purchase_order_line_id = coalesce(x.value->>'lineId', x.value->>'itemId')) q), '[]'::jsonb))
        order by x.ordinality)
      from jsonb_array_elements(case when jsonb_typeof(v_po.items) = 'array' then v_po.items else '[]'::jsonb end) with ordinality x), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'actorName', u.name, 'reason', e.reason, 'at', e.created_at, 'payload', e.payload)
        order by e.created_at) from public.procurement_hub_events e left join public.users u on u.id = e.actor_id
      where e.entity_type = 'purchase_order' and e.entity_id = v_po.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'canEdit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canSubmit', v_hub and v_manage and v_po.status in ('draft', 'returned') and v_po.created_by_id = v_actor::text,
      'canApprove', v_hub and v_po.status = 'sent' and v_po.created_by_id is distinct from v_actor::text
        and (v_po.submitted_to_user_id = v_actor::text or public.is_admin()),
      'canDelete', v_hub and v_manage and v_po.status = 'draft' and not v_po.ever_submitted and v_po.created_by_id = v_actor::text,
      'canDecideReturn', v_hub and v_manage,
      'canLink', v_hub and v_manage and v_po.source_mode = 'proactive_project' and app_private.procurement_proactive_linkable(v_po.status),
      'canAddDelivery', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where app_private.procurement_po_line_undelivered(v_po.id, v_po.items, coalesce(x.value->>'lineId', x.value->>'itemId')) > 0),
      'canCloseShort', v_hub and v_manage and v_po.status in ('confirmed', 'in_transit', 'partial')
        and not app_private.procurement_po_has_open_delivery(v_po.id)
        and exists (select 1 from jsonb_array_elements(v_po.items) x
          where coalesce(nullif(x.value->>'receivedQty', '')::numeric, 0) < coalesce(nullif(x.value->>'qty', '')::numeric, 0) - 0.0005)),
    'approvers', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name) order by u.name)
      from public.users u where u.id <> v_actor and u.is_active and u.account_status = 'ACTIVE'
        and (u.role = 'ADMIN' or app_private.has_permission(u.id, 'system.procurement.manage'))), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_procurement_hub_po_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_po_id text := nullif(p_input->>'purchaseOrderId', '');
  v_po public.purchase_orders%rowtype;
  v_vendor record;
  v_project text; v_site text; v_warehouse text := nullif(p_input->>'targetWarehouseId', '');
  v_vat numeric := coalesce(nullif(p_input->>'vatRate', '')::numeric, 0);
  v_items jsonb := '[]'::jsonb; v_total numeric := 0; v_request_ids text[];
  v_mode text := case when p_input->>'purchaseMode' = 'multiple' then 'multiple' else 'single' end;
  v_needed date; v_scopes integer; v_line_id text; v_punit text; v_ord integer := 0; it jsonb; al jsonb; v_qty numeric; v_price numeric; v_item record; v_src record;
begin
  if not app_private.procurement_can('manage') then
    raise exception using errcode = '42501', message = 'PROCUREMENT_MANAGE_DENIED'; end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') = 0 then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
  if v_vat < 0 or v_vat > 100 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VAT_INVALID'; end if;

  select b.id, b.name into v_vendor from public.business_partners b
  where b.id = nullif(p_input->>'vendorId', '') and b.is_active;
  if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_VENDOR_REQUIRED'; end if;

  -- Every allocation must be an open need line of the same item, in one project/site.
  create temp table if not exists pg_temp.hub_alloc (item_ord integer, po_line_id text, item_id text, unit_price numeric, item_note text,
    purchase_qty numeric, purchase_unit text,
    source_type text, source_id text, line_id text, qty numeric, need_qty numeric, project_id text, site_id text,
    warehouse_id text, needed_date date, work_boq_item_id text, material_budget_item_id text, code text, unit text) on commit drop;
  truncate pg_temp.hub_alloc;
  for it in select value from jsonb_array_elements(p_input->'items') loop
    v_ord := v_ord + 1;
    v_price := coalesce(nullif(it->>'unitPrice', '')::numeric, 0);
    if nullif(it->>'purchaseQty', '')::numeric <= 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
    if v_price < 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    if jsonb_typeof(it->'allocations') is distinct from 'array' or jsonb_array_length(it->'allocations') = 0 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_ITEMS_REQUIRED'; end if;
    for al in select value from jsonb_array_elements(it->'allocations') loop
      v_qty := nullif(al->>'qty', '')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_QTY_INVALID'; end if;
      select l.need_qty, l.unit, d.project_id, d.construction_site_id, d.warehouse_id, d.needed_date, d.code, d.closed_at
        into v_src
      from app_private.procurement_inbox_lines() l
      join app_private.procurement_inbox_documents() d on d.source_type = l.source_type and d.source_id = l.source_id
      where l.source_type = al->>'sourceType' and l.source_id = al->>'sourceId' and l.line_id = al->>'lineId'
        and l.item_id = it->>'itemId';
      if not found then raise exception using errcode = '22023', message = 'PROCUREMENT_SOURCE_NOT_FOUND'; end if;
      if v_src.closed_at is not null then raise exception using errcode = '22023', message = 'PROCUREMENT_NEED_CLOSED'; end if;
      insert into pg_temp.hub_alloc values (v_ord, null, it->>'itemId', v_price,
        nullif(btrim(it->>'note'), ''), nullif(it->>'purchaseQty', '')::numeric, nullif(btrim(it->>'purchaseUnit'), ''), al->>'sourceType', al->>'sourceId', al->>'lineId', v_qty, v_src.need_qty,
        v_src.project_id, v_src.construction_site_id, v_src.warehouse_id, v_src.needed_date, null, null, v_src.code, v_src.unit);
    end loop;
  end loop;
  if exists (select 1 from pg_temp.hub_alloc group by source_type, source_id, line_id having count(*) > 1) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_DUPLICATE_LINE'; end if;
  select count(distinct coalesce(project_id, '') || '|' || coalesce(site_id, '')), min(project_id), min(site_id), min(needed_date)
    into v_scopes, v_project, v_site, v_needed from pg_temp.hub_alloc;
  if v_scopes <> 1 then raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;
  if v_warehouse is null then
    select min(warehouse_id) into v_warehouse from pg_temp.hub_alloc having count(distinct warehouse_id) = 1;
  end if;
  if v_warehouse is not null and not exists (select 1 from public.warehouses w where w.id = v_warehouse and not coalesce(w.is_archived, false)) then
    raise exception using errcode = '22023', message = 'PROCUREMENT_PO_WAREHOUSE_INVALID'; end if;

  -- Request line attribution (BOQ links) from the request itself.
  update pg_temp.hub_alloc a set work_boq_item_id = x.value->>'workBoqItemId', material_budget_item_id = x.value->>'materialBudgetItemId'
  from public.requests r cross join lateral jsonb_array_elements(r.items) x
  where a.source_type = 'material_request' and r.id = a.source_id and x.value->>'lineId' = a.line_id;

  -- One PO line per item.
  for v_item in
    select a.item_id, max(a.unit_price) unit_price, sum(a.qty) qty, min(a.needed_date) needed_date, max(a.item_note) note,
      max(a.purchase_qty) manual_purchase_qty, max(a.purchase_unit) manual_purchase_unit,
      count(*) n, min(a.source_type) st, min(a.source_id) sid, min(a.line_id) lid, min(a.code) code,
      coalesce(i.name, min(a.item_id)) name, i.sku, coalesce(i.unit, min(a.unit)) unit,
      -- Need quantities are in the stock unit; the order uses the purchase unit (stock = purchase × factor).
      case when nullif(btrim(i.purchase_unit), '') is not null and lower(btrim(i.purchase_unit)) <> lower(btrim(coalesce(i.unit, '')))
        and coalesce(i.purchase_conversion_factor, 0) > 0 then i.purchase_unit end purchase_unit,
      coalesce(nullif(i.purchase_conversion_factor, 0), 1) factor
    from pg_temp.hub_alloc a left join public.items i on i.id = a.item_id
    group by a.item_id, i.name, i.sku, i.unit, i.purchase_unit, i.purchase_conversion_factor order by min(a.item_ord), a.item_id
  loop
    if (select count(distinct unit_price) from pg_temp.hub_alloc where item_id = v_item.item_id) > 1 then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PRICE_INVALID'; end if;
    v_line_id := 'mh-' || gen_random_uuid();
    -- The buyer may type the purchase quantity (e.g. 100 kg ↔ 10 cây); otherwise the item's default factor applies.
    v_punit := coalesce(v_item.manual_purchase_unit, v_item.purchase_unit, v_item.unit);
    v_qty := case when v_item.manual_purchase_qty is not null then v_item.manual_purchase_qty
      when v_item.purchase_unit is null then v_item.qty else round(v_item.qty / v_item.factor, 6) end;
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'lineId', v_line_id, 'itemId', v_item.item_id, 'sku', coalesce(v_item.sku, ''), 'name', v_item.name,
      'itemNameSnapshot', v_item.name, 'unit', coalesce(v_punit, ''),
      'unitSnapshot', v_item.unit, 'stockUnitSnapshot', v_item.unit, 'purchaseUnitSnapshot', v_punit,
      'purchaseConversionFactor', round(v_item.qty / v_qty, 12), 'stockQty', v_item.qty,
      'qty', v_qty, 'unitPrice', v_item.unit_price, 'neededDate', v_item.needed_date, 'note', v_item.note,
      'requestId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.sid end,
      'requestCode', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.code end,
      'requestLineId', case when v_item.n = 1 and v_item.st = 'material_request' then v_item.lid end)));
    v_total := v_total + v_qty * v_item.unit_price;
    update pg_temp.hub_alloc set po_line_id = v_line_id where item_id = v_item.item_id;
  end loop;
  select array_agg(distinct source_id) into v_request_ids from pg_temp.hub_alloc where source_type = 'material_request';

  perform set_config('app.procurement_hub_context', 'on', true);
  if v_po_id is null then
    v_po_id := 'po-' || gen_random_uuid();
    insert into public.purchase_orders (id, project_id, construction_site_id, vendor_id, vendor_name, po_number, items,
      total_amount, vat_rate, order_date, expected_delivery_date, status, source_mode, purchase_mode, fulfillment_mode,
      target_warehouse_id, material_request_id, note, created_by_id, approval_request_title, metadata)
    values (v_po_id, v_project, v_site, v_vendor.id, v_vendor.name, public.next_purchase_order_number_v2(), v_items,
      v_total, v_vat, to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD'),
      nullif(p_input->>'expectedDeliveryDate', ''), 'draft', 'from_request', v_mode, 'RECEIVE_TO_STOCK',
      v_warehouse, case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      nullif(btrim(p_input->>'note'), ''), v_actor::text, 'Đơn hàng lập tại Mua hàng',
      jsonb_build_object('channel', 'procurement_hub'))
    returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'create', v_actor);
  else
    select * into v_po from public.purchase_orders where id = v_po_id for update;
    if not found or not app_private.procurement_po_is_hub(v_po.metadata) or v_po.archived_at is not null then
      raise exception using errcode = 'PT404', message = 'PROCUREMENT_PO_NOT_FOUND'; end if;
    -- Đơn chủ động (M2d) chỉ sửa bằng save_procurement_proactive_po_v1 để giữ liên kết nhu cầu đã gắn.
    if v_po.source_mode in ('proactive_project', 'proactive_stock') then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_PROACTIVE_USE_EDITOR'; end if;
    if v_po.status not in ('draft', 'returned') or v_po.created_by_id is distinct from v_actor::text then
      raise exception using errcode = '42501', message = 'PROCUREMENT_PO_NOT_EDITABLE'; end if;
    if v_po.row_version is distinct from nullif(p_input->>'expectedRowVersion', '')::bigint then
      raise exception using errcode = '40001', message = 'ROW_VERSION_CONFLICT'; end if;
    if v_po.project_id is distinct from v_project or v_po.construction_site_id is distinct from v_site then
      raise exception using errcode = '22023', message = 'PROCUREMENT_PO_SCOPE_MIXED'; end if;
    delete from public.purchase_order_request_lines where purchase_order_id = v_po_id;
    delete from public.procurement_po_plan_links where purchase_order_id = v_po_id;
    update public.purchase_orders set vendor_id = v_vendor.id, vendor_name = v_vendor.name, items = v_items,
      total_amount = v_total, vat_rate = v_vat, purchase_mode = v_mode, expected_delivery_date = nullif(p_input->>'expectedDeliveryDate', ''),
      target_warehouse_id = v_warehouse, material_request_id = case when cardinality(v_request_ids) = 1 then v_request_ids[1] end,
      note = nullif(btrim(p_input->>'note'), '')
    where id = v_po_id returning * into v_po;
    insert into public.procurement_hub_events (entity_type, entity_id, action, actor_id)
    values ('purchase_order', v_po_id, 'update', v_actor);
  end if;

  insert into public.purchase_order_request_lines (project_id, construction_site_id, source_construction_site_id,
    target_warehouse_id, allocation_status, purchase_order_id, purchase_order_line_id, material_request_id,
    material_request_code, request_line_id, item_id, work_boq_item_id, material_budget_item_id, requested_qty,
    ordered_qty, requested_qty_snapshot, ordered_stock_qty_snapshot, actual_received_qty_snapshot, unit)
  select a.project_id, a.site_id, a.site_id, v_warehouse, 'open', v_po_id, a.po_line_id, a.source_id,
    a.code, a.line_id, a.item_id,
    (select b.id from public.project_work_boq_items b where b.id = a.work_boq_item_id),
    (select b.id from public.material_budget_items b where b.id = a.material_budget_item_id),
    a.need_qty, a.qty, a.need_qty, a.qty, 0, a.unit
  from pg_temp.hub_alloc a where a.source_type = 'material_request';
  insert into public.procurement_po_plan_links (purchase_order_id, purchase_order_line_id, material_plan_id,
    material_plan_line_id, item_id, ordered_qty)
  select v_po_id, a.po_line_id, a.source_id::uuid, a.line_id::uuid, a.item_id, a.qty
  from pg_temp.hub_alloc a where a.source_type = 'material_plan';
  perform set_config('app.procurement_hub_context', 'off', true);

  return jsonb_build_object('purchaseOrderId', v_po_id, 'poNumber', v_po.po_number, 'rowVersion', v_po.row_version,
    'totalAmount', v_total, 'lines', jsonb_array_length(v_items));
end;
$$;

revoke all on function app_private.finance_text_date(text), app_private.finance_is_vioo_supplier_cost(text, text),
  app_private.trg_project_transaction_finance_guard(), app_private.trg_finance_company_scope(), app_private.finance_warehouse_project(text),
  app_private.finance_insert_project_cost(text, numeric, text, text, text, text), app_private.trg_finance_transfer_cost()
  from public, anon, authenticated;
revoke all on function public.get_finance_cost_cutovers_v1(), public.save_finance_cost_cutover_v1(jsonb) from public, anon;
grant execute on function public.get_finance_cost_cutovers_v1(), public.save_finance_cost_cutover_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
