-- Danh mục vật tư cho form đề xuất vật tư của dự án.
--
-- Bảng public.items chỉ đọc được khi có quyền kho (wms.inventory.view toàn cục...),
-- nên người chỉ có quyền Sửa trong phòng "Đề xuất vật tư" của dự án mở được form nhưng
-- không chọn được vật tư. Hàm này cấp danh mục theo quyền phòng của dự án, chỉ gồm
-- cột nhận diện (không giá, không tồn kho, không nhà cung cấp).

create or replace function public.list_project_material_request_catalog_v1(
  p_project_id text,
  p_construction_site_id text default null
)
returns table (
  id text,
  sku text,
  name text,
  category text,
  unit text,
  purchase_unit text,
  purchase_conversion_factor numeric,
  default_lead_time_days integer,
  status text,
  inventory_mode text,
  merged_into_id text
)
language sql
stable
security definer
set search_path to ''
as $function$
  select item.id, item.sku, item.name, item.category, item.unit, item.purchase_unit,
    item.purchase_conversion_factor, item.default_lead_time_days, item.status,
    item.inventory_mode, item.merged_into_id
  from public.items item
  where (
    select app_private.current_actor_has_effective_room_action(
      nullif(p_project_id, ''), nullif(p_construction_site_id, ''),
      'material_request', 'edit'
    )
  )
  order by item.name, item.id;
$function$;

revoke all on function public.list_project_material_request_catalog_v1(text, text) from public, anon;
grant execute on function public.list_project_material_request_catalog_v1(text, text) to authenticated, service_role;
