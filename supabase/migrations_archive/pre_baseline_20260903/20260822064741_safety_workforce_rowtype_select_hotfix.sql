begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_function record;
  v_definition text;
  v_alias text;
  v_needle text;
  v_occurrences integer;
  v_function_count integer := 0;
  v_replacement_count integer := 0;
  v_expected_functions constant text[] := array[
    'assign_safety_worker_to_site',
    'create_safety_worker_profile_for_site',
    'end_safety_worker_assignment',
    'get_safety_site_worker_detail',
    'issue_safety_assignment_card',
    'log_safety_card_print',
    'lookup_safety_worker_exact',
    'renew_safety_assignment_card',
    'revoke_safety_assignment_card',
    'safety_workforce_detail_for_membership',
    'transfer_safety_worker_site',
    'update_safety_worker_assignment',
    'update_safety_worker_profile_for_site',
    'upsert_safety_worker_documents_for_site'
  ];
begin
  for v_function in
    select procedure.oid, procedure.oid::regprocedure::text as identity
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_private'
      and procedure.proname = any(v_expected_functions)
    order by procedure.proname
  loop
    v_function_count := v_function_count + 1;
    v_definition := pg_get_functiondef(v_function.oid);

    foreach v_alias in array array['membership', 'worker', 'assignment', 'card']
    loop
      v_needle := 'select ' || v_alias || chr(10);
      v_occurrences := (
        length(v_definition) - length(replace(v_definition, v_needle, ''))
      ) / length(v_needle);

      if v_occurrences > 0 then
        v_definition := replace(
          v_definition,
          v_needle,
          'select ' || v_alias || '.*' || chr(10)
        );
        v_replacement_count := v_replacement_count + v_occurrences;
      end if;
    end loop;

    execute v_definition;
  end loop;

  if v_function_count <> cardinality(v_expected_functions) then
    raise exception
      'SAFETY_HOTFIX_FUNCTION_COUNT: expected %, found %',
      cardinality(v_expected_functions),
      v_function_count;
  end if;

  if v_replacement_count <> 36 then
    raise exception
      'SAFETY_HOTFIX_REPLACEMENT_COUNT: expected 36, found %',
      v_replacement_count;
  end if;
end;
$$;

commit;
