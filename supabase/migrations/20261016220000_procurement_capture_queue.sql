-- Mua hàng nhận phiếu giao chờ (chủ SP 16/10/2026, câu "NCC chưa có → Mua hàng tạo; không khớp đơn → lưu chờ Mua hàng").
--   * list_capture_queue_v1: phiếu giao thủ kho đã chụp nhưng chưa nhận được, chia 2 việc của Mua hàng:
--       supplier = NCC mới / chưa khớp NCC (cần tạo hoặc chọn đối tác)
--       order    = đã biết NCC nhưng không có đơn mở của NCC đó về kho này (cần lập đơn)
--   * create_supplier_from_capture_v1: tạo đối tác NCC từ tên / MST / địa chỉ trên phiếu (1 chạm). Chặn tạo trùng:
--     MST trùng hoặc tên giống ≥ 0,9 → báo PARTNER_DUPLICATE kèm NCC đang có, Mua hàng chọn NCC đó hoặc vẫn tạo.
--   * resolve_capture_supplier_v1: Mua hàng chọn NCC có sẵn cho phiếu.
--   Cả hai đều gắn NCC cho mọi phiếu "NCC mới" cùng tên / MST và học tên (lần sau tự khớp).

-- Phần lõi tên NCC: thêm "CH" (cửa hàng), "đại lý" — phiếu cửa hàng VLXD hay viết tắt.
create or replace function app_private.capture_supplier_core(p text)
returns text language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(' ' || app_private.capture_text_key(p) || ' ',
    '\m(cty|ctcp)\M', 'cong ty', 'g'),
    '\m(cong ty|tnhh|co phan|cp|mtv|mot thanh vien|thuong mai|tm|xay dung|xd|dau tu|dttm|tmdv|tmxd|xdtm|dt|dich vu|dv|san xuat|sx|kinh doanh|va|vn|viet nam|tong hop|xuat nhap khau|xnk|ky thuat|kt|chi nhanh|tap doan|doanh nghiep|tu nhan|dntn|ho kinh doanh|hkd|dai ly|cua hang|ch|vat lieu|vlxd|vat tu|thiet bi|cong nghiep|phat trien|nha may|tram tron|be tong|thuong pham|ltd|co|jsc)\M',
    ' ', 'g'), '\s+', ' ', 'g'));
$$;

create or replace function app_private.capture_procurement_can_supplier()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or app_private.procurement_can('manage')
    or app_private.contract_actor_can_manage(array['contract.partner.manage']);
$$;

-- Gắn NCC cho phiếu + các phiếu đang mở cùng tên (phần lõi) hoặc cùng MST chưa có NCC; học tên trên phiếu.
create or replace function app_private.capture_link_supplier(p_capture_id uuid, p_partner_id text, p_actor uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.wms_delivery_captures%rowtype;
  v_core text; v_tax text; v_n integer;
begin
  select * into v_c from public.wms_delivery_captures where id = p_capture_id for update;
  v_core := app_private.capture_supplier_core(v_c.supplier_name);
  v_tax := app_private.capture_tax_key(v_c.supplier_tax_code);
  with t as (
    update public.wms_delivery_captures c set supplier_id = p_partner_id, supplier_match = 'picked', updated_at = now()
    where c.status in ('new', 'read') and (c.id = p_capture_id or (c.supplier_id is null and (
      (v_core <> '' and app_private.capture_supplier_core(c.supplier_name) = v_core)
      or (v_tax is not null and app_private.capture_tax_key(c.supplier_tax_code) = v_tax))))
    returning c.supplier_name
  )
  select count(*) into v_n from t;
  if app_private.capture_text_key(v_c.supplier_name) <> '' then
    insert into public.wms_supplier_aliases (alias_key, alias_text, partner_id, created_by)
    values (app_private.capture_text_key(v_c.supplier_name), v_c.supplier_name, p_partner_id, p_actor)
    on conflict (alias_key) do update set partner_id = excluded.partner_id, alias_text = excluded.alias_text,
      hits = public.wms_supplier_aliases.hits + 1, updated_at = now();
  end if;
  return v_n;
end;
$$;

create or replace function public.list_capture_queue_v1()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (public.is_admin() or app_private.procurement_can('view')) then
    raise exception using errcode = '42501', message = 'PROCUREMENT_VIEW_DENIED'; end if;
  return jsonb_build_object(
    'canManage', app_private.capture_procurement_can_supplier(),
    'today', (now() at time zone 'Asia/Ho_Chi_Minh')::date,
    'items', coalesce((
      select jsonb_agg(app_private.capture_json(x.c) || jsonb_build_object('queue', x.queue, 'warehouseName', x.wh_name) order by (x.c).created_at)
      from (
        select c, w.name wh_name,
          case when c.supplier_id is null then 'supplier' else 'order' end queue
        from public.wms_delivery_captures c
        join public.warehouses w on w.id = c.warehouse_id
        where c.status in ('new', 'read') and c.created_at > now() - interval '60 days'
          and (c.supplier_id is null and (c.supplier_match = 'new' or (c.status = 'read' and coalesce(c.supplier_name, '') <> ''))
            or (c.supplier_id is not null and not exists (
              select 1 from public.purchase_orders po
              where po.vendor_id = c.supplier_id and po.archived_at is null and po.status in ('sent', 'confirmed', 'in_transit', 'partial')
                and app_private.procurement_po_is_hub(po.metadata)
                and (po.target_warehouse_id = c.warehouse_id
                  or (app_private.procurement_po_is_group(po.metadata) and exists (select 1 from app_private.group_po_link_allocation(po.id) g where g.warehouse_id = c.warehouse_id))))))
      ) x), '[]'::jsonb));
end;
$$;

create or replace function public.resolve_capture_supplier_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_id uuid := nullif(p->>'captureId', '')::uuid;
  v_partner text := nullif(p->>'supplierId', '');
  v_c public.wms_delivery_captures%rowtype;
  v_n integer;
begin
  if not app_private.capture_procurement_can_supplier() then raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  select * into v_c from public.wms_delivery_captures where id = v_id;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if v_c.status not in ('new', 'read') then raise exception using errcode = '22023', message = 'CAPTURE_LOCKED'; end if;
  if not exists (select 1 from public.business_partners bp where bp.id = v_partner and bp.is_active) then
    raise exception using errcode = '22023', message = 'CAPTURE_SUPPLIER_INVALID'; end if;
  v_n := app_private.capture_link_supplier(v_id, v_partner, v_actor);
  select * into v_c from public.wms_delivery_captures where id = v_id;
  return app_private.capture_json(v_c) || jsonb_build_object('linked', v_n);
end;
$$;

create or replace function public.create_supplier_from_capture_v1(p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := public.current_app_user_id();
  v_id uuid := nullif(p->>'captureId', '')::uuid;
  v_name text := nullif(btrim(p->>'name'), '');
  v_tax text := nullif(btrim(p->>'taxCode'), '');
  v_addr text := nullif(btrim(p->>'address'), '');
  v_c public.wms_delivery_captures%rowtype;
  v_dup record;
  v_partner text := gen_random_uuid()::text;
  v_code text;
  v_n integer;
begin
  if not app_private.capture_procurement_can_supplier() then raise exception using errcode = '42501', message = 'CAPTURE_DENIED'; end if;
  select * into v_c from public.wms_delivery_captures where id = v_id;
  if not found then raise exception using errcode = 'PT404', message = 'CAPTURE_NOT_FOUND'; end if;
  if v_c.status not in ('new', 'read') then raise exception using errcode = '22023', message = 'CAPTURE_LOCKED'; end if;
  if v_name is null then raise exception using errcode = '22023', message = 'PARTNER_NAME_REQUIRED'; end if;

  -- Chặn tạo trùng: MST trùng hoặc tên rất giống một NCC đang có.
  if coalesce((p->>'force')::boolean, false) is false then
    select * into v_dup from app_private.capture_supplier_candidates(v_name, v_tax, v_c.warehouse_id) x where x.score >= 0.9 limit 1;
    if v_dup.id is not null then
      raise exception using errcode = 'PT409', message = 'PARTNER_DUPLICATE', detail = jsonb_build_object('id', v_dup.id, 'name', v_dup.name, 'reason', v_dup.reason)::text;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('business_partners_ncc_code'));
  select 'NCC' || lpad((coalesce(max(substring(bp.code from '^NCC(\d+)$')::int), 0) + 1)::text, 4, '0') into v_code
  from public.business_partners bp where bp.code ~ '^NCC\d+$';
  insert into public.business_partners (id, code, name, tax_code, address, classifications, is_active, created_date, note)
  values (v_partner, v_code, v_name, v_tax, v_addr, array['supplier'], true, (now() at time zone 'Asia/Ho_Chi_Minh')::date,
    'Tạo từ phiếu giao chụp ở kho' || coalesce(' số ' || v_c.doc_no, ''));
  update public.wms_delivery_captures set supplier_tax_code = coalesce(v_tax, supplier_tax_code), supplier_address = coalesce(v_addr, supplier_address)
  where id = v_id;
  v_n := app_private.capture_link_supplier(v_id, v_partner, v_actor);
  select * into v_c from public.wms_delivery_captures where id = v_id;
  return app_private.capture_json(v_c) || jsonb_build_object('linked', v_n, 'partnerCode', v_code);
end;
$$;

revoke all on function app_private.capture_procurement_can_supplier(), app_private.capture_link_supplier(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.list_capture_queue_v1(), public.resolve_capture_supplier_v1(jsonb), public.create_supplier_from_capture_v1(jsonb) from public, anon;
grant execute on function public.list_capture_queue_v1(), public.resolve_capture_supplier_v1(jsonb), public.create_supplier_from_capture_v1(jsonb) to authenticated;

notify pgrst, 'reload schema';
