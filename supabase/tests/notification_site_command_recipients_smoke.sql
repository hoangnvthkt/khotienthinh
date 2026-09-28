-- Run after notification_site_command_recipients. Rolls back.
begin;
create temporary table scr_ctx on commit drop as
select
  (select s.project_id from public.project_staff s
   join public.notification_site_command_positions c on c.position_id = s.position_id
   join public.users u on u.id::text = s.user_id and u.is_active and u.auth_id is not null
   where s.end_date is null and s.project_id is not null limit 1) project_id,
  (select auth_id from public.users where role = 'ADMIN' and is_active and auth_id is not null limit 1) admin_auth,
  (select email from public.users where role = 'ADMIN' and is_active and auth_id is not null limit 1) admin_email,
  (select auth_id from public.users where role <> 'ADMIN' and is_active and auth_id is not null and account_status = 'ACTIVE' limit 1) staff_auth,
  (select email from public.users where role <> 'ADMIN' and is_active and auth_id is not null and account_status = 'ACTIVE' limit 1) staff_email;
create temporary table scr_out (k text, v jsonb) on commit drop;
grant all on scr_out to authenticated;
grant select on scr_ctx to authenticated;

do $$
declare
  v_ctx record;
  v_rule public.notification_alert_rules;
  v_command uuid[];
  v_with uuid[];
  v_without uuid[];
begin
  select * into v_ctx from scr_ctx;
  if v_ctx.project_id is null then raise exception 'no project with a site command member'; end if;
  if (select count(*) from public.notification_site_command_positions) <> 5 then raise exception 'BCH positions not seeded'; end if;
  if not coalesce((select (recipient_config ->> 'includeSiteCommand')::boolean from public.notification_alert_rules where alert_key = 'safety_critical'), false) then
    raise exception 'safety rule does not include the site command';
  end if;

  v_command := app_private.alert_site_command_ids(v_ctx.project_id, null);
  if cardinality(v_command) = 0 then raise exception 'site command empty'; end if;
  if exists (select 1 from unnest(v_command) member(member_id) where not exists (
      select 1 from public.project_staff s join public.hrm_positions p on p.id = s.position_id
      where s.user_id = member.member_id::text and s.project_id = v_ctx.project_id and s.end_date is null
        and (p.name ilike 'Chỉ huy%' or p.name ilike 'K_ thuật trưởng'))) then
    raise exception 'site command includes someone outside CHT/CHP/KTT';
  end if;

  select * into v_rule from public.notification_alert_rules where alert_key = 'safety_critical';
  v_rule.recipient_config := v_rule.recipient_config || '{"includeAdmins":false,"fallbackToAdmin":false,"includeSiteCommand":true}';
  v_with := app_private.alert_resolve_recipients(v_rule, 'safety', v_ctx.project_id, null);
  v_rule.recipient_config := v_rule.recipient_config || '{"includeSiteCommand":false}';
  v_without := app_private.alert_resolve_recipients(v_rule, 'safety', v_ctx.project_id, null);
  if not (v_with @> v_command) then raise exception 'includeSiteCommand did not add the site command'; end if;
  if array(select unnest(v_with) except select unnest(v_without) except select unnest(v_command)) <> '{}'::uuid[] then
    raise exception 'includeSiteCommand added people outside the site command';
  end if;
end $$;

-- Staff cannot change the BCH definition or preview recipients.
select set_config('request.jwt.claims', jsonb_build_object('sub', staff_auth, 'email', staff_email, 'role', 'authenticated')::text, true) from scr_ctx;
set local role authenticated;
do $$
begin
  begin
    perform public.set_site_command_positions('{}');
    raise exception 'staff changed the site command';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.preview_alert_recipients('safety_critical', null, null);
    raise exception 'staff previewed recipients';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.notification_site_command_positions) <> 5 then raise exception 'staff cannot read BCH positions'; end if;
end $$;
reset role;

-- Real recipients before the Admin edits the definition below.
insert into scr_out select 'expected', to_jsonb(array(select unnest(app_private.alert_resolve_recipients(
  (select r from public.notification_alert_rules r where r.alert_key = 'safety_critical'),
  'safety', (select project_id from scr_ctx), null)) order by 1));

-- Admin previews and edits.
select set_config('request.jwt.claims', jsonb_build_object('sub', admin_auth, 'email', admin_email, 'role', 'authenticated')::text, true) from scr_ctx;
set local role authenticated;
insert into scr_out select 'preview', coalesce(jsonb_agg(jsonb_build_object('id', user_id, 'sources', sources)), '[]')
from public.preview_alert_recipients('safety_critical', (select project_id from scr_ctx), null);
insert into scr_out select 'set', to_jsonb(public.set_site_command_positions(array(
  select position_id from public.notification_site_command_positions limit 4)));
do $$
begin
  begin
    perform public.set_site_command_positions(array['00000000-0000-0000-0000-000000000000'::uuid]);
    raise exception 'unknown position accepted';
  exception when no_data_found then null;
  end;
end $$;
reset role;

do $$
declare v_preview jsonb := (select v from scr_out where k = 'preview');
begin
  if array(select (e ->> 'id')::uuid from jsonb_array_elements(v_preview) e order by 1)
     is distinct from array(select jsonb_array_elements_text((select v from scr_out where k = 'expected'))::uuid order by 1) then
    raise exception 'preview differs from the real recipients';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_preview) e where e -> 'sources' ? 'site_command') then
    raise exception 'preview does not label the site command';
  end if;
  if exists (select 1 from jsonb_array_elements(v_preview) e where jsonb_array_length(e -> 'sources') = 0) then
    raise exception 'preview has a recipient without a reason';
  end if;
  if (select v from scr_out where k = 'set') <> '4'::jsonb then raise exception 'admin could not change the site command'; end if;
  if not exists (select 1 from public.audit_trail where table_name = 'notification_site_command_positions' and created_at > now() - interval '1 minute') then
    raise exception 'site command change not audited';
  end if;
end $$;
rollback;
