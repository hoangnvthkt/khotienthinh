-- The public wrapper must cross the app_private ACL boundary as its owner.
-- Actor identity still comes only from the request JWT and the private reader
-- enforces the exact project/site Room action before reading any BOQ data.
create or replace function public.list_boq_material_planning_v1(
  p_project_id text,
  p_construction_site_id text default null,
  p_parent_id text default null,
  p_search text default null,
  p_limit integer default 50,
  p_cursor text default null,
  p_as_of timestamptz default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.list_boq_material_planning_v1(
    public.current_app_user_id(),
    p_project_id,
    nullif(p_construction_site_id, ''),
    nullif(p_parent_id, ''),
    nullif(p_search, ''),
    p_limit,
    nullif(p_cursor, ''),
    p_as_of
  );
$$;

revoke all on function public.list_boq_material_planning_v1(
  text, text, text, text, integer, text, timestamptz
) from public, anon;
grant execute on function public.list_boq_material_planning_v1(
  text, text, text, text, integer, text, timestamptz
) to authenticated, service_role;

notify pgrst, 'reload schema';
