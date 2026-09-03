-- Web Push v2 hardening:
-- - device metadata for PWA/iOS debugging
-- - provider status code for delivery diagnostics
-- - idempotent trigger wiring so every inserted user notification invokes send-web-push

alter table public.web_push_subscriptions
  add column if not exists browser text,
  add column if not exists is_standalone_pwa boolean,
  add column if not exists manifest_id text,
  add column if not exists vapid_public_key_hash text,
  add column if not exists notification_permission text;

create index if not exists idx_web_push_subscriptions_platform_active
  on public.web_push_subscriptions(platform, is_active);

create index if not exists idx_web_push_subscriptions_browser_active
  on public.web_push_subscriptions(browser, is_active);

alter table public.notification_deliveries
  add column if not exists provider_status_code integer;

create index if not exists idx_notification_deliveries_provider_status_code
  on public.notification_deliveries(provider_status_code);

create extension if not exists pg_net;
create extension if not exists supabase_vault cascade;

create schema if not exists private;

create or replace function private.notify_web_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if new.user_id is null or coalesce(new.push_enabled, true) is false then
    return new;
  end if;

  select decrypted_secret
    into v_url
  from vault.decrypted_secrets
  where name = 'send_web_push_url'
  limit 1;

  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'send_web_push_secret'
  limit 1;

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('notificationId', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-web-push-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_web_push_on_notification on public.notifications;

create trigger trg_notify_web_push_on_notification
after insert on public.notifications
for each row
execute function private.notify_web_push_on_notification();

notify pgrst, 'reload schema';
