-- Run after notification_preferences_digest. Rolls back.
begin;
create temporary table npd_ctx on commit drop as
select
  (select id from public.users where role <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by id limit 1) me,
  (select auth_id from public.users where role <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by id limit 1) me_auth,
  (select email from public.users where role <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by id limit 1) me_email,
  (select id from public.users where role <> 'ADMIN' and is_active and account_status = 'ACTIVE' and auth_id is not null order by id offset 1 limit 1) other;
grant select on npd_ctx to authenticated;

-- Existing notifications stay instant.
do $$ begin
  if exists (select 1 from public.notifications where delivery_mode <> 'instant' and created_at < now() - interval '1 minute') then
    raise exception 'existing notifications changed mode';
  end if;
end $$;

insert into public.notification_preferences (user_id, watching_mode, responsible_mode, digest_time)
select me, 'digest', 'digest', time '06:00' from npd_ctx
union all select other, 'muted', 'instant', time '17:30' from npd_ctx;

insert into public.notifications (user_id, type, category, title, message, severity, source_type, source_id, delivery_reason)
select me::text, 'info', 'request', 'npd watching', 'x', 'info', 'npd', '1', 'watching' from npd_ctx
union all select me::text, 'warning', 'safety', 'npd responsible', 'x', 'warning', 'npd', '2', 'responsible' from npd_ctx
union all select me::text, 'error', 'safety', 'npd critical', 'x', 'critical', 'npd', '3', 'responsible' from npd_ctx
union all select me::text, 'info', 'request', 'npd assigned', 'x', 'info', 'npd', '4', 'assigned' from npd_ctx
union all select other::text, 'info', 'request', 'npd muted', 'x', 'info', 'npd', '5', 'watching' from npd_ctx
union all select other::text, 'info', 'safety', 'npd other responsible', 'x', 'info', 'npd', '6', 'responsible' from npd_ctx;

do $$
declare v jsonb;
begin
  select jsonb_object_agg(title, jsonb_build_object('mode', delivery_mode, 'push', push_enabled, 'read', is_read)) into v
  from public.notifications where title like 'npd %';
  if v -> 'npd watching' <> '{"mode":"digest","push":false,"read":false}'
     or v -> 'npd responsible' <> '{"mode":"digest","push":false,"read":false}'
     or v -> 'npd critical' ->> 'mode' <> 'instant'
     or v -> 'npd assigned' ->> 'mode' <> 'instant'
     or v -> 'npd muted' <> '{"mode":"muted","push":false,"read":true}'
     or v -> 'npd other responsible' ->> 'mode' <> 'instant' then
    raise exception 'preferences applied wrongly: %', v;
  end if;
end $$;

-- Digest: once per day, counting the pending notices.
create temporary table npd_runs on commit drop as
select app_private.send_notification_digests() first_run, 0 second_run;
update npd_runs set second_run = app_private.send_notification_digests();
do $$
declare v_meta jsonb;
begin
  select metadata into v_meta from public.notifications
  where source_type = 'notification_digest' and user_id = (select me::text from npd_ctx);
  if v_meta is null then raise exception 'digest not sent: %', (select to_jsonb(npd_runs) from npd_runs); end if;
  if (v_meta ->> 'watching')::int <> 1 or (v_meta ->> 'responsible')::int <> 1 then raise exception 'digest counts wrong: %', v_meta; end if;
  if (select second_run from npd_runs) <> 0 then raise exception 'digest sent twice'; end if;
  if exists (select 1 from public.notifications where source_type = 'notification_digest' and user_id = (select other::text from npd_ctx)) then
    raise exception 'digest sent before the chosen time or without pending notices';
  end if;
end $$;

-- The person sets their own preferences; business area cannot be muted.
select set_config('request.jwt.claims', jsonb_build_object('sub', me_auth, 'email', me_email, 'role', 'authenticated')::text, true) from npd_ctx;
set local role authenticated;
do $$
begin
  perform public.set_my_notification_preferences('muted', 'digest', time '18:00');
  if (select watching_mode from public.notification_preferences where user_id = public.current_app_user_id()) <> 'muted' then
    raise exception 'own preferences not saved';
  end if;
  begin
    perform public.set_my_notification_preferences('instant', 'muted', time '18:00');
    raise exception 'business area was muted';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.notification_preferences where user_id <> public.current_app_user_id()) then
    raise exception 'can read other people''s preferences';
  end if;
  begin
    insert into public.notification_preferences (user_id) values ((select other from npd_ctx));
    raise exception 'wrote preferences directly';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
