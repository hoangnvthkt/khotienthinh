# Pending Cloud migrations

Files in this directory are intentionally excluded from automatic migration rollout.

`quality_room_enforcement_after_uat.sql` may be moved into `supabase/migrations/`
with a new CLI-generated timestamp only after Quality Room UAT is accepted. Its
database guard also requires `fallback_only_user_count = 0`.

If enforcement must be rolled back, create a new migration that sets every
`quality` binding to `enforcement_status = 'pilot'` and
`pbac_fallback_enabled = true`. Do not remove Room grants, command requests, or
audit history.
