update public.permission_actions set direct_grant_allowed = true, updated_at = now()
where permission_code in ('project.daily_log.publish_progress', 'project.payment.view_resource_evidence');
delete from supabase_migrations.schema_migrations where version = '20261004160000';
