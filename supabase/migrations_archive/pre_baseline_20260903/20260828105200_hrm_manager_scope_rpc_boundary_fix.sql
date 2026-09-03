begin;

-- These public RPCs already validate the caller's governed template permission
-- before touching private state. They must cross the app_private EXECUTE boundary
-- as the function owner when invoked through PostgREST's authenticated role.
alter function public.get_hrm_manager_scope_readiness()
  security definer;

alter function public.set_hrm_manager_scope_enabled(boolean, text)
  security definer;

revoke all on function app_private.get_hrm_manager_scope_readiness()
from public, anon, authenticated;
revoke all on function public.get_hrm_manager_scope_readiness()
from public, anon;
revoke all on function public.set_hrm_manager_scope_enabled(boolean, text)
from public, anon;
grant execute on function public.get_hrm_manager_scope_readiness()
to authenticated, service_role;
grant execute on function public.set_hrm_manager_scope_enabled(boolean, text)
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
