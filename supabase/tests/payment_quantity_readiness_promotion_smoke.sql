-- Payment and Quantity readiness-promotion smoke.
-- Run after the exact readiness migration inside a rollback-only transaction.

begin;

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
      and grant_readiness = 'verified'
  ) <> cardinality(v_codes) then
    raise exception 'Payment/Quantity readiness promotion did not verify the exact five actions.';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code = 'project.payment.mark_paid'
      and grant_readiness = 'verified'
  ) then
    raise exception 'Payment mark_paid was promoted without lifecycle evidence.';
  end if;
end;
$$;

select 'phase02_task3_payment_quantity_readiness_promotion_smoke_passed' as checkpoint;

rollback;
