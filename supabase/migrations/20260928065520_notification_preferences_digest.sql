-- Notification targeting, step 3: each person chooses how "Following" and
-- "Business area" notices reach them. Owner decision 28/09/2026: business
-- area notices can only move to the end-of-day digest, never be switched off.
--   watching    → instant | digest | muted (kept in the inbox as read)
--   responsible → instant | digest
-- Assigned work, mentions, system notices and anything critical always
-- arrive instantly. A digest notice is stored as usual but not pushed, not
-- counted on the bell, and summarised once a day at the person's chosen time.

alter table public.notifications add column if not exists delivery_mode text not null default 'instant';
alter table public.notifications drop constraint if exists notifications_delivery_mode_check;
alter table public.notifications add constraint notifications_delivery_mode_check
  check (delivery_mode in ('instant', 'digest', 'muted'));

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  watching_mode text not null default 'instant' check (watching_mode in ('instant', 'digest', 'muted')),
  responsible_mode text not null default 'instant' check (responsible_mode in ('instant', 'digest')),
  digest_time time not null default time '17:30' check (digest_time between time '06:00' and time '22:00'),
  last_digest_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon, authenticated;
grant select on public.notification_preferences to authenticated;
drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated using (user_id = public.current_app_user_id() or public.is_admin());

create or replace function public.set_my_notification_preferences(
  p_watching_mode text, p_responsible_mode text, p_digest_time time
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.current_app_user_id();
  v_row public.notification_preferences;
begin
  if v_user is null then
    raise exception 'NOTIFICATION_PREFERENCES_SIGN_IN_REQUIRED' using errcode = '42501';
  end if;
  insert into public.notification_preferences (user_id, watching_mode, responsible_mode, digest_time, updated_at)
  values (v_user, p_watching_mode, p_responsible_mode, p_digest_time, now())
  on conflict (user_id) do update
    set watching_mode = excluded.watching_mode, responsible_mode = excluded.responsible_mode,
        digest_time = excluded.digest_time, updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_my_notification_preferences(text, text, time) from public, anon;
grant execute on function public.set_my_notification_preferences(text, text, time) to authenticated;

-- Reason (step 1) plus the recipient's preference, on every insert.
create or replace function app_private.notifications_set_delivery_reason()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pref public.notification_preferences;
  v_mode text;
begin
  if new.delivery_reason is null then
    new.delivery_reason := app_private.notification_delivery_reason(
      new.user_id::text, new.source_type, new.source_id, new.category, new.title, new.metadata);
  end if;

  if new.user_id is not null and new.delivery_mode = 'instant' and coalesce(new.severity, 'info') <> 'critical'
     and new.delivery_reason in ('watching', 'responsible') then
    select * into v_pref from public.notification_preferences p where p.user_id::text = new.user_id::text;
    if found then
      v_mode := case new.delivery_reason when 'watching' then v_pref.watching_mode else v_pref.responsible_mode end;
      if v_mode = 'digest' then
        new.delivery_mode := 'digest';
        new.push_enabled := false;
      elsif v_mode = 'muted' then
        new.delivery_mode := 'muted';
        new.push_enabled := false;
        new.is_read := true;
        new.read_at := coalesce(new.read_at, now());
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.notifications_set_delivery_reason() from public, anon, authenticated;

-- End-of-day digest: one instant notice per person whose time has come,
-- covering unread digest notices since their previous digest.
create or replace function app_private.send_notification_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Asia/Ho_Chi_Minh';
  v_count integer := 0;
  r record;
begin
  for r in
    select p.user_id,
      count(*) filter (where n.delivery_reason = 'watching') watching,
      count(*) filter (where n.delivery_reason = 'responsible') responsible
    from public.notification_preferences p
    join public.users u on u.id = p.user_id and u.is_active and u.account_status = 'ACTIVE'
    join public.notifications n on n.user_id = p.user_id::text and n.delivery_mode = 'digest'
      and not n.is_read and not n.is_dismissed
      and n.created_at > coalesce(p.last_digest_at, now() - interval '1 day')
    where v_now::time >= p.digest_time
      and (p.last_digest_at is null or (p.last_digest_at at time zone 'Asia/Ho_Chi_Minh')::date < v_now::date)
    group by p.user_id
  loop
    insert into public.notifications (user_id, type, category, title, message, body, severity, icon, link,
      source_type, source_id, priority, push_enabled, metadata, delivery_reason, delivery_mode)
    values (r.user_id::text, 'info', 'system', '📬 Tổng hợp thông báo hôm nay',
      concat_ws(' · ',
        case when r.watching > 0 then r.watching || ' cập nhật đang theo dõi' end,
        case when r.responsible > 0 then r.responsible || ' cảnh báo nghiệp vụ' end),
      null, 'info', '📬', '/notifications', 'notification_digest', r.user_id::text || ':' || v_now::date, 'normal', true,
      jsonb_build_object('watching', r.watching, 'responsible', r.responsible, 'digestDate', v_now::date),
      'system', 'instant');
    v_count := v_count + 1;
  end loop;

  update public.notification_preferences p set last_digest_at = now()
  where v_now::time >= p.digest_time
    and (p.last_digest_at is null or (p.last_digest_at at time zone 'Asia/Ho_Chi_Minh')::date < v_now::date);
  return v_count;
end;
$$;
revoke all on function app_private.send_notification_digests() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'notification-digests';
select cron.schedule('notification-digests', '*/15 * * * *', $$select app_private.send_notification_digests();$$);

create index if not exists idx_notifications_digest_pending
  on public.notifications (user_id, created_at)
  where delivery_mode = 'digest' and is_read = false and is_dismissed = false;
