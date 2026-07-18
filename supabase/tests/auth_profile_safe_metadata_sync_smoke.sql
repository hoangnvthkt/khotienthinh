do $$
declare
  v_definition text;
begin
  select lower(regexp_replace(
    pg_get_functiondef('public.sync_auth_user_profile()'::regprocedure),
    '\s+',
    ' ',
    'g'
  ))
  into v_definition;

  if v_definition ~
    $pattern$raw_user_meta_data\s*(->>|->|\?)\s*'(role|username|assignedwarehouseid|allowedmodules|adminmodules|allowedsubmodules|adminsubmodules|isactive|accountstatus)'$pattern$
  then
    raise exception 'Auth profile trigger still trusts protected user metadata';
  end if;

  if position('raw_user_meta_data ->> ''name''' in v_definition) = 0
    or position('raw_user_meta_data ->> ''phone''' in v_definition) = 0
    or position('raw_user_meta_data ->> ''avatar''' in v_definition) = 0
    or position('''employee''::public.user_role' in v_definition) = 0
  then
    raise exception 'Auth profile trigger safe-field contract is incomplete';
  end if;
end;
$$;

select 'auth_profile_safe_metadata_sync_smoke_passed' as checkpoint;
