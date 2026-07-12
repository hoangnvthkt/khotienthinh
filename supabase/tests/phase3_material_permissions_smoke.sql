-- Phase 3 Material permission smoke.

do $$
declare
  required_codes text[] := array[
    'project.material_request.view',
    'project.material_request.create',
    'project.material_request.submit',
    'project.material_request.approve',
    'project.material_request.view_available_stock',
    'project.material_boq.edit',
    'project.material_plan.edit',
    'project.material_po.create',
    'project.material_po.approve',
    'project.material_po.receive',
    'project.custom_material.create',
    'project.custom_material.approve',
    'project.material_waste.record',
    'project.material_waste.approve'
  ];
  v_permission_code text;
begin
  foreach v_permission_code in array required_codes loop
    if not exists (
      select 1
      from public.permission_actions pa
      where pa.permission_code = v_permission_code
        and coalesce(pa.is_active, true)
    ) then
      raise exception 'Missing Phase 3 Material permission action: %', v_permission_code;
    end if;
  end loop;

  if exists (
    select 1
    from public.permission_actions pa
    where pa.permission_code = 'project.material_request.view_available_stock'
      and not ('warehouse' = any(pa.scope_modes))
  ) then
    raise exception 'Material available-stock permission is missing warehouse scope mode';
  end if;
end $$;
