-- Material approval readiness-promotion smoke.
-- Run after the exact readiness migration inside a rollback-only transaction.

begin;

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
      and grant_readiness = 'verified'
  ) <> cardinality(v_codes) then
    raise exception 'Material approval readiness promotion did not verify the exact three actions.';
  end if;

  if exists (
    select 1
    from public.permission_actions
    where permission_code in (
      'project.material_request.confirm',
      'project.material_request.verify'
    )
      and grant_readiness = 'verified'
  ) then
    raise exception 'An unpromoted Material adjacent action was verified.';
  end if;
end;
$$;

select 'phase02_task3_material_approval_readiness_promotion_smoke_passed' as checkpoint;

rollback;
