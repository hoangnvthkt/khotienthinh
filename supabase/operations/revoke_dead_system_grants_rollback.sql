-- ROLLBACK for 20261009200000_revoke_dead_system_grants. Not a migration; apply as a reviewed forward migration.
-- Re-activates exactly the backed-up rows of users that are still active.
update public.user_permission_grants g
set is_active = true, revoked_at = null, revoked_by = null, revoked_reason = null, updated_at = now()
from app_private.revoked_dead_system_grants_20261009 snap
join public.users u on u.id = snap.user_id and u.is_active
where snap.id = g.id and not g.is_active;
