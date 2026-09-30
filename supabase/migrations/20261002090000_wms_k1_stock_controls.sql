-- Kho & Công nợ — K1: kiểm soát tồn và phiếu treo (chủ sản phẩm duyệt 01/10/2026).
--
-- * Không cho xuất quá tồn: ghi sổ kho chiều "xuất" bị chặn nếu tổng tồn của vật tư trong kho
--   xuống âm (thông báo rõ vật tư, kho, tồn còn, SL cần xuất).
-- * Phiếu kho treo: phiếu chờ duyệt/chờ nhận quá N ngày được liệt kê cho thủ kho, người lập và
--   người quản lý kho; mỗi sáng gửi một thông báo tóm tắt cho người phải xử lý.

CREATE OR REPLACE FUNCTION app_private.post_inventory_ledger_entry(p_inventory_transaction_id uuid, p_entry_no integer, p_document_code text, p_transaction_date timestamp with time zone, p_transaction_type text, p_direction text, p_material_id text, p_warehouse_id text, p_project_id text, p_construction_site_id text, p_source_type text, p_source_id text, p_source_code text, p_source_line_id text, p_related_request_id text, p_qty numeric, p_unit_price numeric, p_description text, p_metadata jsonb, p_created_by uuid, p_approved_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entry_id uuid := gen_random_uuid();
  v_delta numeric;
  v_value_delta numeric;
  v_balance_after_qty numeric;
  v_balance_after_value numeric;
  v_unit text;
  v_total_after numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'ledger quantity must be positive';
  end if;
  if nullif(p_material_id, '') is null then
    raise exception 'material id is required';
  end if;
  if nullif(p_warehouse_id, '') is null then
    raise exception 'warehouse id is required';
  end if;

  select i.unit into v_unit
  from public.items i
  where i.id = p_material_id;

  v_unit := coalesce(
    v_unit,
    nullif(p_metadata->>'unit', ''),
    nullif(p_metadata->>'unitSnapshot', ''),
    nullif(p_metadata->>'accountingUnit', '')
  );

  v_delta := case when p_direction = 'in' then p_qty else -p_qty end;
  v_value_delta := v_delta * coalesce(p_unit_price, 0);

  insert into public.inventory_balances (
    material_id, warehouse_id, project_id, construction_site_id,
    on_hand_qty, total_value, average_unit_cost,
    last_ledger_entry_id, last_transaction_date, updated_at
  )
  values (
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    v_delta, v_value_delta,
    case when v_delta = 0 then 0 else coalesce(p_unit_price, 0) end,
    v_entry_id, p_transaction_date, now()
  )
  on conflict (material_id, warehouse_id, scope_key)
  do update set
    on_hand_qty = public.inventory_balances.on_hand_qty + excluded.on_hand_qty,
    total_value = public.inventory_balances.total_value + excluded.total_value,
    average_unit_cost = case
      when (public.inventory_balances.on_hand_qty + excluded.on_hand_qty) = 0 then 0
      else (public.inventory_balances.total_value + excluded.total_value)
        / nullif(public.inventory_balances.on_hand_qty + excluded.on_hand_qty, 0)
    end,
    last_ledger_entry_id = excluded.last_ledger_entry_id,
    last_transaction_date = excluded.last_transaction_date,
    updated_at = now()
  returning on_hand_qty, total_value
    into v_balance_after_qty, v_balance_after_value;

  -- K1 (01/10/2026): không xuất quá tồn. Kiểm tra tổng tồn của vật tư trong kho (mọi phạm vi dự án/lô)
  -- để không chặn nhầm khi hàng nhập và xuất ghi ở hai phạm vi khác nhau của cùng một kho.
  if p_direction = 'out' and coalesce(current_setting('app.inventory_allow_negative', true), '') <> 'on' then
    select coalesce(sum(b.on_hand_qty), 0) into v_total_after
    from public.inventory_balances b where b.material_id = p_material_id and b.warehouse_id = p_warehouse_id;
    if v_total_after < -0.0005 then
      raise exception using errcode = 'P0001',
        message = format('INVENTORY_NEGATIVE_STOCK: Không đủ tồn "%s" tại kho "%s": còn %s %s, cần xuất %s. Kiểm tra lại tồn hoặc nhập bù trước khi xuất.',
          coalesce((select i.name from public.items i where i.id = p_material_id), p_material_id),
          coalesce((select w.name from public.warehouses w where w.id = p_warehouse_id), p_warehouse_id),
          trim(to_char(v_total_after + p_qty, 'FM999G999G990D###')), coalesce(v_unit, ''), trim(to_char(p_qty, 'FM999G999G990D###')));
    end if;
  end if;

  insert into public.inventory_ledger_entries (
    id, inventory_transaction_id, entry_no, document_code,
    transaction_date, transaction_type, movement_direction,
    material_id, warehouse_id, project_id, construction_site_id,
    source_type, source_id, source_code, source_line_id, related_request_id,
    quantity_in, quantity_out, unit, unit_price,
    balance_after_qty, balance_after_value,
    description, metadata, created_by, approved_by
  )
  values (
    v_entry_id, p_inventory_transaction_id, p_entry_no, p_document_code,
    p_transaction_date, p_transaction_type, p_direction,
    p_material_id, p_warehouse_id, nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
    p_source_type, p_source_id, p_source_code, nullif(p_source_line_id, ''), nullif(p_related_request_id, ''),
    case when p_direction = 'in' then p_qty else 0 end,
    case when p_direction = 'out' then p_qty else 0 end,
    v_unit, coalesce(p_unit_price, 0),
    v_balance_after_qty, v_balance_after_value,
    p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by, p_approved_by
  );

  return v_entry_id;
end;
$function$;


-- Phiếu kho còn mở (chưa hoàn tất / chưa hủy).
create function app_private.wms_open_documents()
returns table (id text, type text, status text, doc_date timestamptz, age_days integer, warehouse_id text, warehouse_name text,
  requester_id text, requester_name text, source_type text, source_id text, note text, item_count integer, step text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.type::text, t.status::text, coalesce(nullif(t.date::text, '')::timestamptz, t.created_at),
    ((now() at time zone 'Asia/Ho_Chi_Minh')::date - (coalesce(nullif(t.date::text, '')::timestamptz, t.created_at) at time zone 'Asia/Ho_Chi_Minh')::date),
    coalesce(t.target_warehouse_id, t.source_warehouse_id), w.name,
    t.requester_id::text, (select u.name from public.users u where u.id::text = t.requester_id::text),
    t.source_type, t.source_id, t.note, jsonb_array_length(case when jsonb_typeof(t.items) = 'array' then t.items else '[]'::jsonb end),
    case when t.status::text = 'APPROVED' then 'Đã kiểm SL/CL — chờ xác nhận nhập kho'
      when t.type::text = 'IMPORT' then 'Chờ thủ kho kiểm SL/CL'
      when t.type::text = 'TRANSFER' then 'Chờ duyệt chuyển kho'
      else 'Chờ duyệt xuất' end
  from public.transactions t
  left join public.warehouses w on w.id = coalesce(t.target_warehouse_id, t.source_warehouse_id)
  where t.status::text in ('PENDING', 'APPROVED');
$$;

-- Ai phải xử lý phiếu của một kho: thủ kho được giao kho đó.
create function app_private.wms_warehouse_keepers(p_warehouse_id text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u.id from public.users u
  where coalesce(u.is_active, true) and coalesce(u.account_status, 'ACTIVE') = 'ACTIVE'
    and u.role::text in ('WAREHOUSE_KEEPER', 'KEEPER') and u.assigned_warehouse_id = p_warehouse_id;
$$;

create function public.list_wms_stale_documents_v1(p_min_days integer default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := public.current_app_user_id(); v_all boolean;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'AUTH_REQUIRED'; end if;
  v_all := public.is_admin() or public.is_module_admin('WMS') or app_private.current_user_is_global_wms_keeper();
  return (
    with docs as (
      select d.* from app_private.wms_open_documents() d
      where d.age_days >= greatest(coalesce(p_min_days, 3), 0)
        and (v_all or d.requester_id = v_actor::text
          or v_actor in (select app_private.wms_warehouse_keepers(d.warehouse_id))
          or app_private.wms_has_action('wms.transaction.approve', null, d.warehouse_id, null, null, v_actor)
          or app_private.wms_has_action('wms.transaction.complete', null, d.warehouse_id, null, null, v_actor))
    )
    select jsonb_build_object(
      'minDays', greatest(coalesce(p_min_days, 3), 0),
      'total', (select count(*) from docs),
      'oldestDays', (select max(age_days) from docs),
      'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'status', d.status, 'date', d.doc_date,
          'ageDays', d.age_days, 'warehouseId', d.warehouse_id, 'warehouseName', d.warehouse_name, 'requesterName', d.requester_name,
          'sourceType', d.source_type, 'note', d.note, 'itemCount', d.item_count, 'step', d.step,
          'keepers', (select coalesce(jsonb_agg(u.name order by u.name), '[]'::jsonb) from public.users u where u.id in (select app_private.wms_warehouse_keepers(d.warehouse_id))))
        order by d.age_days desc, d.doc_date) from docs d), '[]'::jsonb)
    )
  );
end;
$$;

-- Mỗi sáng: một thông báo tóm tắt cho thủ kho (và người lập) có phiếu treo từ 3 ngày.
create function app_private.notify_wms_stale_documents()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date; r record; v_n integer := 0;
begin
  for r in
    with docs as (select * from app_private.wms_open_documents() where age_days >= 3),
    targets as (
      select k.uid::text user_id, d.id, d.age_days from docs d cross join lateral app_private.wms_warehouse_keepers(d.warehouse_id) k(uid)
      union select d.requester_id, d.id, d.age_days from docs d where d.requester_id is not null
    )
    select user_id, count(distinct id) n, max(age_days) oldest from targets group by 1
  loop
    continue when exists (select 1 from public.notifications x where x.user_id = r.user_id and x.source_id = 'wms_stale:' || r.user_id || ':' || v_today);
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link, source_type, source_id,
      priority, push_enabled, metadata, delivery_reason)
    values (r.user_id, 'warning', 'wms', r.n || ' phiếu kho chờ xử lý quá 3 ngày',
      'Cũ nhất ' || r.oldest || ' ngày. Mở Nghiệp vụ kho để nhận hàng, duyệt hoặc hủy phiếu.',
      'Cũ nhất ' || r.oldest || ' ngày. Mở Nghiệp vụ kho để nhận hàng, duyệt hoặc hủy phiếu.',
      'warning', '📦', '/#/operations', 'wms_stale_documents', 'wms_stale:' || r.user_id || ':' || v_today,
      'normal', true, jsonb_build_object('count', r.n, 'oldestDays', r.oldest), 'responsible');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function app_private.wms_open_documents(), app_private.wms_warehouse_keepers(text),
  app_private.notify_wms_stale_documents() from public, anon, authenticated;
revoke all on function public.list_wms_stale_documents_v1(integer) from public, anon;
grant execute on function public.list_wms_stale_documents_v1(integer) to authenticated;

-- 07:30 giờ Việt Nam hằng ngày.
select cron.schedule('wms-stale-documents-daily', '30 0 * * *', $$select app_private.notify_wms_stale_documents();$$);

notify pgrst, 'reload schema';
