-- Enable Supabase Realtime for critical application tables
-- These tables already have realtime event handlers in AppContext.tsx
-- but were never added to the supabase_realtime publication.

do $$
declare
  _tables text[] := array[
    'items',
    'transactions',
    'warehouses',
    'requests',
    'users',
    'app_settings',
    'suppliers',
    'activities',
    'employees',
    'categories',
    'units'
  ];
  _t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime does not exist, skipping.';
    return;
  end if;

  foreach _t in array _tables loop
    -- Only add if not already published
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = _t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', _t);
      raise notice 'Added table public.% to supabase_realtime', _t;
    else
      raise notice 'Table public.% already in supabase_realtime, skipping', _t;
    end if;
  end loop;
end $$;
