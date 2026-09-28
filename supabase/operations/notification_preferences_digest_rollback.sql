-- Rollback for notification_preferences_digest. Roll the frontend back first
-- (it reads delivery_mode and the preferences). Pending digest notices become
-- ordinary instant notices again.
begin;
select cron.unschedule(jobid) from cron.job where jobname = 'notification-digests';
create or replace function app_private.notifications_set_delivery_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.delivery_reason is null then
    new.delivery_reason := app_private.notification_delivery_reason(
      new.user_id::text, new.source_type, new.source_id, new.category, new.title, new.metadata);
  end if;
  return new;
end;
$$;
revoke all on function app_private.notifications_set_delivery_reason() from public, anon, authenticated;
drop function if exists app_private.send_notification_digests();
drop function if exists public.set_my_notification_preferences(text, text, time);
drop table if exists public.notification_preferences;
drop index if exists public.idx_notifications_digest_pending;
alter table public.notifications drop constraint if exists notifications_delivery_mode_check;
alter table public.notifications drop column if exists delivery_mode;
commit;
