-- Rollback for 20261004190000_asset_audit_sessions. Drops stored audits: export them first.
update public.permission_actions set grant_readiness = 'declared', updated_at = now() where permission_code = 'asset.audit.perform';
drop table if exists public.asset_audit_sessions;
drop function if exists app_private.asset_audit_sessions_stamp_auditor();
delete from supabase_migrations.schema_migrations where version = '20261004190000';
