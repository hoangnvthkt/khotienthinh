do $$
declare
  v_private regprocedure := to_regprocedure('app_private.list_boq_material_planning_v1(uuid,text,text,text,text,integer,text,timestamp with time zone)');
  v_public regprocedure := to_regprocedure('public.list_boq_material_planning_v1(text,text,text,text,integer,text,timestamp with time zone)');
begin
  if v_private is null or v_public is null then
    raise exception 'G3_BOQ_READER_MISSING';
  end if;
  if not exists (
    select 1 from pg_proc where oid = v_private and prosecdef
      and proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G3_BOQ_PRIVATE_CONTRACT_INVALID';
  end if;
  if not exists (
    select 1 from pg_proc where oid = v_public and not prosecdef
      and proconfig @> array['search_path=""']::text[]
  ) then
    raise exception 'G3_BOQ_PUBLIC_CONTRACT_INVALID';
  end if;
  if has_function_privilege('anon', v_public, 'execute')
     or not has_function_privilege('authenticated', v_public, 'execute') then
    raise exception 'G3_BOQ_PUBLIC_ACL_INVALID';
  end if;
  if has_function_privilege('authenticated', v_private, 'execute') then
    raise exception 'G3_BOQ_PRIVATE_ACL_INVALID';
  end if;
end $$;
