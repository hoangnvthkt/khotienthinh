-- Rollback for authorization_user_snapshot_for_admins. Roll the Settings →
-- Users frontend back first; the edit screen calls this RPC (it shows an error
-- state with Retry when the call fails).
begin;
drop function if exists public.get_user_authorization_snapshot(uuid);
commit;
