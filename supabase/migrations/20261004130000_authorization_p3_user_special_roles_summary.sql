-- Read-only: the roles currently held by one person (HR, HR Manage, System Admin, Auditor,
-- Permission Admin, ...), so the user editor can show them next to personal grants and Rooms.
create or replace function public.get_user_special_roles(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'SPECIAL_ROLES_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'assignmentId', a.id,
      'roleCode', t.code,
      'roleName', t.name,
      'scopeType', a.scope_type,
      'scopeId', a.scope_id,
      'startsAt', a.starts_at,
      'expiresAt', a.expires_at
    ) order by t.name, a.created_at)
    from public.principal_role_assignments a
    join public.role_permission_templates t on t.id = a.role_template_id
    where a.principal_type = 'user'
      and a.principal_id = p_user_id
      and a.status = 'ACTIVE'
      and a.starts_at <= now()
      and (a.expires_at is null or a.expires_at > now())
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_user_special_roles(uuid) from public, anon;
grant execute on function public.get_user_special_roles(uuid) to authenticated;
