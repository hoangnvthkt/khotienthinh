-- Application extension layout captured from the production source of truth.
-- Fresh Supabase branches provision pg_net in `extensions`; this legacy project
-- owns it in `public`, so an empty branch must recreate it before app DDL runs.
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net'
      and n.nspname <> 'public'
  ) then
    drop extension pg_net;
  end if;
end
$$;

create extension if not exists btree_gist with schema public;
create extension if not exists hypopg with schema extensions;
create extension if not exists index_advisor with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema public;
create extension if not exists pg_trgm with schema public;
create extension if not exists unaccent with schema public;
create extension if not exists vector with schema public;
