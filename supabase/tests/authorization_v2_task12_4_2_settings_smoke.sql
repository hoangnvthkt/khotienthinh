-- Cloud-only smoke for Task 12.4.2-B. Every fixture and write is rolled back.
begin;

create temporary table task12_4_2_settings_actor on commit drop as
select id, auth_id
from public.users
where is_active
  and account_status = 'ACTIVE'
  and role::text = 'EMPLOYEE'
  and auth_id is not null
  and not app_private.has_permission(id, 'system.settings.manage', 'global', '*')
limit 1;

do $$
begin
  if not exists (select 1 from task12_4_2_settings_actor) then
    raise exception 'No safe employee fixture is available';
  end if;
end;
$$;

insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select id, 'settings.general.view', 'global', '*', true, 'Task 12.4.2 rollback-only smoke'
from task12_4_2_settings_actor;

select set_config('request.jwt.claim.sub', (select auth_id::text from task12_4_2_settings_actor), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_updated integer;
begin
  if not app_private.settings_has_action('general', false) then
    raise exception 'Feature view grant did not authorize general read';
  end if;
  if app_private.settings_has_action('general', true) then
    raise exception 'Feature view grant unexpectedly authorized general write';
  end if;
  if app_private.settings_has_action('warehouses', false) then
    raise exception 'General grant leaked to warehouses';
  end if;

  with changed as (
    update public.app_settings set name = name returning 1
  ) select count(*) into v_updated from changed;
  if v_updated <> 0 then
    raise exception 'View-only grant updated app_settings';
  end if;
end;
$$;

reset role;
insert into public.user_permission_grants (
  user_id, permission_code, scope_type, scope_id, is_active, grant_reason
)
select id, 'settings.general.manage', 'global', '*', true, 'Task 12.4.2 rollback-only smoke'
from task12_4_2_settings_actor;
set local role authenticated;

do $$
declare
  v_updated integer;
begin
  if not app_private.settings_has_action('general', true) then
    raise exception 'Feature manage grant did not authorize general write';
  end if;

  with changed as (
    update public.app_settings set name = name returning 1
  ) select count(*) into v_updated from changed;
  if v_updated < 1 then
    raise exception 'Manage grant could not update app_settings';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from app_private.permission_application_default_view_grants
    where application_code = 'settings'
      and permission_code = any(array[
        'settings.users.view', 'settings.alerts.view',
        'settings.permission_health.view', 'settings.ai_learning.view',
        'settings.maintenance.view'
      ]::text[])
      and is_active
  ) then
    raise exception 'Sensitive Settings feature entered the default view bundle';
  end if;
end;
$$;

rollback;
