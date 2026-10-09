# Pending Cloud migrations

Files in this directory are intentionally excluded from automatic migration rollout.

`quality_room_enforcement_after_uat.sql` may be moved into `supabase/migrations/`
with a new CLI-generated timestamp only after Quality Room UAT is accepted. Its
database guard also requires `fallback_only_user_count = 0`.

If enforcement must be rolled back, create a new migration that sets every
`quality` binding to `enforcement_status = 'pilot'` and
`pbac_fallback_enabled = true`. Do not remove Room grants, command requests, or
audit history.

`authorization_task13_drop_legacy_columns.sql` (prepared 2026-10-09) drops
`public.users.allowed_modules`, `admin_modules`, `allowed_sub_modules`,
`admin_sub_modules` after backing them up into
`app_private.authorization_task13_legacy_column_snapshots` with SHA-256
checksums. Move it into `supabase/migrations/` with a new timestamp only after
the product owner confirms, then run
`supabase/tests/authorization_task13_drop_legacy_columns_smoke.sql` and
`supabase/tests/authorization_task13_stop_reading_legacy_modules_smoke.sql`.
Rollback is the reviewed forward script
`supabase/operations/authorization_task13_drop_legacy_columns_rollback.sql`
(rehearsed on Cloud in a rolled-back transaction: 95/95 users restored, every
routine definition and ACL identical).
