-- Phase 4 AI/KB/Storage/Analytics policy marker smoke.
-- Run after phase4_global_modules_enforcement.

begin;

do $$
declare
  v_missing text[];
  v_broad text[];
begin
  with required_markers(module_code) as (
    values
      ('ai'),
      ('storage'),
      ('kb'),
      ('analytics')
  )
  select array_agg(module_code order by module_code)
  into v_missing
  from required_markers marker
  where not exists (
    select 1
    from pg_proc proc
    join pg_namespace n on n.oid = proc.pronamespace
    where n.nspname = 'app_private'
      and proc.proname in (
        'ai_has_action',
        'storage_has_action',
        'kb_has_action',
        'analytics_has_action'
      )
      and pg_get_functiondef(proc.oid) ilike '%' || marker.module_code || '.%'
  )
  and not exists (
    select 1
    from pg_policies p
    where p.schemaname in ('public', 'storage')
      and (
        coalesce(p.qual, '') ilike '%' || marker.module_code || '.%'
        or coalesce(p.with_check, '') ilike '%' || marker.module_code || '.%'
      )
  );

  select array_agg(format('%I.%I:%I', p.schemaname, p.tablename, p.policyname) order by p.schemaname, p.tablename, p.policyname)
  into v_broad
  from pg_policies p
  where (
      (p.schemaname = 'public' and p.tablename in (
        'rag_documents',
        'rag_chunks',
        'ai_project_insights',
        'ai_query_cache',
        'ai_smart_alerts',
        'ai_scheduled_reports',
        'ai_report_results'
      ))
      or (p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname ilike '%knowledge%base%')
    )
    and (
      lower(trim(coalesce(p.qual, ''))) in ('true', '(true)')
      or lower(trim(coalesce(p.with_check, ''))) in ('true', '(true)')
    );

  if coalesce(array_length(v_missing, 1), 0) > 0 then
    raise exception 'Missing Phase 4 global module enforcement marker(s): %', array_to_string(v_missing, ', ');
  end if;

  if coalesce(array_length(v_broad, 1), 0) > 0 then
    raise exception 'Broad AI/KB/storage policies remain after Phase 4 global enforcement: %', array_to_string(v_broad, ', ');
  end if;
end $$;

rollback;
