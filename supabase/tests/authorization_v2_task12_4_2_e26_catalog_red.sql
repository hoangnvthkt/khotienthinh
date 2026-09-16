-- Cloud RED gate: this must fail before E26 migrations and pass after apply.
do $$
begin
  if (
    select count(*)
    from public.permission_actions
    where permission_code in (
      'request.instance.approve_assigned',
      'request.instance.reject_assigned',
      'request.instance.return_assigned',
      'request.instance.resubmit_own',
      'request.instance.cancel',
      'request.instance.reassign',
      'request.instance.edit_own_content'
    )
      and is_active
      and grant_readiness = 'enforced'
  ) <> 7 then
    raise exception 'E26 Request lifecycle catalog is incomplete';
  end if;

  if not exists (
    select 1 from public.role_permission_templates
    where code = 'SUPER_ADMIN' and is_system and is_active
  ) then
    raise exception 'E26 SUPER_ADMIN template is missing';
  end if;
end;
$$;
