-- Keep the request-template command authorization aligned with the RQ module
-- and its registered template-management route.
create or replace function app_private.request_user_can_manage(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = p_user_id
      and coalesce(app_user.is_active, true)
      and coalesce(app_user.account_status, 'ACTIVE') = 'ACTIVE'
      and (
        app_user.role = 'ADMIN'
        or 'RQ' = any(coalesce(app_user.admin_modules, '{}'::text[]))
        or exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(app_user.admin_sub_modules -> 'RQ', '[]'::jsonb)
          ) as admin_route(route)
          where admin_route.route = '/rq/templates'
        )
        or app_private.has_permission(
          p_user_id,
          'request.template.manage',
          'global',
          '*'
        )
      )
  );
$$;

revoke all on function app_private.request_user_can_manage(uuid)
  from public, anon, authenticated;
