do $$
declare
  v_codes text[] := array[
    'project.payment.verify',
    'project.payment.approve',
    'project.payment.confirm',
    'project.quantity_acceptance.verify',
    'project.quantity_acceptance.approve'
  ];
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code = any(v_codes)
      and is_active
      and grant_readiness = 'declared'
  ) <> cardinality(v_codes) then
    raise exception 'Payment/Quantity readiness promotion requires five active declared actions.';
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
    raise exception 'Payment/Quantity readiness promotion failed.';
  end if;
end;
$$;
