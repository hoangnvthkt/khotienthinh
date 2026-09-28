-- Rollback for notification_delivery_reason. Roll the frontend back first:
-- the inbox selects and filters on delivery_reason.
begin;
drop trigger if exists notifications_set_delivery_reason on public.notifications;
drop function if exists app_private.notifications_set_delivery_reason();
drop function if exists app_private.notification_delivery_reason(text, text, text, text, text, jsonb);
drop index if exists public.idx_notifications_user_reason_visible_created_id;
alter table public.notifications drop constraint if exists notifications_delivery_reason_check;
alter table public.notifications drop column if exists delivery_reason;
commit;
