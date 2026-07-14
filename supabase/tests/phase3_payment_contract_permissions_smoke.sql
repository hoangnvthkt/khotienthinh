-- Phase 3 Payment, quantity, and contract permission smoke.

do $$
declare
  required_codes text[] := array[
    'project.payment.view',
    'project.payment.create',
    'project.payment.verify',
    'project.payment.confirm',
    'project.payment.approve',
    'project.payment.mark_paid',
    'project.quantity_acceptance.view',
    'project.quantity_acceptance.create',
    'project.quantity_acceptance.verify',
    'project.quantity_acceptance.approve',
    'project.contract.view',
    'project.contract.create',
    'project.contract.approve',
    'project.contract_item.view',
    'project.contract_item.edit',
    'project.contract_variation.create',
    'project.contract_variation.submit',
    'project.contract_variation.verify',
    'project.contract_variation.approve'
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
      raise exception 'Missing Phase 3 Payment/Contract permission action: %', v_permission_code;
    end if;
  end loop;

  if exists (
    select 1
    from public.permission_actions pa
    where pa.permission_code in ('project.payment.verify', 'project.payment.mark_paid')
    group by pa.module_code
    having count(distinct pa.action) <> 2
  ) then
    raise exception 'Payment verify and mark_paid are not distinct actions';
  end if;
end $$;
