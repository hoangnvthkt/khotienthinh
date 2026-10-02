-- Rollback for 20261004180000_authorization_retire_label_only_permissions.
update public.permission_actions set is_active = true, updated_at = now()
where permission_code in ('booking.vehicle.trip.execute', 'asset.catalog.manage', 'asset.maintenance.manage', 'request.category.manage');
update public.user_permission_grants g
set is_active = true, revoked_at = (b.prev_row ->> 'revoked_at')::timestamptz,
    revoked_by = (b.prev_row ->> 'revoked_by')::uuid, revoked_reason = b.prev_row ->> 'revoked_reason', updated_at = now()
from app_private.label_permission_retirement_backup b
where b.kind = 'grant' and g.id::text = b.ref;
update public.user_permission_templates t
set items = b.prev_row -> 'items', updated_at = now()
from app_private.label_permission_retirement_backup b
where b.kind = 'template' and t.code = b.ref;
delete from supabase_migrations.schema_migrations where version = '20261004180000';
