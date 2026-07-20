-- Seed project PBAC permission for material availability visibility.
-- Repo migration only. Apply cloud manually with:
--   supabase db query --linked -f supabase/migrations/20260615054451_project_material_view_available_stock_permission.sql

do $$
begin
  if to_regclass('public.project_permission_types') is not null then
    insert into public.project_permission_types (code, name, module, description, sort_order, is_active)
    values (
      'view_available_stock',
      'Xem vật tư khả dụng',
      'material_request',
      'Xem định mức khả dụng, tồn kho, tổng tồn và phần vật tư đang giữ chỗ khi tạo/xem đề xuất vật tư dự án',
      7,
      true
    )
    on conflict (code) do update set
      name = excluded.name,
      module = excluded.module,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_active = true;
  end if;
end;
$$;
