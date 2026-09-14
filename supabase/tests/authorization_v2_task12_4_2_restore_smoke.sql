-- Static contract checks for the restore boundary; behavior is exercised by
-- authorization_v2_task12_4_2_reconciliation.sql in one rollback-only fixture.
begin;

do $$
begin
  if to_regprocedure('public.apply_authorization_transition_batch_v2(text,text,jsonb,text)') is null
    or to_regprocedure('public.restore_authorization_transition_batch_v2(text,text)') is null
    or to_regprocedure('public.preview_authorization_transition_sources(uuid)') is null
  then
    raise exception 'Task 12.4.2 transition RPC contract is incomplete';
  end if;
  if has_function_privilege('anon', 'public.apply_authorization_transition_batch_v2(text,text,jsonb,text)', 'execute')
    or has_function_privilege('anon', 'public.restore_authorization_transition_batch_v2(text,text)', 'execute')
  then
    raise exception 'Anonymous role can execute transition commands';
  end if;
end;
$$;

rollback;
