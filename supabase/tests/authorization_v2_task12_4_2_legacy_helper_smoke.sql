-- Cloud-only Task 12.4.2-E helper cutover smoke. All writes roll back.
begin;

create temporary table task12_4_2_helper_context on commit drop as
select u.id as target_id, u.auth_id as target_auth_id
from public.users u
where u.is_active and u.account_status = 'ACTIVE' and u.role::text = 'EMPLOYEE'
  and u.auth_id is not null
  and (u.allowed_modules is null or 'CHAT' = any(coalesce(u.allowed_modules, '{}'::text[])))
  and app_private.has_permission(u.id, 'system.chat.view', 'global', '*')
  and not app_private.has_permission(u.id, 'system.chat.manage', 'global', '*')
order by u.id limit 1;

do $$
begin
  if not exists (select 1 from task12_4_2_helper_context) then
    raise exception 'Chat helper smoke fixture unavailable';
  end if;
end;
$$;

select set_config('app.authorization_permission_command', 'on', true);
update public.user_permission_grants
set is_active = false, updated_at = now()
where user_id = (select target_id from task12_4_2_helper_context)
  and permission_code = 'system.chat.view'
  and is_active;

do $$
declare v_target uuid := (select target_id from task12_4_2_helper_context);
begin
  if app_private.chat_v2_has_app_access(v_target) then
    raise exception 'Legacy module fields still grant Chat access';
  end if;
end;
$$;

-- The active administrator must retain AI Learning management through the
-- canonical SYSTEM_ADMIN -> system.settings.manage source.
select set_config('request.jwt.claim.sub', auth_id::text, true)
from public.users
where is_active and account_status = 'ACTIVE' and role::text = 'ADMIN' and auth_id is not null
order by id limit 1;
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  if not public.can_manage_ai_learning() then
    raise exception 'Canonical Settings administration lost AI Learning management';
  end if;
end;
$$;

reset role;
rollback;
