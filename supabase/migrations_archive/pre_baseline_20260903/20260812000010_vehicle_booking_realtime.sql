-- Enable the Phase 2 dispatch read models for Supabase Realtime Postgres Changes.

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'vehicle_bookings',
    'vehicle_booking_assignments',
    'fleet_vehicle_profiles',
    'vehicle_unavailability_periods',
    'operator_unavailability_periods'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
