begin;

-- The public invoker RPC delegates to this guarded worker. Migration
-- 20260828105000 correctly removed PUBLIC/anon access but also removed the
-- authenticated execution path, causing profile resolution to fail directly
-- after login. The worker validates the current actor and target before
-- returning any authorization source.
revoke all on function app_private.get_effective_permission_sources_authorized(uuid)
from public, anon;

grant execute on function app_private.get_effective_permission_sources_authorized(uuid)
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
