-- Public request-template RPCs are SECURITY INVOKER wrappers and call this
-- private guard, so authenticated users need execute access to the guard.
grant execute on function app_private.request_user_can_manage(uuid) to authenticated;
