-- Trigger real Web Push delivery when a user notification is inserted.
-- Required Vault secrets, created outside this migration:
--   send_web_push_url
--   send_web_push_secret

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
  if new.user_id is null then
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
