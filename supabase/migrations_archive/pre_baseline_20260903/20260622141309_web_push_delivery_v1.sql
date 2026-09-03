-- Complete Web Push delivery support without replacing the existing in-app
-- notifications flow.

alter table public.web_push_subscriptions
  add column if not exists platform text,
  add column if not exists device_type text,
  add column if not exists is_active boolean not null default true,
  add column if not exists last_used_at timestamptz;

create index if not exists idx_web_push_subscriptions_is_active
  on public.web_push_subscriptions(is_active);

create index if not exists idx_web_push_subscriptions_user_active
  on public.web_push_subscriptions(user_id, is_active);

create index if not exists idx_web_push_subscriptions_endpoint
  on public.web_push_subscriptions(endpoint);

alter table public.notifications
  add column if not exists priority text not null default 'normal',
  add column if not exists push_enabled boolean not null default true,
  add column if not exists action_url text,
  add column if not exists entity_type text,
  add column if not exists entity_id uuid;

update public.notifications
set priority = 'normal'
where priority is null;

update public.notifications
set push_enabled = true
where push_enabled is null;

alter table public.notifications
  alter column priority set default 'normal',
  alter column priority set not null,
  alter column push_enabled set not null,
  alter column push_enabled set default true;

create index if not exists idx_notifications_push_pending_user
  on public.notifications(user_id, push_enabled, created_at desc)
  where user_id is not null and coalesce(push_enabled, true) = true;

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  channel text not null,
  status text not null default 'pending',
  provider text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_deliveries_channel_check
    check (channel in ('in_app', 'web_push', 'email', 'telegram')),
  constraint notification_deliveries_status_check
    check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index if not exists idx_notification_deliveries_notification_id
  on public.notification_deliveries(notification_id);

create index if not exists idx_notification_deliveries_user_id
  on public.notification_deliveries(user_id);

create index if not exists idx_notification_deliveries_channel
  on public.notification_deliveries(channel);

create index if not exists idx_notification_deliveries_status
  on public.notification_deliveries(status);

create index if not exists idx_notification_deliveries_created_at
  on public.notification_deliveries(created_at desc);

alter table public.notification_deliveries enable row level security;

drop policy if exists notification_deliveries_select on public.notification_deliveries;

create policy notification_deliveries_select
  on public.notification_deliveries
  for select
  to authenticated
  using (user_id = public.current_app_user_id() or public.is_admin());

revoke all on table public.notification_deliveries from anon;
revoke all on table public.notification_deliveries from public;
revoke all on table public.notification_deliveries from authenticated;
grant select on table public.notification_deliveries to authenticated;
grant all on table public.notification_deliveries to service_role;

grant select, insert, update, delete on table public.web_push_subscriptions to authenticated;
grant all on table public.web_push_subscriptions to service_role;

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

notify pgrst, 'reload schema';
