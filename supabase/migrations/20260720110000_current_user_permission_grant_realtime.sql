-- Keep the authenticated user's effective permission snapshot current when
-- Direct Grants are added, reactivated, have expiry edited, or are revoked.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_permission_grants'
  ) then
    alter publication supabase_realtime add table public.user_permission_grants;
  end if;
end
$$;
