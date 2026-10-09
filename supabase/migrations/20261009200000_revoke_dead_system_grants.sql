-- Revoke direct system.* grants that no longer have any effect (product owner approved 2026-10-09).
-- Report: docs/security/retained-system-grants-reconciliation-2026-10-09.md, group B.
-- These codes open no screen (every route they listed now has a domain module, which canViewRoute prefers)
-- and no SQL routine checks them. Rows are backed up first; revoked rows keep their history.
-- Rollback: supabase/operations/revoke_dead_system_grants_rollback.sql

create table app_private.revoked_dead_system_grants_20261009 (
  like public.user_permission_grants,
  captured_at timestamptz not null default now()
);
alter table app_private.revoked_dead_system_grants_20261009 enable row level security;
revoke all on app_private.revoked_dead_system_grants_20261009 from public, anon, authenticated;

do $$
declare
  v_codes constant text[] := array[
    'system.wf.view', 'system.wf.manage',
    'system.ts.view', 'system.ts.manage',
    'system.ex.view', 'system.ex.manage',
    'system.hd.view', 'system.rq.manage',
    'system.kb.view', 'system.kb.manage',
    'system.ai.view', 'system.ai.manage',
    'system.storage.view', 'system.storage.manage',
    'system.analytics.view', 'system.analytics.manage'
  ];
  v_used text;
  v_count integer;
begin
  select string_agg(distinct code || ' <- ' || n.nspname || '.' || p.proname, ', ') into v_used
  from unnest(v_codes) code
  join pg_proc p on p.prosrc like '%''' || code || '''%'
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema');
  if v_used is not null then
    raise exception 'Stop: a routine still checks a code being revoked: %', v_used;
  end if;

  if exists (select 1 from public.role_permission_template_items where permission_code = any(v_codes))
    or exists (select 1 from public.permission_quick_template_items where permission_code = any(v_codes)) then
    raise exception 'Stop: a permission template still hands out a code being revoked';
  end if;

  insert into app_private.revoked_dead_system_grants_20261009
  select g.*, now() from public.user_permission_grants g
  where g.is_active and g.permission_code = any(v_codes);
  get diagnostics v_count = row_count;

  update public.user_permission_grants g
  set is_active = false,
      revoked_at = now(),
      revoked_reason = 'Thu hồi quyền system.* không còn tác dụng (đối soát 09/10/2026)',
      updated_at = now()
  from app_private.revoked_dead_system_grants_20261009 snap
  where snap.id = g.id;

  insert into public.permission_audit_events (actor_user_id, target_user_id, event_type, before_grants, after_grants, metadata)
  select null, snap.user_id, 'dead_system_grants_revoked',
    jsonb_agg(snap.permission_code order by snap.permission_code), '[]'::jsonb,
    jsonb_build_object('report', 'docs/security/retained-system-grants-reconciliation-2026-10-09.md',
      'backup', 'app_private.revoked_dead_system_grants_20261009')
  from app_private.revoked_dead_system_grants_20261009 snap
  group by snap.user_id;

  raise notice 'Revoked % dead system.* grants', v_count;
end $$;
