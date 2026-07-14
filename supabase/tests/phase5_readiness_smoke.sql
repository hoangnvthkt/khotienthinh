-- Phase 5 readiness gate.
-- This smoke is expected to fail until Phase 4 enforcement is complete for every seeded ERP domain.

begin;

do $$
declare
  v_missing_enforcement text[];
  v_broad_policies text[];
begin
  with required_domain(module_code) as (
    values
      ('wms'),
      ('hrm'),
      ('expense'),
      ('workflow'),
      ('request'),
      ('asset'),
      ('contract'),
      ('ai'),
      ('storage'),
      ('kb'),
      ('analytics')
  ),
  policy_hits as (
    select rd.module_code
    from required_domain rd
    where exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and (
          coalesce(p.qual, '') ilike '%' || rd.module_code || '.%'
          or coalesce(p.with_check, '') ilike '%' || rd.module_code || '.%'
        )
    )
  ),
  function_hits as (
    select rd.module_code
    from required_domain rd
    where exists (
      select 1
      from pg_proc proc
      join pg_namespace n on n.oid = proc.pronamespace
      where n.nspname in ('app_private', 'public')
        and proc.prokind in ('f', 'p')
        and proc.proname not in (
          'replace_user_permission_grants',
          'get_permission_health_summary',
          'sync_legacy_permission_projection'
        )
        and pg_get_functiondef(proc.oid) ilike '%' || rd.module_code || '.%'
    )
  )
  select array_agg(rd.module_code order by rd.module_code)
  into v_missing_enforcement
  from required_domain rd
  where not exists (
    select 1
    from policy_hits ph
    where ph.module_code = rd.module_code
  )
  and not exists (
    select 1
    from function_hits fh
    where fh.module_code = rd.module_code
  );

  select array_agg(format('%I.%I:%I', p.schemaname, p.tablename, p.policyname) order by p.schemaname, p.tablename, p.policyname)
  into v_broad_policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename <> all(array[
      'app_release_notices',
      'permission_applications',
      'permission_modules',
      'permission_actions'
    ])
    and (
      lower(trim(coalesce(p.qual, ''))) in ('true', '(true)')
      or lower(trim(coalesce(p.with_check, ''))) in ('true', '(true)')
    );

  if coalesce(array_length(v_missing_enforcement, 1), 0) > 0 then
    raise exception 'Phase 5 readiness failed: Phase 4 domains still missing namespace enforcement markers: %', array_to_string(v_missing_enforcement, ', ');
  end if;

  if coalesce(array_length(v_broad_policies, 1), 0) > 0 then
    raise exception 'Phase 5 readiness failed: broad public policies require allowlist/rewrite before fallback removal: %', array_to_string(v_broad_policies[1:20], ', ');
  end if;
end $$;

rollback;
