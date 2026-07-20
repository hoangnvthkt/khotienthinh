do $$
declare
  v_codes text[] := array[
    'project.material_request.approve',
    'project.material_po.approve',
    'project.custom_material.approve'
  ];
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code = any(v_codes)
      and is_active
      and grant_readiness = 'declared'
  ) <> cardinality(v_codes) then
    raise exception 'Material approval readiness promotion requires three active declared actions.';
  end if;

  update public.permission_actions
  set grant_readiness = 'verified',
      updated_at = now()
  where permission_code = any(v_codes)
    and is_active
    and grant_readiness = 'declared';

  if (
    select count(*)
    from public.permission_actions
    where permission_code = any(v_codes)
      and is_active
      and grant_readiness = 'verified'
  ) <> cardinality(v_codes) then
    raise exception 'Material approval readiness promotion failed.';
  end if;
end;
$$;
