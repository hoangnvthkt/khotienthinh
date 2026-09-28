-- P2 (Settings → Users): the edit screen showed "0 Room" and inherited
-- permissions from the account type only, because the snapshot could be read
-- for the signed-in person alone. Admins and people who manage permission
-- grants may now read the snapshot of the person they are editing. The shape
-- matches get_my_authorization_snapshot().

create or replace function public.get_user_authorization_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := public.current_app_user_id();
  v_snapshot jsonb;
  v_sources jsonb;
begin
  if v_actor_id is null then
    raise exception 'Active application account required' using errcode = '42501';
  end if;
  if p_user_id is distinct from v_actor_id
     and not public.is_admin()
     and not app_private.has_permission(v_actor_id, 'system.authorization.manage_grants', 'global', '*') then
    raise exception 'USER_SNAPSHOT_PERMISSION_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_snapshot := app_private.resolve_authorization_snapshot(p_user_id);

  select coalesce(jsonb_agg(source_row.value order by source_row.position), '[]'::jsonb)
    into v_sources
  from jsonb_array_elements(v_snapshot -> 'sources') with ordinality as source_row(value, position)
  where not (source_row.value ->> 'permissionCode' like 'work.%'
             and upper(source_row.value ->> 'sourceType') = 'LEGACY');

  return jsonb_set(v_snapshot, '{sources}', v_sources, true);
end;
$$;

revoke all on function public.get_user_authorization_snapshot(uuid) from public, anon;
grant execute on function public.get_user_authorization_snapshot(uuid) to authenticated;
