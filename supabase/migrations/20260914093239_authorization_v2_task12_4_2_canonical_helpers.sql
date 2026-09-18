-- Task 12.4.2-E: remove legacy user-column decisions from Chat and AI Learning.

create or replace function app_private.chat_v2_has_app_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and (
      app_private.has_permission(p_user_id, 'system.chat.view', 'global', '*')
      or app_private.has_permission(p_user_id, 'system.chat.manage', 'global', '*')
    );
$$;

create or replace function public.can_manage_ai_learning()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.settings_has_action('ai_learning', true);
$$;

revoke all on function app_private.chat_v2_has_app_access(uuid) from public, anon;
grant execute on function app_private.chat_v2_has_app_access(uuid) to authenticated, service_role;

revoke all on function public.can_manage_ai_learning() from public, anon;
grant execute on function public.can_manage_ai_learning() to authenticated, service_role;
