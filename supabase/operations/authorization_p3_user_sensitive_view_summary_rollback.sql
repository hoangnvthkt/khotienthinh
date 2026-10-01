drop function if exists public.get_user_sensitive_view_summary(uuid);
delete from supabase_migrations.schema_migrations where version = '20261004110000';
