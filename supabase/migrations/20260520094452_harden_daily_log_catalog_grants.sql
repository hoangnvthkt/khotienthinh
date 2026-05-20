-- Tighten direct role grants for daily-log progress and catalog tables.
-- RLS remains the enforcement layer; anon/public should not have direct table grants.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'public.contract_labor_catalogs',
    'public.daily_log_volumes',
    'public.daily_log_labor',
    'public.daily_log_machines'
  ]
  loop
    if to_regclass(table_name) is not null then
      execute format('revoke all privileges on table %s from anon', table_name);
      execute format('revoke all privileges on table %s from public', table_name);
      execute format('grant select, insert, update, delete on table %s to authenticated', table_name);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
